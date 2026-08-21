import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260821_ctxpack_usage",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(sql`
        CREATE TABLE ctx_pack_usage_admission (
          ctx_pack_id TEXT NOT NULL,
          session_input_id TEXT NOT NULL,
          time_recorded INTEGER NOT NULL,
          PRIMARY KEY(ctx_pack_id, session_input_id)
        )
      `)
    })
  },
} satisfies DatabaseMigration.Migration
