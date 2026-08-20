You are worker 5 of 5 (Wave 2) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task L — Diagnostics and feature flag

### Required work

1. **Diagnostics**: update `packages/app/src/pages/canvas/diagnostics.ts` to
   report the NEW runtime state instead of the old: per-block
   { blockID, functionalityID, registrationMode: "native" | "local" | "none",
   hostStatus, localViewKeys }, plus workspace { id, epoch, connected, dirty }.
   Exported shape: `collectCanvasDiagnostics(services?)` returning a plain
   JSON-able object; keep a no-args fallback that reads the canvas globals
   (the `__CANVAS_INTEGRATION_STATE__` pattern) when services are unavailable.
2. **Feature flag**: find the flag module that holds canvas feature flags
   (`packages/app/src/pages/canvas/flag.ts` — if missing, create it) and add
   `BLOCK_RUNTIME_V3: false` with a comment: flipped by M at integration once
   all Wave-2 registrations are wired. The flag gates NOTHING yet (dead by
   default) — only the constant + its doc comment.
3. **HANDOFF-L.md**: exports, tests + results, integration actions.

### Tests

- `diagnostics.test.ts` (new, beside the file): with a fake services object,
  collectCanvasDiagnostics reports per-block registrationMode + workspace
  fields; no-args fallback returns a JSON-able object without throwing.

### Owned files (edit ONLY these)

- packages/app/src/pages/canvas/diagnostics.ts
- packages/app/src/pages/canvas/diagnostics.test.ts (NEW)
- packages/app/src/pages/canvas/flag.ts (create only if missing)
- packages/app/src/pages/canvas/HANDOFF-L.md

### Targeted validation (allowed)

- cd packages/app && bun test src/pages/canvas/diagnostics.test.ts
- bun run typecheck from packages/app

### HARD PROHIBITIONS

