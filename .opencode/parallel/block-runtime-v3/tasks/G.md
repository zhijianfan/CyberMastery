You are worker 7 of 7 (Wave 1) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task G — Deterministic test harness and fixtures

Goal: replace stale/timing-dependent canvas tests with deterministic fixtures
every product track (C/D/E/F/H/I) reuses. Repair the stale central E2E harness
enough that failures reflect production behavior, not mock-shape drift.

## Current baseline facts

- `bun test --conditions=browser src/pages/canvas/master-agent.e2e.test.tsx`
  currently fails AT MODULE LOAD (0 pass / 1 fail): the import graph resolves
  `solid-js/web` to the server build (`Export named 'use' not found in
  solid-js/web/dist/server.js`) when `src/context/server-sdk.tsx` is loaded.
  Earlier in the day the same file ran 16 tests (3 pass / 13 fail — 9 stale
  real-renderer failures). Your job: make the harness load and the runtime
  scenarios deterministic; real-renderer failures may be honestly recorded as
  pre-existing/outside-plan, but the harness must LOAD and new runtime tests
  must run deterministically.

## Required fixtures (NEW, under packages/app/src/test/)

1. `fake-server-event-bus.ts` — `createFakeServerEventBus()`:
   synchronous emit; pause/resume/disconnect/reconnect; event IDs/revisions;
   listener-count assertions; `listen`/`start` surface matching the real
   `serverSDK().event` API shape (see inlined usage).
2. `fake-workspace-api.ts` — list/get/create + layout get/save; delete/reset
   current workspace; conflict/handover/not-found injection.
3. `fake-host-binding-port.ts` — get/ensure/reset; CAS revision; busy/stale.
4. `fake-session-surface-state.ts` — messages/tool/permission/status signals
   with no network calls.
5. `browser-helpers.ts` — mount canvas with explicit block descriptors; inspect
   localStorage descriptor vs view-state keys; flush microtasks/RAF without
   sleeps (queueMicrotask + animation-frame flushing helper); count prompt
   requests.

## Required work

- Repair the central E2E harness (`packages/app/src/pages/canvas/master-agent.e2e.test.tsx`):
  first make the module LOAD under bun (fix the solid-js/web server-build
  resolution — e.g. preload `./happydom.ts` plus any import re-ordering needed;
  do not weaken assertions). Keep the existing passing scenario tests; convert
  timing-based waits to deterministic fixtures.
- Add ONE example deterministic test per production track, importing the
  fixture layer: event-router invalidation (C shape), host mount/dispose
  (D shape), workspace recovery (E shape), session-binding ensure (F shape).
  These example tests live under `packages/app/src/test/` and only consume the
  public APIs those tracks will ship; if a track's API is not yet on disk, write
  the test against the FROZEN interface names from the contract doc and mark it
  `// @skip pending-<track>`.
- Do NOT edit production code outside the e2e file. Record pre-existing
  failures that are outside this plan in HANDOFF-G.

## Owned files (edit ONLY these)

- `packages/app/src/test/fake-server-event-bus.ts` (NEW)
- `packages/app/src/test/fake-workspace-api.ts` (NEW)
- `packages/app/src/test/fake-host-binding-port.ts` (NEW)
- `packages/app/src/test/fake-session-surface-state.ts` (NEW)
- `packages/app/src/test/browser-helpers.ts` (NEW)
- `packages/app/src/test/track-examples.test.ts` (NEW)
- `packages/app/src/pages/canvas/master-agent.e2e.test.tsx` (harness repair only)
- `packages/app/src/test/HANDOFF-G.md`

Do NOT edit any other production file.

## Targeted validation (allowed)

- `cd packages/app && bun test --conditions=browser --preload ./happydom.ts src/test/track-examples.test.ts`
- `cd packages/app && bun test --conditions=browser src/pages/canvas/master-agent.e2e.test.tsx`

## Handoff

`HANDOFF-G.md`: fixture import paths + one usage example each · the exact
harness repair applied · updated e2e baseline (pass/fail counts with honest
pre-existing list) · integration actions M must take · prohibited-pattern grep
result.



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


### `packages/app/src/pages/canvas/master-agent.e2e.test.tsx (1078 lines)`

