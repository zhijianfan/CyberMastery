import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260816090000_master-agent",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`workspace_v2\` ADD \`coder_model\` text;`)
      yield* tx.run(`
        CREATE TABLE \`functionality_instance\` (
          \`id\` text PRIMARY KEY,
          \`workspace_id\` text NOT NULL,
          \`block_id\` text NOT NULL,
          \`functionality_id\` text NOT NULL,
          \`revision\` integer NOT NULL,
          \`configuration\` text NOT NULL,
          \`deleted_at\` integer,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_functionality_instance_workspace_id_workspace_v2_id_fk\` FOREIGN KEY (\`workspace_id\`) REFERENCES \`workspace_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`functionality_instance_key\` ON \`functionality_instance\` (\`workspace_id\`, \`block_id\`, \`functionality_id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`functionality_instance_workspace_idx\` ON \`functionality_instance\` (\`workspace_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
