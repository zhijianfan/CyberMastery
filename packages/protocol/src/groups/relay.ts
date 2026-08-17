import { Schema } from "effect"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"

const root = "/api/relay"

export const RelayState = Schema.Literals([
  "uninitialized",
  "initializing",
  "ready",
  "missing-login",
  "error",
]).annotate({
  identifier: "Relay.State",
})

export const RelayFile = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
}).annotate({ identifier: "Relay.File" })

export const RelayMessage = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  files: Schema.optional(Schema.Array(RelayFile)),
  at: Schema.Number,
}).annotate({ identifier: "Relay.Message" })

export const RelayStatus = Schema.Struct({
  status: RelayState,
  // Which chat provider the relay crawls (e.g. "chatgpt", "claude").
  provider: Schema.String,
  conversationId: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  // Only the recent tail of the session context is relayed to the UI; the
  // full history resides server-side in the session store.
  messages: Schema.Array(RelayMessage),
  totalMessages: NonNegativeInt,
}).annotate({ identifier: "Relay.Status" })

export const RelayPayload = Schema.Struct({
  id: Schema.String,
  workspaceID: Workspace.ID,
  conversationId: Schema.String,
  text: Schema.String,
  files: Schema.Array(RelayFile),
  index: NonNegativeInt,
  important: Schema.Boolean,
  timeCreated: Schema.Number,
}).annotate({ identifier: "Relay.Payload" })

const MarkImportantPayload = Schema.Struct({ important: Schema.Boolean }).annotate({ identifier: "Relay.MarkImportantPayload" })

const InitializeResult = Schema.Struct({ status: RelayState }).annotate({ identifier: "Relay.InitializeResult" })

const SubmitPayload = Schema.Struct({ message: Schema.String, workspaceID: Workspace.ID }).annotate({ identifier: "Relay.SubmitPayload" })

const SubmitResult = Schema.Struct({ message: RelayMessage, payload: RelayPayload }).annotate({ identifier: "Relay.SubmitResult" })

export class RelayError extends Schema.ErrorClass<RelayError>("RelayError")(
  {
    name: Schema.Literal("RelayError"),
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 400 },
) {}

export const RelayGroup = HttpApiGroup.make("server.relay")
  .add(
    HttpApiEndpoint.post("relay.initialize", `${root}/initialize`, {
      success: InitializeResult,
      error: RelayError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.relay.initialize",
        summary: "Initialize the ChatRelay",
        description: "Launch the chat browser profile and verify the login state.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("relay.status", `${root}/status`, {
      success: RelayStatus,
      error: RelayError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.relay.status",
        summary: "ChatRelay status",
        description: "Report the relay state and the relayed chat session context.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("relay.submit", `${root}/submit`, {
      payload: SubmitPayload,
      success: SubmitResult,
      error: RelayError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.relay.submit",
        summary: "Submit a message through the ChatRelay",
        description: "Relay a message to the chat webpage and capture the assistant reply.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("relay.dispose", `${root}/dispose`, {
      success: HttpApiSchema.NoContent,
      error: RelayError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.relay.dispose",
        summary: "Dispose the ChatRelay",
        description: "Close the chat browser session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("relay.payload.list", `${root}/workspaces/:workspaceID/payloads`, {
      params: { workspaceID: Workspace.ID },
      success: Schema.Array(RelayPayload),
      error: RelayError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.relay.payload.list",
        summary: "List ChatRelay payloads",
        description: "List the workspace's stored ChatRelay responses, newest first.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("relay.payload.markImportant", `${root}/workspaces/:workspaceID/payloads/:payloadID/important`, {
      params: { workspaceID: Workspace.ID, payloadID: Schema.String },
      payload: MarkImportantPayload,
      success: RelayPayload,
      error: RelayError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.relay.payload.markImportant",
        summary: "Mark a ChatRelay payload important",
        description: "Set or clear the important flag on a stored ChatRelay payload.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "ChatRelay", description: "ChatRelay routes." }))
