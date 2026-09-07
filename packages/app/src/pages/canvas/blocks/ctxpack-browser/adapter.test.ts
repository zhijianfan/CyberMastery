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
  kind: "list" | "get" | "patch" | "remove" | "restore"
  args: unknown[]
  signal: AbortSignal | undefined
  settle: Deferred<unknown>
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
      calls.push({ kind, args, signal: opts?.signal, settle })
      return settle.promise
    }
  const sdk = {
    list: make("list"),
    get: make("get"),
    patch: make("patch"),
    remove: make("remove"),
    restore: make("restore"),
  }
  return { sdk, calls }
}

const listCalls = (calls: FakeCall[]) => calls.filter((call) => call.kind === "list")
const getCalls = (calls: FakeCall[]) => calls.filter((call) => call.kind === "get")

const respondList = (call: FakeCall, items: CtxPackSummary[], nextCursor: string | null = null) => {
  call.settle.resolve({ data: { items, nextCursor, totalEstimate: null } })
}

const failCall = (call: FakeCall, error: unknown) => {
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
    const properties = (typeof event.properties === "object" && event.properties !== null
      ? event.properties
      : {}) as Record<string, unknown>
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
    read: <T,>(key: string) => localView.get(key) as T | undefined,
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

const resolveToReady = async (services: BlockRuntimeServices, items: CtxPackSummary[], nextCursor: string | null = null) => {
  const promise = startResolve(services)
  await flush()
  const call = listCalls(callsOf(services))[0]
  expect(call).toBeDefined()
  respondList(call, items, nextCursor)
  const resolved = await promise
  expect(resolved.status).toBe("ready")
  return resolved
}

const dispatch = (
  resolved: CtxPackBrowserResolved,
  services: BlockRuntimeServices,
  command: Parameters<NonNullable<(typeof ctxPackBrowserRegistration)["dispatch"]>>[0]["command"],
) => ctxPackBrowserRegistration.dispatch!({ resolved, command, services, signal: new AbortController().signal })

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
      expect(requests[0]).toEqual({
        method: "GET",
        path: "/api/workspace/ws-1/ctxpack",
        query: { query: "", includeDeleted: "false", sort: "created-desc", limit: "30" },
        body: null,
      })
      await dispatch(resolved, services, {
        type: "set-query",
        patch: { query: "report", keyword: "work", createdAfter: 0, createdBefore: 1000, includeDeleted: true },
      })
      expect(requests[1].query).toEqual({
        query: "report",
        keyword: "work",
        createdAfter: "0",
        createdBefore: "1000",
        includeDeleted: "true",
        sort: "created-desc",
        limit: "30",
      })
      await dispatch(resolved, services, { type: "open", ctxPackID: "pack-1" })
      expect(requests[2].path).toBe("/api/workspace/ws-1/ctxpack/pack-1")
      expect(resolved.selected?.id).toBe("pack-1")

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
      expect(requests.find((request) => request.method === "DELETE")).toEqual({
        method: "DELETE",
        path: "/api/workspace/ws-1/ctxpack/pack-1",
        query: {},
        body: { expectedRevision: 1 },
      })
      await dispatch(resolved, services, { type: "restore", ctxPackID: "pack-1", expectedRevision: 1 })
      expect(requests.find((request) => request.method === "POST")).toEqual({
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
  test("resolve awaits descriptor persistence, restores the query, then issues ONE initial list with the default query", async () => {
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
      query: { ...defaultQuery(), query: "restored", sort: "title-asc", cursor: "stale-cursor", workspaceID: "ws-other" },
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
    await promise
  })

  test("permission-denied SDK error on the initial fetch → status permission-denied (no fake empty list)", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const promise = startResolve(services)
    await flush()
    failCall(listCalls(fake.calls)[0], { status: 403, code: "permission-denied" })
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
    const resolved2 = await promise2
    expect(resolved2.status).toBe("ready")
    expect(resolved2.items.map((item) => item.id)).toEqual(["pack-b"])

    respondList(call1, [summary("pack-a")])
    const resolved1 = await promise1
    expect(resolved1.status).toBe("loading")
    expect(resolved1.items).toEqual([])
  })

  test("matching events invalidate and a burst of 3 coalesces into exactly one refetch; non-matching events are ignored", async () => {
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

    // burst of 3 matching events via the router listener
    for (let i = 0; i < 3; i += 1) {
      router.emit({ type: "workspace.ctxpack.changed", properties: { workspaceID: WORKSPACE_ID } })
    }
    expect(listCalls(fake.calls)).toHaveLength(1) // debounce has not fired

    await sleep(220)
    expect(listCalls(fake.calls)).toHaveLength(2) // exactly one coalesced refetch

    respondList(listCalls(fake.calls)[1], [summary("pack-a"), summary("pack-c")])
    await flush()
    expect(resolved.status).toBe("ready")
    expect(resolved.items.map((item) => item.id)).toEqual(["pack-a", "pack-c"])

    // eventKeys contract
    expect(ctxPackBrowserRegistration.eventKeys!(resolved)).toEqual([
      { type: "workspace.ctxpack.changed", workspaceID: WORKSPACE_ID },
    ])
  })

  test("reconnect forces an authoritative refetch (no debounce)", async () => {
    const fake = createFakeSdk()
    const { services, router } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-a")])
    expect(listCalls(fake.calls)).toHaveLength(1)

    router.reconnect()
    expect(listCalls(fake.calls)).toHaveLength(2)

    respondList(listCalls(fake.calls)[1], [summary("pack-a"), summary("pack-b")])
    await flush()
    expect(resolved.status).toBe("ready")
    expect(resolved.items.map((item) => item.id)).toEqual(["pack-a", "pack-b"])
  })

  test("transient refetch failure keeps last valid items and marks status stale; next success restores ready", async () => {
    const fake = createFakeSdk()
    const { services, router } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-a")])

    router.emit({ type: "workspace.ctxpack.changed", properties: { workspaceID: WORKSPACE_ID } })
    await sleep(220)
    const failed = listCalls(fake.calls)[1]
    failCall(failed, { status: 500, code: "internal" })
    await flush()

    expect(resolved.status).toBe("stale")
    expect(resolved.errorCode).toBe("internal")
    expect(resolved.items.map((item) => item.id)).toEqual(["pack-a"])

    router.emit({ type: "workspace.ctxpack.changed", properties: { workspaceID: WORKSPACE_ID } })
    await sleep(220)
    respondList(listCalls(fake.calls)[2], [summary("pack-a"), summary("pack-d")])
    await flush()

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
    expect(resolved.requestGeneration).toBe(3) // initial + load-more + set-query

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
      selected: null,
      loadingMore: false,
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
    const stub = await promise
    const loadingView = ctxPackBrowserRegistration.select({ resolved: stub, projection: undefined, localView: undefined })
    expect(loadingView.status).toBe("loading")
    expect(loadingView.items).toEqual([])
    expect(loadingView.canPatch).toBe(true)
  })

  test("dispose unsubscribes listeners, aborts in-flight requests, and drops late responses", async () => {
    const fake = createFakeSdk()
    const { services, router } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-a")], "cur-1")
    expect(router.listeners).toHaveLength(1)
    expect(router.listeners[0].key).toEqual({ type: "workspace.ctxpack.changed", workspaceID: WORKSPACE_ID })

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
})
