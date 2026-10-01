import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260623000001_session_handoff_reservation",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run("ALTER TABLE `session_execution` ADD COLUMN `handoff_id` text")
      yield* tx.run("ALTER TABLE `session_execution` ADD COLUMN `handoff_state` text")
      yield* tx.run("ALTER TABLE `session_execution` ADD COLUMN `target_owner_id` text")
      yield* tx.run("ALTER TABLE `session_execution` ADD COLUMN `target_endpoint` text")
      yield* tx.run("ALTER TABLE `session_execution` ADD COLUMN `prepared_digest` text")
      yield* tx.run("ALTER TABLE `session_execution` ADD COLUMN `prepared_seq` integer")
    })
  },
} satisfies DatabaseMigration.Migration
