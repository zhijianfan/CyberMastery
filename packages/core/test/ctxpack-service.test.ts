import { describe, expect, test } from "bun:test"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import type { CtxPackCreateRequest, CtxPackListRequest, CtxPackPatchRequest } from "@opencode-ai/schema/ctxpack"
import { ensureCtxPackFts, make, CtxPackRepositoryService } from "@opencode-ai/core/ctxpack/sql"
import type { CtxPackRepository } from "@opencode-ai/core/ctxpack/sql"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import ctxPackMigration from "@opencode-ai/core/database/migration/20260821_ctxpack"
import { layer as serviceLayer, Service, CtxPackEventPortService, recordingEventPort } from "@opencode-ai/core/ctxpack/service"
import type { CtxPackActor, CtxPackEventPort, WorkspaceCtxPackChangedEvent } from "@opencode-ai/core/ctxpack/service"
import * as CapabilityService from "@opencode-ai/core/capability/service"
import { UserWorkspaceRightsService, WorkspaceMembershipService } from "@opencode-ai/core/capability/service"

// --- Harness ----------------------------------------------------------------

const makeDb = EffectDrizzleSqlite.makeWithDefaults()

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped))

const setup = () =>
  Effect.gen(function* () {
    const db = yield* makeDb
    yield* DatabaseMigration.apply(db)
    // Fresh databases bootstrap from the generated full schema; until it is
    // regenerated, apply the ctxpack migration manually.
    const existing = yield* db.get<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ctx_pack'`,
    )
    if (!existing) yield* db.transaction((tx) => ctxPackMigration.up(tx))
    // M1: fresh databases skip the handwritten migration (the generated full
    // schema now creates ctx_pack*), so the FTS virtual table is ensured lazily.
    yield* ensureCtxPackFts(db)
    return { db, repository: make(db) }
  })

// Maps a domain failure to a plain tagged result for assertions.
const outcome = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.catch(
    Effect.map(effect, (value) => ({ ok: true as const, value })),
    (error) => Effect.succeed({ ok: false as const, error }),
  )

// Fake capability provider that allows everything (except when the real X0
// layer is provided instead for the targeted deny test).
const allowAllCapability: CapabilityService.Interface = {
  check: () => Effect.succeed({ allowed: true }),
  require: () => Effect.succeed(undefined),
}

// Real X0 CapabilityService with fake membership and read-only rights.
const readOnlyCapabilityLayer = Layer.provide(
  Layer.provide(
    CapabilityService.layer,
    Layer.succeed(WorkspaceMembershipService, {
      isMember: () => Effect.succeed(true),
    }),
  ),
  Layer.succeed(UserWorkspaceRightsService, {
    rightsFor: () => Effect.succeed(["read"]),
  }),
)

const withService = <A, E>(
  effect: Effect.Effect<A, E, Service>,
  repository: CtxPackRepository,
  ...layers: Layer.Layer<never, never, never>[]
) => {
  let provided: Layer.Layer<any, any, any> = Layer.provide(
    serviceLayer,
    Layer.succeed(CtxPackRepositoryService, repository),
  )
  for (const layer of layers) provided = Layer.provide(provided, layer)
  return effect.pipe(Effect.provide(provided))
}

// --- Fixtures ---------------------------------------------------------------

const source = (overrides: Partial<CtxPack.Source> = {}): CtxPack.Source => ({
  workspaceID: "ws-1",
  blockID: "block-1",
  functionalityID: "builtin:chat",
  kind: "message",
  direction: "received",
  sourceTimestamp: 1787300000000,
  capturedAt: 1787300010000,
  entityRef: { type: "message", id: "msg-1" },
  label: "Assistant response",
  metadata: {},
  sensitivity: "workspace",
  ...overrides,
})

const fragment = (index: number, overrides: Partial<CtxPack.Source> = {}) => ({
  clientFragmentID: `frag-${index}`,
  text: `Fragment ${index} text about the post-pressure stage.`,
  source: source(overrides),
})

