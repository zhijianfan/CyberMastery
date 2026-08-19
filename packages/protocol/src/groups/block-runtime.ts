import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"

import { NonNegativeInt } from "@opencode-ai/schema/schema"

export const RuntimeCursor = Schema.String.annotate({
  identifier: "RuntimeCursor",
  description: 'Runtime cursor in the form "<id>:<sequence>".',
})

export type RuntimeCursor = typeof RuntimeCursor.Type

export const AuthRuntimeState = Schema.Struct({
  providerID: Schema.String,
  status: Schema.Literals(["missing", "awaiting-login", "ready", "error"]),
  loginURL: Schema.String.pipe(Schema.optional),
  userCode: Schema.String.pipe(Schema.optional),
  error: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "AuthRuntimeState" })
export type AuthRuntimeState = typeof AuthRuntimeState.Type

export const SessionRuntimeState = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["idle", "busy"]),
  directory: Schema.String.pipe(Schema.optional),
  modelID: Schema.String.pipe(Schema.optional),
  agentID: Schema.String.pipe(Schema.optional),
  error: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "SessionRuntimeState" })
export type SessionRuntimeState = typeof SessionRuntimeState.Type

export const MessageRuntimeState = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  timeCreated: Schema.Number.pipe(Schema.optional),
  important: Schema.Boolean.pipe(Schema.optional),
}).annotate({ identifier: "MessageRuntimeState" })
export type MessageRuntimeState = typeof MessageRuntimeState.Type

export const MessagePartRuntimeState = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  kind: Schema.Literals(["text", "tool", "reasoning", "permission"]),
  text: Schema.String.pipe(Schema.optional),
  state: Schema.Unknown.pipe(Schema.optional),
  error: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "MessagePartRuntimeState" })
export type MessagePartRuntimeState = typeof MessagePartRuntimeState.Type

export const PermissionRuntimeState = Schema.Struct({
  id: Schema.String,
  requestID: Schema.String,
  sessionID: Schema.String,
  status: Schema.Literals(["pending", "resolved"]),
  response: Schema.Literals(["allow-once", "allow-always", "deny"]).pipe(Schema.optional),
}).annotate({ identifier: "PermissionRuntimeState" })
export type PermissionRuntimeState = typeof PermissionRuntimeState.Type

export const RuntimeConnectionState = Schema.Struct({
  status: Schema.Literals(["connecting", "connected", "disconnected"]),
  cursor: Schema.String.pipe(Schema.optional),
  lastError: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "RuntimeConnectionState" })
export type RuntimeConnectionState = typeof RuntimeConnectionState.Type

export const RuntimeResourceBinding = Schema.Union([
  Schema.Struct({ type: Schema.Literal("auth"), id: Schema.String, parentID: Schema.String.pipe(Schema.optional) }),
  Schema.Struct({ type: Schema.Literal("session"), id: Schema.String, parentID: Schema.String.pipe(Schema.optional) }),
  Schema.Struct({ type: Schema.Literal("message"), id: Schema.String, parentID: Schema.String.pipe(Schema.optional) }),
  Schema.Struct({
    type: Schema.Literal("message-part"),
    id: Schema.String,
    parentID: Schema.String.pipe(Schema.optional),
  }),
  Schema.Struct({ type: Schema.Literal("permission"), id: Schema.String, parentID: Schema.String.pipe(Schema.optional) }),
  Schema.Struct({ type: Schema.Literal("pty"), id: Schema.String, parentID: Schema.String.pipe(Schema.optional) }),
  Schema.Struct({ type: Schema.Literal("file"), id: Schema.String, parentID: Schema.String.pipe(Schema.optional) }),
  Schema.Struct({ type: Schema.Literal("review"), id: Schema.String, parentID: Schema.String.pipe(Schema.optional) }),
]).annotate({ identifier: "RuntimeResourceBinding" })
export type RuntimeResourceBinding = typeof RuntimeResourceBinding.Type

export const RuntimeResourceState = Schema.Struct({
  connection: RuntimeConnectionState,
  authByProvider: Schema.Record(Schema.String, AuthRuntimeState),
  sessionsByID: Schema.Record(Schema.String, SessionRuntimeState),
  messagesByID: Schema.Record(Schema.String, MessageRuntimeState),
  partsByID: Schema.Record(Schema.String, MessagePartRuntimeState),
  permissionsByID: Schema.Record(Schema.String, PermissionRuntimeState),
}).annotate({ identifier: "RuntimeResourceState" })
export type RuntimeResourceState = typeof RuntimeResourceState.Type

export const RuntimeSnapshot = Schema.Struct({
  cursor: RuntimeCursor,
  state: RuntimeResourceState,
}).annotate({ identifier: "RuntimeSnapshot" })
export type RuntimeSnapshot = typeof RuntimeSnapshot.Type

export const RuntimeResyncRequiredPayload = Schema.Struct({
  cursor: RuntimeCursor,
  reason: Schema.String,
}).annotate({ identifier: "RuntimeResyncRequiredPayload" })

export const RuntimeStreamErrorPayload = Schema.Struct({
  code: Schema.String.pipe(Schema.optional),
  message: Schema.String,
}).annotate({ identifier: "RuntimeStreamErrorPayload" })

