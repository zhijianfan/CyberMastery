import { Global } from "@opencode-ai/core/global"
import { EventV2 } from "@opencode-ai/core/event"
import { CanvasTabService } from "@opencode-ai/core/workspace/canvas-tab"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { CanvasTab } from "@opencode-ai/schema/canvas-tab"
import { Workspace } from "@opencode-ai/schema/workspace"
import { WorkspaceEvent } from "@opencode-ai/schema/workspace-event"
import { ChatProxy } from "@opencode-ai/schema/chat-proxy"
import { Effect, Schema, Scope, Semaphore } from "effect"
import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { createConnection } from "node:net"
import path from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

type Pending = {
  resolve(value: unknown): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
}

const Reply = Schema.Union([
  Schema.Struct({ id: Schema.String, ok: Schema.Literal(true), value: Schema.Unknown }),
  Schema.Struct({ id: Schema.String, ok: Schema.Literal(false), error: Schema.String }),
])
const requests = new Map<string, Pending>()
const state: { worker?: ReturnType<typeof startWorker> } = {}
const restored = new Map<string, Promise<unknown>>()

export const ChatProxyService = {
  async status(user: string) {
    await restore(user)
    if (!state.worker && process.env.OPENCODE_CHAT_PROXY_SOCKET) state.worker = startWorker()
    if (!state.worker) return new ChatProxy.Provider({ id: "chatgpt", name: "ChatGPT", status: "disconnected" })
    return provider("status", user)
  },
  connect: (user: string) => provider("connect", user),
  open: (user: string) => provider("open", user),
  relay: (user: string, workspaceID: string, blockID: string) => relay("relay", user, workspaceID, blockID),
  ensure: (user: string, workspaceID: string, blockID: string) => relay("ensure", user, workspaceID, blockID),
  reset: (user: string, workspaceID: string, blockID: string, tabID?: string) =>
    relay("reset", user, workspaceID, blockID, { tabID }),
  prompt: (
    user: string,
    workspaceID: string,
    blockID: string,
    tabID: string,
    messageID: string,
    text: string,
    browserText?: string,
    requestIdentity?: string,
    files?: ChatProxy.PromptPayload["files"],
  ) => relay("prompt", user, workspaceID, blockID, { tabID, messageID, text, browserText, requestIdentity, files }),
  reconcilePrompt: async (
    user: string,
    workspaceID: string,
    blockID: string,
    tabID: string,
    messageID: string,
    requestIdentity: string,
  ) => {
    if (!state.worker && process.env.OPENCODE_CHAT_PROXY_SOCKET) state.worker = startWorker()
    if (!state.worker) return null
    return Schema.decodeUnknownSync(Schema.NullOr(ChatProxy.Relay))(
      await request("reconcilePrompt", { user, workspaceID, blockID, tabID, messageID, requestIdentity }),
    )
  },
  openRelay: (user: string, workspaceID: string, blockID: string, tabID: string) =>
    relay("openRelay", user, workspaceID, blockID, { tabID }),
  options: (user: string, workspaceID: string, blockID: string, tabID: string) =>
    relay("options", user, workspaceID, blockID, { tabID }),
  configure: (user: string, workspaceID: string, blockID: string, tabID: string, model?: string, effort?: string) =>
    relay("configure", user, workspaceID, blockID, { tabID, model, effort }),
  createTab: (user: string, workspaceID: string, blockID: string, tabID: string) =>
    relay("createTab", user, workspaceID, blockID, { tabID, requestID: tabID }),
  selectTab: (user: string, workspaceID: string, blockID: string, tabID: string, expiresAt = Date.now() + 5_000) =>
    relay("selectTab", user, workspaceID, blockID, { tabID, expiresAt }),
  snapshotTab: (user: string, workspaceID: string, blockID: string, tabID: string) =>
    relay("snapshotTab", user, workspaceID, blockID, { tabID }),
  restoreTab: (user: string, workspaceID: string, blockID: string, tabID: string, expiresAt = Date.now() + 5_000) =>
    relay("restoreTab", user, workspaceID, blockID, { tabID, expiresAt }),
  isLiveTab: async (user: string, workspaceID: string, tabID: string) => {
    if (!state.worker && process.env.OPENCODE_CHAT_PROXY_SOCKET) state.worker = startWorker()
    if (!state.worker) return false
    return Schema.decodeUnknownSync(Schema.Boolean)(await request("isLiveTab", { user, workspaceID, tabID }))
  },
  archiveBlock: (user: string, workspaceID: string, blockID: string) =>
    cleanup("archiveBlock", { user, workspaceID, blockID }),
  close: (user: string, workspaceID: string, blockID: string) => cleanup("close", { user, workspaceID, blockID }),
  closeWorkspace: (user: string, workspaceID: string) => cleanup("closeWorkspace", { user, workspaceID }),
}

