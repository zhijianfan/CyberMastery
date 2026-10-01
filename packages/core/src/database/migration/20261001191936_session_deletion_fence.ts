import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261001191936_session_deletion_fence",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_deletion\` (
          \`session_id\` text PRIMARY KEY,
          \`time_created\` integer NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