const createRequest = (overrides: Partial<CtxPackCreateRequest> = {}): CtxPackCreateRequest => ({
  workspaceID: "ws-1",
  title: "Niagara pump findings",
  keywords: ["Niagara", "pump"],
  sensitivity: "workspace",
  fragments: [fragment(0)],
  idempotencyKey: "create-1",
  ...overrides,
})

const patchRequest = (overrides: Partial<CtxPackPatchRequest> = {}): CtxPackPatchRequest => ({
  workspaceID: "ws-1",
  ctxPackID: CtxPack.ID.ascending("ctxpk_unused"),
  expectedRevision: 1,
  patch: { title: "Updated title" },
  idempotencyKey: "patch-1",
  ...overrides,
})

const listRequest = (overrides: Partial<CtxPackListRequest> = {}): CtxPackListRequest => ({
  workspaceID: "ws-1",
  query: "",
  keyword: null,
  sourceBlockID: null,
  sourceFunctionalityID: null,
  sourceKind: null,
  sensitivity: null,
  createdAfter: null,
  createdBefore: null,
  includeDeleted: false,
  sort: "created-desc",
  cursor: null,
  limit: 10,
  ...overrides,
})

const actor = (overrides: Partial<CtxPackActor> = {}): CtxPackActor => ({ userID: "user-1", workspaceID: "ws-1", ...overrides })

// --- Tests ------------------------------------------------------------------

