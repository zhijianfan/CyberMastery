import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260814_workspace_canvas",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`workspace_v2\` (
          \`id\` text PRIMARY KEY,
          \`name\` text NOT NULL,
          \`style\` text NOT NULL,
          \`directories\` text NOT NULL,
          \`plugin_ids\` text NOT NULL,
          \`skill_ids\` text NOT NULL,
          \`user\` text DEFAULT '' NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`workspace_git\` (
          \`workspace_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`remote\` text,
          \`branch\` text,
          \`dirty\` integer NOT NULL,
          CONSTRAINT \`workspace_git_pk\` PRIMARY KEY(\`workspace_id\`, \`directory\`),
          CONSTRAINT \`fk_workspace_git_workspace_id_workspace_v2_id_fk\` FOREIGN KEY (\`workspace_id\`) REFERENCES \`workspace_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`layout\` (
          \`id\` text PRIMARY KEY,
          \`workspace_id\` text NOT NULL,
          \`revision\` integer NOT NULL,
          \`blocks\` text NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_layout_workspace_id_workspace_v2_id_fk\` FOREIGN KEY (\`workspace_id\`) REFERENCES \`workspace_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`layout_option\` (
          \`workspace_id\` text NOT NULL,
          \`user\` text NOT NULL,
          \`style\` text NOT NULL,
          \`device_class\` text DEFAULT '' NOT NULL,
          \`device_id\` text,
          \`layout_id\` text NOT NULL,
          CONSTRAINT \`layout_option_pk\` PRIMARY KEY(\`workspace_id\`, \`user\`, \`style\`, \`device_class\`, \`device_id\`),
          CONSTRAINT \`fk_layout_option_workspace_id_workspace_v2_id_fk\` FOREIGN KEY (\`workspace_id\`) REFERENCES \`workspace_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`workspace_v2_user_idx\` ON \`workspace_v2\` (\`user\`);`)
      yield* tx.run(`CREATE INDEX \`layout_workspace_idx\` ON \`layout\` (\`workspace_id\`);`)
      yield* tx.run(`CREATE INDEX \`layout_option_workspace_idx\` ON \`layout_option\` (\`workspace_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
