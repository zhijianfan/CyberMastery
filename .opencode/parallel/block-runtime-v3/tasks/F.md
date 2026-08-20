You are worker 6 of 7 (Wave 1) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task F — Reusable host-owned session-binding runtime adapter

Goal: extract the common lifecycle used by ChatRelay and MasterAgent into a
reusable runtime adapter factory, keeping each domain's existing API and
business rules. H and I will configure this factory; it must contain NO
ChatRelay or MasterAgent specific text/UI.

## Required factory (all in NEW files under
`packages/app/src/pages/canvas/runtime/adapters/`)

```ts
createHostSessionBindingRegistration<B, ResetCommand>({
  functionalityID,
  get,        // (services, signal) => Promise<{ status: "unbound" } | { status: "bound"; binding: B }>
  ensure,     // (services, signal) => Promise<B>
  reset,      // (binding: B, services, signal) => Promise<void>
  normalizeError, // (error: unknown) => RuntimeStatus-usable classification
  eventTypes, // readonly string[] — generic FunctionalityInstance event + legacy domain events
  validateBinding, // (unknown) => B | undefined
})
```

Resolved projection:

```ts
type HostSessionBindingState<B> =
  | { status: "unbound" }
  | { status: "bound"; binding: B }
```

Required behavior:
1. Wait for workspace ID and `awaitDescriptorPersisted(blockID, signal)` before
   `ensure` (services.workspace from the frozen BlockRuntimeServices).
2. Initial mount: `get`, then `ensure` ONLY when domain policy requires
   automatic binding (both current domains do).
3. Match the generic FunctionalityInstance changed event
   (`workspace.functionality.instance.changed`) by workspace/block/functionality.
4. During migration also match the legacy binding events listed in `eventTypes`.
5. Revision-order events; lower/equal revision ignored.
6. Coalesce event invalidation into one authoritative `get`.
7. Reconnect performs `get`/`ensure`.
8. Reset uses the current binding (session ID + revision); busy/stale handled
   distinctly; refreshes after stale; never deletes the old session.
9. Dispose aborts requests and removes listeners; does NOT cancel session work.
10. No binding is written to browser persistence.

The registration shape returned must satisfy `BlockRuntimeRegistration` from
A's `contracts.ts` (mode "native", TResolved = HostSessionBindingState<B>,
TCommand = ResetCommand, select returns the binding view). Use the frozen
interfaces; do not import SolidJS values into the factory core (types only).

## Required tests (new files beside the factory)

- unbound → ensure → bound;
- concurrent ensure calls converge (one ensure, both resolve);
- event arrives before initial get completes;
- stale/lower-revision event ignored;
- reconnect performs refetch;
- reset busy (delegated, error surfaced);
- reset stale then refetch;
- workspace epoch change disposes and re-resolves;
- block removed while ensure in flight (abort, no state leak);
- two blocks have isolated bindings.

Use fake ports/events (no timers).

## Owned files (edit ONLY these)

- `packages/app/src/pages/canvas/runtime/adapters/session-binding.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/adapters/session-binding.test.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/adapters/HANDOFF-F.md`

Do NOT edit ChatRelay, MasterAgent, manager, workspace page, backend services,
or runtime core owned by A/C/D.

## Targeted validation (allowed)

- `cd packages/app && bun test src/pages/canvas/runtime/adapters/session-binding.test.ts`
- `bun run typecheck` from `packages/app`

## Handoff

`HANDOFF-F.md`: factory export signature · ONE minimal configuration example
for ChatRelay (using `v2.workspace.chatRelay.get/ensure/reset`) and ONE for
MasterAgent (using `v2.workspace.masterAgent.*`) · tests + results · integration
actions M must take · prohibited-pattern grep result.



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


### `packages/core/src/workspace/chat-relay-session.ts (390 lines)`

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
}) {}

export class BusyError extends Schema.TaggedErrorClass<BusyError>()("ChatRelay.BusyError", {
  sessionID: SessionSchema.ID,
}) {}

// Narrow session port: the ChatRelay session service only needs session
// creation, liveness, and best-effort cleanup of candidate sessions that lose
// the repository CAS, so it does not drag the full session execution engine
// into its dependency graph. The opencode/server composition provides the live
// adapter (sessionPortLive); tests provide a lightweight stub.
export interface SessionPort {
  readonly create: (input: {
    id?: SessionSchema.ID
    location: { directory: typeof AbsolutePath.Type; workspaceID?: Workspace.ID }
  }) => Effect.Effect<SessionSchema.Info>
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  // Best-effort removal of a session that was created as a candidate binding
  // but lost the repository CAS. Only unbound, empty sessions are removed.
  readonly cleanupLosingCandidate: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<"removed" | "not-empty" | "unsupported">
}

