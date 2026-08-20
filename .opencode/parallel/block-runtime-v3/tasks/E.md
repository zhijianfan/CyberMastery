You are worker 5 of 7 (Wave 1) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task E — Typed workspace-not-found and live workspace recovery

Goal: fix both boot-time and in-session stale workspace IDs without looping on
the same deleted ID or recreating a workspace under an old identity. The
reported production bug: `Workspace not found: wrk_...` loops forever because
`ensureWorkspace()` returns the in-memory ID without revalidation.

## Required work

### Backend (typed 404)

1. `packages/core/src/workspace/service.ts`: add a typed
   `WorkspaceNotFoundError` (`Schema.TaggedErrorClass`, mirroring the
   `WorkspaceNotFoundError` pattern in the inlined `chat-relay-session.ts` —
   fields `{ workspaceID }`) and return it from `get`, `update`, `remove`,
   `duplicate`, and layout get/save where the workspace row is missing
   (currently `requireWorkspace` throws a generic NotFound). Preserve the
   conflict/handover result unions — do NOT collapse them into not-found.
2. `packages/protocol/src/groups/workspace.ts`: add the typed error to the
   affected endpoint error channels (only where step 1 added it).
3. `packages/server/src/handlers/workspace.ts`: map the error to HTTP 404
   (follow the existing error-mapping pattern in the inlined handler).

### Frontend manager (`packages/app/src/pages/canvas/manager.ts`, FULL file inlined)

4. Add `workspaceEpoch()` signal (starts 0).
5. Add typed transport error detection WITHOUT string matching: detect the
   error by its SDK error shape/status (the generated SDK surfaces a 404 as an
   error with `status === 404` — use that; do not match on message text).
6. One serialized recovery operation (single in-flight promise; concurrent
   failures join it):
   ```text
   on typed workspace-not-found
     → capture current local records + dirty state
     → clear workspaceID signal, revision, connected, persisted ID
       (localStorage key opencode.canvas.workspaceID.v1)
     → increment workspaceEpoch
     → stop retry timer; invoke a manager-provided disposal callback
       (input.onWorkspaceInvalidated?.) — add this optional input callback
     → ensureWorkspace() with FORCED validation (always validate, even when
       workspaceID() is non-empty)
     → load authoritative target workspace/layout
     → if local edits existed: keep them local-authoritative and explicitly push
     → notify the user via input.notify(...)
   ```
7. Apply the recovery wrapper to: `connect`, `refresh`, `sync`, model/directory
   updates, and the ChatRelay/MasterAgent binding calls (via the same
   not-found detection; those calls already flow through manager methods).
8. Do NOT recover on auth/permission/validation/network errors.
9. Do NOT auto-create a replacement if an existing `Default` (or any) workspace
   exists — reuse the existing preferred workspace.
10. Remove the stale localStorage key BEFORE selecting a replacement.

## Required tests (new files beside manager.ts)

- persisted ID missing at startup → normal resolve;
- workspace deleted after successful connect → epoch bumps, ID re-resolved, one recovery;
- DB reset while page open → same;
- multiple simultaneous not-found requests → exactly one recovery;
- dirty local layout survives recovery and is pushed once;
- no dirty local layout → replacement layout adopted;
- auth/network failure does NOT clear workspace ID or bump epoch;
- recovery cannot recurse (recovery flag/in-flight guard).

## Owned files (edit ONLY these)

- `packages/core/src/workspace/service.ts` (typed not-found only)
- `packages/protocol/src/groups/workspace.ts` (error channel)
- `packages/server/src/handlers/workspace.ts` (404 mapping)
- `packages/app/src/pages/canvas/manager.ts` (epoch + recovery)
- tests for the above (new files beside the sources)
- `packages/app/src/pages/canvas/runtime/HANDOFF-E.md`

Do NOT edit `workspace.tsx`, runtime core, ChatRelay, MasterAgent, generated
SDK, or route aggregation.

## Targeted validation (allowed)

- `cd packages/app && bun test <your new manager test files>` (package-scoped)
- `cd packages/core && bun test <your new service tests>`
- `bun run typecheck` from `packages/app` and `packages/core`

## Handoff

`HANDOFF-E.md`: final manager API (`workspaceEpoch`, recovery notification,
`onWorkspaceInvalidated` input) for D/C · exact SDK error shape used for
detection · generated-SDK regeneration note (M must run `bun run generate`
after protocol changes — DO NOT run it yourself) · tests + results ·
prohibited-pattern grep result.



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


### `packages/app/src/pages/canvas/manager.ts (757 lines)`

