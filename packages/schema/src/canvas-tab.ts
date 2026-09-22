export * as CanvasTab from "./canvas-tab"

import { Schema } from "effect"
import { optional } from "./schema"
import { WorkspaceID } from "./workspace-id"

export const Kind = Schema.Literals(["master-agent", "operating-chat", "chat-relay"]).annotate({
  identifier: "CanvasTab.Kind",
})
export type Kind = typeof Kind.Type

export const Entry = Schema.Struct({
  id: Schema.String,
  workspaceID: WorkspaceID,
  kind: Kind,
  blockID: optional(Schema.String),
  conversationID: Schema.String,
  title: Schema.String,
  createdAt: Schema.Number,
  archivedAt: optional(Schema.Number),
  writable: Schema.Boolean,
}).annotate({ identifier: "CanvasTab.Entry" })
export interface Entry extends Schema.Schema.Type<typeof Entry> {}

export const Cursor = Schema.Struct({
  createdAt: Schema.Number.check(Schema.isFinite()),
  id: Schema.String.check(Schema.isMinLength(1)),
}).annotate({ identifier: "CanvasTab.Cursor" })
export interface Cursor extends Schema.Schema.Type<typeof Cursor> {}

export const Page = Schema.Struct({
  items: Schema.Array(Entry),
  next: Schema.NullOr(Cursor),
}).annotate({ identifier: "CanvasTab.Page" })
export interface Page extends Schema.Schema.Type<typeof Page> {}
