import { ChatProxy } from "@opencode-ai/schema/chat-proxy"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors"

const root = "/api/chat-proxy"
const relayRoot = "/api/workspace/:workspaceID/chat-relay/:blockID/browser"
const relayParams = { workspaceID: Workspace.ID, blockID: Schema.String }

export class ChatProxyRequestError extends Schema.ErrorClass<ChatProxyRequestError>("ChatProxyRequestError")(
  {
    name: Schema.Literal("ChatProxyRequestError"),
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 409 },
) {}

const relayErrors = [InvalidRequestError, ChatProxyRequestError]

export const ChatProxyGroup = HttpApiGroup.make("server.chatProxy")
  .add(
    HttpApiEndpoint.get("chatProxy.status", root, {
      success: ChatProxy.Provider,
      error: ChatProxyRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.status",
        summary: "Get ChatGPT browser status",
        description: "Read the current user's shared ChatGPT browser login status.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("chatProxy.connect", `${root}/connect`, {
      success: ChatProxy.Provider,
      error: ChatProxyRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.connect",
        summary: "Connect the ChatGPT browser",
        description: "Open the shared browser so the current user can sign in to ChatGPT.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("chatProxy.open", `${root}/open`, {
      success: ChatProxy.Provider,
      error: ChatProxyRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.open",
        summary: "Open the ChatGPT browser",
        description: "Bring the current user's shared ChatGPT browser to the foreground.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("chatProxy.relay", relayRoot, {
      params: relayParams,
      success: ChatProxy.Relay,
      error: relayErrors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.relay",
        summary: "Get a ChatRelay browser tab",
        description: "Read the browser tab, transcript, and delivery state owned by one ChatRelay block.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("chatProxy.ensure", `${relayRoot}/ensure`, {
      params: relayParams,
      success: ChatProxy.Relay,
      error: relayErrors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.ensure",
        summary: "Ensure a ChatRelay browser tab",
        description: "Reuse or create the ChatGPT browser tab owned by one ChatRelay block.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("chatProxy.reset", `${relayRoot}/reset`, {
      params: relayParams,
      payload: ChatProxy.ResetPayload,
      success: ChatProxy.Relay,
      error: relayErrors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.reset",
        summary: "Reset a ChatRelay browser tab",
        description: "Replace the block-owned browser tab, optionally guarding the tab being replaced.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("chatProxy.prompt", `${relayRoot}/prompt`, {
      params: relayParams,
      payload: ChatProxy.PromptPayload,
      success: ChatProxy.Relay,
      error: relayErrors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.prompt",
        summary: "Send a ChatRelay prompt",
        description: "Send one identified message through the block-owned ChatGPT browser tab.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("chatProxy.openRelay", `${relayRoot}/open`, {
      params: relayParams,
      payload: ChatProxy.OpenRelayPayload,
      success: ChatProxy.Relay,
      error: relayErrors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.openRelay",
        summary: "Open a ChatRelay browser tab",
        description: "Bring the block-owned ChatGPT browser tab to the foreground.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("chatProxy.options", `${relayRoot}/options`, {
      params: relayParams,
      payload: ChatProxy.OptionsPayload,
      success: ChatProxy.Relay,
      error: relayErrors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.options",
        summary: "Read ChatRelay model options",
        description: "Read the model and reasoning effort choices available in the block-owned ChatGPT tab.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("chatProxy.configure", `${relayRoot}/configure`, {
      params: relayParams,
      payload: ChatProxy.ConfigurePayload,
      success: ChatProxy.Relay,
      error: relayErrors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.chatProxy.configure",
        summary: "Configure a ChatRelay tab",
        description: "Apply a model or reasoning effort choice to the block-owned ChatGPT tab.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({ title: "chatProxy", description: "Browser-backed ChatGPT connection and relay routes." }),
  )
