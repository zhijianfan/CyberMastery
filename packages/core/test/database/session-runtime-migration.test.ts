import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { migrations } from "@opencode-ai/core/database/migration.gen"

describe("session runtime migration", () => {
  test("adds a non-null legacy default and classifies existing projected rows", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* EffectDrizzleSqlite.makeWithDefaults()
          yield* DatabaseMigration.apply(db)
          expect(yield* db.get(sql`SELECT name FROM pragma_table_info('session') WHERE name = 'runtime'`)).toEqual({
            name: "runtime",
          })
          expect(yield* db.get(sql`SELECT dflt_value, "notnull" FROM pragma_table_info('session') WHERE name = 'runtime'`)).toEqual({
            dflt_value: "'legacy'",
            notnull: 1,
          })
          expect(migrations.at(-1)?.id).toContain("session-runtime")
        }),
      ).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true }))),
    )
  })

  test("classifies legacy, V2, mixed, and empty rows from child tables", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* EffectDrizzleSqlite.makeWithDefaults()
          yield* DatabaseMigration.applyOnly(db, migrations.slice(0, -1))
          yield* db.run(sql`
            INSERT INTO project (id, worktree, sandboxes, time_created, time_updated)
            VALUES ('prj_migration_runtime', '/project', '[]', 0, 0)
          `)
          yield* db.run(sql`
            INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
            VALUES
              ('ses_migration_legacy', 'prj_migration_runtime', 'legacy', '/project', 'legacy', 'test', 0, 0),
              ('ses_migration_v2', 'prj_migration_runtime', 'v2', '/project', 'v2', 'test', 0, 0),
              ('ses_migration_mixed', 'prj_migration_runtime', 'mixed', '/project', 'mixed', 'test', 0, 0),
              ('ses_migration_empty', 'prj_migration_runtime', 'empty', '/project', 'empty', 'test', 0, 0)
          `)
          yield* db.run(sql`
            INSERT INTO message (id, session_id, time_created, time_updated, data)
            VALUES ('msg_migration_legacy', 'ses_migration_legacy', 0, 0, '{}'),
              ('msg_migration_mixed', 'ses_migration_mixed', 0, 0, '{}')
          `)
          yield* db.run(sql`
            INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
            VALUES ('msg_migration_v2', 'ses_migration_v2', 'user', 1, 0, 0, '{}'),
              ('msg_migration_mixed_v2', 'ses_migration_mixed', 'user', 1, 0, 0, '{}')
          `)
          yield* DatabaseMigration.applyOnly(db, [migrations.at(-1)!])
          expect(
            yield* db.all(sql`SELECT id, runtime FROM session ORDER BY id`),
          ).toEqual([
            { id: "ses_migration_empty", runtime: "legacy" },
            { id: "ses_migration_legacy", runtime: "legacy" },
            { id: "ses_migration_mixed", runtime: "mixed" },
            { id: "ses_migration_v2", runtime: "v2" },
          ])
        }),
      ).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true }))),
    )
  })
})
