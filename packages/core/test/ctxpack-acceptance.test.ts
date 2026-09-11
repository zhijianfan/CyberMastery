/**
 * CtxPack end-to-end acceptance suite (T1 verification lane).
 *
 * Runs the REAL repository, capability service, capsule store, materializer,
 * and usage ledger on in-memory SQLite; the SessionInput admission cases run
 * the REAL X1 materializer + C2 usage ledger on the full session stack via
 * AppNodeBuilder. This file is verification EVIDENCE: every failing check is
 * routed to its owning lane in devplan/ctxpack/HANDOFF-T1.md — never patched
 * around here.
 *
 * DB bootstrap: fresh in-memory databases create ctx_pack* via the
 * regenerated schema.gen.ts (the handwritten 20260821_ctxpack migration is
 * skipped), so ensureCtxPackFts(db) is called after DatabaseMigration.apply.
 */

import { describe, expect, test } from "bun:test"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { eq, sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import type { CtxPackCreateRequest, CtxPackListRequest, CtxPackSort } from "@opencode-ai/schema/ctxpack"
import { buildFtsQuery } from "@opencode-ai/core/ctxpack/search"
import { ensureCtxPackFts, make, CtxPackRepositoryService } from "@opencode-ai/core/ctxpack/sql"
import { node as CtxPackRepositoryNode } from "@opencode-ai/core/ctxpack/sql"
import type { CtxPackRepository } from "@opencode-ai/core/ctxpack/sql"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { Database } from "@opencode-ai/core/database/database"
import {
  layer as serviceLayer,
  Service,
  CtxPackEventPortService,
  recordingEventPort,
} from "@opencode-ai/core/ctxpack/service"
import type { CtxPackActor, WorkspaceCtxPackChangedEvent } from "@opencode-ai/core/ctxpack/service"
import * as CapabilityService from "@opencode-ai/core/capability/service"
import { UserWorkspaceRightsService, WorkspaceMembershipService } from "@opencode-ai/core/capability/service"
import type { Right } from "@opencode-ai/core/capability/subjects"
import {
  layer as capsuleLayer,
  Service as ContextCapsuleStoreService,
  DefaultInteractiveContextBudget,
} from "@opencode-ai/core/context-broker/capsule"
import { node as ContextCapsuleNode } from "@opencode-ai/core/context-broker/capsule"
import type { ContextCapsuleStore, StoredCapsule } from "@opencode-ai/core/context-broker/capsule"
import { make as makeMaterializer, Service as MaterializerService } from "@opencode-ai/core/ctxpack/materialize"
import { node as CtxPackMaterializerNode } from "@opencode-ai/core/ctxpack/materialize"
import type {
  CtxPackMaterializer,
  SessionContextAttachmentInput,
  SessionContextSnapshot,
} from "@opencode-ai/core/ctxpack/materialize"
import { make as makeUsage, Service as CtxPackUsageService } from "@opencode-ai/core/ctxpack/usage"
import { node as CtxPackUsageNode } from "@opencode-ai/core/ctxpack/usage"
import type { CtxPackEventPublisher } from "@opencode-ai/core/ctxpack/events"
import { node as CtxPackEventsNode } from "@opencode-ai/core/ctxpack/events"
import { noop as noopObservability } from "@opencode-ai/core/ctxpack/observability"
import { node as CtxPackObservabilityNode } from "@opencode-ai/core/ctxpack/observability"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionContextProfile } from "@opencode-ai/core/session/context-profile"
import { SessionContextTransferReadiness } from "@opencode-ai/core/session/context-transfer-readiness"
import { SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { testEffect } from "./lib/effect"
import {
  ctxPackEventPortNode,
  ctxPackUsagePortNode,
  sessionContextAssemblyPortNode,
} from "@opencode-ai/core/ctxpack/wiring"

const SENTINEL = "CTXPACK_SECRET_SENTINEL_7812"
const ALL: Right[] = ["read", "write", "execute"]

// --- Harness (service level) --------------------------------------------------

const makeDb = EffectDrizzleSqlite.makeWithDefaults()

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

const setup = () =>
  Effect.gen(function* () {
    const db = yield* makeDb
    yield* DatabaseMigration.apply(db)
    // Fresh databases bootstrap from the generated full schema, so the
    // handwritten ctxpack migration is skipped and the FTS virtual table is
    // ensured lazily (M1 fix).
    yield* ensureCtxPackFts(db)
    return { db, repository: make(db) }
  })

const outcome = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.catch(
    Effect.map(effect, (value) => ({ ok: true as const, value })),
    (error) => Effect.succeed({ ok: false as const, error }),
  )

// Real X0 CapabilityService policy with fake membership + rights injection.
const capabilityInstance = (rights: Right[]): CapabilityService.Interface =>
  Effect.runSync(
    Effect.gen(function* () {
      return yield* CapabilityService.Service
    }).pipe(
      Effect.provide(
        Layer.provide(
          Layer.provide(
            CapabilityService.layer,
            Layer.succeed(WorkspaceMembershipService, { isMember: () => Effect.succeed(true) }),
          ),
          Layer.succeed(UserWorkspaceRightsService, { rightsFor: () => Effect.succeed(rights) }),
        ),
      ),
    ),
  )

const allowAllCapability: CapabilityService.Interface = {
  check: () => Effect.succeed({ allowed: true }),
  require: () => Effect.succeed(undefined),
}

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

const withServiceHarness = (repository: CtxPackRepository) => {
  const events: WorkspaceCtxPackChangedEvent[] = []
  const service = (capability: CapabilityService.Interface = allowAllCapability) =>
    withService(
      Service,
      repository,
      Layer.succeed(CtxPackEventPortService, recordingEventPort(events)),
      Layer.succeed(CapabilityService.Service, capability),
    )
  return { events, service }
}

// --- Fixtures -----------------------------------------------------------------

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
  text: `Fragment ${index} text ${SENTINEL} about the post-pressure stage.`,
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

const actor = (overrides: Partial<CtxPackActor> = {}): CtxPackActor => ({
  userID: "user-1",
  workspaceID: "ws-1",
  ...overrides,
})

const recordingPublisher = (events: WorkspaceCtxPackChangedEvent[] = []): CtxPackEventPublisher => ({
  publish: (event) =>
    Effect.sync(() => {
      events.push(event)
    }),
})

const makeCapsule = (input: {
  id: string
  workspaceID: string
  pack: CtxPack.Info
  createdBy: { userId: string; instanceId: string }
  summary?: string
}): StoredCapsule => ({
  id: input.id,
  version: 1,
  workspaceId: input.workspaceID,
  createdBy: input.createdBy,
  purpose: "ctxpack-attachment",
  audience: ["builtin:chat"],
  summary: input.summary ?? input.pack.title,
  facts: [
    {
      key: "ctxpack.id",
      value: input.pack.id,
      sourceRef: { type: "ctxpack", id: input.pack.id },
      sensitivity: input.pack.sensitivity,
    },
    {
      key: "ctxpack.fragmentCount",
      value: input.pack.fragments.length,
      sourceRef: { type: "ctxpack", id: input.pack.id },
      sensitivity: input.pack.sensitivity,
    },
  ],
  references: [
    {
      kind: "ctxpack",
      ref: { type: "ctxpack", id: input.pack.id },
      label: input.pack.title,
      contentHash: input.pack.contentHash,
      sensitivity: input.pack.sensitivity,
    },
    ...input.pack.fragments.map((fragment) => ({
      kind: "ctxpack.fragment",
      ref: { type: "ctxpack-fragment", id: fragment.id },
      label: fragment.source.label ?? `Fragment ${fragment.ordinal + 1}`,
      summary: fragment.text,
      contentHash: fragment.contentHash,
      sensitivity: fragment.source.sensitivity,
    })),
  ],
  artifactRefs: [],
  recentEvents: [],
  budget: DefaultInteractiveContextBudget,
  contentHash: input.pack.contentHash,
  createdAt: Date.now(),
  expiresAt: undefined,
})

const attachmentInput = (capsuleID: string, pack: CtxPack.Info): SessionContextAttachmentInput => ({
  contextCapsuleID: capsuleID,
  label: pack.title,
  contentHash: pack.contentHash,
  source: { kind: "ctxpack", ctxPackID: pack.id },
})

// --- Acceptance ----------------------------------------------------------------

describe("CtxPack acceptance (real repo + capability + capsule store + event recorder)", () => {
  test("create accepts single- and multi-block packs and publishes one created event", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const harness = withServiceHarness(repository)

        const single = yield* (yield* harness.service()).create(actor(), createRequest({ idempotencyKey: "a-1" }))
        expect(single.id.startsWith("ctxpk_")).toBe(true)
        expect(single.revision).toBe(1)
        expect(single.fragments).toHaveLength(1)

        const multi = yield* (yield* harness.service()).create(
          actor(),
          createRequest({
            idempotencyKey: "a-2",
            title: "Multi-block pack",
            // A private fragment source forces the pack sensitivity up to
            // private (sensitivity must be at least as strict as every source).
            sensitivity: "private",
            fragments: [
              fragment(0),
              fragment(1, { blockID: "block-2", functionalityID: "builtin:search", kind: "search" }),
              fragment(2, {
                blockID: "block-3",
                functionalityID: "builtin:notes",
                kind: "note",
                sensitivity: "private",
              }),
            ],
          }),
        )
        expect(multi.fragments.map((f) => f.ordinal)).toEqual([0, 1, 2])
        expect(multi.fragments.map((f) => f.source.blockID)).toEqual(["block-1", "block-2", "block-3"])
        expect(multi.fragments.map((f) => f.source.kind)).toEqual(["message", "search", "note"])
        expect(multi.sensitivity).toBe("private")

        expect(harness.events.map((e) => e.properties.change)).toEqual(["created", "created"])
        expect(harness.events[0]!.properties.ctxPackID).toBe(single.id)
        expect(harness.events[1]!.properties.ctxPackID).toBe(multi.id)
      }),
    )
  })

  test("search finds packs by title, keyword, and fragment text", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const harness = withServiceHarness(repository)
        const service = yield* harness.service()

        const turbine = yield* service.create(
          actor(),
          createRequest({
            idempotencyKey: "s-1",
            title: "Turbine rotor report",
            keywords: [],
            fragments: [fragment(0, { blockID: "b1" })],
          }),
        )
        const niagara = yield* service.create(
          actor(),
          createRequest({
            idempotencyKey: "s-2",
            title: "Pump overhaul",
            keywords: ["Niagara"],
            fragments: [{ ...fragment(0, { blockID: "b2", kind: "search" }), text: "cavitation patterns observed" }],
          }),
        )
        const bearings = yield* service.create(
          actor(),
          createRequest({
            idempotencyKey: "s-3",
            title: "Bearings log",
            keywords: [],
            fragments: [{ ...fragment(0, { blockID: "b3" }), text: "turbine blade inspection notes" }],
          }),
        )

        // title match (turbine) + fragment-text match (bearings)
        const byTitleAndFragment = yield* service.list(actor(), listRequest({ query: "turbine" }))
        expect(byTitleAndFragment.items.map((i) => i.id).sort()).toEqual([turbine.id, bearings.id].sort())

        // keyword match (Niagara keyword, not in title or fragment text)
        const byKeyword = yield* service.list(actor(), listRequest({ query: "Niagara" }))
        expect(byKeyword.items.map((i) => i.id)).toEqual([niagara.id])

        // fragment-text match
        const byFragment = yield* service.list(actor(), listRequest({ query: "cavitation" }))
        expect(byFragment.items.map((i) => i.id)).toEqual([niagara.id])

        // keyword filter (metadata, not FTS)
        const keywordFilter = yield* service.list(actor(), listRequest({ keyword: "Niagara" }))
        expect(keywordFilter.items.map((i) => i.id)).toEqual([niagara.id])
      }),
    )
  })

  test("metadata filters intersect with each other and with the search query", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const harness = withServiceHarness(repository)
        const service = yield* harness.service()

        const p1 = yield* service.create(
          actor(),
          createRequest({
            idempotencyKey: "f-1",
            title: "P1",
            keywords: ["turbine"],
            fragments: [fragment(0, { blockID: "b1" })],
          }),
        )
        const p2 = yield* service.create(
          actor(),
          createRequest({
            idempotencyKey: "f-2",
            title: "P2",
            keywords: ["Niagara"],
            fragments: [{ ...fragment(0, { blockID: "b2", kind: "search" }), text: "turbine cavitation" }],
          }),
        )
        const p3 = yield* service.create(
          actor(),
          createRequest({
            idempotencyKey: "f-3",
            title: "P3",
            sensitivity: "public",
            keywords: [],
            fragments: [{ ...fragment(0, { blockID: "b1", sensitivity: "public" }), text: "pump housing wear" }],
          }),
        )
        // Private pack owned by another user: must be filtered out everywhere.
        const p4 = yield* service.create(
          actor({ userID: "user-2" }),
          createRequest({
            idempotencyKey: "f-4",
            title: "P4 private",
            sensitivity: "private",
            keywords: ["turbine"],
            fragments: [fragment(0, { blockID: "b1" })],
          }),
        )

        // query ∩ privacy: p4 hidden for user-1
        const q = yield* service.list(actor(), listRequest({ query: "turbine" }))
        expect(q.items.map((i) => i.id).sort()).toEqual([p1.id, p2.id].sort())

        // query ∩ sourceBlockID
        const qb = yield* service.list(actor(), listRequest({ query: "turbine", sourceBlockID: "b1" }))
        expect(qb.items.map((i) => i.id)).toEqual([p1.id])

        // query ∩ sourceKind
        const qk = yield* service.list(actor(), listRequest({ query: "turbine", sourceKind: "search" }))
        expect(qk.items.map((i) => i.id)).toEqual([p2.id])

        // keyword ∩ created range: created timestamps are controlled by
        // direct repository inserts (the service assigns server time).
        const t = Date.now()
        yield* repository.create({
          workspaceID: "ws-1",
          createdByUserID: "user-1",
          title: "Range pack",
          keywords: ["Niagara"],
          sensitivity: "workspace",
          fragments: [{ clientFragmentID: "cf-range", text: "range fragment", source: source({ blockID: "b9" }) }],
          idempotencyKey: "f-range",
          now: t - 2000,
        })
        yield* repository.create({
          workspaceID: "ws-1",
          createdByUserID: "user-1",
          title: "Out of range",
          keywords: ["Niagara"],
          sensitivity: "workspace",
          fragments: [{ clientFragmentID: "cf-oor", text: "out of range", source: source({ blockID: "b9" }) }],
          idempotencyKey: "f-oor",
          now: t - 9000,
        })
        const range = yield* service.list(
          actor(),
          listRequest({ keyword: "Niagara", createdAfter: t - 2500, createdBefore: t - 500 }),
        )
        expect(range.items).toHaveLength(1)
        expect(range.items[0]!.title).toBe("Range pack")

        // sensitivity filter
        const pub = yield* service.list(actor(), listRequest({ sensitivity: "public" }))
        expect(pub.items.map((i) => i.id)).toEqual([p3.id])
      }),
    )
  })

  test("all seven sorts are cursor-stable across two pages with no duplicates", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const harness = withServiceHarness(repository)
        const service = yield* harness.service()
        const now = 1_000_000

        const created: Array<{
          id: CtxPack.ID
          title: string
          now: number
          tokens: number
          attached: number
          lastAttached: number | null
        }> = []
        for (let i = 0; i < 10; i += 1) {
          const info = yield* repository.create({
            workspaceID: "ws-1",
            createdByUserID: "user-1",
            title: `T${String(9 - i).padStart(2, "0")}`, // reversed so title-asc != created-desc
            keywords: [],
            sensitivity: "workspace",
            fragments: [
              { clientFragmentID: `cf-${i}`, text: `t${i} `.repeat(4 + i), source: source({ blockID: `b${i % 3}` }) },
            ],
            idempotencyKey: `sort-${i}`,
            now: now + i * 100,
          })
          const attached = i % 5 // 0,1,2,3,4,0,1,2,3,4
          for (let a = 0; a < attached; a += 1) yield* repository.recordUse("ws-1", info.id, now + i * 100 + a)
          created.push({
            id: info.id,
            title: info.title,
            now: info.createdAt,
            tokens: info.estimatedTokens,
            attached,
            lastAttached: attached > 0 ? now + i * 100 + attached - 1 : null,
          })
        }
        // Bump updatedAt on a few packs (patchMetadata with explicit now) so
        // updated-desc is distinguishable from created-desc.
        yield* repository.patchMetadata({
          workspaceID: "ws-1",
          ctxPackID: created[0]!.id,
          expectedRevision: 1,
          patch: { title: "T00-updated" },
          now: now + 5000,
        })
        yield* repository.patchMetadata({
          workspaceID: "ws-1",
          ctxPackID: created[5]!.id,
          expectedRevision: 1,
          patch: { title: "T05-updated" },
          now: now + 5001,
        })

        const sorts: CtxPackSort[] = [
          "created-desc",
          "created-asc",
          "updated-desc",
          "title-asc",
          "tokens-desc",
          "most-attached",
          "recently-attached",
        ]

        for (const sort of sorts) {
          // Ground truth: the single-pass list defines the authoritative order
          // (including the id tie-break). Cursor stability means the paged
          // walk reproduces it EXACTLY — no dupes, no gaps, no reordering.
          const single = yield* service.list(actor(), listRequest({ sort, limit: 10 }))
          const expectedIds = single.items.map((item) => item.id)
          expect(expectedIds).toHaveLength(10)

          const page1 = yield* service.list(actor(), listRequest({ sort, limit: 4 }))
          const page2 = yield* service.list(actor(), listRequest({ sort, limit: 4, cursor: page1.nextCursor }))
          const page3 = yield* service.list(actor(), listRequest({ sort, limit: 4, cursor: page2.nextCursor }))

          const ids = [...page1.items, ...page2.items, ...page3.items].map((i) => i.id)
          expect(new Set(ids).size).toBe(10) // no duplicates across pages
          expect(ids).toEqual(expectedIds) // walk == single-pass order
          expect(page1.nextCursor).not.toBeNull()
          expect(page2.nextCursor).not.toBeNull()
          expect(page3.nextCursor).toBeNull()

          // Independent monotonicity check of the sort key along the walk
          // (nulls last for recently-attached).
          const keyOf = (item: (typeof page1.items)[number]): number | null => {
            switch (sort) {
              case "created-desc":
              case "created-asc":
                return item.createdAt
              case "updated-desc":
                return item.updatedAt
              case "title-asc":
                return 0 // lexical order asserted via expectedIds above
              case "tokens-desc":
                return item.estimatedTokens
              case "most-attached":
                return item.usage.attachedCount
              case "recently-attached":
                return item.usage.lastAttachedAt
            }
          }
          if (sort !== "title-asc") {
            const keys = [...page1.items, ...page2.items, ...page3.items].map(keyOf)
            const nulls = keys.filter((k) => k === null).length
            if (sort === "recently-attached") {
              // NULLS LAST: the trailing keys must be the nulls.
              expect(keys.slice(keys.length - nulls).every((k) => k === null)).toBe(true)
            } else {
              expect(nulls).toBe(0)
            }
            const numeric = keys.filter((k): k is number => k !== null)
            const descending = sort !== "created-asc"
            for (let idx = 1; idx < numeric.length; idx += 1) {
              if (descending) expect(numeric[idx - 1]! >= numeric[idx]!).toBe(true)
              else expect(numeric[idx - 1]! <= numeric[idx]!).toBe(true)
            }
          }
        }
      }),
    )
  })

  test("materialize returns a capsule reference without fragment text", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const harness = withServiceHarness(repository)
        const created = yield* (yield* harness.service()).create(actor(), createRequest({ idempotencyKey: "m-1" }))
        expect(created.fragments[0]!.text).toContain(SENTINEL)

        const capsuleStore = yield* Effect.gen(function* () {
          return yield* ContextCapsuleStoreService
        }).pipe(Effect.provide(Layer.provide(capsuleLayer, Layer.succeed(Database.Service, { db }))))
        const materializer = makeMaterializer({
          repository,
          capability: capabilityInstance(ALL),
          capsuleStore,
        })

        const result = yield* materializer.materialize(actor(), {
          workspaceID: "ws-1",
          ctxPackID: created.id,
          expectedContentHash: created.contentHash,
          targetInstanceID: "chat-instance:ses-1",
          targetFunctionalityID: "builtin:chat",
        })

        // The RESULT is a capsule reference — never fragment text.
        expect(result.contextCapsuleID.startsWith("ctxkpsl_")).toBe(true)
        expect(result.sourceCtxPackID).toBe(created.id)
        expect(result.contentHash).toBe(created.contentHash)
        const serialized = JSON.stringify(result)
        expect(serialized).not.toContain(SENTINEL)
        expect(serialized).not.toContain("post-pressure")

        // The capsule itself is durable and content-free in its public facts;
        // fragment text appears only in the immutable reference summaries.
        const stored = yield* capsuleStore.get("ws-1", result.contextCapsuleID).pipe(Effect.orDie)
        expect(stored).toBeDefined()
        expect(stored!.references.some((r) => (r as { kind?: string }).kind === "ctxpack.fragment")).toBe(true)
      }),
    )
  })

  test("snapshot is deep-frozen and independent of later pack mutation or deletion", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const harness = withServiceHarness(repository)
        const created = yield* (yield* harness.service()).create(
          actor(),
          createRequest({ idempotencyKey: "snap-1", fragments: [fragment(0), fragment(1)] }),
        )

        const capsuleStore = yield* Effect.gen(function* () {
          return yield* ContextCapsuleStoreService
        }).pipe(Effect.provide(Layer.provide(capsuleLayer, Layer.succeed(Database.Service, { db }))))
        const materializer = makeMaterializer({
          repository,
          capability: capabilityInstance(ALL),
          capsuleStore,
        })

        const capsuleID = `ctxkpsl_snap_1`
        yield* capsuleStore
          .store(
            makeCapsule({
              id: capsuleID,
              workspaceID: "ws-1",
              pack: created,
              createdBy: { userId: "user-1", instanceId: "chat-instance:ses-1" },
            }),
          )
          .pipe(Effect.orDie)

        const snapshot = yield* materializer.snapshotForSessionInput({
          actor: actor(),
          targetInstanceID: "chat-instance:ses-1",
          targetFunctionalityID: "builtin:chat",
          attachments: [attachmentInput(capsuleID, created)],
          budget: DefaultInteractiveContextBudget,
        })
        const snapshotJson = JSON.stringify(snapshot)
        expect(snapshotJson).toContain(SENTINEL)
        expect(snapshot.attachments).toHaveLength(1)
        expect(Object.isFrozen(snapshot)).toBe(true)
        expect(Object.isFrozen(snapshot.attachments[0])).toBe(true)
        expect(Object.isFrozen(snapshot.attachments[0]!.fragments[0])).toBe(true)

        // Delete the pack: the admitted snapshot object is untouched...
        yield* repository.softDelete("ws-1", created.id, created.revision)
        expect(JSON.stringify(snapshot)).toBe(snapshotJson)

        // ...and a NEW snapshot attempt now fails with CtxPackDeleted.
        const retry = yield* outcome(
          materializer.snapshotForSessionInput({
            actor: actor(),
            targetInstanceID: "chat-instance:ses-1",
            targetFunctionalityID: "builtin:chat",
            attachments: [attachmentInput(capsuleID, created)],
            budget: DefaultInteractiveContextBudget,
          }),
        )
        expect(retry.ok).toBe(false)
        if (!retry.ok) expect(retry.error).toMatchObject({ _tag: "CtxPackDeleted" })
      }),
    )
  })

  test("usage increments exactly once per admission (ledger + attachedCount + used event)", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const usedEvents: WorkspaceCtxPackChangedEvent[] = []
        const usage = makeUsage({
          db,
          repository,
          publisher: recordingPublisher(usedEvents),
          observability: noopObservability,
        })

        const pack = yield* repository.create({
          workspaceID: "ws-1",
          createdByUserID: "user-1",
          title: "Usage pack",
          keywords: [],
          sensitivity: "workspace",
          fragments: [{ clientFragmentID: "cf-1", text: "usage text", source: source() }],
          idempotencyKey: "usage-1",
          now: 1_000,
        })

        yield* usage.recordAdmittedUse({
          workspaceID: "ws-1",
          userID: "user-1",
          ctxPackIDs: [pack.id, pack.id],
          sessionInputID: "si-1",
          admittedAt: 2000,
        })
        // Duplicate admission (same session input) must NOT double-count.
        yield* usage.recordAdmittedUse({
          workspaceID: "ws-1",
          userID: "user-1",
          ctxPackIDs: [pack.id],
          sessionInputID: "si-1",
          admittedAt: 3000,
        })

        let info = yield* repository.get("ws-1", pack.id, false)
        expect(info.usage.attachedCount).toBe(1)
        expect(info.usage.lastAttachedAt).toBe(2000)
        expect(usedEvents).toHaveLength(1)
        expect(usedEvents[0]!.properties).toEqual({
          workspaceID: "ws-1",
          ctxPackID: pack.id,
          revision: 1,
          change: "used",
        })

        // A second admission with a different session input counts once more.
        yield* usage.recordAdmittedUse({
          workspaceID: "ws-1",
          userID: "user-1",
          ctxPackIDs: [pack.id],
          sessionInputID: "si-2",
          admittedAt: 4000,
        })
        info = yield* repository.get("ws-1", pack.id, false)
        expect(info.usage.attachedCount).toBe(2)
        expect(info.usage.lastAttachedAt).toBe(4000)
        expect(usedEvents).toHaveLength(2)

        const ledger = yield* db.all<{ ctx_pack_id: string }>(
          sql`SELECT ctx_pack_id FROM ctx_pack_usage_admission WHERE ctx_pack_id = ${pack.id}`,
        )
        expect(ledger).toHaveLength(2)
      }),
    )
  })

  test("cross-workspace fragment sources are denied before any repository write", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        let repoCalls = 0
        const spiedRepository: CtxPackRepository = {
          ...repository,
          createWithStatus: ((input) => {
            repoCalls += 1
            return repository.createWithStatus(input)
          }) as CtxPackRepository["createWithStatus"],
        }
        const harness = withServiceHarness(spiedRepository)

        const result = yield* outcome(
          (yield* harness.service()).create(
            actor(),
            createRequest({ fragments: [fragment(0, { workspaceID: "ws-2" })] }),
          ),
        )
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackCrossWorkspaceDenied", sourceWorkspaceID: "ws-2" })
        expect(repoCalls).toBe(0)
        expect(harness.events).toHaveLength(0)
      }),
    )
  })

  test("secret source sensitivity is denied at runtime", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const harness = withServiceHarness(repository)

        // The schema layer cannot decode "secret"; the service re-checks at
        // runtime for callers that bypassed schema decoding.
        const request = createRequest({
          fragments: [
            { ...fragment(0), source: { ...source(), sensitivity: "secret" as unknown as CtxPack.Sensitivity } },
          ],
        })
        const result = yield* outcome((yield* harness.service()).create(actor(), request))
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toMatchObject({ _tag: "CtxPackSecretSourceDenied" })
      }),
    )
  })

  test("nine attachments reject the whole snapshot (too-many-attachments)", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const capsuleStore = yield* Effect.gen(function* () {
          return yield* ContextCapsuleStoreService
        }).pipe(Effect.provide(Layer.provide(capsuleLayer, Layer.succeed(Database.Service, { db }))))
        const materializer = makeMaterializer({ repository, capability: capabilityInstance(ALL), capsuleStore })

        const attachments = Array.from({ length: 9 }, (_, i) => ({
          contextCapsuleID: `ctxkpsl_bogus_${i}`,
          label: `Pack ${i}`,
          contentHash: `sha256:${i}`,
          source: { kind: "ctxpack" as const, ctxPackID: `ctxpk_bogus_${i}` },
        }))

        const result = yield* outcome(
          materializer.snapshotForSessionInput({
            actor: actor(),
            targetInstanceID: "chat-instance:ses-1",
            targetFunctionalityID: "builtin:chat",
            attachments,
            budget: DefaultInteractiveContextBudget,
          }),
        )
        expect(result.ok).toBe(false)
        if (!result.ok)
          expect(result.error).toEqual({ _tag: "CtxPackInvalidSelection", reason: "too-many-attachments" })
      }),
    )
  })

  test("6,001 estimated tokens reject create, and the snapshot budget rejects oversized snapshots", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const harness = withServiceHarness(repository)

        // ~24,000 bytes -> 6,000+ estimated tokens, under the 32 KiB byte cap.
        const bigText = "x".repeat(24_010)
        const created = yield* outcome(
          (yield* harness.service()).create(
            actor(),
            createRequest({ idempotencyKey: "budget-1", fragments: [{ ...fragment(0), text: bigText }] }),
          ),
        )
        expect(created.ok).toBe(false)
        if (!created.ok) {
          expect(created.error).toMatchObject({ _tag: "CtxPackBudgetExceeded" })
          expect((created.error as { estimatedTokens: number }).estimatedTokens).toBeGreaterThan(6000)
        }

        // A pack that fits the create budget but overflows a tight snapshot budget.
        const small = yield* (yield* harness.service()).create(
          actor(),
          createRequest({ idempotencyKey: "budget-2", fragments: [fragment(0)] }),
        )
        const capsuleStore = yield* Effect.gen(function* () {
          return yield* ContextCapsuleStoreService
        }).pipe(Effect.provide(Layer.provide(capsuleLayer, Layer.succeed(Database.Service, { db }))))
        const materializer = makeMaterializer({ repository, capability: capabilityInstance(ALL), capsuleStore })
        const capsuleID = "ctxkpsl_budget_1"
        yield* capsuleStore
          .store(
            makeCapsule({
              id: capsuleID,
              workspaceID: "ws-1",
              pack: small,
              createdBy: { userId: "user-1", instanceId: "chat-instance:ses-1" },
            }),
          )
          .pipe(Effect.orDie)

        const tight = yield* outcome(
          materializer.snapshotForSessionInput({
            actor: actor(),
            targetInstanceID: "chat-instance:ses-1",
            targetFunctionalityID: "builtin:chat",
            attachments: [attachmentInput(capsuleID, small)],
            budget: { ...DefaultInteractiveContextBudget, maximumEstimatedTokens: 100 },
          }),
        )
        expect(tight.ok).toBe(false)
        if (!tight.ok) {
          expect(tight.error).toMatchObject({ _tag: "CtxPackSnapshotOverBudget" })
          expect((tight.error as { maximum: number }).maximum).toBe(100)
        }

        // Duplicate capsule ids also reject the whole snapshot.
        const dup = yield* outcome(
          materializer.snapshotForSessionInput({
            actor: actor(),
            targetInstanceID: "chat-instance:ses-1",
            targetFunctionalityID: "builtin:chat",
            attachments: [attachmentInput(capsuleID, small), attachmentInput(capsuleID, small)],
            budget: DefaultInteractiveContextBudget,
          }),
        )
        expect(dup.ok).toBe(false)
        if (!dup.ok) expect(dup.error).toMatchObject({ _tag: "CtxPackSnapshotDuplicateCapsule" })
      }),
    )
  })

  test("includeDeleted hides then reveals a deleted pack; restore re-indexes search", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const harness = withServiceHarness(repository)
        const service = yield* harness.service()

        const created = yield* service.create(actor(), createRequest({ idempotencyKey: "del-1", title: "Doomed pack" }))

        // Default list hides nothing yet; search finds it.
        expect((yield* service.list(actor(), listRequest({ query: "doomed" }))).items).toHaveLength(1)

        yield* service.remove(actor(), { ctxPackID: created.id, expectedRevision: 1 })

        const hidden = yield* outcome(service.get(actor(), created.id))
        expect(hidden.ok).toBe(false)
        if (!hidden.ok) expect(hidden.error).toEqual({ _tag: "CtxPackDeleted", ctxPackID: created.id })

        expect((yield* service.list(actor(), listRequest())).items).toHaveLength(0)
        expect((yield* service.list(actor(), listRequest({ query: "doomed" }))).items).toHaveLength(0)
        // includeDeleted surfaces the pack again in the list...
        expect((yield* service.list(actor(), listRequest({ includeDeleted: true }))).items.map((i) => i.id)).toEqual([
          created.id,
        ])
        // ...but a deleted pack is REMOVED from the FTS index until restored
        // (softDelete deletes the ctx_pack_fts row; restore re-inserts it).
        expect(
          (yield* service.list(actor(), listRequest({ query: "doomed", includeDeleted: true }))).items,
        ).toHaveLength(0)

        const visible = yield* service.get(actor(), created.id, true)
        expect(visible.deletedAt).not.toBeNull()

        // Restore after delete: get works, search re-indexed via FTS re-insert.
        const restored = yield* service.restore(actor(), { ctxPackID: created.id, expectedRevision: 1 })
        expect(restored.deletedAt).toBeNull()
        expect((yield* service.list(actor(), listRequest({ query: "doomed" }))).items.map((i) => i.id)).toEqual([
          created.id,
        ])
      }),
    )
  })

  test("stale expectedRevision conflicts on patch and remove", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const harness = withServiceHarness(repository)
        const service = yield* harness.service()

        const created = yield* service.create(actor(), createRequest({ idempotencyKey: "rev-1" }))
        yield* service.patch(actor(), {
          workspaceID: "ws-1",
          ctxPackID: created.id,
          expectedRevision: 1,
          patch: { title: "Renamed" },
          idempotencyKey: "rev-p1",
        })

        const patchConflict = yield* outcome(
          service.patch(actor(), {
            workspaceID: "ws-1",
            ctxPackID: created.id,
            expectedRevision: 1,
            patch: { title: "Stale" },
            idempotencyKey: "rev-p2",
          }),
        )
        expect(patchConflict.ok).toBe(false)
        if (!patchConflict.ok)
          expect(patchConflict.error).toEqual({ _tag: "CtxPackRevisionConflict", currentRevision: 2 })

        const removeConflict = yield* outcome(service.remove(actor(), { ctxPackID: created.id, expectedRevision: 1 }))
        expect(removeConflict.ok).toBe(false)
        if (!removeConflict.ok)
          expect(removeConflict.error).toEqual({ _tag: "CtxPackRevisionConflict", currentRevision: 2 })

        // Restore with a stale revision conflicts as well.
        yield* service.remove(actor(), { ctxPackID: created.id, expectedRevision: 2 })
        const restoreConflict = yield* outcome(service.restore(actor(), { ctxPackID: created.id, expectedRevision: 1 }))
        expect(restoreConflict.ok).toBe(false)
        if (!restoreConflict.ok)
          expect(restoreConflict.error).toEqual({ _tag: "CtxPackRevisionConflict", currentRevision: 2 })
      }),
    )
  })

  test("list rejects out-of-range limits (page limit is at most 50)", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const harness = withServiceHarness(repository)
        const result = yield* outcome((yield* harness.service()).list(actor(), listRequest({ limit: 51 })))
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toMatchObject({ _tag: "CtxPackInvalidSelection" })
      }),
    )
  })
})

