You are worker 4 of 7 (Wave 1, CONTINUATION) in the block-runtime-v3 run at
D:\OpencodeDev (branch feature/CyberMaster). A previous attempt drifted and
delivered nothing of this task. Implement ONLY what is listed here. Do not read
other files. Do not search. Write the code now.

## HARD PROHIBITIONS

- Do NOT edit packages/protocol/**, packages/server/**, packages/client/**,
  generated SDK files, packages/app/src/pages/canvas/blocks/chat-relay/**,
  packages/app/src/pages/canvas/master-agent/**, packages/app/src/pages/canvas/manager.ts.
- Do NOT run `bun run generate` or any SDK/build script.
- Do NOT add any network/command/endpoint code.

## Implement these FOUR new files

### 1. `packages/app/src/pages/canvas/runtime/local-view-store.ts`

```ts
import { createStore, type SetStoreFunction } from "solid-js/store"

const KEY = "opencode.canvas.local-view.v1"
export interface LocalViewEntry { blockID: string; view: Record<string, unknown> }
export interface BlockLocalViewStore {
  read(blockID: string): Record<string, unknown>
  write(blockID: string, patch: Record<string, unknown>): void
  clear(blockID: string): void
  clearAll(): void
}
export function createBlockLocalViewStore(): BlockLocalViewStore
```

Implementation: in-memory Record<string, Record<string, unknown>> hydrated
once from localStorage[KEY] (JSON array of LocalViewEntry, tolerant parse);
`write` merges patch into the block's view and schedules a debounced
localStorage write (setTimeout ~200ms; collapse multiple writes; clear the
timer on clearAll). `clear` deletes one block. Serialized JSON must never
contain `sessionID` values (they are simply never written here).

### 2. `packages/app/src/pages/canvas/runtime/block-runtime-host.tsx`

A Solid component:

```tsx
import { createContext, useContext, type JSX } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { BlockRuntimeRegistration, RuntimeBlockHandle } from "./contracts"

export const BlockRuntimeHandleContext = createSimpleContext<RuntimeBlockHandle>()
export function useBlockRuntimeHandle(): RuntimeBlockHandle | undefined {
  return BlockRuntimeHandleContext.use()
}

export function BlockRuntimeHost(props: {
  blockID: string
  functionalityID: string
  registration: BlockRuntimeRegistration<unknown, unknown, unknown> | undefined
  children: JSX.Element
})
```

Behavior (v1, no adapter resolution yet — Wave 2 wires adapters):
- If `registration` is undefined, render children directly.
- Otherwise keep a local signal `status` ("resolving" | "ready" | ...) and a
  `view` signal; call `registration.resolve(...)` on mount with an AbortSignal
  (abort on unmount); set status ready on success, "error" on throw; build a
  handle object `{ status(), view(), error(), refresh, dispatch, dispose }`
  matching `RuntimeBlockHandle`; provide it via BlockRuntimeHandleContext.
- The handle key (for future resource sharing) includes workspaceEpoch +
  workspaceID + blockID + functionalityID — accept optional props
  `workspaceID?: string` and `workspaceEpoch?: number` and include them in the
  key string used for a Map of shared handles (v1: one handle per mount).
- On unmount (onCleanup): abort in-flight resolve, call registration.dispose if
  defined, remove the handle.
- NO polling, NO timers, NO events in this file.

### 3. `packages/app/src/pages/canvas/runtime/provider.tsx`

```tsx
import { createSimpleContext } from "@opencode-ai/ui/context"
export function BlockRuntimeProvider(props: {
  workspaceID: () => string | undefined
  workspaceEpoch: () => number
  connected: () => boolean
  awaitDescriptorPersisted: (blockID: string, signal: AbortSignal) => Promise<void>
  localView: BlockLocalViewStore
  children: JSX.Element
})
export function useBlockRuntimeServices(): BlockRuntimeServices | undefined
```

Owns: ONE event router instance (import `createBlockRuntimeEventRouter` from
"./event-router" — created in Wave 1 by worker C; if that file is missing from
disk, define the router surface per the inlined contract and note it in the
handoff), the registry (import `createBlockRuntimeRegistry` from "./registry"),
and the provided `localView` store; exposes `BlockRuntimeServices`
(serverSDK accessor passthrough is NOT needed in v1 — provide
`services` without `serverSDK` and note the seam in the handoff: M wires the
real SDK accessor). onCleanup disposes router + registry.

### 4. `packages/app/src/pages/canvas/runtime/compat-renderers.tsx`

```tsx
export function compatRendererFor(functionalityID: string): Component | undefined
```

A map from functionalityID to existing renderer components. The existing
in-file bodies in workspace.tsx (OperatingChatBody, ContextBody, ToolsBody,
FilesBody, NotesBody, VoiceBody) stay in workspace.tsx for now — this module
EXPORTS ONLY the chat-relay and master-agent compatibility entries:
- `"builtin:chat-relay"` → a wrapper component that renders
  `<ChatRelayBody workspaceID={props.workspaceID} blockID={props.blockID} block={props.block} />`
  (import from "./../blocks/chat-relay" — index exports ChatRelayBody).
- `"builtin:master-agent"` → `<MasterAgentBlock ...>` (import from
  "./../master-agent" — index exports MasterAgentBlock).
Look at the inlined workspace.tsx render-switch range for the EXACT props those
components receive today and forward the same props. Unknown functionalityID →
undefined.

## workspace.tsx edits (packages/app/src/pages/canvas/workspace.tsx)

You own this file. Make these MINIMAL edits — do not rewrite the file:

1. **CanvasBlock type** (find `interface CanvasBlock` near the inlined range
   300-340): REMOVE the fields `bindings`, `messages`, `history`, `layers`,
   `text`, `listening`, `agentKey` from the type. Keep everything else (id,
   type, x/y/w/h/z, collapsed, defaultRect, ...). Fix compile errors from the
   removal by removing/updating the code that used those fields — the bodies
   that consumed them (OperatingChatBody layers/history, NotesBody text,
   VoiceBody listening, ChatRelayBody block.bindings) must read from a
   compatibility shim: add at the bottom of workspace.tsx a
   `blockViewState(blockID)` helper backed by a module-level
   `createBlockLocalViewStore()` (import from "./runtime/local-view-store") so
   the in-file bodies keep working via `blockViewState(block.id).text` etc.
   Migrate `persistedToBlock`/`toPersistedBlock` accordingly (see 2/3).
2. **toPersistedBlock** (range ~717): serialize ONLY id/type/x/y/w/h/z/
   collapsed/defaultRect. No bindings, no text/listening/layers/history.
3. **persistedToBlock** (range ~731): hydrate only those fields; local-view
   state hydrates separately via the local-view store when a body reads it.
4. **applyServerLayout** (range ~819): keep replacing descriptor geometry only;
   REMOVE `mergeServerRuntime` and any binding/message merge. Keep the
   `bindings`-related code paths deleted along with field removal.
5. **load()**: the legacy localStorage JSON may contain old fields — ignore
   them on parse (drop bindings/text/etc).
6. **onMount bootstrap**: REMOVE the `enableChatRelayBlockRuntime` import and
   every reference (`VITE_CYBERMASTER_BLOCK_RUNTIME_V2`, the onMount guard) —
   the runtime bootstrap no longer exists in the canvas.
7. **Render switch** (range ~1440-1480): route block bodies through
   `compatRendererFor` for chat-relay/master-agent ONLY when the compat map has
   an entry; all other blocks keep rendering their current in-file bodies.
   Wrap each rendered block in `<BlockRuntimeHost blockID=... functionalityID=... registration={undefined}>` — v1 passes `undefined` registration for all
   (Wave 2 supplies real registrations via M). Import BlockRuntimeHost from
   "./runtime/block-runtime-host".
8. Wrap the canvas root JSX (the top-level returned <div> content of
   CanvasWorkspace) in `<BlockRuntimeProvider workspaceID={manager.workspaceID}
   workspaceEpoch={manager.workspaceEpoch} connected={manager.connected}
   awaitDescriptorPersisted={...} localView={...}>` — implement
   awaitDescriptorPersisted in the canvas as: resolve immediately when
   `manager.connected() && !manager.dirty()` and the block exists in
   `state.blocks`; otherwise wait on the next successful layout save via a
   one-shot promise (keep a module-level Set of waiters resolved in the
   existing sync()/persist success path — the simplest correct approach: poll
   `manager.dirty()` every 250ms with a timeout of 15s and honor the
   AbortSignal; label it clearly as a v1 seam for M).

Do not change manager.ts. Do not change ChatRelayBody/MasterAgentBlock
internals.

## Tests (new, beside the files)

- local-view-store: write/read/clear/clearAll + localStorage round-trip + no
  sessionID key ever serialized.
- block-runtime-host: mount with undefined registration renders children; mount
  with a fake registration resolves and provides a handle; unmount aborts and
  disposes.
- provider: dispose cleans router/registry (assert via the router's listener
  count if exposed).
- compat-renderers: chat-relay + master-agent entries defined; unknown → undefined.

Use `--conditions=browser --preload ./happydom.ts` for component tests.

## Owned files (edit ONLY these)

- `packages/app/src/pages/canvas/runtime/local-view-store.ts` + test
- `packages/app/src/pages/canvas/runtime/block-runtime-host.tsx` + test
- `packages/app/src/pages/canvas/runtime/provider.tsx` + test
- `packages/app/src/pages/canvas/runtime/compat-renderers.tsx` + test
- `packages/app/src/pages/canvas/workspace.tsx` (the 8 edits above only)
- `packages/app/src/pages/canvas/runtime/HANDOFF-D.md`

## Targeted validation (allowed)

- `cd packages/app && bun test --conditions=browser --preload ./happydom.ts <your new test files>`
- `bun run typecheck` from `packages/app`

## Inlined context

Only these ranges. Implement from them.


---

## Inlined source

### `packages/app/src/pages/canvas/workspace.tsx:300-345` (46 lines)

```tsx
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
```

### `packages/app/src/pages/canvas/workspace.tsx:490-560` (71 lines)

```tsx
      persist()
    }
  }

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
    onWorkspaceInvalidated: () => clearWorkspaceScopedBindings(),
    hasLocalBlocks: () => state.blocks.some((block) => block.type !== "legacy"),
    notify: showToast,
  })
  trackCleanup(() => manager.dispose())

  createEffect(() => {
    const epoch = manager.workspaceEpoch()
    if (epoch > 0) clearWorkspaceScopedBindings()
  })

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
    if (typeof globalThis === "object" && (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__) {
      console.log("load::raw", saved)
    }
    setState("camera", saved?.camera ?? defaultCamera())
    setState("editing", saved?.editing ?? true)
    const loadedBlocks = (saved?.blocks ?? [])
      .filter((block) => block.type === "legacy" || block.type in FUNCTIONALITY_BY_TYPE)
```

### `packages/app/src/pages/canvas/workspace.tsx:717-760` (44 lines)

```tsx
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
```

### `packages/app/src/pages/canvas/workspace.tsx:819-900` (82 lines)

```tsx
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
    if (typeof globalThis === "object" && (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__) {
      console.log("applyServerLayout", layout.blocks.length, "records", layout.blocks)
    }
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
    if (typeof globalThis === "object" && (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__) {
      console.log("state-length", state.blocks.length)
    }
    const { w, h } = size()
    if (w <= 0 || h <= 0) return
    const legacy = state.blocks.find((block) => block.type === "legacy")
    if (!legacy?.defaultRect) return
    const fitted = fitDefaultLayout({ w, h }, legacyConstraints)
    if (legacy.x === fitted.x && legacy.y === fitted.y && legacy.w === fitted.w && legacy.h === fitted.h) return
    setState("blocks", (blocks) => blocks.map((block) => (block.type === "legacy" ? { ...block, ...fitted } : block)))
  })

```

### `packages/app/src/pages/canvas/workspace.tsx:895-925` (31 lines)

```tsx
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
    world.style.transform = `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})`
    const gridSize = 24 * camera.scale
    const viewport = viewportRef
    if (viewport) {
      viewport.style.setProperty("--canvas-grid-size", `${gridSize}px`)
      viewport.style.setProperty("--canvas-grid-x", `${camera.x % gridSize}px`)
      viewport.style.setProperty("--canvas-grid-y", `${camera.y % gridSize}px`)
    }
    setZoomValue(`${Math.round(camera.scale * 100)}%`)
  })

  createEffect(() => {
    state.camera.x
    state.camera.y
    state.camera.scale
    state.editing
    saveSoonCamera()
```

### `packages/app/src/pages/canvas/workspace.tsx:1435-1490` (56 lines)

```tsx
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
```

### `packages/app/src/pages/canvas/runtime/contracts.ts:1-200` (95 lines)

```ts
import type { Accessor } from "solid-js"

import type { ServerEvent, ServerSDK } from "@/context/server-sdk"

export interface CanvasBlockDescriptor {
  id: string
  functionalityID: string
  transform: {
    x: number
    y: number
    w: number
    h: number
    z: number
  }
}

export type BlockRuntimeMode = "native" | "projected" | "local" | "static"

export type RuntimeStatus = "resolving" | "ready" | "stale" | "unavailable" | "permission-denied" | "error"

export interface RuntimeEventKey {
  type: string
  workspaceID?: string
  blockID?: string
  functionalityID?: string
  resourceID?: string
}

export type RuntimeProjectionPatch =
  | { op: "replace"; value: unknown; revision?: number }
  | { op: "merge"; value: Record<string, unknown>; revision?: number }
  | { op: "append"; path: readonly string[]; value: unknown; revision?: number }
  | { op: "remove"; path?: readonly string[]; revision?: number }

export interface BlockRuntimeEventRouter {
  on(eventKey: RuntimeEventKey, listener: (event: ServerEvent) => void): () => void
  off(eventKey: RuntimeEventKey, listener: (event: ServerEvent) => void): void
}

export interface BlockLocalViewStore {
  read<T>(key: string): T | undefined
  write<T>(key: string, value: T): void
  delete(key: string): void
}

export interface BlockRuntimeServices {
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

export interface BlockRuntimeRegistration<TResolved, TView, TCommand> {
  functionalityID: string
  mode: BlockRuntimeMode
  resolve(input: {
    workspaceID: string
    block: CanvasBlockDescriptor
    services: BlockRuntimeServices
    signal: AbortSignal
  }): Promise<TResolved>
  eventKeys?(resolved: TResolved): readonly RuntimeEventKey[]
  onEvent?(input: {
    event: ServerEvent
    resolved: TResolved
    services: BlockRuntimeServices
  }): "ignore" | "invalidate" | RuntimeProjectionPatch
  select(input: {
    resolved: TResolved
    projection: unknown
    localView: unknown
  }): TView
  dispatch?(input: {
    resolved: TResolved
    command: TCommand
    services: BlockRuntimeServices
    signal: AbortSignal
  }): Promise<void>
  dispose?(resolved: TResolved): void
}

export interface RuntimeBlockHandle<TView = unknown, TCommand = unknown> {
  status(): RuntimeStatus
  view(): TView | undefined
  error(): unknown
  refresh(reason?: string): Promise<void>
  dispatch(command: TCommand): Promise<void>
  dispose(): void
}

```

### `packages/app/src/pages/canvas/blocks/chat-relay/index.ts:1-40` (3 lines)

```ts
export { ChatRelayBody, iconClose, iconRelay, iconSpin } from "./view"
export type { ChatRelayBodyProps } from "./types"

```

### `packages/app/src/pages/canvas/master-agent/block.tsx:1-60` (60 lines)

```tsx
/** @jsxImportSource solid-js */
// Track B3 — MasterAgent block composition. Composes the manager API
// (spec 02 §12), the B1 shell, B2 Coder selector, Q1 queue options, and the
// U3 canvas session surface into the single `builtin:master-agent` block
// renderer consumed by I2.
//
// Authority: the host functionality instance owns the authoritative Session
// binding; this component only reads it through `manager.masterAgent` and
// renders it. No session is created, deleted, or cancelled here, and no
// prompt is submitted from this file — the embedded surface reuses the
// existing Session composer, whose queue action admits queued inputs to the
// host through the existing admission path. Nothing session-identifying
// reaches layout serialization or local persistence.

