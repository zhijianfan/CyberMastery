import { describe, expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import { Capability } from "@opencode-ai/core/capability/service"
import type { Right } from "@opencode-ai/core/capability/subjects"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import ctxPackMigration from "@opencode-ai/core/database/migration/20260821_ctxpack"
import capsuleMigration from "@opencode-ai/core/database/migration/20260821_capsule"
import {
  MAX_RECALL_CANDIDATES,
  buildRecallTerms,
  isTrivialRecallTurn,
  searchForRecall,
  snapshotCandidate,
} from "@opencode-ai/core/ctxpack/recall"
import { CtxPackRepositoryService, ensureCtxPackFts, make } from "@opencode-ai/core/ctxpack/sql"
import type { CtxPackRepository } from "@opencode-ai/core/ctxpack/sql"

const ALL: Right[] = ["read", "write", "execute"]
const makeDb = EffectDrizzleSqlite.makeWithDefaults()

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped))

const setup = (options: { member?: boolean; rights?: Right[] } = {}) =>
  Effect.gen(function* () {
    const db = yield* makeDb
    yield* DatabaseMigration.applyOnly(db, [ctxPackMigration, capsuleMigration])
    yield* ensureCtxPackFts(db)
    const repository = make(db)
    const capability = yield* Capability.Service.pipe(
      Effect.provide(
        Layer.provide(
          Layer.provide(
            Capability.layer,
            Layer.succeed(Capability.WorkspaceMembershipService, {
              isMember: () => Effect.succeed(options.member ?? true),
            }),
          ),
          Layer.succeed(Capability.UserWorkspaceRightsService, {
            rightsFor: () => Effect.succeed(options.rights ?? ALL),
          }),
        ),
      ),
    )
    return { db, repository, capability }
  })

const source = (workspaceID = "ws-1"): CtxPack.Source => ({
  workspaceID,
  blockID: "block-1",
  functionalityID: "builtin:chat",
  kind: "message",
  direction: "received",
  sourceTimestamp: 1787300000000,
  capturedAt: 1787300010000,
  entityRef: null,
  label: null,
  metadata: {},
  sensitivity: "workspace",
})

const createPack = (
  repository: CtxPackRepository,
  input: {
    key: string
    text: string
    title?: string
    workspaceID?: string
    createdByUserID?: string
    sensitivity?: CtxPack.Sensitivity
  },
) =>
  repository.create({
    workspaceID: input.workspaceID ?? "ws-1",
    createdByUserID: input.createdByUserID ?? "user-1",
    title: input.title ?? input.text,
    keywords: [],
    sensitivity: input.sensitivity ?? "workspace",
    fragments: [{ clientFragmentID: `fragment-${input.key}`, text: input.text, source: source(input.workspaceID) }],
    idempotencyKey: input.key,
    now: 1787300020000,
  })

const outcome = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.catch(
    Effect.map(effect, (value) => ({ ok: true as const, value })),
    (error) => Effect.succeed({ ok: false as const, error }),
  )

const readSnapshot = (
  repository: CtxPackRepository,
  capability: Capability.Interface,
  input: Parameters<typeof snapshotCandidate>[0],
) =>
  snapshotCandidate(input).pipe(
    Effect.provideService(CtxPackRepositoryService, repository),
    Effect.provideService(Capability.Service, capability),
  )

describe("operating-chat-v1 recall policy", () => {
  test("normalizes NFKC and keeps at most eight first-occurrence non-stop terms", () => {
    expect(buildRecallTerms("ＴＨＥ Pump, pump VALVE valve café CAFÉ one two three four five six seven eight nine")).toEqual([
      "pump",
      "valve",
      "café",
      "one",
      "two",
      "three",
      "four",
      "five",
    ])
    expect(buildRecallTerms("the, and... from?!")).toEqual([])
    expect(buildRecallTerms("... !!!")).toEqual([])
    expect(buildRecallTerms("_")).toEqual([])
    expect(buildRecallTerms("the_and pump_valve")).toEqual(["pump", "valve"])
  })

  test("skips only the frozen trivial values after normalization", () => {
    for (const value of ["hi", "HELLO!", " hey... ", "ＯＫ", "okay", "thanks!", "thank-you", "got it.", "sounds   good!"]) {
      expect(isTrivialRecallTurn(value), value).toBe(true)
    }
    for (const value of ["yes", "no", "continue", "hi there", "thanks again"]) {
      expect(isTrivialRecallTurn(value), value).toBe(false)
    }
  })
})

