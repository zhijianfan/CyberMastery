import { OperatingChat } from "@opencode-ai/schema/operating-chat"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import { Session } from "@opencode-ai/schema/session"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/api/workspace"

export class OperatingChatWorkspaceNotFoundError extends Schema.TaggedErrorClass<OperatingChatWorkspaceNotFoundError>()(
  "OperatingChatWorkspaceNotFoundError",
  { workspaceID: Workspace.ID, message: Schema.String },
  { httpApiStatus: 404 },
) {}

export class OperatingChatBlockNotFoundError extends Schema.TaggedErrorClass<OperatingChatBlockNotFoundError>()(
  "OperatingChatBlockNotFoundError",
  { workspaceID: Workspace.ID, blockID: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

export class OperatingChatWrongFunctionalityError extends Schema.TaggedErrorClass<OperatingChatWrongFunctionalityError>()(
  "OperatingChatWrongFunctionalityError",
  { blockID: Schema.String, actual: Schema.optional(Schema.String), message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class OperatingChatInstanceNotFoundError extends Schema.TaggedErrorClass<OperatingChatInstanceNotFoundError>()(
  "OperatingChatInstanceNotFoundError",
  { workspaceID: Workspace.ID, blockID: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

export class OperatingChatAccessDeniedError extends Schema.TaggedErrorClass<OperatingChatAccessDeniedError>()(
  "OperatingChatAccessDeniedError",
  { workspaceID: Workspace.ID, blockID: Schema.String, message: Schema.String },
  { httpApiStatus: 403 },
) {}

export class OperatingChatConfigurationError extends Schema.TaggedErrorClass<OperatingChatConfigurationError>()(
  "OperatingChatConfigurationError",
  { workspaceID: Workspace.ID, message: Schema.String },
  { httpApiStatus: 409 },
) {}

export class OperatingChatStaleBindingError extends Schema.TaggedErrorClass<OperatingChatStaleBindingError>()(
  "OperatingChatStaleBindingError",
  { currentRevision: NonNegativeInt, message: Schema.String },
  { httpApiStatus: 409 },
) {}

export class OperatingChatBusyError extends Schema.TaggedErrorClass<OperatingChatBusyError>()(
  "OperatingChatBusyError",
  { sessionID: Session.ID, message: Schema.String },
  { httpApiStatus: 409 },
) {}

export class OperatingChatConflictError extends Schema.TaggedErrorClass<OperatingChatConflictError>()(
  "OperatingChatConflictError",
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}

const OperatingChatParams = {
  workspaceID: Workspace.ID,
  blockID: Schema.String,
}

export const OperatingChatGroup = HttpApiGroup.make("server.workspace.operatingChat")
  .add(
    HttpApiEndpoint.get("workspace.operatingChat.get", `${root}/:workspaceID/operating-chat/:blockID`, {
      params: OperatingChatParams,
      success: OperatingChat.GetResponse,
      error: [
        OperatingChatWorkspaceNotFoundError,
        OperatingChatBlockNotFoundError,
        OperatingChatWrongFunctionalityError,
        OperatingChatInstanceNotFoundError,
        OperatingChatAccessDeniedError,
        OperatingChatConflictError,
      ],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.operatingChat.get",
        summary: "Get OperatingChat binding",
        description:
          "Resolve the server-owned OperatingChat session binding for a workspace block, or unbound when no instance exists.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.operatingChat.ensure", `${root}/:workspaceID/operating-chat/:blockID/ensure`, {
      params: OperatingChatParams,
      success: OperatingChat.Binding,
      error: [
        OperatingChatWorkspaceNotFoundError,
        OperatingChatBlockNotFoundError,
        OperatingChatWrongFunctionalityError,
        OperatingChatAccessDeniedError,
        OperatingChatConfigurationError,
        OperatingChatConflictError,
      ],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.operatingChat.ensure",
        summary: "Ensure OperatingChat binding",
        description:
          "Resolve or create the server-owned OperatingChat session binding using the workspace OperatingAgent model.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.operatingChat.reset", `${root}/:workspaceID/operating-chat/:blockID/reset`, {
      params: OperatingChatParams,
      payload: OperatingChat.ResetPayload,
      success: OperatingChat.Binding,
      error: [
        OperatingChatWorkspaceNotFoundError,
        OperatingChatBlockNotFoundError,
        OperatingChatWrongFunctionalityError,
        OperatingChatInstanceNotFoundError,
        OperatingChatAccessDeniedError,
        OperatingChatConfigurationError,
        OperatingChatStaleBindingError,
        OperatingChatBusyError,
        OperatingChatConflictError,
      ],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.operatingChat.reset",
        summary: "Reset OperatingChat binding",
        description:
          "Replace the OperatingChat session binding with a fresh host-created session, guarded by session id and revision.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "operatingChat", description: "OperatingChat block binding routes." }))
