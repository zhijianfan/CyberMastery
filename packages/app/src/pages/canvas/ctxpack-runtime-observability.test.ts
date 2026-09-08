/**
 * CtxPack runtime observability (T1 verification lane).
 *
 * Drives the R1 adapter (ctxpack-browser registration) and the U2 view
 * contract against a fake SDK/router, then asserts the adapter SOURCE itself
 * contains no polling primitives and that the adapter's local-view persistence
 * is layout-pure ({ query } only — never items/selected/content).
 *
 * Every SDK call is deferred: tests control exactly when responses (or errors)
 * are delivered. Runs under `bun test --conditions=solid --preload ./happydom.ts`.
 */

import { describe, expect, test } from "bun:test"

import type {
  BlockLocalViewStore,
  BlockRuntimeEventRouter,
  BlockRuntimeServices,
  CanvasBlockDescriptor,
} from "./runtime/contracts"
import { ctxPackBrowserRegistration } from "./blocks/ctxpack-browser/adapter"
import type { CtxPackBrowserResolved } from "./blocks/ctxpack-browser/adapter"
import { initialCtxPackBrowserView } from "./blocks/ctxpack-browser/view-model"
import type { CtxPackInfo, CtxPackListQuery, CtxPackSummary } from "./blocks/ctxpack-browser/types"

const WORKSPACE_ID = "ws-obs-1"
const BLOCK_ID = "block-ctxpack-obs"
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
// Fakes (deferred SDK calls + event router + local view store)
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

const sdkRegistry = new WeakMap<object, FakeCall[]>()

const callsOf = (services: BlockRuntimeServices): FakeCall[] => {
  const sdk = (services.serverSDK() as unknown as { client: { v2: { workspace: { ctxpack: object } } } }).client.v2
    .workspace.ctxpack
  return sdkRegistry.get(sdk) ?? []
}