```ts
// Canvas communication manager: the subsystem that talks to the backend on
// behalf of the standalone canvas UI. The UI owns rendering and local
// interactions (client-authoritative); everything the backend owns — the
// workspace layout, its revision and authority, the OperatingAgent model, and
// the project permission config — is fetched, pushed, and updated here, then
// handed to the UI through callbacks and reactive signals.

import { useServerSDK, type ServerSDK } from "@/context/server-sdk"
import { createEffect, createRoot, createSignal, type Accessor } from "solid-js"
import type {
  PermissionAction,
  PermissionConfig,
  WorkspaceBlockRecord,
  WorkspaceLayoutInfo,
  WorkspaceLayoutTuple,
} from "@opencode-ai/sdk/v2/client"
import type { createSdkForServer } from "@/utils/server"
import {
  createCoderController,
  type CoderController,
  type CoderTaskPermission,
} from "./master-agent/coder-controller"
import { createMasterAgentEventReconciliation } from "./master-agent/event-reconciliation"
import {
  MASTER_AGENT_FUNCTIONALITY_ID,
  MASTER_AGENT_MODULE,
  type MasterAgentBlockModule,
} from "./master-agent/functionality"
import {
  createMasterAgentLifecycleController,
  type MasterAgentLifecycleController,
} from "./master-agent/lifecycle-controller"
import { createMasterAgentPort } from "./master-agent/port"
import { createMasterAgentSdkPort } from "./master-agent/sdk-port"
import type { BindingState, MasterAgentPort, ModelSelection } from "./master-agent/types"

export interface CanvasManagerInput {
  clientID: string
  directory: () => string | undefined
  isMobile: () => boolean
  /** Serialize the UI's local blocks for a layout push. */
  getRecords: () => WorkspaceBlockRecord[]
  /** The backend handed the UI a layout; the UI applies it to its blocks. */
  onServerLayout: (layout: WorkspaceLayoutInfo) => void
  /** The server announces authoritative chat-relay session bindings; keep
   * descriptor-owned session IDs in sync with UI state. */
  onChatRelayBinding?: (binding: { blockID: string; sessionID: string | undefined }) => void
  /** Whether the UI currently has local (non-legacy) blocks. */
  hasLocalBlocks: () => boolean
  notify: (message: string) => void
  /** M5 sdk-port factory: maps G1's generated master-agent endpoints and the
   * workspace coderModel patch/read onto the M1 client port. Defaults to the
   * M5 composition (createMasterAgentPort(createMasterAgentSdkPort(client)));
   * hosts may override for tests or alternative transports. */
  masterAgentPort?: MasterAgentPortFactory
  /** Client-side availability gate for the workspace Coder model; the host
   * re-validates server-side. Defaults to always available. */
  isCoderModelAvailable?: (model: ModelSelection) => boolean
  /** Test seam: overrides the ServerSDK context accessor. */
  serverSDK?: Accessor<ServerSDK>
}

/** M5's sdk-port factory shape (spec 02 §11). */
export type MasterAgentPortFactory = (client: ReturnType<typeof createSdkForServer>) => MasterAgentPort

const WORKSPACE_STORAGE_KEY = "opencode.canvas.workspaceID.v1"

/** Narrow MasterAgent surface consumed by B3 (spec 02 §12). Owns binding and
 * workspace Coder configuration communication only; Session messages, prompt
 * admission, queue projection, terminal, files, and review state stay in the
 * existing Session subsystems. */
export interface MasterAgentManagerApi {
  state(blockID: string): Accessor<BindingState>
  ensure(blockID: string): Promise<void>
  retry(blockID: string): Promise<void>
  reset(blockID: string): Promise<void>
  removeLocalProjection(blockID: string): void
  coder: CoderController<ModelSelection>
  /** The master-agent functionality descriptor (block type/module metadata). */
  descriptor: MasterAgentBlockModule
}

export interface CanvasManager {
  workspaceID: () => string | undefined
  revision: () => number | undefined
  connected: () => boolean
  dirty: () => boolean
  operatingAgentKey: () => string | undefined
  modelKey: () => string | undefined
  directories: () => string[] | undefined
  configPermission: () => PermissionConfig | undefined
  /** The UI edited blocks; the manager decides dirty vs local-authoritative. */
  noteLocalEdit: () => void
  connect: () => Promise<void>
  refresh: () => Promise<WorkspaceLayoutInfo | undefined>
  sync: () => Promise<void>
  selectOperatingAgent: (key: string) => Promise<void>
  selectModel: (key: string) => Promise<void>
  updateDirectories: (directories: string[]) => Promise<void>
  loadConfig: () => Promise<void>
  masterAgent: MasterAgentManagerApi
  start: () => void
  dispose: () => void
}

// A layout whose only block is the unit-sized default chat block means the
// server has never received a user arrangement.
export function isPristineDefault(layout: WorkspaceLayoutInfo) {
  const only = layout.blocks.length === 1 ? layout.blocks[0] : undefined
  return only !== undefined && only.functionality === "builtin:chat" && only.transform.w <= 1 && only.transform.h <= 1
}

export function createCanvasManager(input: CanvasManagerInput): CanvasManager {
  const serverSDK = input.serverSDK ?? useServerSDK()
  const [workspaceID, setWorkspaceID] = createSignal<string>()
  const [revision, setRevision] = createSignal<number>()
  const [connected, setConnected] = createSignal(false)
  const [dirty, setDirty] = createSignal(false)
  const [operatingAgentKey, setOperatingAgentKey] = createSignal<string>()
  const [modelKey, setModelKey] = createSignal<string>()
  const [directories, setDirectories] = createSignal<string[]>()
  const [configPermission, setConfigPermission] = createSignal<PermissionConfig>()

  let tupleCache: WorkspaceLayoutTuple | undefined
  let syncInFlight = false
  let refreshInFlight = false
  let localAuthoritative = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let configUnsubscribe: (() => void) | undefined
  let layoutUnsubscribe: (() => void) | undefined
  let chatRelayBindingUnsubscribe: (() => void) | undefined
  let started = false

  // MasterAgent domain state (M6): per-block lifecycle controllers, the
  // binding-event reconciliation, and the workspace-wide Coder controller.
  // The host owns the authoritative binding and Coder model; this manager
  // owns only client projections. Layout serialization, localStorage, and
  // IndexedDB never carry binding/session/queue state (spec 02 §1-2).
  const [coderModelValue, setCoderModelValue] = createSignal<ModelSelection | null>(null)
  const controllers = new Map<string, MasterAgentLifecycleController>()
  const reconnectListeners = new Set<() => void>()
  let port: MasterAgentPort | undefined
  let coderController: CoderController<ModelSelection> | undefined
  let hasConnectedOnce = false
  let disposed = false
  const chatRelayRevisions = new Map<string, number>()

  // The layout tuple is fixed for the lifetime of the client session: the
  // server resolves/stores one layout per (user, style, deviceClass).
  function layoutTuple(): WorkspaceLayoutTuple {
    tupleCache ??= { user: "", style: "default", deviceClass: input.isMobile() ? "mobile" : "desktop" }
    return tupleCache
  }

  async function ensureWorkspace() {
    const current = workspaceID()
    if (current) return current
    const client = serverSDK().client
    // Stable workspace identity: re-use the previously resolved ID (validated
    // against the server) instead of grabbing whichever workspace happens to
    // be newest in a shared list.
    const persisted = readPersistedWorkspaceID()
    if (persisted) {
      try {
        await client.v2.workspace.get({ id: persisted }, { throwOnError: true })
        setWorkspaceID(persisted)
        return persisted
      } catch {
        // Stale ID (deleted/reset workspace) — fall through to list/create.
      }
    }
    const list = await client.v2.workspace.list({ throwOnError: true })
    // Prefer the canvas's own workspace over test/transient workspaces that
    // may sort first by recency.
    const preferred = list.data.find((workspace) => workspace.name === "Default") ?? list.data[0]
    let id = preferred?.id
    if (!id) {
      const created = await client.v2.workspace.create({ name: "Default" }, { throwOnError: true })
      id = created.data.id
    }
    setWorkspaceID(id)
    persistWorkspaceID(id)
    return id
  }

  function readPersistedWorkspaceID(): string | undefined {
    try {
      return localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? undefined
    } catch {
      return undefined
    }
  }

  function persistWorkspaceID(id: string) {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, id)
    } catch {
      /* localStorage can be unavailable in private contexts */
    }
  }

  // Flips the client to connected and, on any connect after the first, tells
  // the master-agent reconciliation to re-sync known blocks (authoritative
  // get/ensure, spec 02 §11): the event stream may have dropped while
  // disconnected and buffered events are transient.
  function markConnected() {
    setConnected(true)
    if (hasConnectedOnce) fireMasterAgentReconnect()
    hasConnectedOnce = true
  }

  // Pull: runs when the client connects. The server is authoritative here;
  // afterwards the client owns the layout until the next change is synced.
  // Pulling also claims layout authority for this client (handover): the
  // last client to pull a tuple owns its layout.
  async function connect() {
    if (connected()) return
    try {
      const client = serverSDK().client
      const id = await ensureWorkspace()
      const workspaceResult = await client.v2.workspace.get({ id }, { throwOnError: true })
      setOperatingAgentKey(workspaceResult.data.operatingAgent)
      setModelKey(workspaceResult.data.model)
      setDirectories(workspaceResult.data.directories)
      setCoderModelValue(parseModelKey(workspaceResult.data.coderModel))
      const result = await client.v2.workspace.layout.get(
        { workspaceLayoutGetPayload: { workspaceID: id, tuple: layoutTuple(), clientID: input.clientID } },
        { throwOnError: true },
      )
      const layout = result.data
      // The client edited while the backend was unreachable (DEV mode): those
      // edits are authoritative. Keep them and push once connected, instead
      // of clobbering the canvas with the server's stale layout.
      const clientOwnsLayout = localAuthoritative || (isPristineDefault(layout) && input.hasLocalBlocks())
      if (clientOwnsLayout) {
        setRevision(layout.revision)
        markConnected()
        setDirty(true)
        localAuthoritative = false
        void sync()
        void syncChatRelayBindings()
        return
      }
      input.onServerLayout(layout)
      setRevision(layout.revision)
      markConnected()
      setDirty(false)
      void syncChatRelayBindings()
    } catch {
      setConnected(false)
      retryTimer = setTimeout(() => void connect(), 5000)
    }
  }

  // Re-pull the authoritative layout. Pulling re-claims authority, so a
  // handed-over client re-syncs to the latest state and can push again.
  async function refresh() {
    if (refreshInFlight) return
    refreshInFlight = true
    try {
      const client = serverSDK().client
      const result = await client.v2.workspace.layout.get(
        { workspaceLayoutGetPayload: { workspaceID: workspaceID()!, tuple: layoutTuple(), clientID: input.clientID } },
        { throwOnError: true },
      )
      input.onServerLayout(result.data)
      void syncChatRelayBindings()
      setRevision(result.data.revision)
      return result.data
    } catch {
      return undefined
    } finally {
      refreshInFlight = false
    }
  }

  // Push: only when the layout actually changed after connect. Movements are
  // already live client-side; this just re-syncs the settled state.
  async function sync() {
    if (syncInFlight || !connected() || !dirty() || revision() === undefined || !workspaceID()) return
    syncInFlight = true
    setDirty(false)
    const blocks = input.getRecords()
    const expectedRevision = revision()!
    try {
      const client = serverSDK().client
      const result = await client.v2.workspace.layout.save(
        {
          workspaceLayoutSavePayload: {
            workspaceID: workspaceID()!,
            tuple: layoutTuple(),
            blocks,
            expectedRevision,
            clientID: input.clientID,
          },
        },
        { throwOnError: true },
      )
      if (result.data.status === "saved") {
        setRevision(result.data.layout.revision)
        if (dirty()) void sync()
        return
      }
      if (result.data.status === "handed-over") {
        // Authority was handed over to another client (another window/device
        // connected after us). Re-pull to re-claim, adopt the latest layout,
        // and re-push our settled state (explicit retry = last-write-wins).
        await refresh()
        input.notify("Layout updated from another window")
        setDirty(true)
        void sync()
        return
      }
      // Conflict: the server is the tie-breaker. Re-pull and adopt.
      await refresh()
      setDirty(false)
      input.notify("Layout updated from server")
    } catch {
      // The change is not lost: re-raise the dirty flag and retry after a
      // short delay, so a transient failure re-syncs without user input.
      setDirty(true)
      setTimeout(() => void sync(), 3000)
    } finally {
      syncInFlight = false
    }
  }

  // Selects the workspace's OperatingAgent model: optimistic on the client,
  // authoritative on the server (workspace.operatingAgent).
  async function selectOperatingAgent(key: string) {
    const id = workspaceID()
    if (!id) return
    setOperatingAgentKey(key)
    try {
      const client = serverSDK().client
      await client.v2.workspace.update(
        { workspaceUpdatePayload: { id, patch: { operatingAgent: key } } },
        { throwOnError: true },
      )
    } catch {
      input.notify("Failed to save OperatingAgent model")
    }
  }

  // Selects the workspace's frontend model: optimistic on the client,
  // authoritative on the server (workspace.model).
  async function selectModel(key: string) {
    const id = workspaceID()
    if (!id) return
    setModelKey(key)
    try {
      const client = serverSDK().client
      await client.v2.workspace.update(
        { workspaceUpdatePayload: { id, patch: { model: key } } },
        { throwOnError: true },
      )
    } catch {
      input.notify("Failed to save workspace model")
    }
  }

  // Updates the workspace's working directories: optimistic on the client,
  // authoritative on the server (workspace.directories). The first directory
  // is the workspace's primary directory (chat blocks bind to it).
  async function updateDirectories(next: string[]) {
    const id = workspaceID()
    if (!id) return
    setDirectories(next)
    try {
      const client = serverSDK().client
      await client.v2.workspace.update(
        { workspaceUpdatePayload: { id, patch: { directories: next } } },
        { throwOnError: true },
      )
    } catch {
      input.notify("Failed to save workspace directories")
    }
  }

  // Config: loads the project config (the project's .opencode config folder
  // via the directory-scoped SDK). If the project has no permission
  // configuration yet, one is created with ALL permissions denied.
  async function loadConfig() {
    const directory = input.directory()
    if (!directory) return
    try {
      const client = serverSDK().createClient({ directory, throwOnError: true })
      const result = await client.config.get({ directory }, { throwOnError: true })
      const config = result.data
      if (config.permission === undefined) {
        await client.config.update({ directory, config: { permission: "deny" } }, { throwOnError: true })
        setConfigPermission("deny")
        input.notify("Project config created — all permissions denied")
        return
      }
      setConfigPermission(config.permission)
    } catch {
      /* offline or no project yet — retried on reconnect */
    }
  }

  function noteLocalEdit() {
    if (connected()) setDirty(true)
    else if (import.meta.env.DEV) localAuthoritative = true
  }

  // Chat-relay block IDs in the current layout records.
  function chatRelayBlockIDs(): string[] {
    return input
      .getRecords()
      .filter((record) => record.functionality === "builtin:chat-relay")
      .map((record) => record.id)
  }

  // Chat-relay bindings are authoritative. Rebuild descriptor bindings from the
  // chat-relay API after layout changes so the first-boot path can hydrate
  // existing server-bound sessions even without events.
  function syncChatRelayBindings() {
    const id = workspaceID()
    if (!id) return
    const blockIDs = chatRelayBlockIDs()
    if (blockIDs.length === 0) return

    void Promise.all(
      blockIDs.map(async (blockID) => {
        try {
          const result = await serverSDK().client.v2.workspace.chatRelay.get(
            { workspaceID: id, blockID },
            { throwOnError: true },
          )
          const response = result.data
          if (response.status === "bound") {
            chatRelayRevisions.set(blockID, response.binding.revision)
            input.onChatRelayBinding?.({ blockID, sessionID: response.binding.sessionID })
            return
          }
          chatRelayRevisions.delete(blockID)
          input.onChatRelayBinding?.({ blockID, sessionID: undefined })
        } catch {
          /* chat-relay fetch failures are non-blocking for canvas interactions */
        }
      }),
    )
  }

  // ---- MasterAgent domain (M6) ----

  // Master-agent block IDs in the current layout records; layout is the only
  // client-side source of block identity (never session/binding state).
  function masterAgentBlockIDs(): string[] {
    return input
      .getRecords()
      .filter((record) => record.functionality === MASTER_AGENT_FUNCTIONALITY_ID)
      .map((record) => record.id)
  }

  // M5's sdk-port maps the generated master-agent endpoints onto the M1
  // transport; the default composition adapts that transport to this
  // manager's port. Hosts may inject an alternative via \`masterAgentPort\`.
  function resolvePort(): MasterAgentPort {
    port ??= (input.masterAgentPort ?? defaultMasterAgentPort)(serverSDK().client)
    return port
  }

  function controllerFor(blockID: string): MasterAgentLifecycleController {
    let controller = controllers.get(blockID)
    if (!controller) {
      controller = createMasterAgentLifecycleController({
        workspaceID,
        blockID,
        port: resolvePort(),
      })
      controllers.set(blockID, controller)
    }
    return controller
  }

  function fireMasterAgentReconnect() {
    for (const listener of reconnectListeners) listener()
  }

  // A binding-updated event can land before the block's initial get finishes;
  // hand the newest buffered event to the controller once it has a revision
  // to compare against (stale events are dropped by the reducer).
  function drainBufferedBinding(blockID: string) {
    const event = reconciliation.takeBuffered(blockID)
    if (event) controllers.get(blockID)?.dispatch({ type: "binding-updated", event })
  }

  const reconciliation = createMasterAgentEventReconciliation({
    workspaceID,
    isKnownBlock: (blockID) => masterAgentBlockIDs().includes(blockID),
    knownBlocks: masterAgentBlockIDs,
    currentRevision: (blockID) => {
      const state = controllers.get(blockID)?.state()
      return state?.status === "ready" ? state.binding.revision : undefined
    },
    onBindingUpdated: (event) => {
      controllers.get(event.blockID)?.dispatch({ type: "binding-updated", event })
    },
    refetch: (blockID) => void controllerFor(blockID).refetch(),
    listen: (listener) =>
      serverSDK().event.listen((entry) => {
        // The ServerSDK emitter delivers \`{ name, details }\` with \`details\`
        // being the ServerEvent (type + properties); the reconciliation
        // filters by \`details.type\` and drops stale/foreign payloads.
        listener({ name: entry.name, details: { type: entry.details.type, properties: entry.details.properties } })
      }),
    onReconnect: (listener) => {
      reconnectListeners.add(listener)
      return () => {
        reconnectListeners.delete(listener)
      }
    },
  })

  // Drop projections for master-agent blocks that left the layout; the canvas
  // block-removal flow never needs to know about them.
  const disposeBlockTracking = createRoot((disposeRoot) => {
    createEffect(() => {
      const blockIDs = masterAgentBlockIDs()
      for (const [blockID, controller] of controllers) {
        if (blockIDs.includes(blockID)) continue
        controller.dispose()
        controllers.delete(blockID)
      }
    })
    return disposeRoot
  })

  // The project config's \`task\` permission gates Coder configuration; the
  // host enforces it again server-side.
  function taskPermission(): CoderTaskPermission {
    const permission = resolveConfigPermission(configPermission(), "task")
    if (permission === "allow" || permission === "ask" || permission === "deny") return permission
    return "default"
  }

  // Workspace-wide Coder settings (spec 02 §12): one controller per manager,
  // shared by every master-agent block in the workspace.
  function coder(): CoderController<ModelSelection> {
    coderController ??= createCoderController({
      workspaceID,
      coderModel: coderModelValue,
      patchCoderModel: (id, model, signal) => resolvePort().patchCoderModel(id, model, signal),
      onServerModel: (model) => setCoderModelValue(model),
      taskPermission,
      isModelAvailable: input.isCoderModelAvailable ?? (() => true),
    })
    return coderController
  }

  const masterAgent: MasterAgentManagerApi = {
    state: (blockID) => controllerFor(blockID).state,
    ensure: async (blockID) => {
      if (disposed) return
      await controllerFor(blockID).ensure()
      drainBufferedBinding(blockID)
    },
    retry: async (blockID) => {
      if (disposed) return
      await controllerFor(blockID).retry()
      drainBufferedBinding(blockID)
    },
    reset: async (blockID) => {
      if (disposed) return
      await controllerFor(blockID).reset()
    },
    removeLocalProjection: (blockID) => {
      const controller = controllers.get(blockID)
      if (!controller) return
      controller.dispose()
      controllers.delete(blockID)
    },
    coder: {
      get model() {
        return coder().model
      },
      get enabled() {
        return coder().enabled
      },
      get pending() {
        return coder().pending
      },
      get error() {
        return coder().error
      },
      set: (model) => coder().set(model),
      clear: () => coder().clear(),
      retry: () => coder().retry(),
    },
    descriptor: MASTER_AGENT_MODULE,
  }

  let cleanupLocalListeners: () => void = () => {}

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
            revision?: unknown
          }
        | undefined
      if (!isRecord(properties)) return
      if (typeof properties.workspaceID !== "string" || properties.workspaceID !== workspaceID()) return
      if (typeof properties.blockID !== "string") return
      if (properties.sessionID !== undefined && typeof properties.sessionID !== "string") return
      if (typeof properties.revision !== "number") return
      const existingRevision = chatRelayRevisions.get(properties.blockID)
      if (existingRevision !== undefined && existingRevision >= properties.revision) return
      chatRelayRevisions.set(properties.blockID, properties.revision)
      input.onChatRelayBinding?.({
        blockID: properties.blockID,
        sessionID: typeof properties.sessionID === "string" ? properties.sessionID : undefined,
      })
    })

    cleanupLocalListeners = () => unsubs.forEach((unsub) => unsub())
  }

  function dispose() {
    if (disposed) return
    disposed = true
    clearTimeout(retryTimer)
    cleanupLocalListeners()
    configUnsubscribe?.()
    layoutUnsubscribe?.()
    chatRelayBindingUnsubscribe?.()
    configUnsubscribe = undefined
    layoutUnsubscribe = undefined
    chatRelayBindingUnsubscribe = undefined
    reconciliation.dispose()
    disposeBlockTracking()
    reconnectListeners.clear()
    for (const controller of controllers.values()) controller.dispose()
    controllers.clear()
    port = undefined
    coderController = undefined
    chatRelayRevisions.clear()
    started = false
  }

  return {
    workspaceID,
    revision,
    connected,
    dirty,
    operatingAgentKey,
    modelKey,
    directories,
    configPermission,
    noteLocalEdit,
    connect,
    refresh,
    sync,
    selectOperatingAgent,
    selectModel,
    updateDirectories,
    loadConfig,
    masterAgent,
    start,
    dispose,
  }
}

// Workspace model fields are \`providerID:modelID\` keys (the canvas model
// picker's key format); M1's ModelSelection is the structured view of the
// same selection. Malformed or missing keys decode as null.
function parseModelKey(key: string | null | undefined): ModelSelection | null {
  if (!key) return null
  const [providerID, modelID, variant] = key.split(":")
  if (!providerID || !modelID) return null
  return variant === undefined ? { providerID, modelID } : { providerID, modelID, variant }
}

// Mirrors the canvas page's config normalization for the \`task\` permission
// key. The page's helper cannot be imported here without a module cycle.
function resolveConfigPermission(config: PermissionConfig | undefined, key: string): PermissionAction | undefined {
  if (!config) return undefined
  if (typeof config === "string") return config
  const value = config[key] ?? config["*"]
  if (value === undefined) return undefined
  if (typeof value === "string") return value
  return resolveConfigPermission(value, key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

// Default port composition (M5): sdk-port adapts G1's generated
// master-agent endpoints and the workspace coderModel patch onto the M1
// transport; the port layer adapts that transport to this manager's port.
function defaultMasterAgentPort(client: ReturnType<typeof createSdkForServer>): MasterAgentPort {
  return createMasterAgentPort(createMasterAgentSdkPort(client))
}

```

