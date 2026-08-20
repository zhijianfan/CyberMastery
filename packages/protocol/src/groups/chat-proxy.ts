import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/api/chat-proxy"

export const ChatProxyProviderID = Schema.Literal("chatgpt").annotate({ identifier: "ChatProxy.ProviderID" })

export const ChatProxyProviderStatus = Schema.Literals([
  "disconnected",
  "opening",
  "login-required",
  "ready",
  "error",
]).annotate({ identifier: "ChatProxy.ProviderStatus" })

export class ChatProxyProvider extends Schema.Class<ChatProxyProvider>("ChatProxy.Provider")({
  id: ChatProxyProviderID,
  name: Schema.String,
  status: ChatProxyProviderStatus,
  error: Schema.optional(Schema.String),
}) {}

export class ChatProxyMessage extends Schema.Class<ChatProxyMessage>("ChatProxy.Message")({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant", "error"]),
  text: Schema.String,
  createdAt: Schema.Number,
}) {}

export const ChatProxyConfiguration = Schema.Struct({
  model: Schema.optional(Schema.String),
  effort: Schema.optional(Schema.String),
  models: Schema.Array(Schema.String),
  efforts: Schema.Array(Schema.String),
}).annotate({ identifier: "ChatProxy.Configuration" })

export const ChatProxyRelayStatus = Schema.Literals([
  "disconnected",
  "opening",
  "login-required",
  "idle",
  "thinking",
  "error",
]).annotate({ identifier: "ChatProxy.RelayStatus" })

export class ChatProxyRelay extends Schema.Class<ChatProxyRelay>("ChatProxy.Relay")({
  providerID: ChatProxyProviderID,
  relayID: Schema.String,
  status: ChatProxyRelayStatus,
  messages: Schema.Array(ChatProxyMessage),
  configuration: Schema.optional(ChatProxyConfiguration),
  error: Schema.optional(Schema.String),
}) {}

export class ChatProxyRequestError extends Schema.ErrorClass<ChatProxyRequestError>("ChatProxyRequestError")(
  {
    name: Schema.Literal("ChatProxyRequestError"),
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 409 },
) {}

export const ChatProxyGroup = HttpApiGroup.make("server.chatProxy")
  .add(
    HttpApiEndpoint.get("chatProxy.list", root, {
      success: Schema.Array(ChatProxyProvider),
      error: ChatProxyRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.list",
        summary: "List chat proxy providers",
        description: "Retrieve global browser-backed chat proxy connection status for the current user.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("chatProxy.connect", `${root}/:providerID/connect`, {
      params: { providerID: ChatProxyProviderID },
      success: ChatProxyProvider,
      error: ChatProxyRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.connect",
        summary: "Connect a chat proxy provider",
        description: "Launch the backend-owned browser so the current user can sign in directly.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("chatProxy.open", `${root}/:providerID/open`, {
      params: { providerID: ChatProxyProviderID },
      success: ChatProxyProvider,
      error: ChatProxyRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.open",
        summary: "Open a chat proxy provider",
        description: "Bring the backend-owned provider browser to the foreground.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("chatProxy.disconnect", `${root}/:providerID`, {
      params: { providerID: ChatProxyProviderID },
      success: ChatProxyProvider,
      error: ChatProxyRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.disconnect",
        summary: "Disconnect a chat proxy provider",
        description: "Close the backend-owned browser while retaining its local login profile.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("chatProxy.relay", `${root}/:providerID/relay/:relayID`, {
      params: { providerID: ChatProxyProviderID, relayID: Schema.String },
      success: ChatProxyRelay,
      error: ChatProxyRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.relay",
        summary: "Get a chat proxy relay",
        description: "Read the current transcript and delivery state for one browser-backed relay.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("chatProxy.prompt", `${root}/:providerID/relay/:relayID/prompt`, {
      params: { providerID: ChatProxyProviderID, relayID: Schema.String },
      payload: Schema.Struct({
        text: Schema.String,
        model: Schema.optional(Schema.String),
        effort: Schema.optional(Schema.String),
      }),
      success: ChatProxyRelay,
      error: ChatProxyRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.prompt",
        summary: "Send a chat proxy prompt",
        description: "Send a prompt through the provider webpage and begin capturing its visible response.",
      }),
    ),
  )
