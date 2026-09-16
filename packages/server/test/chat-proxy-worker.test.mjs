import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { createChatProxyWorker, startChatProxyWorkerServer } from "../src/chat-proxy-worker.mjs"

class FakeLocator {
  constructor(page, selector, index = 0, indexed = false) {
    this.page = page
    this.selector = selector
    this.index = index
    this.indexed = indexed
  }

  first() {
    return this
  }

  last() {
    return this
  }

  nth(index) {
    return new FakeLocator(this.page, this.selector, index, true)
  }

  locator(selector) {
    return new FakeLocator(this.page, `${this.selector} >> ${selector}`)
  }

  getByRole(role, options = {}) {
    return new FakeLocator(this.page, `${this.selector} >> role=${role}:${options.name ?? ""}`)
  }

  async waitFor(options = {}) {
    if (!this.selector.includes("role=group:")) return
    const name = this.selector.slice(this.selector.lastIndexOf(":") + 1)
    const acknowledgements = [...this.page.acknowledgedFiles, ...this.page.nonAttachmentGroups].filter(
      (item) => !name || item === name,
    )
    if (options.state === "detached") {
      if (acknowledgements.length > this.index) throw new Error("Attachment is still present")
      return
    }
    if (acknowledgements.length <= this.index)
      throw this.page.uploadError ?? new Error("Upload acknowledgement timed out")
    if (!this.indexed && acknowledgements.length > 1) throw new Error("strict mode violation")
    this.page.events.push(`ack:${name}`)
  }

  async isVisible() {
    if (this.selector === "login") return this.page.loginRequired
    if (this.selector === "challenge") return this.page.challengeRequired
    if (this.selector.includes("Stop generating") || this.selector.includes('main [role="alert"]')) return false
    if (this.selector.includes('[role="alert"]')) return Boolean(this.page.uploadAlert)
    return (
      this.selector.includes("composer") || this.selector.includes("prompt-textarea") || this.selector.includes("Send")
    )
  }

  async isEnabled() {
    if (this.selector.includes("Send")) {
      this.page.events.push("send-enabled")
      await this.page.onSendEnabled?.()
      return this.page.sendEnabled !== false
    }
    return true
  }

  async allTextContents() {
    return this.page.mode ? [this.page.mode] : []
  }

  async evaluateAll() {
    if (this.page.mode === "Work") return [{ href: "https://chatgpt.com/codex", marker: "work" }]
    return [{ href: "https://chatgpt.com/", marker: "chat" }]
  }

  async count() {
    if (this.selector.includes("data-message-author-role")) return this.page.sent ? 1 : 0
    if (this.selector.includes("data-conversation-transcript")) return this.page.sent ? 2 : 0
    if (this.selector.includes('input#upload-files[type="file"]')) return this.page.uploadInputCount
    if (this.selector.includes("role=group:")) {
      const name = this.selector.slice(this.selector.lastIndexOf(":") + 1)
      return [...this.page.acknowledgedFiles, ...this.page.nonAttachmentGroups].filter((item) => !name || item === name)
        .length
    }
    if (this.selector.includes("xpath=ancestor::form[1]")) return this.page.composerFormCount
    return 0
  }

  async innerText() {
    if (this.selector.includes("data-message-author-role") || this.selector.includes("data-conversation-transcript"))
      return this.page.reply
    return this.page.uploadAlert ?? ""
  }

  async fill(value) {
    this.page.filled = value
    this.page.events.push("fill")
  }

  async setInputFiles(files) {
    if (!files.length && this.page.clearError) throw this.page.clearError
    this.page.uploads = files
    this.page.events.push(files.length ? "upload" : "clear")
    if (!files.length) {
      if (!this.page.keepUploadChips) this.page.acknowledgedFiles = []
      return
    }
    if (!this.page.uploadError) this.page.acknowledgedFiles = files.map((file) => file.name)
    if (this.page.setInputFilesError) throw this.page.setInputFilesError
  }

  async evaluate(callback) {
    if (!this.selector.includes('input#upload-files[type="file"]')) return undefined
    return callback({ files: this.page.uploads.map((file) => ({ name: file.name })) })
  }

  async click() {
    if (!this.selector.includes("Send")) return
    this.page.events.push("send")
    await this.page.onSendClick?.()
    this.page.filesAtSend = this.page.uploads
    this.page.sent += 1
    if (this.page.sendError) throw this.page.sendError
  }
}

class FakePage {
  constructor() {
    this.currentURL = "about:blank"
    this.closed = false
    this.mode = "Chat"
    this.sent = 0
    this.reply = "partial regular ChatGPT reply"
    this.loginRequired = false
    this.challengeRequired = false
    this.events = []
    this.uploads = []
    this.acknowledgedFiles = []
    this.nonAttachmentGroups = []
    this.composerFormCount = 1
    this.uploadInputCount = 1
  }

  url() {
    return this.currentURL
  }

  isClosed() {
    return this.closed
  }

  locator(selector) {
    return new FakeLocator(this, selector)
  }

  getByRole() {
    return new FakeLocator(this, "login")
  }

  getByText() {
    return new FakeLocator(this, "challenge")
  }

  async goto(url) {
    this.currentURL = url
    return { status: () => 200 }
  }

  async bringToFront() {}

  async close() {
    if (this.closeError) throw this.closeError
    this.closed = true
  }
}

class FakeContext {
  constructor() {
    this.loginPage = new FakePage()
    this.created = []
    this.listeners = new Map()
  }

  pages() {
    return [this.loginPage]
  }

  async newPage() {
    const page = new FakePage()
    this.created.push(page)
    return page
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
  }

  async route() {}

  async close() {
    this.loginPage.closed = true
    this.created.forEach((page) => (page.closed = true))
    this.listeners.get("close")?.forEach((listener) => listener())
  }
}

