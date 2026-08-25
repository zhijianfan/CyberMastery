import { describe, expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import type { EffectDrizzleSqlite as EffectDrizzleSqliteType } from "@opencode-ai/effect-drizzle-sqlite"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import type { CtxPackError } from "@opencode-ai/schema/ctxpack"
import { sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import {
  layer as capabilityLayer,
  Service as CapabilityService,
  UserWorkspaceRightsService,
  WorkspaceMembershipService,
} from "@opencode-ai/core/capability/service"
import type { CapabilityCheckInput, Interface as CapabilityInterface } from "@opencode-ai/core/capability/service"
import type { Right } from "@opencode-ai/core/capability/subjects"
import {
  MAX_RECALL_CANDIDATES,
  buildRecallTerms,
  isTrivialRecallTurn,
  searchForRecall,
  snapshotCandidate,
} from "@opencode-ai/core/ctxpack/recall"
import type { RecallCandidate, RecallSnapshot } from "@opencode-ai/core/ctxpack/recall"
import {
  CtxPackRepositoryService,
  ensureCtxPackFts,
  make as makeRepository,
} from "@opencode-ai/core/ctxpack/sql"
import type { CtxPackRepository } from "@opencode-ai/core/ctxpack/sql"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import capsuleMigration from "@opencode-ai/core/database/migration/20260821_capsule"
import ctxPackMigration from "@opencode-ai/core/database/migration/20260821_ctxpack"

const ALL_RIGHTS: Right[] = ["read", "write", "execute"]
const makeDb = EffectDrizzleSqlite.makeWithDefaults()
type Db = EffectDrizzleSqliteType.EffectSQLiteDatabase

interface Harness {
  readonly db: Db
  readonly repository: CtxPackRepository
  readonly capabilityInputs: CapabilityCheckInput[]
  readonly membershipChecks: Array<{ userID: string; workspaceID: string }>
  readonly search: (workspaceID: string, terms: readonly string[]) => Effect.Effect<readonly RecallCandidate[]>
  readonly snapshot: (
    input: Parameters<typeof snapshotCandidate>[0],
  ) => Effect.Effect<RecallSnapshot, CtxPackError>
}

const withRecall = <A>(
  options: {
    readonly member?: boolean
    readonly rights?: readonly Right[]
    readonly repository?: (repository: CtxPackRepository) => CtxPackRepository
  },
  use: (harness: Harness) => Promise<A>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* DatabaseMigration.applyOnly(db, [ctxPackMigration, capsuleMigration])
      yield* ensureCtxPackFts(db)
      const repository = (options.repository ?? ((value: CtxPackRepository) => value))(makeRepository(db))
      const membershipChecks: Array<{ userID: string; workspaceID: string }> = []
      const capabilityInputs: CapabilityCheckInput[] = []
      const baseCapability = yield* CapabilityService.pipe(
        Effect.provide(
          Layer.provide(
            Layer.provide(
              capabilityLayer,
              Layer.succeed(WorkspaceMembershipService, {
                isMember: (userID, workspaceID) =>
                  Effect.sync(() => {
                    membershipChecks.push({ userID, workspaceID })
                    return options.member ?? true
                  }),
              }),
            ),
            Layer.succeed(UserWorkspaceRightsService, {
              rightsFor: () => Effect.succeed([...(options.rights ?? ALL_RIGHTS)]),
            }),
          ),
        ),
      )
      const capability: CapabilityInterface = {
        check: (input) =>
          Effect.sync(() => capabilityInputs.push(input)).pipe(Effect.andThen(baseCapability.check(input))),
        require: (input) =>
          Effect.sync(() => capabilityInputs.push(input)).pipe(Effect.andThen(baseCapability.require(input))),
      }
      const database = Layer.succeed(Database.Service, { db })
      const repositoryLayer = Layer.succeed(CtxPackRepositoryService, repository)
      const capabilityService = Layer.succeed(CapabilityService, capability)

      return yield* Effect.promise(() =>
        use({
          db,
          repository,
          capabilityInputs,
          membershipChecks,
          search: (workspaceID, terms) => searchForRecall({ workspaceID, terms }).pipe(Effect.provide(database)),
          snapshot: (input) =>
            snapshotCandidate(input).pipe(
              Effect.provide(database),
              Effect.provide(repositoryLayer),
              Effect.provide(capabilityService),
            ),
        }),
      )
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

const outcome = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.catch(
      Effect.map(effect, (value) => ({ ok: true as const, value })),
      (error) => Effect.succeed({ ok: false as const, error }),
    ),
  )

const source = (overrides: Partial<CtxPack.Source> = {}): CtxPack.Source => ({
  workspaceID: "ws-1",
  blockID: "block-1",
  functionalityID: "builtin:operating-chat-session",
  kind: "message",
  direction: "received",
  sourceTimestamp: 1787300000000,
  capturedAt: 1787300010000,
  entityRef: { type: "message", id: "msg-1" },
  label: "Prior turn",
  metadata: { sequence: 1 },
  sensitivity: "workspace",
  ...overrides,
})

const createPack = (repository: CtxPackRepository, overrides: Partial<CtxPackRepository.Create> = {}) =>
  Effect.runPromise(
    repository.create({
      workspaceID: "ws-1",
      createdByUserID: "user-1",
      title: "Niagara pump findings",
      keywords: ["Niagara", "pump"],
      sensitivity: "workspace",
      fragments: [{ clientFragmentID: "frag-0", text: "The pump pressure is stable.", source: source() }],
      idempotencyKey: "recall-pack",
      now: 1787300020000,
      ...overrides,
    }),
  )

const insertSearchPack = (
  db: Db,
  input: {
    readonly id: string
    readonly workspaceID?: string
    readonly content: string
    readonly title?: string
    readonly sensitivity?: CtxPack.Sensitivity
    readonly createdByUserID?: string
    readonly deletedAt?: number | null
  },
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const workspaceID = input.workspaceID ?? "ws-1"
      const title = input.title ?? input.id
      const byteLength = new TextEncoder().encode(input.content).length
      yield* db.run(
        sql`INSERT INTO ctx_pack (id, workspace_id, created_by_user_id, title, sensitivity, revision, content_hash, byte_length, estimated_tokens, attached_count, last_attached_at, create_idempotency_key, time_created, time_updated, time_deleted) VALUES (${input.id}, ${workspaceID}, ${input.createdByUserID ?? "user-1"}, ${title}, ${input.sensitivity ?? "workspace"}, 1, ${`hash-${input.id}`}, ${byteLength}, ${Math.ceil(byteLength / 4)}, 0, NULL, ${`key-${input.id}`}, 1787300020000, 1787300020000, ${input.deletedAt ?? null})`,
      )
      yield* db.run(
        sql`INSERT INTO ctx_pack_fts (ctx_pack_id, workspace_id, title, keywords, content) VALUES (${input.id}, ${workspaceID}, ${title}, '', ${input.content})`,
      )
    }),
  )

