You are worker 3 of 5 (Wave 2) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task J — OperatingChat runtime registration

### Required work

Create `packages/app/src/pages/canvas/runtime/registrations/operating-chat.ts`:
- `OperatingChatBlockDescriptor` = { id, functionalityID: "builtin:operating-chat" }.
- `operatingChatRuntimeRegistration: BlockRuntimeRegistration<...>`:
  - `mode: "local"`,
  - `resolve(...)` → reads the block's LOCAL VIEW state via
    `services.localView.read(block.id)`; returns `{ state, dispose }`,
  - `select({ resolved, localView })` → `OperatingChatView` =
    { history: OperatingExchange[], layers: OperatingLayer[] } projected from
    local view with defaults (`defaultOperatingLayers()`, empty history),
  - `dispatch({ command, services })` → commands:
    { type: "append-exchange", role, text } → append to history + update
    operational layer tail (the existing `appendExchange`/`tail` behavior);
    { type: "set-custom-layer", text } → update the custom layer text;
    writes back via `services.localView.write(block.id, ...)`.
- Export the view + command types.

The inlined workspace.tsx OperatingChatBody shows the exact domain logic to
preserve (appendExchange, tail, defaultOperatingLayers from
`./editor/operating-context`).

### Tests

- `operating-chat.test.ts` (beside the registration): resolve reads defaults;
  dispatch append-exchange appends + updates operational tail; set-custom-layer
  writes; dispose is idempotent. Local-view store injected as a fresh in-memory
  store.

### Owned files (edit ONLY these)

- packages/app/src/pages/canvas/runtime/registrations/operating-chat.ts (NEW)
- packages/app/src/pages/canvas/runtime/registrations/operating-chat.test.ts (NEW)
- packages/app/src/pages/canvas/runtime/registrations/HANDOFF-J.md

### Targeted validation (allowed)

- cd packages/app && bun test src/pages/canvas/runtime/registrations/operating-chat.test.ts
- bun run typecheck from packages/app

### HARD PROHIBITIONS

Do NOT edit workspace.tsx (its OperatingChatBody stays as the fallback body —
M swaps the renderer to the registration at integration), manager.ts, chat-relay,
master-agent, server/protocol/core, generated files. Do NOT run generate.



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


### `packages/app/src/pages/canvas/workspace.tsx:2145-2262`

```tsx
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

  // Block-local view state (C1): the context stack lives in the local view
  // store, never in the layout descriptor.
  const viewLayers = () => localViewStore.read<{ layers?: OperatingLayer[] }>(props.block.id)?.layers ?? defaultOperatingLayers()
  const viewHistory = () => localViewStore.read<{ history?: OperatingExchange[] }>(props.block.id)?.history ?? []
  const writeLayers = (layers: OperatingLayer[]) => localViewStore.write(props.block.id, { layers })
  const writeHistory = (history: OperatingExchange[]) => localViewStore.write(props.block.id, { history })

  const agentKey = () => props.agentKey ?? "workspace-default"

  const executionDenied = () => permissionDenied(props.permissions, "task")

  const record = (role: "user" | "assistant", text: string) => {
    const history = appendExchange(viewHistory(), { role, text })
    const layers = viewLayers().map((layer) =>
      layer.layer === "operational" ? { ...layer, text: tail(text) } : layer,
    )
    writeHistory(history)
    writeLayers(layers)
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
          context stack {viewHistory().length}/{OPERATING_CONTEXT_LIMIT}
        </button>
      </div>
      <Show when={stackOpen()}>
        <div class="canvas-operating-stack">
          <For each={viewLayers()}>
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
                        writeLayers(
                          viewLayers().map((item) => (item.layer === "custom" ? { ...item, text: value } : item)),
                        )
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
        <Show when={viewHistory().length === 0}>
          <div class="canvas-message">
            <div class="canvas-avatar">AGENT</div>
            <div class="canvas-bubble">
              Submissions here are answered by the workspace's OperatingAgent and recorded in the
              HistoricalContextStack.
            </div>
          </div>
        </Show>
        <For each={viewHistory()}>
          {(exchange) => (
            <div class="canvas-message" classList={{ user: exchange.role === "user" }}>
              <div class="canvas-avatar">{exchange.role === "user" ? "YOU" : "AGENT"}</div>
              <div class="canvas-bubble">
```

### `packages/app/src/pages/canvas/editor/operating-context.ts (55 lines)`

```ts
export type OperatingLayerKey = "workspace" | "block" | "operational" | "custom"

export interface OperatingLayer {
  layer: OperatingLayerKey
  text: string
}

export interface OperatingExchange {
  index: number
  role: "user" | "assistant"
  text: string
  at: number
}

export const OPERATING_CONTEXT_LIMIT = 24

const BLOCK_CONTEXT =
  "This block is the workspace's OperatingChatSession. Every exchange is recorded into the " +
  "HistoricalContextStack and answered by the workspace's configured OperatingAgent model."

export function defaultOperatingLayers(): OperatingLayer[] {
  return [
    { layer: "workspace", text: "" },
    { layer: "block", text: BLOCK_CONTEXT },
    { layer: "operational", text: "" },
    { layer: "custom", text: "" },
  ]
}

export function compactSummary(exchanges: readonly OperatingExchange[], at: number): OperatingExchange {
  const body = exchanges.map((exchange) => \`${exchange.role}: ${exchange.text}\`).join(" ")
  return {
    index: exchanges[0]?.index ?? 0,
    role: "assistant",
    at,
    text: \`[compacted] ${body}\`,
  }
}

export function appendExchange(
  history: readonly OperatingExchange[],
  exchange: { role: "user" | "assistant"; text: string; at?: number },
  limit: number = OPERATING_CONTEXT_LIMIT,
): OperatingExchange[] {
  const entry: OperatingExchange = {
    index: (history.at(-1)?.index ?? 0) + 1,
    role: exchange.role,
    text: exchange.text,
    at: exchange.at ?? Date.now(),
  }
  if (history.length < limit) return [...history, entry]
  const drop = 2
  return [compactSummary(history.slice(0, drop), entry.at), ...history.slice(drop), entry]
}

```
