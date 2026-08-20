You are worker 1 of 7 (Wave 1) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task A — Shared runtime contracts and schemas

Goal: create one canonical set of runtime types imported by the frontend host,
adapters, and tests. Remove the architectural need for ChatRelay-local duplicate
runtime types.

Design (frozen shapes — implement EXACTLY these exports in a new module
`packages/app/src/pages/canvas/runtime/contracts.ts`):

```ts
export interface CanvasBlockDescriptor {
  id: string
  functionalityID: string
  transform: { x: number; y: number; w: number; h: number; z: number }
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
  resolve(input: { workspaceID: string; block: CanvasBlockDescriptor; services: BlockRuntimeServices; signal: AbortSignal }): Promise<TResolved>
  eventKeys?(resolved: TResolved): readonly RuntimeEventKey[]
  onEvent?(input: { event: ServerEvent; resolved: TResolved; services: BlockRuntimeServices }): "ignore" | "invalidate" | RuntimeProjectionPatch
  select(input: { resolved: TResolved; projection: unknown; localView: unknown }): TView
  dispatch?(input: { resolved: TResolved; command: TCommand; services: BlockRuntimeServices; signal: AbortSignal }): Promise<void>
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
export interface BlockRuntimeEventRouter { /* narrow; C implements — declare only what registrations/select need */ }
export interface BlockLocalViewStore { /* narrow; D implements — declare read/write/delete by key */ }
```

Rules for this module:
- PURE contracts: no SolidJS runtime imports and no SDK value imports. For
  `Accessor<T>`, `ServerSDK`, `ServerEvent`, `AbortSignal` — use `import type`
  ONLY (`import type { Accessor } from "solid-js"` is allowed as a type-only
  import; `import type { ServerSDK, ServerEvent } from "@/context/server-sdk"`).
- The descriptor type must NOT structurally contain `bindings`, `messages`,
  `sessionID`, or `agentKey`.
- Cursors are opaque strings; no numeric parsing helpers.
- `RuntimeEventKey.type` is an open `string`, NOT a closed union of
  session|message|pty|file|review.
- Export a ChatRelay-specific command union? NO — command typing is per-adapter
  via `TCommand`; the generic module must not import any block implementation.

Do NOT edit existing files (no deprecation shims). C owns the old
`runtime/types.ts` replacement; H/I remove ChatRelay duplicates in Wave 2.

contracts.test.ts must cover (compile-time type tests, `@ts-expect-error`-style
negative checks where bun supports them, else runtime shape assertions):
1. a native session-backed registration typechecks;
2. a local Notes registration typechecks;
3. a projected future resource registration typechecks;
4. command typing is per adapter;
5. no session ID in `CanvasBlockDescriptor` (negative test);
6. `RuntimeProjectionPatch` ops accept the exact frozen shapes.

## Owned files (edit ONLY these)

- `packages/app/src/pages/canvas/runtime/contracts.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/contracts.test.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/HANDOFF-A.md` (handoff)

## Targeted validation (allowed)

- `cd packages/app && bun test src/pages/canvas/runtime/contracts.test.ts`
- `bun run typecheck` from `packages/app` (package-scoped only)

## Handoff

Write `HANDOFF-A.md`: files changed · tests run + exact result · exported symbol
list · assumptions · known limitations · integration actions M must take ·
prohibited-pattern grep result over your diff.



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

### `packages/protocol/src/groups/block-runtime.ts (269 lines)`