export class ChatProxyTabError extends Schema.TaggedErrorClass<ChatProxyTabError>()("ChatProxy.TabError", {
  message: Schema.String,
}) {}

const tabLocks = new Map<string, { semaphore: Semaphore.Semaphore; users: number }>()
const observers = new Set<string>()

/** Shared by prompt admission and the canvas archive transaction, across handler instances. */
function withBlock<A, E, R>(workspaceID: string, blockID: string, effect: Effect.Effect<A, E, R>) {
  return Effect.suspend(() => {
    const key = JSON.stringify([workspaceID, blockID])
    const lock = tabLocks.get(key) ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 }
    tabLocks.set(key, lock)
    lock.users++
    return effect.pipe(
      lock.semaphore.withPermits(1),
      Effect.ensuring(
        Effect.sync(() => {
          if (--lock.users === 0) tabLocks.delete(key)
        }),
      ),
    )
  })
}

export function makeChatProxyTabs(input: {
  workspace: WorkspaceService.Interface
  tabs: CanvasTabService.Interface
  events: EventV2.Interface
  scope: Scope.Scope
  worker?: typeof ChatProxyService
}) {
  const worker = input.worker ?? ChatProxyService
  const kind = "chat-relay" as const
  const changed = (workspaceID: Workspace.ID, blockID: string, revision: number) =>
    input.events.publish(WorkspaceEvent.CanvasTabChanged, { workspaceID, kind, blockID, revision })
  const call = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => new ChatProxyTabError({ message: cause instanceof Error ? cause.message : String(cause) }),
    })
  const authorize = (user: string, workspaceID: Workspace.ID, blockID: string) =>
    Effect.gen(function* () {
      yield* input.workspace.get(workspaceID, user)
      const block = yield* input.workspace.block.get(workspaceID, blockID)
      if (!block) return yield* new CanvasTabService.NotFoundError({ workspaceID, kind, blockID })
      if (block.functionality !== "builtin:chat-relay")
        return yield* new CanvasTabService.WrongKindError({ workspaceID, kind, blockID })
    })
  const current = (workspaceID: Workspace.ID, blockID: string) =>
    input.tabs
      .block(workspaceID, kind, blockID)
      .pipe(Effect.catchTag("CanvasTab.NotFoundError", () => Effect.succeed(undefined)))
  const target = (workspaceID: Workspace.ID, blockID: string, tabID: string) =>
    Effect.gen(function* () {
      const entry = yield* input.tabs.get(workspaceID, kind, tabID)
      if (!entry) return yield* new CanvasTabService.NotFoundError({ workspaceID, kind, blockID, tabID })
      if (entry.blockID !== blockID || entry.archivedAt !== undefined)
        return yield* new CanvasTabService.BusyError({ workspaceID, kind, blockID, tabID })
      return entry
    })
  const persist = (entry: CanvasTab.Entry, blockID: string, relay: ChatProxy.Relay) =>
    Effect.gen(function* () {
      const url = URL.canParse(relay.url ?? "") ? new URL(relay.url!) : undefined
      const snapshot: ChatProxy.Snapshot = {
        title:
          relay.title ?? relay.messages.find((message) => message.role === "user")?.text.slice(0, 120) ?? entry.title,
        createdAt: entry.createdAt,
        messages: relay.messages.map(
          (message) =>
            new ChatProxy.Message({
              id: message.id,
              role: message.role,
              text: message.text,
              createdAt: message.createdAt,
            }),
        ),
        ...(url?.protocol === "https:" && url.hostname === "chatgpt.com"
          ? { url: `https://chatgpt.com${url.pathname}` }
          : {}),
      }
      yield* input.tabs.saveSnapshot({ workspaceID: entry.workspaceID, kind, blockID, tabID: entry.id }, snapshot)
      if (entry.title !== snapshot.title) {
        const block = yield* input.tabs.block(entry.workspaceID, kind, blockID)
        yield* changed(entry.workspaceID, blockID, block.revision)
      }
      return new ChatProxy.Relay({
        ...relay,
        ...snapshot,
        workspaceID: entry.workspaceID,
        blockID,
        tabID: entry.id,
        readonly: relay.readonly === true,
      })
    })
  const snapshot = (user: string, entry: CanvasTab.Entry, blockID: string) =>
    Effect.gen(function* () {
      const available = yield* call(() => worker.isLiveTab(user, entry.workspaceID, entry.conversationID))
      const live = available
        ? yield* call(() => worker.snapshotTab(user, entry.workspaceID, blockID, entry.conversationID)).pipe(
            Effect.catch((error) =>
              call(() => worker.isLiveTab(user, entry.workspaceID, entry.conversationID)).pipe(
                Effect.flatMap((stillLive) => (stillLive ? Effect.fail(error) : Effect.succeed(undefined))),
              ),
            ),
          )
        : undefined
      if (live && !live.readonly) return yield* persist(entry, blockID, live)
      const saved = yield* input.tabs.savedSnapshot(entry.workspaceID, entry.id)
      return new ChatProxy.Relay({
        providerID: "chatgpt",
        workspaceID: entry.workspaceID,
        blockID,
        tabID: entry.id,
        status: "closed",
        messages: saved?.messages ?? [],
        title: saved?.title ?? entry.title,
        createdAt: entry.createdAt,
        url: saved?.url,
        readonly: true,
      })
    })
  const idle = (user: string, workspaceID: Workspace.ID, blockID: string) =>
    Effect.gen(function* () {
      const block = yield* current(workspaceID, blockID)
      if (!block) return undefined
      const relay = yield* snapshot(user, block.selected, blockID)
      if (relay.status === "thinking" || relay.busy)
        return yield* new CanvasTabService.BusyError({ workspaceID, kind, blockID })
      return block
    })
  const materialize = (user: string, entry: CanvasTab.Entry) =>
    Effect.gen(function* () {
      yield* input.workspace.get(entry.workspaceID, user)
      const actual = yield* input.tabs.get(entry.workspaceID, kind, entry.id)
      if (!actual)
        return yield* new CanvasTabService.NotFoundError({ workspaceID: entry.workspaceID, kind, tabID: entry.id })
      const writable = yield* call(() => worker.isLiveTab(user, actual.workspaceID, actual.conversationID)).pipe(
        Effect.catch(() => Effect.succeed(false)),
      )
      return { ...actual, writable }
    })
  const ensure = (user: string, workspaceID: Workspace.ID, blockID: string) =>
    withBlock(
      workspaceID,
      blockID,
      Effect.gen(function* () {
        yield* authorize(user, workspaceID, blockID)
        const block = yield* current(workspaceID, blockID)
        if (block) return yield* snapshot(user, block.selected, blockID)
        const relay = yield* call(() => worker.ensure(user, workspaceID, blockID))
        if (!relay.tabID) return relay
        yield* authorize(user, workspaceID, blockID)
        return yield* input.events.atomic(
          Effect.gen(function* () {
            const entry = yield* input.tabs.enroll(
              workspaceID,
              kind,
              blockID,
              relay.tabID!,
              relay.title ?? "New conversation",
              relay.createdAt ?? Date.now(),
            )
            const result = yield* persist(entry, blockID, relay)
            yield* changed(workspaceID, blockID, (yield* input.tabs.block(workspaceID, kind, blockID)).revision)
            return result
          }),
        )
      }),
    )
  const createTab = (
    user: string,
    workspaceID: Workspace.ID,
    blockID: string,
    requestID: string,
    expectedRevision: number,
  ) =>
    withBlock(
      workspaceID,
      blockID,
      Effect.gen(function* () {
        yield* authorize(user, workspaceID, blockID)
        const existing = yield* input.tabs.get(workspaceID, kind, requestID)
        if (existing) {
          if (existing.blockID !== blockID || existing.archivedAt !== undefined)
            return yield* new CanvasTabService.BusyError({ workspaceID, kind, blockID, tabID: requestID })
          const block = yield* input.tabs.block(workspaceID, kind, blockID)
          return { revision: block.revision, selected: yield* materialize(user, block.selected) }
        }
        const block = yield* idle(user, workspaceID, blockID)
        if ((block?.revision ?? 0) !== expectedRevision)
          return yield* new CanvasTabService.StaleRevisionError({
            workspaceID,
            blockID,
            expectedRevision,
            currentRevision: block?.revision ?? 0,
          })
        const relay = yield* call(() => worker.createTab(user, workspaceID, blockID, requestID))
        if (relay.tabID !== requestID || relay.readonly)
          return yield* new ChatProxyTabError({
            message: relay.error ?? "Connect ChatGPT in Settings before creating a conversation.",
          })
        yield* authorize(user, workspaceID, blockID)
        return yield* input.events.atomic(
          Effect.gen(function* () {
            const result = yield* input.tabs.add(
              {
                workspaceID,
                kind,
                blockID,
                conversationID: requestID,
                title: relay.title ?? "New conversation",
                createdAt: relay.createdAt ?? Date.now(),
              },
              expectedRevision,
              requestID,
            )
            yield* persist(result.selected, blockID, relay)
            yield* changed(workspaceID, blockID, result.revision)
            return { revision: result.revision, selected: { ...result.selected, writable: true } }
          }),
        )
      }),
    )
  const select = (
    restoring: boolean,
    user: string,
    workspaceID: Workspace.ID,
    blockID: string,
    tabID: string,
    expectedRevision: number,
  ) =>
    withBlock(
      workspaceID,
      blockID,
      Effect.gen(function* () {
        yield* authorize(user, workspaceID, blockID)
        yield* idle(user, workspaceID, blockID)
        const entry = yield* input.tabs.get(workspaceID, kind, tabID)
        if (!entry) return yield* new CanvasTabService.NotFoundError({ workspaceID, kind, blockID, tabID })
        if (!restoring) yield* target(workspaceID, blockID, tabID)
        const available = yield* call(() => worker.isLiveTab(user, workspaceID, entry.conversationID))
        if (available && restoring && entry.archivedAt !== undefined) {
          const saved = yield* input.tabs.savedSnapshot(workspaceID, tabID)
          if (saved?.sourceBlockID) {
            const deleted = yield* input.tabs.block(workspaceID, kind, saved.sourceBlockID).pipe(
              Effect.map(() => false),
              Effect.catchTag("CanvasTab.DeletedBlockError", () => Effect.succeed(true)),
            )
            if (!deleted) return yield* new CanvasTabService.BusyError({ workspaceID, kind, blockID, tabID })
            yield* call(() => worker.archiveBlock(user, workspaceID, saved.sourceBlockID!))
          }
        }
        return yield* input.events.atomic(
          Effect.gen(function* () {
            const result = yield* (restoring ? input.tabs.restore : input.tabs.select)(
              { workspaceID, kind, blockID, tabID },
              expectedRevision,
            )
            const expiresAt = Date.now() + 5_000
            const live = available
              ? yield* call(() =>
                  restoring
                    ? worker.restoreTab(user, workspaceID, blockID, entry.conversationID, expiresAt)
                    : worker.selectTab(user, workspaceID, blockID, entry.conversationID, expiresAt),
                ).pipe(
                  Effect.timeout("5 seconds"),
                  Effect.catchTag("TimeoutError", () =>
                    Effect.fail(
                      new ChatProxyTabError({ message: "ChatGPT tab selection timed out. Reload before retrying." }),
                    ),
                  ),
                )
              : undefined
            if (live && !live.readonly) yield* persist(result.selected, blockID, live)
            yield* changed(workspaceID, blockID, result.revision)
            return { revision: result.revision, selected: { ...result.selected, writable: !!live && !live.readonly } }
          }),
        )
      }),
    )
  const snapshotTab = (user: string, workspaceID: Workspace.ID, blockID: string, tabID: string) =>
    withBlock(
      workspaceID,
      blockID,
      Effect.gen(function* () {
        yield* authorize(user, workspaceID, blockID)
        const entry = yield* target(workspaceID, blockID, tabID)
        return yield* snapshot(user, entry, blockID)
      }),
    )
  const observe = (user: string, workspaceID: Workspace.ID, blockID: string, relay: ChatProxy.Relay) =>
    Effect.gen(function* () {
      if (relay.status !== "thinking" || relay.readonly || !relay.tabID) return
      const tabID = relay.tabID
      const key = JSON.stringify([user, workspaceID, tabID])
      if (observers.has(key)) return
      observers.add(key)
      yield* Effect.gen(function* () {
        let failures = 0
        while (true) {
          yield* Effect.sleep(Math.min(500 * 2 ** failures, 8_000))
          const next = yield* snapshotTab(user, workspaceID, blockID, tabID).pipe(
            Effect.timeout("5 seconds"),
            Effect.catchTag("TimeoutError", () =>
              Effect.fail(new ChatProxyTabError({ message: "Relay snapshot timed out" })),
            ),
            Effect.map((value) => (value.status === "thinking" && !value.readonly ? "continue" : "stop")),
            Effect.catch((error) => Effect.succeed(error instanceof ChatProxyTabError ? "retry" : "stop")),
          )
          if (next === "stop") return
          failures = next === "retry" ? failures + 1 : 0
          if (failures === 5) {
            yield* Effect.logWarning("Relay transcript observation stopped after repeated worker failures", {
              workspaceID,
              blockID,
              tabID,
            })
            return
          }
        }
      }).pipe(
        Effect.ensuring(Effect.sync(() => observers.delete(key))),
        Effect.forkIn(input.scope, { startImmediately: true }),
      )
    })
  const mutate = <A extends ChatProxy.Relay | null>(
    user: string,
    workspaceID: Workspace.ID,
    blockID: string,
    tabID: string,
    run: (conversationID: string) => Promise<A>,
  ) =>
    withBlock(
      workspaceID,
      blockID,
      Effect.gen(function* () {
        yield* authorize(user, workspaceID, blockID)
        const entry = yield* target(workspaceID, blockID, tabID)
        const live = yield* snapshot(user, entry, blockID)
        if (live.readonly)
          return yield* new ChatProxyTabError({
            message: "This saved conversation is read-only. Start a new conversation to continue.",
          })
        const result = yield* call(() => run(entry.conversationID))
        if (!result) return null
        const saved = yield* persist(entry, blockID, result)
        yield* observe(user, workspaceID, blockID, saved)
        return saved
      }),
    )
  return {
    withBlock,
    ensure,
    relay: ensure,
    createTab,
    snapshotTab,
    materialize,
    selectTab: (user: string, workspaceID: Workspace.ID, blockID: string, tabID: string, revision: number) =>
      select(false, user, workspaceID, blockID, tabID, revision),
    restoreTab: (user: string, workspaceID: Workspace.ID, blockID: string, tabID: string, revision: number) =>
      select(true, user, workspaceID, blockID, tabID, revision),
    prompt: (
      user: string,
      workspaceID: Workspace.ID,
      blockID: string,
      tabID: string,
      messageID: string,
      text: string,
      browserText?: string,
      requestIdentity?: string,
      files?: ChatProxy.PromptPayload["files"],
    ) =>
      mutate(user, workspaceID, blockID, tabID, (id) =>
        worker.prompt(user, workspaceID, blockID, id, messageID, text, browserText, requestIdentity, files),
      ).pipe(Effect.map((value) => value!)),
    reconcilePrompt: (
      user: string,
      workspaceID: Workspace.ID,
      blockID: string,
      tabID: string,
      messageID: string,
      identity: string,
    ) =>
      withBlock(
        workspaceID,
        blockID,
        Effect.gen(function* () {
          yield* authorize(user, workspaceID, blockID)
          const entry = yield* target(workspaceID, blockID, tabID)
          const accepted = yield* call(() =>
            worker.reconcilePrompt(user, workspaceID, blockID, entry.conversationID, messageID, identity),
          )
          if (!accepted) return null
          const saved = yield* persist(entry, blockID, accepted)
          yield* observe(user, workspaceID, blockID, saved)
          return saved
        }),
      ),
    openRelay: (user: string, workspaceID: Workspace.ID, blockID: string, tabID: string) =>
      mutate(user, workspaceID, blockID, tabID, (id) => worker.openRelay(user, workspaceID, blockID, id)).pipe(
        Effect.map((value) => value!),
      ),
    options: (user: string, workspaceID: Workspace.ID, blockID: string, tabID: string) =>
      mutate(user, workspaceID, blockID, tabID, (id) => worker.options(user, workspaceID, blockID, id)).pipe(
        Effect.map((value) => value!),
      ),
    configure: (
      user: string,
      workspaceID: Workspace.ID,
      blockID: string,
      tabID: string,
      model?: string,
      effort?: string,
    ) =>
      mutate(user, workspaceID, blockID, tabID, (id) =>
        worker.configure(user, workspaceID, blockID, id, model, effort),
      ).pipe(Effect.map((value) => value!)),
    prepareArchive: (user: string, workspaceID: Workspace.ID, blockID: string) =>
      Effect.gen(function* () {
        yield* authorize(user, workspaceID, blockID)
        let cursor: CanvasTab.Cursor | null = null
        do {
          const page: CanvasTab.Page = yield* input.tabs.listOwned(workspaceID, kind, blockID, cursor, 100)
          for (const entry of page.items) {
            const relay = yield* snapshot(user, entry, blockID)
            if (relay.status === "thinking" || relay.busy)
              return yield* new CanvasTabService.BusyError({ workspaceID, kind, blockID, tabID: entry.id })
          }
          cursor = page.next
        } while (cursor)
      }),
    archiveBlock: (user: string, workspaceID: Workspace.ID, blockID: string) =>
      Effect.gen(function* () {
        yield* input.workspace.get(workspaceID, user)
        const deleted = yield* input.tabs.block(workspaceID, kind, blockID).pipe(
          Effect.map(() => false),
          Effect.catchTag("CanvasTab.DeletedBlockError", () => Effect.succeed(true)),
        )
        if (!deleted) return yield* new CanvasTabService.BusyError({ workspaceID, kind, blockID })
        yield* call(() => worker.archiveBlock(user, workspaceID, blockID)).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Relay archive worker detach failed; durable registry remains authoritative", error),
          ),
        )
      }),
  }
}