export class SessionPortService extends Context.Service<SessionPortService, SessionPort>()("@opencode/v2/ChatRelaySessionPort") {}

export const sessionPort = LayerNode.unbound(SessionPortService, tags.values.global)

export const sessionPortLive = LayerNode.make({
  service: SessionPortService,
  layer: Layer.effect(
    SessionPortService,
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      return SessionPortService.of({
        create: (input) =>
          sessions.create({
            id: input.id,
            location: {
              directory: input.location.directory,
              workspaceID: input.location.workspaceID,
            },
          }),
        active: sessions.active,
        cleanupLosingCandidate: (sessionID) =>
          sessions.messages({ sessionID, limit: 1 }).pipe(
            Effect.matchEffect({
              onSuccess: (messages) =>
                Effect.succeed(messages.length > 0 ? ("not-empty" as const) : ("unsupported" as const)),
              // Unreadable sessions are never removed; the session domain has no
              // deletion API yet, so cleanup is a best-effort no-op there.
              onFailure: () => Effect.succeed("not-empty" as const),
            }),
          ),
      })
    }),
  ),
  deps: [SessionV2.node],
})

export interface Interface {
  readonly get: (workspaceID: Workspace.ID, blockID: string) => Effect.Effect<
    ChatRelay.Binding | undefined,
    WorkspaceNotFoundError | BlockNotFoundError | WrongFunctionalityError
  >
  readonly ensure: (workspaceID: Workspace.ID, blockID: string) => Effect.Effect<
    ChatRelay.Binding,
    WorkspaceNotFoundError | BlockNotFoundError | WrongFunctionalityError
  >
  readonly reset: (
    workspaceID: Workspace.ID,
    blockID: string,
    expectedSessionID: SessionSchema.ID,
    expectedRevision: number,
  ) => Effect.Effect<
    ChatRelay.Binding,
    WorkspaceNotFoundError | BlockNotFoundError | WrongFunctionalityError | StaleBindingError | BusyError | InstanceNotFoundError
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ChatRelaySession") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const workspaceService = yield* WorkspaceService.Service
    const instances = yield* FunctionalityInstance.Service
    const sessions = yield* SessionPortService
    const events = yield* EventV2.Service

    function requireWorkspace(workspaceID: Workspace.ID) {
      return Effect.gen(function* () {
        const info = yield* workspaceService.get(workspaceID)
        if (!info) return yield* new WorkspaceNotFoundError({ workspaceID })
        return info
      })
    }

    function verifyBlock(workspaceID: Workspace.ID, blockID: string) {
      return Effect.gen(function* () {
        const layout = yield* workspaceService.layout.get(
          workspaceID,
          { user: "", style: "default", deviceClass: "desktop" },
          "chat-relay-service",
          { claimAuthority: false },
        )
        const block = layout.blocks.find((entry) => entry.id === blockID)
        if (!block) return yield* new BlockNotFoundError({ workspaceID, blockID })
        if (block.functionality !== "builtin:chat-relay") {
          return yield* new WrongFunctionalityError({ blockID })
        }
        return block
      })
    }

    function parseConfiguration(configuration: unknown) {
      return ChatRelay.InstanceConfiguration.make(
        (configuration ?? {
          version: 1,
          directoryBinding: { mode: "workspace-primary" },
          sessionBinding: null,
        }) as ChatRelay.InstanceConfiguration,
      )
    }

    // The directory binding is resolved before session creation so a fixed
    // binding survives an unbound instance and later resets; workspace-primary
    // falls back to the first workspace directory (or the process cwd).
    function resolveDirectory(workspace: Workspace.Info, configuration: unknown) {
      const config = parseConfiguration(configuration)
      if (config.directoryBinding.mode === "fixed") return config.directoryBinding.directory
      return workspace.directories[0] ?? process.cwd()
    }

    function toBinding(
      instance: FunctionalityInstance.Instance,
      sessionID: SessionSchema.ID,
      directory: string,
      generation: number,
    ): ChatRelay.Binding {
      return ChatRelay.Binding.make({
        workspaceID: instance.workspaceID,
        blockID: instance.blockID,
        functionalityInstanceID: instance.id,
        sessionID,
        directory,
        generation,
        revision: instance.revision,
      })
    }

    function bindingFromInstance(
      instance: FunctionalityInstance.Instance,
      workspace: Workspace.Info,
    ): ChatRelay.Binding | undefined {
      const config = parseConfiguration(instance.configuration)
      const binding = config.sessionBinding
      if (!binding || binding.mode !== "owned") return undefined
      return toBinding(instance, binding.sessionID, resolveDirectory(workspace, config), binding.generation)
    }