```ts
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"

import { NonNegativeInt } from "@opencode-ai/schema/schema"

export const RuntimeCursor = Schema.String.annotate({
  identifier: "RuntimeCursor",
  description: 'Runtime cursor in the form "<id>:<sequence>".',
})

export type RuntimeCursor = typeof RuntimeCursor.Type

export const AuthRuntimeState = Schema.Struct({
  providerID: Schema.String,
  status: Schema.Literals(["missing", "awaiting-login", "ready", "error"]),
  loginURL: Schema.String.pipe(Schema.optional),
  userCode: Schema.String.pipe(Schema.optional),
  error: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "AuthRuntimeState" })
export type AuthRuntimeState = typeof AuthRuntimeState.Type

export const SessionRuntimeState = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["idle", "busy"]),
  directory: Schema.String.pipe(Schema.optional),
  modelID: Schema.String.pipe(Schema.optional),
  agentID: Schema.String.pipe(Schema.optional),
  error: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "SessionRuntimeState" })
export type SessionRuntimeState = typeof SessionRuntimeState.Type

export const MessageRuntimeState = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  timeCreated: Schema.Number.pipe(Schema.optional),
  important: Schema.Boolean.pipe(Schema.optional),
}).annotate({ identifier: "MessageRuntimeState" })
export type MessageRuntimeState = typeof MessageRuntimeState.Type

export const MessagePartRuntimeState = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  kind: Schema.Literals(["text", "tool", "reasoning", "permission"]),
  text: Schema.String.pipe(Schema.optional),
  state: Schema.Unknown.pipe(Schema.optional),
  error: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "MessagePartRuntimeState" })
export type MessagePartRuntimeState = typeof MessagePartRuntimeState.Type

export const PermissionRuntimeState = Schema.Struct({
  id: Schema.String,
  requestID: Schema.String,
  sessionID: Schema.String,
  status: Schema.Literals(["pending", "resolved"]),
  response: Schema.Literals(["allow-once", "allow-always", "deny"]).pipe(Schema.optional),
}).annotate({ identifier: "PermissionRuntimeState" })
export type PermissionRuntimeState = typeof PermissionRuntimeState.Type

export const RuntimeConnectionState = Schema.Struct({
  status: Schema.Literals(["connecting", "connected", "disconnected"]),
  cursor: Schema.String.pipe(Schema.optional),
  lastError: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "RuntimeConnectionState" })
export type RuntimeConnectionState = typeof RuntimeConnectionState.Type

export const RuntimeResourceBinding = Schema.Union([
  Schema.Struct({ type: Schema.Literal("auth"), id: Schema.String, parentID: Schema.String.pipe(Schema.optional) }),
  Schema.Struct({ type: Schema.Literal("session"), id: Schema.String, parentID: Schema.String.pipe(Schema.optional) }),
  Schema.Struct({ type: Schema.Literal("message"), id: Schema.String, parentID: Schema.String.pipe(Schema.optional) }),
  Schema.Struct({
    type: Schema.Literal("message-part"),
    id: Schema.String,
    parentID: Schema.String.pipe(Schema.optional),
  }),
  Schema.Struct({ type: Schema.Literal("permission"), id: Schema.String, parentID: Schema.String.pipe(Schema.optional) }),
  Schema.Struct({ type: Schema.Literal("pty"), id: Schema.String, parentID: Schema.String.pipe(Schema.optional) }),
  Schema.Struct({ type: Schema.Literal("file"), id: Schema.String, parentID: Schema.String.pipe(Schema.optional) }),
  Schema.Struct({ type: Schema.Literal("review"), id: Schema.String, parentID: Schema.String.pipe(Schema.optional) }),
]).annotate({ identifier: "RuntimeResourceBinding" })
export type RuntimeResourceBinding = typeof RuntimeResourceBinding.Type

export const RuntimeResourceState = Schema.Struct({
  connection: RuntimeConnectionState,
  authByProvider: Schema.Record(Schema.String, AuthRuntimeState),
  sessionsByID: Schema.Record(Schema.String, SessionRuntimeState),
  messagesByID: Schema.Record(Schema.String, MessageRuntimeState),
  partsByID: Schema.Record(Schema.String, MessagePartRuntimeState),
  permissionsByID: Schema.Record(Schema.String, PermissionRuntimeState),
}).annotate({ identifier: "RuntimeResourceState" })
export type RuntimeResourceState = typeof RuntimeResourceState.Type

export const RuntimeSnapshot = Schema.Struct({
  cursor: RuntimeCursor,
  state: RuntimeResourceState,
}).annotate({ identifier: "RuntimeSnapshot" })
export type RuntimeSnapshot = typeof RuntimeSnapshot.Type

export const RuntimeResyncRequiredPayload = Schema.Struct({
  cursor: RuntimeCursor,
  reason: Schema.String,
}).annotate({ identifier: "RuntimeResyncRequiredPayload" })

export const RuntimeStreamErrorPayload = Schema.Struct({
  code: Schema.String.pipe(Schema.optional),
  message: Schema.String,
}).annotate({ identifier: "RuntimeStreamErrorPayload" })

const envelopeFields = {
  cursor: RuntimeCursor,
  revision: NonNegativeInt.pipe(Schema.optional),
  timestamp: Schema.Number,
}

const authEvent = Schema.Struct({
  event: Schema.Literal("auth.updated"),
  resource: Schema.Struct({ type: Schema.Literal("auth"), id: Schema.String }),
  data: AuthRuntimeState,
  ...envelopeFields,
})

const sessionEvent = Schema.Struct({
  event: Schema.Literals(["session.status", "session.created"]),
  resource: Schema.Struct({
    type: Schema.Literal("session"),
    id: Schema.String,
    parentID: Schema.String.pipe(Schema.optional),
  }),
  data: SessionRuntimeState,
  ...envelopeFields,
})

const messageEvent = Schema.Struct({
  event: Schema.Literal("message.created"),
  resource: Schema.Struct({
    type: Schema.Literal("message"),
    id: Schema.String,
    parentID: Schema.String.pipe(Schema.optional),
  }),
  data: MessageRuntimeState,
  ...envelopeFields,
})

const messagePartEvent = Schema.Struct({
  event: Schema.Literal("message-part.updated"),
  resource: Schema.Struct({
    type: Schema.Literal("message-part"),
    id: Schema.String,
    parentID: Schema.String.pipe(Schema.optional),
  }),
  data: MessagePartRuntimeState,
  ...envelopeFields,
})

const permissionEvent = Schema.Struct({
  event: Schema.Literals(["permission.requested", "permission.resolved"]),
  resource: Schema.Struct({
    type: Schema.Literal("permission"),
    id: Schema.String,
    parentID: Schema.String.pipe(Schema.optional),
  }),
  data: PermissionRuntimeState,
  ...envelopeFields,
})

const connectionErrorEvent = Schema.Struct({
  event: Schema.Literal("connection.error"),
  resource: Schema.Struct({
    type: Schema.Literal("session"),
    id: Schema.String,
    parentID: Schema.String.pipe(Schema.optional),
  }),
  data: RuntimeConnectionState,
  ...envelopeFields,
})

const resyncRequiredEvent = Schema.Struct({
  event: Schema.Literal("resync.required"),
  resource: RuntimeResourceBinding,
  data: RuntimeResyncRequiredPayload,
  ...envelopeFields,
})

const streamErrorEvent = Schema.Struct({
  event: Schema.Literal("stream.error"),
  resource: RuntimeResourceBinding,
  data: RuntimeStreamErrorPayload,
  ...envelopeFields,
})

export const RuntimeEventEnvelope = Schema.Union([
  authEvent,
  sessionEvent,
  messageEvent,
  messagePartEvent,
  permissionEvent,
  connectionErrorEvent,
  resyncRequiredEvent,
  streamErrorEvent,
]).annotate({ identifier: "RuntimeEventEnvelope" })
export type RuntimeEventEnvelope = typeof RuntimeEventEnvelope.Type

export const ChatRelayCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("auth.start"),
    providerID: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("session.create"),
    modelID: Schema.String.pipe(Schema.optional),
    agentID: Schema.String.pipe(Schema.optional),
  }),
  Schema.Struct({
    type: Schema.Literal("session.prompt"),
    text: Schema.String,
    delivery: Schema.Literals(["steer", "queue"]),
  }),
  Schema.Struct({
    type: Schema.Literal("session.abort"),
  }),
  Schema.Struct({
    type: Schema.Literal("permission.respond"),
    requestID: Schema.String,
    response: Schema.Literals(["allow-once", "allow-always", "deny"]),
  }),
]).annotate({ identifier: "ChatRelayCommand" })
export type ChatRelayCommand = typeof ChatRelayCommand.Type

export const ChatRelayCommandEnvelope = Schema.Struct({
  command: ChatRelayCommand,
}).annotate({ identifier: "ChatRelayCommandEnvelope" })
export type ChatRelayCommandEnvelope = typeof ChatRelayCommandEnvelope.Type

export const BlockRuntimeSnapshotRequest = Schema.Struct({
  bindings: Schema.Array(RuntimeResourceBinding),
}).annotate({ identifier: "BlockRuntimeSnapshotRequest" })

export const BlockRuntimeSubscriptionRequest = Schema.Struct({
  bindings: Schema.Array(RuntimeResourceBinding),
  cursor: RuntimeCursor.pipe(Schema.optional),
}).annotate({ identifier: "BlockRuntimeSubscriptionRequest" })

export const BlockRuntimeGroup = HttpApiGroup.make("server.blockRuntime")
  .add(
    HttpApiEndpoint.post("block-runtime.snapshot", "/api/block-runtime/snapshot", {
      payload: BlockRuntimeSnapshotRequest,
      success: RuntimeSnapshot,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.blockRuntime.snapshot",
        summary: "Get runtime snapshot",
        description: "Fetch a snapshot for requested runtime resources and their current cursor/metadata.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("block-runtime.subscribe", "/api/block-runtime/event", {
      query: BlockRuntimeSubscriptionRequest,
      success: HttpApiSchema.StreamSse({ data: RuntimeEventEnvelope }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.blockRuntime.subscribe",
        summary: "Subscribe to block runtime events",
        description: "Stream runtime events for requested bindings, starting from the optional cursor when supported.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "blockRuntime", description: "Runtime block resource stream and snapshot routes." }))

```
