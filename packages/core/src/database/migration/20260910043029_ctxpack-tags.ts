import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260910043029_ctxpack-tags",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`ctx_pack\` ADD \`tags_json\` text DEFAULT '[]' NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