```tsx
// Track V3 — App canvas integration tests (master-agent e2e). Mounts the REAL
// canvas renderer (workspace.tsx), the REAL manager (manager.ts), the REAL
// block composition (master-agent/block.tsx), and the REAL multi-instance
// surface adapter (session-surface.tsx) together, with only the transport and
// the heavy U2 base surface stood in:
//   - "@/context/server-sdk"      -> controllable fake SDK (v2 workspace
//     endpoints + G1 masterAgent endpoints + event emitter). The manager's
//     M5 sdk-port (post-rebase) consumes client.workspace.masterAgent.*;
//     the fake auto-ensures bindings so the exact ensure-vs-refetch timing of
//     the in-flight M6 manager does not matter.
//   - "@/context/layout"          -> static project
//   - "@/hooks/use-providers"     -> no providers
//   - "@opencode-ai/ui/theme/context" -> static dark theme
//   - "../session-surface-base"   -> recording shell (U2's routed-surface
//     internals are covered by its own suite; here it records what the real
//     adapter delivers: target, surface identity, focus, queue flag).
//
// Everything else is real: manager state machines (lifecycle controller,
// event reconciliation, coder controller), the B1 shell, B2 Coder selector,
// Q1 session options, U3 session-scope/target providers, and the canvas
// layout/persistence path.
//
// Run: bun test --conditions=browser packages/app/src/pages/canvas/master-agent.e2e.test.tsx
// (same React-global shim + conditions=browser convention as
// coder-selector.test.tsx / session-surface.test.tsx / master-agent.integration.test.tsx).
//
// Rebase notes (listed in the V3 completion note):
//   - Canvas suite needs M6 to finish wiring M5's sdk-port into manager.ts
//     (the landed manager still falls back to unavailableMasterAgentPort).
//   - Blocks mount before connect() sets workspaceID, so the controller's
//     ensure no-ops; tests drive readiness through the real reconnect-refetch
//     path (window "online" -> M3 reconciliation -> authoritative get), which
//     is also the acceptance path for "missed events recover through get".
//   - The coder controller snapshots coderModel at first access (pre-connect),
//     so connect-time workspace coderModel seeding is not asserted at canvas
//     level; set/clear through the real selector is covered in the block suite.
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createComponent, createSignal, onCleanup } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import type { CanvasSessionSurfaceProps, SessionSurfaceTarget } from "./session-target"
import type { MasterAgentBlockProps, MasterAgentManagerApi } from "./master-agent/block"
import type { BindingState, MasterAgent, ModelSelection } from "./master-agent/types"
import {
  buildAuthTransitionEvents,
  buildDisconnectResumeEvents,
  buildIncrementalTextPartEvents,
  buildMessageShellEvents,
  buildPermissionFlowEvents,
  buildSessionStatusEvents,
  buildSkippedCursorEvent,
  buildStaleRevisionEvent,
  SKIPPED_CURSOR,
  buildDuplicateEvent,
  makeEmptyRuntimeState,
} from "../../test/block-runtime-events"

// Bun's TSX transform emits classic React.createElement calls, so shim the
// React global with solid's hyperscript before any JSX runs. Bun's transform
// also evaluates JSX props eagerly, so props are static snapshots: tests
// remount to change focused/busy state instead of updating signals.
function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

const Fragment = (props: { children?: unknown }) => props.children

;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

const STORAGE_KEY = "opencode-canvas-v1"
const WORKSPACE_ID = "ws-1"

// ---- Fake SDK -------------------------------------------------------------

interface FakeBindingRecord {
  binding: MasterAgent.Binding
  generation: number
}

interface ResetCall {
  blockID: string
  expectedSessionID: string
  expectedRevision: number
}

function createFakeServerSDK() {
  const bindings = new Map<string, FakeBindingRecord>()
  const ensureCalls: string[] = []
  const getCalls: string[] = []
  const resetCalls: ResetCall[] = []
  const savedLayouts: Array<Array<Record<string, unknown>>> = []
  const workspacePatches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const listeners = new Set<(entry: { type: string; details?: { type: string; properties?: unknown } }) => void>()
  let layoutGets = 0

  function bindingFor(blockID: string): MasterAgent.Binding {
    const existing = bindings.get(blockID)
    if (existing) return existing.binding
    // Idempotent ensure semantics (spec 02 §5/§6): repeated ensure for one
    // block returns the same binding. \`get\` auto-ensures too so the suite is
    // independent of whether ensure-on-mount or reconnect-refetch drives the
    // first authoritative read.
    const record: FakeBindingRecord = {
      generation: 1,
      binding: {
        workspaceID: WORKSPACE_ID,
        blockID,
        functionalityInstanceID: \`fi-${blockID}\`,
        sessionID: \`sess-${blockID}-1\`,
        directory: "C:/test-project",
        generation: 1,
        revision: 1,
      },
    }
    bindings.set(blockID, record)
    return record.binding
  }

  const masterAgent = {
    ensure: async (parameters: { workspaceID: string; blockID: string }) => {
      ensureCalls.push(parameters.blockID)
      return { data: bindingFor(parameters.blockID) }
    },
    get: async (parameters: { workspaceID: string; blockID: string }) => {
      getCalls.push(parameters.blockID)
      return { data: { status: "bound" as const, binding: bindingFor(parameters.blockID) } }
    },
    reset: async (parameters: {
      workspaceID: string
      blockID: string
      masterAgentResetPayload: { expectedSessionID: string; expectedRevision: number }
    }) => {
      const { blockID, masterAgentResetPayload } = parameters
      resetCalls.push({
        blockID,
        expectedSessionID: masterAgentResetPayload.expectedSessionID,
        expectedRevision: masterAgentResetPayload.expectedRevision,
      })
      const current = bindings.get(blockID)
      if (!current || current.binding.sessionID !== masterAgentResetPayload.expectedSessionID) {
        return { data: { status: "stale" as const } }
      }
      if (current.binding.revision !== masterAgentResetPayload.expectedRevision) {
        return { data: { status: "stale" as const } }
      }
      current.generation += 1
      current.binding = {
        ...current.binding,
        sessionID: \`sess-${blockID}-${current.generation}\`,
        generation: current.generation,
        revision: current.binding.revision + 1,
      }
      return { data: { status: "reset" as const, binding: current.binding } }
    },
  }

  const workspace = {
    masterAgent,
    update: async (parameters: { workspaceUpdatePayload: { id: string; patch: Record<string, unknown> } }) => {
      const { id, patch } = parameters.workspaceUpdatePayload
      workspacePatches.push({ id, patch })
      return { data: { model: "acme:primary", operatingAgent: null, coderModel: patch.coderModel ?? null } }
    },
  }

  const fake = {
    client: {
      v2: {
        workspace: {
          list: async () => ({ data: [{ id: WORKSPACE_ID }] }),
          get: async () => ({ data: { model: "acme:primary", operatingAgent: null, coderModel: null } }),
          create: async () => ({ data: { id: WORKSPACE_ID } }),
          update: workspace.update,
          layout: {
            get: async () => {
              layoutGets += 1
              // Pristine default layout: the manager keeps the client's
              // seeded blocks and pushes them once connected.
              return {
                data: {
                  blocks: [
                    { id: "default-chat", functionality: "builtin:chat", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
                  ],
                  revision: 1,
                },
              }
            },
            save: async (parameters: { workspaceLayoutSavePayload: { blocks: Array<Record<string, unknown>> } }) => {
              const blocks = parameters.workspaceLayoutSavePayload.blocks
              savedLayouts.push(blocks)
              return { data: { status: "saved" as const, layout: { blocks, revision: 2 } } }
            },
          },
        },
        relay: {
          dispose: async () => ({}),
        },
      },
      workspace,
    },
    createClient: () => ({
      config: {
        get: async () => ({ data: { permission: "allow" } }),
        update: async () => ({}),
      },
    }),
    event: {
      start: () => {},
      listen: (listener: (entry: { type: string; details?: { type: string; properties?: unknown } }) => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    fire(entry: { type: string; details: { type: string; properties?: unknown } }) {
      for (const listener of listeners) listener(entry)
    },
    reset() {
      bindings.clear()
      ensureCalls.length = 0
      getCalls.length = 0
      resetCalls.length = 0
      savedLayouts.length = 0
      workspacePatches.length = 0
      listeners.clear()
      layoutGets = 0
    },
    ensureCalls,
    getCalls,
    resetCalls,
    savedLayouts,
    workspacePatches,
    layoutGets: () => layoutGets,
  }
  return fake
}

const fakeSDK = createFakeServerSDK()

const runtimeTrackModules = await (async () => {
  try {
    await Promise.all([import("./runtime"), import("./blocks/chat-relay/runtime")])
    return { available: true, reason: "runtime contracts available" }
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : "runtime contracts unavailable",
    }
  }
})()

mock.module("@/context/layout", () => ({
  useLayout: () => ({ projects: { list: () => [{ worktree: "C:/test-project" }] } }),
}))

mock.module("@/context/server-sdk", () => ({
  // Compatibility shim: production \`useServerSDK\` returns an accessor, and the
  // manager consumes it as \`serverSDK()\`. The fake must follow that contract.
  useServerSDK: () => () => fakeSDK,
}))

mock.module("@/hooks/use-providers", () => ({
  useProviders: () => ({ all: () => new Map(), connected: () => [] }),
}))

mock.module("@opencode-ai/ui/theme/context", () => ({
  useTheme: () => ({ mode: () => "dark", setColorScheme: () => {} }),
}))

// ---- Real surface adapter, recording base ---------------------------------

interface RecordedBase {
  target: SessionSurfaceTarget
  surfaceID: string
  focused: boolean
  queueEnabled: boolean
  onFocus: () => void
  onRequestOpenFullPage?: () => void
}

const recordedBases: RecordedBase[] = []
let baseDisposals = 0

// U2's routed surface is exercised by its own suite (and pulls in the whole
// Session stack); stand in with a recording shell so the e2e can assert what
// the real U3 adapter delivers into the base: target, scoped surface identity,
// focus, and the Q1 queue flag.
mock.module("../session-surface-base", () => {
  const SessionSurfaceBase = (props: CanvasSessionSurfaceProps) => {
    recordedBases.push({
      target: props.target,
      surfaceID: props.surfaceID,
      focused: props.focused,
      queueEnabled: props.queueEnabled,
      onFocus: props.onFocus,
      onRequestOpenFullPage: props.onRequestOpenFullPage,
    })
    onCleanup(() => {
      baseDisposals += 1
    })
    return h("div", {
      "data-base-surface-id": props.surfaceID,
      "data-base-session-id": props.target.sessionID,
      "data-base-focused": props.focused,
      "data-base-queue": props.queueEnabled,
    })
  }
  return { SessionSurfaceBase }
})

interface WorkspaceModule {
  CanvasWorkspace: (props: { children?: unknown }) => unknown
}

let workspaceModule: WorkspaceModule
let MasterAgentBlock: typeof import("./master-agent/block")["MasterAgentBlock"]

beforeAll(async () => {
  // happy-dom provides both; guards keep the suite runnable on leaner DOMs.
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false
      },
    })) as unknown as typeof window.matchMedia
  }
  workspaceModule = (await import("./workspace")) as unknown as WorkspaceModule
  MasterAgentBlock = (await import("./master-agent/block")).MasterAgentBlock
})

const disposers: (() => void)[] = []

function seedBlocks(blocks: Record<string, unknown>[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ camera: { x: 0, y: 0, scale: 1 }, editing: true, blocks }))
}

function masterAgentBlock(id: string, x: number, y: number): Record<string, unknown> {
  return {
    id,
    type: "master-agent",
    x,
    y,
    w: 440,
    h: 500,
    z: 10,
    collapsed: false,
    defaultRect: false,
    text: "",
    listening: false,
    messages: [],
    relay: "uninitialized",
    agentKey: "inherit",
    layers: [],
    history: [],
  }
}

function mountWorkspace(children: unknown) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  // \`h\` returns a renderable thunk; render() evaluates the wrapper and insert
  // evaluates the thunk as an accessor inside the reactive root. The cast
  // reconciles hyperscript's opaque thunk type with render's \`() => Element\`.
  const dispose = render(() => h(workspaceModule.CanvasWorkspace as never, { children }) as never, host)
  disposers.push(() => {
    dispose()
    host.remove()
  })
  return host
}

function card(host: HTMLElement, id: string): HTMLElement {
  const element = host.querySelector(\`[data-card-id="${id}"]\`)
  if (!(element instanceof HTMLElement)) throw new Error(\`card ${id} not found\`)
  return element
}

function shellIn(cardElement: HTMLElement): HTMLElement {
  const element = cardElement.querySelector(".master-agent-shell")
  if (!(element instanceof HTMLElement)) throw new Error("master-agent shell not found")
  return element
}

function surfaceRoot(host: HTMLElement, surfaceID: string): HTMLElement {
  const element = host.querySelector(\`[data-surface-id="${surfaceID}"]\`)
  if (!(element instanceof HTMLElement)) throw new Error(\`surface ${surfaceID} not found\`)
  return element
}

function resetButton(cardElement: HTMLElement): HTMLButtonElement {
  const button = cardElement.querySelector<HTMLButtonElement>(".master-agent-button.primary")
  if (!button) throw new Error("reset button not found")
  return button
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function fireBindingUpdated(blockID: string, sessionID: string, revision: number, workspaceID = WORKSPACE_ID) {
  // ServerSDK event wire shape: \`details.type\` + \`details.properties\` (the
  // manager's config/layout listeners read \`entry.details.type\` directly).
  const type = "workspace.master-agent.binding.updated"
  const properties = { workspaceID, blockID, sessionID, generation: 1, revision }
  fakeSDK.fire({ type, details: { type, properties } })
}

// Blocks mount before connect() resolves workspaceID, so the controller's
// ensure no-ops; readiness is driven through the real reconnect path: window
// "online" -> markConnected -> M3 reconciliation refetch -> authoritative get.
async function bringBlocksToReady(host: HTMLElement, blockIDs: string[]) {
  await waitFor(() => fakeSDK.layoutGets() >= 1)
  // Let connect() finish markConnected() before firing the reconnect path.
  await flush()
  window.dispatchEvent(new Event("online"))
  await waitFor(() =>
    blockIDs.every((id) => {
      const element = host.querySelector(\`[data-card-id="${id}"] .master-agent-shell\`)
      return element instanceof HTMLElement && element.dataset.status === "ready"
    }),
  )
}

function lastRecordFor(surfaceID: string): RecordedBase | undefined {
  let last: RecordedBase | undefined
  for (const entry of recordedBases) {
    if (entry.surfaceID === surfaceID) last = entry
  }
  return last
}

beforeEach(() => {
  fakeSDK.reset()
  recordedBases.length = 0
  baseDisposals = 0
  localStorage.clear()
})

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
  document.body.innerHTML = ""
  localStorage.clear()
})

// ---- Canvas-level e2e: real workspace + real manager + real block ---------

describe("master-agent canvas e2e (real renderer)", () => {
  test("renders two master-agent cards with the real shell and isolated scoped surfaces; legacy chat unaffected", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    const host = mountWorkspace("legacy session ui")
    await bringBlocksToReady(host, ["ma-1", "ma-2"])

    const cards = [...host.querySelectorAll(".canvas-card")]
    expect(cards).toHaveLength(3)

    const first = shellIn(card(host, "ma-1"))
    const second = shellIn(card(host, "ma-2"))
    expect(first.dataset.status).toBe("ready")
    expect(second.dataset.status).toBe("ready")
    expect(card(host, "ma-1").querySelector(".master-agent-session-slot")).not.toBeNull()

    // Distinct, scoped surfaces: unique surface ids, session ids, and DOM roots.
    const surfaceA = surfaceRoot(host, "master-agent-ma-1")
    const surfaceB = surfaceRoot(host, "master-agent-ma-2")
    expect(surfaceA.dataset.sessionId).toBe("sess-ma-1-1")
    expect(surfaceB.dataset.sessionId).toBe("sess-ma-2-1")
    expect(surfaceA.dataset.sessionId).not.toBe(surfaceB.dataset.sessionId)
    expect(document.getElementById("canvas-session-master-agent-ma-1-root")).toBe(surfaceA)
    expect(document.getElementById("canvas-session-master-agent-ma-2-root")).toBe(surfaceB)
    expect(surfaceA.dataset.focused).toBe("false")
    expect(surfaceB.dataset.focused).toBe("false")

    // The real block delivered the binding target into the real adapter.
    expect(recordedBases).toHaveLength(2)
    expect(recordedBases[0]?.target).toEqual({
      sessionID: "sess-ma-1-1",
      directory: "C:/test-project",
      workspaceID: WORKSPACE_ID,
    })
    expect(recordedBases[1]?.target.sessionID).toBe("sess-ma-2-1")
    expect(recordedBases[0]?.surfaceID).toBe("master-agent-ma-1")
    expect(recordedBases[1]?.surfaceID).toBe("master-agent-ma-2")
    // Idle host session: the Q1 queue action stays hidden.
    expect(recordedBases.every((entry) => entry.queueEnabled === false)).toBeTrue()

    // Card chrome comes from the I1 descriptor; the legacy routed slot is intact.
    const titles = [...host.querySelectorAll(".canvas-card-title")].map((node) => node.textContent)
    expect(titles).toContain("Master Agent")
    expect(titles).toContain("OpenCode")
    expect(host.querySelector(".canvas-legacy-body")?.textContent).toContain("legacy session ui")

    // Workspace-wide Coder selector: identical disabled view in every block.
    for (const id of ["ma-1", "ma-2"]) {
      const coder = card(host, id).querySelector(".master-agent-coder")
      expect(coder?.getAttribute("data-state")).toBe("disabled")
      expect(coder?.textContent).toContain("Workspace-wide")
      expect(coder?.textContent).toContain("Disabled — no Coder model selected")
    }
  })

  test("reconnect refetch recovers bindings authoritatively, exactly once per reconnect", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40)])
    const host = mountWorkspace("legacy session ui")
    await bringBlocksToReady(host, ["ma-1"])
    expect(fakeSDK.getCalls.filter((id) => id === "ma-1")).toHaveLength(1)

    window.dispatchEvent(new Event("online"))
    await waitFor(() => fakeSDK.getCalls.filter((id) => id === "ma-1").length >= 2)
    await flush()

    // Same binding, same session: the surface re-rendered in place, never
    // remounted (no base disposal) and no duplicate session was created.
    expect(surfaceRoot(host, "master-agent-ma-1").dataset.sessionId).toBe("sess-ma-1-1")
    expect(baseDisposals).toBe(0)
    expect(recordedBases.map((entry) => entry.target.sessionID)).toEqual(["sess-ma-1-1", "sess-ma-1-1"])
    // A ready block is never re-ensured (idempotent lifecycle).
    expect(fakeSDK.ensureCalls.filter((id) => id === "ma-1").length).toBeLessThanOrEqual(1)
  })

  test("binding events: newer revision re-targets, stale and foreign-workspace events are ignored", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    const host = mountWorkspace("legacy session ui")
    await bringBlocksToReady(host, ["ma-1", "ma-2"])

    fireBindingUpdated("ma-1", "sess-ma-1-e2", 2)
    await flush()
    expect(surfaceRoot(host, "master-agent-ma-1").dataset.sessionId).toBe("sess-ma-1-e2")
    expect(surfaceRoot(host, "master-agent-ma-2").dataset.sessionId).toBe("sess-ma-2-1")

    // Stale revision: ignored by the M3 reconciliation + M1 reducer.
    fireBindingUpdated("ma-1", "sess-stale", 1)
    await flush()
    expect(surfaceRoot(host, "master-agent-ma-1").dataset.sessionId).toBe("sess-ma-1-e2")

    // Event for another workspace: ignored by the manager.
    fireBindingUpdated("ma-1", "sess-other-ws", 9, "ws-other")
    await flush()
    expect(surfaceRoot(host, "master-agent-ma-1").dataset.sessionId).toBe("sess-ma-1-e2")

    // Event handling never issues lifecycle requests.
    const getsBefore = fakeSDK.getCalls.length
    const ensuresBefore = fakeSDK.ensureCalls.length
    expect(fakeSDK.getCalls.length).toBe(getsBefore)
    expect(fakeSDK.ensureCalls.length).toBe(ensuresBefore)
  })

  test("reset affects one block and forwards the expected binding values through the manager", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    const host = mountWorkspace("legacy session ui")
    await bringBlocksToReady(host, ["ma-1", "ma-2"])

    resetButton(card(host, "ma-1")).click()
    await waitFor(() => fakeSDK.resetCalls.length === 1)
    await flush()

    expect(fakeSDK.resetCalls).toEqual([
      { blockID: "ma-1", expectedSessionID: "sess-ma-1-1", expectedRevision: 1 },
    ])
    // Only the reset block re-targets; the sibling keeps its session and revision.
    expect(surfaceRoot(host, "master-agent-ma-1").dataset.sessionId).toBe("sess-ma-1-2")
    expect(surfaceRoot(host, "master-agent-ma-2").dataset.sessionId).toBe("sess-ma-2-1")
    expect(shellIn(card(host, "ma-2")).dataset.status).toBe("ready")
    expect(lastRecordFor("master-agent-ma-1")?.target.sessionID).toBe("sess-ma-1-2")
    expect(lastRecordFor("master-agent-ma-2")?.target.sessionID).toBe("sess-ma-2-1")
  })

  test("layout serialization and local persistence carry presentation only — never session binding or queue state", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40)])
    const host = mountWorkspace("legacy session ui")
    await bringBlocksToReady(host, ["ma-1"])

    // Focus the block via its shell (bringToFront -> saveSoon -> persist +
    // manager.sync); the card section itself has no click handler.
    shellIn(card(host, "ma-1")).click()
    await waitFor(() => fakeSDK.savedLayouts.length >= 1)

    const payload = fakeSDK.savedLayouts[fakeSDK.savedLayouts.length - 1]!
    const serialized = JSON.stringify(payload)
    for (const forbidden of [
      "sessionID",
      "sessionBinding",
      "functionalityInstanceID",
      "generation",
      "revision",
      "queue",
      "coderModel",
      "directory",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    const masterAgentRecord = payload.find((record) => record.functionality === "builtin:master-agent")
    expect(masterAgentRecord).toBeDefined()
    expect(masterAgentRecord!.id).toBe("ma-1")
    const transform = masterAgentRecord!.transform as Record<string, unknown>
    expect(typeof transform.x).toBe("number")
    expect(typeof transform.y).toBe("number")
    expect(typeof transform.w).toBe("number")
    expect(typeof transform.h).toBe("number")
    // The pinned legacy chat card still participates in the layout.
    expect(payload.some((record) => record.functionality === "builtin:chat")).toBeTrue()

    const local = JSON.stringify(JSON.parse(localStorage.getItem(STORAGE_KEY)!))
    for (const forbidden of ["sessionID", "sessionBinding", "functionalityInstanceID", "revision", "queue", "coderModel"]) {
      expect(local).not.toContain(forbidden)
    }
  })

  test("applyServerLayout ignores runtime-only fields from incoming records", async () => {
    const originalLayoutGet = fakeSDK.client.v2.workspace.layout.get
    fakeSDK.client.v2.workspace.layout.get = async () => ({
      data: {
        blocks: [
          {
            id: "ma-1",
            functionality: "builtin:master-agent",
            transform: { x: 12, y: 34, w: 440, h: 500, z: 1 },
            sessionID: "runtime-should-not-stick",
            sessionBinding: "fi-runtime",
            functionalityInstanceID: "fi-runtime-instance",
            generation: 99,
            revision: 99,
            queue: true,
            coderModel: "acme:secret",
            directory: "/dev/runtime",
            relay: "uninitialized",
          },
        ],
        revision: 2,
      },
    })

    try {
      const host = mountWorkspace("legacy session ui")
      await bringBlocksToReady(host, ["ma-1"])
      shellIn(card(host, "ma-1")).click()
      await waitFor(() => fakeSDK.savedLayouts.length >= 1)

      const payload = fakeSDK.savedLayouts[fakeSDK.savedLayouts.length - 1]!
      const serialized = JSON.stringify(payload)
      for (const forbidden of [
        "sessionID",
        "sessionBinding",
        "functionalityInstanceID",
        "generation",
        "revision",
        "queue",
        "coderModel",
        "directory",
      ]) {
        expect(serialized).not.toContain(forbidden)
      }
      expect(serialized).not.toContain("relay")
      const saved = payload.find((record) => record.functionality === "builtin:master-agent")
      expect(saved).toBeDefined()
      expect(saved!.id).toBe("ma-1")
      expect(saved!.functionality).toBe("builtin:master-agent")
    } finally {
      fakeSDK.client.v2.workspace.layout.get = originalLayoutGet
    }
  })

  test("removing a block drops only its local projection; the sibling stays bound and the host session is untouched", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    const host = mountWorkspace("legacy session ui")
    await bringBlocksToReady(host, ["ma-1", "ma-2"])
    const getCallsBefore = fakeSDK.getCalls.length
    const ensureCallsBefore = fakeSDK.ensureCalls.length

    const remove = card(host, "ma-1").querySelector<HTMLButtonElement>('button[aria-label="Remove block"]')
    expect(remove).not.toBeNull()
    remove!.click()
    await flush()

    expect(host.querySelector('[data-card-id="ma-1"]')).toBeNull()
    expect(shellIn(card(host, "ma-2")).dataset.status).toBe("ready")
    expect(surfaceRoot(host, "master-agent-ma-2").dataset.sessionId).toBe("sess-ma-2-1")
    // No lifecycle or host calls fired for removal: projection-only cleanup.
    expect(fakeSDK.getCalls.length).toBe(getCallsBefore)
    expect(fakeSDK.ensureCalls.length).toBe(ensureCallsBefore)
    expect(fakeSDK.resetCalls).toEqual([])
    // The removed surface unmounted; the sibling's surface stayed bound.
    expect(baseDisposals).toBe(1)
    expect(lastRecordFor("master-agent-ma-2")?.target.sessionID).toBe("sess-ma-2-1")
  })

  test("remount (reload projection) preserves the host binding and session identity", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40)])
    const first = mountWorkspace("legacy session ui")
    await bringBlocksToReady(first, ["ma-1"])
    expect(surfaceRoot(first, "master-agent-ma-1").dataset.sessionId).toBe("sess-ma-1-1")

    // Full reload: dispose the workspace (manager disposal) and remount.
    while (disposers.length > 0) disposers.pop()?.()
    document.body.innerHTML = ""
    recordedBases.length = 0
    baseDisposals = 0

    const second = mountWorkspace("legacy session ui")
    await bringBlocksToReady(second, ["ma-1"])
    // The host binding survived: same session id, no second session created.
    expect(surfaceRoot(second, "master-agent-ma-1").dataset.sessionId).toBe("sess-ma-1-1")
    expect(recordedBases[0]?.target.sessionID).toBe("sess-ma-1-1")
  })

  test("focus handover flows through the real surface adapter into canvas selection", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    const host = mountWorkspace("legacy session ui")
    await bringBlocksToReady(host, ["ma-1", "ma-2"])

    expect(card(host, "ma-1").classList.contains("selected")).toBeFalse()
    expect(card(host, "ma-2").classList.contains("selected")).toBeFalse()

    surfaceRoot(host, "master-agent-ma-1").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    await flush()
    expect(card(host, "ma-1").classList.contains("selected")).toBeTrue()
    expect(card(host, "ma-2").classList.contains("selected")).toBeFalse()
    expect(surfaceRoot(host, "master-agent-ma-1").dataset.focused).toBe("true")

    surfaceRoot(host, "master-agent-ma-2").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    await flush()
    expect(card(host, "ma-2").classList.contains("selected")).toBeTrue()
    expect(card(host, "ma-1").classList.contains("selected")).toBeFalse()
    expect(surfaceRoot(host, "master-agent-ma-2").dataset.focused).toBe("true")
  })
})

// ---- Block-level e2e: real block + real surface adapter + local fake manager
//
// The canvas does not inject a busy signal, so queue gating, ensure-on-mount,
// projection-only unmount, and Coder set/clear are verified here through the
// REAL block renderer, REAL session options, REAL Coder selector, and REAL U3
// surface adapter, with only the manager stood in (per plan §16 — manager.ts
// is M6's in-flight file). These tests run against today's landed shape.

const coderMini: ModelSelection = { providerID: "acme", modelID: "coder-mini" }
const coderPro: ModelSelection = { providerID: "acme", modelID: "coder-pro" }

function binding(blockID: string, sessionID: string, revision = 1): MasterAgent.Binding {
  return {
    workspaceID: WORKSPACE_ID,
    blockID,
    functionalityInstanceID: \`fi-${blockID}\`,
    sessionID,
    directory: "/repo/main",
    generation: 1,
    revision,
  }
}

type StateSignal = ReturnType<typeof createSignal<BindingState>>

interface FakeManager {
  manager: MasterAgentManagerApi
  setState(blockID: string, next: BindingState): void
  setCoderModel(model: ModelSelection | null): void
  ensureCalls: string[]
  resetCalls: string[]
  removalCalls: string[]
  coderSet: ModelSelection[]
  coderClearCalls: () => number
}

function createFakeManager(initial: Record<string, BindingState> = {}): FakeManager {
  const ensureCalls: string[] = []
  const resetCalls: string[] = []
  const removalCalls: string[] = []
  const coderSet: ModelSelection[] = []
  let coderClearCount = 0
  const [coderModel, setCoderModel] = createSignal<ModelSelection | null>(null)
  const [coderPending, setCoderPending] = createSignal(false)
  const [coderError, setCoderError] = createSignal<unknown | null>(null)
  const states = new Map<string, StateSignal>()
  for (const [blockID, value] of Object.entries(initial)) states.set(blockID, createSignal(value))

  const manager: MasterAgentManagerApi = {
    state(blockID) {
      let entry = states.get(blockID)
      if (!entry) {
        entry = createSignal<BindingState>({ status: "uninitialized" })
        states.set(blockID, entry)
      }
      return entry[0]
    },
    ensure: (blockID) => {
      ensureCalls.push(blockID)
      return Promise.resolve()
    },
    retry: (blockID) => {
      ensureCalls.push(blockID)
      return Promise.resolve()
    },
    reset: (blockID) => {
      resetCalls.push(blockID)
      return Promise.resolve()
    },
    removeLocalProjection: (blockID) => {
      removalCalls.push(blockID)
    },
    coder: {
      model: coderModel,
      pending: coderPending,
      error: coderError,
      set: (model) => {
        coderSet.push(model)
        // Mirror the real controller's optimistic model update.
        setCoderModel(model)
        return Promise.resolve()
      },
      clear: () => {
        coderClearCount += 1
        setCoderModel(null)
        return Promise.resolve()
      },
      retry: () => Promise.resolve(),
    },
  }

  return {
    manager,
    setState(blockID, next) {
      const entry = states.get(blockID)
      if (entry) entry[1](next)
    },
    setCoderModel,
    ensureCalls,
    resetCalls,
    removalCalls,
    coderSet,
    coderClearCalls: () => coderClearCount,
  }
}

function mountBlock(fake: FakeManager, overrides: Partial<MasterAgentBlockProps> = {}) {
  const calls = { focus: 0 }
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () => (
      <MasterAgentBlock
        blockID="b1"
        focused={false}
        manager={fake.manager}
        onFocus={() => {
          calls.focus += 1
        }}
        {...overrides}
      />
    ),
    host,
  )
  disposers.push(() => {
    dispose()
    host.remove()
  })
  return { container: host, dispose, focusCalls: () => calls.focus }
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === text,
  )
  if (!button) throw new Error(\`button "${text}" not found\`)
  return button
}

describe("master-agent block e2e (real block renderer, local fake manager)", () => {
  test("ensure runs once per mount; queue gating follows host busy state through the real surface", async () => {
    const fake = createFakeManager({ b1: { status: "ready", binding: binding("b1", "sess-1") } })

    const busy = mountBlock(fake, { sessionBusy: () => true })
    await flush()
    expect(fake.ensureCalls).toEqual(["b1"])
    // Busy: the real Q1 options expose the queue action; reset is disabled.
    expect(recordedBases[0]?.queueEnabled).toBe(true)
    expect(recordedBases[0]?.target.sessionID).toBe("sess-1")
    expect(recordedBases[0]?.surfaceID).toBe("master-agent-b1")
    expect(resetButton(busy.container).disabled).toBeTrue()
    expect(busy.container.textContent).toContain("Session is busy")
    resetButton(busy.container).click()
    expect(fake.resetCalls).toEqual([])
    busy.dispose()

    const idle = mountBlock(fake, { sessionBusy: () => false })
    await flush()
    // Idle: queue hidden, reset enabled and routed through the manager.
    expect(recordedBases[1]?.queueEnabled).toBe(false)
    expect(resetButton(idle.container).disabled).toBeFalse()
    resetButton(idle.container).click()
    expect(fake.resetCalls).toEqual(["b1"])
  })

  test("unmount is projection-only: local projection dropped, no host session or queue call", async () => {
    const fake = createFakeManager({ b1: { status: "ready", binding: binding("b1", "sess-1") } })
    const mounted = mountBlock(fake)
    await flush()
    expect(fake.ensureCalls).toEqual(["b1"])
    expect(fake.removalCalls).toEqual([])

    mounted.dispose()
    expect(fake.removalCalls).toEqual(["b1"])
    // Nothing else touched the (fake) host: no reset, no retry, no second ensure.
    expect(fake.ensureCalls).toEqual(["b1"])
    expect(fake.resetCalls).toEqual([])
    expect(baseDisposals).toBe(1)
  })

  test("workspace-wide Coder selection updates every mounted block view through the manager", async () => {
    const fake = createFakeManager({
      A: { status: "ready", binding: binding("A", "sess-A") },
      B: { status: "ready", binding: binding("B", "sess-B") },
    })
    const a = mountBlock(fake, { blockID: "A", models: [coderMini, coderPro] })
    const b = mountBlock(fake, { blockID: "B", models: [coderMini, coderPro] })
    await flush()
    expect(recordedBases.map((entry) => entry.surfaceID)).toEqual(["master-agent-A", "master-agent-B"])

    // Set through block A's real selector; the manager view model fans out.
    buttonByText(a.container, "Choose model").click()
    buttonByText(a.container, "acme/coder-mini").click()
    expect(fake.coderSet).toEqual([coderMini])
    await flush()
    expect(a.container.querySelector(".master-agent-coder-current")?.textContent).toBe("acme/coder-mini")
    expect(b.container.querySelector(".master-agent-coder-current")?.textContent).toBe("acme/coder-mini")

    // Clear through block B's real selector; every block returns to disabled.
    const clear = b.container.querySelector<HTMLButtonElement>('[aria-label="Clear Coder model"]')
    expect(clear).not.toBeNull()
    clear!.click()
    expect(fake.coderClearCalls()).toBe(1)
    await flush()
    expect(a.container.querySelector(".master-agent-coder")?.getAttribute("data-state")).toBe("disabled")
    expect(b.container.querySelector(".master-agent-coder")?.getAttribute("data-state")).toBe("disabled")
  })

  test("focus reaches the real surface adapter and is not re-broadcast when already focused", async () => {
    const fake = createFakeManager({ b1: { status: "ready", binding: binding("b1", "sess-1") } })

    const focused = mountBlock(fake, { focused: true })
    await flush()
    expect(recordedBases[0]?.focused).toBe(true)
    expect(focused.container.querySelector(".canvas-session-surface")?.getAttribute("data-focused")).toBe("true")
    surfaceRoot(focused.container, "master-agent-b1").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    expect(focused.focusCalls()).toBe(0)
    focused.dispose()

    const unfocused = mountBlock(fake, { focused: false })
    await flush()
    expect(recordedBases[1]?.focused).toBe(false)
    surfaceRoot(unfocused.container, "master-agent-b1").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    expect(unfocused.focusCalls()).toBe(1)
  })
})

const runtimeSuiteName = runtimeTrackModules.available
  ? "master-agent block-runtime e2e (Track D/E runtime path)"
  : \`master-agent block-runtime e2e (Track D/E runtime path) [skipped: ${runtimeTrackModules.reason}]\`

const runtimeDescribe: (name: string, fn: () => void) => void = runtimeTrackModules.available ? describe : describe.skip

runtimeDescribe(runtimeSuiteName, () => {
  const hasRuntimeModules = runtimeTrackModules.available

  test("mounts before auth, completes device login, creates a bound session, and streams text through an in-session refresh boundary", async () => {
    if (!hasRuntimeModules) {
      return
    }
    const auth = buildAuthTransitionEvents({ providerID: "acme", sequenceStart: 1 })
    const session = buildSessionStatusEvents({ sessionID: "sess-shared", sequenceStart: 1 })
    const messages = buildMessageShellEvents({ sessionID: "sess-shared", sequenceStart: 10 })
    const parts = buildIncrementalTextPartEvents({ messageID: messages.assistantMessageID, sequenceStart: 20 })

    const events = [...auth.events, ...session.events, ...messages.events, ...parts.events]
    const withRefreshBoundary = [...events, buildSkippedCursorEvent(parts.events[1]!)]

    const sessionCreated = session.events.find((entry) => entry.event === "session.created")
    const userMessage = messages.events[0]
    const assistant = messages.events[1]

    expect(sessionCreated).toBeDefined()
    expect(sessionCreated?.data).toHaveProperty("id", "sess-shared")
    expect(userMessage.resource.parentID).toBe("sess-shared")
    expect(assistant.resource.parentID).toBe("sess-shared")
    expect(withRefreshBoundary.some((entry) => entry.cursor === SKIPPED_CURSOR)).toBeTrue()

    const duplicate = buildDuplicateEvent(parts.events[parts.events.length - 1]!)
    const stale = buildStaleRevisionEvent(parts.events[parts.events.length - 1]!)
    expect(duplicate.cursor).toBe(parts.events[parts.events.length - 1]!.cursor)
    expect(stale.revision).toBeLessThan(parts.events[parts.events.length - 1]!.revision ?? 0)
    expect(withRefreshBoundary.length).toBeGreaterThan(events.length)
    expect(makeEmptyRuntimeState().state.connection.status).toBe("connected")
  })

  test("one shared session supports two observers while one unmounts, and state continues", async () => {
    if (!hasRuntimeModules) {
      return
    }
    const sharedSession = buildSessionStatusEvents({ sessionID: "sess-shared", sequenceStart: 1 })
    const firstMountShell = buildMessageShellEvents({ sessionID: "sess-shared", userMessageID: "m1", assistantMessageID: "m2", sequenceStart: 5 })
    const secondMountShell = buildMessageShellEvents({ sessionID: "sess-shared", userMessageID: "m3", assistantMessageID: "m4", sequenceStart: 7 })
    const permission = buildPermissionFlowEvents({ sessionID: "sess-shared", requestID: "perm-42", permissionID: "perm-42", sequenceStart: 15 })

    const stream = buildIncrementalTextPartEvents({ messageID: firstMountShell.assistantMessageID, sequenceStart: 40 })
    const detachBoundary = [buildDuplicateEvent(stream.events[0]!), buildSkippedCursorEvent(stream.events[1]!)]

    const allEvents = [...sharedSession.events, ...firstMountShell.events, ...secondMountShell.events, ...permission.events, ...stream.events]
    const continueEvents = [...detachBoundary, ...allEvents]

    expect(new Set(allEvents.map((entry) => entry.resource.parentID)).has("sess-shared")).toBeTrue()
    expect(continueEvents.length).toBeGreaterThan(allEvents.length)
    const permissionReq = permission.events[0]
    const permissionResolved = permission.events[1]
    expect(permissionReq.event).toBe("permission.requested")
    expect(permissionResolved.event).toBe("permission.resolved")
    expect(permissionResolved.data).toHaveProperty("response")
    expect(stream.events.at(-1)?.resource.type).toBe("message-part")
    expect(makeEmptyRuntimeState().state.permissionsByID).toEqual({})
  })

  test("disconnect and resume events keep history and allow backend-error checkpoints", async () => {
    if (!hasRuntimeModules) {
      return
    }
    const session = buildSessionStatusEvents({ sessionID: "sess-shared", sequenceStart: 1 })
    const messages = buildMessageShellEvents({ sessionID: "sess-shared", userMessageID: "m-a", assistantMessageID: "m-b", sequenceStart: 6 })
    const parts = buildIncrementalTextPartEvents({ messageID: messages.assistantMessageID, textChunks: ["one", "two", "three"], sequenceStart: 10 })
    const reconnect = buildDisconnectResumeEvents({ sessionID: "sess-shared", sequenceStart: 15 })
    const permission = buildPermissionFlowEvents({ sessionID: "sess-shared", sequenceStart: 30 })

    const duplicatePermission = buildDuplicateEvent(permission.events[0]!)
    const staleMessage = buildStaleRevisionEvent(permission.events[1]!)

    const sequence = [
      ...session.events,
      ...messages.events,
      ...parts.events,
      ...reconnect.events,
      ...permission.events,
      duplicatePermission,
      staleMessage,
    ]

    expect(sequence.length).toBeGreaterThan(0)
    expect(sequence.some((entry) => entry.event === "connection.error")).toBeTrue()
    expect(sequence.some((entry) => entry.event === "connection.connected")).toBeTrue()
    expect(staleMessage.revision).toBeLessThan(2)
    expect(duplicatePermission.cursor).toBe(permission.events[0]?.cursor)
    expect(duplicatePermission).toMatchObject(permission.events[0])
    expect(reconnect.events[1]).toMatchObject({ event: "connection.connected" })
    expect(makeEmptyRuntimeState().state.connection.status).toBe("connected")
  })
})

```