### `packages/protocol/src/groups/workspace.ts (181 lines)`

```ts
import { Workspace } from "@opencode-ai/schema/workspace"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceCoder } from "./workspace-coder"

const root = "/api/workspace"

export class WorkspaceError extends Schema.ErrorClass<WorkspaceError>("WorkspaceError")(
  {
    name: Schema.Literal("WorkspaceError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

const UpdatePayload = Schema.Struct({
  id: Workspace.ID,
  patch: Schema.Struct({
    name: Schema.optional(Schema.String),
    style: Schema.optional(Schema.String),
    directories: Schema.optional(Schema.Array(Schema.String)),
    pluginIDs: Schema.optional(Schema.Array(Schema.String)),
    skillIDs: Schema.optional(Schema.Array(Schema.String)),
    operatingAgent: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    ...WorkspaceCoder.patchFields,
  }),
}).annotate({ identifier: "Workspace.UpdatePayload" })

const LayoutGetPayload = Schema.Struct({
  workspaceID: Workspace.ID,
  tuple: Workspace.Layout.Tuple,
  clientID: Schema.String,
}).annotate({ identifier: "Workspace.Layout.GetPayload" })

const LayoutSavePayload = Schema.Struct({
  workspaceID: Workspace.ID,
  tuple: Workspace.Layout.Tuple,
  blocks: Schema.Array(Workspace.Block.Record),
  expectedRevision: NonNegativeInt,
  clientID: Schema.String,
}).annotate({ identifier: "Workspace.Layout.SavePayload" })

const LayoutSaveResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("saved"),
    layout: Workspace.Layout.Info,
  }),
  Schema.Struct({
    status: Schema.Literal("conflict"),
    currentRevision: NonNegativeInt,
  }),
  Schema.Struct({
    status: Schema.Literal("handed-over"),
    currentRevision: NonNegativeInt,
  }),
]).annotate({ identifier: "Workspace.Layout.SaveResult" })

export const WorkspaceGroup = HttpApiGroup.make("server.workspace")
  .add(
    HttpApiEndpoint.get("workspace.list", root, {
      success: Schema.Array(Workspace.Info),
      error: WorkspaceError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.list",
        summary: "List workspaces",
        description: "Retrieve all workspaces for the current user.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.create", root, {
      payload: Schema.Struct({ name: Schema.String }),
      success: Workspace.Info,
      error: WorkspaceError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.create",
        summary: "Create workspace",
        description: "Create a workspace with a name.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("workspace.get", \`${root}/:id\`, {
      params: { id: Workspace.ID },
      success: Workspace.Info,
      error: WorkspaceError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.get",
        summary: "Get workspace",
        description: "Retrieve a workspace by ID.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("workspace.update", root, {
      payload: UpdatePayload,
      success: Workspace.Info,
      error: WorkspaceError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.update",
        summary: "Update workspace",
        description: "Update a workspace's name, style, directories, plugins, or skills.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("workspace.remove", \`${root}/:id\`, {
      params: { id: Workspace.ID },
      success: HttpApiSchema.NoContent,
      error: WorkspaceError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.remove",
        summary: "Remove workspace",
        description: "Delete a workspace by ID.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.duplicate", \`${root}/:id/duplicate\`, {
      params: { id: Workspace.ID },
      success: Workspace.Info,
      error: WorkspaceError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.duplicate",
        summary: "Duplicate workspace",
        description: "Create a copy of an existing workspace.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.layout.get", \`${root}/layout\`, {
      payload: LayoutGetPayload,
      success: Workspace.Layout.Info,
      error: WorkspaceError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.layout.get",
        summary: "Get layout",
        description:
          "Resolve the layout for a (user, style, deviceClass) tuple, creating the default layout if missing.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.layout.save", \`${root}/layout/save\`, {
      payload: LayoutSavePayload,
      success: LayoutSaveResult,
      error: WorkspaceError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.layout.save",
        summary: "Save layout",
        description: "Save layout blocks for a tuple, checking the expected revision for conflicts.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("workspace.functionality.list", \`${root}/:workspaceID/functionality\`, {
      params: { workspaceID: Workspace.ID },
      success: Schema.Array(Workspace.Functionality.Info),
      error: WorkspaceError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.functionality.list",
        summary: "List workspace functionality",
        description: "List functionality available for a workspace.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "workspace", description: "Workspace management routes." }))

```

