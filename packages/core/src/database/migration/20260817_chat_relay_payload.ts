import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260817_chat_relay_payload",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`chat_relay_payload\` (
          \`id\` text PRIMARY KEY,
          \`workspace_id\` text NOT NULL,
          \`conversation_id\` text NOT NULL,
          \`text\` text NOT NULL,
          \`files\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`important\` integer DEFAULT 0 NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_chat_relay_payload_workspace_id_workspace_v2_id_fk\` FOREIGN KEY (\`workspace_id\`) REFERENCES \`workspace_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`chat_relay_payload_workspace_seq\` ON \`chat_relay_payload\` (\`workspace_id\`, \`seq\`);`,
      )
      yield* tx.run(`CREATE INDEX \`chat_relay_payload_workspace_idx\` ON \`chat_relay_payload\` (\`workspace_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