import { onCleanup, onMount, Show } from "solid-js"
import type { BindingState, ModelSelection } from "./types"
import type { MasterAgentManagerApi as CanvasManagerApi } from "../manager"
import type { CoderController } from "./coder-controller"
import { MasterAgentBlockShell } from "./block-shell"
import { CoderSelector, type CoderTaskPermission } from "./coder-selector"
import { createMasterAgentSessionOptions } from "./session-options"
import { CanvasSessionSurface } from "../session-surface"
import { CanvasSessionSurfaceProviders } from "../session-surface-providers"

// The block consumes a narrow view of the manager's published `masterAgent`
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
```

### `packages/app/src/pages/canvas/runtime/registry.ts:1-60` (25 lines)

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

### `packages/app/src/pages/canvas/runtime/event-router.ts:1-80` (80 lines)

```ts
import type { RuntimeEventKey } from "./contracts"

type BlockRuntimeEvent = {
  details: {
    type: string
    properties: unknown
  }
}

type EventHandler = (event: BlockRuntimeEvent) => void
type RuntimeEventPredicate = (event: BlockRuntimeEvent) => boolean
type ReconnectHandler = () => void

type Listener = {
  id: number
  key: RuntimeEventKey
  handler: EventHandler
}

type PredicateListener = {
  id: number
  predicate: RuntimeEventPredicate
  handler: EventHandler
}

