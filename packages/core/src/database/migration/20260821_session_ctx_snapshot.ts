import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260821_session_ctx_snapshot",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(sql`ALTER TABLE session_input ADD COLUMN context_snapshot_json TEXT`)
    })
  },
} satisfies DatabaseMigration.Migration
