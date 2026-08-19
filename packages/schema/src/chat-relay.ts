export * as ChatRelay from "./chat-relay"

import { Schema } from "effect"
import { Event } from "./event"
import { NonNegativeInt } from "./schema"
import { Session } from "./session"
import { Workspace } from "./workspace"

export const FunctionalityID = Schema.Literal("builtin:chat-relay").annotate({
  identifier: "ChatRelay.FunctionalityID",
})
export type FunctionalityID = typeof FunctionalityID.Type

export const DirectoryBinding = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("workspace-primary") }),
  Schema.Struct({ mode: Schema.Literal("fixed"), directory: Schema.String }),
]).annotate({ identifier: "ChatRelay.DirectoryBinding" })
export type DirectoryBinding = typeof DirectoryBinding.Type

export const SessionBinding = Schema.Union([
  Schema.Struct({
    mode: Schema.Literal("owned"),
    sessionID: Session.ID,
    generation: NonNegativeInt,
  }),
  Schema.Null,
]).annotate({ identifier: "ChatRelay.SessionBinding" })
export type SessionBinding = typeof SessionBinding.Type

export const InstanceConfiguration = Schema.Struct({
  version: Schema.Literal(1),
  directoryBinding: DirectoryBinding,
  sessionBinding: SessionBinding,
}).annotate({ identifier: "ChatRelay.InstanceConfiguration" })
export type InstanceConfiguration = typeof InstanceConfiguration.Type

export const Binding = Schema.Struct({
  workspaceID: Workspace.ID,
  blockID: Schema.String,
  functionalityInstanceID: Schema.String,
  sessionID: Session.ID,
  directory: Schema.String,
  generation: NonNegativeInt,
  revision: NonNegativeInt,
}).annotate({ identifier: "ChatRelay.Binding" })
export type Binding = typeof Binding.Type

export const GetRequest = Schema.Struct({
  workspaceID: Workspace.ID,
  blockID: Schema.String,
}).annotate({ identifier: "ChatRelay.GetRequest" })
export type GetRequest = typeof GetRequest.Type

export const EnsureRequest = Schema.Struct({
  workspaceID: Workspace.ID,
  blockID: Schema.String,
}).annotate({ identifier: "ChatRelay.EnsureRequest" })
export type EnsureRequest = typeof EnsureRequest.Type

export const ResetPayload = Schema.Struct({
  expectedSessionID: Session.ID,
  expectedRevision: NonNegativeInt,
}).annotate({ identifier: "ChatRelay.ResetPayload" })
export type ResetPayload = typeof ResetPayload.Type

export const GetResponse = Schema.Union([
  Schema.Struct({ status: Schema.Literal("bound"), binding: Binding }),
  Schema.Struct({ status: Schema.Literal("unbound") }),
]).annotate({ identifier: "ChatRelay.GetResponse" })
export type GetResponse = typeof GetResponse.Type

export const BindingUpdated = Event.define({
  type: "workspace.chatRelay.binding.updated",
  schema: {
    workspaceID: Workspace.ID,
    blockID: Schema.String,
    sessionID: Session.ID,
    generation: NonNegativeInt,
    revision: NonNegativeInt,
  },
})

export const Definitions = Event.inventory(BindingUpdated)