async function provider(method: string, user: string) {
  const value = Schema.decodeUnknownSync(ChatProxy.Provider)(
    await request(method, { user, profile: profileDirectory(user) }),
  )
  if ((method === "connect" || method === "open" || value.status === "ready") && value.status !== "error") {
    const profile = profileDirectory(user)
    if (!existsSync(path.join(profile, "connection.json"))) {
      await mkdir(profile, { recursive: true })
      await writeFile(path.join(profile, "connection.json"), JSON.stringify({ enabled: true }))
    }
  }
  return value
}

async function relay(
  method:
    | "relay"
    | "ensure"
    | "reset"
    | "prompt"
    | "openRelay"
    | "options"
    | "configure"
    | "createTab"
    | "selectTab"
    | "snapshotTab"
    | "restoreTab",
  user: string,
  workspaceID: string,
  blockID: string,
  payload = {},
) {
  if (method === "ensure" || method === "relay" || method === "reset" || method === "createTab") await restore(user)
  if (!state.worker && process.env.OPENCODE_CHAT_PROXY_SOCKET) state.worker = startWorker()
  if (!state.worker) {
    if (method !== "ensure" && method !== "relay" && method !== "reset" && method !== "createTab")
      return Promise.reject(new Error("Connect ChatGPT in Settings before using this chat tab."))
    return Promise.resolve(
      Schema.decodeUnknownSync(ChatProxy.Relay)({
        providerID: "chatgpt",
        workspaceID,
        blockID,
        status: "disconnected",
        messages: [],
      }),
    )
  }
  return request(method, { user, workspaceID, blockID, profile: profileDirectory(user), ...payload }).then(
    Schema.decodeUnknownSync(ChatProxy.Relay),
  )
}

