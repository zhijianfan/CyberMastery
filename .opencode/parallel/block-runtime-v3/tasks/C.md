You are worker 3 of 7 (Wave 1) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task C — Frontend event router, resource store, runtime controller

Goal: replace the current cursor-based, ChatRelay-oriented controller/store with
a generic controller over the EXISTING app event stream (`serverSDK().event`)
— no second SSE, no snapshot-per-event, no numeric cursor parsing.

## Required components (all new files under packages/app/src/pages/canvas/runtime/)

1. `event-router.ts` — `createBlockRuntimeEventRouter()`
   - ONE subscription to `serverSDK().event.listen` per router instance
     (the inlined manager.ts `makeEventListeners` shows the listen API).
   - Index listeners by `RuntimeEventKey` fields (type + optional
     workspaceID/blockID/functionalityID/resourceID) with exact match plus an
     optional adapter predicate `(event) => boolean`.
   - Ref-counted subscriptions; dispose removes listeners and unsubscribes the
     stream when the last listener leaves.
   - Emits a router-level reconnect notification (callback/stream) when the
     underlying event client reconnects (use the API in inlined server-sdk.tsx
     event-stream usage — `serverSDK().event.listen` + `start`).
   - Never stores full domain state.
2. `resource-store.ts` — `createRuntimeResourceStore()`
   - Keyed by explicit resource keys INDEPENDENT of block IDs.
   - State: resolving | ready | stale | error | unavailable | permission-denied.
   - Tracks projection revision when supplied; applies replace/merge/append/
     remove patches exactly per the frozen `RuntimeProjectionPatch`.
   - Coalesces invalidations in one microtask/queueMicrotask (one refresh per
     burst).
   - Ref-counted sharing: two blocks can share a resource projection; per-block
     descriptor/view handles stay separate.
   - No cursor parsing anywhere.
3. `controller.ts` — `createBlockRuntimeController()` (replaces the old
   `createBlockRuntimeController` in the inlined `controller.ts`)
   - One controller per mounted block handle; uses a shared resource bucket only
     when the adapter returns the same explicit resource key.
   - Keeps per-block descriptor, resolved instance, command state, local view
     separate.
   - Aborts resolve/refresh/dispatch on dispose or workspace epoch change
     (AbortController per operation).
   - Refreshes on matching invalidation and reconnect; preserves last good
     projection while stale; bounded retry with jitter; NO timer polling.
4. `registry.ts` — `createBlockRuntimeRegistry()`
   - Rejects duplicate functionality registrations in DEV.
   - Exposes mode and availability per registration.
   - Allows local/static adapters with no backend subscription.
5. `types.ts` — re-export/rewire the old local types to the canonical
   `contracts.ts` (created by worker A — use its exported shapes by name;
   if contracts.ts is not yet on disk when you validate, create a temporary
   local copy matching the inlined contract doc, clearly marked, and re-point
   in HANDOFF-C). Delete the old cursor/snapshot/resource-union code from
   types.ts; keep only narrow aliases needed by remaining imports, marked
   `// @deprecated remove in Task O`.
6. `index.ts` — export the new core API (router, store, controller, registry).
7. Replace `packages/app/src/state/block-runtime-store.ts` with a thin
   re-export of the new resource store or delete it and fix its importers
   WITHIN your owned files only (search importers: only runtime files may be
   edited; list any importer OUTSIDE your ownership in HANDOFF-C as an
   integration action for M).

## Required tests (new, under packages/app/src/pages/canvas/runtime/)

- two blocks sharing one resource share the projection but keep distinct
  descriptors/views;
- descriptor/config update does not overwrite the other block;
- block dispose decrements resource ref count and aborts outstanding work;
- out-of-order lower revision patch is ignored;
- invalidation burst results in exactly one refresh;
- reconnect refreshes every mounted host-backed adapter once;
- workspace epoch change disposes old handles;
- local/static adapter opens no event subscription;
- no mock fallback exists in production code (grep assert).

Use a fake event source with deferred promises (no setTimeout sleeps).

## Owned files (edit ONLY these)

- `packages/app/src/pages/canvas/runtime/event-router.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/resource-store.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/controller.ts` (rewrite)
- `packages/app/src/pages/canvas/runtime/registry.ts` (rewrite)
- `packages/app/src/pages/canvas/runtime/types.ts` (rewire to contracts)
- `packages/app/src/pages/canvas/runtime/index.ts` (rewrite)
- tests for the above (new files beside them)
- `packages/app/src/state/block-runtime-store.ts` (replace with re-export or delete)
- `packages/app/src/pages/canvas/runtime/HANDOFF-C.md`

