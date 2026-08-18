import { describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
  ChatRelay,
  createChatSessionContext,
  loadStoredSession,
  saveStoredSession,
} from "./chat-relay.js"
import type { ChatCredentials, DeviceLogin, LoginPollResult } from "./oauth.js"
import type { ChatProvider } from "./provider.js"
import type { ChatSession, Turn } from "./types.js"

const NOW = 1_700_000_000_000

const credentials: ChatCredentials = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: NOW + 3600_000,
  accountId: "acc-1",
}

interface FakeState {
  stored: ChatCredentials | undefined
  saved: ChatCredentials | undefined
  refreshCalls: number
  cleared: boolean
  loginRequests: number
  loginResult: () => Promise<LoginPollResult>
}

function fakeState(loginResult?: () => Promise<LoginPollResult>): FakeState {
  return {
    stored: undefined,
    saved: undefined,
    refreshCalls: 0,
    cleared: false,
    loginRequests: 0,
    loginResult: loginResult ?? (async () => ({ type: "pending" as const })),
  }
}

function fakeProvider(state: FakeState): ChatProvider {
  return {
    id: "fake",
    homeUrl: "https://fake.example.com",
    restoreCredentials: async () => state.stored,
    saveCredentials: async (value) => {
      state.saved = value
    },
    clearCredentials: async () => {
      state.cleared = true
      state.stored = undefined
    },
    refreshCredentials: async (current) => {
      state.refreshCalls++
      return { ...current, accessToken: "refreshed-token", expiresAt: NOW + 7200_000 }
    },
    startLogin: async (): Promise<DeviceLogin> => {
      state.loginRequests++
      return {
        verificationUrl: "https://auth.example.com/codex/device",
        userCode: "CODE-1",
        pollIntervalMs: 5000,
        poll: () => state.loginResult(),
      }
    },
    openChat: async ({ context }) => fakeChat(context),
  }
}

function fakeChat(context?: { conversationId?: string; parentMessageId?: string }, fail = false): ChatSession {
  let conversationId = context?.conversationId
  let parentMessageId = context?.parentMessageId
  let lastTurn: Turn | undefined
  return {
    get conversationId() {
      return conversationId
    },
    get parentMessageId() {
      return parentMessageId
    },
    get url() {
      return conversationId ? `https://fake.example.com/c/${conversationId}` : "https://fake.example.com"
    },
    send: async function* (prompt: string) {
      if (fail) throw new Error("send failed")
      yield `reply: ${prompt}`
      conversationId = "conv-fake"
      parentMessageId = "msg-fake"
      lastTurn = { role: "assistant", text: `reply: ${prompt}`, files: [], startedAt: NOW, finishedAt: NOW + 10 }
    },
    turn: () => lastTurn,
    dispose: async () => {},
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time")
    await sleep(10)
  }
}

function tempSessionFile(): Promise<{ dir: string; file: string }> {
  return fs.mkdtemp(path.join(os.tmpdir(), "chat-relay-")).then((dir) => ({ dir, file: path.join(dir, "session.json") }))
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

  test("sync adopts the provider's conversation identity", () => {
    const store = createChatSessionContext("c-temp", "https://chat.example.com")
    store.sync("conv-real", "https://chat.example.com/c/conv-real", "msg-5")
    expect(store.conversationId).toBe("conv-real")
    expect(store.url).toBe("https://chat.example.com/c/conv-real")
    expect(store.parentMessageId).toBe("msg-5")
  })
})

