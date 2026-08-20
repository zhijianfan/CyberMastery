You are worker 2 of 7 (Wave 1) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task B — Backend generic FunctionalityInstance change events

Goal: one generic, small backend event telling the runtime layer WHEN a block's
authoritative functionality instance changed — IDs and revision only, no
configuration or UI state.

Required event (name frozen):

```text
workspace.functionality.instance.changed
{
  workspaceID, blockID, functionalityID, instanceID, revision,
  change: "created" | "updated" | "tombstoned"
}
```

Rules:
- Publish only after the database mutation SUCCEEDS (EventV2 after the SQL run).
- `getOrCreate` publishes only when it actually creates.
- CAS publishes only on `updated`, never on conflict.
- `upsert` publishes `created` or `updated` accurately.
- Tombstone publishes only on successful tombstone.
- Event payload contains NO `configuration`, session ID, prompt, token,
  credential, or view state.
- Existing domain-specific events (ChatRelay/MasterAgent binding events) remain
  untouched until Task O.
- The event is transient; clients refetch on reconnect.

Implementation steps:
1. Create `packages/core/src/workspace/functionality-instance-events.ts` with the
   typed event definition, following the EXACT EventV2 definition pattern shown
   in the inlined `master-agent-events.ts` below (Schema event with durable
   envelope + publish helper).
2. Inject `EventV2.Service` into the FunctionalityInstance service (inlined below)
   and publish from every successful mutation path (create, getOrCreate-create,
   upsert, CAS-update, tombstone).
3. Follow the service's existing error/return conventions exactly; do not change
   public method signatures.
4. Add tests beside the service (or in a sibling test file under
   `packages/core/src/workspace/`) covering: create publishes; getOrCreate
   idempotent (second call publishes nothing); upsert publishes created then
   updated; CAS conflict publishes nothing; tombstone publishes; event payload
   contains no configuration; encode/decode round-trip of the event schema.

## Owned files (edit ONLY these)

- `packages/core/src/workspace/functionality-instance.ts` (event publication only — preserve all existing behavior)
- `packages/core/src/workspace/functionality-instance-events.ts` (NEW)
- `packages/core/src/workspace/functionality-instance-events.test.ts` (NEW)
- `packages/core/src/workspace/HANDOFF-B.md` (handoff)

Do NOT edit frontend files, route aggregation, ChatRelay/MasterAgent business
logic, or generated SDK.

## Targeted validation (allowed)

- `cd packages/core && bun test src/workspace/functionality-instance-events.test.ts`
- `bun run typecheck` from `packages/core`

## Handoff

Write `HANDOFF-B.md`: files changed · tests + exact result · the exact event
`type` string and decoded payload shape that `serverSDK().event.listen` will see
(so C/F can match without reading backend internals) · assumptions · integration
actions (who registers the schema in central event aggregation = M) ·
prohibited-pattern grep result.



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


### `packages/core/src/workspace/functionality-instance.ts (249 lines)`

