import { describe, expect, test } from "bun:test"
import path from "path"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { migrations } from "@opencode-ai/core/database/migration.gen"
import { SessionCompactionContext } from "@opencode-ai/core/session/compaction-context"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { tmpdir } from "../fixture/tmpdir"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
const run = <A, E>(filename: string, effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SqliteClient.layer({ filename, disableWAL: true })), Effect.scoped))

describe("session message private context migration", () => {
  test("adds one nullable column and preserves a decodable sidecar across reopen", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "session-message-context.sqlite")
    const migration = migrations.find((item) => item.id.endsWith("_add-session-message-model-context"))
    expect(migration).toBeDefined()
    if (!migration) return

    const context = SessionCompactionContext.make({
      summary: "Résumé 🐉",
      recent: "尾部 context",
      createdAt: 1_700_000_000_000,
    })
    await run(
      filename,
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`
          CREATE TABLE session_message (
            id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL,
            type TEXT NOT NULL,
            seq INTEGER NOT NULL,
            time_created INTEGER NOT NULL,
            data TEXT NOT NULL
          )
        `)
        yield* db.run(sql`
          INSERT INTO session_message (id, session_id, type, seq, time_created, data)
          VALUES ('msg_compaction', 'ses_migration', 'compaction', 1, 1700000000000, '{"reason":"auto"}')
        `)

        yield* DatabaseMigration.applyOnly(db, [migration])

        expect(
          yield* db.get<{ name: string; notnull: number; dflt_value: string | null }>(
            sql`SELECT name, "notnull", dflt_value FROM pragma_table_info('session_message') WHERE name = 'model_context_json'`,
          ),
        ).toEqual({ name: "model_context_json", notnull: 0, dflt_value: null })
        expect(yield* db.get(sql`SELECT data FROM session_message WHERE id = 'msg_compaction'`)).toEqual({
          data: '{"reason":"auto"}',
        })
        yield* db.run(
          sql`UPDATE session_message SET model_context_json = ${JSON.stringify(context)} WHERE id = 'msg_compaction'`,
        )
      }),
    )

    await run(
      filename,
      Effect.gen(function* () {
        const db = yield* makeDb
        expect(yield* SessionCompactionContext.read(db, SessionMessage.ID.make("msg_compaction"))).toEqual(context)
        expect(yield* db.get(sql`SELECT data FROM session_message WHERE id = 'msg_compaction'`)).toEqual({
          data: '{"reason":"auto"}',
        })
      }),
    )
  })
})
