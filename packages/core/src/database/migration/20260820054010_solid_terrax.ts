import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260820054010_solid_terrax",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`PRAGMA foreign_keys=OFF;`)
      yield* tx.run(`
        CREATE TABLE \`__new_layout_option\` (
          \`workspace_id\` text NOT NULL,
          \`user\` text NOT NULL,
          \`style\` text NOT NULL,
          \`device_class\` text DEFAULT '' NOT NULL,
          \`layout_id\` text NOT NULL,
          CONSTRAINT \`layout_option_pk\` PRIMARY KEY(\`workspace_id\`, \`user\`, \`style\`, \`device_class\`),
          CONSTRAINT \`fk_layout_option_workspace_id_workspace_v2_id_fk\` FOREIGN KEY (\`workspace_id\`) REFERENCES \`workspace_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `INSERT INTO \`__new_layout_option\`(\`workspace_id\`, \`user\`, \`style\`, \`device_class\`, \`layout_id\`) SELECT \`workspace_id\`, \`user\`, \`style\`, \`device_class\`, MIN(\`layout_id\`) FROM \`layout_option\` GROUP BY \`workspace_id\`, \`user\`, \`style\`, \`device_class\`;`,
      )
      yield* tx.run(`DROP TABLE \`layout_option\`;`)
      yield* tx.run(`ALTER TABLE \`__new_layout_option\` RENAME TO \`layout_option\`;`)
      yield* tx.run(`PRAGMA foreign_keys=ON;`)
      yield* tx.run(`CREATE INDEX \`layout_option_workspace_idx\` ON \`layout_option\` (\`workspace_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
