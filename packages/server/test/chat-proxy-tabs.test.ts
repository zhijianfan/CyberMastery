import { expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { sql } from "drizzle-orm"
import { TestClock } from "effect/testing"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CanvasTabService } from "@opencode-ai/core/workspace/canvas-tab"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { ChatProxy } from "@opencode-ai/schema/chat-proxy"
import { Workspace } from "@opencode-ai/schema/workspace"
import { ChatProxyService, makeChatProxyTabs } from "../src/chat-proxy"
import { testEffect } from "../../core/test/lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, WorkspaceService.node, CanvasTabService.node]), [
    [Database.node, makeGlobalNode({ service: Database.Service, layer: Database.layerFromPath(":memory:"), deps: [] })],
  ]),
)

const setup = Effect.gen(function* () {
  const workspace = yield* WorkspaceService.Service
  const tabs = yield* CanvasTabService.Service
  const events = yield* EventV2.Service
  const scope = yield* Effect.scope
  const info = yield* workspace.create({ name: "durable-relay", user: "relay-user" })
  const tuple = Workspace.Layout.Tuple.make({ user: "relay-user", style: "default", deviceClass: "desktop" })
  const layout = yield* workspace.layout.get(info.id, tuple, "relay-client")
  yield* workspace.layout.save(
    info.id,
    tuple,
    ["one", "two"].map((id) => ({
      id,
      functionality: "builtin:chat-relay",
      transform: { x: 0, y: 0, w: 4, h: 4, z: 0 },
    })),
    layout.revision,
    "relay-client",
  )
  const pages = new Map<string, ChatProxy.Relay>()
  const calls: string[] = []
  const worker = {
    ...ChatProxyService,
    async createTab(user: string, workspaceID: string, blockID: string, tabID: string) {
      calls.push("create")
      const page =
        pages.get(tabID) ??
        new ChatProxy.Relay({
          providerID: "chatgpt",
          workspaceID: Workspace.ID.make(workspaceID),
          blockID,
          tabID,
          status: "idle",
          messages: [],
          title: "New conversation",
          createdAt: 10,
          readonly: false,
        })
      pages.set(tabID, page)
      return page
    },
    async snapshotTab(user: string, workspaceID: string, blockID: string, tabID: string) {
      calls.push("snapshot")
      const page = pages.get(tabID)
      if (!page || page.blockID !== blockID || page.workspaceID !== workspaceID) throw new Error("The tab changed")
      return page
    },
    async selectTab(user: string, workspaceID: string, blockID: string, tabID: string) {
      return this.snapshotTab(user, workspaceID, blockID, tabID)
    },
    async isLiveTab(user: string, workspaceID: string, tabID: string) {
      return pages.get(tabID)?.workspaceID === workspaceID
    },
    async archiveBlock(user: string, workspaceID: string, blockID: string) {
      pages.forEach((page, id) => {
        if (page.workspaceID === workspaceID && page.blockID === blockID)
          pages.set(id, new ChatProxy.Relay({ ...page, blockID: "" }))
      })
    },
    async restoreTab(user: string, workspaceID: string, blockID: string, tabID: string) {
      const page = pages.get(tabID)
      if (!page || page.workspaceID !== workspaceID || page.blockID) throw new Error("The tab changed")
      const result = new ChatProxy.Relay({ ...page, blockID })
      pages.set(tabID, result)
      return result
    },
    async prompt(user: string, workspaceID: string, blockID: string, tabID: string, messageID: string, text: string) {
      const page = await this.snapshotTab(user, workspaceID, blockID, tabID)
      const result = new ChatProxy.Relay({
        ...page,
        title: text,
        messages: [...page.messages, new ChatProxy.Message({ id: messageID, role: "user", text, createdAt: 11 })],
      })
      pages.set(tabID, result)
      return result
    },
  }
  return {
    workspace,
    tabs,
    events,
    scope,
    info,
    tuple,
    pages,
    calls,
    worker,
    service: makeChatProxyTabs({ workspace, tabs, events, scope, worker }),
  }
})

