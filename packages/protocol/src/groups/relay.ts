import { Schema } from "effect"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
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

export const RelayMessage = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
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

const InitializeResult = Schema.Struct({ status: RelayState }).annotate({ identifier: "Relay.InitializeResult" })

const SubmitPayload = Schema.Struct({ message: Schema.String }).annotate({ identifier: "Relay.SubmitPayload" })

const SubmitResult = Schema.Struct({ message: RelayMessage }).annotate({ identifier: "Relay.SubmitResult" })

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
        summary: "Initialize the chat relay",
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
        summary: "Chat relay status",
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
        summary: "Submit a message through the chat relay",
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
        summary: "Dispose the chat relay",
        description: "Close the chat browser session.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "relay", description: "Chat relay routes." }))
