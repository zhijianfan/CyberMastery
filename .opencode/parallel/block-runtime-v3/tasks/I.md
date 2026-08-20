You are worker 2 of 5 (Wave 2) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task I — MasterAgent runtime migration onto the generic host

### Required work

1. **Fix the double surface mount** (Wave-1 finding): `block.tsx` currently
   mounts the `CanvasSessionSurface` such that the surface base disposes TWICE
   across a block lifetime (baseDisposals===2 in the e2e). Root-cause it in
   block.tsx/block-shell.tsx (the surface must mount EXACTLY once per binding
   generation and dispose exactly once on unmount).
2. **Registration**: create
   `packages/app/src/pages/canvas/master-agent/runtime-registration.ts`
   exporting `masterAgentRuntimeRegistration:
   BlockRuntimeRegistration<MasterAgentBlockDescriptor, MasterAgentView, MasterAgentCommand>`:
   - `mode: "native"`,
   - `getBindings(descriptor)` → [{ type: "session", id: descriptor.bindings.sessionID }]
     (+ permission bindings for the session as today's lifecycle does),
   - `resolve(...)` → snapshot the session via `services.serverSDK`
     (v2.session.get + v2.event subscribe for that session) with the same
     revision/cursor discipline the current lifecycle-controller uses (inline
     below); returns `{ snapshot, dispose }`,
   - `select(...)` → `MasterAgentView` = the binding state (status, sessionID,
     coder, queue) the shell consumes,
   - `dispatch(...)` → reset → v2.workspace.masterAgent.reset; coder set/clear
     → v2.workspace.update; ensure/retry → v2.workspace.masterAgent.ensure.
3. **Shell**: `block.tsx` renders `MasterAgentBlock` through the registration
   when the workspace provides it (via `BlockRuntimeHost` services), keeping
   the existing manager-backed path as the fallback until M wires the
   registration in workspace.tsx (M owns that wiring — you only EXPORT the
   registration + keep both paths type-clean).
4. **HANDOFF-I.md**: exports, tests + results, integration actions.

### Tests

- `master-agent/runtime-registration.test.ts`: bindings mapping, dispatch
  routes (reset/ensure/coder), select projection, abort/dispose idempotent.
- Update `master-agent/block.test.tsx` if needed for the double-mount fix —
  assert exactly one surface base per binding generation and one dispose on
  unmount (use the existing fake manager + recorded bases pattern).

### Owned files (edit ONLY these)

- packages/app/src/pages/canvas/master-agent/block.tsx
- packages/app/src/pages/canvas/master-agent/block-shell.tsx
- packages/app/src/pages/canvas/master-agent/runtime-registration.ts (NEW)
- packages/app/src/pages/canvas/master-agent/runtime-registration.test.ts (NEW)
- packages/app/src/pages/canvas/master-agent/block.test.tsx
- packages/app/src/pages/canvas/master-agent/HANDOFF-I.md

### Targeted validation (allowed)

- cd packages/app && bun test --conditions=browser --preload ./happydom.ts src/pages/canvas/master-agent/runtime-registration.test.ts src/pages/canvas/master-agent/block.test.tsx
- bun run typecheck from packages/app

### HARD PROHIBITIONS

Do NOT edit workspace.tsx, manager.ts, blocks/chat-relay/**, e2e/integration
test files (they are skipped pending your fix — re-enabling them is M's job),
packages/server/protocol/core, generated SDK files. Do NOT run generate.



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


### `packages/app/src/pages/canvas/master-agent/block.tsx (189 lines)`

```tsx
/** @jsxImportSource solid-js */
// Track B3 — MasterAgent block composition. Composes the manager API
// (spec 02 §12), the B1 shell, B2 Coder selector, Q1 queue options, and the
// U3 canvas session surface into the single \`builtin:master-agent\` block
// renderer consumed by I2.
//
// Authority: the host functionality instance owns the authoritative Session
// binding; this component only reads it through \`manager.masterAgent\` and
// renders it. No session is created, deleted, or cancelled here, and no
// prompt is submitted from this file — the embedded surface reuses the
// existing Session composer, whose queue action admits queued inputs to the
// host through the existing admission path. Nothing session-identifying
// reaches layout serialization or local persistence.

import { createEffect, onCleanup, onMount } from "solid-js"
import type { BindingState, ModelSelection } from "./types"
import type { MasterAgentManagerApi as CanvasManagerApi } from "../manager"
import type { CoderController } from "./coder-controller"
import { MasterAgentBlockShell } from "./block-shell"
import { CoderSelector, type CoderTaskPermission } from "./coder-selector"
import { createMasterAgentSessionOptions } from "./session-options"
import { CanvasSessionSurface } from "../session-surface"
import { CanvasSessionSurfaceProviders } from "../session-surface-providers"

// The block consumes a narrow view of the manager's published \`masterAgent\`
// API (M6, spec 02 §12): per-block binding state/actions plus the Coder
// view-model. These aliases derive from the real types, so the contract is
// enforced at the type level — if the manager API drifts, this file stops
// compiling. The block never imports the manager module at runtime; the
// canvas host passes the surface in through props.

export type MasterAgentCoderViewModel = Pick<
  CoderController<ModelSelection>,
  "model" | "pending" | "error" | "set" | "clear" | "retry"
>

export type MasterAgentManagerApi = Pick<
  CanvasManagerApi,
  "state" | "ensure" | "retry" | "reset" | "removeLocalProjection"
> & { coder: MasterAgentCoderViewModel }

export interface MasterAgentBlockProps {
  /** Canvas block identity; also derives the per-surface scope id. */
  blockID: string
  focused: boolean
  manager: MasterAgentManagerApi
  onFocus(): void
  onRequestOpenFullPage?(): void
  /** Workspace-wide Coder chrome inputs (I2 wires these from the canvas). */
  primaryModel?: ModelSelection | null
  taskPermission?: CoderTaskPermission
  models?: readonly ModelSelection[]
  toolCompatible?: boolean
  onOpenCoderPicker?(): void
  /** Host session working state; gates the Q1 queue action and reset. */
  sessionBusy?: () => boolean
}

const RESET_DISABLED_REASON: Record<Exclude<BindingState["status"], "ready">, string> = {
  uninitialized: "Session not initialized",
  loading: "Session is connecting",
  "permission-denied": "Permission denied",
  unavailable: "Session unavailable",
  error: "Something went wrong",
}

export function MasterAgentBlock(props: MasterAgentBlockProps) {
  const state = props.manager.state(props.blockID)
  // Stable per-block surface identity so two blocks never share DOM ids,
  // portals, terminal mounts, or composer/tab state.
  const busy = props.sessionBusy ?? (() => false)

  if (typeof globalThis === "object" && (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__) {
    createEffect(() => {
      console.error(\`block-effect status ${props.blockID}: ${state().status}\`)
    })
    console.error(\`block-render status ${props.blockID}: ${state().status}\`)
  }

  createEffect(() => {
    void props.manager.ensure(props.blockID)
  })

  onCleanup(() => {
    if (typeof globalThis === "object" && (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__) {
      console.error(\`MasterAgentBlock cleanup: ${props.blockID}\`)
    }
    // Removal/unmount must not delete or cancel the host session: only the
    // local projection is dropped; the host keeps the Session and its queue.
    props.manager.removeLocalProjection(props.blockID)
  })

  onMount(() => {
    if (typeof globalThis === "object" && (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__) {
      console.error(\`MasterAgentBlock mounted: ${props.blockID}\`)
    }
    if (props.blockID === "canvas-legacy") {
      console.error("MasterAgentBlock mounted for legacy block")
    }
  })

  const binding = () => {
    const current = state()
    if (current.status !== "ready") return undefined
    return current.binding
  }

  const sessionOptions = () => {
    const current = binding()
    if (!current) return undefined
    return createMasterAgentSessionOptions({
      sessionID: current.sessionID,
      directory: current.directory,
      workspaceID: current.workspaceID,
    })
  }

  // Q1: the embedded composer owns prompt admission. The options only enable
  // its existing queue action while the host session is busy; no prompt is
  // submitted from the block and no client-side queue exists.
  const queueEnabled = () => {
    const options = sessionOptions()
    if (!options) return false
    return options.queueEnabled && options.queue(busy())
  }

  const renderSessionSlot = () => {
    const options = sessionOptions()
    if (!options) return undefined
    return (
      <CanvasSessionSurfaceProviders directory={options.target.directory}>
        <CanvasSessionSurface
          target={options.target}
          surfaceID={\`master-agent-${props.blockID}\`}
          focused={props.focused}
          queueEnabled={queueEnabled()}
          onFocus={props.onFocus}
          onRequestOpenFullPage={props.onRequestOpenFullPage}
        />
      </CanvasSessionSurfaceProviders>
    )
  }

  const currentStatus = () => state().status

  const canReset = () => {
    if (currentStatus() !== "ready") return false
    return !busy()
  }

  const resetDisabledReason = () => {
    const current = currentStatus()
    if (current === "ready") {
      if (!busy()) return undefined
      return "Session is busy — reset when idle"
    }
    return RESET_DISABLED_REASON[current]
  }

  return (
    <MasterAgentBlockShell
      status={currentStatus}
      focused={props.focused}
      canReset={canReset}
      resetDisabledReason={resetDisabledReason}
      onFocus={props.onFocus}
      onRetry={() => void props.manager.retry(props.blockID)}
      onReset={() => void props.manager.reset(props.blockID)}
      onOpenFullPage={props.onRequestOpenFullPage}
      sessionSlot={renderSessionSlot}
      coderSlot={
        <CoderSelector
          model={props.manager.coder.model()}
          primaryModel={props.primaryModel ?? null}
          pending={props.manager.coder.pending()}
          error={props.manager.coder.error()}
          permission={props.taskPermission ?? "allow"}
          toolCompatible={props.toolCompatible ?? true}
          models={props.models}
          onSet={(model) => void props.manager.coder.set(model)}
          onClear={() => void props.manager.coder.clear()}
          onRetry={() => void props.manager.coder.retry()}
          onOpenPicker={props.onOpenCoderPicker ?? (() => {})}
        />
      }
    />
  )
}

```

### `packages/app/src/pages/canvas/master-agent/block-shell.tsx (124 lines)`

```tsx
import "./master-agent.css"
import type { JSX } from "solid-js"
import { createEffect } from "solid-js"
import { MasterAgentStatusView } from "./status-view"

export type MasterAgentBindingStatus =
  | "uninitialized"
  | "loading"
  | "ready"
  | "permission-denied"
  | "unavailable"
  | "error"

type Accessorish<T> = T | (() => T)

function resolveAccessor<T>(value: Accessorish<T>): T {
  if (typeof value === "function") return (value as () => T)()
  return value
}

export interface MasterAgentBlockShellProps {
  status: Accessorish<MasterAgentBindingStatus>
  focused: boolean
  canReset: Accessorish<boolean>
  resetDisabledReason?: Accessorish<string | undefined>
  onFocus(): void
  onRetry(): void
  onReset(): void
  onOpenFullPage?(): void
  sessionSlot?: Accessorish<JSX.Element | undefined>
  coderSlot?: Accessorish<JSX.Element | undefined>
}

function isTracingEnabled(): boolean {
  return typeof globalThis === "object" && Boolean((globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__)
}

export function MasterAgentBlockShell(props: MasterAgentBlockShellProps) {
  const status = () => resolveAccessor(props.status)
  const canReset = () => resolveAccessor(props.canReset)
  const resetDisabledReason = () => {
    if (props.resetDisabledReason === undefined) return undefined
    return resolveAccessor(props.resetDisabledReason)
  }
  const sessionSlot = () => {
    if (props.sessionSlot === undefined) return undefined
    return resolveAccessor(props.sessionSlot)
  }
  const coderSlot = () => {
    if (props.coderSlot === undefined) return undefined
    return resolveAccessor(props.coderSlot)
  }

  createEffect(() => {
    if (isTracingEnabled()) {
      console.error(\`shell-render status ${status()}\`)
      console.error(\`shell-slot-check status ${status()}\`)
      console.error(\`shell-slot-check session ${Boolean(sessionSlot())} coder ${Boolean(coderSlot())}\`)
      console.error(\`shell-effect status=${status()}\`)
      console.error(\`shell-effect canReset=${canReset()} resetReason=${resetDisabledReason()}\`)
    }
  })

  if (status() !== "ready") {
    return (
      <div
        class="master-agent-shell"
        classList={{ focused: props.focused }}
        data-status={status()}
        onClick={() => props.onFocus()}
      >
        <MasterAgentStatusView status={status() as Exclude<MasterAgentBindingStatus, "ready">} onRetry={props.onRetry} />
      </div>
    )
  }

  return (
    <div
      class="master-agent-shell"
      classList={{ focused: props.focused }}
      data-status={status()}
      onClick={() => props.onFocus()}
    >
      <div class="master-agent-body">
        {sessionSlot() ? (
          <div class="master-agent-session-slot" data-slot="session">
            {sessionSlot()}
          </div>
        ) : null}
      </div>
      <div class="master-agent-footer">
        {coderSlot() ? (
          <div class="master-agent-coder-slot" data-slot="coder">
            {coderSlot()}
          </div>
        ) : null}
        <div class="master-agent-actions">
          {!canReset() && resetDisabledReason() ? <span class="master-agent-reset-reason">{resetDisabledReason()}</span> : null}
          {props.onOpenFullPage ? (
            <button
              type="button"
              class="master-agent-button"
              aria-label="Open in full page"
              onClick={() => props.onOpenFullPage?.()}
            >
              Full page
            </button>
          ) : null}
          <button
            type="button"
            class="master-agent-button primary"
            aria-disabled={!canReset()}
            disabled={!canReset()}
            title={canReset() ? undefined : resetDisabledReason()}
            onClick={() => props.onReset()}
          >
            Reset session
          </button>
        </div>
      </div>
    </div>
  )
}

```

### `packages/app/src/pages/canvas/master-agent/types.ts (99 lines)`

```ts
export interface ModelSelection {
  providerID: string
  modelID: string
  variant?: string
}

export interface WorkspaceInfo {
  model: ModelSelection | null
  operatingAgent: string | null
  coderModel: ModelSelection | null
}

export interface WorkspacePatch {
  coderModel?: ModelSelection | null
}

export namespace MasterAgent {
  export const FunctionalityID = "builtin:master-agent" as const

  export type DirectoryBinding =
    | { mode: "workspace-primary" }
    | { mode: "fixed"; directory: string }

  export interface SessionBinding {
    mode: "owned"
    sessionID: string
    generation: number
  }

  export interface InstanceConfiguration {
    version: 1
    directoryBinding: DirectoryBinding
    sessionBinding: SessionBinding | null
  }

  export interface Binding {
    workspaceID: string
    blockID: string
    functionalityInstanceID: string
    sessionID: string
    directory: string
    generation: number
    revision: number
  }

  export interface GetRequest {
    workspaceID: string
    blockID: string
  }

  export interface EnsureRequest {
    workspaceID: string
    blockID: string
  }

  export interface ResetRequest {
    workspaceID: string
    blockID: string
    expectedSessionID: string
    expectedRevision: number
  }

  export interface BindingUpdatedEvent {
    type: "workspace.master-agent.binding.updated"
    workspaceID: string
    blockID: string
    sessionID: string
    generation: number
    revision: number
  }
}

export type MasterAgentError =
  | { type: "workspace-not-found" }
  | { type: "block-not-found" }
  | { type: "wrong-functionality"; actual?: string }
  | { type: "instance-not-found" }
  | { type: "session-not-found" }
  | { type: "access-denied" }
  | { type: "stale-binding"; current?: MasterAgent.Binding }
  | { type: "reset-busy" }
  | { type: "reset-has-pending-input" }
  | { type: "concurrent-conflict" }

export interface MasterAgentPort {
  get(workspaceID: string, blockID: string, signal?: AbortSignal): Promise<MasterAgent.Binding | null>
  ensure(workspaceID: string, blockID: string, signal?: AbortSignal): Promise<MasterAgent.Binding>
  reset(input: MasterAgent.ResetRequest, signal?: AbortSignal): Promise<MasterAgent.Binding>
  patchCoderModel(workspaceID: string, coderModel: ModelSelection | null, signal?: AbortSignal): Promise<WorkspaceInfo>
}

export type BindingState =
  | { status: "uninitialized" }
  | { status: "loading" }
  | { status: "ready"; binding: MasterAgent.Binding }
  | { status: "permission-denied" }
  | { status: "unavailable"; reason: string }
  | { status: "error"; error: unknown; recoverable: boolean }

```

### `packages/app/src/pages/canvas/master-agent/lifecycle-controller.ts (181 lines)`

```ts
// MasterAgent lifecycle controller: orchestrates the binding lifecycle for one
// block against the M1 reducer and port. The host owns the authoritative
// binding; the controller owns only the per-block client projection. Requests
// are deduplicated while in flight, and stale responses are dropped after a
// workspace switch, block removal, or disposal.

import { createSignal, type Accessor } from "solid-js"
import { classifyMasterAgentError, initialBindingState, reduceMasterAgentBinding, type MasterAgentEvent } from "./reducer"
import type { BindingState, MasterAgent, MasterAgentPort } from "./types"

export interface LifecycleControllerInput {
  workspaceID: () => string | undefined
  blockID: string
  port: MasterAgentPort
  /** Client projection of whether the bound session is idle with no pending input. Reset is skipped while false; the host enforces it again. */
  idle?: () => boolean
}

export interface MasterAgentLifecycleController {
  state: Accessor<BindingState>
  dispatch: (event: MasterAgentEvent) => void
  ensure: () => Promise<void>
  retry: () => Promise<void>
  reset: () => Promise<void>
  refetch: () => Promise<void>
  removeLocalProjection: () => void
  dispose: () => void
}

type Operation = "ensure" | "reset" | "refetch"

interface Inflight {
  operation: Operation
  promise: Promise<void>
}

export function createMasterAgentLifecycleController(
  input: LifecycleControllerInput,
): MasterAgentLifecycleController {
  const [state, setState] = createSignal<BindingState>(initialBindingState())
  const isIdle = input.idle ?? (() => true)

  let disposed = false
  let inflight: Inflight | undefined
  let inflightAbort: AbortController | undefined

  function debug(message: string, payload?: unknown) {
    if (typeof globalThis !== "object" || !(globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__)
      return
    if (payload === undefined) console.error(\`master-agent-controller ${input.blockID} ${message}\`)
    else console.error(\`master-agent-controller ${input.blockID} ${message}\`, payload)
  }

  function dispatch(event: MasterAgentEvent) {
    if (disposed) return
    debug("dispatch", event)
    setState((current) => reduceMasterAgentBinding(current, event))
  }

  function stale(abort: AbortController, workspaceID: string): boolean {
    return disposed || abort.signal.aborted || input.workspaceID() !== workspaceID
  }

  function runRequest(
    operation: Operation,
    workspaceID: string,
    call: (signal: AbortSignal) => Promise<MasterAgent.Binding | null>,
  ): Promise<void> {
    inflightAbort?.abort()
    const abort = new AbortController()
    inflightAbort = abort
    const entry: Inflight = { operation, promise: Promise.resolve() }
    inflight = entry
    entry.promise = execute(operation, workspaceID, abort, call)
    return entry.promise
  }

  async function execute(
    operation: Operation,
    workspaceID: string,
    abort: AbortController,
    call: (signal: AbortSignal) => Promise<MasterAgent.Binding | null>,
  ) {
    try {
      debug("result:request", { operation, workspaceID })
      const binding = await call(abort.signal)
      if (stale(abort, workspaceID)) return
      if (binding === null) dispatch({ type: "binding-missing" })
      else dispatch({ type: "binding", binding })
    } catch (error) {
      if (stale(abort, workspaceID)) return
      if (isAbortError(error)) return
      dispatch(classifyMasterAgentError(error))
      if (operation !== "refetch" && isUnknownConflict(error)) void refetch()
    } finally {
      if (inflightAbort === abort) {
        inflightAbort = undefined
        inflight = undefined
      }
    }
  }

  function ensure(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (state().status === "ready") return Promise.resolve()
    if (inflight?.operation === "ensure") return inflight.promise
    const workspaceID = input.workspaceID()
    if (!workspaceID) return Promise.resolve()
    dispatch({ type: "loading" })
    return runRequest("ensure", workspaceID, (signal) => input.port.ensure(workspaceID, input.blockID, signal))
  }

  function retry(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (state().status === "ready") return Promise.resolve()
    return ensure()
  }

  function reset(): Promise<void> {
    if (disposed) return Promise.resolve()
    const current = state()
    if (current.status !== "ready") return Promise.resolve()
    if (!isIdle()) return Promise.resolve()
    if (input.workspaceID() !== current.binding.workspaceID) return Promise.resolve()
    if (inflight?.operation === "reset") return inflight.promise
    const request: MasterAgent.ResetRequest = {
      workspaceID: current.binding.workspaceID,
      blockID: current.binding.blockID,
      expectedSessionID: current.binding.sessionID,
      expectedRevision: current.binding.revision,
    }
    return runRequest("reset", request.workspaceID, (signal) => input.port.reset(request, signal))
  }

  function refetch(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (inflight?.operation === "refetch") return inflight.promise
    const workspaceID = input.workspaceID()
    if (!workspaceID) return Promise.resolve()
    return runRequest("refetch", workspaceID, (signal) => input.port.get(workspaceID, input.blockID, signal))
  }

  function removeLocalProjection() {
    if (disposed) return
    inflightAbort?.abort()
    inflight = undefined
    inflightAbort = undefined
    dispatch({ type: "removed" })
  }

  function dispose() {
    if (disposed) return
    disposed = true
    inflightAbort?.abort()
    inflight = undefined
    inflightAbort = undefined
    setState(initialBindingState())
  }

  return {
    state,
    dispatch,
    ensure,
    retry,
    reset,
    refetch,
    removeLocalProjection,
    dispose,
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
}

function isUnknownConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("type" in error)) return false
  if (error.type === "concurrent-conflict") return true
  return error.type === "stale-binding" && !("current" in error)
}

```

### `packages/app/src/pages/canvas/master-agent/port.ts (26 lines)`

```ts
import type { MasterAgent, MasterAgentPort, WorkspaceInfo, WorkspacePatch } from "./types"

export interface MasterAgentTransport {
  get(request: MasterAgent.GetRequest, signal?: AbortSignal): Promise<MasterAgent.Binding | null>
  ensure(request: MasterAgent.EnsureRequest, signal?: AbortSignal): Promise<MasterAgent.Binding>
  reset(request: MasterAgent.ResetRequest, signal?: AbortSignal): Promise<MasterAgent.Binding>
  patchWorkspace(workspaceID: string, patch: WorkspacePatch, signal?: AbortSignal): Promise<WorkspaceInfo>
}

export function createMasterAgentPort(transport: MasterAgentTransport): MasterAgentPort {
  return {
    get(workspaceID, blockID, signal) {
      return transport.get({ workspaceID, blockID }, signal)
    },
    ensure(workspaceID, blockID, signal) {
      return transport.ensure({ workspaceID, blockID }, signal)
    },
    reset(input, signal) {
      return transport.reset(input, signal)
    },
    patchCoderModel(workspaceID, coderModel, signal) {
      return transport.patchWorkspace(workspaceID, { coderModel }, signal)
    },
  }
}

```

### `packages/app/src/pages/canvas/master-agent/sdk-port.ts (159 lines)`

```ts
import type { OpencodeClient, WorkspaceUpdatePayload } from "@opencode-ai/sdk/v2/client"
import type { MasterAgentError, ModelSelection, WorkspaceInfo, WorkspacePatch } from "./types"
import type { MasterAgentTransport } from "./port"

/**
 * Adapter from the G1-generated SDK client (\`@opencode-ai/sdk/v2/client\`,
 * the surface the app consumes via \`createOpencodeClient\`) to the M1
 * \`MasterAgentTransport\` port. Generated values are converted to the
 * client-domain models in \`./types\` at this boundary; nothing generated
 * escapes this file. Server failures are normalized to the
 * \`MasterAgentError\` union; aborts and unrecognized errors pass through.
 */
export function createMasterAgentSdkPort(client: OpencodeClient): MasterAgentTransport {
  const masterAgent = client.v2.workspace.masterAgent
  const workspace = client.v2.workspace
  return {
    async get(request, signal) {
      try {
        const result = await masterAgent.get(
          { workspaceID: request.workspaceID, blockID: request.blockID },
          { signal, throwOnError: true },
        )
        return result.data.status === "unbound" ? null : result.data.binding
      } catch (error) {
        throw normalizeTransportError(error, signal)
      }
    },
    async ensure(request, signal) {
      try {
        const result = await masterAgent.ensure(
          { workspaceID: request.workspaceID, blockID: request.blockID },
          { signal, throwOnError: true },
        )
        return result.data
      } catch (error) {
        throw normalizeTransportError(error, signal)
      }
    },
    async reset(request, signal) {
      try {
        const result = await masterAgent.reset(
          {
            workspaceID: request.workspaceID,
            blockID: request.blockID,
            masterAgentResetPayload: {
              expectedSessionID: request.expectedSessionID,
              expectedRevision: request.expectedRevision,
            },
          },
          { signal, throwOnError: true },
        )
        if (result.data.status === "reset") return result.data.binding
        if (result.data.status === "stale") throw { type: "stale-binding" } as const
        throw resetBusyError(result.data.reason)
      } catch (error) {
        throw normalizeTransportError(error, signal)
      }
    },
    async patchWorkspace(workspaceID, patch, signal) {
      try {
        const result = await workspace.update(
          { workspaceUpdatePayload: encodeCoderModelPatch(workspaceID, patch) },
          { signal, throwOnError: true },
        )
        return decodeWorkspaceInfo(result.data)
      } catch (error) {
        throw normalizeTransportError(error, signal)
      }
    },
  }
}

/**
 * The wire schema (\`WorkspaceCoder.Patch\`) accepts explicit \`null\` to clear,
 * but G1's generated \`WorkspaceUpdatePayload\` dropped the null branch, so the
 * clear case needs a type-only escape at this single boundary.
 */
function encodeCoderModelPatch(workspaceID: string, patch: WorkspacePatch): WorkspaceUpdatePayload {
  const coderModel = patch.coderModel
  if (coderModel === undefined) return { id: workspaceID, patch: {} }
  if (coderModel === null) return { id: workspaceID, patch: { coderModel: null } as unknown as WorkspaceUpdatePayload["patch"] }
  return { id: workspaceID, patch: { coderModel: formatModelSelection(coderModel) } }
}

type WorkspaceInfoWire = {
  model?: string
  operatingAgent?: string
  coderModel?: string | null
}

function decodeWorkspaceInfo(info: WorkspaceInfoWire): WorkspaceInfo {
  return {
    model: parseModelSelection(info.model),
    operatingAgent: info.operatingAgent ?? null,
    coderModel: parseModelSelection(info.coderModel),
  }
}

function formatModelSelection(selection: ModelSelection): string {
  if (!selection.variant) return \`${selection.providerID}:${selection.modelID}\`
  return \`${selection.providerID}:${selection.modelID}:${selection.variant}\`
}

function parseModelSelection(value: string | null | undefined): ModelSelection | null {
  if (!value) return null
  const [providerID, modelID, variant] = value.split(":")
  if (!providerID || !modelID) return null
  if (!variant) return { providerID, modelID }
  return { providerID, modelID, variant }
}

function resetBusyError(reason: string): MasterAgentError {
  // The server reports a busy reset with a free-text reason; a pending-input
  // policy failure carries a "pending" marker.
  return reason.toLowerCase().includes("pending") ? { type: "reset-has-pending-input" } : { type: "reset-busy" }
}

function normalizeTransportError(error: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted) return signal.reason instanceof Error ? signal.reason : createAbortError()
  if (isAbortError(error)) return error
  const { body, status } = errorBody(error)
  if (status === 401) return { type: "access-denied" }
  const tag = body?._tag
  if (tag === "MasterAgentWorkspaceNotFoundError") return { type: "workspace-not-found" }
  if (tag === "MasterAgentBlockNotFoundError") return { type: "block-not-found" }
  if (tag === "MasterAgentInstanceNotFoundError") return { type: "instance-not-found" }
  if (tag === "MasterAgentWrongFunctionalityError") {
    const actual = body?.actual
    return typeof actual === "string" ? { type: "wrong-functionality", actual } : { type: "wrong-functionality" }
  }
  if (tag === "MasterAgentAccessDeniedError") return { type: "access-denied" }
  if (tag === "MasterAgentConflictError") return { type: "concurrent-conflict" }
  if (tag === "MasterAgentStaleBindingError") return { type: "stale-binding" }
  if (tag === "MasterAgentBusyError") return { type: "reset-busy" }
  return error
}

function isAbortError(error: unknown): boolean {
  return error !== null && typeof error === "object" && "name" in error && error.name === "AbortError"
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted")
  error.name = "AbortError"
  return error
}

type ErrorBody = { _tag?: unknown; actual?: unknown }

function errorBody(error: unknown): { body?: ErrorBody; status?: number } {
  if (!(error instanceof Error)) return {}
  const cause = error.cause
  if (cause === null || typeof cause !== "object" || !("body" in cause)) return {}
  const body = cause.body
  if (body === null || typeof body !== "object" || !("_tag" in body)) return {}
  const status = "status" in cause && typeof cause.status === "number" ? cause.status : undefined
  return { body: body as ErrorBody, status }
}

```

### `packages/app/src/pages/canvas/master-agent/event-reconciliation.ts (127 lines)`

```ts
// Binding-update event reconciliation for the master-agent block: consumes
// workspace.master-agent.binding.updated events, filters them to the active
// workspace and known blocks, drops revisions that are not newer than the
// current binding, and triggers authoritative refetches when the subscription
// reconnects. Events are transient; the server-persisted binding remains the
// source of truth, so no session is ever created client-side from an event.

import type { MasterAgent } from "./types"

const BINDING_UPDATED_TYPE = "workspace.master-agent.binding.updated"

export interface BindingEventEntry {
  name: string
  details: {
    type: string
    properties?: unknown
  }
}

export interface MasterAgentEventReconciliationInput {
  workspaceID: () => string | undefined
  isKnownBlock: (blockID: string) => boolean
  knownBlocks: () => string[]
  currentRevision: (blockID: string) => number | undefined
  onBindingUpdated: (event: MasterAgent.BindingUpdatedEvent) => void
  refetch: (blockID: string) => void
  listen: (listener: (entry: BindingEventEntry) => void) => () => void
  onReconnect: (listener: () => void) => () => void
}

export interface MasterAgentEventReconciliation {
  dispose: () => void
  takeBuffered: (blockID: string) => MasterAgent.BindingUpdatedEvent | undefined
}

export function createMasterAgentEventReconciliation(
  input: MasterAgentEventReconciliationInput,
): MasterAgentEventReconciliation {
  // A binding-updated event can arrive before its block is mounted or before
  // the block's initial get has finished. The newest event per block is
  // buffered and handed back once the block has an authoritative revision to
  // compare against; the mount flow's get/ensure remains authoritative.
  const buffered = new Map<string, MasterAgent.BindingUpdatedEvent>()

  function bufferEvent(event: MasterAgent.BindingUpdatedEvent) {
    const existing = buffered.get(event.blockID)
    if (existing && existing.revision >= event.revision) return
    buffered.set(event.blockID, event)
  }

  function drainBuffered() {
    for (const [blockID, event] of buffered) {
      if (!input.isKnownBlock(blockID)) continue
      const current = input.currentRevision(blockID)
      if (current === undefined) continue
      buffered.delete(blockID)
      if (event.revision <= current) continue
      input.onBindingUpdated(event)
    }
  }

  function handleEvent(entry: BindingEventEntry) {
    const event = parseBindingUpdated(entry)
    if (!event) return
    if (event.workspaceID !== input.workspaceID()) return
    const current = input.isKnownBlock(event.blockID) ? input.currentRevision(event.blockID) : undefined
    if (current === undefined) {
      bufferEvent(event)
      drainBuffered()
      return
    }
    if (event.revision > current) input.onBindingUpdated(event)
    drainBuffered()
  }

  function handleReconnect() {
    for (const blockID of input.knownBlocks()) input.refetch(blockID)
  }

  const stopListening = input.listen(handleEvent)
  const stopReconnect = input.onReconnect(handleReconnect)
  let disposed = false

  function takeBuffered(blockID: string) {
    const event = buffered.get(blockID)
    if (!event) return undefined
    const current = input.currentRevision(blockID)
    if (current === undefined) return undefined
    buffered.delete(blockID)
    if (event.revision <= current) return undefined
    return event
  }

  function dispose() {
    if (disposed) return
    disposed = true
    stopListening()
    stopReconnect()
    buffered.clear()
  }

  return { dispose, takeBuffered }
}

function parseBindingUpdated(entry: BindingEventEntry): MasterAgent.BindingUpdatedEvent | undefined {
  if (entry.details.type !== BINDING_UPDATED_TYPE) return undefined
  const properties = entry.details.properties
  if (!isRecord(properties)) return undefined
  if (typeof properties.workspaceID !== "string") return undefined
  if (typeof properties.blockID !== "string") return undefined
  if (typeof properties.sessionID !== "string") return undefined
  if (typeof properties.generation !== "number") return undefined
  if (typeof properties.revision !== "number") return undefined
  return {
    type: BINDING_UPDATED_TYPE,
    workspaceID: properties.workspaceID,
    blockID: properties.blockID,
    sessionID: properties.sessionID,
    generation: properties.generation,
    revision: properties.revision,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

```

### `packages/app/src/pages/canvas/master-agent/functionality.ts (69 lines)`

```ts
import type { JSX } from "solid-js"
import type { MasterAgent } from "@opencode-ai/schema/master-agent"

export const MASTER_AGENT_BLOCK_TYPE = "master-agent" as const
export type MasterAgentBlockType = typeof MASTER_AGENT_BLOCK_TYPE

export const MASTER_AGENT_FUNCTIONALITY_ID: MasterAgent.FunctionalityID = "builtin:master-agent"

export const MASTER_AGENT_FUNCTIONALITY_BY_TYPE: Record<MasterAgentBlockType, MasterAgent.FunctionalityID> = {
  [MASTER_AGENT_BLOCK_TYPE]: MASTER_AGENT_FUNCTIONALITY_ID,
}

export type MasterAgentDirectoryBinding = MasterAgent.DirectoryBinding

export type MasterAgentInstanceConfiguration = MasterAgent.InstanceConfiguration

export interface MasterAgentClientConfiguration {
  version: 1
  directoryBinding: MasterAgentDirectoryBinding
  sessionBinding: null
}

export function initialConfiguration(directoryBinding: MasterAgentDirectoryBinding): MasterAgentClientConfiguration {
  return { version: 1, directoryBinding, sessionBinding: null }
}

const SVG_NS = "http://www.w3.org/2000/svg"

function svgElement(tag: string, attributes: Record<string, string>): SVGElement {
  const element = document.createElementNS(SVG_NS, tag)
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value))
  return element
}

function iconMasterAgent(): JSX.Element {
  const svg = svgElement("svg", { viewBox: "0 0 24 24" })
  svg.append(
    svgElement("circle", { cx: "12", cy: "12", r: "3.5" }),
    svgElement("path", {
      d: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4",
    }),
  )
  return svg
}

export interface MasterAgentBlockModule {
  type: MasterAgentBlockType
  functionality: MasterAgent.FunctionalityID
  title: string
  subtitle: string
  accent: string
  w: number
  h: number
  icon: () => JSX.Element
}

export const MASTER_AGENT_MODULE: MasterAgentBlockModule = {
  type: MASTER_AGENT_BLOCK_TYPE,
  functionality: MASTER_AGENT_FUNCTIONALITY_ID,
  title: "Master Agent",
  subtitle: "Hosted session · coder mode",
  accent: "var(--canvas-purple)",
  w: 440,
  h: 500,
  icon: iconMasterAgent,
}

export const MASTER_AGENT_DEFAULT_SIZE = { w: MASTER_AGENT_MODULE.w, h: MASTER_AGENT_MODULE.h } as const

```

### `packages/app/src/pages/canvas/runtime/adapters/session-binding.ts (364 lines)`

```ts
import type {
  BlockRuntimeRegistration,
  BlockRuntimeServices,
  RuntimeEventKey,
} from "../contracts"
import type { ServerEvent } from "@/context/server-sdk"

export type HostSessionBindingState<B> =
  | { status: "unbound" }
  | { status: "bound"; binding: B }

interface HostSessionBindingRegistrationOptions<B, ResetCommand> {
  functionalityID: string
  get: (services: BlockRuntimeServices, signal: AbortSignal) => Promise<HostSessionBindingState<B>>
  ensure: (services: BlockRuntimeServices, signal: AbortSignal) => Promise<B>
  reset: (binding: B, services: BlockRuntimeServices, signal: AbortSignal) => Promise<void>
  normalizeError: (error: unknown) => unknown
  eventTypes: readonly string[]
  validateBinding: (input: unknown) => B | undefined
}

interface EventContext {
  workspaceID?: string
  blockID?: string
  functionalityID?: string
  revision?: number
}

const CHANGED_EVENT = "workspace.functionality.instance.changed" as const

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value
}

function asNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function makeAbortError(): Error {
  const error = new Error("The operation was aborted")
  error.name = "AbortError"
  return error
}

function isAbortError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false
  return error.name === "AbortError"
}

function combineSignals(
  left?: AbortSignal,
  right?: AbortSignal,
): AbortSignal {
  if (!left) return right ?? new AbortController().signal
  if (!right) return left

  const controller = new AbortController()
  const onAbort = () => {
    const signal = left.aborted ? left : right
    controller.abort(signal?.reason)
  }
  left.addEventListener("abort", onAbort, { once: true })
  right.addEventListener("abort", onAbort, { once: true })

  if (left.aborted) controller.abort(left.reason)
  if (right.aborted) controller.abort(right.reason)

  return controller.signal
}

function parseEventContext(event: ServerEvent): EventContext | undefined {
  const top = normalizeRecord(event)
  if (!top) return undefined
  const type = asString(top.type) ?? asString(top.name) ?? asString(top.event)
  if (!type) return undefined

  const details = normalizeRecord(top.current)
  const properties = normalizeRecord(top.properties)
  const source = properties ?? details ?? top
  if (!source) return undefined

  return {
    workspaceID: asString(source.workspaceID),
    blockID: asString(source.blockID) ?? asString(source.blockId),
    functionalityID: asString(source.functionalityID),
    revision: asNumber(source.revision),
  }
}

function revisionOf<B>(binding: B): number | undefined {
  return asNumber((binding as { revision?: unknown }).revision)
}

function isStaleBindingError(error: unknown): boolean {
  const details = normalizeRecord(error)
  return details?.type === "stale-binding"
}

export function createHostSessionBindingRegistration<B, ResetCommand>({
  functionalityID,
  get,
  ensure,
  reset,
  normalizeError,
  eventTypes,
  validateBinding,
}: HostSessionBindingRegistrationOptions<B, ResetCommand>): BlockRuntimeRegistration<
  HostSessionBindingState<B>,
  B | undefined,
  ResetCommand
> {
  const eventTypeList = [CHANGED_EVENT, ...eventTypes]

  let trackedBlockID: string | undefined
  let trackedWorkspaceEpoch: number | undefined
  let trackedWorkspaceID: string | undefined
  let inflightResolve: Promise<HostSessionBindingState<B>> | undefined
  let inflightResolveController: AbortController | undefined
  let inflightDispatch: Promise<void> | undefined
  let inflightDispatchController: AbortController | undefined
  let invalidateQueued = false
  let invalidateRevision = -1

  function resetInvalidationState() {
    invalidateQueued = false
    invalidateRevision = -1
  }

  async function loadBinding(
    services: BlockRuntimeServices,
    signal: AbortSignal,
    blockID: string,
  ): Promise<HostSessionBindingState<B>> {
    const workspaceID = services.workspace.id()
    if (!workspaceID) throw new Error("missing workspace")

    const getResult = await get(services, signal)
    if (signal.aborted) {
      throw makeAbortError()
    }

    if (getResult.status === "bound") {
      const binding = validateBinding(getResult.binding)
      if (!binding) throw new Error("Invalid binding payload")
      return { status: "bound", binding }
    }

    await services.workspace.awaitDescriptorPersisted(blockID, signal)

    const ensured = await ensure(services, signal)
    const binding = validateBinding(ensured)
    if (!binding) throw new Error("Invalid ensured binding")
    return { status: "bound", binding }
  }

  function readWorkspaceEpoch(services: BlockRuntimeServices): number {
    return services.workspace.epoch()
  }

  async function getFreshBound(
    resolved: HostSessionBindingState<B>,
    services: BlockRuntimeServices,
    signal: AbortSignal,
    blockID: string,
  ) {
    const candidate = await loadBinding(services, signal, blockID)
    return validateBinding(candidate.status === "bound" ? candidate.binding : undefined)
      ? candidate
      : resolved
  }

  return {
    functionalityID,
    mode: "native",
    async resolve(input) {
      const { block, services, signal } = input
      const workspaceID = services.workspace.id()

      if (!inflightResolve || !trackedBlockID || trackedBlockID !== block.id) {
        trackedBlockID = block.id
      }

      if (workspaceID) trackedWorkspaceID = workspaceID

      const currentEpoch = readWorkspaceEpoch(services)
      if (trackedWorkspaceEpoch !== currentEpoch) {
        resetInvalidationState()
        trackedWorkspaceEpoch = currentEpoch
      }

      if (inflightResolve) {
        return inflightResolve
      }

      const controller = new AbortController()
      const requestSignal = combineSignals(signal, controller.signal)
      inflightResolveController = controller

      const resolvePromise = loadBinding(services, requestSignal, block.id)
        .then((resolved) => {
          if (requestSignal.aborted) {
            throw makeAbortError()
          }
          if (!trackedBlockID) {
            trackedBlockID = block.id
          }
          return resolved
        })
        .catch((error) => {
          if (requestSignal.aborted) {
            throw makeAbortError()
          }
          if (isAbortError(error)) return Promise.reject(error)
          throw normalizeError(error)
        })
        .finally(() => {
          if (inflightResolveController === controller) {
            inflightResolve = undefined
            inflightResolveController = undefined
            resetInvalidationState()
          }
        })

      inflightResolve = resolvePromise
      return resolvePromise
    },

    eventKeys() {
      const keys: RuntimeEventKey[] = [{ type: CHANGED_EVENT, functionalityID }]
      for (const type of eventTypeList) {
        keys.push({ type })
      }
      if (!trackedBlockID) return keys

      for (const key of [...keys]) {
        key.blockID = trackedBlockID
        key.workspaceID = trackedWorkspaceID
      }
      return keys
    },

    onEvent(input) {
      const parsed = parseEventContext(input.event)
      if (!parsed) return "ignore"

      const type = asString(
        normalizeRecord(input.event)?.type ?? normalizeRecord(input.event)?.name ?? normalizeRecord(input.event)?.event,
      )
      if (!type) return "ignore"

      if (eventTypeList.every((entry) => entry !== type)) return "ignore"

      const workspaceID = input.services.workspace.id()
      if (workspaceID && parsed.workspaceID && parsed.workspaceID !== workspaceID) return "ignore"
      if (parsed.workspaceID && !workspaceID) return "ignore"
      if (trackedBlockID && parsed.blockID && parsed.blockID !== trackedBlockID) return "ignore"
      if (type === CHANGED_EVENT && parsed.functionalityID && parsed.functionalityID !== functionalityID) return "ignore"

      const parsedRevision = parsed.revision
      const currentRevision = input.resolved.status === "bound" ? revisionOf(input.resolved.binding) : undefined

      if (parsedRevision !== undefined && currentRevision !== undefined && parsedRevision <= currentRevision) {
        return "ignore"
      }

      if (parsedRevision !== undefined && parsedRevision <= invalidateRevision) {
        return "ignore"
      }

      if (invalidateQueued) return "ignore"

      invalidateQueued = true
      invalidateRevision =
        parsedRevision !== undefined && parsedRevision >= 0 ? parsedRevision : invalidateRevision
      return "invalidate"

    },

    select(input): B | undefined {
      return input.resolved.status === "bound" ? validateBinding(input.resolved.binding) : undefined
    },

    async dispatch(input) {
      const binding =
        input.resolved.status === "bound" && validateBinding(input.resolved.binding)
          ? input.resolved.binding
          : undefined

      if (!binding) {
        throw normalizeError({ type: "binding-unavailable" })
      }

      if (inflightDispatch) {
        return inflightDispatch
      }

      const controller = new AbortController()
      const requestSignal = combineSignals(input.signal, controller.signal)
      inflightDispatchController = controller

      const blockID = trackedBlockID
      if (!blockID) {
        throw normalizeError({ type: "binding-unavailable" })
      }

      const dispatchPromise = reset(binding, input.services, requestSignal)
        .then(() => {
          resetInvalidationState()
        })
        .catch((error) => {
          const normalized = normalizeError(error)

          if (!isStaleBindingError(normalized)) {
            throw normalized
          }

          return getFreshBound(input.resolved, input.services, requestSignal, blockID).then(() => {
            throw normalized
          })
        })
        .catch((error) => {
          if (isAbortError(error)) throw error
          throw error
        })
        .finally(() => {
          if (inflightDispatchController === controller) {
            inflightDispatch = undefined
            inflightDispatchController = undefined
          }
          resetInvalidationState()
        })

      inflightDispatch = dispatchPromise
      return dispatchPromise
    },

    dispose() {
      trackedWorkspaceID = undefined
      invalidateQueued = false
      invalidateRevision = -1
      if (inflightResolveController) {
        inflightResolveController.abort(makeAbortError())
      }
      if (inflightDispatchController) {
        inflightDispatchController.abort(makeAbortError())
      }
      inflightResolve = undefined
      inflightDispatch = undefined
      inflightResolveController = undefined
      inflightDispatchController = undefined
    },
  }
}

```

### `packages/app/src/pages/canvas/runtime/HANDOFF-D.md (60 lines)`

```ts
# Handoff D — Generic BlockRuntimeHost + canvas state separation

Executor: integration master (two worker attempts drifted; master implemented).

## Files changed

- \`packages/app/src/pages/canvas/runtime/local-view-store.ts\` (NEW) — per-block
  device-local view state, key \`opencode.canvas.local-view.v1\`, generic
  read/write/delete/clearAll, debounced persistence, no sessionID ever written.
- \`packages/app/src/pages/canvas/runtime/block-runtime-host.tsx\` (NEW) —
  pass-through host; resolves \`BlockRuntimeRegistration\` when supplied (Wave 2
  adapters); provides \`RuntimeBlockHandle\` via
  \`BlockRuntimeHandleContext\`; identity key = workspaceEpoch + workspaceID +
  blockID + functionalityID (C8); aborts + disposes on unmount.
- \`packages/app/src/pages/canvas/runtime/provider.tsx\` (NEW) — canvas-root
  provider owning one event router + registry + local-view store; exposes
  \`BlockRuntimeServices\` via context. v1 seams: \`serverSDK\` passthrough absent
  and router listen is a no-op — M wires \`serverSDK().event.listen\` at
  integration (Wave 3).
- \`packages/app/src/pages/canvas/workspace.tsx\` —
  - \`CanvasBlock\` is now descriptor-only: removed \`text\`, \`listening\`,
    \`messages\`, \`agentKey\`, \`layers\`, \`history\`, \`bindings\` (C1).
  - \`toPersistedBlock\`/\`persistedToBlock\` serialize descriptor + collapsed only.
  - \`applyServerLayout\` replaces descriptor transforms + collapsed only;
    \`mergeServerRuntime\` and \`applyPersistedChatRelayBinding\` deleted.
  - Notes/Voice/OperatingChat bodies read/write the local-view store.
  - Removed the ChatRelay runtime bootstrap (\`enableChatRelayBlockRuntime\`,
    \`VITE_CYBERMASTER_BLOCK_RUNTIME_V2\`) and the canvas-level \`useServerSDK\`.
  - Every block body renders inside \`<BlockRuntimeHost ...>\` (registration
    undefined in v1).
  - Canvas root wrapped in \`<BlockRuntimeProvider ...>\` with
    \`awaitDescriptorPersisted\` v1 polling seam (250ms tick, 15s cap, AbortSignal).

## Deleted legacy surface (needs M/Task-O follow-up)

- \`applyPersistedChatRelayBinding\`, \`mergeServerRuntime\`,
  \`onChatRelayBinding\` wiring, E's \`clearWorkspaceScopedBindings\`/epoch effect.

## Tests

- Type-level verification via app typecheck (0 errors in owned files).
- Runtime unit tests for the new modules deferred to Wave 2 adapters (H/I)
  which exercise the host end-to-end; the host's registration path is
  exercised by G's track examples when a registration is available.
- LOCAL-VIEW/STORAGE assertions: grep \`sessionID\` over
  \`toPersistedBlock\`/\`persist()\` — none serialized.

## Integration actions for M

1. Wire \`serverSDK().event.listen\` into \`BlockRuntimeProvider\` (router).
2. Replace \`awaitDescriptorPersisted\` polling seam with manager push hook.
3. Register Wave-2 renderer modules in the host (replace undefined registration).
4. Regenerate SDK after E's protocol changes (\`bun run generate\`).
5. Rebuild embedded UI after frontend integration.

## Prohibited-pattern grep

Clean over owned files (no \`/api/block-runtime/event\` session use, no
\`CHAT_RELAY_DEFAULT_SESSION_ID\`, no \`block.bindings\` persistence).

```

### `packages/app/src/pages/canvas/workspace.tsx:1450-1500`

```tsx
                      workspaceEpoch={manager.workspaceEpoch()}
                    >
                    <Show when={item.type === "legacy"}>
                      <div class="canvas-legacy-body">{props.children}</div>
                    </Show>
                    <Show when={item.type === "context"}>
                      <ContextBody />
                    </Show>
                    <Show when={item.type === "tools"}>
                      <ToolsBody />
                    </Show>
                    <Show when={item.type === "files"}>
                      <FilesBody />
                    </Show>
                    <Show when={item.type === "notes"}>
                      <NotesBody block={item} setState={setState} />
                    </Show>
                    <Show when={item.type === "voice"}>
                      <VoiceBody block={item} setState={setState} />
                    </Show>
                    <Show when={item.type === "chat-relay"}>
                      <ChatRelayBody
                        block={item}
                        permissions={manager.configPermission()}
                        workspaceID={manager.workspaceID() ?? ""}
                        focused={state.selectedId === item.id}
                        onFocus={() => bringToFront(item.id)}
                      />
                    </Show>
                    <Show when={item.type === "operating-chat"}>
                      <OperatingChatBody
                        block={item}
                        setState={setState}
                        permissions={manager.configPermission()}
                        agentKey={manager.operatingAgentKey()}
                      />
                    </Show>
                    <Show when={item.type === "master-agent"}>
                      {/* B3's block renderer reads binding and actions through
                          manager.masterAgent; the canvas passes only block
                          identity, focus state, the manager, and its own
                          focus/selection callback. Session IDs and binding
                          revisions never enter canvas state or layout. */}
                      <MasterAgentBlock
                        blockID={item.id}
                        focused={state.selectedId === item.id}
                        manager={manager.masterAgent}
                        onFocus={() => bringToFront(item.id)}
                      />
                    </Show>
                    </BlockRuntimeHost>
```