Do NOT edit workspace.tsx, manager.ts, chat-relay, master-agent, runtime/*
(existing files), server/protocol/core, generated files. Do NOT run generate.



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


### `packages/app/src/pages/canvas/diagnostics.ts (106 lines)`

```ts
type BlockRuntimeConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "stale"
  | "error"

export type BlockRuntimeDiagnostics = {
  descriptor?: string
  bindings?: {
    blockID?: string
    functionalityID?: string
    resourceID?: string
    adapterFunctionalityID?: string
  }
  activeAdapterFunctionalityID?: string
  resourceSubscriptionCount?: number
  connectionState?: BlockRuntimeConnectionState
  lastCursor?: string
  lastRevision?: string | number
  lastSnapshotTime?: number
  resyncCount?: number
  resyncReason?: string
  eventBatchStats?: {
    flushCount?: number
    eventCount?: number
    droppedEventCount?: number
    maxBatchSize?: number
    avgBatchSize?: number
  }
}

const diagnosticsRegistry = new Map<() => BlockRuntimeDiagnostics, number>()

export function registerBlockRuntimeDiagnostics(stats: () => BlockRuntimeDiagnostics): () => void {
  const existing = diagnosticsRegistry.get(stats)
  if (existing === undefined) diagnosticsRegistry.set(stats, 1)
  else diagnosticsRegistry.set(stats, existing + 1)

  return () => {
    const current = diagnosticsRegistry.get(stats)
    if (current === undefined) return
    if (current <= 1) diagnosticsRegistry.delete(stats)
    else diagnosticsRegistry.set(stats, current - 1)
  }
}

export function getBlockRuntimeDiagnostics(): BlockRuntimeDiagnostics | undefined {
  const provider = [...diagnosticsRegistry.keys()].at(-1)
  if (provider === undefined) return undefined

  try {
    return provider()
  } catch {
    return undefined
  }
}

export function renderBlockRuntimeDiagnostics(diagnostics: BlockRuntimeDiagnostics | undefined = getBlockRuntimeDiagnostics()): string {
  if (!import.meta.env.DEV) return ""
  if (!diagnostics) return "block-runtime diagnostics: not registered"

  const lines: string[] = []
  if (diagnostics.descriptor !== undefined || diagnostics.bindings !== undefined) {
    const descriptor = diagnostics.descriptor ?? "(none)"
    const blockBinding = diagnostics.bindings
      ? \`${diagnostics.bindings.blockID ?? "(no-block)"}/${diagnostics.bindings.functionalityID ?? "(no-functionality)"}\`
      : "(no-binding)"
    lines.push(\`descriptor: ${descriptor}\`)
    lines.push(\`bindings: ${blockBinding}\`)
  }

  const activeAdapter = diagnostics.activeAdapterFunctionalityID
  if (activeAdapter !== undefined) lines.push(\`active adapter functionalityID: ${activeAdapter}\`)
  if (diagnostics.bindings?.adapterFunctionalityID !== undefined && activeAdapter === undefined) {
    lines.push(\`binding adapter functionalityID: ${diagnostics.bindings.adapterFunctionalityID}\`)
  }

  if (diagnostics.resourceSubscriptionCount !== undefined) {
    lines.push(\`resource subscription count: ${diagnostics.resourceSubscriptionCount}\`)
  }
  if (diagnostics.connectionState !== undefined) {
    lines.push(\`connection state: ${diagnostics.connectionState}\`)
  }
  if (diagnostics.lastCursor !== undefined || diagnostics.lastRevision !== undefined) {
    lines.push(
      \`last cursor/revision: ${diagnostics.lastCursor ?? "(none)"}/${String(diagnostics.lastRevision ?? "(none)")}\`,
    )
  }
  if (diagnostics.lastSnapshotTime !== undefined) {
    lines.push(\`last snapshot time: ${new Date(diagnostics.lastSnapshotTime).toISOString()}\`)
  }
  if (diagnostics.resyncCount !== undefined || diagnostics.resyncReason !== undefined) {
    lines.push(\`resyncs: ${diagnostics.resyncCount ?? 0}${diagnostics.resyncReason ? \` (${diagnostics.resyncReason})\` : ""}\`)
  }

  if (diagnostics.eventBatchStats !== undefined) {
    const stats = diagnostics.eventBatchStats
    lines.push(
      \`event batch stats: flush=${stats.flushCount ?? 0}, events=${stats.eventCount ?? 0}, dropped=${stats.droppedEventCount ?? 0}, max=${stats.maxBatchSize ?? 0}, avg=${stats.avgBatchSize ?? 0}\`,
    )
  }

  return lines.join("\n")
}

```

### `packages/app/src/pages/canvas/workspace.tsx:455-500`

```tsx
  const panel = (): Size => ({ w: size().w, h: size().h })

  function readPersistedLayout() {
    let saved: PersistedState | undefined
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) saved = JSON.parse(raw) as PersistedState
    } catch {
      saved = undefined
    }
    const loadedBlocks = (saved?.blocks ?? [])
      .filter((block) => block.type === "legacy" || block.type in FUNCTIONALITY_BY_TYPE)
      .map((block) => persistedToBlock(block))
    return {
      camera: saved?.camera ?? defaultCamera(),
      editing: saved?.editing ?? true,
      blocks: [...loadedBlocks, legacyBlock(panel())],
      zCounter: Math.max(10, ...loadedBlocks.map((block) => block.z)) + 1,
    }
  }

  const initialLayout = readPersistedLayout()
  const [state, setState] = createStore<CanvasState>({
    camera: initialLayout.camera,
    editing: initialLayout.editing,
    selectedId: null,
    zCounter: initialLayout.zCounter,
    blocks: initialLayout.blocks,
  })
  if (typeof globalThis === "object" && (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__) {
    console.log("workspace-render", state.blocks.length)
  }
  if (typeof globalThis === "object" && (globalThis as { __CANVAS_INTEGRATION_STATE__?: typeof state }).__CANVAS_INTEGRATION_STATE__) {
    ;(globalThis as { __CANVAS_INTEGRATION_STATE__?: typeof state }).__CANVAS_INTEGRATION_STATE__ = state
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
    hasLocalBlocks: () => state.blocks.some((block) => block.type !== "legacy"),
```