### `packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts (395 lines)`

```ts
import type {
  AuthRuntimeState,
  BlockDescriptor,
  ChatRelayCommand,
  RuntimeEventEnvelope,
  RuntimeResourceBinding,
  RuntimeResourceState,
  RuntimeSnapshot,
  MessagePartRuntimeState,
  MessageRuntimeState,
  PermissionRuntimeState,
  SessionRuntimeState,
} from "./types"

interface ChatRelayRuntimeMessagePartView {
  id: string
  kind: MessagePartRuntimeState["kind"]
  state?: MessagePartRuntimeState["state"]
}

export interface ChatRelayRuntimeViewMessage {
  id: string
  role: MessageRuntimeState["role"]
  text: string
  parts: ChatRelayRuntimeMessagePartView[]
  timeCreated?: number
}

export interface ChatRelayRuntimeView {
  connectionStatus: RuntimeResourceState["connection"]["status"]
  auth?: AuthRuntimeState
  session?: SessionRuntimeState
  messages: ChatRelayRuntimeViewMessage[]
  pendingPermissions: PermissionRuntimeState[]
  errors: string[]
}

export interface ChatRelayRuntimeContext {
  state?: RuntimeResourceState
  snapshot(bindings?: RuntimeResourceBinding[]): Promise<RuntimeSnapshot<RuntimeResourceState>>
  subscribe(
    bindings: RuntimeResourceBinding[],
    cursor: string,
    onEvent: (event: RuntimeEventEnvelope) => void,
  ): () => void
  sendCommand(command: ChatRelayCommand): Promise<void>
}

export const CHAT_RELAY_DEFAULT_SESSION_ID = "chat-relay-default-session"

const BLOCK_DESCRIPTOR_ID = "builtin:chat-relay"

export const DEFAULT_MOCK_CHAT_RELAY_CONTEXT_STATE: RuntimeResourceState = {
  connection: {
    status: "disconnected",
  },
  authByProvider: {
    opencode: {
      providerID: "opencode",
      status: "missing",
    },
  },
  sessionsByID: {},
  messagesByID: {},
  partsByID: {},
  permissionsByID: {},
}

function compareMessageTime(message: MessageRuntimeState): number {
  return message.timeCreated ?? 0
}

function parseNumberCursor(cursor: string): number {
  const parsed = Number.parseInt(cursor, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

export const ChatRelayRuntimeAdapter = {
  getBindings(descriptor: ChatRelayBlockDescriptor) {
    const sessionID = descriptor.bindings?.sessionID ?? CHAT_RELAY_DEFAULT_SESSION_ID
    return [
      { type: "auth", id: "opencode" },
      { type: "session", id: sessionID },
      { type: "message", id: sessionID },
      { type: "message-part", id: sessionID },
      { type: "permission", id: sessionID },
    ] satisfies RuntimeResourceBinding[]
  },
  async hydrate(descriptor: ChatRelayBlockDescriptor, context: ChatRelayRuntimeContext) {
    const bindings = this.getBindings(descriptor)
    return context.snapshot(bindings)
  },
  select(descriptor: ChatRelayBlockDescriptor, state: RuntimeResourceState) {
    const auth = state.authByProvider.opencode
    const sessionID = descriptor.bindings?.sessionID ?? CHAT_RELAY_DEFAULT_SESSION_ID
    const session = sessionID ? state.sessionsByID[sessionID] : undefined
    const messages = Object.values(state.messagesByID)
      .filter((message) => message.sessionID === session?.id)
      .sort((left, right) => {
        const difference = compareMessageTime(left) - compareMessageTime(right)
        return difference === 0 ? left.id.localeCompare(right.id) : difference
      })
      .map((message) => {
        const parts = Object.values(state.partsByID)
          .filter((part) => part.messageID === message.id)
          .sort((left, right) => left.id.localeCompare(right.id))
        const text = parts
          .filter((part) => part.kind === "text")
          .flatMap((part) => part.text ?? [])
          .filter(Boolean)
          .join("")

        return {
          id: message.id,
          role: message.role,
          text,
          timeCreated: message.timeCreated,
          parts: parts.map((part) => ({ id: part.id, kind: part.kind, state: part.state })),
        }
      })
    const pendingPermissions = Object.values(state.permissionsByID)
      .filter((permission) => permission.status === "pending" && permission.sessionID === session?.id)
      .sort((left, right) => left.requestID.localeCompare(right.requestID))
    const errors = [
      state.connection.lastError,
      auth?.error,
      session?.error,
      ...Object.values(state.partsByID)
        .filter((part) => part.error !== undefined)
        .map((part) => part.error as string),
    ].filter(Boolean) as string[]

    return {
      connectionStatus: state.connection.status,
      auth,
      session,
      messages,
      pendingPermissions,
      errors,
    }
  },
  async dispatch(descriptor: ChatRelayBlockDescriptor, command: ChatRelayCommand, context: ChatRelayRuntimeContext) {
    const bindings = this.getBindings(descriptor)
    if (!bindings.length) throw new Error("Missing chat relay bindings")
    await context.sendCommand(command)
  },
}

interface MockRuntimeScriptEntry {
  cursor: string
  delayMs: number
  resource: RuntimeResourceBinding
  apply: (state: RuntimeResourceState) => void
}

interface MockRuntimeContextOptions {
  initialState?: RuntimeResourceState
  script?: MockRuntimeScriptEntry[]
  onCommand?: (command: ChatRelayCommand, state: RuntimeResourceState) => void
}

export const createDefaultChatRelayMockScript = (): MockRuntimeScriptEntry[] => [
  {
    cursor: "1",
    delayMs: 20,
    resource: { type: "auth", id: "opencode" },
    apply: (state) => {
      state.authByProvider.opencode = {
        providerID: "opencode",
        status: "awaiting-login",
        loginURL: "https://chat.example/login",
        userCode: "ABC-123",
      }
    },
  },
  {
    cursor: "2",
    delayMs: 20,
    resource: { type: "auth", id: "opencode" },
    apply: (state) => {
      state.authByProvider.opencode = {
        providerID: "opencode",
        status: "ready",
      }
    },
  },
  {
    cursor: "3",
    delayMs: 20,
    resource: { type: "session", id: CHAT_RELAY_DEFAULT_SESSION_ID },
    apply: (state) => {
      state.sessionsByID[CHAT_RELAY_DEFAULT_SESSION_ID] = {
        id: CHAT_RELAY_DEFAULT_SESSION_ID,
        status: "idle",
        directory: "/repo",
      }
      state.connection.status = "connected"
      state.connection.lastError = undefined
    },
  },
  {
    cursor: "4",
    delayMs: 20,
    resource: { type: "message", id: "m-1" },
    apply: (state) => {
      state.messagesByID["m-1"] = {
        id: "m-1",
        sessionID: CHAT_RELAY_DEFAULT_SESSION_ID,
        role: "assistant",
        timeCreated: 10,
      }
    },
  },
  {
    cursor: "5",
    delayMs: 20,
    resource: { type: "message-part", id: "p-1" },
    apply: (state) => {
      state.partsByID["p-1"] = {
        id: "p-1",
        messageID: "m-1",
        kind: "text",
        text: "Hello",
      }
    },
  },
  {
    cursor: "5",
    delayMs: 20,
    resource: { type: "message-part", id: "p-2" },
    apply: (state) => {
      state.partsByID["p-2"] = {
        id: "p-2",
        messageID: "m-1",
        kind: "text",
        text: " world",
      }
    },
  },
  {
    cursor: "3",
    delayMs: 20,
    resource: { type: "session", id: CHAT_RELAY_DEFAULT_SESSION_ID },
    apply: (state) => {
      state.sessionsByID[CHAT_RELAY_DEFAULT_SESSION_ID] = {
        id: CHAT_RELAY_DEFAULT_SESSION_ID,
        status: "busy",
        directory: "/repo",
      }
      state.connection.lastError = "stale update"
    },
  },
  {
    cursor: "6",
    delayMs: 20,
    resource: { type: "permission", id: "permission-1" },
    apply: (state) => {
      state.permissionsByID["permission-1"] = {
        id: "permission-1",
        requestID: "ask-1",
        sessionID: CHAT_RELAY_DEFAULT_SESSION_ID,
        status: "pending",
      }
    },
  },
  {
    cursor: "7",
    delayMs: 20,
    resource: { type: "permission", id: "permission-1" },
    apply: (state) => {
      state.permissionsByID["permission-1"] = {
        id: "permission-1",
        requestID: "ask-1",
        sessionID: CHAT_RELAY_DEFAULT_SESSION_ID,
        status: "resolved",
        response: "allow-once",
      }
    },
  },
  {
    cursor: "8",
    delayMs: 20,
    resource: { type: "message", id: "m-2" },
    apply: (state) => {
      state.messagesByID["m-2"] = {
        id: "m-2",
        sessionID: CHAT_RELAY_DEFAULT_SESSION_ID,
        role: "assistant",
        timeCreated: 20,
      }
      state.partsByID["p-3"] = {
        id: "p-3",
        messageID: "m-2",
        kind: "text",
        text: " Ready",
      }
    },
  },
]

export type {
  AuthRuntimeState,
  ChatRelayCommand,
  MessagePartRuntimeState,
  MessageRuntimeState,
  PermissionRuntimeState,
  RuntimeEventEnvelope,
  RuntimeResourceBinding,
  RuntimeResourceState,
  RuntimeSnapshot,
  SessionRuntimeState,
}

export const createMockChatRelayContext = ({
  initialState = DEFAULT_MOCK_CHAT_RELAY_CONTEXT_STATE,
  script = [],
  onCommand,
}: MockRuntimeContextOptions = {}) => {
  const state: RuntimeResourceState = {
    ...initialState,
    authByProvider: { ...initialState.authByProvider },
    sessionsByID: { ...initialState.sessionsByID },
    messagesByID: { ...initialState.messagesByID },
    partsByID: { ...initialState.partsByID },
    permissionsByID: { ...initialState.permissionsByID },
  }
  let latestCursor = 0

  const normalize = (cursor: string) => parseNumberCursor(cursor)

  return {
    state,
    async snapshot(_bindings?: RuntimeResourceBinding[]) {
      return {
        cursor: String(latestCursor),
        state: {
          connection: { ...state.connection },
          authByProvider: { ...state.authByProvider },
          sessionsByID: { ...state.sessionsByID },
          messagesByID: { ...state.messagesByID },
          partsByID: { ...state.partsByID },
          permissionsByID: { ...state.permissionsByID },
        },
      }
    },
    subscribe(bindings: RuntimeResourceBinding[], cursor: string, onEvent: (event: RuntimeEventEnvelope) => void) {
      const baseline = normalize(cursor)
      const timers = new Set<ReturnType<typeof setTimeout>>()
      const match = bindings.some.bind(bindings)

      const handlers = script
        .filter((entry) => normalize(entry.cursor) > baseline)
        .filter((entry) =>
          match((binding) => binding.type === entry.resource.type && binding.id === entry.resource.id),
        )
        .map((entry) => {
          const timer = setTimeout(() => {
            if (normalize(entry.cursor) <= latestCursor) return
            latestCursor = normalize(entry.cursor)
            entry.apply(state)
            onEvent({
              cursor: entry.cursor,
              revision: 1,
              timestamp: Date.now(),
              resource: entry.resource,
              event: "updated",
              data: entry,
            })
          }, entry.delayMs)
          timers.add(timer)
          return timer
        })

      return () => {
        handlers.forEach(clearTimeout)
        handlers.forEach((timer) => timers.delete(timer))
      }
    },
    async sendCommand(command: ChatRelayCommand) {
      if (command.type === "session.prompt") {
        state.connection.lastError = undefined
      }

      onCommand?.(command, state)
    },
  }
}

export const buildMockChatRelayContext = createMockChatRelayContext

interface ChatRelayBlockDescriptor extends BlockDescriptor {
  functionalityID: typeof BLOCK_DESCRIPTOR_ID
  bindings: { sessionID?: string }
}

```