const snapshotInput = (pack: CtxPack.Info): Parameters<typeof snapshotCandidate>[0] => ({
  actor: { userID: "user-1", workspaceID: "ws-1" },
  targetInstanceID: "operating-instance-1",
  targetFunctionalityID: "builtin:operating-chat-session",
  ctxPackID: pack.id,
  expectedContentHash: pack.contentHash,
})

describe("CtxPack recall policy", () => {
  test("NFKC-normalizes tokens and keeps the first eight case-insensitive unique terms", () => {
    expect(buildRecallTerms("The ＰＵＭＰ pump Valve valve alpha beta gamma delta epsilon zeta eta theta")).toEqual([
      "pump",
      "valve",
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
    ])
  })

  test("skips only deterministic normalized greetings and acknowledgements", () => {
    expect(isTrivialRecallTurn("  Ｈｅｌｌｏ!!! ")).toBe(true)
    expect(isTrivialRecallTurn("Thank you.")).toBe(true)
    expect(isTrivialRecallTurn("ＯＫ")).toBe(true)
    expect(isTrivialRecallTurn("hello turbine")).toBe(false)
    expect(isTrivialRecallTurn("okay, diagnose the pump")).toBe(false)
  })

  test("stop-word and punctuation-only input produces no recall terms or query results", async () => {
    expect(buildRecallTerms("the, and... of / to? in!")).toEqual([])
    await withRecall({}, async ({ search }) => {
      expect(await Effect.runPromise(search("ws-1", []))).toEqual([])
    })
  })
})