type EventMatchProperties = {
  workspaceID: unknown
  blockID: unknown
  functionalityID: unknown
  resourceID: unknown
}

type EventRouterInput = {
  listen: (handler: (event: BlockRuntimeEvent) => void) => () => void
}

const wildcard = "*"

const toRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    return {}
  }
  return value as Record<string, unknown>
}

const makeIndexKey = (
  type: string,
  workspaceID: unknown,
  blockID: unknown,
  functionalityID: unknown,
  resourceID: unknown,
) =>
  `${type}|${workspaceID ?? wildcard}|${blockID ?? wildcard}|${functionalityID ?? wildcard}|${resourceID ?? wildcard}`

const extractProperties = (event: BlockRuntimeEvent): EventMatchProperties => {
  const properties = toRecord(event.details.properties)

  return {
    workspaceID: properties.workspaceID,
    blockID: properties.blockID,
    functionalityID: properties.functionalityID,
    resourceID: properties.resourceID,
  }
}

const buildCombinations = (properties: EventMatchProperties, type: string) => {
  const { workspaceID, blockID, functionalityID, resourceID } = properties

  return [
    makeIndexKey(type, wildcard, wildcard, wildcard, wildcard),
    makeIndexKey(type, workspaceID, wildcard, wildcard, wildcard),
    makeIndexKey(type, wildcard, blockID, wildcard, wildcard),
    makeIndexKey(type, wildcard, wildcard, functionalityID, wildcard),
    makeIndexKey(type, wildcard, wildcard, wildcard, resourceID),
    makeIndexKey(type, workspaceID, blockID, wildcard, wildcard),
    makeIndexKey(type, workspaceID, wildcard, functionalityID, wildcard),
    makeIndexKey(type, workspaceID, wildcard, wildcard, resourceID),
    makeIndexKey(type, wildcard, blockID, functionalityID, wildcard),
    makeIndexKey(type, wildcard, blockID, wildcard, resourceID),
    makeIndexKey(type, wildcard, wildcard, functionalityID, resourceID),
```