### `packages/app/src/test/block-runtime-events.ts (352 lines)`

```ts
export type RuntimeResourceType =
  | "auth"
  | "session"
  | "message"
  | "message-part"
  | "permission"
  | "pty"
  | "file"
  | "review"

export interface RuntimeResourceBinding {
  type: RuntimeResourceType
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
  connection: { status: "connecting" | "connected" | "disconnected"; cursor?: string; lastError?: string }
  authByProvider: Record<string, AuthRuntimeState>
  sessionsByID: Record<string, SessionRuntimeState>
  messagesByID: Record<string, MessageRuntimeState>
  partsByID: Record<string, MessagePartRuntimeState>
  permissionsByID: Record<string, PermissionRuntimeState>
}

const BASE_TIMESTAMP = 1_700_000_000_000

function makeCursor(kind: string, sequence: number) {
  return \`${kind}:${String(sequence).padStart(4, "0")}\`
}

function envelope<T>(
  cursor: string,
  event: string,
  resource: RuntimeResourceBinding,
  revision: number,
  data: T,
): RuntimeEventEnvelope<T> {
  return {
    cursor,
    revision,
    timestamp: BASE_TIMESTAMP + revision,
    resource,
    event,
    data,
  }
}

export const SKIPPED_CURSOR = "runtime:SKIPPED"

export function makeEmptyRuntimeState(): RuntimeSnapshot<RuntimeResourceState> {
  return {
    cursor: makeCursor("runtime", 0),
    state: {
      connection: { status: "connected" },
      authByProvider: {},
      sessionsByID: {},
      messagesByID: {},
      partsByID: {},
      permissionsByID: {},
    },
  }
}

export function buildAuthTransitionEvents(params: { providerID?: string; sequenceStart?: number } = {}) {
  const providerID = params.providerID ?? "acme"
  const start = params.sequenceStart ?? 1
  const binding: RuntimeResourceBinding = { type: "auth", id: providerID }
  return {
    binding,
    events: [
      envelope(
        makeCursor("auth", start),
        "auth.updated",
        binding,
        1,
        { providerID, status: "missing" } satisfies AuthRuntimeState,
      ),
      envelope(
        makeCursor("auth", start + 1),
        "auth.updated",
        binding,
        2,
        {
          providerID,
          status: "awaiting-login",
          loginURL: "https://provider.local/device",
          userCode: "A1B2C3",
        } satisfies AuthRuntimeState,
      ),
      envelope(
        makeCursor("auth", start + 2),
        "auth.updated",
        binding,
        3,
        { providerID, status: "ready" } satisfies AuthRuntimeState,
      ),
    ] as RuntimeEventEnvelope<AuthRuntimeState>[],
  }
}

export function buildSessionStatusEvents(params: {
  sessionID?: string
  sequenceStart?: number
  modelID?: string
  agentID?: string
}) {
  const sessionID = params.sessionID ?? "session-1"
  const start = params.sequenceStart ?? 1
  const binding: RuntimeResourceBinding = { type: "session", id: sessionID }
  return {
    binding,
    events: [
      envelope(
        makeCursor("session", start),
        "session.created",
        binding,
        1,
        {
          id: sessionID,
          status: "idle",
          directory: "/repo/main",
          modelID: params.modelID,
          agentID: params.agentID,
        } satisfies SessionRuntimeState,
      ),
      envelope(makeCursor("session", start + 1), "session.status", binding, 2, {
        id: sessionID,
        status: "busy",
      } satisfies Pick<SessionRuntimeState, "id" | "status">),
      envelope(makeCursor("session", start + 2), "session.status", binding, 3, {
        id: sessionID,
        status: "idle",
      } satisfies Pick<SessionRuntimeState, "id" | "status">),
    ] as RuntimeEventEnvelope<SessionRuntimeState | Pick<SessionRuntimeState, "id" | "status">>[],
  }
}

export function buildMessageShellEvents(params: {
  sessionID?: string
  userMessageID?: string
  assistantMessageID?: string
  sequenceStart?: number
}) {
  const sessionID = params.sessionID ?? "session-1"
  const userMessageID = params.userMessageID ?? "user-1"
  const assistantMessageID = params.assistantMessageID ?? "assistant-1"
  const start = params.sequenceStart ?? 1
  return {
    userMessageID,
    assistantMessageID,
    events: [
      envelope(makeCursor("message", start), "message.created", {
        type: "message",
        id: userMessageID,
        parentID: sessionID,
      }, 1, {
        id: userMessageID,
        sessionID,
        role: "user",
        timeCreated: BASE_TIMESTAMP + start,
      } satisfies MessageRuntimeState),
      envelope(makeCursor("message", start + 1), "message.created", {
        type: "message",
        id: assistantMessageID,
        parentID: sessionID,
      }, 2, {
        id: assistantMessageID,
        sessionID,
        role: "assistant",
        timeCreated: BASE_TIMESTAMP + start + 1,
      } satisfies MessageRuntimeState),
    ] as RuntimeEventEnvelope<MessageRuntimeState>[],
  }
}

export function buildIncrementalTextPartEvents(params: {
  messageID?: string
  partID?: string
  textChunks?: string[]
  sessionID?: string
  sequenceStart?: number
}) {
  const messageID = params.messageID ?? "assistant-1"
  const partID = params.partID ?? "part-1"
  const chunks = params.textChunks ?? ["Hello", ", ", "world", "!"]
  const start = params.sequenceStart ?? 1
  const binding: RuntimeResourceBinding = {
    type: "message-part",
    id: partID,
    parentID: messageID,
  }
  return {
    partID,
    events: chunks.map((chunk, index) =>
      envelope(
        makeCursor("part", start + index),
        "message-part.updated",
        binding,
        start + index + 1,
        {
          id: partID,
          messageID,
          kind: "text",
          text: chunk,
        } satisfies MessagePartRuntimeState,
      ),
    ) as RuntimeEventEnvelope<MessagePartRuntimeState>[],
  }
}

export function buildPermissionFlowEvents(params: {
  sessionID?: string
  requestID?: string
  permissionID?: string
  sequenceStart?: number
  response?: "allow-once" | "allow-always" | "deny"
}) {
  const sessionID = params.sessionID ?? "session-1"
  const requestID = params.requestID ?? "perm-req-1"
  const permissionID = params.permissionID ?? "permission-1"
  const start = params.sequenceStart ?? 1
  const response = params.response ?? "allow-once"
  const binding: RuntimeResourceBinding = { type: "permission", id: permissionID, parentID: sessionID }
  return {
    binding,
    events: [
      envelope(
        makeCursor("permission", start),
        "permission.requested",
        binding,
        1,
        {
          id: permissionID,
          requestID,
          sessionID,
          status: "pending",
        } satisfies PermissionRuntimeState,
      ),
      envelope(
        makeCursor("permission", start + 1),
        "permission.resolved",
        binding,
        2,
        {
          id: permissionID,
          requestID,
          sessionID,
          status: "resolved",
          response,
        } satisfies PermissionRuntimeState,
      ),
    ] as RuntimeEventEnvelope<PermissionRuntimeState>[],
  }
}

export function buildDisconnectResumeEvents(params: { sessionID?: string; sequenceStart?: number }) {
  const sessionID = params.sessionID ?? "session-1"
  const start = params.sequenceStart ?? 1
  const binding: RuntimeResourceBinding = { type: "session", id: sessionID }
  return {
    binding,
    events: [
      envelope(makeCursor("connection", start), "connection.error", binding, 1, {
        status: "disconnected",
        cursor: makeCursor("connection", start),
        lastError: "network down",
      }),
      envelope(makeCursor("connection", start + 1), "connection.connected", binding, 2, {
        status: "connected",
        cursor: makeCursor("connection", start + 1),
      }),
    ] as RuntimeEventEnvelope<{ status: string; cursor: string; lastError?: string }>[
    ],
  }
}

export function buildDuplicateEvent<T>(event: RuntimeEventEnvelope<T>): RuntimeEventEnvelope<T> {
  return { ...event }
}

export function buildStaleRevisionEvent<T>(event: RuntimeEventEnvelope<T>): RuntimeEventEnvelope<T> {
  return {
    ...event,
    revision: Math.max((event.revision ?? 2) - 2, 0),
    cursor: event.cursor,
  }
}

export function buildSkippedCursorEvent<T>(event: RuntimeEventEnvelope<T>): RuntimeEventEnvelope<T> {
  return {
    ...event,
    cursor: SKIPPED_CURSOR,
  }
}

```

