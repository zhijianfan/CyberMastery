import { describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { ChatGPTCrawler } from "./chatgpt.js"
import { ClaudeCrawler } from "./claude.js"
import { ChatRelay, createChatSessionContext, loadStoredSession, saveStoredSession, type ChatSessionContext } from "./chat-relay.js"
import type { ChatCrawler } from "./chat-crawler.js"

function fakePage(loggedIn: boolean) {
  return {
    getByRole: (role: string, options?: { name?: string | RegExp }) => ({
      count: async () => {
        if (role === "textbox") return loggedIn ? 1 : 0
        if (role === "button" && options?.name && /send/i.test(String(options.name))) return loggedIn ? 1 : 0
        return 0
      },
    }),
  }
}

const fakeCrawler: ChatCrawler = {
  id: "fake",
  homeUrl: "https://fake.example.com",
  isLoggedIn: (page) => page.getByRole("textbox").count().then((count) => count > 0),
  conversationIdFromURL: () => undefined,
  send: async () => {},
}

describe("createChatSessionContext", () => {
  test("appends relayed messages with stable per-session ids", () => {
    const store = createChatSessionContext("conv-1", "https://chat.example.com/c/conv-1")
    const first = store.append({ role: "user", text: "hello", at: 100 })
    const second = store.append({ role: "assistant", text: "hi", at: 200 })
    expect(store.conversationId).toBe("conv-1")
    expect(store.messages).toHaveLength(2)
    expect(first.id).toBe("conv-1-1")
    expect(second.id).toBe("conv-1-2")
    expect(store.messages[0]?.text).toBe("hello")
  })

  test("keeps each chat session's context separate", () => {
    const a = createChatSessionContext("a", "https://chat.example.com/c/a")
    const b = createChatSessionContext("b", "https://chat.example.com/c/b")
    a.append({ role: "user", text: "only in a" })
    expect(a.messages).toHaveLength(1)
    expect(b.messages).toHaveLength(0)
  })

  test("stores downloadable files alongside the assistant text", () => {
    const store = createChatSessionContext("conv-1", "https://chat.example.com/c/conv-1")
    const message = store.append({ role: "assistant", text: "here you go", files: [{ name: "a.csv", url: "https://x/a.csv" }] })
    expect(message.files).toEqual([{ name: "a.csv", url: "https://x/a.csv" }])
  })
})

describe("crawlers", () => {
  test("detect the composer when a login is present", async () => {
    expect(await ChatGPTCrawler.isLoggedIn(fakePage(true))).toBe(true)
    expect(await ClaudeCrawler.isLoggedIn(fakePage(true))).toBe(true)
  })

  test("report missing login when no composer exists", async () => {
    expect(await ChatGPTCrawler.isLoggedIn(fakePage(false))).toBe(false)
    expect(await ClaudeCrawler.isLoggedIn(fakePage(false))).toBe(false)
  })

  test("extract provider-specific conversation ids from URLs", () => {
    expect(ChatGPTCrawler.conversationIdFromURL("https://chatgpt.com/c/0a1b2c3d-4e5f-6789-abcd-ef0123456789")).toBe(
      "0a1b2c3d-4e5f-6789-abcd-ef0123456789",
    )
    expect(ChatGPTCrawler.conversationIdFromURL("https://chatgpt.com/")).toBeUndefined()
    expect(ClaudeCrawler.conversationIdFromURL("https://claude.ai/chat/0a1b2c3d-4e5f-6789-abcd-ef0123456789")).toBe(
      "0a1b2c3d-4e5f-6789-abcd-ef0123456789",
    )
    expect(ClaudeCrawler.conversationIdFromURL("https://claude.ai/new")).toBeUndefined()
  })

  test("identify their provider", () => {
    expect(ChatGPTCrawler.id).toBe("chatgpt")
    expect(ClaudeCrawler.id).toBe("claude")
  })
})

describe("ChatRelay", () => {
  test("refuses to route until initialized with a logged-in browser session", async () => {
    const router = new ChatRelay({ crawler: fakeCrawler, profile: { profileDir: "unused" } })
    expect(router.isInitialized()).toBe(false)
    await expect(router.submit("hello")).rejects.toThrow("cannot route until initialized")
  })

  test("starts uninitialized and exposes no session context", () => {
    const router = new ChatRelay({ crawler: fakeCrawler, profile: { profileDir: "unused" } })
    expect(router.status()).toBe("uninitialized")
    expect(router.sessionContext()).toBeUndefined()
  })

  test("exposes the configured crawler identity", () => {
    const router = new ChatRelay({ crawler: ChatGPTCrawler, profile: { profileDir: "unused" } })
    expect(router.crawlerId).toBe("chatgpt")
    const switched = new ChatRelay({ crawler: ClaudeCrawler, profile: { profileDir: "unused" } })
    expect(switched.crawlerId).toBe("claude")
  })

  test("relays stored messages to the operating agent relay", async () => {
    const store: ChatSessionContext = createChatSessionContext("conv-1", "https://chat.example.com/c/conv-1")
    const relayed: string[] = []
    const user = store.append({ role: "user", text: "hello" })
    const assistant = store.append({ role: "assistant", text: "hi" })
    for (const message of [user, assistant]) relayed.push(`${message.role}: ${message.text}`)
    expect(relayed).toEqual(["user: hello", "assistant: hi"])
  })
})

describe("session persistence", () => {
  test("round-trips the stored chat session across restarts", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chat-relay-"))
    const file = path.join(dir, "session.json")
    try {
      const store = createChatSessionContext("conv-persist", "https://chat.example.com/c/conv-persist")
      store.append({ role: "user", text: "persisted question", at: 100 })
      store.append({ role: "assistant", text: "persisted answer", at: 200 })
      await saveStoredSession(file, store)

      const stored = await loadStoredSession(file)
      expect(stored?.conversationId).toBe("conv-persist")
      expect(stored?.messages).toHaveLength(2)
      expect(stored?.messages[0]?.text).toBe("persisted question")
      expect(stored?.messages[1]?.text).toBe("persisted answer")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("returns undefined for a missing or corrupt session file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chat-relay-"))
    try {
      expect(await loadStoredSession(path.join(dir, "missing.json"))).toBeUndefined()
      await fs.writeFile(path.join(dir, "corrupt.json"), "{not json")
      expect(await loadStoredSession(path.join(dir, "corrupt.json"))).toBeUndefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