### `packages/server/src/handlers/workspace.ts (92 lines)`

```ts
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { Effect, Layer } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { WorkspaceError } from "@opencode-ai/protocol/groups/workspace"
import { WorkspaceMasterAgentHandler } from "./workspace-master-agent"

// Track S2 composition: the MasterAgent lifecycle group (S1) mounts under the
// same P3-composed server Api as the existing Workspace group. Both groups
// keep their service requirements (WorkspaceService, MasterAgentService,
// MasterAgentAccessService) open; the host composition (opencode app / cli
// serve) provides the live layers.
export const WorkspaceHandler = Layer.mergeAll(
  HttpApiBuilder.group(Api, "server.workspace", (handlers) =>
    Effect.succeed(
      handlers
        .handle("workspace.list", () => WorkspaceService.Service.use((workspace) => badRequest(workspace.list())))
        .handle("workspace.get", (ctx) =>
          WorkspaceService.Service.use((workspace) =>
            badRequest(workspace.get(ctx.params.id)).pipe(
              Effect.flatMap((info) =>
                info === undefined
                  ? Effect.fail(new WorkspaceError({ name: "WorkspaceError", data: { message: "Workspace not found" } }))
                  : Effect.succeed(info),
              ),
            ),
          ),
        )
        .handle("workspace.create", (ctx) =>
          WorkspaceService.Service.use((workspace) => badRequest(workspace.create({ name: ctx.payload.name }))),
        )
        .handle("workspace.update", (ctx) =>
          WorkspaceService.Service.use((workspace) => badRequest(workspace.update(ctx.payload.id, ctx.payload.patch))),
        )
        .handle("workspace.remove", (ctx) =>
          WorkspaceService.Service.use((workspace) =>
            badRequest(workspace.remove(ctx.params.id)).pipe(Effect.as(HttpApiSchema.NoContent.make())),
          ),
        )
        .handle("workspace.duplicate", (ctx) =>
          WorkspaceService.Service.use((workspace) => badRequest(workspace.duplicate(ctx.params.id))),
        )
        .handle("workspace.layout.get", (ctx) =>
          WorkspaceService.Service.use((workspace) =>
            badRequest(workspace.layout.get(ctx.payload.workspaceID, ctx.payload.tuple, ctx.payload.clientID)),
          ),
        )
        .handle("workspace.layout.save", (ctx) =>
          WorkspaceService.Service.use((workspace) =>
            badRequest(
              workspace.layout
                .save(
                  ctx.payload.workspaceID,
                  ctx.payload.tuple,
                  ctx.payload.blocks,
                  ctx.payload.expectedRevision,
                  ctx.payload.clientID,
                )
                .pipe(
                  Effect.map((layout) => ({ status: "saved" as const, layout })),
                  Effect.catchTag("Workspace.LayoutConflictError", (error) =>
                    Effect.succeed({ status: "conflict" as const, currentRevision: error.currentRevision }),
                  ),
                  Effect.catchTag("Workspace.LayoutHandedOverError", (error) =>
                    Effect.succeed({ status: "handed-over" as const, currentRevision: error.currentRevision }),
                  ),
                ),
            ),
          ),
        )
        .handle("workspace.functionality.list", (ctx) =>
          WorkspaceService.Service.use((workspace) => badRequest(workspace.functionality.list(ctx.params.workspaceID))),
        ),
    ),
  ),
  WorkspaceMasterAgentHandler,
)

function badRequest<A, R>(effect: Effect.Effect<A, unknown, R>) {
  return effect.pipe(
    Effect.mapError(
      (error) =>
        new WorkspaceError({
          name: "WorkspaceError",
          data: {
            message: error instanceof Error ? error.message : String(error),
          },
        }),
    ),
  )
}

```