Do NOT edit `workspace.tsx`, ChatRelay, MasterAgent, manager, diagnostics,
`runtime/contracts.ts` (A's), or any backend file.

## Targeted validation (allowed)

- `cd packages/app && bun test src/pages/canvas/runtime/`
- `bun run typecheck` from `packages/app`

## Handoff

`HANDOFF-C.md`: registry creation API · host mount API D must use · event
matcher shape F/H/I must use · diagnostics hooks L may consume · importers
outside your ownership that M must fix · tests + results · prohibited-pattern
grep result.



---

## Authoritative contracts (frozen by S0 — follow EXACTLY)

# Block Runtime v3 — Frozen Contract (S0)

Source of truth for every worker in the `block-runtime-v3` parallel run. Frozen
2026-08-19. Workers implement against THIS document plus their task packet;
nothing else.

## C1 — Layout purity

The host layout and the canvas descriptor cache contain only:

```ts
interface CanvasBlockDescriptor {
  id: string
  functionalityID: string
  transform: { x: number; y: number; w: number; h: number; z: number }
}
```

No session ID, binding revision, message, queue state, model execution state,
terminal state, file content, note content, or view state enters the layout
record.

## C2 — Optional runtime participation

Every block is registered with exactly one mode:

```ts
type BlockRuntimeMode = "native" | "projected" | "local" | "static"
```

- `native`: resolves host configuration but renders an existing OpenCode native surface/store.
- `projected`: consumes a compact block/domain projection through an adapter.
- `local`: state is device-local and isolated from layout.
- `static`: no runtime state.

## C3 — One event transport per domain

- Session state uses the existing OpenCode session/event path.
- Workspace and FunctionalityInstance changes use EventV2 through the existing app event client.
- No block opens a second session-message SSE stream.
- One prompt submission produces exactly one local OpenCode request.

## C4 — Backend emits semantic change events

The generic backend event contains no UI instructions or full domain state:

```ts
interface FunctionalityInstanceChanged {
  workspaceID: string
  blockID: string
  functionalityID: string
  instanceID: string
  revision: number
  change: "created" | "updated" | "tombstoned"
}
```

The frontend adapter decides whether to patch or refetch.

## C5 — Authoritative refresh on mount/reconnect

Transient events are hints. Every mounted host-backed adapter:

1. resolves authoritative state on mount;
2. listens for matching events;
3. coalesces invalidations;
4. refetches after reconnect or a revision gap;
5. preserves the last valid projection during transient failure.

## C6 — Host-owned binding

ChatRelay and MasterAgent session IDs are returned by their host domain
services. Never selected from browser persistence, never copied into
layout/localStorage.

## C7 — Commands use domain ports

Adapter commands call existing typed endpoints/ports: `workspace.chatRelay.ensure/get/reset`,
`workspace.masterAgent.ensure/get/reset`, native Session composer/interrupt/permission
APIs, workspace update APIs. No generic provider or chat command endpoint.

## C8 — Runtime identity

```text
workspaceEpoch + workspaceID + blockID + functionalityID
```

Shared domain resources may be ref-counted separately; per-block
descriptor/config/view state must never be overwritten by another block
sharing that resource.

## C9 — Workspace invalidation

Typed workspace-not-found: (1) clear stale in-memory + persisted ID;
(2) increment `workspaceEpoch`; (3) dispose runtime handles of the old
workspace; (4) resolve existing preferred workspace or create `Default` only
when none exist; (5) preserve unsaved local layout as a pending
local-authoritative snapshot; (6) notify the user the binding changed.

## C10 — No production mock fallback

Test mocks are imported only by tests. Missing providers/contexts render
explicit loading, unavailable, or error states.

## Frozen interfaces (shape; exact TS may change in S0 — ownership/data-flow may not)

```ts
interface BlockRuntimeRegistration<TResolved, TView, TCommand> {
  functionalityID: string
  mode: "native" | "projected" | "local" | "static"
  resolve(input: { workspaceID: string; block: CanvasBlockDescriptor;
    services: BlockRuntimeServices; signal: AbortSignal }): Promise<TResolved>
  eventKeys?(resolved: TResolved): readonly RuntimeEventKey[]
  onEvent?(input: { event: ServerEvent; resolved: TResolved;
    services: BlockRuntimeServices }): "ignore" | "invalidate" | RuntimeProjectionPatch
  select(input: { resolved: TResolved; projection: unknown; localView: unknown }): TView
  dispatch?(input: { resolved: TResolved; command: TCommand;
    services: BlockRuntimeServices; signal: AbortSignal }): Promise<void>
  dispose?(resolved: TResolved): void
}

interface RuntimeBlockHandle<TView = unknown, TCommand = unknown> {
  status(): "resolving" | "ready" | "stale" | "unavailable" | "permission-denied" | "error"
  view(): TView | undefined
  error(): unknown
  refresh(reason?: string): Promise<void>
  dispatch(command: TCommand): Promise<void>
  dispose(): void
}

interface BlockRuntimeServices {
  serverSDK: Accessor<ServerSDK>
  eventRouter: BlockRuntimeEventRouter
  workspace: {
    id(): string | undefined
    epoch(): number
    connected(): boolean
    awaitDescriptorPersisted(blockID: string, signal: AbortSignal): Promise<void>
  }
  localView: BlockLocalViewStore
}

interface RuntimeEventKey {
  type: string
  workspaceID?: string
  blockID?: string
  functionalityID?: string
  resourceID?: string
}

type RuntimeProjectionPatch =
  | { op: "replace"; value: unknown; revision?: number }
  | { op: "merge"; value: Record<string, unknown>; revision?: number }
  | { op: "append"; path: readonly string[]; value: unknown; revision?: number }
  | { op: "remove"; path?: readonly string[]; revision?: number }
```

Cursors from external sources are opaque strings. Generic types must not imply
numeric parsing. `RuntimeEventKey` is semantic and extensible — never a closed
union of `session | message | pty | file | review`.

## Frozen names

- Backend change event: `workspace.functionality.instance.changed`
- Local view state key: `opencode.canvas.local-view.v1` (one key, sub-keyed by block)
- Layout/descriptor cache key: `opencode-canvas-v1` (descriptor + transform only after D)
- Workspace ID persistence key: `opencode.canvas.workspaceID.v1`

## Prohibited patterns (any worker)

```text
/api/block-runtime/event used for session messages
chatgpt.com/backend-api/conversation
__CHAT_RELAY_RUNTIME_*
CHAT_RELAY_DEFAULT_SESSION_ID
block.bindings persisted in canvas localStorage
snapshot on every event
setInterval status polling for correctness
production createMockChatRelayContext fallback
```

## Worker rules (binding)

- Implement ONLY the assigned task. Edit ONLY the owned files listed in the packet.
- Use ONLY the context in the task packet (contracts + packet + inlined source).
- Do NOT read/grep/glob other files (tools denied). Missing detail → implement against
  the packet, report as "uncertain" in the handoff.
- Do NOT regenerate SDK/OpenAPI or rebuild the embedded UI. Do NOT edit central
  aggregation files (`api.ts`, `handlers.ts`, `routes.ts`, httpapi server composition,
  generated files, lockfile).
- Run only the targeted validation command(s) in the packet.
- Write `HANDOFF.md` beside your owned files with: files changed, tests run + result,
  public exports added/removed, assumptions, known limitations, integration actions
  required by M, prohibited-pattern search result (grep the strings above over your diff).



---

## Inlined source — your ONLY other context


### `packages/app/src/pages/canvas/runtime/controller.ts (319 lines)`

```ts
import { createBlockRuntimeStore, type BlockRuntimeBatchStats } from "@/state/block-runtime-store"
import type { BlockDescriptor, BlockRuntimeAdapter, BlockRuntimeContext, RuntimeEventEnvelope, RuntimeResourceState } from "./types"
import type { BlockRuntimeRegistry } from "./registry"

export interface RuntimeControllerInput {
  registry: BlockRuntimeRegistry
  context: BlockRuntimeContext
}

type AnyBlockRuntimeAdapter = BlockRuntimeAdapter<BlockDescriptor, unknown, unknown>

interface RuntimeBucket {
  adapter: AnyBlockRuntimeAdapter
  descriptor: BlockDescriptor
  bindings: ReturnType<AnyBlockRuntimeAdapter["getBindings"]>
  bindingKey: string
  store: ReturnType<typeof createBlockRuntimeStore>
  blocks: Set<string>
  unsubscribe: (() => void) | undefined
  cursor: string
  snapshotTask: Promise<void> | undefined
  reconnectScheduled: boolean
  resyncScheduled: boolean
  resyncCount: number
  resyncReason: string | undefined
}

export interface RuntimeControllerDiagnostics {
  activeBlockSubscriptions: number
  lastCursor: string | undefined
  resyncCount: number
  resyncReason: string | undefined
  batchStats: BlockRuntimeBatchStats
}

export interface RuntimeBlockController {
  id: () => string
  descriptor: () => BlockDescriptor
  state: () => RuntimeResourceState
  view: () => unknown
  dispatch: (command: unknown) => Promise<void>
  dispose: () => void
}

export interface RuntimeController {
  mount: (descriptor: BlockDescriptor) => Promise<RuntimeBlockController>
  diagnostics: () => RuntimeControllerDiagnostics
}

const createBindingKey = (bindings: RuntimeBucket["bindings"]) =>
  [...bindings]
    .sort((left, right) => {
      const leftKey = \`${left.type}:${left.id}:${left.parentID ?? ""}\`
      const rightKey = \`${right.type}:${right.id}:${right.parentID ?? ""}\`
      return leftKey.localeCompare(rightKey)
    })
    .map((binding) => \`${binding.type}:${binding.id}:${binding.parentID ?? ""}\`)
    .join("|")

const makeConnectionResource = (bindings: RuntimeBucket["bindings"]) =>
  bindings[0] ?? { type: "session", id: "runtime" }

const createConnectionEvent = (cursor: string, status: "connecting" | "connected" | "disconnected", resource: RuntimeEventEnvelope["resource"]) => ({
  cursor,
  timestamp: Date.now(),
  resource,
  event: \`connection.${status}\` as const,
  data: { status },
})

const mergeBatchStats = (left: BlockRuntimeBatchStats, right: BlockRuntimeBatchStats): BlockRuntimeBatchStats => ({
  queued: left.queued + right.queued,
  flushes: left.flushes + right.flushes,
  appliedEvents: left.appliedEvents + right.appliedEvents,
  droppedEvents: left.droppedEvents + right.droppedEvents,
  duplicateEvents: left.duplicateEvents + right.duplicateEvents,
})

export const createBlockRuntimeController = (input: RuntimeControllerInput): RuntimeController => {
  const mounted = new Map<string, {
    descriptor: BlockDescriptor
    bucket: RuntimeBucket
    key: string
    controller: RuntimeBlockController
  }>()
  const buckets = new Map<string, RuntimeBucket>()

  const applySnapshot = async (bucket: RuntimeBucket) => {
    const snapshot = await bucket.adapter.hydrate(bucket.descriptor, input.context)
    bucket.store.applySnapshot(snapshot)
    bucket.cursor = snapshot.cursor
    bucket.resyncReason = undefined
  }

  const connect = (bucket: RuntimeBucket, cursor: string) => {
    const resource = makeConnectionResource(bucket.bindings)
    bucket.unsubscribe?.()
    bucket.unsubscribe = input.context.subscribe(bucket.bindings, cursor, (event) => {
      const result = bucket.store.applyEvent(event)

      if (result.needsResync) {
        void scheduleResync(bucket, bucket.store.resyncReason() ?? "sequence gap")
        return
      }

      if (event.event === "connection.disconnected" || event.event === "connection.error") {
        void scheduleReconnect(bucket)
      }
    })
    bucket.store.applyEvent(createConnectionEvent(cursor, "connecting", resource))
  }

  const scheduleReconnect = (bucket: RuntimeBucket) => {
    if (bucket.reconnectScheduled) return
    bucket.reconnectScheduled = true

    void Promise.resolve().then(() => {
      if (bucket.blocks.size === 0) {
        bucket.reconnectScheduled = false
        return
      }

      const cursor = bucket.store.connection().cursor ?? bucket.cursor
      if (bucket.unsubscribe) {
        bucket.unsubscribe()
      }

      try {
        connect(bucket, cursor)
      } catch {
        void scheduleResync(bucket, "failed to resume")
      }

      bucket.reconnectScheduled = false
    })
  }

  const scheduleResync = (bucket: RuntimeBucket, reason: string) => {
    if (bucket.resyncScheduled) return
    bucket.resyncScheduled = true

    void Promise.resolve().then(async () => {
      if (bucket.blocks.size === 0) {
        bucket.resyncScheduled = false
        return
      }

      bucket.resyncCount += 1
      bucket.resyncReason = reason
      try {
        await applySnapshot(bucket)
        connect(bucket, bucket.cursor)
        bucket.resyncReason = undefined
      } catch {
        // keep the latest in-memory snapshot intact on failure
      } finally {
        bucket.resyncScheduled = false
      }
    })
  }

  const destroyBucket = (key: string, bucket: RuntimeBucket) => {
    if (bucket.blocks.size > 0) return
    bucket.unsubscribe?.()
    bucket.unsubscribe = undefined
    buckets.delete(key)
  }

  const createBucket = (descriptor: BlockDescriptor, adapter: AnyBlockRuntimeAdapter, bindings: RuntimeBucket["bindings"]) => {
    const bucket: RuntimeBucket = {
      adapter,
      descriptor,
      bindings,
      bindingKey: createBindingKey(bindings),
      store: createBlockRuntimeStore(),
      blocks: new Set(),
      unsubscribe: undefined,
      cursor: "0",
      snapshotTask: undefined,
      reconnectScheduled: false,
      resyncScheduled: false,
      resyncCount: 0,
      resyncReason: undefined,
    }

    bucket.snapshotTask = (async () => {
      await applySnapshot(bucket)
      connect(bucket, bucket.cursor)
    })().finally(() => {
      bucket.snapshotTask = undefined
    })

    return bucket
  }

  const resolveBucket = async (descriptor: BlockDescriptor) => {
    const adapter = input.registry.resolve(descriptor.functionalityID)
    if (!adapter) {
      throw new Error(\`No runtime adapter for functionalityID: ${descriptor.functionalityID}\`)
    }

    const bindings = adapter.getBindings(descriptor)
    const bindingKey = createBindingKey(bindings)
    const key = \`${descriptor.functionalityID}:${bindingKey}\`
    const existing = buckets.get(key)
    if (existing !== undefined) {
      existing.adapter = adapter
      existing.descriptor = descriptor
      existing.bindingKey = bindingKey
      if (existing.snapshotTask) await existing.snapshotTask
      return { bucket: existing, key }
    }

    const bucket = createBucket(descriptor, adapter, bindings)
    buckets.set(key, bucket)
    if (bucket.snapshotTask) await bucket.snapshotTask
    return { bucket, key }
  }

  const keyFor = (descriptor: BlockDescriptor, adapter: AnyBlockRuntimeAdapter) => {
    const bindingKey = createBindingKey(adapter.getBindings(descriptor))
    return \`${descriptor.functionalityID}:${bindingKey}\`
  }

  const diagnostics = (): RuntimeControllerDiagnostics => {
    let activeBlockSubscriptions = 0
    let lastCursor: string | undefined
    let resyncCount = 0
    let lastResyncReason: string | undefined
    let batchStats: RuntimeControllerDiagnostics["batchStats"] = {
      queued: 0,
      flushes: 0,
      appliedEvents: 0,
      droppedEvents: 0,
      duplicateEvents: 0,
    }

    for (const bucket of buckets.values()) {
      activeBlockSubscriptions += bucket.blocks.size
      resyncCount += bucket.resyncCount
      if (bucket.resyncReason !== undefined) lastResyncReason = bucket.resyncReason
      batchStats = mergeBatchStats(batchStats, bucket.store.batchStats())
      const cursor = bucket.store.connection().cursor
      if (cursor !== undefined) lastCursor = cursor
    }

    return {
      activeBlockSubscriptions,
      lastCursor,
      resyncCount,
      resyncReason: lastResyncReason,
      batchStats,
    }
  }

  return {
    async mount(descriptor) {
      const adapter = input.registry.resolve(descriptor.functionalityID)
      if (!adapter) {
        throw new Error(\`No runtime adapter for functionalityID: ${descriptor.functionalityID}\`)
      }

      const bucketKey = keyFor(descriptor, adapter)
      const existing = mounted.get(descriptor.id)
      if (existing !== undefined) {
        if (existing.key === bucketKey) {
          existing.descriptor = descriptor
          existing.bucket.descriptor = descriptor
          return existing.controller
        }
        existing.descriptor = descriptor
        existing.bucket.blocks.delete(descriptor.id)
        mounted.delete(descriptor.id)
        if (existing.bucket.blocks.size === 0) {
          destroyBucket(existing.key, existing.bucket)
        }
      }

      const { bucket, key } = await resolveBucket(descriptor)

      bucket.blocks.add(descriptor.id)

      const controller: RuntimeBlockController = {
        id: () => descriptor.id,
        descriptor: () => {
          const current = mounted.get(descriptor.id)
          return current === undefined ? descriptor : current.descriptor
        },
        state: () => bucket.store.state(),
        view: () => {
          const current = mounted.get(descriptor.id)
          if (current === undefined) {
            return bucket.adapter.select(descriptor, bucket.store.state())
          }
          return current.bucket.adapter.select(current.descriptor, current.bucket.store.state())
        },
        dispatch: async (command) => {
          const current = mounted.get(descriptor.id)
          if (current === undefined) return
          await current.bucket.adapter.dispatch(current.descriptor, command as never, input.context)
        },
        dispose() {
          const current = mounted.get(descriptor.id)
          if (current === undefined) return
          current.bucket.blocks.delete(descriptor.id)
          mounted.delete(descriptor.id)
          if (current.bucket.blocks.size === 0) {
            destroyBucket(current.key, current.bucket)
          }
        },
      }

      mounted.set(descriptor.id, { descriptor, bucket, key, controller })
      return controller
    },
    diagnostics,
  }
}

```

### `packages/app/src/pages/canvas/runtime/registry.ts (25 lines)`

```ts
import type { BlockRuntimeAdapter, BlockDescriptor } from "./types"

type AnyBlockRuntimeAdapter = BlockRuntimeAdapter<BlockDescriptor, unknown, unknown>

export interface BlockRuntimeRegistry {
  register<TDescriptor extends BlockDescriptor, TView, TCommand>(
    functionalityID: TDescriptor["functionalityID"],
    adapter: BlockRuntimeAdapter<TDescriptor, TView, TCommand>,
  ): void
  resolve(functionalityID: string): AnyBlockRuntimeAdapter | undefined
  registered(functionalityID: string): boolean
}

export const createBlockRuntimeRegistry = (): BlockRuntimeRegistry => {
  const adapters = new Map<string, AnyBlockRuntimeAdapter>()

  return {
    register: (functionalityID, adapter) => {
      adapters.set(functionalityID, adapter)
    },
    resolve: (functionalityID) => adapters.get(functionalityID),
    registered: (functionalityID) => adapters.has(functionalityID),
  }
}

```

### `packages/app/src/pages/canvas/runtime/types.ts (100 lines)`

```ts
export interface BlockDescriptor {
  id: string
  functionalityID: string
  layout: {
    x: number
    y: number
    width: number
    height: number
  }
  bindings: Record<string, string | undefined>
  config?: unknown
}

export interface RuntimeResourceBinding {
  type: "auth" | "session" | "message" | "message-part" | "permission" | "pty" | "file" | "review"
  id: string
  parentID?: string
}

export interface RuntimeEventEnvelope<T = unknown> {
  cursor: string
  revision?: number
  timestamp: number
  resource: RuntimeResourceBinding
  event: string
  data: T
}

export interface RuntimeSnapshot<T> {
  cursor: string
  state: T
}

export interface AuthRuntimeState {
  providerID: string
  status: "missing" | "awaiting-login" | "ready" | "error"
  loginURL?: string
  userCode?: string
  error?: string
}

export interface SessionRuntimeState {
  id: string
  status: "idle" | "busy"
  directory?: string
  modelID?: string
  agentID?: string
  error?: string
}

export interface MessageRuntimeState {
  id: string
  sessionID: string
  role: "user" | "assistant"
  timeCreated?: number
  important?: boolean
}

export interface MessagePartRuntimeState {
  id: string
  messageID: string
  kind: "text" | "tool" | "reasoning" | "permission"
  text?: string
  state?: unknown
  error?: string
}

export interface PermissionRuntimeState {
  id: string
  requestID: string
  sessionID: string
  status: "pending" | "resolved"
  response?: "allow-once" | "allow-always" | "deny"
}

export interface RuntimeResourceState {
  connection: {
    status: "connecting" | "connected" | "disconnected"
    cursor?: string
    lastError?: string
  }
  authByProvider: Record<string, AuthRuntimeState>
  sessionsByID: Record<string, SessionRuntimeState>
  messagesByID: Record<string, MessageRuntimeState>
  partsByID: Record<string, MessagePartRuntimeState>
  permissionsByID: Record<string, PermissionRuntimeState>
}

export interface BlockRuntimeContext {
  snapshot(bindings: RuntimeResourceBinding[]): Promise<RuntimeSnapshot<RuntimeResourceState>>
  subscribe(bindings: RuntimeResourceBinding[], cursor: string, onEvent: (e: RuntimeEventEnvelope) => void): () => void
}

export interface BlockRuntimeAdapter<TDescriptor extends BlockDescriptor, TView, TCommand> {
  getBindings(descriptor: TDescriptor): RuntimeResourceBinding[]
  hydrate(descriptor: TDescriptor, context: BlockRuntimeContext): Promise<RuntimeSnapshot<RuntimeResourceState>>
  select(descriptor: TDescriptor, resources: RuntimeResourceState): TView
  dispatch(descriptor: TDescriptor, command: TCommand, context: BlockRuntimeContext): Promise<void>
}

```

### `packages/app/src/pages/canvas/runtime/index.ts (33 lines)`

```ts
export {
  createBlockRuntimeRegistry,
  type BlockRuntimeRegistry,
} from "./registry"

export {
  type AuthRuntimeState,
  type BlockDescriptor,
  type BlockRuntimeAdapter,
  type BlockRuntimeContext,
  type MessagePartRuntimeState,
  type MessageRuntimeState,
  type PermissionRuntimeState,
  type RuntimeEventEnvelope,
  type RuntimeResourceBinding,
  type RuntimeResourceState,
  type RuntimeSnapshot,
  type SessionRuntimeState,
} from "./types"

export {
  createBlockRuntimeStore,
  type ApplyEventResult,
  type BlockRuntimeBatchStats,
  type BlockRuntimeStore,
} from "@/state/block-runtime-store"

export {
  type RuntimeController,
  type RuntimeControllerDiagnostics,
  createBlockRuntimeController,
} from "./controller"

```

### `packages/app/src/state/block-runtime-store.ts (398 lines)`

```ts
import { batch } from "solid-js"
import { createStore } from "solid-js/store"
import type {
  AuthRuntimeState,
  MessagePartRuntimeState,
  MessageRuntimeState,
  PermissionRuntimeState,
  RuntimeEventEnvelope,
  RuntimeResourceBinding,
  RuntimeResourceState,
  RuntimeSnapshot,
  SessionRuntimeState,
} from "@/pages/canvas/runtime/types"

export interface BlockRuntimeBatchStats {
  queued: number
  flushes: number
  appliedEvents: number
  droppedEvents: number
  duplicateEvents: number
}

export interface ApplyEventResult {
  applied: boolean
  duplicate: boolean
  stale: boolean
  gap: boolean
  needsResync: boolean
}

export interface BlockRuntimeStore {
  state: () => RuntimeResourceState
  connection: () => RuntimeResourceState["connection"]
  authByProvider: () => RuntimeResourceState["authByProvider"]
  sessionsByID: () => RuntimeResourceState["sessionsByID"]
  messagesByID: () => RuntimeResourceState["messagesByID"]
  partsByID: () => RuntimeResourceState["partsByID"]
  permissionsByID: () => RuntimeResourceState["permissionsByID"]
  needsResync: () => boolean
  resyncReason: () => string | undefined
  batchStats: () => BlockRuntimeBatchStats
  applySnapshot(snapshot: RuntimeSnapshot<RuntimeResourceState>): void
  applyEvent<T>(event: RuntimeEventEnvelope<T>): ApplyEventResult
}

interface MutableRuntimeState {
  connection: RuntimeResourceState["connection"]
  authByProvider: RuntimeResourceState["authByProvider"]
  sessionsByID: RuntimeResourceState["sessionsByID"]
  messagesByID: RuntimeResourceState["messagesByID"]
  partsByID: RuntimeResourceState["partsByID"]
  permissionsByID: RuntimeResourceState["permissionsByID"]
}

const createEmptyState = (): RuntimeResourceState => ({
  connection: { status: "connecting" },
  authByProvider: {},
  sessionsByID: {},
  messagesByID: {},
  partsByID: {},
  permissionsByID: {},
})

const toNumberCursor = (cursor: string) => {
  const value = Number.parseInt(cursor, 10)
  return Number.isNaN(value) ? undefined : value
}

const toObjectPatch = (value: unknown) => {
  if (value === null || value === undefined) return undefined
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  return undefined
}

const mergeObjects = (current: unknown, patch: Record<string, unknown>) => {
  if (current === undefined) return patch
  if (typeof current !== "object" || current === null || Array.isArray(current)) return patch
  return { ...(current as Record<string, unknown>), ...patch }
}

const makeResourceKey = (resource: RuntimeResourceBinding) =>
  \`${resource.type}:${resource.id}${resource.parentID === undefined ? "" : \`:${resource.parentID}\`}\`

const toConnectionStatus = (event: string) => {
  if (event === "connection.connected") return "connected" as const
  if (event === "connection.disconnected") return "disconnected" as const
  if (event === "connection.connecting") return "connecting" as const
  if (event === "connection.error") return "disconnected" as const
  return undefined
}

const createBatchScheduler = (flush: () => void) => {
  let scheduled = false
  return () => {
    if (scheduled) return
    scheduled = true
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        scheduled = false
        flush()
      })
      return
    }
    queueMicrotask(() => {
      scheduled = false
      flush()
    })
  }
}

const buildNextStateFromSnapshot = (snapshot: RuntimeSnapshot<RuntimeResourceState>) => ({
  connection: { ...snapshot.state.connection, cursor: snapshot.cursor },
  authByProvider: { ...snapshot.state.authByProvider },
  sessionsByID: { ...snapshot.state.sessionsByID },
  messagesByID: { ...snapshot.state.messagesByID },
  partsByID: { ...snapshot.state.partsByID },
  permissionsByID: { ...snapshot.state.permissionsByID },
})

const applyResourceEvent = (
  state: MutableRuntimeState,
  event: RuntimeEventEnvelope,
) => {
  const id = event.resource.id

  if (event.event === "removed") {
    if (event.resource.type === "auth") {
      const nextAuthByProvider = { ...state.authByProvider }
      delete nextAuthByProvider[id]
      return { authByProvider: nextAuthByProvider }
    }
    if (event.resource.type === "session") {
      const nextSessionsByID = { ...state.sessionsByID }
      delete nextSessionsByID[id]
      return { sessionsByID: nextSessionsByID }
    }
    if (event.resource.type === "message") {
      const nextMessages = { ...state.messagesByID }
      const nextParts = { ...state.partsByID }
      const sessionID = nextMessages[id]?.sessionID
      if (sessionID !== undefined) {
        for (const [partID, part] of Object.entries(nextParts)) {
          if (part.messageID === id) delete nextParts[partID]
        }
      }
      delete nextMessages[id]
      return { messagesByID: nextMessages, partsByID: nextParts }
    }
    if (event.resource.type === "message-part") {
      const nextPartsByID = { ...state.partsByID }
      delete nextPartsByID[id]
      return { partsByID: nextPartsByID }
    }
    const nextPermissions = { ...state.permissionsByID }
    delete nextPermissions[id]
    return { permissionsByID: nextPermissions }
  }

  const patch = toObjectPatch(event.data)
  if (!patch || Object.keys(patch).length === 0) return undefined

  if (event.resource.type === "auth") {
    const current = state.authByProvider[id]
    return {
      authByProvider: {
        ...state.authByProvider,
        [id]: mergeObjects(current, patch) as unknown as AuthRuntimeState,
      },
    }
  }
  if (event.resource.type === "session") {
    const current = state.sessionsByID[id]
    return {
      sessionsByID: {
        ...state.sessionsByID,
        [id]: mergeObjects(current, patch) as unknown as SessionRuntimeState,
      },
    }
  }
  if (event.resource.type === "message") {
    const current = state.messagesByID[id]
    return {
      messagesByID: {
        ...state.messagesByID,
        [id]: mergeObjects(current, patch) as unknown as MessageRuntimeState,
      },
    }
  }
  if (event.resource.type === "message-part") {
    const current = state.partsByID[id]
    return {
      partsByID: {
        ...state.partsByID,
        [id]: mergeObjects(current, patch) as unknown as MessagePartRuntimeState,
      },
    }
  }

  const current = state.permissionsByID[id]
  return {
    permissionsByID: {
      ...state.permissionsByID,
      [id]: mergeObjects(current, patch) as unknown as PermissionRuntimeState,
    },
  }
}

const applyConnectionEvent = (connection: RuntimeResourceState["connection"], event: RuntimeEventEnvelope) => {
  const status = toConnectionStatus(event.event)
  if (status === undefined) return undefined
  const data = toObjectPatch(event.data)
  const lastError = data?.lastError
  if (status === connection.status && lastError === connection.lastError) return undefined
  return {
    ...connection,
    status,
    cursor: event.cursor,
    ...(typeof lastError === "string" ? { lastError } : {}),
  }
}

export const createBlockRuntimeStore = () => {
  const [state, setState] = createStore(createEmptyState())
  const [needsResync, setNeedsResync] = createStore({ value: false, reason: undefined as string | undefined })
  const [batchStats, setBatchStats] = createStore<BlockRuntimeBatchStats>({
    queued: 0,
    flushes: 0,
    appliedEvents: 0,
    droppedEvents: 0,
    duplicateEvents: 0,
  })

  const revisionByResource = new Map<string, number>()
  const pending = new Set<string>()
  const pendingEvents: RuntimeEventEnvelope[] = []
  let lastCursor: string | undefined
  let lastCursorNumber: number | undefined

  const flush = () => {
    if (pendingEvents.length === 0) return
    const events = pendingEvents.splice(0, pendingEvents.length)

    const next: MutableRuntimeState = {
      connection: { ...state.connection },
      authByProvider: { ...state.authByProvider },
      sessionsByID: { ...state.sessionsByID },
      messagesByID: { ...state.messagesByID },
      partsByID: { ...state.partsByID },
      permissionsByID: { ...state.permissionsByID },
    }

    for (const event of events) {
      const patch = applyResourceEvent(next, event)
      if (patch?.authByProvider) next.authByProvider = patch.authByProvider
      if (patch?.sessionsByID) next.sessionsByID = patch.sessionsByID
      if (patch?.messagesByID) next.messagesByID = patch.messagesByID
      if (patch?.partsByID) next.partsByID = patch.partsByID
      if (patch?.permissionsByID) next.permissionsByID = patch.permissionsByID
      next.connection.cursor = event.cursor
    }

    batch(() => {
      setState({ ...next })
    })

    setBatchStats((stats) => ({
      ...stats,
      flushes: stats.flushes + 1,
      queued: Math.max(stats.queued - events.length, 0),
      appliedEvents: stats.appliedEvents + events.length,
    }))
    events.forEach((event) => {
      pending.delete(event.cursor + ":" + makeResourceKey(event.resource))
    })
  }

  const scheduleFlush = createBatchScheduler(flush)

  return {
    state: () => state,
    connection: () => state.connection,
    authByProvider: () => state.authByProvider,
    sessionsByID: () => state.sessionsByID,
    messagesByID: () => state.messagesByID,
    partsByID: () => state.partsByID,
    permissionsByID: () => state.permissionsByID,
    needsResync: () => needsResync.value,
    resyncReason: () => needsResync.reason,
    batchStats: () => batchStats,
    applySnapshot(snapshot) {
      batch(() => {
        setState(buildNextStateFromSnapshot(snapshot))
      })
      setNeedsResync({ value: false, reason: undefined })
      revisionByResource.clear()
      if (pendingEvents.length > 0) {
        setBatchStats((stats) => ({
          ...stats,
          droppedEvents: stats.droppedEvents + pendingEvents.length,
          queued: 0,
        }))
      }
      pendingEvents.length = 0
      pending.clear()
      lastCursor = snapshot.cursor
      lastCursorNumber = toNumberCursor(snapshot.cursor)
    },
    applyEvent(event) {
      const connectionStatus = toConnectionStatus(event.event)
      if (connectionStatus !== undefined) {
        const connectionPatch = applyConnectionEvent(state.connection, event)
        if (connectionPatch) {
          setState("connection", connectionPatch)
        }
        if (lastCursor !== event.cursor) {
          lastCursor = event.cursor
          lastCursorNumber = toNumberCursor(event.cursor)
        }
        return { applied: true, duplicate: false, stale: false, gap: false, needsResync: false }
      }

      if (lastCursor === event.cursor) {
        pending.delete(lastCursor + ":" + makeResourceKey(event.resource))
        setBatchStats((stats) => ({ ...stats, duplicateEvents: stats.duplicateEvents + 1 }))
        return { applied: false, duplicate: true, stale: false, gap: false, needsResync: false }
      }

      const current = toNumberCursor(lastCursor ?? "")
      const next = toNumberCursor(event.cursor)
      if (current !== undefined && next !== undefined) {
        if (next <= current) {
          return {
            applied: false,
            duplicate: false,
            stale: true,
            gap: false,
            needsResync: false,
          }
        }
        if (next > current + 1) {
          lastCursor = event.cursor
          lastCursorNumber = next
          setNeedsResync({ value: true, reason: \`cursor gap after ${current}: ${next}\` })
          return {
            applied: false,
            duplicate: false,
            stale: false,
            gap: true,
            needsResync: true,
          }
        }
      }

      if (event.revision !== undefined) {
        const resourceKey = makeResourceKey(event.resource)
        const known = revisionByResource.get(resourceKey)
        if (known !== undefined && event.revision <= known) {
          return {
            applied: false,
            duplicate: false,
            stale: true,
            gap: false,
            needsResync: false,
          }
        }
        revisionByResource.set(resourceKey, event.revision)
      }

      const key = event.cursor + ":" + makeResourceKey(event.resource)
      if (pending.has(key)) {
        return {
          applied: false,
          duplicate: true,
          stale: false,
          gap: false,
          needsResync: false,
        }
      }

      lastCursor = event.cursor
      lastCursorNumber = next
      pending.add(key)
      pendingEvents.push(event)

      setBatchStats((stats) => ({ ...stats, queued: stats.queued + 1 }))
      scheduleFlush()

      return {
        applied: true,
        duplicate: false,
        stale: false,
        gap: false,
        needsResync: false,
      }
    },
  } satisfies BlockRuntimeStore
}

```

### `packages/app/src/pages/canvas/manager.ts:596-660`

```ts

  function start() {
    if (started) return
    started = true
    makeEventListeners()
    void serverSDK().event.start()
    void connect()
    void loadConfig()
  }

  function makeEventListeners() {
    const unsubs: (() => void)[] = []
    const on = <E extends Event>(target: EventTarget, type: string, handler: (event: E) => void) => {
      target.addEventListener(type, handler as EventListener)
      unsubs.push(() => target.removeEventListener(type, handler as EventListener))
    }

    on<Event>(window, "online", () => {
      if (!connected()) void connect()
      else fireMasterAgentReconnect()
      if (configPermission() === undefined) void loadConfig()
    })
    // Re-claim layout authority when the window regains focus: push pending
    // edits, otherwise re-pull so another client's handover becomes visible.
    on<Event>(window, "focus", () => {
      if (!connected()) void connect()
      else if (dirty()) void sync()
      else void refresh()
    })

    // The project config (permissions) can change server-side; re-gate the
    // blocks live when a config.updated event arrives.
    configUnsubscribe = serverSDK().event.listen((entry) => {
      const type = entry.details.type as string
      if (type !== "config.updated") return
      void loadConfig()
    })
    // Realtime layout fan-out: another client (or surface) saved this
    // workspace's layout. Re-pull to adopt it live; pending local edits are
    // re-pushed after adoption (last-write-wins, mirroring the handover flow).
    layoutUnsubscribe = serverSDK().event.listen((entry) => {
      const type = entry.details.type as string
      if (type !== "workspace.layout.updated") return
      const properties = entry.details.properties as { workspaceID?: string; revision?: number }
      if (!connected() || syncInFlight || refreshInFlight) return
      if (workspaceID() && properties.workspaceID && properties.workspaceID !== workspaceID()) return
      if (properties.revision !== undefined && properties.revision <= (revision() ?? 0)) return
      if (dirty()) {
        void refresh().then(() => {
          setDirty(true)
          void sync()
        })
        return
      }
      void refresh()
    })

    chatRelayBindingUnsubscribe = serverSDK().event.listen((entry) => {
      const type = entry.details.type as string
      if (type !== "workspace.chatRelay.binding.updated") return
      const properties = entry.details.properties as
        | {
            workspaceID?: unknown
            blockID?: unknown
            sessionID?: unknown
```