function restore(user: string) {
  const current = restored.get(user)
  if (current) return current
  const profile = profileDirectory(user)
  // Preferences also recognizes dedicated profiles created before connection intent was persisted.
  if (!existsSync(path.join(profile, "connection.json")) && !existsSync(path.join(profile, "Default", "Preferences")))
    return
  const pending = provider("restore", user).finally(() => {
    if (restored.get(user) === pending) restored.delete(user)
  })
  restored.set(user, pending)
  return pending
}

function cleanup(method: "close" | "closeWorkspace" | "archiveBlock", payload: Record<string, unknown>) {
  const worker = state.worker ?? (process.env.OPENCODE_CHAT_PROXY_SOCKET ? (state.worker = startWorker()) : undefined)
  if (!worker || worker.exitCode !== null) return Promise.resolve()
  return request(method, payload, worker).then(() => undefined)
}

function request(method: string, payload: Record<string, unknown>, worker = (state.worker ??= startWorker())) {
  if (worker.exitCode !== null) return Promise.reject(new Error("ChatGPT browser worker is not running"))
  const id = randomUUID()
  return new Promise<unknown>((resolve, reject) => {
    requests.set(id, {
      resolve,
      reject,
      timeout: setTimeout(() => {
        requests.delete(id)
        reject(new Error("ChatGPT browser request timed out. Open its tab to check before sending again."))
      }, 90_000),
    })
    try {
      worker.input.write(`${JSON.stringify({ id, method, ...payload })}\n`, (error?: Error | null) => {
        if (error) finish(id, new Error("Could not contact the ChatGPT browser worker"))
      })
    } catch {
      finish(id, new Error("Could not contact the ChatGPT browser worker"))
    }
  })
}

