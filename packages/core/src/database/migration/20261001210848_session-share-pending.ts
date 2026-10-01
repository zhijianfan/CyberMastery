import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261001210848_session-share-pending",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_share_pending\` (
          \`session_id\` text PRIMARY KEY,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_share_pending_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