it.effect("durable request retry creates one live page and selecting older history preserves writable prompts", () =>
  Effect.gen(function* () {
    const f = yield* setup
    const first = yield* f.service.createTab("relay-user", f.info.id, "one", "request-first", 0)
    const second = yield* f.service.createTab("relay-user", f.info.id, "one", "request-second", first.revision)
    expect(
      (yield* f.service.createTab("relay-user", f.info.id, "one", "request-second", first.revision)).selected.id,
    ).toBe(second.selected.id)
    expect(f.calls.filter((call) => call === "create")).toHaveLength(2)
    expect(
      (yield* f.service.selectTab("relay-user", f.info.id, "one", first.selected.id, second.revision)).selected
        .writable,
    ).toBe(true)
    yield* f.service.prompt("relay-user", f.info.id, "one", first.selected.id, "message", "Saved words")
    expect((yield* f.tabs.savedSnapshot(f.info.id, first.selected.id))?.messages[0]?.text).toBe("Saved words")
    expect(f.pages.size).toBe(2)
  }),
)

it.effect("backend restart exposes saved readonly transcript and rejects stale prompts without allocating a page", () =>
  Effect.gen(function* () {
    const f = yield* setup
    const first = yield* f.service.createTab("relay-user", f.info.id, "one", "restart-first", 0)
    yield* f.service.prompt("relay-user", f.info.id, "one", first.selected.id, "message", "Survives restart")
    f.pages.clear()
    f.calls.splice(0)
    const restarted = makeChatProxyTabs({
      workspace: f.workspace,
      tabs: f.tabs,
      events: f.events,
      scope: f.scope,
      worker: f.worker,
    })
    expect(yield* restarted.ensure("relay-user", f.info.id, "one")).toMatchObject({
      tabID: first.selected.id,
      readonly: true,
      messages: [{ text: "Survives restart" }],
    })
    expect(
      (yield* restarted.prompt("relay-user", f.info.id, "one", first.selected.id, "new", "Forbidden").pipe(Effect.flip))
        .message,
    ).toContain("read-only")
    expect(f.calls).not.toContain("create")
  }),
)

it.effect("rejects unauthorized and cross-block access before touching browser state", () =>
  Effect.gen(function* () {
    const f = yield* setup
    const first = yield* f.service.createTab("relay-user", f.info.id, "one", "private-tab", 0)
    f.calls.splice(0)
    yield* f.service.snapshotTab("other-user", f.info.id, "one", first.selected.id).pipe(Effect.flip)
    yield* f.service.snapshotTab("relay-user", f.info.id, "two", first.selected.id).pipe(Effect.flip)
    expect(f.calls).toEqual([])
  }),
)

it.effect("archives live pages and restores into a different block without reopening the conversation", () =>
  Effect.gen(function* () {
    const f = yield* setup
    const first = yield* f.service.createTab("relay-user", f.info.id, "one", "archive-live", 0)
    const receiving = yield* f.service.createTab("relay-user", f.info.id, "two", "receiving", 0)
    yield* f.service.prepareArchive("relay-user", f.info.id, "one")
    yield* f.workspace.block.archiveAndRemove(f.info.id, "one", "chat-relay", f.tuple, 1, "relay-client", "relay-user")
    yield* f.service.archiveBlock("relay-user", f.info.id, "one")
    expect(
      (yield* f.service.restoreTab("relay-user", f.info.id, "two", first.selected.id, receiving.revision)).selected
        .writable,
    ).toBe(true)
    yield* f.service.prompt("relay-user", f.info.id, "two", first.selected.id, "resumed", "Restored")
    expect(f.pages.size).toBe(2)
    yield* f.service.prompt("relay-user", f.info.id, "one", first.selected.id, "stale", "Forbidden").pipe(Effect.flip)
  }),
)

it.effect("busy relay retains selection and sanitized snapshots never persist browser secrets", () =>
  Effect.gen(function* () {
    const f = yield* setup
    const first = yield* f.service.createTab("relay-user", f.info.id, "one", "busy-tab", 0)
    f.pages.set(
      first.selected.id,
      Object.assign(
        new ChatProxy.Relay({
          ...f.pages.get(first.selected.id)!,
          status: "thinking",
          url: "https://user:secret@chatgpt.com/c/conversation?token=secret#private",
        }),
        { cookies: "secret", profile: "secret" },
      ),
    )
    yield* f.service.createTab("relay-user", f.info.id, "one", "busy-new", first.revision).pipe(Effect.flip)
    yield* f.service.prepareArchive("relay-user", f.info.id, "one").pipe(Effect.flip)
    yield* f.service.snapshotTab("relay-user", f.info.id, "one", first.selected.id)
    expect(JSON.stringify(yield* f.tabs.savedSnapshot(f.info.id, first.selected.id))).not.toContain("secret")
    expect((yield* f.tabs.block(f.info.id, "chat-relay", "one")).selected.id).toBe(first.selected.id)
  }),
)

