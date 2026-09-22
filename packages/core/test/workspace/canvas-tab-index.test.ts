import { describe, expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import canvasTabMigration from "@opencode-ai/core/database/migration/20260922094155_canvas-block-tabs"
import canvasTabArchiveOrderMigration from "@opencode-ai/core/database/migration/20260922100434_canvas-tab-archive-order"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

const makeDb = EffectDrizzleSqlite.makeWithDefaults()

describe("CanvasTab archive index", () => {
  test("uses creation order for archived scans without a temporary sort", async () => {
    const details = await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE workspace_v2 (id text PRIMARY KEY)`)
        yield* DatabaseMigration.applyOnly(db, [canvasTabMigration, canvasTabArchiveOrderMigration])
        yield* db.run(sql`INSERT INTO workspace_v2 (id) VALUES ('wrk_index')`)
        yield* db.run(sql`
          INSERT INTO canvas_tab (
            id, workspace_id, kind, conversation_id, origin_block_id, title, time_created, time_archived
          ) VALUES
            ('tab-old', 'wrk_index', 'master-agent', 'session-old', 'block-1', 'Old', 10, 20),
            ('tab-new', 'wrk_index', 'master-agent', 'session-new', 'block-1', 'New', 30, 40)
        `)

        return yield* db.all<{ detail: string }>(sql`
          EXPLAIN QUERY PLAN
          SELECT id
          FROM canvas_tab
          WHERE workspace_id = 'wrk_index'
            AND kind = 'master-agent'
            AND time_archived IS NOT NULL
          ORDER BY time_created DESC, id DESC
        `)
      }),
    )

    expect(details.some((row) => row.detail.includes("canvas_tab_archive_order_idx"))).toBe(true)
    expect(details.some((row) => row.detail.includes("USE TEMP B-TREE FOR ORDER BY"))).toBe(false)
  })
})
