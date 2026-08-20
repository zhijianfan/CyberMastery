You are worker 1 of 5 (Wave 2) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task H — ChatRelay runtime migration onto the generic host

The generic host boundary exists (Wave 1: `BlockRuntimeHost`,
`BlockRuntimeProvider`, `createHostSessionBindingRegistration`, local-view
store). Your job: make the ChatRelay block a REAL runtime registration and
migrate the legacy path OFF the old surface.

### Required work

1. **Adapter**: in `packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts`,
   keep `ChatRelayRuntimeAdapter` but re-implement it as a
   `BlockRuntimeRegistration<ChatRelayBlockDescriptor, ChatRelayView, ChatRelayCommand>`:
   - `mode: "native"`,
   - `getBindings(descriptor)` → session/auth/message/permission bindings from
     `descriptor.bindings.sessionID` (as today),
   - `resolve(...)` → snapshot through `services.serverSDK` (the
     `BlockRuntimeServices.serverSDK` accessor, wired by M at integration)
     using the CURRENT `createServerBlockRuntimeContext` snapshot path for
     ChatRelay (see inlined server-transport.ts / runtime.ts), returns
     `{ snapshot, dispose }`,
   - `select({ resolved, projection, localView })` → `ChatRelayView`
     (sessionID, status from auth/session resources, message list),
   - `dispatch({ resolved, command, services, signal })` → session.prompt /
     session.abort / permission.respond / auth.start via the SDK session
     endpoints (v2.session.prompt etc.) — typed against the SDK surface in
     `@opencode-ai/sdk/v2/client`; if a required SDK method is absent from the
     pinned SDK type, declare a narrow local command method adapter type and
     cast (M re-generates the SDK after this run),
   - per-adapter command type narrowing (C5): the registration's command type
     IS `ChatRelayCommand`.
