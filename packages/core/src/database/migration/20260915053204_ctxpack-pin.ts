import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260915053204_ctxpack-pin",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`ctx_pack_pin\` (
          \`workspace_id\` text NOT NULL,
          \`ctx_pack_id\` text NOT NULL,
          \`user_id\` text NOT NULL,
          \`time_pinned\` integer NOT NULL,
          CONSTRAINT \`ctx_pack_pin_pk\` PRIMARY KEY(\`workspace_id\`, \`ctx_pack_id\`, \`user_id\`),
          CONSTRAINT \`fk_ctx_pack_pin_ctx_pack_id_ctx_pack_id_fk\` FOREIGN KEY (\`ctx_pack_id\`) REFERENCES \`ctx_pack\`(\`id\`)
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`ctx_pack_pin_workspace_user_idx\` ON \`ctx_pack_pin\` (\`workspace_id\`,\`user_id\`,"time_pinned" desc,"ctx_pack_id" desc);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