class FakeChild {
  constructor(input) {
    this.input = input
    this.listeners = new Map()
  }

  once(event, listener) {
    this.listeners.set(event, listener)
  }

  exit() {
    this.listeners.get("exit")?.()
  }

  kill() {}
}

function fixture(loginRequired = false) {
  const contexts = []
  const children = []
  let id = 0
  const sleepers = []
  const worker = createChatProxyWorker({
    chromium: {
      launchPersistentContext: async (_profile, options) => {
        const context = new FakeContext()
        context.options = options
        context.loginPage.loginRequired = loginRequired
        contexts.push(context)
        return context
      },
    },
    spawn: (...input) => {
      const child = new FakeChild(input)
      children.push(child)
      return child
    },
    edgeExecutable: () => "C:/fake/msedge.exe",
    randomUUID: () => `tab-${++id}`,
    sleep: () => new Promise((resolve) => sleepers.push(resolve)),
  })
  const execute = (method, input = {}) => worker.execute({ method, user: "user-1", ...input })
  return { children, contexts, execute, worker }
}

async function connect(value) {
  expect(await value.execute("connect", { profile: "C:/profiles/user-1" })).toMatchObject({
    status: "login-required",
  })
  value.children.at(-1).exit()
  for (let attempt = 0; attempt < 10; attempt++) {
    const status = await value.execute("status")
    if (status.status === "ready") return
    await Promise.resolve()
  }
  throw new Error("Fake sign-in profile handoff did not become ready")
}

function request(endpoint, input) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint)
    let output = ""
    socket.setEncoding("utf8")
    socket.once("error", reject)
    socket.on("data", (chunk) => {
      output += chunk
      const newline = output.indexOf("\n")
      if (newline < 0) return
      const response = JSON.parse(output.slice(0, newline))
      socket.end()
      if (response.ok) resolve(response.value)
      else reject(new Error(response.error))
    })
    socket.once("connect", () => socket.write(`${JSON.stringify({ id: "request", ...input })}\n`))
  })
}

