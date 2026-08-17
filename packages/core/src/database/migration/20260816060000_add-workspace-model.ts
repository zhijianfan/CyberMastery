import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260816060000_add-workspace-model",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`workspace_v2\` ADD \`model\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
