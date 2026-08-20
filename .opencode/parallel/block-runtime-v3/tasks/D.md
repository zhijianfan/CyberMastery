You are worker 4 of 7 (Wave 1) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task D — Generic BlockRuntimeHost and canvas state separation

Goal: every canvas block renders through ONE generic host; layout application
can never overwrite runtime or local view state; the descriptor cache carries
identity/functionality/transform ONLY.

## Target state

```ts
interface CanvasBlockDescriptor {
  id: string
  functionalityID: string
  transform: { x: number; y: number; w: number; h: number; z: number }
}
interface CanvasViewState {
  collapsed?: boolean
  defaultRect?: boolean
  selectedTab?: string
  // no domain data or host binding
}
```

A separate `BlockLocalViewStore` holds functionality-specific device-local data,
keyed by workspace-local key + block ID, persisted under
`opencode.canvas.local-view.v1` (NOT the layout cache).

## Required work

1. `packages/app/src/pages/canvas/runtime/local-view-store.ts` (NEW):
   `createBlockLocalViewStore()` — per-block read/write/delete, persisted to
   localStorage key `opencode.canvas.local-view.v1`, debounced writes, JSON.
2. `packages/app/src/pages/canvas/runtime/block-runtime-host.tsx` (NEW):
   `<BlockRuntimeHost block={descriptor} registration={...} children/services ...>`
   — resolves the registration's `resolve()`, drives handle lifecycle
   (status/view/error/refresh/dispatch/dispose), keys by
   `workspaceEpoch + workspaceID + blockID + functionalityID`; on block removal
   dispose the runtime handle ONLY (never cancel host work); wraps its children
   with the handle context (Solid createSimpleContext from
   `@opencode-ai/ui/context`, pattern shown in inlined `server-sdk.tsx`).
