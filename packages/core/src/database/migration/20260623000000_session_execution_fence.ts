import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260623000000_session_execution_fence",
  up(tx) {
    return tx
      .run(
        `
      CREATE TABLE \`session_execution\` (
        \`session_id\` text PRIMARY KEY NOT NULL,
        \`owner_id\` text,
        \`epoch\` integer NOT NULL,
        CONSTRAINT \`fk_session_execution_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
      );
    `,
      )
      .pipe(Effect.asVoid)
  },
} satisfies DatabaseMigration.Migration