describe("CtxPack recall query", () => {
  test("uses OR semantics while requiring the live workspace-scoped pack row", async () => {
    await withRecall({}, async ({ db, search }) => {
      await insertSearchPack(db, { id: "ctxpk_alpha", content: "alpha only" })
      await insertSearchPack(db, { id: "ctxpk_beta", content: "beta only" })
      await insertSearchPack(db, { id: "ctxpk_other_workspace", workspaceID: "ws-2", content: "alpha beta" })
      await insertSearchPack(db, { id: "ctxpk_deleted", content: "alpha beta", deletedAt: 1787300030000 })

      const candidates = await Effect.runPromise(search("ws-1", ["alpha", "beta"]))
      expect(candidates.map((candidate) => String(candidate.ctxPackID)).sort()).toEqual(["ctxpk_alpha", "ctxpk_beta"])
    })
  })

  test("sorts lower BM25 first and uses CtxPack ID as the exact-rank tie-breaker", async () => {
    await withRecall({}, async ({ db, search }) => {
      await insertSearchPack(db, {
        id: "ctxpk_rank_weak",
        content: "rankprobe filler filler filler filler filler filler filler filler filler filler",
      })
      await insertSearchPack(db, { id: "ctxpk_rank_strong", content: "rankprobe rankprobe rankprobe rankprobe" })
      await insertSearchPack(db, { id: "ctxpk_tie_b", content: "tieprobe" })
      await insertSearchPack(db, { id: "ctxpk_tie_a", content: "tieprobe" })

      const ranked = await Effect.runPromise(search("ws-1", ["rankprobe"]))
      expect(ranked.map((candidate) => String(candidate.ctxPackID))).toEqual(["ctxpk_rank_strong", "ctxpk_rank_weak"])
      expect(ranked[0]!.rank).toBeLessThan(ranked[1]!.rank)

      const tied = await Effect.runPromise(search("ws-1", ["tieprobe"]))
      expect(tied.map((candidate) => String(candidate.ctxPackID))).toEqual(["ctxpk_tie_a", "ctxpk_tie_b"])
      expect(tied[0]!.rank).toBe(tied[1]!.rank)
    })
  })

  test("reads at most the fixed 16 rows without replacing denied or stale boundary candidates", async () => {
    expect(MAX_RECALL_CANDIDATES).toBe(16)
    await withRecall({}, async ({ db, search, snapshot }) => {
      for (let index = 0; index < 17; index++) {
        await insertSearchPack(db, {
          id: `ctxpk_boundary_${index.toString().padStart(2, "0")}`,
          content: "boundaryterm",
        })
      }

      const candidates = await Effect.runPromise(search("ws-1", ["boundaryterm"]))
      expect(candidates).toHaveLength(16)
      expect(candidates.map((candidate) => String(candidate.ctxPackID))).toEqual(
        Array.from({ length: 16 }, (_, index) => `ctxpk_boundary_${index.toString().padStart(2, "0")}`),
      )
      expect(candidates.map((candidate) => String(candidate.ctxPackID))).not.toContain("ctxpk_boundary_16")

      await Effect.runPromise(
        db.run(sql`UPDATE ctx_pack SET sensitivity = 'private', created_by_user_id = 'other-user' WHERE id = ${candidates[0]!.ctxPackID}`),
      )
      await Effect.runPromise(
        db.run(sql`UPDATE ctx_pack SET content_hash = 'hash-changed-after-search' WHERE id = ${candidates[1]!.ctxPackID}`),
      )
      const denied = await outcome(
        snapshot({
          actor: { userID: "user-1", workspaceID: "ws-1" },
          targetInstanceID: "operating-instance-1",
          targetFunctionalityID: "builtin:operating-chat-session",
          ctxPackID: candidates[0]!.ctxPackID,
          expectedContentHash: candidates[0]!.contentHash,
        }),
      )
      expect(denied).toEqual({ ok: false, error: { _tag: "CtxPackPermissionDenied", operation: "ctxpack.read" } })
      const stale = await outcome(
        snapshot({
          actor: { userID: "user-1", workspaceID: "ws-1" },
          targetInstanceID: "operating-instance-1",
          targetFunctionalityID: "builtin:operating-chat-session",
          ctxPackID: candidates[1]!.ctxPackID,
          expectedContentHash: candidates[1]!.contentHash,
        }),
      )
      expect(stale).toEqual({
        ok: false,
        error: { _tag: "CtxPackContentChanged", currentContentHash: "hash-changed-after-search" },
      })
      expect(candidates.map((candidate) => String(candidate.ctxPackID))).not.toContain("ctxpk_boundary_16")
    })
  })

  test("returns metadata only and never echoes raw query terms", async () => {
    await withRecall({}, async ({ db, search }) => {
      const sentinel = "rawquerysentinel7812"
      await insertSearchPack(db, { id: "ctxpk_diagnostic", content: sentinel })
      const candidates = await Effect.runPromise(search("ws-1", [sentinel]))

      expect(candidates).toHaveLength(1)
      expect(Object.keys(candidates[0]!).sort()).toEqual([
        "byteLength",
        "contentHash",
        "ctxPackID",
        "estimatedTokens",
        "rank",
      ])
      expect(JSON.stringify(candidates)).not.toContain(sentinel)
    })
  })
})

