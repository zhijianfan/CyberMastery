import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260816044418_add-workspace-operating-agent",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`workspace_v2\` ADD \`operating_agent\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
