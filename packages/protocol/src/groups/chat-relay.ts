import { ChatRelay } from "@opencode-ai/schema/chat-relay"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import { Session } from "@opencode-ai/schema/session"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/api/workspace"

export class ChatRelayWorkspaceNotFoundError extends Schema.TaggedErrorClass<ChatRelayWorkspaceNotFoundError>()(
  "ChatRelayWorkspaceNotFoundError",
  {
    workspaceID: Workspace.ID,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class ChatRelayBlockNotFoundError extends Schema.TaggedErrorClass<ChatRelayBlockNotFoundError>()(
  "ChatRelayBlockNotFoundError",
  {
    workspaceID: Workspace.ID,
    blockID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class ChatRelayWrongFunctionalityError extends Schema.TaggedErrorClass<ChatRelayWrongFunctionalityError>()(
  "ChatRelayWrongFunctionalityError",
  {
    blockID: Schema.String,
    actual: Schema.optional(Schema.String),
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export class ChatRelayInstanceNotFoundError extends Schema.TaggedErrorClass<ChatRelayInstanceNotFoundError>()(
  "ChatRelayInstanceNotFoundError",
  {
    workspaceID: Workspace.ID,
    blockID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class ChatRelayAccessDeniedError extends Schema.TaggedErrorClass<ChatRelayAccessDeniedError>()(
  "ChatRelayAccessDeniedError",
  {
    workspaceID: Workspace.ID,
    blockID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 403 },
) {}

export class ChatRelayStaleBindingError extends Schema.TaggedErrorClass<ChatRelayStaleBindingError>()(
  "ChatRelayStaleBindingError",
  {
    currentRevision: NonNegativeInt,
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export class ChatRelayBusyError extends Schema.TaggedErrorClass<ChatRelayBusyError>()(
  "ChatRelayBusyError",
  {
    sessionID: Session.ID,
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export class ChatRelayConflictError extends Schema.TaggedErrorClass<ChatRelayConflictError>()(
  "ChatRelayConflictError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

const ChatRelayParams = {
  workspaceID: Workspace.ID,
  blockID: Schema.String,
}

export const ChatRelayGroup = HttpApiGroup.make("server.workspace.chatRelay")
  .add(
    HttpApiEndpoint.get("workspace.chatRelay.get", `${root}/:workspaceID/chat-relay/:blockID`, {
      params: ChatRelayParams,
      success: ChatRelay.GetResponse,
      error: [
        ChatRelayWorkspaceNotFoundError,
        ChatRelayBlockNotFoundError,
        ChatRelayWrongFunctionalityError,
        ChatRelayInstanceNotFoundError,
        ChatRelayAccessDeniedError,
        ChatRelayConflictError,
      ],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.chatRelay.get",
        summary: "Get ChatRelay binding",
        description:
          "Resolve the server-owned ChatRelay session binding for a workspace block, or unbound when no instance exists.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.chatRelay.ensure", `${root}/:workspaceID/chat-relay/:blockID/ensure`, {
      params: ChatRelayParams,
      success: ChatRelay.Binding,
      error: [
        ChatRelayWorkspaceNotFoundError,
        ChatRelayBlockNotFoundError,
        ChatRelayWrongFunctionalityError,
        ChatRelayAccessDeniedError,
        ChatRelayConflictError,
      ],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.chatRelay.ensure",
        summary: "Ensure ChatRelay binding",
        description:
          "Resolve or create the server-owned ChatRelay session binding for a workspace block. Idempotent; the host owns session creation.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.chatRelay.reset", `${root}/:workspaceID/chat-relay/:blockID/reset`, {
      params: ChatRelayParams,
      payload: ChatRelay.ResetPayload,
      success: ChatRelay.Binding,
      error: [
        ChatRelayWorkspaceNotFoundError,
        ChatRelayBlockNotFoundError,
        ChatRelayWrongFunctionalityError,
        ChatRelayInstanceNotFoundError,
        ChatRelayAccessDeniedError,
        ChatRelayStaleBindingError,
        ChatRelayBusyError,
        ChatRelayConflictError,
      ],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.chatRelay.reset",
        summary: "Reset ChatRelay binding",
        description:
          "Replace the ChatRelay session binding with a fresh host-created session, guarded by the expected session id and revision. The previous session is preserved.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "chatRelay", description: "ChatRelay block binding routes." }))