    function readBinding(workspaceID: Workspace.ID, blockID: string) {
      return Effect.gen(function* () {
        const instance = yield* instances.get(workspaceID, blockID, "builtin:chat-relay")
        if (!instance) return undefined
        const workspace = yield* requireWorkspace(workspaceID)
        return bindingFromInstance(instance, workspace)
      })
    }

    function hasPendingInput(sessionID: SessionSchema.ID) {
      return Effect.gen(function* () {
        const row = yield* db
          .select({ id: SessionInputTable.id })
          .from(SessionInputTable)
          .where(and(eq(SessionInputTable.session_id, sessionID), isNull(SessionInputTable.promoted_seq)))
          .limit(1)
          .get()
          .pipe(Effect.orDie)
        return row !== undefined
      })
    }

    function isActive(sessionID: SessionSchema.ID) {
      return Effect.gen(function* () {
        return (yield* sessions.active).has(sessionID)
      })
    }

    // Repository CAS against the instance read before the transition. A
    // vanished row (only possible via a workspace cascade delete) degrades to
    // a conflict carrying the last known instance so callers keep their loser
    // path instead of surfacing a repository error.
    function swapConfiguration(instance: FunctionalityInstance.Instance, nextConfiguration: unknown) {
      return instances
        .compareAndSwapConfiguration({
          instanceID: instance.id,
          expectedRevision: instance.revision,
          nextConfiguration,
        })
        .pipe(
          Effect.catchTag("FunctionalityInstance.InstanceNotFoundError", () =>
            Effect.succeed({ type: "conflict" as const, current: instance }),
          ),
        )
    }

    // Atomically claims the instance row for a candidate binding: inserts it
    // when absent, otherwise CASes on the revision read before the candidate
    // session was created. A tombstoned row is resurrected through the CAS.
    const claimInstance = Effect.fn("ChatRelay.claimInstance")(function* (
      workspaceID: Workspace.ID,
      blockID: string,
      previous: FunctionalityInstance.Instance | undefined,
      nextConfiguration: unknown,
    ) {
      if (previous) {
        const claim = yield* swapConfiguration(previous, nextConfiguration)
        if (claim.type === "updated") return { type: "inserted" as const, instance: claim.instance }
        return { type: "conflict" as const, instance: claim.current }
      }
      const existing = yield* instances.getOrCreate({
        workspaceID,
        blockID,
        functionalityID: "builtin:chat-relay",
        configuration: nextConfiguration,
      })
      // "created" means this call won the insert race and owns the row; an
      // "existing" live row means another caller already persisted its
      // binding; an "existing" tombstoned row is resurrected through the
      // revision-guarded CAS.
      if (existing.type === "created") return { type: "inserted" as const, instance: existing.instance }
      if (existing.instance.deletedAt === null) return { type: "conflict" as const, instance: existing.instance }
      const claim = yield* swapConfiguration(existing.instance, nextConfiguration)
      if (claim.type === "updated") return { type: "inserted" as const, instance: claim.instance }
      return { type: "conflict" as const, instance: claim.current }
    })

    const get: Interface["get"] = (workspaceID, blockID) =>
      Effect.gen(function* () {
        yield* requireWorkspace(workspaceID)
        yield* verifyBlock(workspaceID, blockID)
        return yield* readBinding(workspaceID, blockID)
      })

    const ensure: Interface["ensure"] = (workspaceID, blockID) =>
      Effect.gen(function* () {
        const workspace = yield* requireWorkspace(workspaceID)
        yield* verifyBlock(workspaceID, blockID)
        const existing = yield* readBinding(workspaceID, blockID)
        if (existing) return existing

        // Resolve the directory binding before creating the session so a
        // fixed binding on an unbound instance is honored.
        const previous = yield* instances.get(workspaceID, blockID, "builtin:chat-relay")
        const previousConfig = parseConfiguration(previous?.configuration)
        const directory = resolveDirectory(workspace, previousConfig)
        const candidate = yield* sessions.create({
          location: {
            directory: AbsolutePath.make(directory),
            workspaceID,
          },
        })
        const nextConfiguration = ChatRelay.InstanceConfiguration.make({
          version: 1,
          directoryBinding: previousConfig.directoryBinding,
          sessionBinding: { mode: "owned", sessionID: candidate.id, generation: 0 },
        })
        const claim = yield* claimInstance(workspaceID, blockID, previous, nextConfiguration)
        if (claim.type === "conflict") {
          // A concurrent caller persisted its binding first. Return the
          // winning binding and discard only the session we created, which
          // is unbound and never visible.
          yield* sessions.cleanupLosingCandidate(candidate.id)
          const winner = bindingFromInstance(claim.instance, workspace)
          if (winner) return winner
          const rebound = yield* readBinding(workspaceID, blockID)
          if (rebound) return rebound
          return yield* ensure(workspaceID, blockID)
        }
        yield* events.publish(ChatRelay.BindingUpdated, {
          workspaceID,
          blockID,
          sessionID: candidate.id,
          generation: 0,
          revision: claim.instance.revision,
        })
        return toBinding(claim.instance, candidate.id, directory, 0)
      })