const createFakeServices = (sdk: unknown) => {
  const router = createFakeRouter()
  const writes: Array<{ key: string; value: unknown }> = []
  const localView = new Map<string, unknown>()
  let epoch = 1

  const store: BlockLocalViewStore = {
    read: <T>(key: string) => localView.get(key) as T | undefined,
    write: (key, value) => {
      writes.push({ key, value })
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
      awaitDescriptorPersisted: async () => {},
    },
    localView: store,
  } as unknown as BlockRuntimeServices

  return { services, router, localView, writes, bumpEpoch: () => (epoch += 1) }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// NOTE: deliberately NOT async — an async wrapper that `return promise` would
// adopt the resolve promise and deadlock before the initial list is answered.
const startResolve = (services: BlockRuntimeServices, signal?: AbortSignal) =>
  ctxPackBrowserRegistration.resolve({
    workspaceID: WORKSPACE_ID,
    block,
    services,
    signal: signal ?? new AbortController().signal,
  })

const resolveToReady = async (services: BlockRuntimeServices, items: CtxPackSummary[]) => {
  const promise = startResolve(services)
  await flush()
  const call = callsOf(services).find((c) => c.kind === "list")
  expect(call).toBeDefined()
  call!.settle.resolve({ data: { items, nextCursor: null, totalEstimate: null } })
  const resolved = await promise
  expect(resolved.status).toBe("ready")
  return resolved
}

const respondList = (
  services: BlockRuntimeServices,
  call: FakeCall,
  items: CtxPackSummary[],
  nextCursor: string | null = null,
) => {
  call.settle.resolve({ data: { items, nextCursor, totalEstimate: null } })
}

const listCalls = (services: BlockRuntimeServices) => callsOf(services).filter((call) => call.kind === "list")

const dispatch = (
  resolved: CtxPackBrowserResolved,
  services: BlockRuntimeServices,
  command: Parameters<NonNullable<(typeof ctxPackBrowserRegistration)["dispatch"]>>[0]["command"],
) => ctxPackBrowserRegistration.dispatch!({ resolved, command, services, signal: new AbortController().signal })

const onEvent = (event: RoutedEvent, resolved: CtxPackBrowserResolved, services: BlockRuntimeServices) =>
  ctxPackBrowserRegistration.onEvent!({ event, resolved, services } as never)

const refresh = (resolved: CtxPackBrowserResolved, services: BlockRuntimeServices) =>
  ctxPackBrowserRegistration.refresh!({ resolved, services, signal: new AbortController().signal })

// ---------------------------------------------------------------------------
// Verification cases
// ---------------------------------------------------------------------------

describe("ctxpack runtime observability (R1 adapter + U2 view)", () => {
  test("stale projection preserved on transient refetch failure; next success restores ready", async () => {
    const fake = createFakeSdk()
    const { services, router } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-a"), summary("pack-b")])

    const failedRefresh = refresh(resolved, services)
    const failed = listCalls(services)[1]
    expect(failed).toBeDefined()
    failed.settle.reject({ status: 500, code: "internal" })
    await failedRefresh

    // Transient failure keeps the LAST VALID projection, never a fake empty list.
    expect(resolved.status).toBe("stale")
    expect(resolved.errorCode).toBe("internal")
    expect(resolved.items.map((item) => item.id)).toEqual(["pack-a", "pack-b"])
    expect(resolved.nextCursor).toBeNull()

    // The next authoritative refetch restores ready + fresh items.
    const nextRefresh = refresh(resolved, services)
    respondList(services, listCalls(services)[2], [summary("pack-a"), summary("pack-c")])
    await nextRefresh
    expect(resolved.status).toBe("ready")
    expect(resolved.errorCode).toBeNull()
    expect(resolved.items.map((item) => item.id)).toEqual(["pack-a", "pack-c"])
  })

  test("host refresh requests fetch immediately without rebuilding the projection", async () => {
    const fake = createFakeSdk()
    const { services, router } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-a")])
    expect(listCalls(services)).toHaveLength(1)

    const pending = refresh(resolved, services)
    expect(listCalls(services)).toHaveLength(2) // immediate, not coalesced

    respondList(services, listCalls(services)[1], [summary("pack-a"), summary("pack-b")])
    await pending
    expect(resolved.status).toBe("ready")
    expect(resolved.items.map((item) => item.id)).toEqual(["pack-a", "pack-b"])
  })

  test("event routing and coalescing are delegated to the host without duplicate subscriptions", async () => {
    const fake = createFakeSdk()
    const { services, router } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-a")])

    // Non-matching events never schedule a refetch.
    expect(onEvent({ type: "workspace.session.text.delta", properties: {} }, resolved, services)).toBe("ignore")
    expect(
      onEvent({ type: "workspace.ctxpack.changed", properties: { workspaceID: "ws-other" } }, resolved, services),
    ).toBe("ignore")

    // The integrated host tests exercise burst coalescing and reconnects.
    for (let i = 0; i < 3; i += 1) {
      router.emit({ type: "workspace.ctxpack.changed", properties: { workspaceID: WORKSPACE_ID } })
    }
    expect(router.listeners).toHaveLength(0)
    expect(listCalls(services)).toHaveLength(1)
  })

  test("permission-denied SDK errors map to an explicit permission-denied state (never an empty list)", async () => {
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const promise = startResolve(services)
    await flush()
    listCalls(services)[0]!.settle.reject({ status: 403, code: "permission-denied" })
    const resolved = await promise

    expect(resolved.status).toBe("permission-denied")
    expect(resolved.errorCode).toBe("permission-denied")
    expect(resolved.items).toEqual([])
    expect(resolved.nextCursor).toBeNull()

    // The select() projection carries the explicit state through to the view.
    const view = ctxPackBrowserRegistration.select({ resolved, projection: undefined, localView: undefined })
    expect(view.status).toBe("permission-denied")
  })

  test("layout purity: the adapter persists ONLY { query } — never items/selected/content", async () => {
    const fake = createFakeSdk()
    const { services, writes } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)

    const resolved = await resolveToReady(services, [summary("pack-a"), summary("pack-b")])

    // Open a detail first: persistence must NOT capture it.
    const openPromise = dispatch(resolved, services, { type: "open", ctxPackID: "pack-a" })
    const get = callsOf(services).find((c) => c.kind === "get")!
    get.settle.resolve({ data: info("pack-a") })
    await openPromise
    expect(resolved.selected).not.toBeNull()

    // set-query is the ONLY dispatch path that persists.
    const setQueryPromise = dispatch(resolved, services, { type: "set-query", patch: { query: "turbine" } })
    respondList(services, listCalls(services)[1], [summary("pack-a")])
    await setQueryPromise

    expect(writes.length).toBeGreaterThan(0)
    for (const write of writes) {
      // Every persisted object is exactly { query } at the top level...
      expect(Object.keys(write.value as Record<string, unknown>).sort()).toEqual(["query"])
      const query = (write.value as { query: Record<string, unknown> }).query
      // ...and the query itself never carries projection payload fields.
      expect(Object.prototype.hasOwnProperty.call(query, "items")).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(query, "selected")).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(query, "content")).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(query, "fragments")).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(query, "revisionByPackID")).toBe(false)
    }
  })

  test("U2 view contract: select() emits exactly the frozen view keys; initial view matches", async () => {
    const initial = initialCtxPackBrowserView()
    const expectedKeys = [
      "status",
      "query",
      "items",
      "nextCursor",
      "selected",
      "loadingMore",
      "errorCode",
      "canCreate",
      "canPatch",
      "canDelete",
      "canMaterialize",
    ]
    expect(Object.keys(initial).sort()).toEqual([...expectedKeys].sort())
    expect(initial.status).toBe("loading")
    expect(initial.canCreate).toBe(false)
    expect(initial.canPatch).toBe(false)
    expect(initial.canDelete).toBe(false)
    expect(initial.canMaterialize).toBe(false)

    // The adapter's select() maps a ready resolved state onto the same shape.
    const fake = createFakeSdk()
    const { services } = createFakeServices(fake.sdk)
    sdkRegistry.set(fake.sdk, fake.calls)
    const resolved = await resolveToReady(services, [summary("pack-a")])
    const view = ctxPackBrowserRegistration.select({ resolved, projection: undefined, localView: undefined })
    expect(Object.keys(view).sort()).toEqual([...expectedKeys].sort())
    expect(view.status).toBe("ready")
    expect(view.loadingMore).toBe(false)
  })

  test("the adapter source uses NO polling primitives (setInterval / EventSource / WebSocket)", async () => {
    const adapterSource = await Bun.file(new URL("./blocks/ctxpack-browser/adapter.ts", import.meta.url)).text()
    const viewModelSource = await Bun.file(new URL("./blocks/ctxpack-browser/view-model.ts", import.meta.url)).text()

    for (const source of [adapterSource, viewModelSource]) {
      expect(source).not.toMatch(/\bsetInterval\s*\(/)
      expect(source).not.toMatch(/\bEventSource\b/)
      expect(source).not.toMatch(/\bnew\s+WebSocket\b/)
      expect(source).not.toMatch(/\bWebSocket\b/)
    }

    expect(adapterSource).not.toMatch(/eventRouter\.on/)
    expect(ctxPackBrowserRegistration.eventDebounceMs).toBe(150)
  })
})