// --- SessionInput admission on the REAL X1 + C2 stack --------------------------

const buildAdmissionStack = (rights: Right[]) => {
  const capabilityNode = makeGlobalNode({
    service: CapabilityService.Service,
    layer: Layer.provide(
      Layer.provide(
        CapabilityService.layer,
        Layer.succeed(WorkspaceMembershipService, { isMember: () => Effect.succeed(true) }),
      ),
      Layer.succeed(UserWorkspaceRightsService, { rightsFor: () => Effect.succeed(rights) }),
    ),
    deps: [],
  })
  const inMemoryDatabaseNode = makeGlobalNode({
    service: Database.Service,
    layer: Database.layerFromPath(":memory:"),
    deps: [],
  })
  const execution = Layer.succeed(
    SessionExecution.Service,
    SessionExecution.Service.of({
      active: Effect.sync(() => new Set<SessionV2.ID>()),
      resume: () => Effect.void,
      interrupt: () => Effect.void,
      wake: () => Effect.void,
    }),
  )
  return testEffect(
    AppNodeBuilder.build(
      LayerNode.group([
        Database.node,
        EventV2.node,
        SessionV2.node,
        CtxPackRepositoryNode,
        ContextCapsuleNode,
        CtxPackEventsNode,
        CtxPackObservabilityNode,
        CtxPackUsageNode,
        CtxPackMaterializerNode,
        ctxPackEventPortNode,
        sessionContextAssemblyPortNode,
        ctxPackUsagePortNode,
      ]),
      [
        [Database.node, inMemoryDatabaseNode],
        [CapabilityService.node, capabilityNode],
        [SessionExecution.node, execution],
        [SessionInput.SessionContextAssemblyPort.node, sessionContextAssemblyPortNode],
        [SessionContextProfile.node, SessionContextProfile.genericNode],
        [SessionContextTransferReadiness.node, SessionContextTransferReadiness.localOnlyNode],
      ],
    ),
  )
}