describe("Chat Proxy worker", () => {
  test("returns a serializable no-op when workspace cleanup has no browser session", async () => {
    const value = fixture()
    expect(await value.execute("closeWorkspace", { workspaceID: "workspace-1" })).toEqual({})
    await value.worker.shutdown()
  })

  test("checks an owned chat when the connection landing tab was closed", async () => {
    const value = fixture()
    await connect(value)
    await value.execute("ensure", { workspaceID: "workspace", blockID: "relay", profile: "C:/profiles/user-1" })
    await value.contexts[0].loginPage.close()
    expect(await value.execute("status")).toMatchObject({ status: "ready" })
    expect(value.children).toHaveLength(1)
    expect(value.contexts[0].created).toHaveLength(1)
    await value.worker.shutdown()
  })
  test("checks a confirmed saved login without reopening the sign-in browser", async () => {
    const value = fixture()
    expect(await value.execute("restore", { profile: "C:/profiles/user-1" })).toMatchObject({ status: "ready" })
    expect(value.children).toHaveLength(0)
    expect(value.contexts).toHaveLength(1)
    expect(value.contexts[0].options.headless).toBe(false)
    expect(value.contexts[0].options.args).toEqual(["--start-minimized"])
    expect(value.contexts[0].loginPage.closed).toBe(false)
    expect(await value.execute("restore", { profile: "C:/profiles/user-1" })).toMatchObject({ status: "ready" })
    expect(value.contexts).toHaveLength(1)
    await value.worker.shutdown()
  })

  test("an expired saved login waits for Settings without a sign-in browser or repeated checks", async () => {
    const value = fixture(true)
    expect(await value.execute("restore", { profile: "C:/profiles/user-1" })).toMatchObject({
      status: "login-required",
    })
    expect(await value.execute("restore", { profile: "C:/profiles/user-1" })).toMatchObject({
      status: "login-required",
    })
    expect(value.children).toHaveLength(0)
    expect(value.contexts).toHaveLength(1)
    expect(value.contexts[0].options.args).toEqual(["--start-minimized"])
    expect(value.contexts[0].loginPage.closed).toBe(true)
    await value.worker.shutdown()
  })
  test("does not launch a fresh browser before Settings connects and recovers a closed login page", async () => {
    const value = fixture()
    const disconnected = await value.execute("ensure", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/definitely-missing-chat-relay-profile",
    })

    expect(disconnected.status).toBe("disconnected")
    expect(value.contexts).toHaveLength(0)

    await connect(value)
    expect(value.children[0].input[1]).toContain("--user-data-dir=C:/profiles/user-1")
    expect(value.children[0].input[1].some((argument) => /remote-debugging|automation/i.test(argument))).toBe(false)
    const loginPage = value.contexts[0].loginPage
    await loginPage.close()
    const opened = await value.execute("open", { profile: "C:/profiles/user-1" })

    expect(opened.status).toBe("ready")
    expect(value.contexts).toHaveLength(1)
    expect(value.contexts[0].created).toHaveLength(1)
    expect(value.contexts[0].created[0].closed).toBe(false)
    await value.worker.shutdown()
  })

  test("does not launch from block or status polling even when a saved profile exists", async () => {
    const value = fixture()
    const profile = mkdtempSync(path.join(tmpdir(), "chat-relay-profile-"))
    try {
      const requests = await Promise.all([
        value.execute("ensure", { workspaceID: "workspace-1", blockID: "block-1", profile }),
        value.execute("reset", { workspaceID: "workspace-1", blockID: "block-1", profile }),
        value.execute("status"),
        value.execute("ensure", { workspaceID: "workspace-1", blockID: "block-1", profile }),
      ])

      expect(requests.map((request) => request.status)).toEqual([
        "disconnected",
        "disconnected",
        "disconnected",
        "disconnected",
      ])
      expect(value.children).toHaveLength(0)
      expect(value.contexts).toHaveLength(0)
      await value.worker.shutdown()
    } finally {
      rmSync(profile, { recursive: true, force: true })
    }
  })

  test("serializes concurrent connect and waits for an explicit reconnect after canceled sign-in", async () => {
    const value = fixture()
    const profile = "C:/profiles/user-1"
    const requests = await Promise.all([
      value.execute("connect", { profile }),
      value.execute("connect", { profile }),
      value.execute("open", { profile }),
    ])

    expect(requests.every((provider) => provider.status === "login-required")).toBe(true)
    expect(value.children).toHaveLength(1)
    value.children[0].exit()
    for (let attempt = 0; !value.contexts.length && attempt < 10; attempt++) await Promise.resolve()
    value.contexts[0].loginPage.loginRequired = true

    let canceled
    for (let attempt = 0; attempt < 10; attempt++) {
      canceled = await value.execute("status")
      if (canceled.status === "login-required") break
      await Promise.resolve()
    }
    expect(canceled).toMatchObject({ status: "login-required" })
    expect(await value.execute("status")).toMatchObject({ status: "login-required" })
    expect(value.children).toHaveLength(1)
    expect(value.contexts[0].loginPage.closed).toBe(true)

    await Promise.all([value.execute("connect", { profile }), value.execute("open", { profile })])
    expect(value.children).toHaveLength(2)
    await value.worker.shutdown()
  })

  test("owns idempotent tabs by workspace and block and rotates them on reset", async () => {
    const value = fixture()
    await connect(value)
    const [first, repeated] = await Promise.all([
      value.execute("relay", {
        workspaceID: "workspace-1",
        blockID: "block-1",
        profile: "C:/profiles/user-1",
      }),
      value.execute("relay", {
        workspaceID: "workspace-1",
        blockID: "block-1",
        profile: "C:/profiles/user-1",
      }),
    ])
    const other = await value.execute("ensure", {
      workspaceID: "workspace-2",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })

    expect(first.tabID).toBe("tab-1")
    expect(repeated.tabID).toBe(first.tabID)
    expect(value.contexts[0].created).toHaveLength(2)
    expect(other.tabID).toBe("tab-2")
    await expect(
      value.execute("reset", {
        workspaceID: "workspace-1",
        blockID: "block-1",
        profile: "C:/profiles/user-1",
        tabID: "stale-tab",
      }),
    ).rejects.toThrow("tab changed")

    const reset = await value.execute("reset", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
      tabID: first.tabID,
    })
    expect(reset.tabID).toBe("tab-3")
    expect(value.contexts[0].created[0].closed).toBe(true)
    await value.worker.shutdown()
  })

  test("keeps an externally closed owner until reset and releases it when the block is deleted", async () => {
    const value = fixture()
    await connect(value)
    const first = await value.execute("relay", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })

    expect(first).toMatchObject({ status: "idle", tabID: "tab-1" })
    expect(value.contexts[0].created).toHaveLength(1)
    await value.contexts[0].created[0].close()
    const refreshed = await value.execute("ensure", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })

    expect(refreshed).toMatchObject({ tabID: first.tabID, status: "error" })
    expect(value.contexts[0].created).toHaveLength(1)

    const reset = await value.execute("reset", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
      tabID: first.tabID,
    })
    expect(reset.tabID).not.toBe(first.tabID)
    expect(value.contexts[0].created).toHaveLength(2)

    await expect(
      value.execute("openRelay", {
        workspaceID: "workspace-1",
        blockID: "block-1",
        tabID: "stale-client-tab",
      }),
    ).rejects.toThrow("tab changed")
    expect(
      await value.execute("openRelay", {
        workspaceID: "workspace-1",
        blockID: "block-1",
        tabID: reset.tabID,
      }),
    ).toMatchObject({ tabID: reset.tabID, status: "idle" })

    const closed = await value.execute("close", { workspaceID: "workspace-1", blockID: "block-1" })
    expect(closed).toMatchObject({ tabID: reset.tabID, status: "closed" })
    expect(value.contexts[0].created[1].closed).toBe(true)
    const readded = await value.execute("relay", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })
    expect(readded.tabID).not.toBe(reset.tabID)
    expect(value.contexts[0].created).toHaveLength(3)
    expect(await value.execute("close", { workspaceID: "workspace-1", blockID: "block-1" })).toMatchObject({
      tabID: readded.tabID,
      status: "closed",
    })
    expect(value.contexts[0].created[2].closed).toBe(true)
    await value.worker.shutdown()
  })

  test("requires the current tab generation when resetting an owned page", async () => {
    const value = fixture()
    await connect(value)
    const first = await value.execute("relay", { workspaceID: "workspace-1", blockID: "block-1" })

    await expect(
      value.execute("reset", {
        workspaceID: "workspace-1",
        blockID: "block-1",
        profile: "C:/profiles/user-1",
      }),
    ).rejects.toThrow("tab changed")
    expect(await value.execute("relay", { workspaceID: "workspace-1", blockID: "block-1" })).toMatchObject({
      tabID: first.tabID,
      status: "idle",
    })
    expect(value.contexts[0].created).toHaveLength(1)
    await value.worker.shutdown()
  })

  test("re-registers ownership when reset acquires after cleanup emptied the registry", async () => {
    const value = fixture()
    await connect(value)
    const first = await value.execute("relay", { workspaceID: "workspace-1", blockID: "block-1" })
    await value.execute("close", { workspaceID: "workspace-1", blockID: "block-1" })

    const reset = await value.execute("reset", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })
    expect(reset.tabID).not.toBe(first.tabID)
    expect(await value.execute("close", { workspaceID: "workspace-1", blockID: "block-1" })).toMatchObject({
      tabID: reset.tabID,
      status: "closed",
    })
    expect(value.contexts[0].created.map((page) => page.closed)).toEqual([true, true])
    await value.worker.shutdown()
  })

  test("preserves owner incarnations when the browser context closes until reconnect and reset", async () => {
    const value = fixture()
    await connect(value)
    const first = await value.execute("relay", { workspaceID: "workspace-1", blockID: "block-1" })

    await value.contexts[0].close()
    expect(await value.execute("restore", { profile: "C:/profiles/user-1" })).toMatchObject({
      status: "disconnected",
    })
    expect(await value.execute("relay", { workspaceID: "workspace-1", blockID: "block-1" })).toMatchObject({
      tabID: first.tabID,
      status: "error",
      error: expect.stringContaining("Reconnect"),
    })
    expect(value.contexts).toHaveLength(1)

    expect(await value.execute("connect", { profile: "C:/profiles/user-1" })).toMatchObject({
      status: "login-required",
    })
    expect(await value.execute("relay", { workspaceID: "workspace-1", blockID: "block-1" })).toMatchObject({
      tabID: first.tabID,
      status: "error",
    })
    value.children.at(-1).exit()
    for (let attempt = 0; attempt < 10; attempt++) {
      if ((await value.execute("status")).status === "ready") break
      await Promise.resolve()
    }
    expect(await value.execute("relay", { workspaceID: "workspace-1", blockID: "block-1" })).toMatchObject({
      tabID: first.tabID,
      status: "error",
    })

    const reset = await value.execute("reset", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
      tabID: first.tabID,
    })
    expect(reset).toMatchObject({ status: "idle" })
    expect(reset.tabID).not.toBe(first.tabID)
    expect(value.contexts).toHaveLength(2)
    expect(value.contexts[1].created).toHaveLength(1)
    await value.worker.shutdown()
  })

  test("block close wins when a reset was already queued", async () => {
    const value = fixture()
    await connect(value)
    const first = await value.execute("relay", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })

    const resetting = value.execute("reset", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
      tabID: first.tabID,
    })
    const closing = value.execute("close", { workspaceID: "workspace-1", blockID: "block-1" })
    const [reset, closed] = await Promise.all([resetting, closing])

    expect(reset.tabID).not.toBe(first.tabID)
    expect(closed).toMatchObject({ tabID: reset.tabID, status: "closed" })
    expect(value.contexts[0].created[1].closed).toBe(true)
    expect(value.contexts[0].created).toHaveLength(2)
    await value.worker.shutdown()
  })

  test("does not create a replacement while the previous page is still open", async () => {
    const value = fixture()
    await connect(value)
    const first = await value.execute("relay", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })
    value.contexts[0].created[0].closeError = new Error("close failed")

    await expect(
      value.execute("reset", {
        workspaceID: "workspace-1",
        blockID: "block-1",
        profile: "C:/profiles/user-1",
        tabID: first.tabID,
      }),
    ).rejects.toThrow("close failed")
    expect(value.contexts[0].created).toHaveLength(1)
    expect(value.contexts[0].created[0].closed).toBe(false)
    expect(await value.execute("relay", { workspaceID: "workspace-1", blockID: "block-1" })).toMatchObject({
      tabID: first.tabID,
      status: "idle",
    })
    await value.worker.shutdown()
  })

  test("closes every page owned by a deleted workspace and leaves other workspaces alone", async () => {
    const value = fixture()
    await connect(value)
    const relays = await Promise.all([
      value.execute("relay", { workspaceID: "workspace-1", blockID: "block-1", profile: "C:/profiles/user-1" }),
      value.execute("relay", { workspaceID: "workspace-1", blockID: "block-2", profile: "C:/profiles/user-1" }),
      value.execute("relay", { workspaceID: "workspace-2", blockID: "block-1", profile: "C:/profiles/user-1" }),
    ])

    await value.execute("closeWorkspace", { workspaceID: "workspace-1" })

    expect(value.contexts[0].created.map((page) => page.closed)).toEqual([true, true, false])
    const recreated = await value.execute("relay", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })
    expect(recreated.tabID).not.toBe(relays[0].tabID)
    expect(value.contexts[0].created).toHaveLength(4)
    expect(
      await value.execute("openRelay", { workspaceID: "workspace-2", blockID: "block-1", tabID: relays[2].tabID }),
    ).toMatchObject({
      status: "idle",
      tabID: relays[2].tabID,
    })
    await value.worker.shutdown()
  })

  test("workspace cleanup waits for a first relay before its page is registered", async () => {
    const value = fixture()
    await connect(value)
    const context = value.contexts[0]
    const original = context.newPage.bind(context)
    let enter
    let release
    const entered = new Promise((resolve) => (enter = resolve))
    const released = new Promise((resolve) => (release = resolve))
    context.newPage = async () => {
      enter()
      await released
      return original()
    }

    const relaying = value.execute("relay", { workspaceID: "workspace-1", blockID: "block-1" })
    await entered
    const closing = value.execute("closeWorkspace", { workspaceID: "workspace-1" })
    release()
    const [relay] = await Promise.all([relaying, closing])

    expect(context.created).toHaveLength(1)
    expect(context.created[0].closed).toBe(true)
    const readded = await value.execute("relay", { workspaceID: "workspace-1", blockID: "block-1" })
    expect(readded.tabID).not.toBe(relay.tabID)
    expect(context.created).toHaveLength(2)
    await value.worker.shutdown()
  })

  test("block cleanup waits for a first relay before its page is registered", async () => {
    const value = fixture()
    await connect(value)
    const context = value.contexts[0]
    const original = context.newPage.bind(context)
    let enter
    let release
    const entered = new Promise((resolve) => (enter = resolve))
    const released = new Promise((resolve) => (release = resolve))
    context.newPage = async () => {
      enter()
      await released
      return original()
    }

    const relaying = value.execute("relay", { workspaceID: "workspace-1", blockID: "block-1" })
    await entered
    const closing = value.execute("close", { workspaceID: "workspace-1", blockID: "block-1" })
    release()
    const [relay, closed] = await Promise.all([relaying, closing])

    expect(closed).toMatchObject({ tabID: relay.tabID, status: "closed" })
    expect(context.created).toHaveLength(1)
    expect(context.created[0].closed).toBe(true)
    const readded = await value.execute("relay", { workspaceID: "workspace-1", blockID: "block-1" })
    expect(readded.tabID).not.toBe(relay.tabID)
    expect(context.created).toHaveLength(2)
    await value.worker.shutdown()
  })

  test("keeps backend page ownership across IPC client reconnects and closes it with the server", async () => {
    const value = fixture()
    await connect(value)
    const endpoint =
      process.platform === "win32"
        ? `\\\\.\\pipe\\opencode-chat-proxy-test-${process.pid}-${Date.now()}`
        : path.join(tmpdir(), `opencode-chat-proxy-test-${process.pid}-${Date.now()}.sock`)
    const server = await startChatProxyWorkerServer(endpoint, value.worker)

    const first = await request(endpoint, {
      method: "relay",
      user: "user-1",
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })
    const reconnected = await request(endpoint, {
      method: "relay",
      user: "user-1",
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })

    expect(reconnected.tabID).toBe(first.tabID)
    expect(value.contexts[0].created).toHaveLength(1)
    expect(value.contexts[0].created[0].closed).toBe(false)

    await request(endpoint, { method: "shutdown", user: "user-1" })
    expect(value.contexts[0].created[0].closed).toBe(true)
    await server.close()
  })

  test("reconciles original selection identity before resolving changed context and preserves admitted bytes", async () => {
    const value = fixture()
    await connect(value)
    const relay = await value.execute("ensure", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })
    const input = {
      workspaceID: "workspace-1",
      blockID: "block-1",
      tabID: relay.tabID,
      messageID: "selected-1",
      text: "Selected skills: review",
      browserText: "original skill instructions",
      requestIdentity: "original-selection",
    }
    expect(await value.execute("reconcilePrompt", input)).toBeNull()
    await value.execute("prompt", input)
    expect((await value.execute("reconcilePrompt", input)).messages[0].text).toBe(input.text)
    await value.execute("prompt", { ...input, browserText: "replaced catalog instructions" })
    expect(value.contexts[0].created[0].sent).toBe(1)
    expect(value.contexts[0].created[0].filled).toBe("original skill instructions")
    await expect(
      value.execute("reconcilePrompt", { ...input, requestIdentity: "different-selection" }),
    ).rejects.toThrow("different")
    await expect(value.execute("reconcilePrompt", { ...input, tabID: "stale" })).rejects.toThrow()
    await value.worker.shutdown()
  })

  test("an uncertain browser send keeps its admission and reconciliation never sends again", async () => {
    const value = fixture()
    await connect(value)
    const relay = await value.execute("ensure", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })
    value.contexts[0].created[0].sendError = new Error("Send timed out after click")
    const input = {
      workspaceID: "workspace-1",
      blockID: "block-1",
      tabID: relay.tabID,
      messageID: "uncertain",
      text: "Selected skills: review",
      browserText: "Original instructions",
      requestIdentity: "original",
      files: [{ name: "notes.txt", mime: "text/plain", uri: "data:text/plain;base64,bm90ZXM=" }],
    }
    await expect(value.execute("prompt", input)).rejects.toThrow("Send timed out")
    expect(await value.execute("reconcilePrompt", input)).toMatchObject({ status: "error" })
    expect(await value.execute("prompt", input)).toMatchObject({ status: "error" })
    expect(value.contexts[0].created[0].sent).toBe(1)
    expect(value.contexts[0].created[0].events).toEqual([
      "clear",
      "fill",
      "upload",
      "ack:notes.txt",
      "send-enabled",
      "send",
    ])
    await value.worker.shutdown()
  })

  for (const scenario of [
    { name: "has no form", composerFormCount: 0, uploadInputCount: 0, nonAttachmentGroups: [] },
    { name: "has no upload input", composerFormCount: 1, uploadInputCount: 0, nonAttachmentGroups: [] },
    { name: "contains an ordinary group", composerFormCount: 1, uploadInputCount: 1, nonAttachmentGroups: ["Options"] },
  ]) {
    test(`sends a text-only prompt when the composer ${scenario.name}`, async () => {
      const value = fixture()
      await connect(value)
      const relay = await value.execute("ensure", {
        workspaceID: "workspace-1",
        blockID: scenario.name,
        profile: "C:/profiles/user-1",
      })
      const input = {
        workspaceID: "workspace-1",
        blockID: scenario.name,
        tabID: relay.tabID,
        messageID: scenario.name,
        requestIdentity: scenario.name,
        text: "Text only",
      }
      const page = value.contexts[0].created[0]
      page.composerFormCount = scenario.composerFormCount
      page.uploadInputCount = scenario.uploadInputCount
      page.nonAttachmentGroups = scenario.nonAttachmentGroups

      await value.execute("prompt", input)

      expect(page.sent).toBe(1)
      expect(page.filesAtSend).toEqual([])
      expect((await value.execute("reconcilePrompt", input)).messages[0].id).toBe(input.messageID)
      await value.worker.shutdown()
    })
  }

  test("uploads ordered in-memory files before admitting and sending a ChatGPT prompt", async () => {
    const value = fixture()
    await connect(value)
    const relay = await value.execute("ensure", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })
    const input = {
      workspaceID: "workspace-1",
      blockID: "block-1",
      tabID: relay.tabID,
      messageID: "files-1",
      text: "Review these files",
      browserText: "Review these files",
      requestIdentity: "files-1",
      files: [
        { name: "notes.txt", mime: "text/plain", uri: "data:text/plain;base64,Zmlyc3Qgbm90ZQ==" },
        { name: "source.js", mime: "text/javascript", uri: "data:text/javascript;base64,Y29uc3QgeCA9IDE=" },
      ],
    }
    const page = value.contexts[0].created[0]
    page.nonAttachmentGroups = ["Options"]
    page.onSendEnabled = async () => {
      expect(await value.execute("reconcilePrompt", input)).toBeNull()
    }
    page.onSendClick = async () => {
      expect(await value.execute("reconcilePrompt", input)).toMatchObject({
        messages: [expect.objectContaining({ id: input.messageID, text: input.text })],
      })
    }

    await value.execute("prompt", input)

    expect(
      page.uploads.map((file) => ({ name: file.name, mimeType: file.mimeType, text: file.buffer.toString() })),
    ).toEqual([
      { name: "notes.txt", mimeType: "text/plain", text: "first note" },
      { name: "source.js", mimeType: "text/javascript", text: "const x = 1" },
    ])
    expect(page.events).toEqual(["clear", "fill", "upload", "ack:notes.txt", "ack:source.js", "send-enabled", "send"])
    expect((await value.execute("reconcilePrompt", input)).messages[0]).toMatchObject({ text: input.text })
    await value.worker.shutdown()
  })

  test("uploads a file-only prompt after clearing the composer without putting the filename in it", async () => {
    const value = fixture()
    await connect(value)
    const relay = await value.execute("ensure", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })
    const input = {
      workspaceID: "workspace-1",
      blockID: "block-1",
      tabID: relay.tabID,
      messageID: "file-only",
      text: 'Attached files: "notes.txt"',
      browserText: "",
      requestIdentity: "file-only",
      files: [{ name: "notes.txt", mime: "text/plain", uri: "data:text/plain;base64,bm90ZXM=" }],
    }

    await value.execute("prompt", input)

    const page = value.contexts[0].created[0]
    expect(page.filled).toBe("")
    expect(page.filled).not.toContain("notes.txt")
    expect(page.uploads).toHaveLength(1)
    await value.worker.shutdown()
  })

  test("acknowledges every uploaded file when distinct payloads share a filename", async () => {
    const value = fixture()
    await connect(value)
    const relay = await value.execute("ensure", {
      workspaceID: "workspace-1",
      blockID: "block-duplicate-files",
      profile: "C:/profiles/user-1",
    })
    const input = {
      workspaceID: "workspace-1",
      blockID: "block-duplicate-files",
      tabID: relay.tabID,
      messageID: "duplicate-files",
      text: "Review the duplicate files",
      requestIdentity: "duplicate-files",
      files: [
        { name: "notes.txt", mime: "text/plain", uri: "data:text/plain;base64,Zmlyc3Q=" },
        { name: "notes.txt", mime: "text/plain", uri: "data:text/plain;base64,c2Vjb25k" },
      ],
    }

    await value.execute("prompt", input)

    const page = value.contexts[0].created[0]
    expect(page.uploads.map((file) => file.buffer.toString())).toEqual(["first", "second"])
    expect(page.events).toEqual(["clear", "fill", "upload", "ack:notes.txt", "ack:notes.txt", "send-enabled", "send"])
    await value.worker.shutdown()
  })

  test("leaves a prompt unadmitted when the regular composer upload input is missing or ambiguous", async () => {
    for (const uploadInputCount of [0, 2]) {
      const value = fixture()
      await connect(value)
      const relay = await value.execute("ensure", {
        workspaceID: "workspace-1",
        blockID: `block-${uploadInputCount}`,
        profile: "C:/profiles/user-1",
      })
      const input = {
        workspaceID: "workspace-1",
        blockID: `block-${uploadInputCount}`,
        tabID: relay.tabID,
        messageID: `missing-${uploadInputCount}`,
        text: "Attach this",
        requestIdentity: `missing-${uploadInputCount}`,
        files: [{ name: "notes.txt", mime: "text/plain", uri: "data:text/plain;base64,bm90ZXM=" }],
      }
      const page = value.contexts[0].created[0]
      page.uploadInputCount = uploadInputCount

      await expect(value.execute("prompt", input)).rejects.toThrow("ChatGPT file upload input is unavailable")
      expect(page.sent).toBe(0)
      expect(await value.execute("reconcilePrompt", input)).toBeNull()
      await value.worker.shutdown()
    }
  })

  test("leaves a prompt unadmitted when ChatGPT does not acknowledge an uploaded file", async () => {
    const value = fixture()
    await connect(value)
    const relay = await value.execute("ensure", {
      workspaceID: "workspace-1",
      blockID: "block-ack",
      profile: "C:/profiles/user-1",
    })
    const input = {
      workspaceID: "workspace-1",
      blockID: "block-ack",
      tabID: relay.tabID,
      messageID: "acknowledgement",
      text: "Attach this",
      requestIdentity: "acknowledgement",
      files: [{ name: "notes.txt", mime: "text/plain", uri: "data:text/plain;base64,bm90ZXM=" }],
    }
    const page = value.contexts[0].created[0]
    page.uploadError = new Error("timed out")

    await expect(value.execute("prompt", input)).rejects.toThrow("ChatGPT file upload was not acknowledged")
    expect(page.sent).toBe(0)
    expect(await value.execute("reconcilePrompt", input)).toBeNull()
    await value.worker.shutdown()
  })

  for (const followup of ["retry", "text-only"]) {
    test(`clears pre-admission uploads before a ${followup} follow-up`, async () => {
      const value = fixture()
      await connect(value)
      const relay = await value.execute("ensure", {
        workspaceID: "workspace-1",
        blockID: "failed-upload",
        profile: "C:/profiles/user-1",
      })
      const input = {
        workspaceID: "workspace-1",
        blockID: "failed-upload",
        tabID: relay.tabID,
        messageID: "failed-upload",
        requestIdentity: "failed-upload",
        text: "Review this",
        files: [{ name: "notes.txt", mime: "text/plain", uri: "data:text/plain;base64,bm90ZXM=" }],
      }
      const page = value.contexts[0].created[0]
      page.sendEnabled = false

      await expect(value.execute("prompt", input)).rejects.toThrow("ChatGPT Send is unavailable")
      expect(page.sent).toBe(0)
      expect(await value.execute("reconcilePrompt", input)).toBeNull()
      page.sendEnabled = true
      const next = followup === "retry" ? input : { ...input, messageID: "text", requestIdentity: "text", files: [] }
      page.onSendEnabled = async () => expect(await value.execute("reconcilePrompt", next)).toBeNull()
      page.onSendClick = async () => {
        expect((await value.execute("reconcilePrompt", next)).messages[0].id).toBe(next.messageID)
      }

      await value.execute("prompt", next)

      expect(page.filesAtSend.map((file) => file.name)).toEqual(followup === "retry" ? ["notes.txt"] : [])
      expect(page.sent).toBe(1)
      expect((await value.execute("reconcilePrompt", next)).messages[0].id).toBe(next.messageID)
      await value.worker.shutdown()
    })

    test(`cleans up a rejected setInputFiles before a ${followup} follow-up`, async () => {
      const value = fixture()
      await connect(value)
      const relay = await value.execute("ensure", {
        workspaceID: "workspace-1",
        blockID: "rejected-upload",
        profile: "C:/profiles/user-1",
      })
      const input = {
        workspaceID: "workspace-1",
        blockID: "rejected-upload",
        tabID: relay.tabID,
        messageID: "rejected-upload",
        requestIdentity: "rejected-upload",
        text: "Review this",
        files: [{ name: "notes.txt", mime: "text/plain", uri: "data:text/plain;base64,bm90ZXM=" }],
      }
      const page = value.contexts[0].created[0]
      page.setInputFilesError = new Error("Upload transport failed after staging")

      await expect(value.execute("prompt", input)).rejects.toThrow("Upload transport failed")
      expect(page.sent).toBe(0)
      expect(await value.execute("reconcilePrompt", input)).toBeNull()
      expect(page.uploads).toEqual([])
      expect(page.acknowledgedFiles).toEqual([])
      page.setInputFilesError = undefined

      await value.execute(
        "prompt",
        followup === "retry" ? input : { ...input, messageID: "text", requestIdentity: "text", files: [] },
      )

      expect(page.filesAtSend.map((file) => file.name)).toEqual(followup === "retry" ? ["notes.txt"] : [])
      expect(page.sent).toBe(1)
      await value.worker.shutdown()
    })
  }

  test("fails closed when clearing the upload input leaves an attachment chip", async () => {
    const value = fixture()
    await connect(value)
    const relay = await value.execute("ensure", {
      workspaceID: "workspace-1",
      blockID: "stale-chip",
      profile: "C:/profiles/user-1",
    })
    const input = {
      workspaceID: "workspace-1",
      blockID: "stale-chip",
      tabID: relay.tabID,
      messageID: "text",
      requestIdentity: "text",
      text: "Text only",
    }
    const page = value.contexts[0].created[0]
    page.uploads = [{ name: "notes.txt" }]
    page.acknowledgedFiles = ["notes.txt"]
    page.keepUploadChips = true

    await expect(value.execute("prompt", input)).rejects.toThrow("ChatGPT attachments could not be cleared")
    expect(page.sent).toBe(0)
    expect(await value.execute("reconcilePrompt", input)).toBeNull()
    page.keepUploadChips = false
    await value.execute("prompt", input)
    expect(page.filesAtSend).toEqual([])
    await value.worker.shutdown()
  })

  test("fails closed on cleanup rejection until the composer can be cleared", async () => {
    const value = fixture()
    await connect(value)
    const relay = await value.execute("ensure", {
      workspaceID: "workspace-1",
      blockID: "cleanup-error",
      profile: "C:/profiles/user-1",
    })
    const input = {
      workspaceID: "workspace-1",
      blockID: "cleanup-error",
      tabID: relay.tabID,
      messageID: "failed-upload",
      requestIdentity: "failed-upload",
      text: "Review this",
      files: [{ name: "notes.txt", mime: "text/plain", uri: "data:text/plain;base64,bm90ZXM=" }],
    }
    const page = value.contexts[0].created[0]
    page.onSendEnabled = async () => {
      page.clearError = new Error("Cannot clear upload input")
    }
    page.sendEnabled = false
    await expect(value.execute("prompt", input)).rejects.toThrow()
    expect(await value.execute("reconcilePrompt", input)).toBeNull()
    page.sendEnabled = true
    page.onSendEnabled = undefined
    const next = { ...input, messageID: "text", requestIdentity: "text", files: [] }

    await expect(value.execute("prompt", next)).rejects.toThrow()
    expect(page.sent).toBe(0)
    expect(await value.execute("reconcilePrompt", next)).toBeNull()
    page.clearError = undefined
    await value.execute("prompt", next)
    expect(page.filesAtSend).toEqual([])
    await value.worker.shutdown()
  })

  for (const changed of [["notes.txt", "unexpected.txt"], ["unexpected.txt"]]) {
    test(`does not admit when attachments change to ${changed.join(", ")} before Send`, async () => {
      const value = fixture()
      await connect(value)
      const relay = await value.execute("ensure", {
        workspaceID: "workspace-1",
        blockID: "extra-file",
        profile: "C:/profiles/user-1",
      })
      const input = {
        workspaceID: "workspace-1",
        blockID: "extra-file",
        tabID: relay.tabID,
        messageID: "extra-file",
        requestIdentity: "extra-file",
        text: "Review this",
        files: [{ name: "notes.txt", mime: "text/plain", uri: "data:text/plain;base64,bm90ZXM=" }],
      }
      const page = value.contexts[0].created[0]
      page.onSendEnabled = async () => {
        page.acknowledgedFiles = changed
      }

      await expect(value.execute("prompt", input)).rejects.toThrow("ChatGPT attachments do not match this request")
      expect(page.sent).toBe(0)
      expect(await value.execute("reconcilePrompt", input)).toBeNull()
      expect(page.uploads).toEqual([])
      await value.worker.shutdown()
    })
  }

  test("does not reuse a direct-worker message ID when its ordered files change", async () => {
    const value = fixture()
    await connect(value)
    const relay = await value.execute("ensure", {
      workspaceID: "workspace-1",
      blockID: "block-identity",
      profile: "C:/profiles/user-1",
    })
    const input = {
      workspaceID: "workspace-1",
      blockID: "block-identity",
      tabID: relay.tabID,
      messageID: "identity-files",
      text: "Attach this",
      files: [{ name: "notes.txt", mime: "text/plain", uri: "data:text/plain;base64,bm90ZXM=" }],
    }

    await value.execute("prompt", input)
    await expect(
      value.execute("prompt", {
        ...input,
        files: [{ name: "changed.txt", mime: "text/plain", uri: "data:text/plain;base64,Y2hhbmdlZA==" }],
      }),
    ).rejects.toThrow("different text")
    await value.worker.shutdown()
  })

  test("reconciles retained admissions after browser disconnect without permitting new sends or another owner", async () => {
    const value = fixture()
    await connect(value)
    const relay = await value.execute("ensure", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })
    const input = {
      workspaceID: "workspace-1",
      blockID: "block-1",
      tabID: relay.tabID,
      messageID: "retained",
      text: "Selected skills: review",
      browserText: "Original instructions",
      requestIdentity: "original",
    }
    await value.execute("prompt", input)
    await value.contexts[0].close()
    expect(await value.execute("relay", input)).toMatchObject({ tabID: relay.tabID, status: "error" })
    expect(await value.execute("reconcilePrompt", input)).toMatchObject({
      tabID: relay.tabID,
      status: "error",
      messages: [expect.objectContaining({ id: "retained", text: input.text }), expect.any(Object)],
    })
    await expect(value.execute("reconcilePrompt", { ...input, requestIdentity: "different" })).rejects.toThrow(
      "different",
    )
    for (const change of [
      { tabID: "stale" },
      { user: "other-user" },
      { workspaceID: "other-workspace" },
      { blockID: "other-block" },
    ]) {
      await expect(value.execute("reconcilePrompt", { ...input, ...change })).rejects.toThrow("tab changed")
    }
    await expect(value.execute("prompt", { ...input, messageID: "new" })).rejects.toThrow("tab changed")
    expect(value.contexts[0].created[0].sent).toBe(1)
    await value.execute("close", input)
    await expect(value.execute("reconcilePrompt", input)).rejects.toThrow("tab changed")
    await value.worker.shutdown()
  })

  test("clicks once per message ID, reports partial replies, and rejects Work mode", async () => {
    const value = fixture()
    await connect(value)
    const relay = await value.execute("ensure", {
      workspaceID: "workspace-1",
      blockID: "block-1",
      profile: "C:/profiles/user-1",
    })
    const input = {
      workspaceID: "workspace-1",
      blockID: "block-1",
      tabID: relay.tabID,
      messageID: "message-1",
      text: "hello with Release notes",
      browserText: "hello regular ChatGPT\n\n<workspace-context>private context</workspace-context>",
    }
    const prompted = await value.execute("prompt", input)
    const duplicate = await value.execute("prompt", input)

    expect(prompted.status).toBe("thinking")
    expect(duplicate.messages.filter((message) => message.id === "message-1")).toHaveLength(1)
    expect(duplicate.messages.find((message) => message.id === "message-1")?.text).toBe("hello with Release notes")
    expect(value.contexts[0].created[0].sent).toBe(1)
    expect(value.contexts[0].created[0].filled).toBe(input.browserText)
    await expect(value.execute("prompt", { ...input, text: "different" })).rejects.toThrow("different text")
    await expect(value.execute("prompt", { ...input, browserText: `${input.browserText}!` })).rejects.toThrow(
      "different text",
    )
    await expect(value.execute("prompt", { ...input, messageID: "message-2" })).rejects.toThrow("already waiting")
    const partial = await value.execute("relay", input)
    expect(partial.messages.at(-1)).toMatchObject({ role: "assistant", text: "partial regular ChatGPT reply" })

    const work = await value.execute("ensure", {
      workspaceID: "workspace-1",
      blockID: "block-work",
      profile: "C:/profiles/user-1",
    })
    value.contexts[0].created[1].mode = "Work"
    await expect(
      value.execute("prompt", {
        workspaceID: "workspace-1",
        blockID: "block-work",
        tabID: work.tabID,
        messageID: "message-work",
        text: "must not send",
      }),
    ).rejects.toThrow("Work mode")
    expect(value.contexts[0].created[1].sent).toBe(0)
    value.contexts[0].created[1].mode = "Chat"
    const retried = await value.execute("prompt", {
      workspaceID: "workspace-1",
      blockID: "block-work",
      tabID: work.tabID,
      messageID: "message-work",
      text: "must not send",
    })
    expect(retried.status).toBe("thinking")
    expect(retried.messages.filter((message) => message.id === "message-work")).toHaveLength(1)
    expect(value.contexts[0].created[1].sent).toBe(1)
    await value.worker.shutdown()
  })
})