### `packages/core/src/workspace/service.ts (626 lines)`

```ts
export * as WorkspaceService from "./service"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Workspace } from "@opencode-ai/schema/workspace"
import { WorkspaceEvent } from "@opencode-ai/schema/workspace-event"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"
import { MasterAgentBuiltin } from "./builtins/master-agent"
import { CoderModelCodec } from "./coder-model-codec"
import { createDefaultLayout } from "./default-layout"
import { LayoutAuthorityTable, LayoutOptionTable, LayoutTable, WorkspaceGitTable, WorkspaceV2Table } from "./sql"

export type UpdatePatch = {
  name?: string
  style?: string
  directories?: readonly string[]
  pluginIDs?: readonly string[]
  skillIDs?: readonly string[]
  operatingAgent?: string
  model?: string
  coderModel?: string | null
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Workspace.NotFoundError", {
  workspaceID: Workspace.ID,
}) {}

export class LayoutConflictError extends Schema.TaggedErrorClass<LayoutConflictError>()(
  "Workspace.LayoutConflictError",
  {
    currentRevision: Schema.Number,
  },
) {}

export class LayoutHandedOverError extends Schema.TaggedErrorClass<LayoutHandedOverError>()(
  "Workspace.LayoutHandedOverError",
  {
    currentRevision: Schema.Number,
  },
) {}

export interface Interface {
  readonly list: () => Effect.Effect<Workspace.Info[]>
  readonly get: (workspaceID: Workspace.ID) => Effect.Effect<Workspace.Info | undefined>
  readonly create: (input: { name: string }) => Effect.Effect<Workspace.Info>
  readonly rename: (workspaceID: Workspace.ID, name: string) => Effect.Effect<Workspace.Info, NotFoundError>
  readonly remove: (workspaceID: Workspace.ID) => Effect.Effect<void, NotFoundError>
  readonly duplicate: (workspaceID: Workspace.ID) => Effect.Effect<Workspace.Info, NotFoundError>
  readonly update: (workspaceID: Workspace.ID, patch: UpdatePatch) => Effect.Effect<Workspace.Info, NotFoundError>
  readonly layout: {
    readonly get: (
      workspaceID: Workspace.ID,
      tuple: Workspace.Layout.Tuple,
      clientID: string,
      options?: { claimAuthority?: boolean },
    ) => Effect.Effect<Workspace.Layout.Info>
    readonly save: (
      workspaceID: Workspace.ID,
      tuple: Workspace.Layout.Tuple,
      blocks: readonly Workspace.Block.Record[],
      expectedRevision: number,
      clientID: string,
    ) => Effect.Effect<Workspace.Layout.Info, LayoutConflictError | LayoutHandedOverError>
  }
  readonly functionality: {
    readonly list: (workspaceID: Workspace.ID) => Effect.Effect<readonly Workspace.Functionality.Info[]>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Workspace") {}

const builtins = [
  Workspace.Functionality.Info.make({
    id: "builtin:chat",
    kind: "builtin",
    label: "Chat",
    minW: 4,
    minH: 4,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:online-search",
    kind: "builtin",
    label: "Online search",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:screenshot-browser",
    kind: "builtin",
    label: "Screenshot browser",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:application-window-stream",
    kind: "builtin",
    label: "Application window stream",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:chat-relay",
    kind: "builtin",
    label: "ChatRelay",
    minW: 4,
    minH: 4,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:operating-chat-session",
    kind: "builtin",
    label: "Operating chat session",
    minW: 4,
    minH: 4,
    maxW: null,
    maxH: null,
  }),
  MasterAgentBuiltin,
  Workspace.Functionality.Info.make({
    id: "builtin:context",
    kind: "builtin",
    label: "Project context",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:tools",
    kind: "builtin",
    label: "Tool activity",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:files",
    kind: "builtin",
    label: "Workspace files",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:notes",
    kind: "builtin",
    label: "Scratchpad",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:voice",
    kind: "builtin",
    label: "Voice input",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
] satisfies readonly Workspace.Functionality.Info[]

type WorkspaceRow = typeof WorkspaceV2Table.$inferSelect
type GitRow = typeof WorkspaceGitTable.$inferSelect
type LayoutRow = typeof LayoutTable.$inferSelect

function fromRows(row: WorkspaceRow, git: GitRow[]): Workspace.Info {
  return Workspace.Info.make({
    id: Workspace.ID.make(row.id),
    name: row.name,
    style: row.style,
    directories: row.directories,
    pluginIDs: row.plugin_ids,
    skillIDs: row.skill_ids,
    operatingAgent: row.operating_agent ?? undefined,
    model: row.model ?? undefined,
    coderModel: CoderModelCodec.decode(row.coder_model),
    git: git.map((entry) => ({
      directory: entry.directory,
      branch: entry.branch ?? undefined,
      remote: entry.remote ?? undefined,
      dirty: entry.dirty,
    })),
    time: { created: row.time_created, updated: row.time_updated },
  })
}

function layoutFromRow(row: LayoutRow): Workspace.Layout.Info {
  return Workspace.Layout.Info.make({
    id: row.id,
    workspaceID: Workspace.ID.make(row.workspace_id),
    revision: row.revision,
    blocks: row.blocks,
  })
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service

    const load = Effect.fn("Workspace.load")(function* (workspaceID: Workspace.ID) {
      const row = yield* db
        .select()
        .from(WorkspaceV2Table)
        .where(eq(WorkspaceV2Table.id, workspaceID))
        .get()
        .pipe(Effect.orDie)
      if (!row) return undefined
      const git = yield* db
        .select()
        .from(WorkspaceGitTable)
        .where(eq(WorkspaceGitTable.workspace_id, workspaceID))
        .all()
        .pipe(Effect.orDie)
      return fromRows(row, git)
    })

    const requireWorkspace = Effect.fn("Workspace.requireWorkspace")(function* (workspaceID: Workspace.ID) {
      const info = yield* load(workspaceID)
      if (!info) return yield* new NotFoundError({ workspaceID })
      return info
    })

    const findOption = Effect.fn("Workspace.findOption")(function* (
      workspaceID: Workspace.ID,
      user: string,
      style: string,
      deviceClass: string,
      deviceID: string | null,
    ) {
      return yield* db
        .select()
        .from(LayoutOptionTable)
        .where(
          and(
            eq(LayoutOptionTable.workspace_id, workspaceID),
            eq(LayoutOptionTable.user, user),
            eq(LayoutOptionTable.style, style),
            eq(LayoutOptionTable.device_class, deviceClass),
            deviceID === null ? isNull(LayoutOptionTable.device_id) : eq(LayoutOptionTable.device_id, deviceID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
    })

    const loadLayout = Effect.fn("Workspace.loadLayout")(function* (layoutID: string) {
      const row = yield* db.select().from(LayoutTable).where(eq(LayoutTable.id, layoutID)).get().pipe(Effect.orDie)
      return row ? layoutFromRow(row) : undefined
    })

    const findFallback = Effect.fn("Workspace.findFallback")(function* (
      workspaceID: Workspace.ID,
      user: string,
      style: string | undefined,
    ) {
      const rows = yield* db
        .select()
        .from(LayoutOptionTable)
        .where(
          style === undefined
            ? and(eq(LayoutOptionTable.workspace_id, workspaceID), eq(LayoutOptionTable.user, user))
            : and(
                eq(LayoutOptionTable.workspace_id, workspaceID),
                eq(LayoutOptionTable.user, user),
                eq(LayoutOptionTable.style, style),
              ),
        )
        .all()
        .pipe(Effect.orDie)
      return rows[0]
    })

    // Handover: pulling a layout claims authority for the requesting client.
    const claimAuthority = Effect.fn("Workspace.claimAuthority")(function* (
      workspaceID: Workspace.ID,
      tuple: Workspace.Layout.Tuple,
      clientID: string,
    ) {
      yield* db
        .insert(LayoutAuthorityTable)
        .values({
          workspace_id: workspaceID,
          user: tuple.user,
          style: tuple.style,
          device_class: tuple.deviceClass,
          holder_id: clientID,
          held_at: Date.now(),
        })
        .onConflictDoUpdate({
          target: [
            LayoutAuthorityTable.workspace_id,
            LayoutAuthorityTable.user,
            LayoutAuthorityTable.style,
            LayoutAuthorityTable.device_class,
          ],
          set: { holder_id: clientID, held_at: Date.now() },
        })
        .run()
        .pipe(Effect.orDie)
    })

    // Saves only go through for the client currently holding authority for the
    // tuple; a stale holder gets a handed-over rejection carrying the current
    // revision so it can re-pull (re-claim) and retry.
    const requireAuthority = Effect.fn("Workspace.requireAuthority")(function* (
      workspaceID: Workspace.ID,
      tuple: Workspace.Layout.Tuple,
      clientID: string,
      currentRevision: number,
    ) {
      const row = yield* db
        .select()
        .from(LayoutAuthorityTable)
        .where(
          and(
            eq(LayoutAuthorityTable.workspace_id, workspaceID),
            eq(LayoutAuthorityTable.user, tuple.user),
            eq(LayoutAuthorityTable.style, tuple.style),
            eq(LayoutAuthorityTable.device_class, tuple.deviceClass),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (row && row.holder_id !== clientID) {
        return yield* new LayoutHandedOverError({ currentRevision })
      }
      return undefined
    })

    const resolveLayout = Effect.fn("Workspace.resolveLayout")(function* (
      workspaceID: Workspace.ID,
      tuple: Workspace.Layout.Tuple,
    ) {
      const exactDevice =
        tuple.deviceID === undefined
          ? undefined
          : yield* findOption(workspaceID, tuple.user, tuple.style, tuple.deviceClass, tuple.deviceID)
      const exactClass = yield* findOption(workspaceID, tuple.user, tuple.style, tuple.deviceClass, null)
      const byStyle = yield* findFallback(workspaceID, tuple.user, tuple.style)
      const byUser = yield* findFallback(workspaceID, tuple.user, undefined)
      const option = exactDevice ?? exactClass ?? byStyle ?? byUser
      if (option) {
        const layout = yield* loadLayout(option.layout_id)
        if (layout) return layout
      }
      const layout = createDefaultLayout(workspaceID)
      yield* db
        .insert(LayoutTable)
        .values({
          id: layout.id,
          workspace_id: workspaceID,
          revision: layout.revision,
          blocks: layout.blocks,
          time_updated: Date.now(),
        })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(LayoutOptionTable)
        .values({
          workspace_id: workspaceID,
          user: tuple.user,
          style: tuple.style,
          device_class: tuple.deviceClass,
          device_id: tuple.deviceID ?? null,
          layout_id: layout.id,
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      return layout
    })

    return Service.of({
      list: Effect.fn("Workspace.list")(function* () {
        const rows = yield* db
          .select()
          .from(WorkspaceV2Table)
          .orderBy(desc(WorkspaceV2Table.time_updated))
          .all()
          .pipe(Effect.orDie)
        if (rows.length === 0) return []
        const git = yield* db
          .select()
          .from(WorkspaceGitTable)
          .where(
            inArray(
              WorkspaceGitTable.workspace_id,
              rows.map((row) => row.id),
            ),
          )
          .all()
          .pipe(Effect.orDie)
        return rows.map((row) =>
          fromRows(
            row,
            git.filter((entry) => entry.workspace_id === row.id),
          ),
        )
      }),
      get: Effect.fn("Workspace.get")(function* (workspaceID) {
        return yield* load(workspaceID)
      }),
      create: Effect.fn("Workspace.create")(function* (input) {
        const id = Workspace.ID.create()
        const now = Date.now()
        const info = Workspace.Info.make({
          id,
          name: input.name,
          style: "default",
          directories: [],
          pluginIDs: [],
          skillIDs: [],
          git: [],
          time: { created: now, updated: now },
        })
        yield* db
          .insert(WorkspaceV2Table)
          .values({
            id,
            name: info.name,
            style: info.style,
            directories: [],
            plugin_ids: [],
            skill_ids: [],
            coder_model: CoderModelCodec.encode(info.coderModel),
            // Identity is resolved at the protocol layer; the core defaults to the anonymous user.
            user: "",
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)
        return info
      }),
      rename: Effect.fn("Workspace.rename")(function* (workspaceID, name) {
        yield* requireWorkspace(workspaceID)
        yield* db
          .update(WorkspaceV2Table)
          .set({ name, time_updated: Date.now() })
          .where(eq(WorkspaceV2Table.id, workspaceID))
          .run()
          .pipe(Effect.orDie)
        return yield* requireWorkspace(workspaceID)
      }),
      remove: Effect.fn("Workspace.remove")(function* (workspaceID) {
        yield* requireWorkspace(workspaceID)
        yield* db.delete(WorkspaceV2Table).where(eq(WorkspaceV2Table.id, workspaceID)).run().pipe(Effect.orDie)
      }),
      duplicate: Effect.fn("Workspace.duplicate")(function* (workspaceID) {
        const source = yield* requireWorkspace(workspaceID)
        const id = Workspace.ID.create()
        const now = Date.now()
        const info = Workspace.Info.make({
          id,
          name: \`${source.name} (copy)\`,
          style: source.style,
          directories: source.directories,
          pluginIDs: source.pluginIDs,
          skillIDs: source.skillIDs,
          operatingAgent: source.operatingAgent,
          model: source.model,
          coderModel: source.coderModel,
          git: source.git,
          time: { created: now, updated: now },
        })
        yield* db
          .insert(WorkspaceV2Table)
          .values({
            id,
            name: info.name,
            style: info.style,
            directories: info.directories,
            plugin_ids: info.pluginIDs,
            skill_ids: info.skillIDs,
            operating_agent: info.operatingAgent ?? null,
            model: info.model ?? null,
            coder_model: CoderModelCodec.encode(info.coderModel),
            user: "",
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)
        if (source.git.length > 0)
          yield* db
            .insert(WorkspaceGitTable)
            .values(
              source.git.map((entry) => ({
                workspace_id: id,
                directory: entry.directory,
                branch: entry.branch ?? null,
                remote: entry.remote ?? null,
                dirty: entry.dirty,
              })),
            )
            .run()
            .pipe(Effect.orDie)
        const layouts = yield* db
          .select()
          .from(LayoutTable)
          .where(eq(LayoutTable.workspace_id, workspaceID))
          .all()
          .pipe(Effect.orDie)
        const layoutIDs = new Map(layouts.map((row) => [row.id, crypto.randomUUID()]))
        if (layouts.length > 0)
          yield* db
            .insert(LayoutTable)
            .values(
              layouts.map((row) => ({
                id: layoutIDs.get(row.id)!,
                workspace_id: id,
                revision: row.revision,
                blocks: row.blocks,
                time_updated: row.time_updated,
              })),
            )
            .run()
            .pipe(Effect.orDie)
        const options = yield* db
          .select()
          .from(LayoutOptionTable)
          .where(eq(LayoutOptionTable.workspace_id, workspaceID))
          .all()
          .pipe(Effect.orDie)
        if (options.length > 0)
          yield* db
            .insert(LayoutOptionTable)
            .values(
              options.map((option) => ({
                workspace_id: id,
                user: option.user,
                style: option.style,
                device_class: option.device_class,
                device_id: option.device_id,
                layout_id: layoutIDs.get(option.layout_id) ?? option.layout_id,
              })),
            )
            .run()
            .pipe(Effect.orDie)
        return info
      }),
      update: Effect.fn("Workspace.update")(function* (workspaceID, patch) {
        yield* requireWorkspace(workspaceID)
        yield* db
          .update(WorkspaceV2Table)
          .set({
            ...(patch.name === undefined ? {} : { name: patch.name }),
            ...(patch.style === undefined ? {} : { style: patch.style }),
            ...(patch.directories === undefined ? {} : { directories: patch.directories }),
            ...(patch.pluginIDs === undefined ? {} : { plugin_ids: patch.pluginIDs }),
            ...(patch.skillIDs === undefined ? {} : { skill_ids: patch.skillIDs }),
            ...(patch.operatingAgent === undefined ? {} : { operating_agent: patch.operatingAgent || null }),
            ...(patch.model === undefined ? {} : { model: patch.model || null }),
            ...(CoderModelCodec.encodePatch(patch.coderModel) ?? {}),
            time_updated: Date.now(),
          })
          .where(eq(WorkspaceV2Table.id, workspaceID))
          .run()
          .pipe(Effect.orDie)
        return yield* requireWorkspace(workspaceID)
      }),
      layout: {
        get: Effect.fn("Workspace.layout.get")(function* (workspaceID, tuple, clientID, options) {
          const layout = yield* resolveLayout(workspaceID, tuple)
          // Server-internal reads (block lifecycle services verifying layouts)
          // must not steal layout authority from the interactive clients.
          if (options?.claimAuthority !== false) yield* claimAuthority(workspaceID, tuple, clientID)
          return layout
        }),
        save: Effect.fn("Workspace.layout.save")(function* (workspaceID, tuple, blocks, expectedRevision, clientID) {
          const layout = yield* resolveLayout(workspaceID, tuple)
          yield* requireAuthority(workspaceID, tuple, clientID, layout.revision)
          if (layout.revision !== expectedRevision) {
            return yield* new LayoutConflictError({ currentRevision: layout.revision })
          }
          const revision = layout.revision + 1
          yield* db
            .update(LayoutTable)
            .set({ revision, blocks: [...blocks], time_updated: Date.now() })
            .where(eq(LayoutTable.id, layout.id))
            .run()
            .pipe(Effect.orDie)
          const info = Workspace.Layout.Info.make({
            id: layout.id,
            workspaceID: layout.workspaceID,
            revision,
            blocks: [...blocks],
          })
          // Realtime fan-out: connected clients re-pull when another client
          // (or surface) saves this layout. Transient event, not durable.
          yield* events.publish(WorkspaceEvent.LayoutUpdated, { workspaceID, revision }).pipe(Effect.orDie)
          return info
        }),
      },
      functionality: {
        list: Effect.fn("Workspace.functionality.list")(function* (_workspaceID) {
          // Plugin-contributed functionality joins the registry in a later track.
          return builtins
        }),
      },
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, EventV2.node] })

export { createDefaultLayout }

```