2. **View**: `view.tsx` keeps BOTH branches (legacy + runtime, flag-gated as
   today) but the RUNTIME branch must now render through the generic host
   contract (`BlockRuntimeHost` + registration) instead of the old
   `RuntimeChatRelayBody`'s own snapshot/subscribe loop. The legacy branch
   stays UNCHANGED (it is the user's live path).
3. **Migration shims (C6)**: the legacy branch's `bindings` usage moves to
   `descriptor.bindings` (block prop already carries `{ id, bindings? }`).
   No CanvasBlock field changes — workspace.tsx already dropped them.
4. **HANDOFF-H.md**: files changed, exports, how M registers the adapter
   (registry name `"builtin:chat-relay"`), tests + results, integration
   actions.

### Tests (new files beside the sources)

- runtime.test.ts (update the existing one): adapter mode is "native";
  dispatch routes prompt/abort/permission/auth commands to the fake SDK;
  select projects the view from the snapshot state; getBindings maps sessionID.
- view.test.tsx (update the existing browser-mode test): runtime branch mounts
  inside BlockRuntimeHost and shows messages from the seeded snapshot.

### Owned files (edit ONLY these)

- packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts
- packages/app/src/pages/canvas/blocks/chat-relay/view.tsx
- packages/app/src/pages/canvas/blocks/chat-relay/types.ts
- packages/app/src/pages/canvas/blocks/chat-relay/index.ts
- packages/app/src/pages/canvas/blocks/chat-relay/runtime.test.ts
- packages/app/src/pages/canvas/blocks/chat-relay/view.test.tsx
- packages/app/src/pages/canvas/blocks/chat-relay/HANDOFF-H.md

### Targeted validation (allowed)

- cd packages/app && bun test --conditions=browser --preload ./happydom.ts src/pages/canvas/blocks/chat-relay/runtime.test.ts src/pages/canvas/blocks/chat-relay/view.test.tsx
- bun run typecheck from packages/app (report errors in files you do not own as "pre-existing/in-flight"; do not fix them)

### HARD PROHIBITIONS

Do NOT edit workspace.tsx, manager.ts, master-agent/**, runtime/* (except
nothing outside your owned list), packages/server, packages/protocol,
packages/core, generated SDK files. Do NOT run `bun run generate`.



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


### `packages/app/src/pages/canvas/blocks/chat-relay/view.tsx (404 lines)`

```tsx
import { For, onCleanup, onMount, type JSX, createEffect, createSignal, Show } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { createMasterAgentSessionOptions } from "../../master-agent/session-options"
import { CanvasSessionSurface } from "../../session-surface"
import { CanvasSessionSurfaceProviders } from "../../session-surface-providers"
import { permissionDenied } from "../../permissions"
import {
  ChatRelayRuntimeAdapter,
  createMockChatRelayContext,
  type ChatRelayRuntimeContext,
  type ChatRelayRuntimeView,
} from "./runtime"
import type { ChatRelayBodyProps, ChatRelayCommand, RuntimeResourceState, RuntimeSnapshot } from "./types"

export const iconRelay = (): JSX.Element => (
  <svg viewBox="0 0 24 24">
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
    <path d="M13 7h4a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4h-4" />
  </svg>
)

export const iconClose = (): JSX.Element => (
  <svg viewBox="0 0 24 24">
    <path d="m7 7 10 10M17 7 7 17" />
  </svg>
)

export const iconSpin = (): JSX.Element => (
  <svg viewBox="0 0 24 24">
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v6h-6" />
  </svg>
)

function parseNumberCursor(cursor: string): number {
  const value = Number.parseInt(cursor, 10)
  return Number.isNaN(value) ? 0 : value
}

function parseRuntimeV2(): boolean {
  // Legacy path is the safe default (plan §H fallback policy). The block
  // runtime path activates only when the flag is explicitly set — the
  // integration layer flips it after wiring a real runtime context.
  const value = (globalThis as { __CHAT_RELAY_RUNTIME_V2__?: unknown }).__CHAT_RELAY_RUNTIME_V2__
  return value === true || value === "true" || value === 1 || value === "1"
}

interface RuntimeDescriptor {
  functionalityID: "builtin:chat-relay"
  id: string
  bindings: { sessionID?: string }
  layout: {
    x: number
    y: number
    width: number
    height: number
  }
}

function createRuntimeDescriptor(props: ChatRelayBodyProps): RuntimeDescriptor {
  return {
    functionalityID: "builtin:chat-relay",
    id: props.block.id,
    bindings: { sessionID: props.block.bindings?.sessionID },
    layout: { x: 0, y: 0, width: 0, height: 0 },
  }
}

function runtimeToState(snapshot: RuntimeSnapshot<RuntimeResourceState>, descriptor: RuntimeDescriptor) {
  return ChatRelayRuntimeAdapter.select(descriptor, snapshot.state)
}

function runtimeStateFromContext(context: ChatRelayRuntimeContext, descriptor: RuntimeDescriptor) {
  const initialState = (context as { state?: RuntimeResourceState }).state
  if (!initialState) {
    return {
      connectionStatus: "disconnected" as const,
      messages: [],
      pendingPermissions: [],
      errors: [],
    }
  }

  return runtimeToState(
    {
      cursor: "0",
      state: initialState,
    },
    descriptor,
  )
}

function getRuntimeContext(): ChatRelayRuntimeContext {
  const globalRuntimeContext = (globalThis as {
    __CHAT_RELAY_RUNTIME_CONTEXT__?: ChatRelayRuntimeContext | (() => ChatRelayRuntimeContext)
    window?: {
      __CHAT_RELAY_RUNTIME_CONTEXT__?: ChatRelayRuntimeContext | (() => ChatRelayRuntimeContext)
    }
  }).__CHAT_RELAY_RUNTIME_CONTEXT__
  const windowRuntimeContext =
    (globalThis as { window?: { __CHAT_RELAY_RUNTIME_CONTEXT__?: ChatRelayRuntimeContext | (() => ChatRelayRuntimeContext) } }).window
      ?.
      __CHAT_RELAY_RUNTIME_CONTEXT__

  const provided = globalRuntimeContext ?? windowRuntimeContext
  return typeof provided === "function" ? provided() : provided || createMockChatRelayContext()
}

function RuntimeChatRelayBody(props: ChatRelayBodyProps) {
  const [cursor, setCursor] = createSignal("0")
  const [error, setError] = createSignal<string>()
  const [promptText, setPromptText] = createSignal("")
  const [isSubmitting, setSubmitting] = createSignal(false)
  const initialContext = getRuntimeContext()
  let context: ChatRelayRuntimeContext | undefined
  context = initialContext
  const [runtimeState, setRuntimeState] = createSignal<ChatRelayRuntimeView>({
    ...runtimeStateFromContext(initialContext, createRuntimeDescriptor(props)),
  })

  const networkDenied = () =>
    permissionDenied(props.permissions, "webfetch") || permissionDenied(props.permissions, "websearch")
  let unsubscribe: (() => void) | undefined

  const descriptor = createRuntimeDescriptor(props)
  const bindings = ChatRelayRuntimeAdapter.getBindings(descriptor)

  const applySnapshot = (snapshot: RuntimeSnapshot<RuntimeResourceState>) => {
    setCursor(snapshot.cursor)
    setRuntimeState(runtimeToState(snapshot, descriptor))
  }

  const refresh = async () => {
    if (!context) return
    const snapshot = await context.snapshot(bindings)
    applySnapshot(snapshot)
  }

  const dispatchCommand = async (command: ChatRelayCommand) => {
    if (!context) return
    await ChatRelayRuntimeAdapter.dispatch(descriptor, command, context)
  }

  const handleSubmit = async (event: Event) => {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    try {
      await dispatchCommand({ type: "session.prompt", text: promptText(), delivery: "queue" })
      setPromptText("")
    } catch {
      setError("Submit failed")
    } finally {
      setSubmitting(false)
    }
  }

  const startSignIn = async () => {
    await dispatchCommand({ type: "auth.start", providerID: "opencode" })
  }

onMount(() => {
    if (networkDenied()) return
    void refresh().then(async () => {
      const baseline = cursor()
      unsubscribe = context?.subscribe(bindings, baseline, async (event) => {
        if (parseNumberCursor(event.cursor) <= parseNumberCursor(cursor())) return
        const snapshot = await context?.snapshot(bindings)
        if (!snapshot) return
        applySnapshot(snapshot)
      })

      await context?.snapshot(bindings)
    })
  })

  onCleanup(() => {
    unsubscribe?.()
  })

  createEffect(() => {
    const nextError = runtimeState().errors.at(0)
    if (nextError) {
      setError(nextError)
    }
  })

  return (
    <div class="canvas-relay-layout">
      <Show when={networkDenied()}>
        <div class="canvas-relay-state denied">
          <div class="canvas-relay-state-icon">{iconClose()}</div>
          <div class="canvas-relay-state-title">Permission denied</div>
          <div class="canvas-relay-state-note">
            The project config denies network access (webfetch/websearch). Edit the project config to allow it.
          </div>
        </div>
      </Show>
      <Show when={!networkDenied() && runtimeState().auth?.status === "awaiting-login"}>
        <div class="canvas-relay-state needs-login">
          <div class="canvas-relay-state-icon" aria-hidden="true">
            {iconClose()}
          </div>
          <div class="canvas-relay-state-title">Waiting for sign-in</div>
          <div class="canvas-relay-state-note">This relay requires authentication for this workspace.</div>
          <button type="button" class="canvas-relay-init-button" onClick={() => void startSignIn()}>
            Sign in
          </button>
        </div>
      </Show>
      <Show when={!networkDenied() && runtimeState().auth?.status !== "awaiting-login"}>
        <Show when={runtimeState().connectionStatus === "disconnected"}>
          <div class="canvas-relay-banner">Disconnected from relay</div>
        </Show>
        <Show when={error()}>
          <div class="canvas-relay-error">{error()}</div>
        </Show>
          <For each={runtimeState().messages}>
            {(message) => <div class="canvas-relay-message-text">{message.text}</div>}
          </For>
          <Show when={runtimeState().pendingPermissions.length > 0}>
            <div class="canvas-relay-permission-panel" data-testid="chat-relay-permissions">
              <For each={runtimeState().pendingPermissions}>
              {(permission) => (
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      void dispatchCommand({ type: "permission.respond", requestID: permission.requestID, response: "allow-once" })
                    }
                  >
                    Allow once
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void dispatchCommand({
                        type: "permission.respond",
                        requestID: permission.requestID,
                        response: "allow-always",
                      })
                    }
                  >
                    Allow always
                  </button>
                  <button
                    type="button"
                    onClick={() => void dispatchCommand({ type: "permission.respond", requestID: permission.requestID, response: "deny" })}
                  >
                    Deny
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
        <form onSubmit={handleSubmit}>
          <textarea
            value={promptText()}
            onInput={(event) => setPromptText((event.currentTarget as HTMLTextAreaElement).value)}
          />
          <button type="submit" disabled={isSubmitting()}>
            Send
          </button>
        </form>
      </Show>
    </div>
  )
}

function LegacyChatRelayBody(props: ChatRelayBodyProps) {
  const serverSDK = useServerSDK()
  const [binding, setBinding] = createSignal<{
    workspaceID: string
    blockID: string
    functionalityInstanceID: string
    sessionID: string
    directory?: string
    generation: number
    revision: number
  }>()
  const [status, setStatus] = createSignal<"uninitialized" | "loading" | "ready" | "error">("uninitialized")

  const networkDenied = () =>
    permissionDenied(props.permissions, "webfetch") || permissionDenied(props.permissions, "websearch")

  const ensureBinding = async () => {
    if (networkDenied()) return
    if (!props.workspaceID) return
    if (status() === "loading") return
    setStatus("loading")
    try {
      const result = await serverSDK().client.v2.workspace.chatRelay.ensure(
        { workspaceID: props.workspaceID, blockID: props.block.id },
        { throwOnError: true },
      )
      setBinding(result.data)
      setStatus("ready")
    } catch {
      setBinding(undefined)
      setStatus("error")
    }
  }

  onMount(() => {
    void ensureBinding()
  })

  // The canvas mounts blocks before the manager finishes resolving the
  // workspace ID (workspaceID is "" at mount). Retry the binding once the ID
  // arrives instead of leaving the block stuck on the uninitialized state.
  createEffect(() => {
    if (props.workspaceID && status() === "uninitialized") void ensureBinding()
  })

  const sessionOptions = () => {
    const current = binding()
    if (!current) return undefined
    return createMasterAgentSessionOptions({
      sessionID: current.sessionID,
      directory: current.directory,
      workspaceID: current.workspaceID,
    })
  }

  const statusTitle = () => {
    if (status() === "loading") return "Preparing chat relay"
    if (status() === "error") return "Relay unavailable"
    return "Block needs a chat relay binding"
  }

  const statusNote = () => {
    if (status() === "loading") return "Creating or loading the chat relay session for this block."
    if (status() === "error") return "The chat relay binding failed. Retry initialization."
    return "This block relays to your chat account and cannot route until a session is bound."
  }

  const statusIcon = () => {
    if (status() === "loading") return iconSpin()
    if (status() === "error") return iconClose()
    return iconRelay()
  }

  return (
    <div class="canvas-relay-layout">
      <Show when={networkDenied()}>
        <div class="canvas-relay-state denied">
          <div class="canvas-relay-state-icon">{iconClose()}</div>
          <div class="canvas-relay-state-title">Permission denied</div>
          <div class="canvas-relay-state-note">
            The project config denies network access (webfetch/websearch). Edit the project config to allow it.
          </div>
        </div>
      </Show>
      <Show when={!networkDenied() && status() !== "ready"}>
        <div class="canvas-relay-state" classList={{ error: status() === "error" }}>
          <Show
            when={status() === "loading"}
            fallback={
              <div class="canvas-relay-state-icon" aria-hidden="true">
                {statusIcon()}
              </div>
            }
          >
            <div class="canvas-relay-spinner" aria-hidden="true">
              {statusIcon()}
            </div>
          </Show>
          <div class="canvas-relay-state-title">{statusTitle()}</div>
          <div class="canvas-relay-state-note">{statusNote()}</div>
          <Show when={status() === "error"}>
            <button type="button" class="canvas-relay-init-button" onClick={() => void ensureBinding()}>
              Retry
            </button>
          </Show>
        </div>
      </Show>
      <Show when={!networkDenied() && status() === "ready"}>
        <Show when={sessionOptions()}>
          {(options) => (
            <CanvasSessionSurfaceProviders directory={options().target.directory}>
              <CanvasSessionSurface
                target={options().target}
                surfaceID={\`chat-relay-${props.block.id}\`}
                focused={props.focused}
                onFocus={props.onFocus}
                queueEnabled={options().queueEnabled}
              />
            </CanvasSessionSurfaceProviders>
          )}
        </Show>
      </Show>
    </div>
  )
}

export function ChatRelayBody(props: ChatRelayBodyProps): JSX.Element {
  if (parseRuntimeV2()) {
    return <RuntimeChatRelayBody {...props} />
  }
  return <LegacyChatRelayBody {...props} />
}

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

### `packages/app/src/pages/canvas/blocks/chat-relay/types.ts (114 lines)`

```ts
import type { PermissionConfig } from "@opencode-ai/sdk/v2/client"

export interface BlockDescriptor {
  id: string
  functionalityID: string
  layout: { x: number; y: number; width: number; height: number }
  bindings: Record<string, string | undefined>
  config?: unknown
}

export interface ChatRelayBlockDescriptor extends BlockDescriptor {
  functionalityID: "builtin:chat-relay"
  bindings: { sessionID?: string }
  config?: { showTools?: boolean; showPermissions?: boolean; showTerminal?: boolean }
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
  connection: { status: "connecting" | "connected" | "disconnected"; cursor?: string; lastError?: string }
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
  hydrate(descriptor: TDescriptor, context: BlockRuntimeContext): Promise<RuntimeSnapshot<unknown>>
  select(descriptor: TDescriptor, resources: RuntimeResourceState): TView
  dispatch(descriptor: TDescriptor, command: TCommand, context: BlockRuntimeContext): Promise<void>
}

export type ChatRelayCommand =
  | { type: "auth.start"; providerID: string }
  | { type: "session.create"; modelID?: string; agentID?: string }
  | { type: "session.prompt"; text: string; delivery: "steer" | "queue" }
  | { type: "session.abort" }
  | { type: "permission.respond"; requestID: string; response: "allow-once" | "allow-always" | "deny" }

export interface ChatRelayBodyProps {
  block: { id: string; bindings?: Record<string, string | undefined> }
  permissions?: PermissionConfig
  workspaceID: string
  focused: boolean
  onFocus(): void
}

```

### `packages/app/src/pages/canvas/blocks/chat-relay/index.ts (3 lines)`

```ts
export { ChatRelayBody, iconClose, iconRelay, iconSpin } from "./view"
export type { ChatRelayBodyProps } from "./types"

```

### `packages/app/src/pages/canvas/runtime/block-runtime-host.tsx (92 lines)`

```tsx
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createSignal, onCleanup, type JSX } from "solid-js"
import type { BlockRuntimeRegistration, BlockRuntimeServices, RuntimeBlockHandle, RuntimeStatus } from "./contracts"

export const BlockRuntimeHandleContext = createSimpleContext({
  name: "BlockRuntimeHandle",
  init: (props: { value: RuntimeBlockHandle }) => props.value,
})

export function useBlockRuntimeHandle(): RuntimeBlockHandle | undefined {
  return BlockRuntimeHandleContext.use()
}

export function BlockRuntimeHost(props: {
  blockID: string
  functionalityID: string
  registration?: BlockRuntimeRegistration<unknown, unknown, unknown>
  services?: BlockRuntimeServices
  workspaceID?: string
  workspaceEpoch?: number
  children: JSX.Element
}) {
  // v1: without a registration the host is a pass-through wrapper. Wave 2
  // adapters (H/I/...) supply real registrations and services.
  const active = !!props.registration
  const [status, setStatus] = createSignal<RuntimeStatus>(active ? "resolving" : "ready")
  const [view, setView] = createSignal<unknown>(undefined)
  const [error, setError] = createSignal<unknown>(undefined)

  let resolved: unknown
  const controller = new AbortController()

  if (active && props.registration && props.services) {
    const registration = props.registration
    const services = props.services
    void (async () => {
      try {
        resolved = await registration.resolve({
          workspaceID: props.workspaceID ?? "",
          block: {
            id: props.blockID,
            functionalityID: props.functionalityID,
            transform: { x: 0, y: 0, w: 0, h: 0, z: 0 },
          },
          services,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setView(registration.select({ resolved, projection: undefined, localView: undefined }))
        setStatus("ready")
      } catch (cause) {
        if (controller.signal.aborted) return
        setError(cause)
        setStatus("error")
      }
    })()
  }

  const handle: RuntimeBlockHandle = {
    status: () => status(),
    view: () => view(),
    error: () => error(),
    async refresh() {
      if (!active || !props.registration || !resolved) return
      setStatus("stale")
      setView(props.registration.select({ resolved, projection: undefined, localView: undefined }))
      setStatus("ready")
    },
    async dispatch(command: unknown) {
      if (!active || !props.registration || !props.services || !resolved) return
      await props.registration.dispatch?.({ resolved, command, services: props.services, signal: controller.signal })
    },
    dispose() {
      controller.abort()
      props.registration?.dispose?.(resolved)
    },
  }

  onCleanup(() => handle.dispose())

  // C8: the runtime identity includes workspaceEpoch + workspaceID + blockID +
  // functionalityID — the key is what Wave-2 shared resource buckets use.
  const identityKey = [props.workspaceEpoch ?? 0, props.workspaceID ?? "", props.blockID, props.functionalityID].join("::")
  void identityKey

  return (
    <BlockRuntimeHandleContext.provider value={handle}>
      {props.children}
    </BlockRuntimeHandleContext.provider>
  )
}

```

### `packages/app/src/pages/canvas/runtime/provider.tsx (48 lines)`

```tsx
import { createSimpleContext } from "@opencode-ai/ui/context"
import { onCleanup, type JSX } from "solid-js"
import type { BlockRuntimeServices, BlockLocalViewStore } from "./contracts"
import { createBlockRuntimeEventRouter } from "./event-router"
import { createBlockRuntimeRegistry } from "./registry"

const BlockRuntimeServicesContext = createSimpleContext({
  name: "BlockRuntimeServices",
  init: (props: { value: BlockRuntimeServices }) => props.value,
})

export function useBlockRuntimeServices(): BlockRuntimeServices | undefined {
  return BlockRuntimeServicesContext.use()
}

export function BlockRuntimeProvider(props: {
  workspaceID: () => string | undefined
  workspaceEpoch: () => number
  connected: () => boolean
  awaitDescriptorPersisted: (blockID: string, signal: AbortSignal) => Promise<void>
  localView: BlockLocalViewStore
  children: JSX.Element
}) {
  // v1 seam: the router subscribes the app event stream via a listen function
  // injected by M at integration (serverSDK().event.listen). Until then it is
  // a passive router with no backing stream.
  const router = createBlockRuntimeEventRouter({ listen: () => () => {} })
  const registry = createBlockRuntimeRegistry()

  const services: BlockRuntimeServices = {
    serverSDK: undefined as never,
    eventRouter: router as never,
    workspace: {
      id: () => props.workspaceID(),
      epoch: () => props.workspaceEpoch(),
      connected: () => props.connected(),
      awaitDescriptorPersisted: props.awaitDescriptorPersisted,
    },
    localView: props.localView,
  }

  onCleanup(() => {
    router.dispose()
  })

  return <BlockRuntimeServicesContext.provider value={services}>{props.children}</BlockRuntimeServicesContext.provider>
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