describe("CtxPack automatic recall snapshot", () => {
  test("authorizes the exact target and returns a deep-frozen repository snapshot without a capsule write", async () => {
    await withRecall({}, async ({ db, repository, snapshot, capabilityInputs, membershipChecks }) => {
      const pack = await createPack(repository)
      const recalled = await Effect.runPromise(snapshot(snapshotInput(pack)))
      const capsuleCount = await Effect.runPromise(db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM context_capsule`))

      expect(recalled).toEqual({
        sourceCtxPackID: pack.id,
        label: "Niagara pump findings",
        contentHash: pack.contentHash,
        fragments: pack.fragments.map((fragment) => ({
          text: fragment.text,
          source: fragment.source,
          contentHash: fragment.contentHash,
        })),
      })
      expect(capabilityInputs).toContainEqual({
        userID: "user-1",
        operation: "ctxpack.read",
        subject: {
          type: "CtxPack",
          workspaceID: "ws-1",
          ctxPackID: pack.id,
          sensitivity: "workspace",
          createdByUserID: "user-1",
        },
      })
      expect(capabilityInputs).toContainEqual({
        userID: "user-1",
        operation: "chat.context.attach",
        subject: {
          type: "FunctionalityInstance",
          workspaceID: "ws-1",
          instanceID: "operating-instance-1",
          functionalityID: "builtin:operating-chat-session",
        },
      })
      expect(membershipChecks).toEqual([
        { userID: "user-1", workspaceID: "ws-1" },
        { userID: "user-1", workspaceID: "ws-1" },
      ])
      expect(capsuleCount?.count).toBe(0)
      expect(Object.isFrozen(recalled)).toBe(true)
      expect(Object.isFrozen(recalled.fragments)).toBe(true)
      expect(Object.isFrozen(recalled.fragments[0]!)).toBe(true)
      expect(Object.isFrozen(recalled.fragments[0]!.source)).toBe(true)
      expect(Object.isFrozen(recalled.fragments[0]!.source.entityRef)).toBe(true)
      expect(Object.isFrozen(recalled.fragments[0]!.source.metadata)).toBe(true)
    })
  })

  test("fails closed for a non-member before revealing pack existence", async () => {
    await withRecall({ member: false }, async ({ repository, snapshot }) => {
      const pack = await createPack(repository)
      const existing = await outcome(snapshot(snapshotInput(pack)))
      const missing = await outcome(
        snapshot({
          ...snapshotInput(pack),
          ctxPackID: CtxPack.ID.make("ctxpk_missing"),
        }),
      )
      expect(existing).toEqual({
        ok: false,
        error: { _tag: "CtxPackPermissionDenied", operation: "chat.context.attach" },
      })
      expect(missing).toEqual(existing)
    })
  })

  test("fails closed for a private pack owned by another user", async () => {
    await withRecall({}, async ({ repository, snapshot }) => {
      const pack = await createPack(repository, {
        createdByUserID: "other-user",
        sensitivity: "private",
        idempotencyKey: "private-pack",
      })
      const result = await outcome(snapshot(snapshotInput(pack)))
      expect(result).toEqual({ ok: false, error: { _tag: "CtxPackPermissionDenied", operation: "ctxpack.read" } })
    })
  })

  test("fails closed when authorization metadata changes before fragment load", async () => {
    await withRecall(
      {
        repository: (repository) => ({
          ...repository,
          get: (workspaceID, ctxPackID, includeDeleted) =>
            repository.get(workspaceID, ctxPackID, includeDeleted).pipe(
              Effect.map((pack) => ({
                ...pack,
                createdByUserID: "other-user",
                sensitivity: "private" as const,
              })),
            ),
        }),
      },
      async ({ repository, snapshot }) => {
        const pack = await createPack(repository)
        expect(await outcome(snapshot(snapshotInput(pack)))).toEqual({
          ok: false,
          error: { _tag: "CtxPackPermissionDenied", operation: "ctxpack.read" },
        })
      },
    )
  })

  test("requires both ctxpack.read and chat.context.attach capabilities", async () => {
    await withRecall({ rights: ["write"] }, async ({ repository, snapshot }) => {
      const pack = await createPack(repository)
      expect(await outcome(snapshot(snapshotInput(pack)))).toEqual({
        ok: false,
        error: { _tag: "CtxPackPermissionDenied", operation: "ctxpack.read" },
      })
    })
    await withRecall({ rights: ["read"] }, async ({ repository, snapshot }) => {
      const pack = await createPack(repository)
      expect(await outcome(snapshot(snapshotInput(pack)))).toEqual({
        ok: false,
        error: { _tag: "CtxPackPermissionDenied", operation: "chat.context.attach" },
      })
    })
  })

  test("rejects cross-workspace, deleted, and content-changed candidates", async () => {
    await withRecall({}, async ({ repository, snapshot }) => {
      const pack = await createPack(repository)
      const crossWorkspace = await outcome(
        snapshot({ ...snapshotInput(pack), actor: { userID: "user-1", workspaceID: "ws-2" } }),
      )
      expect(crossWorkspace).toEqual({ ok: false, error: { _tag: "CtxPackNotFound", ctxPackID: pack.id } })

      const changed = await outcome(snapshot({ ...snapshotInput(pack), expectedContentHash: "hash-stale" }))
      expect(changed).toEqual({
        ok: false,
        error: { _tag: "CtxPackContentChanged", currentContentHash: pack.contentHash },
      })

      await Effect.runPromise(repository.softDelete("ws-1", pack.id, 1))
      const deleted = await outcome(snapshot(snapshotInput(pack)))
      expect(deleted).toEqual({ ok: false, error: { _tag: "CtxPackDeleted", ctxPackID: pack.id } })
    })
  })
})