### `packages/core/src/workspace/chat-relay-session.ts:1-40`

```ts
export * as ChatRelaySession from "./chat-relay-session"
export * as ChatRelaySessionService from "./chat-relay-session"

import { and, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { ChatRelay } from "@opencode-ai/schema/chat-relay"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Database } from "../database/database"
import { makeGlobalNode, tags } from "../effect/app-node"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { SessionV2 } from "../session"
import { SessionSchema } from "../session/schema"
import { SessionInputTable } from "../session/sql"
import { FunctionalityInstance } from "./functionality-instance"
import { WorkspaceService } from "./service"

export class WorkspaceNotFoundError extends Schema.TaggedErrorClass<WorkspaceNotFoundError>()(
  "ChatRelay.WorkspaceNotFoundError",
  { workspaceID: Workspace.ID },
) {}

export class BlockNotFoundError extends Schema.TaggedErrorClass<BlockNotFoundError>()(
  "ChatRelay.BlockNotFoundError",
  { workspaceID: Workspace.ID, blockID: Schema.String },
) {}

export class WrongFunctionalityError extends Schema.TaggedErrorClass<WrongFunctionalityError>()(
  "ChatRelay.WrongFunctionalityError",
  { blockID: Schema.String },
) {}

export class InstanceNotFoundError extends Schema.TaggedErrorClass<InstanceNotFoundError>()(
  "ChatRelay.InstanceNotFoundError",
  { workspaceID: Workspace.ID, blockID: Schema.String },
) {}

export class StaleBindingError extends Schema.TaggedErrorClass<StaleBindingError>()("ChatRelay.StaleBindingError", {
  currentRevision: Schema.Number,
```
