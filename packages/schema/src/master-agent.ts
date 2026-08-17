export * as MasterAgent from "./master-agent"

import { Schema } from "effect"
import { Event } from "./event"
import { NonNegativeInt, optional } from "./schema"
import { Session } from "./session"
import { Workspace } from "./workspace"

export const FunctionalityID = Schema.Literal("builtin:master-agent").annotate({
  identifier: "MasterAgent.FunctionalityID",
})
export type FunctionalityID = typeof FunctionalityID.Type

export const DirectoryBinding = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("workspace-primary") }),
  Schema.Struct({ mode: Schema.Literal("fixed"), directory: Schema.String }),
]).annotate({ identifier: "MasterAgent.DirectoryBinding" })
export type DirectoryBinding = typeof DirectoryBinding.Type

export const SessionBinding = Schema.Union([
  Schema.Struct({
    mode: Schema.Literal("owned"),
    sessionID: Session.ID,
    generation: NonNegativeInt,
  }),
  Schema.Null,
]).annotate({ identifier: "MasterAgent.SessionBinding" })
export type SessionBinding = typeof SessionBinding.Type

// Functionality-instance configuration. The session binding is server-managed
// and must never be accepted through a generic public configuration patch.
export const InstanceConfiguration = Schema.Struct({
  version: Schema.Literal(1),
  directoryBinding: DirectoryBinding,
  sessionBinding: SessionBinding,
}).annotate({ identifier: "MasterAgent.InstanceConfiguration" })
export type InstanceConfiguration = typeof InstanceConfiguration.Type

export const Binding = Schema.Struct({
  workspaceID: Workspace.ID,
  blockID: Schema.String,
  functionalityInstanceID: Schema.String,
  sessionID: Session.ID,
  directory: Schema.String,
  generation: NonNegativeInt,
  revision: NonNegativeInt,
}).annotate({ identifier: "MasterAgent.Binding" })
export type Binding = typeof Binding.Type

export const GetRequest = Schema.Struct({
  workspaceID: Workspace.ID,
  blockID: Schema.String,
}).annotate({ identifier: "MasterAgent.GetRequest" })
export type GetRequest = typeof GetRequest.Type

export const EnsureRequest = Schema.Struct({
  workspaceID: Workspace.ID,
  blockID: Schema.String,
}).annotate({ identifier: "MasterAgent.EnsureRequest" })
export type EnsureRequest = typeof EnsureRequest.Type

export const ResetRequest = Schema.Struct({
  workspaceID: Workspace.ID,
  blockID: Schema.String,
  expectedSessionID: Session.ID,
  expectedRevision: NonNegativeInt,
}).annotate({ identifier: "MasterAgent.ResetRequest" })
export type ResetRequest = typeof ResetRequest.Type

export const GetResponse = Schema.Union([
  Schema.Struct({ status: Schema.Literal("bound"), binding: Binding }),
  Schema.Struct({ status: Schema.Literal("unbound") }),
]).annotate({ identifier: "MasterAgent.GetResponse" })
export type GetResponse = typeof GetResponse.Type

export const ResetResponse = Schema.Union([
  Schema.Struct({ status: Schema.Literal("reset"), binding: Binding }),
  Schema.Struct({ status: Schema.Literal("stale"), currentRevision: NonNegativeInt }),
  Schema.Struct({ status: Schema.Literal("busy"), reason: Schema.String }),
]).annotate({ identifier: "MasterAgent.ResetResponse" })
export type ResetResponse = typeof ResetResponse.Type

export const BindingUpdated = Event.define({
  type: "workspace.master-agent.binding.updated",
  schema: {
    workspaceID: Workspace.ID,
    blockID: Schema.String,
    sessionID: Session.ID,
    generation: NonNegativeInt,
    revision: NonNegativeInt,
  },
})

export const Definitions = Event.inventory(BindingUpdated)