```ts
export * as FunctionalityInstance from "./functionality-instance"

import { and, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { FunctionalityInstanceTable } from "./sql"

export interface Instance {
  readonly id: string
  readonly workspaceID: Workspace.ID
  readonly blockID: string
  readonly functionalityID: string
  readonly revision: number
  readonly configuration: unknown
  readonly deletedAt: number | null
}

// The instance row is gone. Nothing in the repository deletes rows, so this
// only happens when a workspace (and its instances via cascade) was removed
// concurrently with a revision-guarded operation.
export class InstanceNotFoundError extends Schema.TaggedErrorClass<InstanceNotFoundError>()(
  "FunctionalityInstance.InstanceNotFoundError",
  { instanceID: Schema.String },
) {}

export interface Interface {
  readonly get: (
    workspaceID: Workspace.ID,
    blockID: string,
    functionalityID: string,
  ) => Effect.Effect<Instance | undefined>
  readonly getOrCreate: (input: {
    workspaceID: Workspace.ID
    blockID: string
    functionalityID: string
    configuration: unknown
  }) => Effect.Effect<
    | { type: "created"; instance: Instance }
    | { type: "existing"; instance: Instance }
  >
  readonly upsert: (input: {
    workspaceID: Workspace.ID
    blockID: string
    functionalityID: string
    configuration: unknown
  }) => Effect.Effect<Instance>
  readonly compareAndSwapConfiguration: (input: {
    instanceID: string
    expectedRevision: number
    nextConfiguration: unknown
  }) => Effect.Effect<
    | { type: "updated"; instance: Instance }
    | { type: "conflict"; current: Instance },
    InstanceNotFoundError
  >
  readonly tombstone: (input: {
    instanceID: string
    expectedRevision: number
  }) => Effect.Effect<
    | { type: "tombstoned" }
    | { type: "conflict"; current: Instance },
    InstanceNotFoundError
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FunctionalityInstance") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const get: Interface["get"] = Effect.fn("FunctionalityInstance.get")(function* (
      workspaceID,
      blockID,
      functionalityID,
    ) {
      const row = yield* db
        .select()
        .from(FunctionalityInstanceTable)
        .where(
          and(
            eq(FunctionalityInstanceTable.workspace_id, workspaceID),
            eq(FunctionalityInstanceTable.block_id, blockID),
            eq(FunctionalityInstanceTable.functionality_id, functionalityID),
            isNull(FunctionalityInstanceTable.deleted_at),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row ? fromRow(row) : undefined
    })

    // Idempotent create: the unique (workspace, block, functionality) index
    // decides the winner of a concurrent insert race. "created" means this
    // call owns the row; "existing" carries the row a concurrent writer
    // persisted first, live or tombstoned, so callers can decide between
    // treating it as a conflict and resurrecting it via compare-and-swap.
    const getOrCreate: Interface["getOrCreate"] = Effect.fn("FunctionalityInstance.getOrCreate")(function* (input) {
      const rows = yield* db
        .insert(FunctionalityInstanceTable)
        .values({
          id: crypto.randomUUID(),
          workspace_id: input.workspaceID,
          block_id: input.blockID,
          functionality_id: input.functionalityID,
          revision: 0,
          configuration: input.configuration,
          deleted_at: null,
          time_updated: Date.now(),
        })
        .onConflictDoNothing()
        .returning()
        .pipe(Effect.orDie)
      if (rows.length === 1) return { type: "created" as const, instance: fromRow(rows[0]) }
      const row = yield* db
        .select()
        .from(FunctionalityInstanceTable)
        .where(
          and(
            eq(FunctionalityInstanceTable.workspace_id, input.workspaceID),
            eq(FunctionalityInstanceTable.block_id, input.blockID),
            eq(FunctionalityInstanceTable.functionality_id, input.functionalityID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* Effect.die(new Error("functionality instance vanished after an insert conflict"))
      return { type: "existing" as const, instance: fromRow(row) }
    })

    const upsert: Interface["upsert"] = Effect.fn("FunctionalityInstance.upsert")(function* (input) {
      const existing = yield* db
        .select()
        .from(FunctionalityInstanceTable)
        .where(
          and(
            eq(FunctionalityInstanceTable.workspace_id, input.workspaceID),
            eq(FunctionalityInstanceTable.block_id, input.blockID),
            eq(FunctionalityInstanceTable.functionality_id, input.functionalityID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (existing) {
        const revision = existing.revision + 1
        yield* db
          .update(FunctionalityInstanceTable)
          .set({ revision, configuration: input.configuration, deleted_at: null, time_updated: Date.now() })
          .where(eq(FunctionalityInstanceTable.id, existing.id))
          .run()
          .pipe(Effect.orDie)
        return { ...fromRow(existing), revision, configuration: input.configuration, deletedAt: null }
      }
      const row = {
        id: crypto.randomUUID(),
        workspace_id: input.workspaceID,
        block_id: input.blockID,
        functionality_id: input.functionalityID,
        revision: 0,
        configuration: input.configuration,
        deleted_at: null,
        time_updated: Date.now(),
      }
      yield* db.insert(FunctionalityInstanceTable).values(row).run().pipe(Effect.orDie)
      return fromRow(row)
    })

    // Revision-guarded compare-and-swap: bumps the revision and replaces the
    // configuration only when the row still holds expectedRevision, so two
    // concurrent transitions cannot both persist. The loser receives the
    // winner's current row instead of overwriting it. A CAS on a tombstoned
    // row resurrects it with the next configuration.
    const compareAndSwapConfiguration: Interface["compareAndSwapConfiguration"] = Effect.fn(
      "FunctionalityInstance.compareAndSwapConfiguration",
    )(function* (input) {
      const rows = yield* db
        .update(FunctionalityInstanceTable)
        .set({
          revision: input.expectedRevision + 1,
          configuration: input.nextConfiguration,
          deleted_at: null,
          time_updated: Date.now(),
        })
        .where(
          and(
            eq(FunctionalityInstanceTable.id, input.instanceID),
            eq(FunctionalityInstanceTable.revision, input.expectedRevision),
          ),
        )
        .returning()
        .pipe(Effect.orDie)
      if (rows.length === 1) return { type: "updated" as const, instance: fromRow(rows[0]) }
      const current = yield* db
        .select()
        .from(FunctionalityInstanceTable)
        .where(eq(FunctionalityInstanceTable.id, input.instanceID))
        .get()
        .pipe(Effect.orDie)
      if (!current) return yield* new InstanceNotFoundError({ instanceID: input.instanceID })
      return { type: "conflict" as const, current: fromRow(current) }
    })

    // Revision-guarded tombstone: hides the row from get only when it still
    // holds expectedRevision, so a tombstone cannot clobber a concurrent
    // transition. The host Session record is never touched.
    const tombstone: Interface["tombstone"] = Effect.fn("FunctionalityInstance.tombstone")(function* (input) {
      const rows = yield* db
        .update(FunctionalityInstanceTable)
        .set({ deleted_at: Date.now(), time_updated: Date.now() })
        .where(
          and(
            eq(FunctionalityInstanceTable.id, input.instanceID),
            eq(FunctionalityInstanceTable.revision, input.expectedRevision),
          ),
        )
        .returning()
        .pipe(Effect.orDie)
      if (rows.length === 1) return { type: "tombstoned" as const }
      const current = yield* db
        .select()
        .from(FunctionalityInstanceTable)
        .where(eq(FunctionalityInstanceTable.id, input.instanceID))
        .get()
        .pipe(Effect.orDie)
      if (!current) return yield* new InstanceNotFoundError({ instanceID: input.instanceID })
      return { type: "conflict" as const, current: fromRow(current) }
    })

    return Service.of({ get, getOrCreate, upsert, compareAndSwapConfiguration, tombstone })
  }),
)

function fromRow(row: typeof FunctionalityInstanceTable.$inferSelect): Instance {
  return {
    id: row.id,
    workspaceID: Workspace.ID.make(row.workspace_id),
    blockID: row.block_id,
    functionalityID: row.functionality_id,
    revision: row.revision,
    configuration: row.configuration,
    deletedAt: row.deleted_at,
  }
}

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })

```