it.effect("restores saved history into an empty block without a browser connection", () =>
  Effect.gen(function* () {
    const f = yield* setup
    const first = yield* f.service.createTab("relay-user", f.info.id, "one", "saved-empty", 0)
    yield* f.service.prompt("relay-user", f.info.id, "one", first.selected.id, "history", "Offline archive")
    yield* f.workspace.block.archiveAndRemove(f.info.id, "one", "chat-relay", f.tuple, 1, "relay-client", "relay-user")
    f.pages.clear()
    expect((yield* f.service.restoreTab("relay-user", f.info.id, "two", first.selected.id, 0)).selected.writable).toBe(
      false,
    )
    expect(yield* f.service.ensure("relay-user", f.info.id, "two")).toMatchObject({
      readonly: true,
      messages: [{ text: "Offline archive" }],
    })
  }),
)

it.effect("a queued prompt rechecks the durable fence after deletion releases the shared block lock", () =>
  Effect.gen(function* () {
    const f = yield* setup
    const first = yield* f.service.createTab("relay-user", f.info.id, "one", "delete-race", 0)
    const entered = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    const deletion = yield* f.service
      .withBlock(
        f.info.id,
        "one",
        Effect.gen(function* () {
          yield* f.service.prepareArchive("relay-user", f.info.id, "one")
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(resume)
          yield* f.workspace.block.archiveAndRemove(
            f.info.id,
            "one",
            "chat-relay",
            f.tuple,
            1,
            "relay-client",
            "relay-user",
          )
          yield* f.service.archiveBlock("relay-user", f.info.id, "one")
        }),
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const otherHandler = makeChatProxyTabs({
      workspace: f.workspace,
      tabs: f.tabs,
      events: f.events,
      scope: f.scope,
      worker: f.worker,
    })
    const prompt = yield* otherHandler
      .prompt("relay-user", f.info.id, "one", first.selected.id, "racing-message", "Must not send")
      .pipe(Effect.flip, Effect.forkChild)
    yield* Effect.yieldNow
    yield* Deferred.succeed(resume, undefined)
    yield* Fiber.join(deletion)
    expect((yield* Fiber.join(prompt))._tag).toBe("CanvasTab.NotFoundError")
    expect(f.pages.get(first.selected.id)?.messages).toEqual([])
  }),
)

it.effect("a live worker selection failure preserves the previous authoritative selection", () =>
  Effect.gen(function* () {
    const f = yield* setup
    const first = yield* f.service.createTab("relay-user", f.info.id, "one", "failed-select-first", 0)
    const second = yield* f.service.createTab("relay-user", f.info.id, "one", "failed-select-second", first.revision)
    f.worker.selectTab = async () => {
      throw new Error("Browser unavailable temporarily")
    }
    expect(
      (yield* f.service.selectTab("relay-user", f.info.id, "one", first.selected.id, second.revision).pipe(Effect.flip))
        .message,
    ).toContain("temporarily")
    expect((yield* f.tabs.block(f.info.id, "chat-relay", "one")).selected.id).toBe(second.selected.id)
  }),
)

it.effect("a stalled browser selection releases the database transaction after five seconds", () =>
  Effect.gen(function* () {
    const f = yield* setup
    const first = yield* f.service.createTab("relay-user", f.info.id, "one", "timeout-first", 0)
    const second = yield* f.service.createTab("relay-user", f.info.id, "one", "timeout-second", first.revision)
    const started = Promise.withResolvers<void>()
    f.worker.selectTab = () => {
      started.resolve()
      return new Promise<ChatProxy.Relay>(() => {})
    }
    const selecting = yield* f.service
      .selectTab("relay-user", f.info.id, "one", first.selected.id, second.revision)
      .pipe(Effect.flip, Effect.forkChild)
    yield* Effect.promise(() => started.promise)
    yield* TestClock.adjust("5 seconds")
    expect((yield* Fiber.join(selecting)).message).toContain("timed out")
    expect((yield* f.tabs.block(f.info.id, "chat-relay", "one")).selected.id).toBe(second.selected.id)
  }),
)

it.effect("restoring retries a failed postcommit detach only for the tombstoned previous owner", () =>
  Effect.gen(function* () {
    const f = yield* setup
    const first = yield* f.service.createTab("relay-user", f.info.id, "one", "detach-retry", 0)
    const archive = f.worker.archiveBlock.bind(f.worker)
    f.worker.archiveBlock = async () => {
      throw new Error("Worker temporarily unreachable")
    }
    yield* f.service.prepareArchive("relay-user", f.info.id, "one")
    yield* f.workspace.block.archiveAndRemove(f.info.id, "one", "chat-relay", f.tuple, 1, "relay-client", "relay-user")
    yield* f.service.archiveBlock("relay-user", f.info.id, "one")
    f.worker.archiveBlock = archive
    expect((yield* f.service.restoreTab("relay-user", f.info.id, "two", first.selected.id, 0)).selected.writable).toBe(
      true,
    )
    expect((yield* f.tabs.savedSnapshot(f.info.id, first.selected.id))?.sourceBlockID).toBe("two")
    yield* f.service.prompt("relay-user", f.info.id, "two", first.selected.id, "restored", "Still live")
    yield* f.service.prepareArchive("relay-user", f.info.id, "two")
    yield* f.workspace.block.archiveAndRemove(f.info.id, "two", "chat-relay", f.tuple, 2, "relay-client", "relay-user")
    const layout = yield* f.workspace.layout.get(f.info.id, f.tuple, "relay-client")
    yield* f.workspace.layout.save(
      f.info.id,
      f.tuple,
      [{ id: "three", functionality: "builtin:chat-relay", transform: { x: 0, y: 0, w: 4, h: 4, z: 0 } }],
      layout.revision,
      "relay-client",
    )
    expect(
      (yield* f.service.restoreTab("relay-user", f.info.id, "three", first.selected.id, 0)).selected.writable,
    ).toBe(true)
    expect((yield* f.tabs.savedSnapshot(f.info.id, first.selected.id))?.sourceBlockID).toBe("three")
  }),
)

it.effect("reconciles an accepted prompt after its browser page closes without requiring a live snapshot", () =>
  Effect.gen(function* () {
    const f = yield* setup
    const first = yield* f.service.createTab("relay-user", f.info.id, "one", "closed-retry", 0)
    const accepted = yield* f.service.prompt(
      "relay-user",
      f.info.id,
      "one",
      first.selected.id,
      "accepted",
      "Already sent",
    )
    f.pages.clear()
    f.worker.reconcilePrompt = async (_user, _workspace, _block, _tab, messageID, identity) => {
      if (messageID !== "accepted" || identity !== "original") throw new Error("Message ID conflict")
      return new ChatProxy.Relay({ ...accepted, readonly: true, status: "closed" })
    }
    expect(
      yield* f.service.reconcilePrompt("relay-user", f.info.id, "one", first.selected.id, "accepted", "original"),
    ).toMatchObject({ readonly: true, messages: [{ text: "Already sent" }] })
    expect(
      (yield* f.service
        .reconcilePrompt("relay-user", f.info.id, "one", first.selected.id, "accepted", "changed")
        .pipe(Effect.flip)).message,
    ).toContain("conflict")
  }),
)

it.effect("a transient live snapshot failure cannot authorize archival", () =>
  Effect.gen(function* () {
    const f = yield* setup
    yield* f.service.createTab("relay-user", f.info.id, "one", "snapshot-timeout", 0)
    f.worker.snapshotTab = async () => {
      throw new Error("Browser snapshot timed out")
    }
    expect((yield* f.service.prepareArchive("relay-user", f.info.id, "one").pipe(Effect.flip)).message).toContain(
      "timed out",
    )
    expect((yield* f.tabs.block(f.info.id, "chat-relay", "one")).selected.id).toBe("snapshot-timeout")
  }),
)

it.effect("persists completed assistant text without UI polling and deduplicates prompt retry observers", () =>
  Effect.gen(function* () {
    const f = yield* setup
    const first = yield* f.service.createTab("relay-user", f.info.id, "one", "background-snapshot", 0)
    f.worker.prompt = async () => {
      const relay = new ChatProxy.Relay({
        ...f.pages.get(first.selected.id)!,
        status: "thinking",
        messages: [new ChatProxy.Message({ id: "user", role: "user", text: "Question", createdAt: 1 })],
      })
      f.pages.set(first.selected.id, relay)
      return relay
    }
    yield* f.service.prompt("relay-user", f.info.id, "one", first.selected.id, "user", "Question")
    yield* f.service.prompt("relay-user", f.info.id, "one", first.selected.id, "user", "Question")
    f.pages.set(
      first.selected.id,
      new ChatProxy.Relay({
        ...f.pages.get(first.selected.id)!,
        status: "idle",
        messages: [
          new ChatProxy.Message({ id: "user", role: "user", text: "Question", createdAt: 1 }),
          new ChatProxy.Message({
            id: "answer",
            role: "assistant",
            text: "Completed without a mounted client",
            createdAt: 2,
          }),
        ],
      }),
    )
    f.calls.splice(0)
    yield* TestClock.adjust("500 millis")
    for (let attempt = 0; attempt < 20; attempt++) {
      yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)))
      if ((yield* f.tabs.savedSnapshot(f.info.id, first.selected.id))?.messages.length === 2) break
    }
    expect((yield* f.tabs.savedSnapshot(f.info.id, first.selected.id))?.messages.at(-1)?.text).toBe(
      "Completed without a mounted client",
    )
    expect(f.calls.filter((call) => call === "snapshot")).toHaveLength(1)
  }),
)

