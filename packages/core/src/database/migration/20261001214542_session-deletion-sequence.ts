import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261001214542_session-deletion-sequence",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_deletion\` ADD \`fence_seq\` integer;`)
    })
  },
} satisfies DatabaseMigration.Migration