    const reset: Interface["reset"] = (workspaceID, blockID, expectedSessionID, expectedRevision) =>
      Effect.gen(function* () {
        const workspace = yield* requireWorkspace(workspaceID)
        yield* verifyBlock(workspaceID, blockID)
        const instance = yield* instances.get(workspaceID, blockID, "builtin:chat-relay")
        if (!instance) return yield* new InstanceNotFoundError({ workspaceID, blockID })
        if (instance.revision !== expectedRevision) {
          return yield* new StaleBindingError({ currentRevision: instance.revision })
        }
        const config = parseConfiguration(instance.configuration)
        const currentBinding = config.sessionBinding
        if (!currentBinding || currentBinding.mode !== "owned" || currentBinding.sessionID !== expectedSessionID) {
          return yield* new StaleBindingError({ currentRevision: instance.revision })
        }
        if ((yield* hasPendingInput(expectedSessionID)) || (yield* isActive(expectedSessionID))) {
          return yield* new BusyError({ sessionID: expectedSessionID })
        }
        // Resolve the directory binding before creating the replacement session;
        // a fixed binding survives resets.
        const directory = resolveDirectory(workspace, config)
        const candidate = yield* sessions.create({
          location: {
            directory: AbsolutePath.make(directory),
            workspaceID,
          },
        })
        const generation = currentBinding.generation + 1
        const next = ChatRelay.InstanceConfiguration.make({
          version: 1,
          directoryBinding: config.directoryBinding,
          sessionBinding: { mode: "owned", sessionID: candidate.id, generation },
        })
        const claim = yield* swapConfiguration(instance, next)
        if (claim.type === "conflict") {
          // Another caller persisted a transition first; drop our unbound
          // candidate and surface the current revision for a retry.
          yield* sessions.cleanupLosingCandidate(candidate.id)
          return yield* new StaleBindingError({ currentRevision: claim.current.revision })
        }
        yield* events.publish(ChatRelay.BindingUpdated, {
          workspaceID,
          blockID,
          sessionID: candidate.id,
          generation,
          revision: claim.instance.revision,
        })
        return toBinding(claim.instance, candidate.id, directory, generation)
      })

    return Service.of({ get, ensure, reset })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, WorkspaceService.node, FunctionalityInstance.node, EventV2.node, sessionPortLive],
})

```

### `packages/app/src/pages/canvas/master-agent/lifecycle-controller.ts (172 lines)`

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

  function dispatch(event: MasterAgentEvent) {
    if (disposed) return
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

### `packages/app/src/pages/canvas/master-agent/block.tsx (167 lines)`

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

import { onCleanup, onMount, Show } from "solid-js"
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

  onMount(() => {
    void props.manager.ensure(props.blockID)
  })

  onCleanup(() => {
    // Removal/unmount must not delete or cancel the host session: only the
    // local projection is dropped; the host keeps the Session and its queue.
    props.manager.removeLocalProjection(props.blockID)
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

  const canReset = () => {
    const current = state()
    if (current.status !== "ready") return false
    return !busy()
  }

  const resetDisabledReason = () => {
    const current = state()
    if (current.status === "ready") {
      if (!busy()) return undefined
      return "Session is busy — reset when idle"
    }
    return RESET_DISABLED_REASON[current.status]
  }

  return (
    <MasterAgentBlockShell
      status={state().status}
      focused={props.focused}
      canReset={canReset()}
      resetDisabledReason={resetDisabledReason()}
      onFocus={props.onFocus}
      onRetry={() => void props.manager.retry(props.blockID)}
      onReset={() => void props.manager.reset(props.blockID)}
      onOpenFullPage={props.onRequestOpenFullPage}
      sessionSlot={
        <Show when={sessionOptions()}>
          {(options) => (
            <CanvasSessionSurfaceProviders directory={options().target.directory}>
              <CanvasSessionSurface
                target={options().target}
                surfaceID={\`master-agent-${props.blockID}\`}
                focused={props.focused}
                queueEnabled={queueEnabled()}
                onFocus={props.onFocus}
                onRequestOpenFullPage={props.onRequestOpenFullPage}
              />
            </CanvasSessionSurfaceProviders>
          )}
        </Show>
      }
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