function startWorker() {
  const endpoint = process.env.OPENCODE_CHAT_PROXY_SOCKET
  const node =
    process.env.OPENCODE_CHAT_PROXY_NODE ??
    ("bun" in process.versions || "electron" in process.versions ? "node" : process.execPath)
  const packaged = path.join(path.dirname(process.execPath), "chat-relay", "chat-proxy-worker.mjs")
  const adjacent = fileURLToPath(new URL("./chat-proxy-worker.mjs", import.meta.url))
  const unpacked = adjacent.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
  const script = existsSync(packaged) ? packaged : existsSync(unpacked) ? unpacked : adjacent
  if (!existsSync(script)) throw new Error("The ChatGPT browser runtime is missing from this installation")
  const worker = endpoint ? socketWorker(endpoint) : childWorker(node, script)
  const stop = () => worker.kill()
  const stopped = (error: Error) => {
    process.off("exit", stop)
    if (state.worker !== worker) return
    state.worker = undefined
    restored.clear()
    requests.forEach((_, id) => finish(id, error))
  }
  process.once("exit", stop)
  worker.once("error", () => {
    stopped(new Error("ChatGPT browser worker could not start. Install Node.js and Microsoft Edge."))
  })
  worker.input.on("error", () => {
    stopped(new Error("Could not contact the ChatGPT browser worker"))
    worker.kill()
  })
  worker.once("close", () => {
    stopped(new Error("ChatGPT browser worker stopped. Reconnect ChatGPT in Settings to continue."))
  })
  void readWorker(worker.output).catch(() => {
    if (state.worker !== worker) return
    stopped(new Error("ChatGPT browser worker returned an invalid response"))
    worker.kill()
  })
  return worker
}

