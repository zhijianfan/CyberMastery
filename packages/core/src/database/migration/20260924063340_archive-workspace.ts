import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260924063340_archive-workspace",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`workspace_v2\` ADD \`time_deleted\` integer;`)
    })
  },
} satisfies DatabaseMigration.Migration
