import { describe, expect, test } from "bun:test"
import type { BlockRuntimeServices, CanvasBlockDescriptor } from "../../runtime/contracts"
import { ChatRelayRuntimeAdapter, type ChatRelay } from "./runtime"
import type { ServerScope } from "@/utils/server-scope"
import type { PromptInputV2PersistedState } from "@opencode-ai/session-ui/v2/prompt-input"

const block: CanvasBlockDescriptor = {
  id: "block-1",
  functionalityID: "builtin:chat-relay",
  transform: { x: 1, y: 2, w: 3, h: 4, z: 5 },
}

const relay = (status: ChatRelay["status"] = "idle", tabID = "tab-1"): ChatRelay => ({
  providerID: "chatgpt",
  workspaceID: "wrk_test",
  blockID: block.id,
  tabID,
  status,
  messages: [],
})

const relayWithControls = (model = "gpt-5", effort = "auto") =>
  ({
    ...relay(),
    controls: {
      model: {
        value: model,
        label: model === "gpt-5" ? "GPT-5" : "GPT-4o",
        options: [
          { id: "gpt-5", label: "GPT-5" },
          { id: "gpt-4o", label: "GPT-4o" },
        ],
      },
      effort: {
        value: effort,
        label: effort === "auto" ? "Auto" : "High",
        options: [
          { id: "auto", label: "Auto" },
          { id: "high", label: "High" },
        ],
      },
    },
  }) as ChatRelay

const draft = (text: string): PromptInputV2PersistedState => ({
  prompt: [{ type: "text", content: text, start: 0, end: text.length }],
  context: { items: [] },
})

function setup(input?: { promptError?: Error }) {
  const stored = new Map<string, unknown>()
  const calls: Array<{ method: string; input?: unknown; signal?: AbortSignal }> = []
  const response = (method: string, data: ChatRelay) => (value?: unknown, options?: { signal?: AbortSignal }) => {
    calls.push({ method, input: value, signal: options?.signal })
    return Promise.resolve({ data })
  }
  const api = {
    relay: response("relay", relay("thinking")),
    ensure: response("ensure", relay()),
    reset: response("reset", relay("idle", "tab-2")),
    openRelay: response("openRelay", relay()),
    options: response("options", relayWithControls()),
    configure: (value: unknown, options?: { signal?: AbortSignal }) => {
      calls.push({ method: "configure", input: value, signal: options?.signal })
      const payload = value as { chatProxyConfigurePayload?: { model?: string; effort?: string } }
      return Promise.resolve({
        data: relayWithControls(
          payload.chatProxyConfigurePayload?.model ?? "gpt-5",
          payload.chatProxyConfigurePayload?.effort ?? "auto",
        ),
      })
    },
    prompt: (value: unknown, options?: { signal?: AbortSignal }) => {
      calls.push({ method: "prompt", input: value, signal: options?.signal })
      if (input?.promptError) return Promise.reject(input.promptError)
      return Promise.resolve({
        data: {
          ...relay("thinking"),
          messages: [{ id: "msg-1", role: "user", text: "hello", createdAt: 1 }],
        } as ChatRelay,
      })
    },
  }
  let descriptorWaits = 0
  const services = {
    serverSDK: () => ({ client: { v2: { chatProxy: api } } }),
    eventRouter: { on: () => () => {}, off: () => {}, onReconnect: () => () => {} },
    workspace: {
      id: () => "wrk_test",
      epoch: () => 0,
      connected: () => true,
      awaitDescriptorPersisted: async () => {
        descriptorWaits += 1
      },
    },
    localView: {
      read: <T>(key: string) => stored.get(key) as T | undefined,
      write: <T>(key: string, value: T) => stored.set(key, value),
      delete: (key: string) => stored.delete(key),
      clearAll: () => stored.clear(),
    },
  } as unknown as BlockRuntimeServices
  return { api, calls, services, stored, descriptorWaits: () => descriptorWaits }
}

