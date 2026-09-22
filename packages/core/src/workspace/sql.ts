import { desc } from "drizzle-orm"
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { CanvasTab } from "@opencode-ai/schema/canvas-tab"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Timestamps } from "../database/schema.sql"

export const WorkspaceV2Table = sqliteTable(
  "workspace_v2",
  {
    id: text().$type<Workspace.ID>().primaryKey(),
    name: text().notNull(),
    style: text().notNull(),
    directories: text({ mode: "json" }).notNull().$type<readonly string[]>(),
    plugin_ids: text({ mode: "json" }).notNull().$type<readonly string[]>(),
    skill_ids: text({ mode: "json" }).notNull().$type<readonly string[]>(),
    operating_agent: text(),
    model: text(),
    coder_model: text(),
    user: text().notNull().default("default"),
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
    blocks: text({ mode: "json" }).notNull().$type<readonly Workspace.Block.Record[]>(),
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
    layout_id: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspace_id, table.user, table.style, table.device_class] }),
    index("layout_option_workspace_idx").on(table.workspace_id),
  ],
)

// Generic functionality-instance storage: binds a workspace block to a
// functionality and its server-managed configuration (e.g. MasterAgent
// session bindings). Layout JSON stores presentation only; this table owns
// the durable per-block instance state.
export const FunctionalityInstanceTable = sqliteTable(
  "functionality_instance",
  {
    id: text().primaryKey(),
    workspace_id: text()
      .$type<Workspace.ID>()
      .notNull()
      .references(() => WorkspaceV2Table.id, { onDelete: "cascade" }),
    block_id: text().notNull(),
    functionality_id: text().notNull(),
    revision: integer().notNull(),
    configuration: text({ mode: "json" }).notNull().$type<unknown>(),
    deleted_at: integer(),
    time_updated: integer().notNull(),
  },
  (table) => [
    uniqueIndex("functionality_instance_key").on(table.workspace_id, table.block_id, table.functionality_id),
    index("functionality_instance_workspace_idx").on(table.workspace_id),
  ],
)

// Durable per-workspace ChatRelay response store. Each row is one captured
// assistant response (text + files) with a per-workspace sequence index, an
// important flag, and a capture timestamp.
export const ChatRelayPayloadTable = sqliteTable(
  "chat_relay_payload",
  {
    id: text().primaryKey(),
    workspace_id: text()
      .$type<Workspace.ID>()
      .notNull()
      .references(() => WorkspaceV2Table.id, { onDelete: "cascade" }),
    conversation_id: text().notNull(),
    text: text().notNull(),
    files: text({ mode: "json" }).notNull().$type<readonly { name: string; url: string }[]>(),
    seq: integer().notNull(),
    important: integer({ mode: "boolean" }).notNull().default(false),
    time_created: integer().notNull(),
  },
  (table) => [
    uniqueIndex("chat_relay_payload_workspace_seq").on(table.workspace_id, table.seq),
    index("chat_relay_payload_workspace_idx").on(table.workspace_id),
  ],
)

// Layout authority handover: the last client that pulled a tuple owns its
// layout. Saves from a different client are rejected as handed-over until
// that client re-pulls (which re-claims authority).
export const LayoutAuthorityTable = sqliteTable(
  "layout_authority",
  {
    workspace_id: text()
      .$type<Workspace.ID>()
      .notNull()
      .references(() => WorkspaceV2Table.id, { onDelete: "cascade" }),
    user: text().notNull(),
    style: text().notNull(),
    device_class: text().notNull().default(""),
    holder_id: text().notNull(),
    held_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspace_id, table.user, table.style, table.device_class] }),
    index("layout_authority_workspace_idx").on(table.workspace_id),
  ],
)

export const CanvasTabTable = sqliteTable(
  "canvas_tab",
  {
    id: text().primaryKey(),
    workspace_id: text()
      .$type<Workspace.ID>()
      .notNull()
      .references(() => WorkspaceV2Table.id, { onDelete: "cascade" }),
    kind: text().$type<CanvasTab.Kind>().notNull(),
    conversation_id: text().notNull(),
    origin_block_id: text().notNull(),
    owner_block_id: text(),
    title: text().notNull(),
    time_created: integer().notNull(),
    time_archived: integer(),
    snapshot: text({ mode: "json" }).$type<unknown>(),
  },
  (table) => [
    uniqueIndex("canvas_tab_workspace_kind_conversation_idx").on(
      table.workspace_id,
      table.kind,
      table.conversation_id,
    ),
    index("canvas_tab_owner_created_idx").on(
      table.workspace_id,
      table.kind,
      table.owner_block_id,
      desc(table.time_created),
      desc(table.id),
    ),
    index("canvas_tab_archive_created_idx").on(
      table.workspace_id,
      table.kind,
      table.time_archived,
      desc(table.time_created),
      desc(table.id),
    ),
  ],
)

export const CanvasTabBlockTable = sqliteTable(
  "canvas_tab_block",
  {
    workspace_id: text()
      .$type<Workspace.ID>()
      .notNull()
      .references(() => WorkspaceV2Table.id, { onDelete: "cascade" }),
    kind: text().$type<CanvasTab.Kind>().notNull(),
    block_id: text().notNull(),
    selected_tab_id: text().notNull(),
    revision: integer().notNull(),
    deleted_at: integer(),
  },
  (table) => [
    primaryKey({ columns: [table.workspace_id, table.kind, table.block_id] }),
    index("canvas_tab_block_workspace_idx").on(table.workspace_id, table.kind),
  ],
)