it.effect("restore never detaches a source block whose registry is still live", () =>
  Effect.gen(function* () {
    const f = yield* setup
    const database = yield* Database.Service
    const first = yield* f.service.createTab("relay-user", f.info.id, "one", "live-source", 0)
    yield* database.db.run(
      sql`UPDATE canvas_tab SET owner_block_id = NULL, time_archived = 10 WHERE id = ${first.selected.id}`,
    )
    expect(
      (yield* f.service.restoreTab("relay-user", f.info.id, "two", first.selected.id, 0).pipe(Effect.flip))._tag,
    ).toBe("CanvasTab.BusyError")
    expect(f.pages.get(first.selected.id)?.blockID).toBe("one")
  }),
)

it.effect("service disposal stops the transcript observer and releases its retry identity", () =>
  Effect.gen(function* () {
    const f = yield* setup
    const first = yield* f.service.createTab("relay-user", f.info.id, "one", "observer-scope", 0)
    const scope = yield* Scope.make()
    const service = makeChatProxyTabs({
      workspace: f.workspace,
      tabs: f.tabs,
      events: f.events,
      scope,
      worker: f.worker,
    })
    f.worker.prompt = async () => {
      const relay = new ChatProxy.Relay({ ...f.pages.get(first.selected.id)!, status: "thinking" })
      f.pages.set(first.selected.id, relay)
      return relay
    }
    yield* service.prompt("relay-user", f.info.id, "one", first.selected.id, "user", "Question")
    yield* Scope.close(scope, Exit.void)
    f.calls.splice(0)
    yield* TestClock.adjust("1 second")
    expect(f.calls).toEqual([])
    yield* f.service.prompt("relay-user", f.info.id, "one", first.selected.id, "user", "Question")
    f.pages.set(first.selected.id, new ChatProxy.Relay({ ...f.pages.get(first.selected.id)!, status: "idle" }))
    f.calls.splice(0)
    yield* TestClock.adjust("500 millis")
    expect(f.calls.filter((call) => call === "snapshot")).toHaveLength(1)
  }),
)