describe("ChatRelayRuntimeAdapter", () => {
  test.each(["tab", "server", "abort"])("ignores a prompt acknowledgment after the %s changes", async (change) => {
    const fixture = setup()
    const controller = new AbortController()
    let scope = "server-a" as ServerScope
    const services = { ...fixture.services, serverSDK: () => ({ ...fixture.services.serverSDK(), scope }) }
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "wrk_test",
      block,
      services,
      signal: controller.signal,
    })
    resolved.draft = draft("Keep this draft")
    let finish!: () => void
    const prompt = fixture.api.prompt
    fixture.api.prompt = async (...input) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return prompt(...input)
    }
    const pending = ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "prompt", messageID: "late-message", text: "Keep this draft", draftRevision: 0 },
      services,
      signal: controller.signal,
    })
    if (change === "tab") resolved.relay = relay("idle", "tab-2")
    if (change === "server") scope = "server-b" as ServerScope
    if (change === "abort") controller.abort()
    const current = resolved.relay
    finish()
    await pending
    expect(resolved.relay).toBe(current)
    expect(resolved.draft).toEqual(draft("Keep this draft"))
    expect(fixture.stored.size).toBe(0)
  })

  test("forwards CtxPack-only messages through the owned browser tab", async () => {
    const fixture = setup()
    const signal = new AbortController().signal
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "wrk_test",
      block,
      services: fixture.services,
      signal,
    })
    const contextAttachments = [
      {
        contextCapsuleID: "capsule-1",
        label: "Reference",
        contentHash: "hash-1",
        source: { kind: "ctxpack" as const, ctxPackID: "pack-1" },
      },
    ]
    await ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "prompt", messageID: "ctx-message-1", text: "", draftRevision: 0, contextAttachments },
      services: fixture.services,
      signal,
    })
    expect(fixture.calls.at(-1)).toEqual({
      method: "prompt",
      input: {
        workspaceID: "wrk_test",
        blockID: block.id,
        chatProxyPromptPayload: { tabID: "tab-1", messageID: "ctx-message-1", text: "", contextAttachments },
      },
      signal,
    })
  })

  test("waits for persistence and reads the backend-owned tab without ensuring from the client", async () => {
    const fixture = setup()
    const storageKey = JSON.stringify(["chat-relay", "wrk_test", block.id])
    fixture.stored.set(storageKey, { draft: "saved message" })
    const signal = new AbortController().signal
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "wrk_test",
      block,
      services: fixture.services,
      signal,
    })

    expect(ChatRelayRuntimeAdapter.mode).toBe("native")
    expect(fixture.descriptorWaits()).toBe(1)
    expect(fixture.calls).toEqual([{ method: "relay", input: { workspaceID: "wrk_test", blockID: block.id }, signal }])
    expect(resolved).toEqual({
      storageKey,
      workspaceID: "wrk_test",
      blockID: block.id,
      draft: draft("saved message"),
      draftRevision: 0,
      relay: relay("thinking"),
    })
  })

  test("persists structured drafts with their revision", async () => {
    const fixture = setup()
    const signal = new AbortController().signal
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "wrk_test",
      block,
      services: fixture.services,
      signal,
    })
    const next = draft("before @review after")

    await ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "set-draft", draft: next, revision: 3 },
      services: fixture.services,
      signal,
    })

    expect(resolved.draft).toEqual(next)
    expect(resolved.draftRevision).toBe(3)
    expect(fixture.stored.get(resolved.storageKey)).toEqual({ draft: next, revision: 3 })
  })

  test("refreshes relay state without ensuring another tab", async () => {
    const fixture = setup()
    const signal = new AbortController().signal
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "wrk_test",
      block,
      services: fixture.services,
      signal,
    })
    await ChatRelayRuntimeAdapter.refresh?.({ resolved, services: fixture.services, signal })

    expect(resolved.relay.status).toBe("thinking")
    expect(fixture.calls.map((call) => call.method)).toEqual(["relay", "relay"])
  })

  test("lets the backend acquire a tab after shared website sign-in becomes available", async () => {
    const fixture = setup()
    const signal = new AbortController().signal
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "wrk_test",
      block,
      services: fixture.services,
      signal,
    })
    resolved.relay = { ...relay("disconnected"), tabID: undefined }
    await ChatRelayRuntimeAdapter.refresh?.({ resolved, services: fixture.services, signal })

    expect(fixture.calls.map((call) => call.method)).toEqual(["relay", "relay"])
    expect(resolved.relay.tabID).toBe("tab-1")
  })

  test("does not let a late poll overwrite a reset tab", async () => {
    const fixture = setup()
    const pending = Promise.withResolvers<{ data: ChatRelay }>()
    const signal = new AbortController().signal
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "wrk_test",
      block,
      services: fixture.services,
      signal,
    })
    fixture.api.relay = () => pending.promise
    const refresh = ChatRelayRuntimeAdapter.refresh?.({ resolved, services: fixture.services, signal })
    await ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "reset" },
      services: fixture.services,
      signal,
    })
    pending.resolve({ data: relay("idle", "tab-1") })
    await refresh

    expect(resolved.relay.tabID).toBe("tab-2")
  })

  test("forwards selected skill identities and clears only the acknowledged draft revision", async () => {
    const fixture = setup()
    const signal = new AbortController().signal
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "wrk_test",
      block,
      services: fixture.services,
      signal,
    })
    resolved.draft = draft("hello")
    resolved.draftRevision = 4

    await ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: {
        type: "prompt",
        messageID: "msg-1",
        text: "hello",
        draftRevision: 4,
        skills: [{ name: "review", contentHash: "skill-hash" }],
      },
      services: fixture.services,
      signal,
    })

    expect(fixture.calls.at(-1)).toEqual({
      method: "prompt",
      input: {
        workspaceID: "wrk_test",
        blockID: block.id,
        chatProxyPromptPayload: {
          tabID: "tab-1",
          messageID: "msg-1",
          text: "hello",
          skills: [{ name: "review", contentHash: "skill-hash" }],
        },
      },
      signal,
    })
    expect(resolved.draft).toEqual(draft(""))
    expect(resolved.draftRevision).toBe(5)
    expect(fixture.stored.get(JSON.stringify(["chat-relay", "wrk_test", block.id]))).toEqual({
      draft: draft(""),
      revision: 5,
    })
  })

  test("retains the draft and message identity when prompt acknowledgement fails", async () => {
    const fixture = setup({ promptError: new Error("connection lost") })
    const signal = new AbortController().signal
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "wrk_test",
      block,
      services: fixture.services,
      signal,
    })
    resolved.draft = draft("retry me")
    resolved.draftRevision = 2
    fixture.stored.set(resolved.storageKey, { draft: draft("retry me"), revision: 2 })

    await expect(
      ChatRelayRuntimeAdapter.dispatch?.({
        resolved,
        command: { type: "prompt", messageID: "stable-id", text: "retry me", draftRevision: 2 },
        services: fixture.services,
        signal,
      }),
    ).rejects.toThrow("connection lost")
    expect(resolved.draft).toEqual(draft("retry me"))
    expect(fixture.stored.get(resolved.storageKey)).toEqual({ draft: draft("retry me"), revision: 2 })
  })

  test("does not erase a newer edit when an earlier prompt is acknowledged", async () => {
    const fixture = setup()
    const pending = Promise.withResolvers<{ data: ChatRelay }>()
    fixture.api.prompt = () => pending.promise
    const signal = new AbortController().signal
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "wrk_test",
      block,
      services: fixture.services,
      signal,
    })
    resolved.draft = draft("send this")
    resolved.draftRevision = 8
    const prompt = ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "prompt", messageID: "msg-1", text: "send this", draftRevision: 8 },
      services: fixture.services,
      signal,
    })
    resolved.draft = draft("newer edit")
    resolved.draftRevision = 9
    fixture.stored.set(resolved.storageKey, { draft: draft("newer edit"), revision: 9 })
    pending.resolve({
      data: {
        providerID: "chatgpt",
        workspaceID: "wrk_test",
        blockID: block.id,
        tabID: "tab-1",
        status: "thinking",
        messages: [],
      },
    })
    await prompt

    expect(resolved.draft).toEqual(draft("newer edit"))
    expect(fixture.stored.get(resolved.storageKey)).toEqual({ draft: draft("newer edit"), revision: 9 })
  })

  test("clears an acknowledged draft after a cursor-only update", async () => {
    const fixture = setup()
    const pending = Promise.withResolvers<{ data: ChatRelay }>()
    fixture.api.prompt = () => pending.promise
    const signal = new AbortController().signal
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "wrk_test",
      block,
      services: fixture.services,
      signal,
    })
    resolved.draft = draft("send this")
    resolved.draftRevision = 8
    const prompt = ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "prompt", messageID: "msg-1", text: "send this", draftRevision: 8 },
      services: fixture.services,
      signal,
    })
    await ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "set-draft", draft: { ...draft("send this"), cursor: 0 }, revision: 8 },
      services: fixture.services,
      signal,
    })
    pending.resolve({ data: relay("thinking") })
    await prompt

    expect(resolved.draft).toEqual(draft(""))
    expect(resolved.draftRevision).toBe(9)
  })

  test("resets to a fresh tab and opens only the currently owned tab", async () => {
    const fixture = setup()
    const signal = new AbortController().signal
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "wrk_test",
      block,
      services: fixture.services,
      signal,
    })
    await ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "reset" },
      services: fixture.services,
      signal,
    })
    await ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "open-relay" },
      services: fixture.services,
      signal,
    })

    expect(fixture.calls.slice(-2).map((call) => call.input)).toEqual([
      { workspaceID: "wrk_test", blockID: block.id, chatProxyResetPayload: { tabID: "tab-1" } },
      { workspaceID: "wrk_test", blockID: block.id, chatProxyOpenRelayPayload: { tabID: "tab-2" } },
    ])
  })

  test("ignores an open-tab response after another client rotates the owner", async () => {
    const fixture = setup()
    const pending = Promise.withResolvers<{ data: ChatRelay }>()
    fixture.api.openRelay = () => pending.promise
    const signal = new AbortController().signal
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "wrk_test",
      block,
      services: fixture.services,
      signal,
    })

    const opening = ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "open-relay" },
      services: fixture.services,
      signal,
    })
    const current = relay("idle", "tab-2")
    resolved.relay = current
    pending.resolve({ data: relay("idle", "tab-1") })
    await opening

    expect(resolved.relay).toBe(current)
  })

  test("ignores a reset response after another client rotates the owner", async () => {
    const fixture = setup()
    const pending = Promise.withResolvers<{ data: ChatRelay }>()
    fixture.api.reset = () => pending.promise
    const signal = new AbortController().signal
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "wrk_test",
      block,
      services: fixture.services,
      signal,
    })

    const resetting = ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "reset" },
      services: fixture.services,
      signal,
    })
    const current = relay("idle", "tab-3")
    resolved.relay = current
    pending.resolve({ data: relay("idle", "tab-2") })
    await resetting

    expect(resolved.relay).toBe(current)
  })

  test("loads webpage-derived choices and configures only the owned tab", async () => {
    const fixture = setup()
    const signal = new AbortController().signal
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "wrk_test",
      block,
      services: fixture.services,
      signal,
    })

    await ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "refresh-options" },
      services: fixture.services,
      signal,
    })
    await ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "configure", model: "gpt-4o" },
      services: fixture.services,
      signal,
    })
    await ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "configure", effort: "high" },
      services: fixture.services,
      signal,
    })

    expect(fixture.calls.slice(-3)).toEqual([
      {
        method: "options",
        input: {
          workspaceID: "wrk_test",
          blockID: block.id,
          chatProxyOptionsPayload: { tabID: "tab-1" },
        },
        signal,
      },
      {
        method: "configure",
        input: {
          workspaceID: "wrk_test",
          blockID: block.id,
          chatProxyConfigurePayload: { tabID: "tab-1", model: "gpt-4o" },
        },
        signal,
      },
      {
        method: "configure",
        input: {
          workspaceID: "wrk_test",
          blockID: block.id,
          chatProxyConfigurePayload: { tabID: "tab-1", effort: "high" },
        },
        signal,
      },
    ])
    expect(resolved.relay).toEqual(relayWithControls("gpt-5", "high"))
  })
})