3. `packages/app/src/pages/canvas/runtime/provider.tsx` (NEW):
   `<BlockRuntimeProvider>` — owns ONE event router (C's createBlockRuntimeEventRouter)
   + the registry (C's) + the local view store + workspace services (id/epoch/
   connected/awaitDescriptorPersisted wired from manager + canvas), provided via
   context; lifetime follows canvas mount; dispose cleans router/registry.
4. Rewrite `packages/app/src/pages/canvas/workspace.tsx` (you own the whole
   file; its FULL current content is inlined below):
   - Split `CanvasBlock` into `CanvasBlockDescriptor` + view-state maps; remove
     `bindings`, `messages`, `history`, `layers`, `text`, `listening`,
     `agentKey` from the descriptor record. Compatibility accessors may
     temporarily read Wave-2 stores (read the local-view store), but layout
     functions may not see them.
   - `toRecords()` continues to send functionality + transform only (unchanged).
   - `toPersistedBlock()` persists descriptor + allowed view state ONLY — no
     `bindings`; the serialized JSON must contain no `sessionID` substring
     (assert in tests).
   - `applyServerLayout()` replaces descriptor transforms only; REMOVE
     `mergeServerRuntime()` and any runtime-state merge.
   - `load()` migrates legacy persisted blocks: descriptor fields → descriptor
     cache; `text`/`listening`/`layers`/`history` → local-view store (one-time
     migration); `bindings` dropped.
   - Replace the block render switch: every block (including legacy operating-chat)
     renders through `<BlockRuntimeHost>` with a per-functionality renderer module
     map. Keep a COMPATIBILITY map so Wave-2 modules (H–K) can land independently:
     for chat-relay/master-agent keep rendering the existing `ChatRelayBody`/
     `MasterAgentBlock` components inside the host wrapper for now; for
     operating-chat/context/tools/files/notes/voice keep the existing in-file
     body components in the map, marked as compatibility entries that H–K will
     replace. The compatibility map must live in a NEW file
     `packages/app/src/pages/canvas/runtime/compat-renderers.tsx` exporting
     `compatRendererFor(functionalityID)`.
   - REMOVE the ChatRelay-specific global bootstrap call
     (`enableChatRelayBlockRuntime` import + `VITE_CYBERMASTER_BLOCK_RUNTIME_V2`
     gate + the onMount block referencing them) from the canvas.
   - `BlockRuntimeHost` key includes the workspace epoch (manager.workspaceEpoch()).
   - On block removal, dispose the runtime handle only.
   - Keep `CanvasSessionSurfaceProviders` usage for the chat-relay/master-agent
     compatibility bodies exactly as it is today.
   - `awaitDescriptorPersisted(blockID, signal)`: expose from the canvas/managers
     boundary — resolves after the current layout revision on the server includes
     the block (manager has `revision()` + `dirty()`; implement as: if the block
     is in the server-adopted layout records already, resolve; else wait for the
     next successful sync/push via a one-shot promise the canvas resolves on
     layout save success; AbortSignal-aware; never resolve from localStorage
     alone).
5. Do NOT edit `manager.ts` (E owns it). Read the workspace hooks the manager
   exposes from the inlined excerpt and wire via props/context only. If a
   needed manager field is missing, implement `awaitDescriptorPersisted` in the
   canvas using existing manager fields and document the seam in HANDOFF-D.

## Acceptance criteria

- Replacing a server layout while a native session is streaming does NOT remount
  or reset its session store unless block identity/functionality changes.
- Layout/local cache contains no binding or session ID (localStorage assertions).
- All block types render through `BlockRuntimeHost`, including local/static.
- A block can move/resize without any runtime refresh.
- A block functionality replacement disposes the old adapter and resolves the new one.
- HMR/unmount cleans provider/router subscriptions.

## Owned files (edit ONLY these)

- `packages/app/src/pages/canvas/workspace.tsx`
- `packages/app/src/pages/canvas/runtime/local-view-store.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/block-runtime-host.tsx` (NEW)
- `packages/app/src/pages/canvas/runtime/provider.tsx` (NEW)
- `packages/app/src/pages/canvas/runtime/compat-renderers.tsx` (NEW)
- tests for the above (new files beside them)
- `packages/app/src/pages/canvas/runtime/HANDOFF-D.md`

Do NOT edit `manager.ts`, ChatRelay dir, MasterAgent dir, runtime core files
owned by A/C, or backend.

## Targeted validation (allowed)

- `cd packages/app && bun test --conditions=browser --preload ./happydom.ts <your new test files>`
- `bun run typecheck` from `packages/app`

## Handoff

`HANDOFF-D.md`: exact props contract H–K must export for their registered
renderer modules · the compat-renderers map API · where awaitDescriptorPersisted
lives and its contract · manager fields you consumed · tests + results ·
integration actions M must take · prohibited-pattern grep result.



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


### `packages/app/src/pages/canvas/workspace.tsx (2272 lines)`

```tsx
import "./canvas.css"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { makeResizeObserver } from "@solid-primitives/resize-observer"
import { useTheme } from "@opencode-ai/ui/theme/context"
import type {
  PermissionConfig,
  WorkspaceBlockRecord,
  WorkspaceLayoutInfo,
} from "@opencode-ai/sdk/v2/client"
import { DebugBar } from "@/components/debug-bar"
import { useLayout } from "@/context/layout"
import { useServerSDK } from "@/context/server-sdk"
import { useProviders } from "@/hooks/use-providers"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  onCleanup,
  onMount,
  Show,
  type JSX,
  type ParentProps,
} from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import { Portal } from "solid-js/web"
import { createCanvasManager } from "./manager"
import { MasterAgentBlock } from "./master-agent/block"
import { MASTER_AGENT_FUNCTIONALITY_BY_TYPE, MASTER_AGENT_MODULE } from "./master-agent/functionality"
import { ChatRelayBody, iconClose, iconRelay, iconSpin } from "./blocks/chat-relay"
import { permissionDenied } from "./permissions"
import { enableChatRelayBlockRuntime } from "./runtime/bootstrap"
import { CanvasSessionSurfaceProviders } from "./session-surface-providers"
import {
  clampCamera,
  panCameraFree,
  screenToWorld,
  zoomCamera,
  type Camera,
  type Point,
  type Size,
  WORLD_SIZE,
} from "./editor/camera"
import {
  DEFAULT_CELL,
  fitDefaultLayout,
  packedPanel,
  resizeBlock,
  snap,
  type GridConstraints,
  type GridRect,
} from "./editor/grid"
import {
  appendExchange,
  defaultOperatingLayers,
  OPERATING_CONTEXT_LIMIT,
  type OperatingExchange,
  type OperatingLayer,
} from "./editor/operating-context"

const STORAGE_KEY = "opencode-canvas-v1"
const LEGACY_BLOCK_ID = "canvas-legacy"

// Module-level listener registry: Vite HMR re-executes this module without
// disposing the previous instance's window listeners, which stacks them and
// makes every pointermove apply the pan/block delta N times (canvas moves
// faster than the cursor, gets laggy). Register the module dispose hook to
// clean up all tracked listeners on hot reload.
const moduleCleanups = new Set<() => void>()
function trackCleanup(cleanup: () => void) {
  moduleCleanups.add(cleanup)
}
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const cleanup of moduleCleanups) {
      try {
        cleanup()
      } catch {
        /* listener already removed */
      }
    }
    moduleCleanups.clear()
  })
}

const legacyConstraints: GridConstraints = { minW: 320, minH: 200, maxW: null, maxH: null, initialAspect: "free" }
const blockConstraints: GridConstraints = { minW: 248, minH: 124, maxW: 760, maxH: 760, initialAspect: "square" }

export type CanvasBlockType =
  | "context"
  | "tools"
  | "files"
  | "notes"
  | "voice"
  | "chat-relay"
  | "operating-chat"
  | "master-agent"

// Server-side functionality IDs (the workspace functionality registry is the
// authority). The legacy block is the spec's default agentic chat window, so
// it owns \`builtin:chat\`; the demo chat card was removed to avoid the
// collision. Every other block type maps 1:1 to a registered functionality.
// The master-agent mapping comes from the I1 descriptor so the renderer and
// the descriptor can never drift apart.
export const FUNCTIONALITY_BY_TYPE: Record<CanvasBlockType, string> = {
  ...MASTER_AGENT_FUNCTIONALITY_BY_TYPE,
  context: "builtin:context",
  tools: "builtin:tools",
  files: "builtin:files",
  notes: "builtin:notes",
  voice: "builtin:voice",
  "chat-relay": "builtin:chat-relay",
  "operating-chat": "builtin:operating-chat-session",
}

export const TYPE_BY_FUNCTIONALITY: Record<string, CanvasBlockType> = Object.fromEntries(
  Object.entries(FUNCTIONALITY_BY_TYPE).map(([type, functionality]) => [functionality, type as CanvasBlockType]),
)

interface CanvasMessage {
  role: "user" | "assistant"
  text: string
  files?: { name: string; url: string }[]
  payloadId?: string
  index?: number
  timeCreated?: number
  important?: boolean
}

interface CanvasBlock {
  id: string
  type: CanvasBlockType | "legacy"
  x: number
  y: number
  w: number
  h: number
  z: number
  collapsed: boolean
  defaultRect: boolean
  text: string
  listening: boolean
  messages: CanvasMessage[]
  agentKey: string
  layers: OperatingLayer[]
  history: OperatingExchange[]
  bindings?: Record<string, string | undefined>
}

interface BlockModule {
  title: string
  subtitle: string
  accent: string
  w: number
  h: number
  icon: () => JSX.Element
}

function uid() {
  return \`card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}\`
}

const iconChat = () => (
  <svg viewBox="0 0 24 24">
    <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.4-4.2A8 8 0 1 1 21 12Z" />
    <path d="M8 11h8M8 15h5" />
  </svg>
)
const iconContext = () => (
  <svg viewBox="0 0 24 24">
    <path d="M7 4h10l3 3v13H4V4h3Z" />
    <path d="M14 4v5h6M8 13h8M8 17h6" />
  </svg>
)
const iconTools = () => (
  <svg viewBox="0 0 24 24">
    <path d="m14.7 6.3 3-3a5 5 0 0 1-6.5 6.5l-7.6 7.6a2.1 2.1 0 0 0 3 3l7.6-7.6a5 5 0 0 1 6.5-6.5l-3 3-3-3Z" />
  </svg>
)
const iconFiles = () => (
  <svg viewBox="0 0 24 24">
    <path d="M3 6h7l2 2h9v11H3V6Z" />
  </svg>
)
const iconNotes = () => (
  <svg viewBox="0 0 24 24">
    <path d="M5 4h14v16H5z" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
)
const iconVoice = () => (
  <svg viewBox="0 0 24 24">
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
  </svg>
)
const iconOperating = () => (
  <svg viewBox="0 0 24 24">
    <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.4-4.2A8 8 0 1 1 21 12Z" />
    <circle cx="12" cy="12" r="2.4" />
    <path d="M12 5.5v2M12 16.5v2M5.5 12h2M16.5 12h2" />
  </svg>
)
const iconCollapse = () => (
  <svg viewBox="0 0 24 24">
    <path d="m7 10 5 5 5-5" />
  </svg>
)
const iconPin = () => (
  <svg viewBox="0 0 24 24">
    <path d="M12 17v5" />
    <path d="M5 17h14l-2.4-2.4V9.2a2 2 0 0 0-.6-1.4L14 5.8V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v1.8L8 7.8a2 2 0 0 0-.6 1.4v5.4L5 17Z" />
  </svg>
)
const iconSend = () => (
  <svg viewBox="0 0 24 24">
    <path d="m4 12 16-8-5 16-3-7-8-1Z" />
    <path d="m12 13 8-9" />
  </svg>
)
const iconSearch = () => (
  <svg viewBox="0 0 24 24">
    <circle cx="11" cy="11" r="6" />
    <path d="m16 16 4 4" />
  </svg>
)
const iconFolder = () => (
  <svg viewBox="0 0 24 24">
    <path d="M3 6h7l2 2h9v11H3V6Z" />
  </svg>
)
const iconFile = () => (
  <svg viewBox="0 0 24 24">
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v5h5" />
  </svg>
)
const iconCheck = () => (
  <svg viewBox="0 0 24 24">
    <path d="m6 12 4 4 8-9" />
  </svg>
)
const iconMic = () => (
  <svg viewBox="0 0 24 24">
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
  </svg>
)

const MODULES: Record<CanvasBlockType, BlockModule> = {
  context: {
    title: "Project Context",
    subtitle: "Design principles",
    accent: "var(--canvas-blue)",
    w: 344,
    h: 334,
    icon: iconContext,
  },
  tools: {
    title: "Tool Activity",
    subtitle: "Everything looks healthy",
    accent: "var(--canvas-mint)",
    w: 368,
    h: 300,
    icon: iconTools,
  },
  files: {
    title: "Workspace Files",
    subtitle: "agent-canvas / src",
    accent: "var(--canvas-yellow)",
    w: 320,
    h: 352,
    icon: iconFiles,
  },
  notes: {
    title: "Scratchpad",
    subtitle: "Private to this canvas",
    accent: "var(--canvas-peach)",
    w: 330,
    h: 270,
    icon: iconNotes,
  },
  voice: {
    title: "Voice Input",
    subtitle: "Browser microphone",
    accent: "var(--canvas-pink)",
    w: 286,
    h: 300,
    icon: iconVoice,
  },
  "chat-relay": {
    title: "ChatRelay",
    subtitle: "Relayed to the chat account",
    accent: "var(--canvas-green)",
    w: 380,
    h: 440,
    icon: iconRelay,
  },
  "operating-chat": {
    title: "Operating Chat Session",
    subtitle: "OperatingAgent · context stack",
    accent: "var(--canvas-blue)",
    w: 420,
    h: 460,
    icon: iconOperating,
  },
  // The MasterAgent block owns its chrome (shell, session surface, Coder
  // selector) inside B3's renderer; the canvas only supplies presentation
  // metadata from the I1 descriptor.
  "master-agent": {
    ...MASTER_AGENT_MODULE,
  },
}

const LEGACY_MODULE: BlockModule = {
  title: "OpenCode",
  subtitle: "Legacy interface · pinned",
  accent: "var(--canvas-purple)",
  w: 0,
  h: 0,
  icon: iconChat,
}

interface CanvasState {
  camera: Camera
  editing: boolean
  selectedId: string | null
  zCounter: number
  blocks: CanvasBlock[]
}

interface PersistedState {
  camera: Camera
  editing: boolean
  blocks: PersistedCanvasBlock[]
}

interface PersistedCanvasBlock {
  id: string
  type: CanvasBlockType | "legacy"
  x: number
  y: number
  w: number
  h: number
  z: number
  collapsed?: boolean
  bindings?: Record<string, string | undefined>
}

function defaultCamera(): Camera {
  return { x: 0, y: 0, scale: 1 }
}

function legacyBlock(panel: Size): CanvasBlock {
  const rect = fitDefaultLayout({ w: panel.w, h: panel.h }, legacyConstraints)
  return {
    id: LEGACY_BLOCK_ID,
    type: "legacy",
    ...rect,
    z: 0,
    collapsed: false,
    defaultRect: true,
    text: "",
    listening: false,
    messages: [],
    agentKey: "inherit",
    layers: defaultOperatingLayers(),
    history: [],
  }
}

function blockOf(type: CanvasBlockType, x: number, y: number, z: number): CanvasBlock {
  const module = MODULES[type]
  return {
    id: uid(),
    type,
    x: Math.round(snap(x, DEFAULT_CELL)),
    y: Math.round(snap(y, DEFAULT_CELL)),
    w: module.w,
    h: module.h,
    z,
    collapsed: false,
    defaultRect: false,
    text: "",
    listening: false,
    messages: [],
    agentKey: "inherit",
    layers: defaultOperatingLayers(),
    history: [],
  }
}

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || element.isContentEditable
}

type Interaction =
  | { type: "move"; pointerId: number; start: Point; rect: GridRect; blockId: string; legacy: boolean }
  | { type: "resize"; pointerId: number; start: Point; rect: GridRect; blockId: string; legacy: boolean }

function pointerDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function worldClamp(rect: GridRect): GridRect {
  const w = Math.min(rect.w, WORLD_SIZE.w)
  const h = Math.min(rect.h, WORLD_SIZE.h)
  const x = Math.min(Math.max(rect.x, 0), WORLD_SIZE.w - w)
  const y = Math.min(Math.max(rect.y, 0), WORLD_SIZE.h - h)
  return { x, y, w, h, z: rect.z }
}

// The camera stored in Solid state is a LIVE store proxy: setState("camera",
// next) shallow-merges into the same object, so any reference captured from
// state.camera keeps reading the latest values. Gesture bases MUST be plain
// frozen snapshots, otherwise each pan move integrates the displacement
// (Cᵢ = Cᵢ₋₁ + Dᵢ) instead of applying it to the gesture-start camera.
function snapshotCamera(camera: Camera): Camera {
  return Object.freeze({ x: camera.x, y: camera.y, scale: camera.scale })
}

// Continuous (unsnapped) clamping for live drags: the block follows the
// cursor 1:1; snapping to the grid happens once on release.
function clampMoveContinuous(rect: GridRect, delta: { dx: number; dy: number }, panel: Size): GridRect {
  const area = packedPanel(panel)
  const x = Math.min(Math.max(rect.x + delta.dx, area.x), Math.max(area.x, area.x + area.w - rect.w))
  const y = Math.min(Math.max(rect.y + delta.dy, area.y), Math.max(area.y, area.y + area.h - rect.h))
  return { ...rect, x, y }
}

export function CanvasWorkspace(props: ParentProps) {
  const theme = useTheme()
  const serverSDK = useServerSDK()
  const [size, setSize] = createSignal<Size>({ w: 0, h: 0 })
  const [zoomValue, setZoomValue] = createSignal("100%")
  const [toast, setToast] = createSignal<string>()
  const [draggingId, setDraggingId] = createSignal<string>()
  const [resizingId, setResizingId] = createSignal<string>()
  const [selectedType, setSelectedType] = createSignal<CanvasBlockType>("notes")
  const [paletteOpen, setPaletteOpen] = createSignal(false)
  const [statsVisible, setStatsVisible] = createSignal(false)
  const layoutCtx = useLayout()
  const isMobile = createMediaQuery("(max-width: 767px)")
  let viewportRef: HTMLDivElement | undefined
  let worldRef: HTMLDivElement | undefined
  let interaction: Interaction | undefined
  let panSession: { start: Point; camera: Camera; moved: boolean; startTime: number } | undefined
  const panPointers = new Map<number, Point>()
  let pinch: { camera: Camera; scale: number; distance: number } | undefined
  let lastTap: { time: number; point: Point } | undefined
  let ignoreDblClickUntil = 0
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let rightPanActive = false
  let applying = false
  // Layout authority identity: the server hands over authority to the last
  // client that pulled the layout tuple. Fresh per mount, so a page reload
  // claims authority again.
  const clientID = crypto.randomUUID()

  const projectDirectory = () => layoutCtx.projects.list()[0]?.worktree

  const [state, setState] = createStore<CanvasState>({
    camera: defaultCamera(),
    editing: true,
    selectedId: null,
    zCounter: 10,
    blocks: [],
  })

  // The communication manager owns everything backend-authoritative (layout,
  // revision/authority, OperatingAgent model, permission config). The canvas
  // UI itself is standalone: it only renders local state and reports edits.
  const manager = createCanvasManager({
    clientID,
    directory: projectDirectory,
    isMobile,
    getRecords: () => toRecords(state.blocks),
    onServerLayout: (layout) => applyServerLayout(layout),
    onChatRelayBinding: (binding) => applyPersistedChatRelayBinding(binding),
    hasLocalBlocks: () => state.blocks.some((block) => block.type !== "legacy"),
    notify: showToast,
  })
  trackCleanup(() => manager.dispose())

  const panel = (): Size => ({ w: size().w, h: size().h })

  function persist() {
    const payload: PersistedState = {
      camera: state.camera,
      editing: state.editing,
      blocks: state.blocks.filter((block) => block.type !== "legacy").map((block) => toPersistedBlock(block)),
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      /* localStorage can be unavailable in private contexts */
    }
  }

  function saveSoon() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      persist()
      void manager.sync()
    }, 160)
  }

  // Camera changes stream in during pan/zoom; localStorage writes are slow,
  // so persist them on a much longer debounce than block edits.
  let cameraSaveTimer: ReturnType<typeof setTimeout> | undefined
  function saveSoonCamera() {
    clearTimeout(cameraSaveTimer)
    cameraSaveTimer = setTimeout(() => persist(), 800)
  }

  function load() {
    let saved: PersistedState | undefined
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) saved = JSON.parse(raw) as PersistedState
    } catch {
      saved = undefined
    }
    setState("camera", saved?.camera ?? defaultCamera())
    setState("editing", saved?.editing ?? true)
    const loadedBlocks = (saved?.blocks ?? [])
      .filter((block) => block.type === "legacy" || block.type in FUNCTIONALITY_BY_TYPE)
      .map((block) => persistedToBlock(block))
    setState(
      "blocks",
      [
        ...loadedBlocks,
        // The demo chat card was removed (the legacy block is \`builtin:chat\`);
        // drop any persisted chat blocks and unknown types from older caches.
        legacyBlock(panel()),
      ],
    )
    setState("zCounter", Math.max(10, ...loadedBlocks.map((block) => block.z)) + 1)
  }

  function showToast(message: string) {
    setToast(message)
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => setToast(undefined), 1700)
  }

  function select(id: string | null) {
    setState("selectedId", id)
  }

  function bringToFront(id: string) {
    select(id)
    const block = state.blocks.find((item) => item.id === id)
    if (!block || block.type === "legacy") return
    const z = state.zCounter + 1
    setState("zCounter", z)
    const index = state.blocks.findIndex((item) => item.id === id)
    if (index >= 0) setState("blocks", index, "z", z)
    saveSoon()
    manager.noteLocalEdit()
    applyRectDirect(id, { x: block.x, y: block.y, w: block.w, h: block.h, z })
  }

  // Rect updates mutate the block IN PLACE (path-based store writes) so the
  // block's object reference never changes. This keeps the render loop from
  // re-rendering the whole card — critically the legacy card, whose body hosts
  // the entire routed session UI — on every pointermove. The DOM is still
  // updated by the transform-sync effect below.
  function setRect(id: string, rect: GridRect) {
    const index = state.blocks.findIndex((block) => block.id === id)
    if (index < 0) return
    setState("blocks", index, "x", rect.x)
    setState("blocks", index, "y", rect.y)
    setState("blocks", index, "w", rect.w)
    setState("blocks", index, "h", rect.h)
    if (rect.z !== undefined) setState("blocks", index, "z", rect.z)
    saveSoon()
    manager.noteLocalEdit()
  }

  // The reactive render loop alone has proven unreliable for mid-gesture
  // updates in some environments; apply the rect straight onto the DOM node
  // synchronously inside the pointermove handler so the card always follows
  // the cursor 1:1. The store update above remains the source of truth for
  // persistence and reconciliation.
  function applyRectDirect(id: string, rect: GridRect) {
    const element = worldRef?.querySelector(\`[data-card-id="${CSS.escape(id)}"]\`)
    if (!(element instanceof HTMLElement)) return
    element.style.left = \`${rect.x}px\`
    element.style.top = \`${rect.y}px\`
    element.style.width = \`${rect.w}px\`
    element.style.height = \`${rect.h}px\`
    element.style.zIndex = String(rect.z)
  }

  // The store is the single source of truth for transforms; this re-applies
  // every stored rect to the DOM so rendered positions can never drift from
  // the store after programmatic mutations (server pulls, tidy, reset).
  function syncAllBlocksDOM() {
    for (const block of state.blocks) {
      applyRectDirect(block.id, { x: block.x, y: block.y, w: block.w, h: block.h, z: block.z })
    }
  }

  // Removes DOM cards that no longer exist in the store (the render loop may
  // lag behind store mutations).
  function pruneCardDOM() {
    const world = worldRef
    if (!world) return
    const ids = new Set(state.blocks.map((block) => block.id))
    for (const element of world.querySelectorAll<HTMLElement>("[data-card-id]")) {
      const id = element.dataset.cardId
      if (id && !ids.has(id)) element.remove()
    }
  }

  function applyCamera(camera: Camera) {
    setState("camera", clampCamera(camera, size()))
  }

  function resetView() {
    applyCamera({ x: 0, y: 0, scale: 1 })
    setState("blocks", (blocks) =>
      blocks.map((block) =>
        block.type === "legacy"
          ? { ...block, ...fitDefaultLayout(panel(), legacyConstraints), defaultRect: true }
          : block,
      ),
    )
    syncAllBlocksDOM()
    saveSoon()
    manager.noteLocalEdit()
    showToast("View reset")
  }

  function addBlock(type: CanvasBlockType, worldPoint?: Point) {
    const module = MODULES[type]
    const center = worldPoint ?? screenToWorld(state.camera, { x: size().w / 2, y: size().h / 2 })
    const z = state.zCounter + 1
    setState("zCounter", z)
    const block = blockOf(type, center.x - module.w / 2, center.y - module.h / 2, z)
    setState("blocks", (blocks) => [...blocks, block])
    select(block.id)
    saveSoon()
    manager.noteLocalEdit()
    showToast(\`${module.title} added\`)
  }

  function removeBlock(id: string) {
    const block = state.blocks.find((item) => item.id === id)
    if (!block || block.type === "legacy") return
    setState("blocks", (blocks) => blocks.filter((item) => item.id !== id))
    worldRef?.querySelector(\`[data-card-id="${CSS.escape(id)}"]\`)?.remove()
    if (state.selectedId === id) select(null)
    saveSoon()
    manager.noteLocalEdit()
    showToast("Block removed")
  }

  function tidyBlocks() {
    let x = 330
    let y = 140
    let rowHeight = 0
    const gap = 28
    const maxX = 1540
    setState("blocks", (blocks) =>
      blocks.map((block) => {
        if (block.type === "legacy") return block
        const width = block.collapsed ? 62 : block.w
        const height = block.collapsed ? 62 : block.h
        if (x + width > maxX) {
          x = 330
          y += rowHeight + gap
          rowHeight = 0
        }
        const next = { ...block, x, y }
        x += width + gap
        rowHeight = Math.max(rowHeight, height)
        return next
      }),
    )
    syncAllBlocksDOM()
    saveSoon()
    manager.noteLocalEdit()
    showToast("Board tidied")
  }

  function toggleTheme() {
    theme.setColorScheme(theme.mode() === "dark" ? "light" : "dark")
  }

  function toRecords(blocks: readonly CanvasBlock[]): WorkspaceBlockRecord[] {
    return blocks
      .filter((block) => block.type === "legacy" || block.type in FUNCTIONALITY_BY_TYPE)
      .map((block) => ({
        id: block.id,
        functionality: block.type === "legacy" ? "builtin:chat" : FUNCTIONALITY_BY_TYPE[block.type],
        transform: {
          x: Math.round(block.x),
          y: Math.round(block.y),
          w: Math.round(block.w),
          h: Math.round(block.h),
          z: block.z,
        },
      }))
  }

  function toPersistedBlock(block: CanvasBlock): PersistedCanvasBlock {
    return {
      id: block.id,
      type: block.type,
      x: block.x,
      y: block.y,
      w: block.w,
      h: block.h,
      z: block.z,
      collapsed: block.collapsed,
      bindings: block.bindings,
    }
  }

  function persistedToBlock(block: PersistedCanvasBlock): CanvasBlock {
    if (block.type === "legacy") {
      const existing = legacyBlock(panel())
      return {
        ...existing,
        x: block.x,
        y: block.y,
        w: block.w,
        h: block.h,
        z: block.z,
        collapsed: block.collapsed ?? existing.collapsed,
        bindings: block.bindings,
      }
    }

    return {
      id: block.id,
      type: block.type,
      x: block.x,
      y: block.y,
      w: Math.max(block.w, blockConstraints.minW),
      h: Math.max(block.h, blockConstraints.minH),
      z: block.z,
      collapsed: block.collapsed ?? false,
      defaultRect: false,
      text: "",
      listening: false,
      messages: [],
      agentKey: "inherit",
      layers: defaultOperatingLayers(),
      history: [],
      bindings: block.bindings,
    }
  }

  function recordToBlock(record: WorkspaceBlockRecord): CanvasBlock | undefined {
    if (record.functionality === "builtin:chat") {
      // The server's default layout stores a unit rect ({w:1,h:1}); treat it
      // as "fill the panel" rather than a 1px block.
      const unit = record.transform.w <= 1 && record.transform.h <= 1
      if (unit) return legacyBlock(panel())
      return {
        ...legacyBlock(panel()),
        x: record.transform.x,
        y: record.transform.y,
        w: record.transform.w,
        h: record.transform.h,
        z: 0,
        defaultRect: false,
      }
    }
    const type = TYPE_BY_FUNCTIONALITY[record.functionality]
    if (!type) return undefined
    return {
      id: record.id,
      type,
      x: record.transform.x,
      y: record.transform.y,
      w: Math.max(record.transform.w, blockConstraints.minW),
      h: Math.max(record.transform.h, blockConstraints.minH),
      z: record.transform.z,
      collapsed: false,
      defaultRect: false,
      text: "",
      listening: false,
      messages: [],
      agentKey: "inherit",
      layers: defaultOperatingLayers(),
      history: [],
      bindings: undefined,
    }
  }

  function mergeServerRuntime(block: CanvasBlock, existing?: CanvasBlock) {
    if (!existing || existing.type !== block.type) return block
    return {
      ...block,
      collapsed: existing.collapsed,
      listening: existing.listening,
      messages: existing.messages,
      bindings: existing.bindings,
      agentKey: existing.agentKey,
      layers: existing.layers,
      history: existing.history,
      text: existing.text,
    }
  }

  function applyPersistedChatRelayBinding(binding: { blockID: string; sessionID?: string }) {
    const index = state.blocks.findIndex((block) => block.id === binding.blockID)
    if (index < 0) return
    const block = state.blocks[index]
    if (block.type !== "chat-relay") return
    if ((block.bindings?.sessionID ?? undefined) === binding.sessionID) return
    if (binding.sessionID === undefined) {
      setState("blocks", index, "bindings", undefined)
      persist()
      return
    }
    const nextBindings = { ...(block.bindings ?? {}), sessionID: binding.sessionID }
    setState("blocks", index, "bindings", nextBindings)
    persist()
  }

  // Server-authoritative hydration: replaces the client block set with the
  // layout the server resolves for our tuple. Camera/editing stay local.
  function applyServerLayout(layout: WorkspaceLayoutInfo) {
    applying = true
    const existingByID = new Map(state.blocks.map((block) => [block.id, block]))
    const blocks: CanvasBlock[] = []
    for (const record of layout.blocks) {
      const block = recordToBlock(record)
      if (!block) continue
      const existing = existingByID.get(block.id)
      blocks.push(mergeServerRuntime(block, existing))
    }
    const legacy = blocks.find((block) => block.type === "legacy")
    if (!legacy) blocks.unshift(legacyBlock(panel()))
    setState("blocks", blocks)
    setState("zCounter", Math.max(10, ...blocks.map((block) => block.z)) + 1)
    select(null)
    applying = false
    syncAllBlocksDOM()
    pruneCardDOM()
    persist()
  }

  createEffect(() => {
    const { w, h } = size()
    if (w <= 0 || h <= 0) return
    const legacy = state.blocks.find((block) => block.type === "legacy")
    if (!legacy?.defaultRect) return
    const fitted = fitDefaultLayout({ w, h }, legacyConstraints)
    if (legacy.x === fitted.x && legacy.y === fitted.y && legacy.w === fitted.w && legacy.h === fitted.h) return
    setState("blocks", (blocks) => blocks.map((block) => (block.type === "legacy" ? { ...block, ...fitted } : block)))
  })

  // Applies the camera verbatim. Zoom paths clamp before writing state, and
  // panning must never be re-clamped here — re-clamping (centering the world
  // at low zoom, freezing at edges) made the rendered canvas drift from the
  // cursor even though the store tracked the pan correctly.
  createEffect(() => {
    const camera = state.camera
    const world = worldRef
    if (!world) return
    world.style.transform = \`translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})\`
    const gridSize = 24 * camera.scale
    const viewport = viewportRef
    if (viewport) {
      viewport.style.setProperty("--canvas-grid-size", \`${gridSize}px\`)
      viewport.style.setProperty("--canvas-grid-x", \`${camera.x % gridSize}px\`)
      viewport.style.setProperty("--canvas-grid-y", \`${camera.y % gridSize}px\`)
    }
    setZoomValue(\`${Math.round(camera.scale * 100)}%\`)
  })

  createEffect(() => {
    state.camera.x
    state.camera.y
    state.camera.scale
    state.editing
    saveSoonCamera()
  })

  // Transforms are owned by this effect: every store change re-applies each
  // block's rect to its DOM node. This runs after the render flush (so newly
  // added cards exist) and is the ONLY writer of left/top/width/height, which
  // keeps rendered positions consistent with the store after clicks, drags,
  // snaps, server pulls, tidy, and reset. Mutations report edits explicitly
  // (saveSoon + manager.noteLocalEdit) so this effect stays pure.
  createEffect(() => {
    state.blocks
    syncAllBlocksDOM()
  })

  onMount(() => {
    load()
    // Block Runtime v2 dev opt-in (integration wiring): when the env flag is
    // set, inject the server-backed runtime context and activate the runtime
    // path for chat-relay blocks. Off by default — legacy path is the fallback.
    if (import.meta.env.VITE_CYBERMASTER_BLOCK_RUNTIME_V2 === "true") {
      enableChatRelayBlockRuntime(serverSDK)
    }
    const resize = makeResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    resize.observe(viewportRef!)
    trackCleanup(makeEventListener(window, "pagehide", () => persist()))
    trackCleanup(makeEventListener(window, "blur", () => resetPointerState()))
    manager.start()
  })

  onCleanup(() => {
    clearTimeout(saveTimer)
    clearTimeout(cameraSaveTimer)
    clearTimeout(toastTimer)
    manager.dispose()
  })

  const onViewportPointerDown = (event: PointerEvent) => {
    if (event.button > 2) return
    if (interaction) return
    const target = event.target as HTMLElement
    if (
      target.closest(
        ".canvas-toolbar, .canvas-block-bar-wrap, .canvas-stats-overlay, .canvas-bottom-left, .canvas-bottom-right",
      )
    )
      return
    // Right-drag pans the canvas everywhere — including over cards — without
    // triggering the browser context menu (suppressed at the canvas root).
    if (target.closest(".canvas-card") && event.button !== 2) return
    event.preventDefault()
    rightPanActive = event.button === 2
    select(null)
    viewportRef?.classList.add("is-panning")
    viewportRef?.setPointerCapture(event.pointerId)
    panPointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (panPointers.size === 1) {
      const baseCamera = snapshotCamera(state.camera)
      panSession = {
        start: { x: event.clientX, y: event.clientY },
        camera: baseCamera,
        moved: false,
        startTime: performance.now(),
      }
      panSamples = []
      recordPanSample(baseCamera)
      return
    }
    if (panPointers.size === 2) {
      const [a, b] = [...panPointers.values()]
      const baseCamera = snapshotCamera(state.camera)
      pinch = { camera: baseCamera, scale: baseCamera.scale, distance: Math.max(pointerDistance(a, b), 1) }
      panSession = undefined
    }
  }

  const onViewportDoubleClick = (event: MouseEvent) => {
    if (performance.now() < ignoreDblClickUntil) return
    if (
      (event.target as HTMLElement).closest(
        ".canvas-card, .canvas-toolbar, .canvas-block-bar-wrap, .canvas-stats-overlay, .canvas-bottom-left, .canvas-bottom-right",
      )
    )
      return
    if (!state.editing) return
    const point = screenToWorld(state.camera, { x: event.clientX, y: event.clientY })
    addBlock("notes", { x: point.x - MODULES.notes.w / 2, y: point.y - 50 })
  }

  function onViewportTap(point: Point) {
    const now = performance.now()
    const previous = lastTap
    lastTap = undefined
    if (!state.editing) return
    if (previous && now - previous.time < 420 && pointerDistance(point, previous.point) < 44) {
      ignoreDblClickUntil = performance.now() + 600
      const world = screenToWorld(state.camera, point)
      addBlock("notes", { x: world.x - MODULES.notes.w / 2, y: world.y - 50 })
      return
    }
    lastTap = { time: now, point }
  }

  // The card's rendered closure can hold a stale block object when the render
  // loop is behind; always take the drag-start rect from the live store.
  function liveRect(block: CanvasBlock): GridRect {
    const current = state.blocks.find((item) => item.id === block.id)
    return current
      ? { x: current.x, y: current.y, w: current.w, h: current.h, z: current.z }
      : { x: block.x, y: block.y, w: block.w, h: block.h, z: block.z }
  }

  // A click anywhere on a card behaves like the header interaction: it selects
  // the block and — in editing mode — starts the same drag-to-move gesture.
  // Interactive content (buttons, inputs, editable text) and the legacy block
  // (which hosts the live opencode UI) are excluded from body drags.
  const onCardPointerDown = (event: PointerEvent, block: CanvasBlock) => {
    bringToFront(block.id)
    if (event.button !== 0 || !state.editing || block.type === "legacy") return
    if (interaction || panPointers.size > 0) return
    const target = event.target as HTMLElement
    if (
      target.closest(
        "button, input, textarea, select, a, [contenteditable=''], [contenteditable='true'], .canvas-resize-handle, .canvas-session-surface",
      )
    )
      return
    event.preventDefault()
    event.stopPropagation()
    const card = event.currentTarget as HTMLElement
    card.setPointerCapture(event.pointerId)
    setDraggingId(block.id)
    interaction = {
      type: "move",
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      rect: liveRect(block),
      blockId: block.id,
      legacy: false,
    }
  }

  const onHeaderPointerDown = (event: PointerEvent, block: CanvasBlock) => {
    if (event.button !== 0 || !state.editing) return
    if (interaction || panPointers.size > 0) return
    if ((event.target as HTMLElement).closest("button, span")) return
    event.preventDefault()
    event.stopPropagation()
    bringToFront(block.id)
    const header = event.currentTarget as HTMLElement
    header.setPointerCapture(event.pointerId)
    setDraggingId(block.id)
    interaction = {
      type: "move",
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      rect: liveRect(block),
      blockId: block.id,
      legacy: block.type === "legacy",
    }
  }

  const onResizePointerDown = (event: PointerEvent, block: CanvasBlock) => {
    if (event.button !== 0 || !state.editing) return
    if (interaction || panPointers.size > 0) return
    event.preventDefault()
    event.stopPropagation()
    bringToFront(block.id)
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    setResizingId(block.id)
    interaction = {
      type: "resize",
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      rect: liveRect(block),
      blockId: block.id,
      legacy: block.type === "legacy",
    }
  }

  function endInteraction() {
    if (!interaction) return
    setDraggingId(undefined)
    setResizingId(undefined)
    // Snap the settled position to the grid once the drag ends (path-based,
    // so the card body never re-renders).
    if (interaction.type === "move") {
      const index = state.blocks.findIndex((block) => block.id === interaction!.blockId)
      if (index >= 0) {
        const block = state.blocks[index]
        setState("blocks", index, "x", snap(block.x, DEFAULT_CELL))
        setState("blocks", index, "y", snap(block.y, DEFAULT_CELL))
        applyRectDirect(interaction.blockId, {
          x: snap(block.x, DEFAULT_CELL),
          y: snap(block.y, DEFAULT_CELL),
          w: block.w,
          h: block.h,
          z: block.z,
        })
        saveSoon()
        manager.noteLocalEdit()
      }
    }
    if (interaction.legacy) {
      const index = state.blocks.findIndex((block) => block.id === LEGACY_BLOCK_ID)
      if (index >= 0) setState("blocks", index, "defaultRect", false)
    }
    interaction = undefined
  }

  // Pan writes the camera directly per pointermove event — the browser
  // already throttles pointermove to its frame cadence, and any extra
  // coalescing layer adds a timing dependency that can lag behind the mouse
  // on some machines.
  function schedulePanUpdate(camera: Camera) {
    setState("camera", camera)
    recordPanSample(camera)
  }

  // DEV-only movement capture: samples are collected ONLY while a pan
  // gesture is active and uploaded to the dev server, which appends them to
  // the project's .test-data/canvas-pan-debug.jsonl for offline analysis.
  interface PanSample {
    t: number
    px: number
    py: number
    cx: number
    cy: number
    scale: number
    startX: number
    startY: number
    startCx: number
    startCy: number
    startScale: number
  }

  let panSamples: PanSample[] = []

  function recordPanSample(camera: Camera) {
    if (!import.meta.env.DEV) return
    const session = panSession
    if (!session) return
    const pointer = [...panPointers.values()].at(-1)
    if (!pointer) return
    if (panSamples.length >= 2000) return
    panSamples.push({
      t: Math.round(performance.now()),
      px: Math.round(pointer.x),
      py: Math.round(pointer.y),
      cx: Math.round(camera.x),
      cy: Math.round(camera.y),
      scale: camera.scale,
      startX: Math.round(session.start.x),
      startY: Math.round(session.start.y),
      startCx: Math.round(session.camera.x),
      startCy: Math.round(session.camera.y),
      startScale: session.camera.scale,
    })
  }

  function uploadPanSamples() {
    if (!import.meta.env.DEV || panSamples.length === 0) return
    const batch = panSamples
    panSamples = []
    const env = {
      screenW: window.screen.width,
      screenH: window.screen.height,
      dpr: window.devicePixelRatio,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      visualViewportScale: window.visualViewport?.scale ?? 1,
      platform: navigator.platform,
      userAgent: navigator.userAgent.slice(0, 240),
      pointerType: "mouse",
    }
    void fetch("/__canvas-pan-debug", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: crypto.randomUUID(), env, samples: batch }),
    }).catch(() => {
      /* dev-only diagnostics; never block the UI on upload failures */
    })
  }

  // Resets every in-flight pointer gesture (stale entries otherwise turn the
  // next drag into an accidental two-finger pinch = wrong pan amount).
  function resetPointerState() {
    uploadPanSamples()
    interaction = undefined
    pinch = undefined
    panSession = undefined
    panPointers.clear()
    rightPanActive = false
    setDraggingId(undefined)
    setResizingId(undefined)
    viewportRef?.classList.remove("is-panning")
  }

  // Pointer handlers are bound to the VIEWPORT ELEMENT (in onMount), not
  // window: pointer capture retargets events to the capture element, which
  // always bubbles through the viewport. Element-bound listeners die with
  // their DOM node, so hot reloads can never stack them — eliminating the
  // pan-moves-N-times-faster-than-the-cursor failure mode by construction.
  const onPointerMove = (event: PointerEvent) => {
    if (interaction) {
      if (interaction.pointerId !== event.pointerId) return
      const dx = event.clientX - interaction.start.x
      const dy = event.clientY - interaction.start.y
      const delta = { dx: dx / state.camera.scale, dy: dy / state.camera.scale }
      if (interaction.type === "move") {
        const next = interaction.legacy
          ? clampMoveContinuous(interaction.rect, delta, panel())
          : worldClamp({
              ...interaction.rect,
              x: interaction.rect.x + delta.dx,
              y: interaction.rect.y + delta.dy,
            })
        setRect(interaction.blockId, next)
        applyRectDirect(interaction.blockId, next)
        return
      }
      const constraints = interaction.legacy ? legacyConstraints : blockConstraints
      const nextSize = resizeBlock(interaction.rect, delta, "se", constraints)
      setRect(interaction.blockId, nextSize)
      applyRectDirect(interaction.blockId, nextSize)
      return
    }
    if (!panPointers.has(event.pointerId)) return
    panPointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const pointers = [...panPointers.values()]
    if (pointers.length >= 2) {
      if (!pinch) return
      const distance = Math.max(pointerDistance(pointers[0], pointers[1]), 1)
      applyCamera(
        zoomCamera(pinch.camera, pinch.scale * (distance / pinch.distance), midpoint(pointers[0], pointers[1]), size()),
      )
      return
    }
    if (!panSession) return
    if (!panSession.moved && pointerDistance({ x: event.clientX, y: event.clientY }, panSession.start) > 8) {
      panSession.moved = true
    }
    schedulePanUpdate(
      panCameraFree(panSession.camera, {
        x: event.clientX - panSession.start.x,
        y: event.clientY - panSession.start.y,
      }),
    )
  }

  const onPointerUp = (event: PointerEvent) => {
    if (interaction && interaction.pointerId === event.pointerId) {
      endInteraction()
      return
    }
    if (!panPointers.has(event.pointerId)) return
    const wasTap =
      !!panSession &&
      !panSession.moved &&
      event.pointerType === "touch" &&
      performance.now() - panSession.startTime < 450
    const tapPoint = { x: event.clientX, y: event.clientY }
    panPointers.delete(event.pointerId)
    rightPanActive = false
    if (panPointers.size === 0) {
      uploadPanSamples()
      viewportRef?.classList.remove("is-panning")
      pinch = undefined
      panSession = undefined
    } else if (panPointers.size === 1 && pinch) {
      const [, point] = [...panPointers.entries()][0]
      panSession = { start: point, camera: snapshotCamera(state.camera), moved: true, startTime: performance.now() }
      pinch = undefined
    }
    if (wasTap) onViewportTap(tapPoint)
  }

  const onPointerCancel = (event: PointerEvent) => {
    if (interaction && interaction.pointerId === event.pointerId) endInteraction()
    if (!panPointers.has(event.pointerId)) return
    panPointers.delete(event.pointerId)
    rightPanActive = false
    if (panPointers.size === 0) {
      uploadPanSamples()
      viewportRef?.classList.remove("is-panning")
      pinch = undefined
      panSession = undefined
    } else if (panPointers.size === 1 && pinch) {
      const [, point] = [...panPointers.entries()][0]
      panSession = { start: point, camera: snapshotCamera(state.camera), moved: true, startTime: performance.now() }
      pinch = undefined
    }
  }

  const onLostPointerCapture = (event: PointerEvent) => {
    if (interaction && interaction.pointerId === event.pointerId) endInteraction()
  }

  function onWheel(event: WheelEvent) {
    const target = event.target as HTMLElement
    // Mouse-wheel scroll stays available inside scrollable card content
    // (session UI, message lists, file tree, palette, textareas, embedded
    // session surfaces); anywhere else the wheel zooms the canvas in/out
    // towards the cursor.
    const scrollable = target.closest(
      ".canvas-legacy-body, .canvas-messages, .canvas-file-tree, .canvas-model-picker-list, .canvas-block-palette, .canvas-session-surface, .master-agent-body, textarea",
    )
    if (scrollable && !event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const sensitivity = event.ctrlKey || event.metaKey ? 0.006 : 0.0017
    const factor = Math.exp(-event.deltaY * sensitivity)
    setState("camera", (camera) =>
      zoomCamera(camera, camera.scale * factor, { x: event.clientX, y: event.clientY }, size()),
    )
  }

  trackCleanup(
    makeEventListener(window, "keydown", (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (event.key === "Escape") select(null)
      if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId) {
        removeBlock(state.selectedId)
      }
      if (event.key === "0") resetView()
      if (event.key.toLowerCase() === "n" && state.editing) addBlock("notes")
      if (event.key === "+" || event.key === "=") {
        setState("camera", (camera) =>
          zoomCamera(camera, camera.scale * 1.12, { x: size().w / 2, y: size().h / 2 }, size()),
        )
      }
      if (event.key === "-") {
        setState("camera", (camera) =>
          zoomCamera(camera, camera.scale / 1.12, { x: size().w / 2, y: size().h / 2 }, size()),
        )
      }
    }),
  )

  function cardStyle(block: CanvasBlock) {
    const accent = block.type === "legacy" ? LEGACY_MODULE.accent : MODULES[block.type].accent
    // Transforms are NOT rendered here: the render loop has proven to lag
    // behind the store in some environments, so position/rect ownership lives
    // in the DOM-sync effect (createEffect below). This only sets the accent.
    return {
      "--accent": accent,
    }
  }

  function cardClass(block: CanvasBlock) {
    return {
      selected: state.selectedId === block.id,
      collapsed: block.collapsed,
      dragging: draggingId() === block.id,
      resizing: resizingId() === block.id,
    }
  }

  function moduleOf(block: CanvasBlock) {
    return block.type === "legacy" ? LEGACY_MODULE : MODULES[block.type]
  }

  function toggleCollapse(block: CanvasBlock) {
    if (block.type === "legacy") return
    setState("blocks", (blocks) =>
      blocks.map((item) => (item.id === block.id ? { ...item, collapsed: !item.collapsed } : item)),
    )
    saveSoon()
    manager.noteLocalEdit()
  }

  return (
    <div
      class="canvas-app"
      onContextMenu={(event) => {
        if (!isTypingTarget(event.target)) event.preventDefault()
      }}
    >
      <div
        ref={(element) => (viewportRef = element)}
        class="canvas-viewport"
        classList={{ "canvas-editing": state.editing }}
        onPointerDown={onViewportPointerDown}
        onDblClick={onViewportDoubleClick}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
        onWheel={onWheel}
      >
        <div ref={(element) => (worldRef = element)} class="canvas-world">
          <div class="canvas-ambient-blob one" />
          <div class="canvas-ambient-blob two" />
          <Index each={state.blocks}>
            {(block) => {
              const item = block()
              return (
                <section
                  class="canvas-card"
                  classList={cardClass(item)}
                  style={cardStyle(item)}
                  data-card-id={item.id}
                  onPointerDown={(event) => onCardPointerDown(event, item)}
                >
                  <div class="canvas-card-header" onPointerDown={(event) => onHeaderPointerDown(event, item)}>
                    <div class="canvas-card-icon">{moduleOf(item).icon()}</div>
                    <div class="canvas-card-title-wrap">
                      <h2 class="canvas-card-title">{moduleOf(item).title}</h2>
                      <div class="canvas-card-subtitle">{moduleOf(item).subtitle}</div>
                    </div>
                    <div class="canvas-header-actions">
                      <Show when={item.type === "legacy"}>
                        <span class="canvas-icon-button" aria-label="Pinned" title="Pinned — cannot be removed">
                          {iconPin()}
                        </span>
                      </Show>
                      <Show when={item.type !== "legacy"}>
                        <button
                          type="button"
                          class="canvas-icon-button"
                          aria-label={item.collapsed ? "Expand" : "Collapse"}
                          onClick={() => toggleCollapse(item)}
                        >
                          {iconCollapse()}
                        </button>
                        <button
                          type="button"
                          class="canvas-icon-button"
                          aria-label="Remove block"
                          onClick={() => removeBlock(item.id)}
                        >
                          {iconClose()}
                        </button>
                      </Show>
                    </div>
                  </div>
                  <div class="canvas-card-body">
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
                  </div>
                  <Show when={state.editing}>
                    <div
                      class="canvas-resize-handle"
                      aria-hidden="true"
                      onPointerDown={(event) => onResizePointerDown(event, item)}
                    />
                  </Show>
                </section>
              )
            }}
          </Index>
        </div>
      </div>

      <header class="canvas-toolbar" aria-label="Canvas toolbar">
        <div class="canvas-brand" aria-label="Agent Canvas">
          <div class="canvas-brand-mark" aria-hidden="true" />
          <div class="canvas-brand-copy">
            <div class="canvas-brand-name">Agent Canvas</div>
            <div class="canvas-brand-tag">A quieter place to think</div>
          </div>
        </div>
        <div class="canvas-toolbar-group">
          <div class="canvas-toolbar-picker">
            <DirectoryPicker
              directories={() => manager.directories()}
              onUpdate={(directories) => void manager.updateDirectories(directories)}
            />
          </div>
          <button type="button" class="canvas-toolbar-button" title="Tidy the board" onClick={tidyBlocks}>
            {iconTools()}
            <span class="label">Tidy</span>
          </button>
          <button type="button" class="canvas-toolbar-button" title="Reset view" onClick={resetView}>
            {iconSpin()}
          </button>
          <button
            type="button"
            class="canvas-toolbar-button"
            classList={{ active: state.editing }}
            title={state.editing ? "Leave editing mode" : "Enter editing mode"}
            onClick={() => setState("editing", (value) => !value)}
          >
            {iconContext()}
            <span class="label">Edit</span>
          </button>
          <div class="canvas-toolbar-picker">
            <ModelPicker
              label="Model"
              current={manager.modelKey()}
              directory={projectDirectory}
              onSelect={(key) => void manager.selectModel(key)}
            />
          </div>
          <button type="button" class="canvas-toolbar-button" title="Toggle color theme" onClick={toggleTheme}>
            {iconFiles()}
          </button>
          <Show when={import.meta.env.DEV}>
            <button
              type="button"
              class="canvas-toolbar-button dev"
              classList={{ active: statsVisible() }}
              title="Toggle dev stats"
              aria-pressed={statsVisible()}
              onClick={() => setStatsVisible((value) => !value)}
            >
              <span class="label">DEV</span>
            </button>
          </Show>
        </div>
        <div class="canvas-toolbar-divider" aria-hidden="true" />
        <div id="opencode-titlebar-center" class="canvas-toolbar-center" />
        <div id="opencode-titlebar-right" class="canvas-toolbar-right" />
      </header>

      <Show when={state.editing}>
        <div class="canvas-block-bar-wrap">
          <Show when={paletteOpen()}>
            <div class="canvas-block-palette" role="listbox" aria-label="Select a block">
              <For each={Object.keys(MODULES) as CanvasBlockType[]}>
                {(type) => (
                  <button
                    type="button"
                    class="canvas-palette-item"
                    classList={{ active: selectedType() === type }}
                    style={{ "--button-accent": MODULES[type].accent }}
                    role="option"
                    aria-selected={selectedType() === type}
                    title={MODULES[type].title}
                    onClick={() => {
                      setSelectedType(type)
                      setPaletteOpen(false)
                    }}
                  >
                    <span class="canvas-palette-icon">{MODULES[type].icon()}</span>
                    <span class="canvas-palette-label">{MODULES[type].title}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <nav class="canvas-block-bar" aria-label="Block bar">
            <button
              type="button"
              class="canvas-block-bar-button"
              classList={{ active: paletteOpen() }}
              data-tip="Blocks"
              aria-expanded={paletteOpen()}
              aria-haspopup="listbox"
              title="Select a block"
              onClick={() => setPaletteOpen((value) => !value)}
            >
              {MODULES[selectedType()].icon()}
              <span class="canvas-block-bar-chevron">{iconCollapse()}</span>
            </button>
            <button
              type="button"
              class="canvas-block-bar-button add"
              data-tip="Add block"
              title="Add block"
              onClick={() => addBlock(selectedType())}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </nav>
        </div>
      </Show>

      <Show when={import.meta.env.DEV && statsVisible()}>
        <div class="canvas-stats-overlay" aria-label="Dev stats">
          <DebugBar inline />
        </div>
      </Show>

      <div class="canvas-bottom-left">
        <div class="canvas-status-pill">
          <span class="canvas-status-dot" classList={{ "is-dirty": manager.dirty() }} />
          Canvas workspace · {manager.connected() ? (manager.dirty() ? "syncing" : "synced") : "local"}
        </div>
        <div class="canvas-hint-pill">Pick a block · press + to add · drag empty space to pan</div>
      </div>

      <div class="canvas-bottom-right">
        <div class="canvas-zoom-control" aria-label="Zoom controls">
          <button
            type="button"
            class="canvas-control-button square"
            title="Zoom out"
            onClick={() =>
              setState("camera", (camera) =>
                zoomCamera(camera, camera.scale / 1.12, { x: size().w / 2, y: size().h / 2 }, size()),
              )
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 12h12" />
            </svg>
          </button>
          <div class="canvas-zoom-value">{zoomValue()}</div>
          <button
            type="button"
            class="canvas-control-button square"
            title="Zoom in"
            onClick={() =>
              setState("camera", (camera) =>
                zoomCamera(camera, camera.scale * 1.12, { x: size().w / 2, y: size().h / 2 }, size()),
              )
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 6v12M6 12h12" />
            </svg>
          </button>
        </div>
      </div>

      <div class="canvas-toast" classList={{ show: !!toast() }} role="status" aria-live="polite">
        {toast()}
      </div>
    </div>
  )
}

function ContextBody() {
  return (
    <div class="canvas-context-content">
      <div class="canvas-section-label">Current direction</div>
      <div class="canvas-chip-row">
        <span class="canvas-chip">
          <span class="canvas-chip-dot" style={{ "--chip-color": "var(--canvas-purple)" }} />
          Canvas-first
        </span>
        <span class="canvas-chip">
          <span class="canvas-chip-dot" style={{ "--chip-color": "var(--canvas-mint)" }} />
          No wires
        </span>
        <span class="canvas-chip">
          <span class="canvas-chip-dot" style={{ "--chip-color": "var(--canvas-pink)" }} />
          Friendly
        </span>
      </div>
      <div class="canvas-section-label">Remember</div>
      <div class="canvas-fact-list">
        <div class="canvas-fact">
          <div class="canvas-fact-number">1</div>
          <div>
            <strong>Everything is a block</strong>
            <span>Chat, files, voice, context, and tools share one visual language.</span>
          </div>
        </div>
        <div class="canvas-fact">
          <div class="canvas-fact-number">2</div>
          <div>
            <strong>Space carries meaning</strong>
            <span>Nearby blocks feel related without drawing explicit connections.</span>
          </div>
        </div>
        <div class="canvas-fact">
          <div class="canvas-fact-number">3</div>
          <div>
            <strong>Motion stays quiet</strong>
            <span>Animate state changes, not decoration.</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolsBody() {
  return (
    <div class="canvas-tool-list">
      <div class="canvas-tool-row">
        <div class="canvas-tool-state" style={{ "--tool-color": "var(--canvas-green)" }}>
          {iconCheck()}
        </div>
        <div>
          <div class="canvas-tool-name">Read project context</div>
          <div class="canvas-tool-detail">12 files indexed</div>
        </div>
        <div class="canvas-tool-time">0.18s</div>
      </div>
      <div class="canvas-tool-row">
        <div class="canvas-tool-state" style={{ "--tool-color": "var(--canvas-green)" }}>
          {iconCheck()}
        </div>
        <div>
          <div class="canvas-tool-name">Search codebase</div>
          <div class="canvas-tool-detail">query: canvas modules</div>
        </div>
        <div class="canvas-tool-time">0.42s</div>
      </div>
      <div class="canvas-tool-row">
        <div class="canvas-tool-state" style={{ "--tool-color": "var(--canvas-blue)" }}>
          {iconSpin()}
        </div>
        <div>
          <div class="canvas-tool-name">Generate interface</div>
          <div class="canvas-tool-detail">streaming preview…</div>
        </div>
        <div class="canvas-tool-time">live</div>
      </div>
      <div class="canvas-tool-row">
        <div class="canvas-tool-state" style={{ "--tool-color": "var(--canvas-yellow)" }}>
          {iconFile()}
        </div>
        <div>
          <div class="canvas-tool-name">Write artifact</div>
          <div class="canvas-tool-detail">agent_canvas_demo.html</div>
        </div>
        <div class="canvas-tool-time">queued</div>
      </div>
    </div>
  )
}

const FILE_ITEMS = [
  { name: "src", folder: true, nested: false, active: false },
  { name: "canvas.tsx", folder: false, nested: true, active: true },
  { name: "module-card.tsx", folder: false, nested: true, active: false },
  { name: "workspace-store.ts", folder: false, nested: true, active: false },
  { name: "public", folder: true, nested: false, active: false },
  { name: "icons.svg", folder: false, nested: true, active: false },
  { name: "package.json", folder: false, nested: false, active: false },
  { name: "README.md", folder: false, nested: false, active: false },
]

function FilesBody() {
  return (
    <div class="canvas-file-layout">
      <div class="canvas-search-wrap">
        <label class="canvas-search-box">
          {iconSearch()}
          <input
            aria-label="Filter files"
            placeholder="Filter files"
            onInput={(event) => {
              const query = event.currentTarget.value.toLowerCase().trim()
              const tree = event.currentTarget.closest(".canvas-file-layout")?.querySelector(".canvas-file-tree")
              tree?.querySelectorAll("[data-file-name]").forEach((item) => {
                ;(item as HTMLElement).style.display = item
                  .getAttribute("data-file-name")
                  ?.toLowerCase()
                  .includes(query)
                  ? "flex"
                  : "none"
              })
            }}
          />
        </label>
      </div>
      <div class="canvas-file-tree">
        <For each={FILE_ITEMS}>
          {(item) => (
            <div
              class="canvas-file-item"
              classList={{ nested: item.nested, active: item.active }}
              data-file-name={item.name}
            >
              {item.folder ? iconFolder() : iconFile()}
              <span>{item.name}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function NotesBody(props: { block: CanvasBlock; setState: SetStoreFunction<CanvasState> }) {
  return (
    <textarea
      class="canvas-notes-area"
      aria-label="Scratchpad"
      placeholder="Drop a thought here…"
      value={props.block.text}
      onInput={(event) => {
        const value = event.currentTarget.value
        props.setState("blocks", (blocks) =>
          blocks.map((block) => (block.id === props.block.id ? { ...block, text: value } : block)),
        )
      }}
    />
  )
}

function VoiceBody(props: { block: CanvasBlock; setState: SetStoreFunction<CanvasState> }) {
  return (
    <div class="canvas-voice-content">
      <button
        class="canvas-orb"
        classList={{ listening: props.block.listening }}
        type="button"
        aria-label="Toggle listening"
        onClick={() =>
          props.setState("blocks", (blocks) =>
            blocks.map((block) => (block.id === props.block.id ? { ...block, listening: !block.listening } : block)),
          )
        }
      >
        {iconMic()}
      </button>
      <div class="canvas-waveform" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div>
        <div class="canvas-voice-title">{props.block.listening ? "Listening…" : "Tap to speak"}</div>
        <div class="canvas-voice-note">Local voice capture can live here as a modular input surface.</div>
      </div>
    </div>
  )
}

export { LEGACY_BLOCK_ID }

const OPERATING_LAYER_LABELS: Record<OperatingLayer["layer"], string> = {
  workspace: "WorkspaceContext",
  block: "BlockContext",
  operational: "OperationalContext",
  custom: "CustomContext",
}

// Model picker. Lists the models of the connected providers and reports the
// selected \`providerID:modelID\` key. The popup is portaled to the body so it
// escapes the toolbar's overflow clipping.
function ModelPicker(props: {
  label: string
  current?: string
  directory?: () => string | undefined
  onSelect: (key: string) => void
}) {
  const providers = useProviders(() => props.directory?.())
  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [pop, setPop] = createSignal<{ top: number; left: number }>()
  let rootRef: HTMLDivElement | undefined
  let popRef: HTMLDivElement | undefined
  const connected = createMemo(() => new Set(providers.connected().map((provider) => provider.id)))

  const items = createMemo(() => {
    const query = search().trim().toLowerCase()
    const rows: { key: string; providerName: string; modelName: string }[] = []
    for (const [providerID, provider] of providers.all()) {
      if (!connected().has(providerID)) continue
      for (const [modelID, model] of Object.entries(provider.models)) {
        const name = model.name ?? modelID
        if (query && !\`${provider.name} ${name} ${providerID} ${modelID}\`.toLowerCase().includes(query)) continue
        rows.push({ key: \`${providerID}:${modelID}\`, providerName: provider.name, modelName: name })
      }
    }
    return rows.sort((a, b) => a.modelName.localeCompare(b.modelName) || a.providerName.localeCompare(b.providerName))
  })

  const toggle = () => {
    if (open()) {
      setOpen(false)
      return
    }
    const trigger = rootRef?.querySelector(".canvas-model-picker-trigger")
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    setPop({ top: rect.bottom + 8, left: rect.left })
    setSearch("")
    setOpen(true)
  }

  trackCleanup(
    makeEventListener(window, "pointerdown", (event: PointerEvent) => {
      if (!open()) return
      const target = event.target as HTMLElement
      if (rootRef?.contains(target) || popRef?.contains(target)) return
      setOpen(false)
    }),
  )

  // Close on scrolls OUTSIDE the popup only: the model list itself is
  // scrollable, and its scroll events (including scrollbar drags/clicks)
  // reach this capture-phase listener — closing then made the expanded
  // menu collapse on the first scroll or scrollbar interaction.
  trackCleanup(
    makeEventListener(
      window,
      "scroll",
      (event: Event) => {
        if (!open()) return
        const target = event.target as HTMLElement | null
        if (target && popRef?.contains(target)) return
        setOpen(false)
      },
      { capture: true },
    ),
  )
  return (
    <div class="canvas-model-picker" ref={(element) => (rootRef = element)}>
      <button
        type="button"
        class="canvas-model-picker-trigger"
        classList={{ active: open() }}
        aria-expanded={open()}
        aria-haspopup="listbox"
        title={\`Select the ${props.label} model\`}
        onClick={toggle}
      >
        <span class="canvas-model-picker-label">{props.label}</span>
        <span class="canvas-model-picker-current">{props.current ?? "default"}</span>
        <span class="canvas-model-picker-chevron">{iconCollapse()}</span>
      </button>
      <Show when={open()}>
        <Portal>
          <div
            class="canvas-model-picker-pop"
            ref={(element) => (popRef = element)}
            style={{ top: \`${pop()?.top ?? 0}px\`, left: \`${pop()?.left ?? 0}px\` }}
          >
            <input
              class="canvas-model-picker-search"
              aria-label="Search models"
              placeholder="Search models…"
              value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)}
            />
            <div class="canvas-model-picker-list" role="listbox">
              <For each={items()}>
                {(item) => (
                  <button
                    type="button"
                    class="canvas-model-picker-item"
                    classList={{ active: item.key === props.current }}
                    role="option"
                    aria-selected={item.key === props.current}
                    onClick={() => {
                      setOpen(false)
                      props.onSelect(item.key)
                    }}
                  >
                    <span class="canvas-model-picker-name">{item.modelName}</span>
                    <span class="canvas-model-picker-provider">{item.providerName}</span>
                  </button>
                )}
              </For>
              <Show when={items().length === 0}>
                <div class="canvas-model-picker-empty">No models found</div>
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  )
}

// Working-directories picker: lists the workspace's project directories
// (FR-2) and supports adding/removing paths. The first directory is the
// workspace's primary directory (chat blocks bind to it). Updates flow
// through the manager's optimistic server patch; the popup keeps the same
// portal + outside-close semantics as the model picker, including the
// internal-scroll guard so scrolling its own list never collapses it.
function DirectoryPicker(props: {
  directories?: () => string[] | undefined
  onUpdate: (directories: string[]) => void
}) {
  const [open, setOpen] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [pop, setPop] = createSignal<{ top: number; left: number }>()
  let rootRef: HTMLDivElement | undefined
  let popRef: HTMLDivElement | undefined

  const directories = () => props.directories?.() ?? []

  const toggle = () => {
    if (open()) {
      setOpen(false)
      return
    }
    const trigger = rootRef?.querySelector(".canvas-directory-picker-trigger")
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    setPop({ top: rect.bottom + 8, left: rect.left })
    setOpen(true)
  }

  trackCleanup(
    makeEventListener(window, "pointerdown", (event: PointerEvent) => {
      if (!open()) return
      const target = event.target as HTMLElement
      if (rootRef?.contains(target) || popRef?.contains(target)) return
      setOpen(false)
    }),
  )

  trackCleanup(
    makeEventListener(
      window,
      "scroll",
      (event: Event) => {
        if (!open()) return
        const target = event.target as HTMLElement | null
        if (target && popRef?.contains(target)) return
        setOpen(false)
      },
      { capture: true },
    ),
  )

  const add = () => {
    const value = draft().trim()
    if (!value || directories().includes(value)) return
    props.onUpdate([...directories(), value])
    setDraft("")
  }

  return (
    <div class="canvas-directory-picker" ref={(element) => (rootRef = element)}>
      <button
        type="button"
        class="canvas-directory-picker-trigger"
        classList={{ active: open() }}
        aria-expanded={open()}
        aria-haspopup="dialog"
        title="Configure workspace working directories"
        onClick={toggle}
      >
        {iconFolder()}
        <span class="canvas-directory-picker-label">Directories</span>
        <span class="canvas-directory-picker-count">{directories().length}</span>
        <span class="canvas-model-picker-chevron">{iconCollapse()}</span>
      </button>
      <Show when={open()}>
        <Portal>
          <div
            class="canvas-directory-picker-pop"
            ref={(element) => (popRef = element)}
            style={{ top: \`${pop()?.top ?? 0}px\`, left: \`${pop()?.left ?? 0}px\` }}
          >
            <div class="canvas-directory-picker-head">
              Working directories · first is primary
            </div>
            <div class="canvas-directory-picker-list" role="list">
              <For each={directories()}>
                {(directory, index) => (
                  <div class="canvas-directory-picker-item" role="listitem">
                    <span class="canvas-directory-picker-path" title={directory}>
                      {index() === 0 ? \`${directory} · primary\` : directory}
                    </span>
                    <button
                      type="button"
                      class="canvas-directory-picker-remove"
                      aria-label={\`Remove ${directory}\`}
                      title={\`Remove ${directory}\`}
                      onClick={() => props.onUpdate(directories().filter((_, i) => i !== index()))}
                    >
                      {iconClose()}
                    </button>
                  </div>
                )}
              </For>
              <Show when={directories().length === 0}>
                <div class="canvas-directory-picker-empty">No directories yet</div>
              </Show>
            </div>
            <form
              class="canvas-directory-picker-add"
              onSubmit={(event) => {
                event.preventDefault()
                add()
              }}
            >
              <input
                class="canvas-directory-picker-input"
                aria-label="Add working directory path"
                placeholder="Add a directory path…"
                value={draft()}
                onInput={(event) => setDraft(event.currentTarget.value)}
              />
              <button type="submit" class="canvas-directory-picker-add-button" disabled={!draft().trim()}>
                Add
              </button>
            </form>
          </div>
        </Portal>
      </Show>
    </div>
  )
}

function OperatingChatBody(props: {
  block: CanvasBlock
  setState: SetStoreFunction<CanvasState>
  permissions?: PermissionConfig
  agentKey?: string
}) {
  const [stackOpen, setStackOpen] = createSignal(true)

  const patch = (patch: Partial<CanvasBlock>) =>
    props.setState("blocks", (blocks) =>
      blocks.map((block) => (block.id === props.block.id ? { ...block, ...patch } : block)),
    )

  const agentKey = () =>
    props.block.agentKey === "inherit" ? (props.agentKey ?? "workspace-default") : props.block.agentKey

  const executionDenied = () => permissionDenied(props.permissions, "task")

  const record = (role: "user" | "assistant", text: string) => {
    const history = appendExchange(props.block.history, { role, text })
    const layers = props.block.layers.map((layer) =>
      layer.layer === "operational" ? { ...layer, text: tail(text) } : layer,
    )
    patch({ history, layers })
  }

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    if (executionDenied()) return
    const target = event.currentTarget
    if (!(target instanceof HTMLFormElement)) return
    const textarea = target.querySelector("textarea")
    if (!textarea) return
    const value = textarea.value.trim()
    if (!value) return
    record("user", value)
    textarea.value = ""
    setTimeout(() => {
      record(
        "assistant",
        "The OperatingAgent answered through the workspace's modded session. This reply is recorded into the HistoricalContextStack.",
      )
    }, 620)
  }

  return (
    <div class="canvas-operating-layout">
      <div class="canvas-operating-status">
        <span class="canvas-operating-status-dot" />
        <span class="canvas-operating-agent">OperatingAgent · {agentKey()}</span>
        <button
          type="button"
          class="canvas-operating-stack-toggle"
          aria-expanded={stackOpen()}
          onClick={() => setStackOpen((value) => !value)}
        >
          context stack {props.block.history.length}/{OPERATING_CONTEXT_LIMIT}
        </button>
      </div>
      <Show when={stackOpen()}>
        <div class="canvas-operating-stack">
          <For each={props.block.layers}>
            {(layer) => (
              <div class="canvas-operating-layer" classList={{ custom: layer.layer === "custom" }}>
                <div class="canvas-operating-layer-label">{OPERATING_LAYER_LABELS[layer.layer]}</div>
                <Show
                  when={layer.layer !== "custom"}
                  fallback={
                    <textarea
                      class="canvas-operating-layer-custom"
                      aria-label="CustomContext"
                      placeholder="Fixed text provided by the user"
                      value={layer.text}
                      onInput={(event) => {
                        const value = event.currentTarget.value
                        patch({
                          layers: props.block.layers.map((item) =>
                            item.layer === "custom" ? { ...item, text: value } : item,
                          ),
                        })
                      }}
                    />
                  }
                >
                  <div class="canvas-operating-layer-text">
                    {layer.text ||
                      (layer.layer === "operational" ? "(decided by the BlockSubsystem's output)" : "(empty)")}
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class="canvas-messages">
        <Show when={props.block.history.length === 0}>
          <div class="canvas-message">
            <div class="canvas-avatar">AGENT</div>
            <div class="canvas-bubble">
              Submissions here are answered by the workspace's OperatingAgent and recorded in the
              HistoricalContextStack.
            </div>
          </div>
        </Show>
        <For each={props.block.history}>
          {(exchange) => (
            <div class="canvas-message" classList={{ user: exchange.role === "user" }}>
              <div class="canvas-avatar">{exchange.role === "user" ? "YOU" : "AGENT"}</div>
              <div class="canvas-bubble">
                <span class="canvas-operating-index">#{exchange.index}</span>
                {exchange.text}
              </div>
            </div>
          )}
        </For>
      </div>
      <form class="canvas-composer" onSubmit={submit}>
        <Show
          when={!executionDenied()}
          fallback={
            <div class="canvas-operating-denied">
              Permission denied — the project config denies agent execution (task). Edit the project config to allow it.
            </div>
          }
        >
          <textarea rows={1} aria-label="Message" placeholder="Submit to the OperatingAgent…" />
          <button class="canvas-send-button" type="submit" title="Send">
            {iconSend()}
          </button>
        </Show>
      </form>
    </div>
  )
}

function tail(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim()
  return compact.length > 140 ? \`${compact.slice(0, 137)}…\` : compact
}

```

### `packages/app/src/pages/canvas/runtime/bootstrap.ts (27 lines)`

```ts
import { ChatRelayRuntimeAdapter } from "../blocks/chat-relay/runtime"
import { createBlockRuntimeRegistry } from "./registry"
import { createServerBlockRuntimeContext, type ServerSDKGetter } from "./server-transport"

// Dev opt-in bootstrap for the Block Runtime v2 path. Called once from the
// canvas mount when VITE_CYBERMASTER_BLOCK_RUNTIME_V2=true:
// - registers the ChatRelay adapter in the runtime registry,
// - injects the real server-backed context (snapshot + SSE) into the seams
//   the ChatRelay view reads (__CHAT_RELAY_RUNTIME_CONTEXT__,
//   __CHAT_RELAY_RUNTIME_V2__).
// Legacy path remains the default when the flag is unset.
export const enableChatRelayBlockRuntime = (sdk: ServerSDKGetter) => {
  const registry = createBlockRuntimeRegistry()
  registry.register("builtin:chat-relay", ChatRelayRuntimeAdapter as never)
  const context = createServerBlockRuntimeContext(sdk)
  const globals = globalThis as {
    __CHAT_RELAY_RUNTIME_CONTEXT__?: unknown
    __CHAT_RELAY_RUNTIME_V2__?: unknown
  }
  globals.__CHAT_RELAY_RUNTIME_CONTEXT__ = context
  globals.__CHAT_RELAY_RUNTIME_V2__ = true
  return () => {
    delete globals.__CHAT_RELAY_RUNTIME_CONTEXT__
    delete globals.__CHAT_RELAY_RUNTIME_V2__
  }
}

```

### `packages/app/src/pages/canvas/runtime/server-transport.ts (41 lines)`

```ts
import type { ServerSDK } from "@/context/server-sdk"
import type { Accessor } from "solid-js"
import type { ChatRelayRuntimeContext } from "../blocks/chat-relay/runtime"
import type { ChatRelayCommand, RuntimeEventEnvelope, RuntimeResourceBinding, RuntimeSnapshot, RuntimeResourceState } from "../blocks/chat-relay/types"

export type ServerSDKGetter = Accessor<ServerSDK>

// Real BlockRuntimeContext over the OpenCode-native block-runtime endpoints
// (POST /api/block-runtime/snapshot + GET /api/block-runtime/event SSE).
// Command dispatch to the Track C server adapter (OpencodeChat) is the
// documented integration follow-up; the legacy path stays the default until
// then (see H's fallback policy).
export const createServerBlockRuntimeContext = (sdk: ServerSDKGetter): ChatRelayRuntimeContext => ({
  async snapshot(bindings: RuntimeResourceBinding[] = []) {
    const result = await sdk().client.v2.blockRuntime.snapshot({ bindings }, { throwOnError: true })
    return { cursor: result.data.cursor, state: result.data.state as RuntimeResourceState } satisfies RuntimeSnapshot<RuntimeResourceState>
  },
  subscribe(bindings: RuntimeResourceBinding[], cursor: string, onEvent: (event: RuntimeEventEnvelope) => void) {
    let cancelled = false
    void (async () => {
      try {
        const iterable = await sdk().client.v2.blockRuntime.subscribe({ bindings, cursor })
        for await (const event of iterable.stream) {
          if (cancelled) break
          onEvent(event as RuntimeEventEnvelope)
        }
      } catch {
        // stream closed/aborted — the view keeps its last snapshot
      }
    })()
    return () => {
      cancelled = true
    }
  },
  async sendCommand(command: ChatRelayCommand) {
    throw new Error(
      \`sendCommand(${command.type}): command dispatch routes through the Track C OpencodeChat adapter — integration follow-up; use the legacy path for sends\`,
    )
  },
})

```

### `packages/app/src/pages/canvas/session-surface-providers.tsx (32 lines)`

```tsx
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { PromptProvider } from "@/context/prompt"
import { SDKProvider } from "@/context/sdk"
import { useServer } from "@/context/server"
import { DirectoryDataProvider } from "@/pages/directory-layout"
import { Show, type ParentProps } from "solid-js"

// Canvas-mounted session surfaces (ChatRelay, MasterAgent) need the same
// per-directory provider stack the session route uses. The canvas page itself
// only provides the server-scoped contexts (ServerSDK/ServerSync/Layout), so
// the block hosts wrap their embedded surface here. Renders nothing until the
// binding's directory is known.
export function CanvasSessionSurfaceProviders(props: ParentProps<{ directory?: string }>) {
  const server = useServer()
  return (
    <Show when={props.directory} keyed>
      {(directory) => (
        <SDKProvider directory={() => directory}>
          <DirectoryDataProvider directory={() => directory} server={() => server.key}>
            <FileProvider>
              <PromptProvider>
                <CommentsProvider>{props.children}</CommentsProvider>
              </PromptProvider>
            </FileProvider>
          </DirectoryDataProvider>
        </SDKProvider>
      )}
    </Show>
  )
}

```

### `packages/app/src/pages/canvas/manager.ts:55-120`

```ts
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
```

### `packages/app/src/pages/canvas/manager.ts:153-235`

```ts
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
```
