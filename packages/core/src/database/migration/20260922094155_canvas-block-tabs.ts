import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260922094155_canvas-block-tabs",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`canvas_tab_block\` (
          \`workspace_id\` text NOT NULL,
          \`kind\` text NOT NULL,
          \`block_id\` text NOT NULL,
          \`selected_tab_id\` text NOT NULL,
          \`revision\` integer NOT NULL,
          \`deleted_at\` integer,
          CONSTRAINT \`canvas_tab_block_pk\` PRIMARY KEY(\`workspace_id\`, \`kind\`, \`block_id\`),
          CONSTRAINT \`fk_canvas_tab_block_workspace_id_workspace_v2_id_fk\` FOREIGN KEY (\`workspace_id\`) REFERENCES \`workspace_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`canvas_tab\` (
          \`id\` text PRIMARY KEY,
          \`workspace_id\` text NOT NULL,
          \`kind\` text NOT NULL,
          \`conversation_id\` text NOT NULL,
          \`origin_block_id\` text NOT NULL,
          \`owner_block_id\` text,
          \`title\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_archived\` integer,
          \`snapshot\` text,
          CONSTRAINT \`fk_canvas_tab_workspace_id_workspace_v2_id_fk\` FOREIGN KEY (\`workspace_id\`) REFERENCES \`workspace_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`canvas_tab_block_workspace_idx\` ON \`canvas_tab_block\` (\`workspace_id\`,\`kind\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`canvas_tab_workspace_kind_conversation_idx\` ON \`canvas_tab\` (\`workspace_id\`,\`kind\`,\`conversation_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`canvas_tab_owner_created_idx\` ON \`canvas_tab\` (\`workspace_id\`,\`kind\`,\`owner_block_id\`,"time_created" desc,"id" desc);`,
      )
      yield* tx.run(
        `CREATE INDEX \`canvas_tab_archive_created_idx\` ON \`canvas_tab\` (\`workspace_id\`,\`kind\`,\`time_archived\`,"time_created" desc,"id" desc);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