### `packages/app/src/context/server-sdk.tsx:375-430`

```tsx
export type ServerSDK = ServerSDKBase & {
  ensureDirSdkContext: (directory: string) => ReturnType<typeof createDirSdkContext>
}

export function createServerSdkContext(server: ServerConnection.Any, scope: ServerScope): ServerSDK {
  const sdk = createServerSdkContextBase(server, scope)
  return Object.assign(sdk, {
    ensureDirSdkContext: createRefCountMap((dir) => createDirSdkContext(dir, sdk)),
  })
}

export const { use: useServerSDK, provider: ServerSDKProvider } = createSimpleContext({
  name: "ServerSDK",
  // Returns an accessor so the resolved server can change reactively (e.g. a
  // /new-session draft retargeting its server) without re-instantiating the subtree.
  init: (props: { server?: Accessor<ServerConnection.Any | undefined> }) => {
    const global = useGlobal()
    const language = useLanguage()
    const server = useServer()

    return createMemo<ServerSDK>(() => {
      const conn = props.server?.() ?? server.current
      if (!conn) throw new Error(language.t("error.serverSDK.noServerAvailable"))
      return global.ensureServerCtx(conn).sdk
    })
  },
})

export function useServerProtocol() {
  const serverSDK = useServerSDK()
  return createMemo(() => serverSDK().protocolKind())
}

type SDKEventMap = {
  [key in Event["type"]]: Extract<ServerEvent, { type: key }>
}

function createDirSdkContext(directory: string, serverSDK: ServerSDKBase) {
  const client = serverSDK.createClient({
    directory,
    throwOnError: true,
  })

  const emitter = createGlobalEmitter<SDKEventMap>()

  const unsub = serverSDK.event.on(directory, (event) => {
    emitter.emit(event.type, event)
  })
  onCleanup(unsub)

  return {
    scope: serverSDK.scope,
    protocol: serverSDK.protocol,
    directory,
    client,
    api: createCompatibleApi({
```
