import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260825211451_add-session-message-model-context",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_message\` ADD \`model_context_json\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