it.effect("background observation retries a transient worker error and stops when the worker loses its page", () =>
  Effect.gen(function* () {
    const f = yield* setup
    const first = yield* f.service.createTab("relay-user", f.info.id, "one", "observer-retry", 0)
    f.worker.prompt = async () => {
      const relay = new ChatProxy.Relay({ ...f.pages.get(first.selected.id)!, status: "thinking" })
      f.pages.set(first.selected.id, relay)
      return relay
    }
    yield* f.service.prompt("relay-user", f.info.id, "one", first.selected.id, "user", "Question")
    const snapshot = f.worker.snapshotTab.bind(f.worker)
    const failed = Promise.withResolvers<void>()
    f.worker.snapshotTab = async () => {
      failed.resolve()
      throw new Error("Temporary transport failure")
    }
    yield* TestClock.adjust("500 millis")
    yield* Effect.promise(() => failed.promise)
    yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)))
    f.worker.snapshotTab = snapshot
    f.calls.splice(0)
    yield* TestClock.adjust("1 second")
    expect(f.calls.filter((call) => call === "snapshot")).toHaveLength(1)
    f.pages.clear()
    yield* TestClock.adjust("500 millis")
    yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)))
    f.calls.splice(0)
    yield* TestClock.adjust("8 seconds")
    expect(f.calls).toEqual([])
  }),
)
