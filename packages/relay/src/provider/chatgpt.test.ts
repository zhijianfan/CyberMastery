import { describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { CHATGPT_HOME_URL, createChatGPTProvider } from "./chatgpt.js"
import type { ChatCredentials, FetchLike } from "./oauth.js"
import { parseEventStream } from "./sse.js"

const NOW = 1_700_000_000_000
const API_BASE = "https://chatgpt.com/backend-api"

const credentials: ChatCredentials = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: NOW + 3600_000,
  accountId: "acc-1",
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

function stalledResponse(signal: AbortSignal | undefined): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => {
        controller.error(new DOMException("The operation was aborted.", "AbortError"))
      })
    },
  })
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

function event(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

const assistantEvent = event({
  message: {
    id: "msg-1",
    author: { role: "assistant" },
    content: { content_type: "text", parts: ["Hello ", "world"] },
    status: "finished_successfully",
  },
  conversation_id: "conv-1",
  message_id: "msg-1",
})

const doneChunk = "data: [DONE]\n\n"

describe("parseEventStream", () => {
  test("joins multi-line data fields and ignores other lines", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: message\ndata: first\ndata: second\n\ndata: third\n\n"))
        controller.close()
      },
    })
    const events: string[] = []
    for await (const data of parseEventStream(body)) events.push(data)
    expect(events).toEqual(["first\nsecond", "third"])
  })
})

describe("createChatGPTProvider credentials", () => {
  test("round-trips stored credentials and ignores corrupt files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-cred-"))
    const file = path.join(dir, "credentials.json")
    try {
      const provider = createChatGPTProvider({ credentialsPath: file, apiBase: API_BASE })
      expect(await provider.restoreCredentials()).toBeUndefined()
      await provider.saveCredentials(credentials)
      expect(await provider.restoreCredentials()).toEqual(credentials)

      await fs.writeFile(file, "{not json")
      expect(await provider.restoreCredentials()).toBeUndefined()

      await provider.clearCredentials()
      expect(await provider.restoreCredentials()).toBeUndefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("createChatGPTProvider chat", () => {
  test("sends through the conversation API and captures the SSE reply", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchFn: FetchLike = async (input, init) => {
      calls.push({ url: String(input), init: init as RequestInit })
      return sseResponse([assistantEvent, doneChunk])
    }
    const provider = createChatGPTProvider({ credentialsPath: "unused", apiBase: API_BASE, fetchFn, now: () => NOW })
    const chat = await provider.openChat({ credentials, onRefresh: async (current) => current })

    let text = ""
    for await (const delta of chat.send("hello")) text += delta

    expect(text).toBe("Hello world")
    expect(chat.conversationId).toBe("conv-1")
    expect(chat.parentMessageId).toBe("msg-1")
    expect(chat.url).toBe(`${CHATGPT_HOME_URL}/c/conv-1`)
    const turn = chat.turn()
    expect(turn?.role).toBe("assistant")
    expect(turn?.text).toBe("Hello world")
    expect(turn?.finishedAt).not.toBeNull()

    const request = calls[0]!
    expect(request.url).toBe(`${API_BASE}/conversation`)
    const headers = request.init.headers as Record<string, string>
    expect(headers["Authorization"]).toBe("Bearer access-token")
    expect(headers["ChatGPT-Account-Id"]).toBe("acc-1")
    const body = JSON.parse(String(request.init.body)) as Record<string, unknown>
    expect(body["action"]).toBe("next")
    expect(body["model"]).toBe("auto")
    expect(body["messages"]).toEqual([
      { id: expect.any(String), author: { role: "user" }, content: { content_type: "text", parts: ["hello"] } },
    ])
  })

  test("continues a stored conversation and threads the parent message", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchFn: FetchLike = async (input, init) => {
      calls.push({ url: String(input), init: init as RequestInit })
      return sseResponse([assistantEvent, doneChunk])
    }
    const provider = createChatGPTProvider({ credentialsPath: "unused", apiBase: API_BASE, fetchFn, now: () => NOW })
    const chat = await provider.openChat({
      credentials,
      onRefresh: async (current) => current,
      context: { conversationId: "conv-9", parentMessageId: "msg-0" },
    })
    for await (const delta of chat.send("next")) void delta

    const request = calls[0]!
    expect(request.url).toBe(`${API_BASE}/conversation/conv-9`)
    const body = JSON.parse(String(request.init.body)) as Record<string, unknown>
    expect(body["conversation_id"]).toBe("conv-9")
    expect(body["parent_message_id"]).toBe("msg-0")
  })

  test("refreshes the token once on an unauthorized response", async () => {
    let attempt = 0
    let refreshedToken = ""
    const fetchFn: FetchLike = async (_input, init) => {
      attempt++
      if (attempt === 1) return new Response("", { status: 401 })
      refreshedToken = ((init as RequestInit).headers as Record<string, string>)["Authorization"]
      return sseResponse([assistantEvent, doneChunk])
    }
    const provider = createChatGPTProvider({ credentialsPath: "unused", apiBase: API_BASE, fetchFn, now: () => NOW })
    const chat = await provider.openChat({
      credentials,
      onRefresh: async (current) => ({ ...current, accessToken: "fresh-token" }),
    })
    for await (const delta of chat.send("hello")) void delta
    expect(attempt).toBe(2)
    expect(refreshedToken).toBe("Bearer fresh-token")
  })

  test("throws on a non-ok response the refresh cannot fix", async () => {
    const fetchFn: FetchLike = async () => new Response("", { status: 500 })
    const provider = createChatGPTProvider({ credentialsPath: "unused", apiBase: API_BASE, fetchFn, now: () => NOW })
    const chat = await provider.openChat({ credentials, onRefresh: async (current) => current })
    await expect(
      (async () => {
        for await (const delta of chat.send("hello")) void delta
      })(),
    ).rejects.toThrow("conversation request failed: 500")
  })

  test("records an incomplete turn when the stream stalls past the timeout", async () => {
    const fetchFn: FetchLike = async (_input, init) =>
      stalledResponse((init as RequestInit).signal as AbortSignal | undefined)
    const provider = createChatGPTProvider({
      credentialsPath: "unused",
      apiBase: API_BASE,
      fetchFn,
      now: () => NOW,
      sendTimeoutMs: 50,
    })
    const chat = await provider.openChat({ credentials, onRefresh: async (current) => current })
    for await (const delta of chat.send("hello")) void delta
    const turn = chat.turn()
    expect(turn?.text).toBe("")
    expect(turn?.finishedAt).toBeNull()
  })

  test("identifies as the chatgpt provider", () => {
    const provider = createChatGPTProvider({ credentialsPath: "unused", apiBase: API_BASE })
    expect(provider.id).toBe("chatgpt")
    expect(provider.homeUrl).toBe(CHATGPT_HOME_URL)
  })
})