### `packages/core/src/workspace/master-agent-events.ts (69 lines)`

```ts
// MasterAgent binding-update event publisher.
//
// The \`workspace.master-agent.binding.updated\` event is a TRANSIENT hint:
// EventV2 delivers it only to live subscribers and never replays it after a
// reconnect. Persisted functionality-instance state is authoritative. Clients
// must refetch the binding through MasterAgentService.get/ensure after
// reconnect instead of trusting events they may have missed
// (devplan/master-agent/master-agent-max-parallel-plan/01-architecture-decisions.md §6).
//
// This publisher performs no persistence of its own. The lifecycle service
// must publish only after the transition has been persisted, and must not
// publish for idempotent ensure or stale CAS results
// (devplan/master-agent/master-agent-max-parallel-plan/02-contracts-and-data-model.md §8).

export * as MasterAgentEvents from "./master-agent-events"

import { Context, Effect, Layer, Schema } from "effect"
import { MasterAgent } from "@opencode-ai/schema/master-agent"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"

export type BindingUpdatedEvent = EventV2.Data<typeof MasterAgent.BindingUpdated>

export class InvalidBindingUpdatedEventError extends Schema.TaggedErrorClass<InvalidBindingUpdatedEventError>()(
  "MasterAgentEvents.InvalidBindingUpdatedEvent",
  { message: Schema.String },
) {}

// Small publisher port (contract §8) so consumers — including the F4 client
// manager — can test against a fake without booting the global event bus.
export interface MasterAgentEventPublisher {
  readonly bindingUpdated: (event: BindingUpdatedEvent) => Effect.Effect<void>
}

export class MasterAgentEventPublisherService extends Context.Service<
  MasterAgentEventPublisherService,
  MasterAgentEventPublisher
>()("@opencode/v2/MasterAgentEventPublisher") {}

// Constructs a publisher from any event source exposing \`publish\`. Every
// payload is validated against the frozen BindingUpdated schema (workspace
// ID, block ID, session ID, generation, revision) before it is published, so
// an invalid event fails loudly instead of being silently dropped.
export const make = (events: Pick<EventV2.Interface, "publish">): MasterAgentEventPublisher =>
  MasterAgentEventPublisherService.of({
    bindingUpdated: (event) =>
      Effect.gen(function* () {
        const data = yield* Schema.decodeUnknownEffect(MasterAgent.BindingUpdated.data)(event).pipe(
          Effect.mapError((error) => new InvalidBindingUpdatedEventError({ message: error.message })),
          Effect.orDie,
        )
        yield* events.publish(MasterAgent.BindingUpdated, data)
      }),
  })

export const layer = Layer.effect(
  MasterAgentEventPublisherService,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    return make(events)
  }),
)

export const node = makeGlobalNode({
  service: MasterAgentEventPublisherService,
  layer,
  deps: [EventV2.node],
})

```