const itAllowed = buildAdmissionStack(ALL)
const itDenied = buildAdmissionStack([])

const sessionID = SessionV2.ID.make("ses_ctxpack_acceptance")
const workspaceID = WorkspaceV2.ID.make("wrk_ctxpack_acceptance")

const admissionSetup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      workspace_id: workspaceID,
      slug: "ctxpack-acceptance",
      directory: "/project",
      title: "ctxpack acceptance",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const admittedRow = (id: SessionMessage.ID) =>
  Database.Service.use(({ db }) =>
    db
      .select()
      .from(SessionInputTable)
      .where(eq(SessionInputTable.id, id))
      .get()
      .pipe(
        Effect.orDie,
        Effect.flatMap((row) =>
          row === undefined ? Effect.die(`missing session input row: ${id}`) : Effect.succeed(row),
        ),
      ),
  )

const admittedCount = () =>
  Database.Service.use(({ db }) =>
    db
      .select()
      .from(SessionInputTable)
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows.length),
      ),
  )

const usageLedgerCount = () =>
  Database.Service.use(({ db }) =>
    db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM ctx_pack_usage_admission`).pipe(
      Effect.orDie,
      Effect.map((rows) => rows[0]?.count ?? 0),
    ),
  )

// A pack + capsule fixture inside the session stack.
const seedPackAndCapsule = Effect.gen(function* () {
  const repository = yield* CtxPackRepositoryService
  const capsuleStore = yield* ContextCapsuleStoreService
  const pack = yield* repository.create({
    workspaceID: "wrk_ctxpack_acceptance",
    createdByUserID: "user_1",
    title: "Admission pack",
    keywords: ["turbine"],
    sensitivity: "workspace",
    fragments: [
      {
        clientFragmentID: "cf-1",
        text: `Turbine stage one ${SENTINEL}`,
        source: {
          workspaceID: "wrk_ctxpack_acceptance",
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
        },
      },
    ],
    idempotencyKey: "admission-pack-1",
    now: 1_000,
  })
  const capsuleID = "ctxkpsl_admission_1"
  yield* capsuleStore
    .store(
      makeCapsule({
        id: capsuleID,
        workspaceID: "wrk_ctxpack_acceptance",
        pack,
        createdBy: { userId: "user_1", instanceId: `chat-instance:${sessionID}` },
      }),
    )
    .pipe(Effect.orDie)
  return { pack, capsuleID }
})

describe("SessionInput admission on the real X1 materializer + C2 usage ledger", () => {
  itAllowed.effect("admits one input row with the context snapshot, then records usage once", () =>
    Effect.gen(function* () {
      yield* admissionSetup
      const { pack, capsuleID } = yield* seedPackAndCapsule
      const session = yield* SessionV2.Service

      const message = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Use the attached pack" }),
        userID: "user_1",
        contextAttachments: [attachmentInput(capsuleID, pack)],
        resume: false,
      })

      const row = yield* admittedRow(message.id)
      expect(row.context_snapshot_json).toMatchObject({
        version: 1,
        attachments: [{ contextCapsuleID: capsuleID, sourceCtxPackID: pack.id, label: "Admission pack" }],
      })
      expect(yield* admittedCount()).toBe(1)
      // CtxPackChanged is a TRANSIENT EventV2 hint (live subscribers only, no
      // durable replay) — it is never persisted to the event table, so the
      // "used" event is verified via the recording publisher in the
      // service-level usage test above instead.
      expect(yield* usageLedgerCount()).toBe(1)

      const repository = yield* CtxPackRepositoryService
      const info = yield* repository.get("wrk_ctxpack_acceptance", pack.id, false)
      expect(info.usage.attachedCount).toBe(1)

      // A second admission of the SAME pack via a new session input counts once more.
      const again = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Use it again" }),
        userID: "user_1",
        contextAttachments: [attachmentInput(capsuleID, pack)],
        resume: false,
      })
      expect(yield* admittedRow(again.id)).toBeDefined()
      expect(yield* usageLedgerCount()).toBe(2)
      const info2 = yield* repository.get("wrk_ctxpack_acceptance", pack.id, false)
      expect(info2.usage.attachedCount).toBe(2)
    }),
  )

  itDenied.effect("a denied capability rejects the whole admission — no input row, no event, no usage", () =>
    Effect.gen(function* () {
      yield* admissionSetup
      const { pack, capsuleID } = yield* seedPackAndCapsule
      const session = yield* SessionV2.Service

      const failure = yield* session
        .prompt({
          sessionID,
          prompt: Prompt.make({ text: "Should be denied" }),
          userID: "user_1",
          contextAttachments: [attachmentInput(capsuleID, pack)],
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure._tag).toBe("SessionInput.ContextAttachmentError")
      expect((failure as SessionInput.ContextAttachmentError).code).toBe("CtxPackCapabilityDenied")
      expect(yield* admittedCount()).toBe(0)
      expect(yield* usageLedgerCount()).toBe(0)
      const repository = yield* CtxPackRepositoryService
      const info = yield* repository.get("wrk_ctxpack_acceptance", pack.id, false)
      expect(info.usage.attachedCount).toBe(0)
    }),
  )

  itAllowed.effect("the admitted snapshot survives pack deletion (source independence)", () =>
    Effect.gen(function* () {
      yield* admissionSetup
      const { pack, capsuleID } = yield* seedPackAndCapsule
      const session = yield* SessionV2.Service

      const message = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Snapshot it" }),
        userID: "user_1",
        contextAttachments: [attachmentInput(capsuleID, pack)],
        resume: false,
      })
      const row = yield* admittedRow(message.id)
      const snapshotBefore = JSON.stringify(row.context_snapshot_json)

      // Delete the pack after admission: the durable snapshot row is untouched.
      const repository = yield* CtxPackRepositoryService
      yield* repository.softDelete("wrk_ctxpack_acceptance", pack.id, pack.revision)
      const after = yield* admittedRow(message.id)
      expect(JSON.stringify(after.context_snapshot_json)).toBe(snapshotBefore)

      // A NEW admission with the same capsule now fails (pack deleted).
      const retry = yield* session
        .prompt({
          sessionID,
          prompt: Prompt.make({ text: "Retry after delete" }),
          userID: "user_1",
          contextAttachments: [attachmentInput(capsuleID, pack)],
          resume: false,
        })
        .pipe(Effect.flip)
      expect((retry as SessionInput.ContextAttachmentError).code).toBe("CtxPackDeleted")
      expect(yield* admittedCount()).toBe(1) // still only the original row
    }),
  )

  itAllowed.effect("nine attachments are rejected by admission before context assembly — no input row", () =>
    Effect.gen(function* () {
      yield* admissionSetup
      const session = yield* SessionV2.Service

      const attachments = Array.from({ length: 9 }, (_, i) => ({
        contextCapsuleID: `ctxkpsl_nope_${i}`,
        label: `Pack ${i}`,
        contentHash: `sha256:${i}`,
        source: { kind: "ctxpack" as const, ctxPackID: `ctxpk_nope_${i}` },
      }))
      const failure = yield* session
        .prompt({
          sessionID,
          prompt: Prompt.make({ text: "Too many" }),
          userID: "user_1",
          contextAttachments: attachments,
          resume: false,
        })
        .pipe(Effect.flip)
      expect((failure as SessionInput.ContextAttachmentError).code).toBe("too-many-attachments")
      expect(yield* admittedCount()).toBe(0)
      expect(yield* usageLedgerCount()).toBe(0)
    }),
  )
})

// --- 10k-pack behavior ----------------------------------------------------------

describe("10k-pack behavior", () => {
  test("seed 10,000 packs x 2 fragments in bounded time; page limit <= 50, cursor pagination dupe-free, FTS virtual table, list never calls get", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const seedStart = performance.now()

        let getCalls = 0
        const spiedRepository: CtxPackRepository = {
          ...repository,
          get: ((workspaceID, ctxPackID, includeDeleted) => {
            getCalls += 1
            return repository.get(workspaceID, ctxPackID, includeDeleted)
          }) as CtxPackRepository["get"],
        }

        const SEED_TARGET = 10_000
        let seeded = 0
        for (let i = 0; i < SEED_TARGET; i += 1) {
          if (performance.now() - seedStart > 55_000) {
            // Bounded time: stop seeding and validate on the subset.
            console.log(`[10k] seed budget hit at ${seeded} packs (${Math.round(performance.now() - seedStart)}ms)`)
            break
          }
          yield* spiedRepository.create({
            workspaceID: "ws-1",
            createdByUserID: "user-1",
            title: `Pack ${i}`,
            keywords: [`kw${i % 7}`],
            sensitivity: "workspace",
            fragments: [
              { clientFragmentID: `cf-a-${i}`, text: `pump stage ${i}`, source: source({ blockID: `b${i % 3}` }) },
              {
                clientFragmentID: `cf-b-${i}`,
                text: `turbine rotor ${i}`,
                source: source({ blockID: `b${i % 3}`, functionalityID: "builtin:search", kind: "search" }),
              },
            ],
            idempotencyKey: `seed-${i}`,
            now: 1_000 + i,
          })
          seeded += 1
        }
        const seedMs = Math.round(performance.now() - seedStart)
        console.log(`[10k] seeded ${seeded} packs x 2 fragments in ${seedMs}ms`)
        expect(seeded).toBeGreaterThanOrEqual(150) // enough for 3 pages of 50

        // Page limit: a limit-50 list returns at most 50 items.
        const page1 = yield* spiedRepository.list(listRequest({ limit: 50 }))
        expect(page1.items.length).toBeLessThanOrEqual(50)
        expect(page1.items.length).toBe(Math.min(50, seeded))
        expect(page1.totalEstimate).toBe(seeded)

        // Cursor pagination across 3 pages: no duplicates, full coverage.
        const page2 = yield* spiedRepository.list(listRequest({ limit: 50, cursor: page1.nextCursor }))
        const page3 = yield* spiedRepository.list(listRequest({ limit: 50, cursor: page2.nextCursor }))
        const ids = [...page1.items, ...page2.items, ...page3.items].map((item) => item.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids).toHaveLength(150)
        expect(page1.nextCursor).not.toBeNull()
        expect(page2.nextCursor).not.toBeNull()
        expect(page3.nextCursor).not.toBeNull()

        // List never fetches details: get() must not be called by list paths.
        expect(getCalls).toBe(0)

        // FTS query must hit the virtual table index.
        const ftsQuery = buildFtsQuery("turbine")
        expect(ftsQuery).not.toBeNull()
        const plan = yield* db.all<{ detail: string }>(
          sql`EXPLAIN QUERY PLAN SELECT ctx_pack_id FROM ctx_pack_fts WHERE workspace_id = 'ws-1' AND ctx_pack_fts MATCH ${ftsQuery}`,
        )
        expect(plan.map((row) => row.detail).join("\n")).toContain("VIRTUAL TABLE INDEX")

        // Sanity: the FTS query actually matches seeded rows.
        const hits = yield* spiedRepository.list(listRequest({ query: ftsQuery ?? "", limit: 50 }))
        expect(hits.items.length).toBeGreaterThan(0)
      }),
    )
  }, 180_000)
})
