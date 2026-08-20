You are worker 4 of 5 (Wave 2) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task K — Static/local block registrations (notes, voice, context, tools, files)

### Required work

Create `packages/app/src/pages/canvas/runtime/registrations/static-blocks.ts`:
- Descriptor types: NotesBlockDescriptor { id, functionalityID: "builtin:notes" },
  VoiceBlockDescriptor { id, functionalityID: "builtin:voice" }.
- `notesRuntimeRegistration`: mode "local"; resolve reads
  `services.localView.read(block.id)`; select → { text } (default ""); dispatch
  { type: "set-text", text } → localView.write.
- `voiceRuntimeRegistration`: mode "local"; resolve reads local view; select →
  { listening } (default false); dispatch { type: "toggle" } → flip.
- `builtinStaticRegistrations: Record<string, BlockRuntimeRegistration<...>>`
  exporting the notes + voice registrations under
  `"builtin:notes"` / `"builtin:voice"` keys.

Context/tools/files bodies remain pure presentational (no state) — they get NO
registration; the host renders them as plain children (no registration needed).
Note this in the handoff.

### Tests

- `static-blocks.test.ts`: notes set-text round-trips through the local-view
  store; voice toggle flips; unknown functionality has no registration.

### Owned files (edit ONLY these)

- packages/app/src/pages/canvas/runtime/registrations/static-blocks.ts (NEW)
- packages/app/src/pages/canvas/runtime/registrations/static-blocks.test.ts (NEW)
- packages/app/src/pages/canvas/runtime/registrations/HANDOFF-K.md

### Targeted validation (allowed)

- cd packages/app && bun test src/pages/canvas/runtime/registrations/static-blocks.test.ts
- bun run typecheck from packages/app

### HARD PROHIBITIONS

Do NOT edit workspace.tsx, manager.ts, chat-relay, master-agent, server/
protocol/core, generated files. Do NOT run generate.



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


### `packages/app/src/pages/canvas/workspace.tsx:165-400`

```tsx
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
```

### `packages/app/src/pages/canvas/workspace.tsx:1688-1890`

```tsx
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
      value={localViewStore.read<{ text?: string }>(props.block.id)?.text ?? ""}
      onInput={(event) => {
        localViewStore.write(props.block.id, { text: event.currentTarget.value })
      }}
    />
  )
}

function VoiceBody(props: { block: CanvasBlock; setState: SetStoreFunction<CanvasState> }) {
  return (
    <div class="canvas-voice-content">
      <button
        class="canvas-orb"
        classList={{ listening: localViewStore.read<{ listening?: boolean }>(props.block.id)?.listening ?? false }}
        type="button"
        aria-label="Toggle listening"
        onClick={() => {
          const current = localViewStore.read<{ listening?: boolean }>(props.block.id)?.listening ?? false
          localViewStore.write(props.block.id, { listening: !current })
        }}
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
        <div class="canvas-voice-title">
          {localViewStore.read<{ listening?: boolean }>(props.block.id)?.listening ? "Listening…" : "Tap to speak"}
        </div>
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

```
