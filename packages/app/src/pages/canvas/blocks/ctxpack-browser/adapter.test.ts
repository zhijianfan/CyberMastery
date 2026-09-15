/**
 * CtxPackBrowser runtime adapter tests — fake services + fake SDK.
 *
 * Every SDK call is deferred: tests control exactly when responses (or errors)
 * are delivered, which is required to prove abort/generation/epoch guards.
 */

import { describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

import type {
  BlockLocalViewStore,
  BlockRuntimeEventRouter,
  BlockRuntimeServices,
  CanvasBlockDescriptor,
} from "../../runtime/contracts"
import { ctxPackBrowserRegistration, type CtxPackBrowserResolved } from "./adapter"
import type { CtxPackInfo, CtxPackListQuery, CtxPackSummary } from "./types"

const WORKSPACE_ID = "ws-1"
const BLOCK_ID = "block-ctxpack-1"
const LOCAL_VIEW_KEY = `opencode.canvas.local-view.v1:ctxpack-browser:${BLOCK_ID}`

const block: CanvasBlockDescriptor = {
  id: BLOCK_ID,
  functionalityID: "builtin:ctxpack-browser",
  transform: { x: 0, y: 0, w: 12, h: 8, z: 1 },
}

const defaultQuery = (): CtxPackListQuery => ({
  workspaceID: WORKSPACE_ID,
  query: "",
  keyword: null,
  sourceBlockID: null,
  sourceFunctionalityID: null,
  sourceKind: null,
  sensitivity: null,
  createdAfter: null,
  createdBefore: null,
  includeDeleted: false,
  sort: "created-desc",
  cursor: null,
  limit: 30,
})

const summary = (id: string, overrides: Partial<CtxPackSummary> = {}): CtxPackSummary => ({
  id,
  workspaceID: WORKSPACE_ID,
  title: `Pack ${id}`,
  keywords: [],
  sensitivity: "workspace",
  revision: 1,
  contentHash: `hash-${id}`,
  byteLength: 16,
  estimatedTokens: 4,
  fragmentCount: 1,
  sourceBlockIDs: [],
  sourceFunctionalityIDs: [],
  sourceKinds: [],
  usage: { attachedCount: 0, lastAttachedAt: null },
  pinnedAt: null,
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
  ...overrides,
})

const info = (id: string, overrides: Partial<CtxPackInfo> = {}): CtxPackInfo => ({
  id,
  workspaceID: WORKSPACE_ID,
  title: `Pack ${id}`,
  keywords: [],
  sensitivity: "workspace",
  revision: 1,
  contentHash: `hash-${id}`,
  byteLength: 16,
  estimatedTokens: 4,
  fragments: [],
  usage: { attachedCount: 0, lastAttachedAt: null },
  pinnedAt: null,
  createdByUserID: "user-1",
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
  ...overrides,
})

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface FakeCall {
  kind: "list" | "get" | "patch" | "remove" | "restore" | "pin" | "unpin"
  args: unknown[]
  signal: AbortSignal | undefined
  settle: Deferred<unknown>
  settled: boolean
}

const createFakeSdk = () => {
  const calls: FakeCall[] = []
  const make =
    (kind: FakeCall["kind"]) =>
    (...args: unknown[]): Promise<unknown> => {
      const settle = deferred<unknown>()
      const last = args[args.length - 1]
      const opts = (typeof last === "object" && last !== null && "signal" in last ? last : undefined) as
        | { signal?: AbortSignal }
        | undefined
      calls.push({ kind, args, signal: opts?.signal, settle, settled: false })
      return settle.promise
    }
  const sdk = {
    list: make("list"),
    get: make("get"),
    patch: make("patch"),
    remove: make("remove"),
    restore: make("restore"),
    pin: make("pin"),
    unpin: make("unpin"),
  }
  return { sdk, calls }
}

const allListCalls = (calls: FakeCall[]) => calls.filter((call) => call.kind === "list")
const listCalls = (calls: FakeCall[]) =>
  allListCalls(calls).filter((call) => (call.args[0] as { pinnedOnly?: string }).pinnedOnly !== "true")
const pinnedListCalls = (calls: FakeCall[]) =>
  allListCalls(calls).filter((call) => (call.args[0] as { pinnedOnly?: string }).pinnedOnly === "true")
const getCalls = (calls: FakeCall[]) => calls.filter((call) => call.kind === "get")

const respondList = (call: FakeCall, items: CtxPackSummary[], nextCursor: string | null = null) => {
  call.settled = true
  call.settle.resolve({ data: { items, nextCursor, totalEstimate: null } })
}

const failCall = (call: FakeCall, error: unknown) => {
  call.settled = true
  call.settle.reject(error)
}

type RoutedEvent = { type: string; properties: unknown }

const createFakeRouter = () => {
  const listeners: Array<{
    key: { type: string; workspaceID?: string }
    listener: (event: RoutedEvent) => void
    unsubscribed: boolean
  }> = []
  const reconnectHandlers = new Set<() => void>()

  const router: BlockRuntimeEventRouter = {
    on(key, listener) {
      const entry = {
        key: key as { type: string; workspaceID?: string },
        listener: listener as (event: RoutedEvent) => void,
        unsubscribed: false,
      }
      listeners.push(entry)
      return () => {
        entry.unsubscribed = true
      }
    },
    off() {},
    onReconnect(handler) {
      reconnectHandlers.add(handler)
      return () => {
        reconnectHandlers.delete(handler)
      }
    },
  }

  const emit = (event: RoutedEvent) => {
    const properties = (
      typeof event.properties === "object" && event.properties !== null ? event.properties : {}
    ) as Record<string, unknown>
    for (const entry of listeners) {
      if (entry.unsubscribed) continue
      if (entry.key.type !== event.type) continue
      if (entry.key.workspaceID !== undefined && entry.key.workspaceID !== properties.workspaceID) continue
      entry.listener(event)
    }
  }
  const reconnect = () => {
    for (const handler of reconnectHandlers) handler()
  }

  return { router, emit, reconnect, listeners }
}

// The fake SDK is reachable through the services accessor; the registry maps
// the fake SDK object to its call log so helpers can reach it from services.
const sdkRegistry = new WeakMap<object, FakeCall[]>()

const callsOf = (services: BlockRuntimeServices): FakeCall[] => {
  const sdk = (services.serverSDK() as unknown as { client: { v2: { workspace: { ctxpack: object } } } }).client.v2
    .workspace.ctxpack
  return sdkRegistry.get(sdk) ?? []
}

const createFakeServices = (sdk: unknown) => {
  const router = createFakeRouter()
  const localView = new Map<string, unknown>()
  const descriptorAwaitCalls: string[] = []
  let epoch = 1

  const store: BlockLocalViewStore = {
    read: <T>(key: string) => localView.get(key) as T | undefined,
    write: (key, value) => {
      localView.set(key, value)
    },
    delete: (key) => {
      localView.delete(key)
    },
    clearAll: () => {
      localView.clear()
    },
  }

  const services = {
    serverSDK: () => ({ client: { v2: { workspace: { ctxpack: sdk } } } }),
    eventRouter: router.router,
    workspace: {
      id: () => WORKSPACE_ID,
      epoch: () => epoch,
      connected: () => true,
      awaitDescriptorPersisted: async (blockID: string, signal?: AbortSignal) => {
        descriptorAwaitCalls.push(blockID)
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      },
    },
    localView: store,
  } as unknown as BlockRuntimeServices

  return { services, router, localView, descriptorAwaitCalls, bumpEpoch: () => (epoch += 1) }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// NOTE: deliberately NOT async — an async wrapper that `return promise` would
// adopt the resolve promise, and awaiting it before responding to the initial
// list call would deadlock. Callers: start the resolve, flush, respond, await.
const startResolve = (services: BlockRuntimeServices, signal?: AbortSignal) =>
  ctxPackBrowserRegistration.resolve({
    workspaceID: WORKSPACE_ID,
    block,
    services,
    signal: signal ?? new AbortController().signal,
  })

const resolveToReady = async (
  services: BlockRuntimeServices,
  items: CtxPackSummary[],
  nextCursor: string | null = null,
) => {
  const promise = startResolve(services)
  await flush()
  const call = listCalls(callsOf(services))[0]
  const pinned = allListCalls(callsOf(services)).find((entry) => (entry.args[0] as { pinnedOnly?: string }).pinnedOnly === "true")
  expect(call).toBeDefined()
  expect(pinned).toBeDefined()
  respondList(call, items, nextCursor)
  respondList(pinned!, [])
  const resolved = await promise
  expect(resolved.status).toBe("ready")
  return resolved
}

const settlePinned = (calls: FakeCall[], from = 0) => {
  for (const call of pinnedListCalls(calls).slice(from).filter((entry) => !entry.settled)) respondList(call, [])
}

const dispatch = (
  resolved: CtxPackBrowserResolved,
  services: BlockRuntimeServices,
  command: Parameters<NonNullable<(typeof ctxPackBrowserRegistration)["dispatch"]>>[0]["command"],
) => {
  const calls = callsOf(services)
  const beforePinned = pinnedListCalls(calls).length
  const pending = ctxPackBrowserRegistration.dispatch!({
    resolved,
    command,
    services,
    signal: new AbortController().signal,
  })
  if (command.type === "patch-metadata" || command.type === "remove" || command.type === "restore") {
    void flush().then(() => settlePinned(calls, beforePinned))
  }
  return pending
}

const refresh = (resolved: CtxPackBrowserResolved, services: BlockRuntimeServices) => {
  const calls = callsOf(services)
  const beforePinned = pinnedListCalls(calls).length
  const pending = ctxPackBrowserRegistration.refresh!({ resolved, services, signal: new AbortController().signal })
  void flush().then(() => settlePinned(calls, beforePinned))
  return pending
}

type OnEventInput = Parameters<NonNullable<(typeof ctxPackBrowserRegistration)["onEvent"]>>[0]

const onEvent = (event: RoutedEvent, resolved: CtxPackBrowserResolved, services: BlockRuntimeServices) =>
  ctxPackBrowserRegistration.onEvent!({ event, resolved, services } as unknown as OnEventInput)

describe("ctxpack-browser generated SDK transport", () => {
  test("sends workspace-scoped detail and mutation requests with the server payloads", async () => {
    const requests: Array<{ method: string; path: string; query: Record<string, string>; body: unknown }> = []
    const client = createOpencodeClient({
      baseUrl: "http://ctxpack.test",
      fetch: Object.assign(
        async (input: Parameters<typeof fetch>[0]) => {
          const request = new Request(input)
          const url = new URL(request.url)
          requests.push({
            method: request.method,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            body: request.body ? await request.json() : null,
          })
          if (url.pathname === "/api/workspace/ws-1/ctxpack")
            return Response.json({ items: [summary("pack-1")], nextCursor: null, totalEstimate: 1 })
          if (url.pathname === "/api/workspace/ws-1/ctxpack/pack-1/pin" && request.method === "DELETE")
            return new Response(null, { status: 204 })
          if (url.pathname === "/api/workspace/ws-1/ctxpack/pack-1/pin") return Response.json(info("pack-1"))
          if (url.pathname === "/api/workspace/ws-1/ctxpack/pack-1" && request.method === "DELETE")
            return new Response(null, { status: 204 })
          if (url.pathname.startsWith("/api/workspace/ws-1/ctxpack/pack-1")) return Response.json(info("pack-1"))
          return Response.json({ _tag: "CtxPackNotFound", message: "Wrong context pack path" }, { status: 404 })
        },
        { preconnect: fetch.preconnect },
      ),
    })
    const { services } = createFakeServices(client.v2.workspace.ctxpack)
    const resolved = await startResolve(services)
    try {
      expect(resolved.status).toBe("ready")
      const listRequests = () => requests.filter((request) => request.method === "GET" && request.path === "/api/workspace/ws-1/ctxpack")
      const searchRequests = () => listRequests().filter((request) => request.query.pinnedOnly !== "true")
      const pinnedRequests = () => listRequests().filter((request) => request.query.pinnedOnly === "true")
      expect(searchRequests()[0]).toEqual({
        method: "GET",
        path: "/api/workspace/ws-1/ctxpack",
        query: { query: "", includeDeleted: "false", sort: "created-desc", limit: "30" },
        body: null,
      })
      expect(pinnedRequests()[0]).toEqual({
        method: "GET",
        path: "/api/workspace/ws-1/ctxpack",
        query: { pinnedOnly: "true", includeDeleted: "false", sort: "created-desc", limit: "30" },
        body: null,
      })
      await dispatch(resolved, services, {
        type: "set-query",
        patch: { query: "report", keyword: "work", createdAfter: 0, createdBefore: 1000, includeDeleted: true },
      })
      expect(searchRequests().at(-1)?.query).toEqual({
        query: "report",
        keyword: "work",
        createdAfter: "0",
        createdBefore: "1000",
        includeDeleted: "true",
        sort: "created-desc",
        limit: "30",
      })
      await dispatch(resolved, services, { type: "open", ctxPackID: "pack-1" })
      expect(requests.find((request) => request.method === "GET" && request.path.endsWith("/pack-1"))?.path).toBe(
        "/api/workspace/ws-1/ctxpack/pack-1",
      )
      expect(resolved.selected?.id).toBe("pack-1")

      await dispatch(resolved, services, { type: "set-pinned", ctxPackID: "pack-1", pinned: true })
      expect(requests).toContainEqual({
        method: "POST",
        path: "/api/workspace/ws-1/ctxpack/pack-1/pin",
        query: {},
        body: null,
      })
      await dispatch(resolved, services, { type: "set-pinned", ctxPackID: "pack-1", pinned: false })
      expect(requests).toContainEqual({
        method: "DELETE",
        path: "/api/workspace/ws-1/ctxpack/pack-1/pin",
        query: {},
        body: null,
      })

      await dispatch(resolved, services, {
        type: "patch-metadata",
        ctxPackID: "pack-1",
        expectedRevision: 1,
        patch: { title: "Updated" },
      })
      expect(requests.find((request) => request.method === "PATCH")).toEqual({
        method: "PATCH",
        path: "/api/workspace/ws-1/ctxpack/pack-1",
        query: {},
        body: { expectedRevision: 1, patch: { title: "Updated" }, idempotencyKey: expect.any(String) },
      })
      await dispatch(resolved, services, { type: "remove", ctxPackID: "pack-1", expectedRevision: 1 })
      expect(
        requests.find(
          (request) => request.method === "DELETE" && request.path === "/api/workspace/ws-1/ctxpack/pack-1",
        ),
      ).toEqual({
        method: "DELETE",
        path: "/api/workspace/ws-1/ctxpack/pack-1",
        query: {},
        body: { expectedRevision: 1 },
      })
      await dispatch(resolved, services, { type: "restore", ctxPackID: "pack-1", expectedRevision: 1 })
      expect(requests.find((request) => request.path === "/api/workspace/ws-1/ctxpack/pack-1/restore")).toEqual({
        method: "POST",
        path: "/api/workspace/ws-1/ctxpack/pack-1/restore",
        query: {},
        body: { expectedRevision: 1 },
      })
    } finally {
      ctxPackBrowserRegistration.dispose?.(resolved)
    }
  })

  test("surfaces the generated client's wrapped permission error", async () => {
    const client = createOpencodeClient({
      baseUrl: "http://ctxpack.test",
      fetch: Object.assign(
        async () => Response.json({ _tag: "CtxPackPermissionDenied", operation: "ctxpack.read" }, { status: 403 }),
        { preconnect: fetch.preconnect },
      ),
    })
    const { services } = createFakeServices(client.v2.workspace.ctxpack)
    const resolved = await startResolve(services)
    try {
      expect(resolved.status).toBe("permission-denied")
      expect(resolved.errorCode).toBe("CtxPackPermissionDenied")
    } finally {
      ctxPackBrowserRegistration.dispose?.(resolved)
    }
  })
})

describe("ctxpack-browser runtime adapter", () => {
  test("resolve awaits descriptor persistence, restores the query, then issues both initial lists", async () => {
    const fake = createFakeSdk()
    const { services, descriptorAwaitCalls } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const promise = startResolve(services)
    await flush()

    expect(descriptorAwaitCalls).toEqual([BLOCK_ID])
    const calls = listCalls(fake.calls)
    expect(calls).toHaveLength(1)
    expect(calls[0].args[0]).toEqual({
      workspaceID: WORKSPACE_ID,
      query: "",
      includeDeleted: "false",
      sort: "created-desc",
      limit: "30",
    })

    respondList(calls[0], [summary("pack-a"), summary("pack-b")], "cur-1")
    settlePinned(fake.calls)
    const resolved = await promise

    expect(resolved.status).toBe("ready")
    expect(resolved.errorCode).toBeNull()
    expect(resolved.items.map((item) => item.id)).toEqual(["pack-a", "pack-b"])
    expect(resolved.nextCursor).toBe("cur-1")
    expect(resolved.revisionByPackID.get("pack-a")).toBe(1)
    expect(listCalls(fake.calls)).toHaveLength(1)
  })

  test("resolve restores a persisted query (cursor nulled, workspaceID pinned)", async () => {
    const fake = createFakeSdk()
    const { services, localView } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)
    localView.set(LOCAL_VIEW_KEY, {
      query: {
        ...defaultQuery(),
        query: "restored",
        sort: "title-asc",
        cursor: "stale-cursor",
        workspaceID: "ws-other",
      },
    })

    const promise = startResolve(services)
    await flush()
    const call = listCalls(fake.calls)[0]
    expect(call.args[0]).toEqual({
      query: "restored",
      sort: "title-asc",
      includeDeleted: "false",
      limit: "30",
      workspaceID: WORKSPACE_ID,
    })
    respondList(call, [])
    settlePinned(fake.calls)
    await promise
  })

  test("permission-denied SDK error on the initial fetch → status permission-denied (no fake empty list)", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const promise = startResolve(services)
    await flush()
    failCall(listCalls(fake.calls)[0], { status: 403, code: "permission-denied" })
    settlePinned(fake.calls)
    const resolved = await promise

    expect(resolved.status).toBe("permission-denied")
    expect(resolved.errorCode).toBe("permission-denied")
    expect(resolved.items).toEqual([])
    expect(resolved.nextCursor).toBeNull()
  })

  test("unavailable host SDK error on the initial fetch → status unavailable", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const promise = startResolve(services)
    await flush()
    failCall(listCalls(fake.calls)[0], new TypeError("fetch failed"))
    failCall(pinnedListCalls(fake.calls)[0], new TypeError("fetch failed"))
    const resolved = await promise

    expect(resolved.status).toBe("unavailable")
    expect(resolved.items).toEqual([])
  })

  test("aborting the resolve signal stops state mutation (late response is dropped)", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const controller = new AbortController()
    const promise = startResolve(services, controller.signal)
    await flush()
    const call = listCalls(fake.calls)[0]

    controller.abort()
    respondList(call, [summary("pack-a")], "cur-1") // delivered after the abort
    settlePinned(fake.calls)

    const resolved = await promise
    expect(resolved.status).toBe("loading")
    expect(resolved.items).toEqual([])
    expect(resolved.nextCursor).toBeNull()
  })

  test("workspace epoch change: a late response from the old epoch cannot overwrite new state", async () => {
    const fake = createFakeSdk()
    const { services, bumpEpoch } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const promise1 = startResolve(services)
    await flush()
    const call1 = listCalls(fake.calls)[0]

    bumpEpoch()

    const promise2 = startResolve(services)
    await flush()
    const call2 = listCalls(fake.calls)[1]
    respondList(call2, [summary("pack-b")])
    settlePinned(fake.calls)
    const resolved2 = await promise2
    expect(resolved2.status).toBe("ready")
    expect(resolved2.items.map((item) => item.id)).toEqual(["pack-b"])

    respondList(call1, [summary("pack-a")])
    settlePinned(fake.calls)
    const resolved1 = await promise1
    expect(resolved1.status).toBe("loading")
    expect(resolved1.items).toEqual([])
  })

  test("matching events invalidate without subscribing or fetching outside the host", async () => {
    const fake = createFakeSdk()
    const { services, router } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-a")])
    expect(listCalls(fake.calls)).toHaveLength(1)

    // onEvent classification (direct hook)
    expect(
      onEvent({ type: "workspace.ctxpack.changed", properties: { workspaceID: WORKSPACE_ID } }, resolved, services),
    ).toBe("invalidate")
    expect(onEvent({ type: "workspace.session.text.delta", properties: {} }, resolved, services)).toBe("ignore")
    expect(
      onEvent({ type: "workspace.ctxpack.changed", properties: { workspaceID: "ws-other" } }, resolved, services),
    ).toBe("ignore")

    // Only the host owns subscriptions and schedules refreshes.
    for (let i = 0; i < 3; i += 1) {
      router.emit({ type: "workspace.ctxpack.changed", properties: { workspaceID: WORKSPACE_ID } })
    }
    expect(listCalls(fake.calls)).toHaveLength(1)
    expect(router.listeners).toHaveLength(0)

    // eventKeys contract
    expect(ctxPackBrowserRegistration.eventKeys!(resolved)).toEqual([
      { type: "workspace.ctxpack.changed", workspaceID: WORKSPACE_ID },
    ])
  })

  test("the host refresh hook fetches immediately and updates the existing projection", async () => {
    const fake = createFakeSdk()
    const { services, router } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-a")])
    expect(listCalls(fake.calls)).toHaveLength(1)

    const pending = refresh(resolved, services)
    expect(listCalls(fake.calls)).toHaveLength(2)

    respondList(listCalls(fake.calls)[1], [summary("pack-a"), summary("pack-b")])
    await pending
    expect(resolved.status).toBe("ready")
    expect(resolved.items.map((item) => item.id)).toEqual(["pack-a", "pack-b"])
  })

  test("refresh preserves the loaded range and stages every page before replacing it", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)
    const previous = [summary("a"), summary("b"), summary("c"), summary("d")]
    const resolved = await resolveToReady(services, previous.slice(0, 2), "page-2")
    const more = dispatch(resolved, services, { type: "load-more" })
    respondList(listCalls(fake.calls)[1], previous.slice(2), "page-3")
    await more
    const pending = refresh(resolved, services)
    respondList(listCalls(fake.calls)[2], [summary("a", { title: "Updated" }), summary("b")], "fresh-page-2")
    await flush()
    expect(resolved.items).toEqual(previous)
    expect(listCalls(fake.calls)[3]?.args[0]).toMatchObject({ cursor: "fresh-page-2" })
    respondList(listCalls(fake.calls)[3], previous.slice(2), "fresh-page-3")
    await pending
    expect(resolved.items.map((item) => item.id)).toEqual(["a", "b", "c", "d"])
    expect(resolved.items[0].title).toBe("Updated")
    expect(resolved.nextCursor).toBe("fresh-page-3")
  })

  test("a later-page refresh failure retains the entire previously loaded range", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)
    const previous = [summary("a"), summary("b")]
    const resolved = await resolveToReady(services, previous)
    const pending = refresh(resolved, services)
    respondList(listCalls(fake.calls)[1], [summary("a", { title: "New" })], "page-2")
    await flush()
    expect(listCalls(fake.calls)[2]).toBeDefined()
    failCall(listCalls(fake.calls)[2], new TypeError("offline"))
    await pending
    expect(resolved.items).toEqual(previous)
    expect(resolved.status).toBe("stale")
  })

  test("permission denial during refresh clears cached summaries and fragment text", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)
    const resolved = await resolveToReady(services, [summary("a")])
    const opening = dispatch(resolved, services, { type: "open", ctxPackID: "a" })
    getCalls(fake.calls)[0].settle.resolve({ data: info("a") })
    await opening
    const pending = refresh(resolved, services)
    failCall(listCalls(fake.calls)[1], { cause: { status: 403, body: { _tag: "CtxPackPermissionDeniedError" } } })
    await pending
    expect(resolved.status).toBe("permission-denied")
    expect(resolved.items).toEqual([])
    expect(resolved.selected).toBeNull()
    expect(resolved.nextCursor).toBeNull()
  })

  test.each(["CtxPackNotFoundError", "CtxPackDeletedError", "CtxPackPermissionDeniedError"])(
    "%s clears previously selected detail and refetches the list",
    async (tag) => {
      const fake = createFakeSdk()
      const { services } = createFakeServices(fake.sdk)
      sdkRegistry.set(fake.sdk, fake.calls)
      const resolved = await resolveToReady(services, [summary("a")])
      const opening = dispatch(resolved, services, { type: "open", ctxPackID: "a" })
      getCalls(fake.calls)[0].settle.resolve({ data: info("a") })
      await opening
      resolved.revisionByPackID.clear()
      const pending = dispatch(resolved, services, { type: "open", ctxPackID: "a" })
      getCalls(fake.calls)[1].settle.reject({ _tag: tag })
      await flush()
      expect(resolved.selected).toBeNull()
      expect(listCalls(fake.calls)[1]).toBeDefined()
      respondList(listCalls(fake.calls)[1], [])
      settlePinned(fake.calls)
      await pending
      expect(resolved.items).toEqual([])
    },
  )

  test("transient refetch failure keeps last valid items and marks status stale; next success restores ready", async () => {
    const fake = createFakeSdk()
    const { services, router } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-a")])

    const failedRefresh = refresh(resolved, services)
    const failed = listCalls(fake.calls)[1]
    failCall(failed, { status: 500, code: "internal" })
    await failedRefresh

    expect(resolved.status).toBe("stale")
    expect(resolved.errorCode).toBe("internal")
    expect(resolved.items.map((item) => item.id)).toEqual(["pack-a"])

    const nextRefresh = refresh(resolved, services)
    respondList(listCalls(fake.calls)[2], [summary("pack-a"), summary("pack-d")])
    await nextRefresh

    expect(resolved.status).toBe("ready")
    expect(resolved.errorCode).toBeNull()
    expect(resolved.items.map((item) => item.id)).toEqual(["pack-a", "pack-d"])
  })

  test("set-query resets cursor + generation, cancels the prior request, replaces the list, persists the query", async () => {
    const fake = createFakeSdk()
    const { services, localView } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-a"), summary("pack-b")], "cur-1")

    const loadMorePromise = dispatch(resolved, services, { type: "load-more" })
    const inFlight = listCalls(fake.calls)[1]
    expect(inFlight).toBeDefined()

    const setQueryPromise = dispatch(resolved, services, { type: "set-query", patch: { query: "foo" } })
    expect(inFlight.signal?.aborted).toBe(true) // prior in-flight request canceled
    const replace = listCalls(fake.calls)[2]
    expect(replace.args[0]).toEqual({
      workspaceID: WORKSPACE_ID,
      query: "foo",
      includeDeleted: "false",
      sort: "created-desc",
      limit: "30",
    })
    expect(localView.get(LOCAL_VIEW_KEY)).toEqual({ query: { ...defaultQuery(), query: "foo" } })

    respondList(replace, [summary("pack-c")])
    await setQueryPromise
    expect(resolved.query.query).toBe("foo")
    expect(resolved.nextCursor).toBeNull()
    expect(resolved.items.map((item) => item.id)).toEqual(["pack-c"]) // replaced, not appended
    expect(resolved.requestGeneration).toBe(4) // initial search+pinned + load-more + set-query

    // late response from the canceled load-more cannot overwrite state
    respondList(inFlight, [summary("pack-x")], "old-cursor")
    await loadMorePromise
    expect(resolved.items.map((item) => item.id)).toEqual(["pack-c"])
    expect(resolved.nextCursor).toBeNull()
  })

  test("load-more fetches with the current cursor and appends unique IDs only", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-a"), summary("pack-b")], "cur-1")

    const loadMore1 = dispatch(resolved, services, { type: "load-more" })
    const page2 = listCalls(fake.calls)[1]
    expect((page2.args[0] as CtxPackListQuery).cursor).toBe("cur-1")
    respondList(page2, [summary("pack-b"), summary("pack-c")], "cur-2")
    await loadMore1

    expect(resolved.items.map((item) => item.id)).toEqual(["pack-a", "pack-b", "pack-c"]) // b deduped
    expect(resolved.nextCursor).toBe("cur-2")

    const loadMore2 = dispatch(resolved, services, { type: "load-more" })
    const page3 = listCalls(fake.calls)[2]
    respondList(page3, [summary("pack-d")], null)
    await loadMore2
    expect(resolved.items.map((item) => item.id)).toEqual(["pack-a", "pack-b", "pack-c", "pack-d"])
    expect(resolved.nextCursor).toBeNull()

    // no fetch when there is no next cursor
    await dispatch(resolved, services, { type: "load-more" })
    expect(listCalls(fake.calls)).toHaveLength(3)
  })

  test("open stores detail and reuses it for an unchanged revision; patch/remove/restore each trigger one refetch", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-1", { revision: 1 }), summary("pack-2")])

    // open
    const openPromise = dispatch(resolved, services, { type: "open", ctxPackID: "pack-1" })
    const get1 = getCalls(fake.calls)[0]
    expect(get1).toBeDefined()
    get1.settle.resolve({ data: info("pack-1", { title: "Pack 1", revision: 1 }) })
    await openPromise
    expect(resolved.selected?.id).toBe("pack-1")
    expect(resolved.selected?.title).toBe("Pack 1")
    expect(resolved.revisionByPackID.get("pack-1")).toBe(1)

    // opening the same pack again with an unchanged revision reuses the detail
    await dispatch(resolved, services, { type: "open", ctxPackID: "pack-1" })
    expect(getCalls(fake.calls)).toHaveLength(1)

    // patch-metadata while the pack is selected → mutation + list refetch + detail refetch
    const patchPromise = dispatch(resolved, services, {
      type: "patch-metadata",
      ctxPackID: "pack-1",
      expectedRevision: 1,
      patch: { title: "T2" },
    })
    const patchCall = fake.calls.find((call) => call.kind === "patch")
    expect(patchCall?.args[0]).toEqual({
      workspaceID: WORKSPACE_ID,
      ctxPackID: "pack-1",
      ctxPackPatchPayload: { expectedRevision: 1, patch: { title: "T2" }, idempotencyKey: expect.any(String) },
    })
    patchCall!.settle.resolve({ data: info("pack-1", { revision: 2 }) })
    await flush()
    const listAfterPatch = listCalls(fake.calls)[1]
    expect(listAfterPatch).toBeDefined()
    respondList(listAfterPatch, [summary("pack-1", { revision: 2 }), summary("pack-2")])
    await flush()
    const get2 = getCalls(fake.calls)[1]
    expect(get2).toBeDefined() // detail refreshed because the revision changed
    get2.settle.resolve({ data: info("pack-1", { title: "T2", revision: 2 }) })
    await patchPromise
    expect(resolved.selected?.title).toBe("T2")
    expect(resolved.selected?.revision).toBe(2)

    // close detail, then remove → one refetch
    await dispatch(resolved, services, { type: "close-detail" })
    expect(resolved.selected).toBeNull()
    const removePromise = dispatch(resolved, services, { type: "remove", ctxPackID: "pack-2", expectedRevision: 1 })
    const removeCall = fake.calls.find((call) => call.kind === "remove")
    expect(removeCall?.args[0]).toEqual({
      workspaceID: WORKSPACE_ID,
      ctxPackID: "pack-2",
      ctxPackRevisionPayload: { expectedRevision: 1 },
    })
    removeCall!.settle.resolve({ data: info("pack-2") })
    await flush()
    const listAfterRemove = listCalls(fake.calls)[2]
    expect(listAfterRemove).toBeDefined()
    respondList(listAfterRemove, [summary("pack-1", { revision: 2 })])
    await removePromise
    expect(resolved.status).toBe("ready")

    // restore → one refetch
    const restorePromise = dispatch(resolved, services, { type: "restore", ctxPackID: "pack-3", expectedRevision: 4 })
    const restoreCall = fake.calls.find((call) => call.kind === "restore")
    expect(restoreCall?.args[0]).toEqual({
      workspaceID: WORKSPACE_ID,
      ctxPackID: "pack-3",
      ctxPackRevisionPayload: { expectedRevision: 4 },
    })
    restoreCall!.settle.resolve({ data: info("pack-3") })
    await flush()
    const listAfterRestore = listCalls(fake.calls)[3]
    expect(listAfterRestore).toBeDefined()
    respondList(listAfterRestore, [summary("pack-1", { revision: 2 }), summary("pack-3")])
    await restorePromise

    expect(listCalls(fake.calls)).toHaveLength(4) // initial + one per mutation
    expect(getCalls(fake.calls)).toHaveLength(2)
  })

  test("editing a pack on a loaded page preserves that page after the mutation", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)
    const resolved = await resolveToReady(services, [summary("a")], "page-2")
    const more = dispatch(resolved, services, { type: "load-more" })
    respondList(listCalls(fake.calls)[1], [summary("b")], "page-3")
    await more
    const pending = dispatch(resolved, services, {
      type: "patch-metadata",
      ctxPackID: "b",
      expectedRevision: 1,
      patch: { title: "Edited on page two" },
    })
    fake.calls.find((call) => call.kind === "patch")!.settle.resolve({ data: info("b", { revision: 2 }) })
    await flush()
    respondList(listCalls(fake.calls)[2], [summary("a")], "fresh-page-2")
    await flush()
    expect(listCalls(fake.calls)[3]?.args[0]).toMatchObject({ cursor: "fresh-page-2" })
    respondList(listCalls(fake.calls)[3], [summary("b", { title: "Edited on page two", revision: 2 })], "fresh-page-3")
    await pending
    expect(resolved.items.map((item) => item.id)).toEqual(["a", "b"])
    expect(resolved.items[1].title).toBe("Edited on page two")
    expect(resolved.nextCursor).toBe("fresh-page-3")
  })

  test("failed metadata mutations reject so the editor can retain its fields and display the conflict", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)
    const resolved = await resolveToReady(services, [summary("pack-1")])
    const pending = dispatch(resolved, services, {
      type: "patch-metadata",
      ctxPackID: "pack-1",
      expectedRevision: 1,
      patch: { title: "Changed" },
    })
    fake.calls
      .find((call) => call.kind === "patch")!
      .settle.reject({
        cause: { status: 409, body: { _tag: "CtxPackRevisionConflict", currentRevision: 2 } },
      })
    await expect(pending).rejects.toMatchObject({ code: "CtxPackRevisionConflict" })
    expect(resolved.items).toEqual([summary("pack-1")])
    expect(listCalls(fake.calls)).toHaveLength(1)
  })

  test("background refresh cannot swallow an in-flight metadata conflict", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)
    const resolved = await resolveToReady(services, [summary("pack-1")])
    const pending = dispatch(resolved, services, {
      type: "patch-metadata",
      ctxPackID: "pack-1",
      expectedRevision: 1,
      patch: { title: "Unsaved edit" },
    })
    const refreshing = refresh(resolved, services)
    respondList(listCalls(fake.calls)[1], [summary("pack-1", { revision: 2 })])
    await refreshing
    fake.calls
      .find((call) => call.kind === "patch")!
      .settle.reject({
        cause: { status: 409, body: { _tag: "CtxPackRevisionConflictError", currentRevision: 2 } },
      })
    await expect(pending).rejects.toMatchObject({ code: "CtxPackRevisionConflictError" })
  })

  test("open on a deleted/missing pack closes the detail and refetches the list", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-1")])
    const open1 = dispatch(resolved, services, { type: "open", ctxPackID: "pack-1" })
    getCalls(fake.calls)[0].settle.resolve({ data: info("pack-1") })
    await open1
    expect(resolved.selected).not.toBeNull()

    const open2 = dispatch(resolved, services, { type: "open", ctxPackID: "pack-gone" })
    getCalls(fake.calls)[1].settle.reject({ status: 404, code: "not-found" })
    await flush()

    expect(resolved.selected).toBeNull()
    const refetch = listCalls(fake.calls)[1]
    expect(refetch).toBeDefined()
    respondList(refetch, [summary("pack-1")])
    settlePinned(fake.calls)
    await open2
    expect(resolved.status).toBe("ready")
  })

  test("select maps resolved → exact U2 view shape (ready and loading)", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-a")], "cur-9")

    const view = ctxPackBrowserRegistration.select({ resolved, projection: undefined, localView: undefined })
    expect(view).toEqual({
      status: "ready",
      query: resolved.query,
      items: resolved.items,
      nextCursor: "cur-9",
      pinnedItems: resolved.pinnedItems,
      pinnedNextCursor: null,
      selected: null,
      loadingMore: false,
      loadingMorePinned: false,
      errorCode: null,
      canCreate: true,
      canPatch: true,
      canDelete: true,
      canMaterialize: true,
    })

    // loading stub (aborted resolve) maps to the loading view
    const controller = new AbortController()
    const promise = startResolve(services, controller.signal)
    await flush()
    const pending = listCalls(fake.calls)[1]
    controller.abort()
    respondList(pending, [summary("pack-z")]) // delivered after the abort → dropped
    settlePinned(fake.calls)
    const stub = await promise
    const loadingView = ctxPackBrowserRegistration.select({
      resolved: stub,
      projection: undefined,
      localView: undefined,
    })
    expect(loadingView.status).toBe("loading")
    expect(loadingView.items).toEqual([])
    expect(loadingView.canPatch).toBe(true)
  })

  test("dispose aborts in-flight requests and drops late responses", async () => {
    const fake = createFakeSdk()
    const { services, router } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-a")], "cur-1")
    expect(router.listeners).toHaveLength(0)

    const loadMorePromise = dispatch(resolved, services, { type: "load-more" })
    const inFlight = listCalls(fake.calls)[1]

    ctxPackBrowserRegistration.dispose!(resolved)

    expect(inFlight.signal?.aborted).toBe(true)
    expect(router.listeners.every((entry) => entry.unsubscribed)).toBe(true)

    // late response after dispose cannot mutate state
    respondList(inFlight, [summary("pack-x")])
    await loadMorePromise
    expect(resolved.items.map((item) => item.id)).toEqual(["pack-a"])

    // events and reconnects after dispose do nothing
    router.emit({ type: "workspace.ctxpack.changed", properties: { workspaceID: WORKSPACE_ID } })
    router.reconnect()
    await sleep(220)
    expect(listCalls(fake.calls)).toHaveLength(2)
  })

  test("resolve loads independent search and pinned projections with fixed pinned query", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const pending = startResolve(services)
    await flush()
    const initialLists = allListCalls(fake.calls)
    expect(initialLists).toHaveLength(2)
    expect(initialLists[1].args[0]).toMatchObject({
      workspaceID: WORKSPACE_ID,
      pinnedOnly: "true",
      includeDeleted: "false",
      sort: "created-desc",
      cursor: undefined,
      limit: "30",
    })
    respondList(initialLists[0], [summary("search-pack")])
    respondList(initialLists[1], [summary("pinned-pack", { pinnedAt: 10 })], "pinned-next")
    const resolved = await pending

    expect(resolved.items.map((item) => item.id)).toEqual(["search-pack"])
    expect(resolved.pinnedItems.map((item) => item.id)).toEqual(["pinned-pack"])
    expect(resolved.pinnedNextCursor).toBe("pinned-next")
  })

  test("load-more-pinned appends unique IDs without changing search pagination", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const pending = startResolve(services)
    await flush()
    const initialLists = allListCalls(fake.calls)
    respondList(initialLists[0], [summary("search-pack")], "search-next")
    respondList(initialLists[1], [summary("pinned-a"), summary("pinned-b")], "pinned-next")
    const resolved = await pending

    const loadMore = dispatch(resolved, services, { type: "load-more-pinned" })
    const page = allListCalls(fake.calls)[2]
    expect(page.args[0]).toMatchObject({ pinnedOnly: "true", cursor: "pinned-next" })
    respondList(page, [summary("pinned-b"), summary("pinned-c")])
    await loadMore

    expect(resolved.items.map((item) => item.id)).toEqual(["search-pack"])
    expect(resolved.nextCursor).toBe("search-next")
    expect(resolved.pinnedItems.map((item) => item.id)).toEqual(["pinned-a", "pinned-b", "pinned-c"])
    expect(resolved.pinnedNextCursor).toBeNull()
  })

  test("overlapping paging is serialized per channel while search and pinned remain independent", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const pending = startResolve(services)
    await flush()
    respondList(listCalls(fake.calls)[0], [summary("search-a")], "search-next")
    respondList(pinnedListCalls(fake.calls)[0], [summary("pinned-a", { pinnedAt: 10 })], "pinned-next")
    const resolved = await pending

    const searchPage = dispatch(resolved, services, { type: "load-more" })
    const pinnedPage = dispatch(resolved, services, { type: "load-more-pinned" })
    const duplicateSearch = dispatch(resolved, services, { type: "load-more" })
    const duplicatePinned = dispatch(resolved, services, { type: "load-more-pinned" })

    expect(listCalls(fake.calls)).toHaveLength(2)
    expect(pinnedListCalls(fake.calls)).toHaveLength(2)
    respondList(listCalls(fake.calls)[1], [summary("search-b")])
    respondList(pinnedListCalls(fake.calls)[1], [summary("pinned-b", { pinnedAt: 20 })])
    await Promise.all([searchPage, pinnedPage, duplicateSearch, duplicatePinned])

    expect(resolved.items.map((item) => item.id)).toEqual(["search-a", "search-b"])
    expect(resolved.pinnedItems.map((item) => item.id)).toEqual(["pinned-a", "pinned-b"])
  })

  test("a superseded refresh cannot clear a newer paging guard", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const pending = startResolve(services)
    await flush()
    respondList(listCalls(fake.calls)[0], [summary("search-a")], "search-next")
    respondList(pinnedListCalls(fake.calls)[0], [])
    const resolved = await pending

    const refreshing = ctxPackBrowserRegistration.refresh!({
      resolved,
      services,
      signal: new AbortController().signal,
    })
    const paging = dispatch(resolved, services, { type: "load-more" })
    expect(resolved.loadingMore).toBe(true)
    respondList(listCalls(fake.calls)[1], [summary("stale-refresh")])
    respondList(pinnedListCalls(fake.calls)[1], [])
    await flush()

    expect(resolved.loadingMore).toBe(true)
    const duplicate = dispatch(resolved, services, { type: "load-more" })
    expect(listCalls(fake.calls)).toHaveLength(3)
    respondList(listCalls(fake.calls)[2], [summary("search-b")])
    await Promise.all([refreshing, paging, duplicate])
    expect(resolved.items.map((item) => item.id)).toEqual(["search-a", "search-b"])
  })

  test("refresh revalidates detail opened only from the pinned projection", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const pending = startResolve(services)
    await flush()
    respondList(listCalls(fake.calls)[0], [])
    respondList(pinnedListCalls(fake.calls)[0], [summary("pinned-a", { pinnedAt: 10 })])
    const resolved = await pending
    const opening = dispatch(resolved, services, { type: "open", ctxPackID: "pinned-a" })
    getCalls(fake.calls)[0].settle.resolve({ data: info("pinned-a", { pinnedAt: 10 }) })
    await opening

    const refreshing = ctxPackBrowserRegistration.refresh!({
      resolved,
      services,
      signal: new AbortController().signal,
    })
    respondList(listCalls(fake.calls)[1], [])
    respondList(pinnedListCalls(fake.calls)[1], [])
    await flush()

    expect(getCalls(fake.calls)).toHaveLength(2)
    getCalls(fake.calls)[1].settle.resolve({ data: info("pinned-a", { revision: 2, pinnedAt: null }) })
    await refreshing
    expect(resolved.selected).toMatchObject({ id: "pinned-a", revision: 2, pinnedAt: null })
  })

  test("metadata mutation refreshes detail opened only from the pinned projection", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const pending = startResolve(services)
    await flush()
    respondList(listCalls(fake.calls)[0], [])
    respondList(pinnedListCalls(fake.calls)[0], [summary("pinned-a", { pinnedAt: 10 })])
    const resolved = await pending
    const opening = dispatch(resolved, services, { type: "open", ctxPackID: "pinned-a" })
    getCalls(fake.calls)[0].settle.resolve({ data: info("pinned-a", { pinnedAt: 10 }) })
    await opening

    const mutating = ctxPackBrowserRegistration.dispatch!({
      resolved,
      services,
      signal: new AbortController().signal,
      command: { type: "patch-metadata", ctxPackID: "pinned-a", expectedRevision: 1, patch: { title: "Updated" } },
    })
    fake.calls.find((call) => call.kind === "patch")!.settle.resolve({ data: info("pinned-a", { revision: 2 }) })
    await flush()
    respondList(listCalls(fake.calls)[1], [])
    respondList(pinnedListCalls(fake.calls)[1], [summary("pinned-a", { title: "Updated", revision: 2, pinnedAt: 10 })])
    await flush()
    getCalls(fake.calls)[1].settle.resolve({ data: info("pinned-a", { title: "Updated", revision: 2, pinnedAt: 10 }) })
    await mutating

    expect(resolved.selected).toMatchObject({ id: "pinned-a", title: "Updated", revision: 2, pinnedAt: 10 })
  })

  test.each([
    ["pin", true],
    ["unpin", false],
  ] as const)("set-pinned uses %s then refreshes both projections", async (operation, pinned) => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const pending = startResolve(services)
    await flush()
    const initialLists = allListCalls(fake.calls)
    respondList(initialLists[0], [summary("search-pack")])
    respondList(initialLists[1], [summary("pinned-pack")])
    const resolved = await pending

    const mutating = dispatch(resolved, services, { type: "set-pinned", ctxPackID: "search-pack", pinned })
    const mutation = fake.calls.find((call) => call.kind === operation)
    expect(mutation?.args[0]).toEqual({ workspaceID: WORKSPACE_ID, ctxPackID: "search-pack" })
    mutation!.settle.resolve({ data: info("search-pack", { pinnedAt: pinned ? 100 : null }) })
    await flush()
    const refreshed = allListCalls(fake.calls).slice(2)
    expect(refreshed).toHaveLength(2)
    expect(refreshed[0].args[0]).toMatchObject({ workspaceID: WORKSPACE_ID, query: "" })
    expect(refreshed[1].args[0]).toMatchObject({ workspaceID: WORKSPACE_ID, pinnedOnly: "true" })
    respondList(refreshed[0], [summary("search-pack", { pinnedAt: pinned ? 100 : null })])
    respondList(refreshed[1], [summary("pinned-pack", { pinnedAt: pinned ? 100 : null })])
    await mutating
  })

  test("pinning an opened pack updates detail even though pinning does not change its revision", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const pending = startResolve(services)
    await flush()
    respondList(listCalls(fake.calls)[0], [summary("search-pack")])
    respondList(pinnedListCalls(fake.calls)[0], [])
    const resolved = await pending
    const opening = dispatch(resolved, services, { type: "open", ctxPackID: "search-pack" })
    getCalls(fake.calls)[0].settle.resolve({ data: info("search-pack", { pinnedAt: null }) })
    await opening

    const pinning = dispatch(resolved, services, { type: "set-pinned", ctxPackID: "search-pack", pinned: true })
    fake.calls.find((call) => call.kind === "pin")!.settle.resolve({ data: info("search-pack", { pinnedAt: 100 }) })
    await flush()
    respondList(listCalls(fake.calls)[1], [summary("search-pack", { pinnedAt: 100 })])
    respondList(pinnedListCalls(fake.calls)[1], [summary("search-pack", { pinnedAt: 100 })])
    await pinning

    expect(resolved.selected?.pinnedAt).toBe(100)
  })

  test("mixed initial failure keeps the healthy projection and reports stale", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const pending = startResolve(services)
    await flush()
    const initialLists = allListCalls(fake.calls)
    failCall(initialLists[0], { status: 503, code: "offline" })
    respondList(initialLists[1], [summary("pinned-pack")])
    const resolved = await pending

    expect(resolved.status).toBe("stale")
    expect(resolved.items).toEqual([])
    expect(resolved.pinnedItems.map((item) => item.id)).toEqual(["pinned-pack"])
    expect(resolved.errorCode).toBe("offline")
  })
})