describe("CtxPack service", () => {
  test("create assigns server timestamps, revision 1, and request-order ordinals", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const events: WorkspaceCtxPackChangedEvent[] = []
        const service = yield* withService(
          Service,
          repository,
          Layer.succeed(CtxPackEventPortService, recordingEventPort(events)),
          Layer.succeed(CapabilityService.Service, allowAllCapability),
        )

        const created = yield* service.create(
          actor(),
          createRequest({
            fragments: [fragment(0), fragment(1, { blockID: "block-2", functionalityID: "builtin:search", kind: "search" })],
          }),
        )

        expect(created.id.startsWith("ctxpk_")).toBe(true)
        expect(created.revision).toBe(1)
        expect(created.createdAt).toBeGreaterThan(0)
        expect(created.updatedAt).toBe(created.createdAt)
        expect(created.createdByUserID).toBe("user-1")
        expect(created.usage).toEqual({ attachedCount: 0, lastAttachedAt: null })
        // Ordinals follow the client request order — never re-sorted.
        expect(created.fragments.map((fragment) => fragment.ordinal)).toEqual([0, 1])
        expect(created.fragments.map((fragment) => fragment.source.blockID)).toEqual(["block-1", "block-2"])
        expect(created.fragments.map((fragment) => fragment.source.kind)).toEqual(["message", "search"])

        expect(events).toHaveLength(1)
        expect(events[0]!.properties).toEqual({
          workspaceID: "ws-1",
          ctxPackID: created.id,
          revision: 1,
          change: "created",
        })
      }),
    )
  })

  test("same idempotency key returns the original pack with a single created event", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const events: WorkspaceCtxPackChangedEvent[] = []
        const service = yield* withService(
          Service,
          repository,
          Layer.succeed(CtxPackEventPortService, recordingEventPort(events)),
          Layer.succeed(CapabilityService.Service, allowAllCapability),
        )

        const first = yield* service.create(actor(), createRequest())
        const second = yield* service.create(actor(), createRequest())

        expect(second.id).toBe(first.id)
        expect(second).toEqual(first)
        expect(events).toHaveLength(1)
        expect(events[0]!.properties.change).toBe("created")

        const count = yield* repository.list(listRequest())
        expect(count.items).toHaveLength(1)
      }),
    )
  })

  test("fragment source workspace mismatch fails with CtxPackCrossWorkspaceDenied before the repository call", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const events: WorkspaceCtxPackChangedEvent[] = []
        let repoCalls = 0
        const spiedRepository: CtxPackRepository = {
          ...repository,
          create: ((input) => {
            repoCalls++
            return repository.create(input)
          }) as CtxPackRepository["create"],
        }
        const service = yield* withService(
          Service,
          spiedRepository,
          Layer.succeed(CtxPackEventPortService, recordingEventPort(events)),
          Layer.succeed(CapabilityService.Service, allowAllCapability),
        )

        const result = yield* outcome(
          service.create(actor(), createRequest({ fragments: [fragment(0, { workspaceID: "ws-2" })] })),
        )
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackCrossWorkspaceDenied", sourceWorkspaceID: "ws-2" })
        expect(repoCalls).toBe(0)
        expect(events).toHaveLength(0)
      }),
    )
  })

  test("weaker requested pack sensitivity than a fragment source is rejected", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const service = yield* withService(
          Service,
          repository,
          Layer.succeed(CapabilityService.Service, allowAllCapability),
        )

        // Fragment sources are workspace (rank 1); a public request (rank 0)
        // must be rejected, never silently upgraded.
        const result = yield* outcome(service.create(actor(), createRequest({ sensitivity: "public" })))
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error).toEqual({
            _tag: "CtxPackInvalidSelection",
            reason: "requested sensitivity public is weaker than the strictest fragment source sensitivity",
          })
        }

        // Private (rank 2) is stricter than the sources and is accepted.
        const ok = yield* service.create(actor(), createRequest({ sensitivity: "private", idempotencyKey: "create-2" }))
        expect(ok.sensitivity).toBe("private")
      }),
    )
  })

  test("contentHash is stable across a metadata patch", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const events: WorkspaceCtxPackChangedEvent[] = []
        const service = yield* withService(
          Service,
          repository,
          Layer.succeed(CtxPackEventPortService, recordingEventPort(events)),
          Layer.succeed(CapabilityService.Service, allowAllCapability),
        )

        const created = yield* service.create(actor(), createRequest())
        const patched = yield* service.patch(
          actor(),
          patchRequest({ ctxPackID: created.id, patch: { title: "Renamed", keywords: ["pump", "turbine"] } }),
        )

        expect(patched.revision).toBe(2)
        expect(patched.title).toBe("Renamed")
        expect(patched.keywords).toEqual(["pump", "turbine"])
        expect(patched.contentHash).toBe(created.contentHash)
        expect(patched.byteLength).toBe(created.byteLength)
        expect(patched.estimatedTokens).toBe(created.estimatedTokens)
        expect(patched.fragments).toEqual(created.fragments)
      }),
    )
  })

  test("patch, remove, and restore publish minimal events", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const events: WorkspaceCtxPackChangedEvent[] = []
        const service = yield* withService(
          Service,
          repository,
          Layer.succeed(CtxPackEventPortService, recordingEventPort(events)),
          Layer.succeed(CapabilityService.Service, allowAllCapability),
        )

        const created = yield* service.create(actor(), createRequest())
        const patched = yield* service.patch(
          actor(),
          patchRequest({ ctxPackID: created.id, patch: { title: "Renamed" } }),
        )
        const removed = yield* service.remove(actor(), { ctxPackID: created.id, expectedRevision: patched.revision })
        const restored = yield* service.restore(actor(), { ctxPackID: created.id, expectedRevision: patched.revision })

        expect(removed.deletedAt).not.toBeNull()
        expect(restored.deletedAt).toBeNull()

        expect(events.map((event) => event.properties.change)).toEqual(["created", "metadata-updated", "deleted", "restored"])
        for (const event of events) {
          // Serialized JSON keys are exactly type + properties.{workspaceID,ctxPackID,revision,change}.
          expect(Object.keys(event).sort()).toEqual(["properties", "type"])
          expect(Object.keys(event.properties).sort()).toEqual(["change", "ctxPackID", "revision", "workspaceID"])
          expect(event.type).toBe("workspace.ctxpack.changed")
          expect(event.properties.workspaceID).toBe("ws-1")
          expect(event.properties.ctxPackID).toBe(created.id)
        }
        expect(events.map((event) => event.properties.revision)).toEqual([1, 2, 2, 2])
      }),
    )
  })

  test("event publish failure does not roll back create", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const failingPort: CtxPackEventPort = {
          // The port interface declares publish as infallible; this fake lies
          // about its error channel to exercise the service's swallow-log path.
          publish: () => Effect.fail(new Error("port down")) as unknown as Effect.Effect<void>,
        }
        const service = yield* withService(
          Service,
          repository,
          Layer.succeed(CtxPackEventPortService, failingPort),
          Layer.succeed(CapabilityService.Service, allowAllCapability),
        )

        const created = yield* service.create(actor(), createRequest())
        expect(created.id.startsWith("ctxpk_")).toBe(true)

        // The commit survived the publish failure.
        const fetched = yield* repository.get("ws-1", created.id, false)
        expect(fetched.id).toBe(created.id)
        const listed = yield* repository.list(listRequest())
        expect(listed.items).toHaveLength(1)
      }),
    )
  })

  test("read-only capability denies create with CtxPackPermissionDenied", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const service = yield* withService(Service, repository, readOnlyCapabilityLayer)

        const result = yield* outcome(service.create(actor(), createRequest()))
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackPermissionDenied", operation: "ctxpack.create" })
      }),
    )
  })

  test("list hides other users' private packs and shows the actor's own", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const events: WorkspaceCtxPackChangedEvent[] = []
        const service = yield* withService(
          Service,
          repository,
          Layer.succeed(CtxPackEventPortService, recordingEventPort(events)),
          Layer.succeed(CapabilityService.Service, allowAllCapability),
        )

        const mine = yield* service.create(actor(), createRequest({ title: "Mine", sensitivity: "private", idempotencyKey: "k-1" }))
        const theirs = yield* service.create(
          actor({ userID: "user-2" }),
          createRequest({ title: "Theirs", sensitivity: "private", idempotencyKey: "k-2" }),
        )
        const theirPublic = yield* service.create(
          actor({ userID: "user-2" }),
          createRequest({ title: "Their public", sensitivity: "workspace", idempotencyKey: "k-3" }),
        )

        const listed = yield* service.list(actor(), listRequest())
        const ids = listed.items.map((item) => item.id)
        expect(ids).toContain(mine.id)
        expect(ids).not.toContain(theirs.id)
        expect(ids).toContain(theirPublic.id)

        // The other user's own list still sees their private pack.
        const theirsListed = yield* service.list(actor({ userID: "user-2" }), listRequest())
        expect(theirsListed.items.map((item) => item.id)).toContain(theirs.id)
      }),
    )
  })

  test("list rejects workspace mismatch before repository access with CtxPackPermissionDenied", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        let listCalls = 0
        const spiedRepository: CtxPackRepository = {
          ...repository,
          list: ((input) => {
            listCalls += 1
            return repository.list(input)
          }) as CtxPackRepository["list"],
        }
        const service = yield* withService(
          Service,
          spiedRepository,
          Layer.succeed(CtxPackEventPortService, recordingEventPort([])),
          Layer.succeed(CapabilityService.Service, allowAllCapability),
        )

        const result = yield* outcome(service.list(actor(), listRequest({ workspaceID: "ws-other" })))
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackPermissionDenied", operation: "ctxpack.read" })
        expect(listCalls).toBe(0)
      }),
    )
  })

  test("list excludes other users' private packs before pagination, cursors, and counts", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const service = yield* withService(
          Service,
          repository,
          Layer.succeed(CapabilityService.Service, allowAllCapability),
        )
        const hidden = yield* service.create(
          actor({ userID: "user-2" }),
          createRequest({ title: "A private sentinel", sensitivity: "private", idempotencyKey: "hidden-a" }),
        )
        const visible = yield* service.create(actor(), createRequest({ title: "B visible", idempotencyKey: "visible" }))
        yield* service.create(
          actor({ userID: "user-2" }),
          createRequest({ title: "C private sentinel", sensitivity: "private", idempotencyKey: "hidden-c" }),
        )
        const mine = yield* service.create(
          actor(),
          createRequest({ title: "D mine", sensitivity: "private", idempotencyKey: "mine" }),
        )

        const first = yield* service.list(actor(), listRequest({ sort: "title-asc", limit: 1 }))
        expect(first.items.map((item) => item.id)).toEqual([visible.id])
        expect(first.totalEstimate).toBe(2)
        expect(first.nextCursor).not.toBeNull()
        expect(JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString("utf8"))).toMatchObject({
          value: "B visible",
          id: visible.id,
        })
        const second = yield* service.list(actor(), listRequest({ sort: "title-asc", limit: 1, cursor: first.nextCursor }))
        expect(second.items.map((item) => item.id)).toEqual([mine.id])
        expect(second.totalEstimate).toBe(2)
        expect(second.nextCursor).toBeNull()

        yield* repository.softDelete("ws-1", hidden.id, hidden.revision)
        const privateOnly = yield* service.list(actor(), listRequest({ sensitivity: "private", includeDeleted: true }))
        expect(privateOnly.items.map((item) => item.id)).toEqual([mine.id])
        expect(privateOnly.totalEstimate).toBe(1)
        expect(privateOnly.nextCursor).toBeNull()
      }),
    )
  })

  test("list never reveals another user's private pack when it is deleted during listing", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const service = yield* withService(
          Service,
          repository,
          Layer.succeed(CapabilityService.Service, allowAllCapability),
        )
        const hidden = yield* service.create(
          actor({ userID: "user-2" }),
          createRequest({ title: "Private deletion sentinel", sensitivity: "private" }),
        )
        const listing = yield* withService(
          Service,
          {
            ...repository,
            list: (input) => repository.list(input).pipe(Effect.tap(() => repository.softDelete("ws-1", hidden.id, 1))),
          },
          Layer.succeed(CapabilityService.Service, allowAllCapability),
        )

        expect(yield* listing.list(actor(), listRequest())).toEqual({ items: [], nextCursor: null, totalEstimate: 0 })
      }),
    )
  })

  test.each(["session.input", "session-input", '"'])("list safely searches user punctuation: %s", async (query) => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const service = yield* withService(
          Service,
          repository,
          Layer.succeed(CapabilityService.Service, allowAllCapability),
        )
        const created = yield* service.create(
          actor(),
          createRequest({ fragments: [{ ...fragment(0), text: "session.input and session-input" }] }),
        )

        const result = yield* service.list(actor(), listRequest({ query })).pipe(Effect.exit)
        expect(result._tag).toBe("Success")
        if (result._tag === "Success") expect(result.value.items.map((item) => item.id)).toEqual([created.id])
      }),
    )
  })

  test("get on a deleted pack fails with CtxPackDeleted unless includeDeleted is set", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const service = yield* withService(
          Service,
          repository,
          Layer.succeed(CapabilityService.Service, allowAllCapability),
        )

        const created = yield* service.create(actor(), createRequest())
        yield* service.remove(actor(), { ctxPackID: created.id, expectedRevision: 1 })

        const hidden = yield* outcome(service.get(actor(), created.id))
        expect(hidden.ok).toBe(false)
        if (!hidden.ok) expect(hidden.error).toEqual({ _tag: "CtxPackDeleted", ctxPackID: created.id })

        const visible = yield* service.get(actor(), created.id, true)
        expect(visible.id).toBe(created.id)
        expect(visible.deletedAt).not.toBeNull()
      }),
    )
  })

  test("remove with a stale expectedRevision fails with CtxPackRevisionConflict", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const service = yield* withService(
          Service,
          repository,
          Layer.succeed(CapabilityService.Service, allowAllCapability),
        )

        const created = yield* service.create(actor(), createRequest())
        yield* service.patch(actor(), patchRequest({ ctxPackID: created.id, patch: { title: "Renamed" } }))

        const result = yield* outcome(service.remove(actor(), { ctxPackID: created.id, expectedRevision: 1 }))
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackRevisionConflict", currentRevision: 2 })
      }),
    )
  })
})
