import { describe, expect, test } from "bun:test"
import { ChatGPTRouter, createChatSessionContext, isLoggedIn, type ChatSessionContext } from "./chatgpt-router.js"

function fakePage(loggedIn: boolean) {
  return {
    getByRole: (role: string) => ({
      count: async () => (role === "textbox" && loggedIn ? 1 : 0),
    }),
  }
}

describe("createChatSessionContext", () => {
  test("appends relayed messages with stable per-session ids", () => {
    const store = createChatSessionContext("conv-1", "https://chatgpt.com/c/conv-1")
    const first = store.append({ role: "user", text: "hello", at: 100 })
    const second = store.append({ role: "assistant", text: "hi", at: 200 })
    expect(store.conversationId).toBe("conv-1")
    expect(store.messages).toHaveLength(2)
    expect(first.id).toBe("conv-1-1")
    expect(second.id).toBe("conv-1-2")
    expect(store.messages[0]?.text).toBe("hello")
  })

  test("keeps each chat session's context separate", () => {
    const a = createChatSessionContext("a", "https://chatgpt.com/c/a")
    const b = createChatSessionContext("b", "https://chatgpt.com/c/b")
    a.append({ role: "user", text: "only in a" })
    expect(a.messages).toHaveLength(1)
    expect(b.messages).toHaveLength(0)
  })
})

describe("isLoggedIn", () => {
  test("detects the composer when a login is present", async () => {
    expect(await isLoggedIn(fakePage(true))).toBe(true)
  })

  test("reports missing login when no composer exists", async () => {
    expect(await isLoggedIn(fakePage(false))).toBe(false)
  })
})

describe("ChatGPTRouter", () => {
  test("refuses to route until initialized with a ChatGPT login", async () => {
    const router = new ChatGPTRouter({ profile: { profileDir: "unused" } })
    expect(router.isInitialized()).toBe(false)
    await expect(router.submit("hello")).rejects.toThrow("cannot route until initialized")
  })

  test("starts uninitialized and exposes no session context", () => {
    const router = new ChatGPTRouter({ profile: { profileDir: "unused" } })
    expect(router.status()).toBe("uninitialized")
    expect(router.sessionContext()).toBeUndefined()
  })

  test("relays stored messages to the operating agent relay", async () => {
    const store: ChatSessionContext = createChatSessionContext("conv-1", "https://chatgpt.com/c/conv-1")
    const relayed: string[] = []
    const user = store.append({ role: "user", text: "hello" })
    const assistant = store.append({ role: "assistant", text: "hi" })
    for (const message of [user, assistant]) relayed.push(`${message.role}: ${message.text}`)
    expect(relayed).toEqual(["user: hello", "assistant: hi"])
  })
})