describe("deterministic CtxPack recall query", () => {
  test("uses OR semantics while enforcing workspace and non-deleted filters", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const alpha = yield* createPack(repository, { key: "alpha", text: "alpha only" })
        const beta = yield* createPack(repository, { key: "beta", text: "beta only" })
        const deleted = yield* createPack(repository, { key: "deleted", text: "alpha deleted" })
        yield* repository.softDelete("ws-1", deleted.id, deleted.revision)
        yield* createPack(repository, { key: "other-workspace", text: "alpha hidden", workspaceID: "ws-2" })

        const candidates = yield* searchForRecall({ workspaceID: "ws-1", terms: ["alpha", "beta"] }).pipe(
          Effect.provideService(Database.Service, { db }),
        )
        expect(new Set(candidates.map((candidate) => candidate.ctxPackID))).toEqual(new Set([alpha.id, beta.id]))
      }),
    )
  })

  test("uses the same underscore boundaries as the unicode61 FTS tokenizer", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const pump = yield* createPack(repository, { key: "pump", text: "pump only" })
        const valve = yield* createPack(repository, { key: "valve", text: "valve only" })

        const candidates = yield* searchForRecall({ workspaceID: "ws-1", terms: ["pump_valve"] }).pipe(
          Effect.provideService(Database.Service, { db }),
        )
        expect(new Set(candidates.map((candidate) => candidate.ctxPackID))).toEqual(new Set([pump.id, valve.id]))
      }),
    )
  })

  test("orders by BM25 ascending and uses CtxPack ID as the final tie-break", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const weak = yield* createPack(repository, { key: "weak", title: "notes", text: "alpha with unrelated words" })
        const strong = yield* createPack(repository, {
          key: "strong",
          title: "alpha alpha alpha",
          text: "alpha alpha alpha alpha",
        })
        const tieA = yield* createPack(repository, { key: "tie-a", title: "identical", text: "tie exact content" })
        const tieB = yield* createPack(repository, { key: "tie-b", title: "identical", text: "tie exact content" })

        const ranked = yield* searchForRecall({ workspaceID: "ws-1", terms: ["alpha"] }).pipe(
          Effect.provideService(Database.Service, { db }),
        )
        expect(ranked.map((candidate) => candidate.ctxPackID).indexOf(strong.id)).toBeLessThan(
          ranked.map((candidate) => candidate.ctxPackID).indexOf(weak.id),
        )

        const tied = yield* searchForRecall({ workspaceID: "ws-1", terms: ["tie"] }).pipe(
          Effect.provideService(Database.Service, { db }),
        )
        expect(tied.map((candidate) => candidate.ctxPackID)).toEqual([tieA.id, tieB.id].sort())
        expect(tied[0]!.rank).toBe(tied[1]!.rank)
      }),
    )
  })

  test("returns exactly the fixed first sixteen candidates and exposes no raw query text", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const packs = yield* Effect.all(
          Array.from({ length: MAX_RECALL_CANDIDATES + 1 }, (_, index) =>
            createPack(repository, { key: `boundary-${index}`, title: "identical", text: "boundary exact content" }),
          ),
          { concurrency: 1 },
        )

        const candidates = yield* searchForRecall({ workspaceID: "ws-1", terms: ["boundary"] }).pipe(
          Effect.provideService(Database.Service, { db }),
        )
        expect(candidates).toHaveLength(16)
        expect(candidates.map((candidate) => candidate.ctxPackID)).toEqual(packs.map((pack) => pack.id).sort().slice(0, 16))
        expect(JSON.stringify(candidates)).not.toContain("boundary")
      }),
    )
  })

  test("does not run MATCH when no safe terms remain", async () => {
    await run(
      Effect.gen(function* () {
        const { db } = yield* setup()
        expect(
          yield* searchForRecall({ workspaceID: "ws-1", terms: ["...", "\""] }).pipe(
            Effect.provideService(Database.Service, { db }),
          ),
        ).toEqual([])
      }),
    )
  })
})