describe("session persistence", () => {
  test("round-trips the stored chat session including the parent message", async () => {
    const { dir, file } = await tempSessionFile()
    try {
      const store = createChatSessionContext("conv-persist", "https://chat.example.com/c/conv-persist")
      store.sync("conv-persist", "https://chat.example.com/c/conv-persist", "msg-9")
      store.append({ role: "user", text: "persisted question", at: 100 })
      store.append({ role: "assistant", text: "persisted answer", at: 200 })
      await saveStoredSession(file, store)

      const stored = await loadStoredSession(file)
      expect(stored?.conversationId).toBe("conv-persist")
      expect(stored?.parentMessageId).toBe("msg-9")
      expect(stored?.messages).toHaveLength(2)
      expect(stored?.messages[0]?.text).toBe("persisted question")
      expect(stored?.messages[1]?.text).toBe("persisted answer")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("returns undefined for a missing or corrupt session file", async () => {
    const { dir } = await tempSessionFile()
    try {
      expect(await loadStoredSession(path.join(dir, "missing.json"))).toBeUndefined()
      await fs.writeFile(path.join(dir, "corrupt.json"), "{not json")
      expect(await loadStoredSession(path.join(dir, "corrupt.json"))).toBeUndefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("ChatRelay", () => {
  test("refuses to route until authenticated with a chat account", async () => {
    const router = new ChatRelay({ provider: fakeProvider(fakeState()) })
    expect(router.isInitialized()).toBe(false)
    await expect(router.submit("hello")).rejects.toThrow("cannot route until authenticated")
  })

  test("starts uninitialized and exposes no session context or auth info", () => {
    const router = new ChatRelay({ provider: fakeProvider(fakeState()) })
    expect(router.status()).toBe("uninitialized")
    expect(router.sessionContext()).toBeUndefined()
    expect(router.authInfo()).toBeUndefined()
  })

  test("exposes the configured provider identity", () => {
    const router = new ChatRelay({ provider: fakeProvider(fakeState()) })
    expect(router.providerId).toBe("fake")
  })

  test("adopts fresh stored credentials without refreshing", async () => {
    const state = fakeState()
    state.stored = credentials
    const router = new ChatRelay({ provider: fakeProvider(state), loginPollDelayMs: 5 })
    expect(await router.initialize()).toBe("ready")
    expect(state.refreshCalls).toBe(0)
    expect(state.loginRequests).toBe(0)
    expect(router.sessionContext()).toBeDefined()
  })

  test("refreshes expired stored credentials and clears them when the refresh fails", async () => {
    const state = fakeState()
    state.stored = { ...credentials, expiresAt: NOW - 1000 }
    const router = new ChatRelay({ provider: fakeProvider(state), now: () => NOW, loginPollDelayMs: 5 })
    expect(await router.initialize()).toBe("ready")
    expect(state.refreshCalls).toBe(1)
    expect(state.saved?.accessToken).toBe("refreshed-token")
    await router.dispose()
  })

  test("clears unusable stored credentials and falls back to the login flow", async () => {
    const state = fakeState()
    state.stored = { ...credentials, expiresAt: NOW - 1000 }
    const provider = fakeProvider(state)
    provider.refreshCredentials = async () => {
      throw new Error("refresh rejected")
    }
    const router = new ChatRelay({ provider, now: () => NOW, loginPollDelayMs: 5 })
    expect(await router.initialize()).toBe("awaiting-login")
    expect(state.cleared).toBe(true)
    expect(state.loginRequests).toBe(1)
    await router.dispose()
  })

  test("surfaces the verification url and code while authorization is pending", async () => {
    const state = fakeState()
    const router = new ChatRelay({ provider: fakeProvider(state), loginPollDelayMs: 5 })
    expect(await router.initialize()).toBe("awaiting-login")
    expect(router.authInfo()).toEqual({
      verificationUrl: "https://auth.example.com/codex/device",
      userCode: "CODE-1",
    })
    await router.dispose()
  })

  test("adopts the account when the login poll succeeds", async () => {
    const state = fakeState()
    const loginCredentials: ChatCredentials = {
      accessToken: "login-token",
      refreshToken: "login-refresh",
      expiresAt: NOW + 3600_000,
      accountId: "login-acc",
    }
    const router = new ChatRelay({ provider: fakeProvider(state), now: () => NOW, loginPollDelayMs: 5 })
    expect(await router.initialize()).toBe("awaiting-login")
    state.loginResult = async () => ({ type: "success", credentials: loginCredentials })
    await waitFor(() => router.status() === "ready")
    expect(state.saved).toEqual(loginCredentials)
    expect(router.authInfo()).toBeUndefined()
    await router.dispose()
  })

  test("reports missing-login when the login poll is denied", async () => {
    const state = fakeState(async () => ({ type: "denied" }))
    const router = new ChatRelay({ provider: fakeProvider(state), loginPollDelayMs: 5 })
    expect(await router.initialize()).toBe("awaiting-login")
    await waitFor(() => router.status() === "missing-login")
    expect(router.authInfo()).toBeUndefined()
  })

  test("reports missing-login when the login poll passes its deadline", async () => {
    const state = fakeState()
    const router = new ChatRelay({
      provider: fakeProvider(state),
      loginPollDelayMs: 5,
      loginDeadlineMs: 50,
      now: () => Date.now(),
    })
    expect(await router.initialize()).toBe("awaiting-login")
    await waitFor(() => router.status() === "missing-login")
  })

  test("relays the user message and the captured reply, and persists the session", async () => {
    const state = fakeState()
    state.stored = credentials
    const { dir, file } = await tempSessionFile()
    try {
      const relayed: string[] = []
      const router = new ChatRelay({
        provider: fakeProvider(state),
        sessionStorePath: file,
        relay: (message) => {
          relayed.push(`${message.role}: ${message.text}`)
        },
      })
      await router.initialize()

      const turn = await router.submit("hello")
      expect(turn.text).toBe("reply: hello")
      expect(turn.finishedAt).not.toBeNull()
      expect(relayed).toEqual(["user: hello", "assistant: reply: hello"])

      const store = router.sessionContext()
      expect(store?.messages).toHaveLength(2)
      expect(store?.conversationId).toBe("conv-fake")
      expect(store?.parentMessageId).toBe("msg-fake")

      const persisted = await loadStoredSession(file)
      expect(persisted?.messages).toHaveLength(2)
      expect(persisted?.conversationId).toBe("conv-fake")
      expect(persisted?.parentMessageId).toBe("msg-fake")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("rethrows a send failure that produced no content", async () => {
    const state = fakeState()
    state.stored = credentials
    const provider = fakeProvider(state)
    provider.openChat = async ({ context }) => fakeChat(context, true)
    const router = new ChatRelay({ provider, loginPollDelayMs: 5 })
    await router.initialize()
    await expect(router.submit("hello")).rejects.toThrow("send failed")
  })

  test("re-adopts the stored conversation on re-initialization", async () => {
    const state = fakeState()
    state.stored = credentials
    const { dir, file } = await tempSessionFile()
    try {
      const first = new ChatRelay({ provider: fakeProvider(state), sessionStorePath: file, loginPollDelayMs: 5 })
      await first.initialize()
      await first.submit("hello")
      await first.dispose()

      const second = new ChatRelay({ provider: fakeProvider(state), sessionStorePath: file, loginPollDelayMs: 5 })
      expect(await second.initialize()).toBe("ready")
      expect(second.sessionContext()?.messages).toHaveLength(2)
      await second.dispose()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("dispose resets the relay and stops a pending login poll", async () => {
    const state = fakeState()
    const router = new ChatRelay({ provider: fakeProvider(state), loginPollDelayMs: 5 })
    expect(await router.initialize()).toBe("awaiting-login")
    await router.dispose()
    expect(router.status()).toBe("uninitialized")
    await sleep(30)
    expect(state.loginRequests).toBe(1)
    expect(state.saved).toBeUndefined()
  })
})
