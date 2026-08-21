// Durable context_capsule table definition. Lives in a `sql.ts`-named module
// so the drizzle schema glob (`./src/**/*.sql.ts`, `./src/**/sql.ts`) picks it
// up for the fresh-database snapshot (M1 fix: the table originally lived in
// capsule.ts, which the glob does not match, so fresh DBs missed it).
//
// The raw SQL migration `20260821_capsule.ts` must agree exactly with this
// definition.

import { desc } from "drizzle-orm"
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Functionality } from "@opencode-ai/schema/functionality"
import type { ContextBudget, StoredCapsule } from "./capsule"

export const ContextCapsuleTable = sqliteTable(
  "context_capsule",
  {
    id: text().primaryKey(),
    workspace_id: text().notNull(),
    purpose: text().notNull(),
    content_hash: text().notNull(),
    capsule_json: text({ mode: "json" }).notNull().$type<Functionality.Capsule>(),
    created_by_json: text({ mode: "json" }).notNull().$type<StoredCapsule["createdBy"]>(),
    budget_json: text({ mode: "json" }).notNull().$type<ContextBudget>(),
    created_at: integer().notNull(),
    expires_at: integer(),
  },
  (table) => [index("context_capsule_workspace").on(table.workspace_id, desc(table.created_at))],
)
