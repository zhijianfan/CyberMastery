import { expect, test } from "bun:test"
import path from "path"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Database } from "@opencode-ai/core/database/database"
import { migrations } from "@opencode-ai/core/database/migration.gen"
import { SessionCompactionContext } from "@opencode-ai/core/session/compaction-context"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { tmpdir } from "../fixture/tmpdir"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
const runRaw = <A, E>(filename: string, effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SqliteClient.layer({ filename, disableWAL: true })), Effect.scoped))

test("fresh databases include the nullable private compaction context column", async () => {
  await using tmp = await tmpdir()
  const filename = path.join(tmp.path, "fresh.sqlite")

  const column = await Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db.get<{ name: string; notnull: number }>(
      sql`SELECT name, "notnull" FROM pragma_table_info('session_message') WHERE name = 'model_context_json'`,
    )
  }).pipe(Effect.provide(Database.layerFromPath(filename)), Effect.scoped, Effect.runPromise)

  expect(column).toEqual({ name: "model_context_json", notnull: 0 })
})

test("the additive migration preserves legacy checkpoints and survives sidecar reopen", async () => {
  await using tmp = await tmpdir()
  const filename = path.join(tmp.path, "upgrade.sqlite")
  const migration = migrations.find((item) => item.id.endsWith("_add-session-message-model-context"))
  expect(migration).toBeDefined()
  if (!migration) return

  await runRaw(
    filename,
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY)`)
      yield* db.run(sql`
        CREATE TABLE session_message (
          id text PRIMARY KEY,
          session_id text NOT NULL,
          type text NOT NULL,
          seq integer NOT NULL,
          time_created integer NOT NULL,
          time_updated integer NOT NULL,
          data text NOT NULL
        )
      `)
      yield* db.run(sql`CREATE TABLE migration (id text PRIMARY KEY, time_completed integer NOT NULL)`)
      yield* Effect.forEach(
        migrations.filter((item) => item.id !== migration.id),
        (item) => db.run(sql`INSERT INTO migration (id, time_completed) VALUES (${item.id}, 1)`),
        { discard: true },
      )
      yield* db.run(sql`INSERT INTO session (id) VALUES ('ses_compaction_migration')`)
      yield* db.run(sql`
        INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
        VALUES (
          'msg_legacy_compaction',
          'ses_compaction_migration',
          'compaction',
          1,
          1,
          1,
          '{"reason":"auto","summary":"Legacy summary","recent":"Legacy recent","time":{"created":1}}'
        )
      `)
    }),
  )

  const context = SessionCompactionContext.make({ summary: "Private summary", recent: "Private recent", createdAt: 2 })
  await Effect.gen(function* () {
    const { db } = yield* Database.Service
    expect(
      yield* db.get(sql`SELECT model_context_json FROM session_message WHERE id = 'msg_legacy_compaction'`),
    ).toEqual({ model_context_json: null })
    yield* db.run(
      sql`UPDATE session_message SET model_context_json = ${JSON.stringify(context)} WHERE id = 'msg_legacy_compaction'`,
    )
  }).pipe(Effect.provide(Database.layerFromPath(filename)), Effect.scoped, Effect.runPromise)

  const stored = await Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db.get<{ model_context_json: string }>(
      sql`SELECT model_context_json FROM session_message WHERE id = 'msg_legacy_compaction'`,
    )
  }).pipe(Effect.provide(Database.layerFromPath(filename)), Effect.scoped, Effect.runPromise)

  expect(
    Effect.runSync(
      SessionCompactionContext.decode(stored!.model_context_json, SessionMessage.ID.make("msg_legacy_compaction")),
    ),
  ).toEqual(context)
})