describe("authorized automatic recall snapshots", () => {
  test("checks the authoritative pack and instance subjects and returns a deep-frozen snapshot without a capsule", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository, capability } = yield* setup()
        const pack = yield* createPack(repository, { key: "snapshot", text: "immutable fragment" })
        const checks: Capability.CapabilityCheckInput[] = []
        const recordingCapability: Capability.Interface = {
          check: capability.check,
          require: (input) =>
            Effect.sync(() => checks.push(input)).pipe(Effect.andThen(capability.require(input))),
        }
        const snapshot = yield* readSnapshot(repository, recordingCapability, {
          actor: { userID: "user-1", workspaceID: "ws-1" },
          targetInstanceID: "operating-instance-1",
          targetFunctionalityID: "builtin:operating-chat-session",
          ctxPackID: pack.id,
          expectedContentHash: pack.contentHash,
        })

        expect(checks).toEqual([
          {
            userID: "user-1",
            operation: "ctxpack.read",
            subject: {
              type: "CtxPack",
              workspaceID: "ws-1",
              ctxPackID: pack.id,
              sensitivity: "workspace",
              createdByUserID: "user-1",
            },
          },
          {
            userID: "user-1",
            operation: "chat.context.attach",
            subject: {
              type: "FunctionalityInstance",
              workspaceID: "ws-1",
              instanceID: "operating-instance-1",
              functionalityID: "builtin:operating-chat-session",
            },
          },
        ])
        expect(snapshot).toEqual({
          sourceCtxPackID: pack.id,
          label: pack.title,
          contentHash: pack.contentHash,
          fragments: pack.fragments.map((fragment) => ({
            text: fragment.text,
            source: fragment.source,
            contentHash: fragment.contentHash,
          })),
        })
        expect(Object.isFrozen(snapshot)).toBe(true)
        expect(Object.isFrozen(snapshot.fragments)).toBe(true)
        expect(Object.isFrozen(snapshot.fragments[0])).toBe(true)
        expect(Object.isFrozen(snapshot.fragments[0]!.source)).toBe(true)
        expect(Object.isFrozen(snapshot.fragments[0]!.source.metadata)).toBe(true)
        expect(yield* db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM context_capsule`)).toEqual({ count: 0 })
      }),
    )
  })

  test("rejects non-members, private non-owners, missing rights, stale hashes, and deleted packs", async () => {
    await run(
      Effect.gen(function* () {
        const nonMember = yield* setup({ member: false })
        const memberPack = yield* createPack(nonMember.repository, { key: "member", text: "member" })
        expect(
          yield* outcome(
            readSnapshot(nonMember.repository, nonMember.capability, {
              actor: { userID: "user-1", workspaceID: "ws-1" },
              targetInstanceID: "instance-1",
              targetFunctionalityID: "builtin:operating-chat-session",
              ctxPackID: memberPack.id,
              expectedContentHash: memberPack.contentHash,
            }),
          ),
        ).toEqual({ ok: false, error: { _tag: "CtxPackPermissionDenied", operation: "ctxpack.read" } })

        const privateSetup = yield* setup()
        const privatePack = yield* createPack(privateSetup.repository, {
          key: "private",
          text: "private",
          sensitivity: "private",
          createdByUserID: "owner-1",
        })
        expect(
          yield* outcome(
            readSnapshot(privateSetup.repository, privateSetup.capability, {
              actor: { userID: "user-1", workspaceID: "ws-1" },
              targetInstanceID: "instance-1",
              targetFunctionalityID: "builtin:operating-chat-session",
              ctxPackID: privatePack.id,
              expectedContentHash: privatePack.contentHash,
            }),
          ),
        ).toEqual({ ok: false, error: { _tag: "CtxPackPermissionDenied", operation: "ctxpack.read" } })

        const readOnly = yield* setup({ rights: ["read"] })
        const readOnlyPack = yield* createPack(readOnly.repository, { key: "read-only", text: "read only" })
        expect(
          yield* outcome(
            readSnapshot(readOnly.repository, readOnly.capability, {
              actor: { userID: "user-1", workspaceID: "ws-1" },
              targetInstanceID: "instance-1",
              targetFunctionalityID: "builtin:operating-chat-session",
              ctxPackID: readOnlyPack.id,
              expectedContentHash: readOnlyPack.contentHash,
            }),
          ),
        ).toEqual({ ok: false, error: { _tag: "CtxPackPermissionDenied", operation: "chat.context.attach" } })

        const live = yield* setup()
        const livePack = yield* createPack(live.repository, { key: "stale", text: "stale" })
        expect(
          yield* outcome(
            readSnapshot(live.repository, live.capability, {
              actor: { userID: "user-1", workspaceID: "ws-1" },
              targetInstanceID: "instance-1",
              targetFunctionalityID: "builtin:operating-chat-session",
              ctxPackID: livePack.id,
              expectedContentHash: "sha256:stale",
            }),
          ),
        ).toEqual({ ok: false, error: { _tag: "CtxPackContentChanged", currentContentHash: livePack.contentHash } })
        yield* live.repository.softDelete("ws-1", livePack.id, livePack.revision)
        expect(
          yield* outcome(
            readSnapshot(live.repository, live.capability, {
              actor: { userID: "user-1", workspaceID: "ws-1" },
              targetInstanceID: "instance-1",
              targetFunctionalityID: "builtin:operating-chat-session",
              ctxPackID: livePack.id,
              expectedContentHash: livePack.contentHash,
            }),
          ),
        ).toEqual({ ok: false, error: { _tag: "CtxPackDeleted", ctxPackID: livePack.id } })
      }),
    )
  })
})
