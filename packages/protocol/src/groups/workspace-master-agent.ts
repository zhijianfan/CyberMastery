import { MasterAgent } from "@opencode-ai/schema/master-agent"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import { Session } from "@opencode-ai/schema/session"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

// MasterAgent block binding routes. The session binding is server-managed and
// cannot be written through any generic client configuration; the model-visible
// surface exposes only get/ensure/reset, never a prompt endpoint.

const root = "/api/workspace"

// Typed lifecycle errors mirroring the MasterAgent contract. Stale and busy
// reset outcomes are additionally representable as ResetResponse statuses so
// handlers can choose between a 200 result union (repo CAS convention) and a
// typed 409 without collapsing anything into a generic 500.
export class MasterAgentWorkspaceNotFoundError extends Schema.TaggedErrorClass<MasterAgentWorkspaceNotFoundError>()(
  "MasterAgentWorkspaceNotFoundError",
  {
    workspaceID: Workspace.ID,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class MasterAgentBlockNotFoundError extends Schema.TaggedErrorClass<MasterAgentBlockNotFoundError>()(
  "MasterAgentBlockNotFoundError",
  {
    workspaceID: Workspace.ID,
    blockID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class MasterAgentWrongFunctionalityError extends Schema.TaggedErrorClass<MasterAgentWrongFunctionalityError>()(
  "MasterAgentWrongFunctionalityError",
  {
    blockID: Schema.String,
    actual: Schema.optional(Schema.String),
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export class MasterAgentInstanceNotFoundError extends Schema.TaggedErrorClass<MasterAgentInstanceNotFoundError>()(
  "MasterAgentInstanceNotFoundError",
  {
    workspaceID: Workspace.ID,
    blockID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class MasterAgentAccessDeniedError extends Schema.TaggedErrorClass<MasterAgentAccessDeniedError>()(
  "MasterAgentAccessDeniedError",
  {
    workspaceID: Workspace.ID,
    blockID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 403 },
) {}

export class MasterAgentStaleBindingError extends Schema.TaggedErrorClass<MasterAgentStaleBindingError>()(
  "MasterAgentStaleBindingError",
  {
    currentRevision: NonNegativeInt,
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export class MasterAgentBusyError extends Schema.TaggedErrorClass<MasterAgentBusyError>()(
  "MasterAgentBusyError",
  {
    sessionID: Session.ID,
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export class MasterAgentConflictError extends Schema.TaggedErrorClass<MasterAgentConflictError>()(
  "MasterAgentConflictError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

// Reset is guarded by the client's last observed session id and revision so a
// stale client can never replace a binding it no longer sees.
export const MasterAgentResetPayload = Schema.Struct({
  expectedSessionID: Session.ID,
  expectedRevision: NonNegativeInt,
}).annotate({ identifier: "MasterAgent.ResetPayload" })

const MasterAgentParams = {
  workspaceID: Workspace.ID,
  blockID: Schema.String,
}

export const MasterAgentGroup = HttpApiGroup.make("server.workspace.masterAgent")
  .add(
    HttpApiEndpoint.get("workspace.masterAgent.get", `${root}/:workspaceID/master-agent/:blockID`, {
      params: MasterAgentParams,
      success: MasterAgent.GetResponse,
      error: [
        MasterAgentWorkspaceNotFoundError,
        MasterAgentBlockNotFoundError,
        MasterAgentWrongFunctionalityError,
        MasterAgentInstanceNotFoundError,
        MasterAgentAccessDeniedError,
        MasterAgentConflictError,
      ],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.masterAgent.get",
        summary: "Get MasterAgent binding",
        description:
          "Resolve the server-owned MasterAgent session binding for a workspace block, or unbound when no instance exists.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.masterAgent.ensure", `${root}/:workspaceID/master-agent/:blockID/ensure`, {
      params: MasterAgentParams,
      success: MasterAgent.Binding,
      error: [
        MasterAgentWorkspaceNotFoundError,
        MasterAgentBlockNotFoundError,
        MasterAgentWrongFunctionalityError,
        MasterAgentAccessDeniedError,
        MasterAgentConflictError,
      ],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.masterAgent.ensure",
        summary: "Ensure MasterAgent binding",
        description:
          "Resolve or create the server-owned MasterAgent session binding for a workspace block. Idempotent; the host owns session creation.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.masterAgent.reset", `${root}/:workspaceID/master-agent/:blockID/reset`, {
      params: MasterAgentParams,
      payload: MasterAgentResetPayload,
      success: MasterAgent.ResetResponse,
      error: [
        MasterAgentWorkspaceNotFoundError,
        MasterAgentBlockNotFoundError,
        MasterAgentWrongFunctionalityError,
        MasterAgentInstanceNotFoundError,
        MasterAgentAccessDeniedError,
        MasterAgentStaleBindingError,
        MasterAgentBusyError,
        MasterAgentConflictError,
      ],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.masterAgent.reset",
        summary: "Reset MasterAgent binding",
        description:
          "Replace the MasterAgent session binding with a fresh host-created session, guarded by the expected session id and revision. The previous session is preserved.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "master-agent",
      description: "MasterAgent block binding routes.",
    }),
  )