function socketWorker(endpoint: string) {
  const socket = createConnection(endpoint)
  return {
    input: socket,
    output: socket,
    get exitCode() {
      return socket.destroyed ? 0 : null
    },
    kill: () => socket.destroy(),
    once: socket.once.bind(socket),
  }
}

function childWorker(node: string, script: string) {
  const child = spawn(node, [script], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  })
  return {
    input: child.stdin,
    output: child.stdout,
    get exitCode() {
      return child.exitCode
    },
    kill: () => child.kill(),
    once: child.once.bind(child),
  }
}

async function readWorker(stdout: NodeJS.ReadableStream) {
  const lines = createInterface({ input: stdout, crlfDelay: Number.POSITIVE_INFINITY })
  for await (const line of lines) {
    if (!line) continue
    const reply = Schema.decodeUnknownSync(Reply)(Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(line))
    const pending = requests.get(reply.id)
    if (!pending) continue
    clearTimeout(pending.timeout)
    requests.delete(reply.id)
    if (!reply.ok) {
      pending.reject(new Error(reply.error))
      continue
    }
    pending.resolve(reply.value)
  }
}

function finish(id: string, error: Error) {
  const pending = requests.get(id)
  if (!pending) return
  clearTimeout(pending.timeout)
  requests.delete(id)
  pending.reject(error)
}

function profileDirectory(user: string) {
  return path.join(Global.Path.data, "chat-relay-browser", createHash("sha256").update(user).digest("hex"))
}
