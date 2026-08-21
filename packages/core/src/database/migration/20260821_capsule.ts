import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

// Context capsule store (CtxPack). The schema-typed capsule body lives in
// capsule_json; createdBy and budget are out-of-schema JSON columns. Must
// agree exactly with the Drizzle ContextCapsuleTable definition in
// packages/core/src/context-broker/capsule.ts.
export default {
  id: "20260821_capsule",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`context_capsule\` (
          \`id\` text PRIMARY KEY,
          \`workspace_id\` text NOT NULL,
          \`purpose\` text NOT NULL,
          \`content_hash\` text NOT NULL,
          \`capsule_json\` text NOT NULL,
          \`created_by_json\` text NOT NULL,
          \`budget_json\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          \`expires_at\` integer NULL
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`context_capsule_workspace\` ON \`context_capsule\` (\`workspace_id\`, \`created_at\` DESC);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