### `packages/core/src/workspace/chat-relay-payload.ts (119 lines)`

```ts
export * as ChatRelayPayload from "./chat-relay-payload"

import { and, desc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { ChatRelayPayloadTable } from "./sql"

export interface DownloadableFile {
  name: string
  url: string
}

// One captured ChatRelay response, stored per workspace. \`index\` is the
// per-workspace monotonic sequence; \`important\` is user-marked; \`timeCreated\`
// is the capture timestamp.
export interface Payload {
  readonly id: string
  readonly workspaceID: Workspace.ID
  readonly conversationId: string
  readonly text: string
  readonly files: readonly DownloadableFile[]
  readonly index: number
  readonly important: boolean
  readonly timeCreated: number
}

export class PayloadNotFoundError extends Schema.TaggedErrorClass<PayloadNotFoundError>()(
  "ChatRelayPayload.PayloadNotFoundError",
  { payloadID: Schema.String },
) {}

export interface Interface {
  readonly append: (input: {
    workspaceID: Workspace.ID
    conversationId: string
    text: string
    files: readonly DownloadableFile[]
  }) => Effect.Effect<Payload>
  readonly list: (workspaceID: Workspace.ID) => Effect.Effect<readonly Payload[]>
  readonly markImportant: (input: {
    workspaceID: Workspace.ID
    payloadID: string
    important: boolean
  }) => Effect.Effect<Payload, PayloadNotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ChatRelayPayload") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const append: Interface["append"] = Effect.fn("ChatRelayPayload.append")(function* (input) {
      const rows = yield* db
        .select({ seq: ChatRelayPayloadTable.seq })
        .from(ChatRelayPayloadTable)
        .where(eq(ChatRelayPayloadTable.workspace_id, input.workspaceID))
        .orderBy(desc(ChatRelayPayloadTable.seq))
        .limit(1)
        .pipe(Effect.orDie)
      const index = (rows[0]?.seq ?? 0) + 1
      const row = {
        id: crypto.randomUUID(),
        workspace_id: input.workspaceID,
        conversation_id: input.conversationId,
        text: input.text,
        files: input.files,
        seq: index,
        important: false,
        time_created: Date.now(),
      }
      yield* db.insert(ChatRelayPayloadTable).values(row).run().pipe(Effect.orDie)
      return fromRow(row)
    })

    const list: Interface["list"] = Effect.fn("ChatRelayPayload.list")(function* (workspaceID) {
      const rows = yield* db
        .select()
        .from(ChatRelayPayloadTable)
        .where(eq(ChatRelayPayloadTable.workspace_id, workspaceID))
        .orderBy(desc(ChatRelayPayloadTable.seq))
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    const markImportant: Interface["markImportant"] = Effect.fn("ChatRelayPayload.markImportant")(function* (input) {
      const rows = yield* db
        .update(ChatRelayPayloadTable)
        .set({ important: input.important })
        .where(and(eq(ChatRelayPayloadTable.id, input.payloadID), eq(ChatRelayPayloadTable.workspace_id, input.workspaceID)))
        .returning()
        .pipe(Effect.orDie)
      const row = rows[0]
      if (!row) return yield* new PayloadNotFoundError({ payloadID: input.payloadID })
      return fromRow(row)
    })

    return Service.of({ append, list, markImportant })
  }),
)

function fromRow(row: typeof ChatRelayPayloadTable.$inferSelect): Payload {
  return {
    id: row.id,
    workspaceID: Workspace.ID.make(row.workspace_id),
    conversationId: row.conversation_id,
    text: row.text,
    files: row.files,
    index: row.seq,
    important: row.important,
    timeCreated: row.time_created,
  }
}

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })

```

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
