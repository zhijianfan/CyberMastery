import { describe, expect, test } from "bun:test"
import { ChatProxyGroup, ChatProxyRequestError } from "@opencode-ai/protocol/groups/chat-proxy"
import { makeDefaultApi } from "@opencode-ai/protocol/api"
import { ChatProxy } from "@opencode-ai/schema/chat-proxy"
import { Schema } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"

class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware>()(
  "@opencode-ai/protocol/test/ChatProxyLocationMiddleware",
) {}

class SessionLocationMiddleware extends HttpApiMiddleware.Service<SessionLocationMiddleware>()(
  "@opencode-ai/protocol/test/ChatProxySessionLocationMiddleware",
) {}

const Api = makeDefaultApi({
  locationMiddleware: LocationMiddleware,
  sessionLocationMiddleware: SessionLocationMiddleware,
})

const decodeSuccess = (endpoint: keyof typeof ChatProxyGroup.endpoints, input: unknown) =>
  Schema.decodeUnknownSync([...ChatProxyGroup.endpoints[endpoint].success][0] as Schema.Decoder<unknown>)(input)

const decodePayload = (endpoint: keyof typeof ChatProxyGroup.endpoints, input: unknown) => {
  const payload = [...ChatProxyGroup.endpoints[endpoint].payload.values()][0]
  return Schema.decodeUnknownSync(payload.schemas[0] as Schema.Decoder<unknown>)(input)
}

describe("ChatProxy protocol", () => {
  test("mounts the browser relay endpoints under the public API", () => {
    expect(Api.groups["server.chatProxy"]).toBeDefined()
    expect(Object.keys(ChatProxyGroup.endpoints).sort()).toEqual(
      [
        "chatProxy.connect",
        "chatProxy.configure",
        "chatProxy.ensure",
        "chatProxy.open",
        "chatProxy.openRelay",
        "chatProxy.options",
        "chatProxy.prompt",
        "chatProxy.relay",
        "chatProxy.reset",
        "chatProxy.status",
      ].sort(),
    )
    expect(ChatProxyGroup.endpoints["chatProxy.status"].path).toBe("/api/chat-proxy")
    expect(ChatProxyGroup.endpoints["chatProxy.connect"].path).toBe("/api/chat-proxy/connect")
    expect(ChatProxyGroup.endpoints["chatProxy.open"].path).toBe("/api/chat-proxy/open")
    expect(ChatProxyGroup.endpoints["chatProxy.relay"].path).toBe(
      "/api/workspace/:workspaceID/chat-relay/:blockID/browser",
    )
    expect(ChatProxyGroup.endpoints["chatProxy.ensure"].path).toEndWith("/browser/ensure")
    expect(ChatProxyGroup.endpoints["chatProxy.reset"].path).toEndWith("/browser/reset")
    expect(ChatProxyGroup.endpoints["chatProxy.prompt"].path).toEndWith("/browser/prompt")
    expect(ChatProxyGroup.endpoints["chatProxy.openRelay"].path).toEndWith("/browser/open")
    expect(ChatProxyGroup.endpoints["chatProxy.options"].path).toEndWith("/browser/options")
    expect(ChatProxyGroup.endpoints["chatProxy.configure"].path).toEndWith("/browser/configure")
  })

  test("decodes provider and per-block relay projections", () => {
    expect(
      decodeSuccess("chatProxy.status", {
        id: "chatgpt",
        name: "ChatGPT",
        status: "ready",
      }),
    ).toEqual({ id: "chatgpt", name: "ChatGPT", status: "ready" })
    expect(
      decodeSuccess("chatProxy.relay", {
        providerID: "chatgpt",
        workspaceID: "wrk_proxy",
        blockID: "relay-a",
        tabID: "tab-a",
        status: "thinking",
        messages: [
          { id: "msg-user", role: "user", text: "Hello", createdAt: 1 },
          { id: "msg-assistant", role: "assistant", text: "Hi", createdAt: 2 },
        ],
        url: "https://chatgpt.com/c/example",
        controls: {
          model: {
            value: "gpt-5",
            label: "GPT-5",
            options: [
              { id: "gpt-5", label: "GPT-5" },
              { id: "gpt-4o", label: "GPT-4o", disabled: true },
            ],
          },
          effort: {
            value: "high",
            label: "High",
            options: [{ id: "high", label: "High" }],
          },
        },
      }),
    ).toMatchObject({
      workspaceID: "wrk_proxy",
      blockID: "relay-a",
      tabID: "tab-a",
      status: "thinking",
      controls: {
        model: { value: "gpt-5", options: [{ id: "gpt-5" }, { id: "gpt-4o", disabled: true }] },
        effort: { value: "high", options: [{ id: "high" }] },
      },
    })
    expect(() =>
      Schema.decodeUnknownSync(ChatProxy.Message)({ id: "msg-error", role: "error", text: "no", createdAt: 1 }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ChatProxy.Relay)({
        providerID: "chatgpt",
        workspaceID: "wrk_proxy",
        blockID: "relay-a",
        status: "unknown",
        messages: [],
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ChatProxy.Selection)({
        options: [{ id: "gpt-5", label: "GPT-5", disabled: "yes" }],
      }),
    ).toThrow()
  })

  test("accepts only the scoped reset, prompt, and open payloads", () => {
    expect(decodePayload("chatProxy.reset", {})).toEqual({})
    expect(decodePayload("chatProxy.reset", { tabID: "tab-a" })).toEqual({ tabID: "tab-a" })
    expect(decodePayload("chatProxy.prompt", { tabID: "tab-a", messageID: "msg-a", text: "Send this" })).toEqual({
      tabID: "tab-a",
      messageID: "msg-a",
      text: "Send this",
    })
    expect(
      decodePayload("chatProxy.prompt", {
        tabID: "tab-a",
        messageID: "msg-context",
        text: "",
        contextAttachments: [
          {
            contextCapsuleID: "cap-a",
            label: "Release notes",
            contentHash: "sha256-a",
            source: { kind: "ctxpack", ctxPackID: "ctx-a" },
          },
        ],
      }),
    ).toEqual({
      tabID: "tab-a",
      messageID: "msg-context",
      text: "",
      contextAttachments: [
        {
          contextCapsuleID: "cap-a",
          label: "Release notes",
          contentHash: "sha256-a",
          source: { kind: "ctxpack", ctxPackID: "ctx-a" },
        },
      ],
    })
    expect(decodePayload("chatProxy.openRelay", { tabID: "tab-a" })).toEqual({ tabID: "tab-a" })
    expect(decodePayload("chatProxy.options", { tabID: "tab-a" })).toEqual({ tabID: "tab-a" })
    expect(decodePayload("chatProxy.configure", { tabID: "tab-a", model: "gpt-5", effort: "high" })).toEqual({
      tabID: "tab-a",
      model: "gpt-5",
      effort: "high",
    })
    expect(decodePayload("chatProxy.configure", { tabID: "tab-a" })).toEqual({ tabID: "tab-a" })
    expect(() => decodePayload("chatProxy.prompt", { tabID: "tab-a", text: "missing id" })).toThrow()
    expect(() => decodePayload("chatProxy.configure", { model: "gpt-5" })).toThrow()
  })

  test("exposes a typed conflict for browser worker request failures", () => {
    const errors = ChatProxyGroup.endpoints["chatProxy.prompt"].error
    expect([...errors].some((schema) => schema.ast.annotations?.identifier === "ChatProxyRequestError")).toBe(true)
    expect(ChatProxyRequestError).toBeDefined()
  })
})
