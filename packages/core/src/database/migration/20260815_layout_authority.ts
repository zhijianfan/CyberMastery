import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260815_layout_authority",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`layout_authority\` (
          \`workspace_id\` text NOT NULL,
          \`user\` text NOT NULL,
          \`style\` text NOT NULL,
          \`device_class\` text DEFAULT '' NOT NULL,
          \`holder_id\` text NOT NULL,
          \`held_at\` integer NOT NULL,
          CONSTRAINT \`layout_authority_pk\` PRIMARY KEY(\`workspace_id\`, \`user\`, \`style\`, \`device_class\`),
          CONSTRAINT \`fk_layout_authority_workspace_id_workspace_v2_id_fk\` FOREIGN KEY (\`workspace_id\`) REFERENCES \`workspace_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`layout_authority_workspace_idx\` ON \`layout_authority\` (\`workspace_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