const envelopeFields = {
  cursor: RuntimeCursor,
  revision: NonNegativeInt.pipe(Schema.optional),
  timestamp: Schema.Number,
}

const authEvent = Schema.Struct({
  event: Schema.Literal("auth.updated"),
  resource: Schema.Struct({ type: Schema.Literal("auth"), id: Schema.String }),
  data: AuthRuntimeState,
  ...envelopeFields,
})

const sessionEvent = Schema.Struct({
  event: Schema.Literals(["session.status", "session.created"]),
  resource: Schema.Struct({
    type: Schema.Literal("session"),
    id: Schema.String,
    parentID: Schema.String.pipe(Schema.optional),
  }),
  data: SessionRuntimeState,
  ...envelopeFields,
})

const messageEvent = Schema.Struct({
  event: Schema.Literal("message.created"),
  resource: Schema.Struct({
    type: Schema.Literal("message"),
    id: Schema.String,
    parentID: Schema.String.pipe(Schema.optional),
  }),
  data: MessageRuntimeState,
  ...envelopeFields,
})

const messagePartEvent = Schema.Struct({
  event: Schema.Literal("message-part.updated"),
  resource: Schema.Struct({
    type: Schema.Literal("message-part"),
    id: Schema.String,
    parentID: Schema.String.pipe(Schema.optional),
  }),
  data: MessagePartRuntimeState,
  ...envelopeFields,
})

const permissionEvent = Schema.Struct({
  event: Schema.Literals(["permission.requested", "permission.resolved"]),
  resource: Schema.Struct({
    type: Schema.Literal("permission"),
    id: Schema.String,
    parentID: Schema.String.pipe(Schema.optional),
  }),
  data: PermissionRuntimeState,
  ...envelopeFields,
})

const connectionErrorEvent = Schema.Struct({
  event: Schema.Literal("connection.error"),
  resource: Schema.Struct({
    type: Schema.Literal("session"),
    id: Schema.String,
    parentID: Schema.String.pipe(Schema.optional),
  }),
  data: RuntimeConnectionState,
  ...envelopeFields,
})

const resyncRequiredEvent = Schema.Struct({
  event: Schema.Literal("resync.required"),
  resource: RuntimeResourceBinding,
  data: RuntimeResyncRequiredPayload,
  ...envelopeFields,
})

const streamErrorEvent = Schema.Struct({
  event: Schema.Literal("stream.error"),
  resource: RuntimeResourceBinding,
  data: RuntimeStreamErrorPayload,
  ...envelopeFields,
})

export const RuntimeEventEnvelope = Schema.Union([
  authEvent,
  sessionEvent,
  messageEvent,
  messagePartEvent,
  permissionEvent,
  connectionErrorEvent,
  resyncRequiredEvent,
  streamErrorEvent,
]).annotate({ identifier: "RuntimeEventEnvelope" })
export type RuntimeEventEnvelope = typeof RuntimeEventEnvelope.Type

export const ChatRelayCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("auth.start"),
    providerID: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("session.create"),
    modelID: Schema.String.pipe(Schema.optional),
    agentID: Schema.String.pipe(Schema.optional),
  }),
  Schema.Struct({
    type: Schema.Literal("session.prompt"),
    text: Schema.String,
    delivery: Schema.Literals(["steer", "queue"]),
  }),
  Schema.Struct({
    type: Schema.Literal("session.abort"),
  }),
  Schema.Struct({
    type: Schema.Literal("permission.respond"),
    requestID: Schema.String,
    response: Schema.Literals(["allow-once", "allow-always", "deny"]),
  }),
]).annotate({ identifier: "ChatRelayCommand" })
export type ChatRelayCommand = typeof ChatRelayCommand.Type

export const ChatRelayCommandEnvelope = Schema.Struct({
  command: ChatRelayCommand,
}).annotate({ identifier: "ChatRelayCommandEnvelope" })
export type ChatRelayCommandEnvelope = typeof ChatRelayCommandEnvelope.Type

export const BlockRuntimeSnapshotRequest = Schema.Struct({
  bindings: Schema.Array(RuntimeResourceBinding),
}).annotate({ identifier: "BlockRuntimeSnapshotRequest" })

export const BlockRuntimeSubscriptionRequest = Schema.Struct({
  bindings: Schema.Array(RuntimeResourceBinding),
  cursor: RuntimeCursor.pipe(Schema.optional),
}).annotate({ identifier: "BlockRuntimeSubscriptionRequest" })

export const BlockRuntimeGroup = HttpApiGroup.make("server.blockRuntime")
  .add(
    HttpApiEndpoint.post("block-runtime.snapshot", "/api/block-runtime/snapshot", {
      payload: BlockRuntimeSnapshotRequest,
      success: RuntimeSnapshot,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.blockRuntime.snapshot",
        summary: "Get runtime snapshot",
        description: "Fetch a snapshot for requested runtime resources and their current cursor/metadata.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("block-runtime.subscribe", "/api/block-runtime/event", {
      query: BlockRuntimeSubscriptionRequest,
      success: HttpApiSchema.StreamSse({ data: RuntimeEventEnvelope }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.blockRuntime.subscribe",
        summary: "Subscribe to block runtime events",
        description: "Stream runtime events for requested bindings, starting from the optional cursor when supported.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "blockRuntime", description: "Runtime block resource stream and snapshot routes." }))
