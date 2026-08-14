import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Timestamps } from "../database/schema.sql"

export const WorkspaceV2Table = sqliteTable(
  "workspace_v2",
  {
    id: text().$type<Workspace.ID>().primaryKey(),
    name: text().notNull(),
    style: text().notNull(),
    directories: text({ mode: "json" }).notNull().$type<string[]>(),
    plugin_ids: text({ mode: "json" }).notNull().$type<string[]>(),
    skill_ids: text({ mode: "json" }).notNull().$type<string[]>(),
    user: text().notNull().default(""),
    ...Timestamps,
  },
  (table) => [index("workspace_v2_user_idx").on(table.user)],
)

export const WorkspaceGitTable = sqliteTable(
  "workspace_git",
  {
    workspace_id: text()
      .$type<Workspace.ID>()
      .notNull()
      .references(() => WorkspaceV2Table.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    remote: text(),
    branch: text(),
    dirty: integer({ mode: "boolean" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspace_id, table.directory] })],
)

export const LayoutTable = sqliteTable(
  "layout",
  {
    id: text().primaryKey(),
    workspace_id: text()
      .$type<Workspace.ID>()
      .notNull()
      .references(() => WorkspaceV2Table.id, { onDelete: "cascade" }),
    revision: integer().notNull(),
    blocks: text({ mode: "json" }).notNull().$type<Workspace.Block.Record[]>(),
    time_updated: integer().notNull(),
  },
  (table) => [index("layout_workspace_idx").on(table.workspace_id)],
)

export const LayoutOptionTable = sqliteTable(
  "layout_option",
  {
    workspace_id: text()
      .$type<Workspace.ID>()
      .notNull()
      .references(() => WorkspaceV2Table.id, { onDelete: "cascade" }),
    user: text().notNull(),
    style: text().notNull(),
    device_class: text().notNull().default(""),
    device_id: text(),
    layout_id: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspace_id, table.user, table.style, table.device_class, table.device_id] }),
    index("layout_option_workspace_idx").on(table.workspace_id),
  ],
)
