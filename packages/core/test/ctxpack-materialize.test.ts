import { describe, expect, test } from "bun:test"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import type { EffectDrizzleSqlite as EffectDrizzleSqliteType } from "@opencode-ai/effect-drizzle-sqlite"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import ctxPackMigration from "@opencode-ai/core/database/migration/20260821_ctxpack"
import capsuleMigration from "@opencode-ai/core/database/migration/20260821_capsule"
import { ensureCtxPackFts, make as makeRepository, CtxPackRepositoryService } from "@opencode-ai/core/ctxpack/sql"
import type { CtxPackRepository } from "@opencode-ai/core/ctxpack/sql"
import {
  layer as capabilityLayer,
  Service as CapabilityService,
  UserWorkspaceRightsService,
  WorkspaceMembershipService,
} from "@opencode-ai/core/capability/service"
import type { Right } from "@opencode-ai/core/capability/subjects"
import {
  DefaultInteractiveContextBudget,
  layer as capsuleLayer,
  Service as ContextCapsuleStoreService,
  type ContextBudget,
  type ContextCapsuleStore,
  type StoredCapsule,
} from "@opencode-ai/core/context-broker/capsule"
import {
  DiagnosticsService,
  layer as materializeLayer,
  make as makeMaterializer,
  Service as MaterializerService,
  type CtxPackActor,
  type CtxPackMaterializeRequest,
  type CtxPackMaterializeResult,
  type CtxPackMaterializer,
  type MaterializeDiagnostics,
  type MaterializeDiagnosticsEntry,
  type SessionContextAttachmentInput,
  type SessionContextSnapshot,
} from "@opencode-ai/core/ctxpack/materialize"

const SENTINEL = "CTXPACK_SECRET_SENTINEL_7812"

const ALL: Right[] = ["read", "write", "execute"]

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
type Db = EffectDrizzleSqliteType.EffectSQLiteDatabase

interface Harness {
  db: Db
  repository: CtxPackRepository
  capsuleStore: ContextCapsuleStore
  materializer: CtxPackMaterializer
  entries: MaterializeDiagnosticsEntry[]
}

const withMaterialize = <A>(
  options: {
    member?: boolean
    rights?: (userID: string) => Right[]
    repository?: (repository: CtxPackRepository) => CtxPackRepository
    recorder?: boolean
  },
  f: (harness: Harness) => Promise<A>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* DatabaseMigration.applyOnly(db, [ctxPackMigration, capsuleMigration])
      const repository = (options.repository ?? ((value: CtxPackRepository) => value))(makeRepository(db))
      const capsuleStore = yield* ContextCapsuleStoreService.pipe(
        Effect.provide(Layer.provide(capsuleLayer, Layer.succeed(Database.Service, { db }))),
      )
      const capability = yield* CapabilityService.pipe(
        Effect.provide(
          Layer.provide(
            Layer.provide(
              capabilityLayer,
              Layer.succeed(WorkspaceMembershipService, {
                isMember: () => Effect.succeed(options.member ?? true),
              }),
            ),
            Layer.succeed(UserWorkspaceRightsService, {
              rightsFor: (userID: string) => Effect.succeed((options.rights ?? (() => ALL))(userID)),
            }),
          ),
        ),
      )
      const entries: MaterializeDiagnosticsEntry[] = []
      const recorder: MaterializeDiagnostics = {
        record: (entry) =>
          Effect.sync(() => {
            entries.push(entry)
          }),
      }
      const materializer = makeMaterializer({
        repository,
        capability,
        capsuleStore,
        diagnostics: options.recorder === false ? undefined : recorder,
      })
      return yield* Effect.promise(() => f({ db, repository, capsuleStore, materializer, entries }))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect)

// Maps a domain failure to a plain tagged result for assertions.
const outcome = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(
    Effect.catch(
      Effect.map(effect, (value) => ({ ok: true as const, value })),
      (error) => Effect.succeed({ ok: false as const, error }),
    ),
  )

// --- Fixtures --------------------------------------------------------------------

const source = (overrides: Partial<CtxPack.Source> = {}): CtxPack.Source => ({
  workspaceID: "ws-1",
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
  ...overrides,
})

const fragmentInput = (index: number, overrides: Partial<CtxPack.Source> = {}) => ({
  clientFragmentID: `frag-${index}`,
  text: `Fragment ${index} text about the post-pressure stage.`,
  source: source(overrides),
})

const createPack = (
  repository: CtxPackRepository,
  overrides: Partial<CtxPackRepository.Create> = {},
) =>
  run(
    repository.create({
      workspaceID: "ws-1",
      createdByUserID: "user-1",
      title: "Niagara pump findings",
      keywords: ["Niagara", "pump"],
      sensitivity: "workspace",
      fragments: [fragmentInput(0), fragmentInput(1, { label: "Second label" })],
      idempotencyKey: `create-${Math.random()}`,
      now: 1787300020000,
      ...overrides,
    }),
  )

const actor: CtxPackActor = { userID: "user-1", workspaceID: "ws-1" }

const materializeRequest = (
  pack: CtxPack.Info,
  overrides: Partial<CtxPackMaterializeRequest> = {},
): CtxPackMaterializeRequest => ({
  workspaceID: "ws-1",
  ctxPackID: pack.id,
  expectedContentHash: pack.contentHash,
  targetInstanceID: "inst-1",
  targetFunctionalityID: "builtin:chat",
  ...overrides,
})

const materializePack = (materializer: CtxPackMaterializer, pack: CtxPack.Info) =>
  run(materializer.materialize(actor, materializeRequest(pack)))

const attachmentOf = (pack: CtxPack.Info, result: CtxPackMaterializeResult): SessionContextAttachmentInput => ({
  contextCapsuleID: result.contextCapsuleID,
  label: result.label,
  contentHash: result.contentHash,
  source: { kind: "ctxpack", ctxPackID: pack.id },
})

const mutateCapsuleJson = async (db: Harness["db"], capsuleID: string, mutate: (capsule: Record<string, unknown>) => void) => {
  const row = await run(db.get<{ capsule_json: string }>(sql`SELECT capsule_json FROM context_capsule WHERE id = ${capsuleID}`))
  if (!row) return
  const body = JSON.parse(row.capsule_json) as Record<string, unknown>
  mutate(body)
  await run(db.run(sql`UPDATE context_capsule SET capsule_json = ${JSON.stringify(body)} WHERE id = ${capsuleID}`))
}

const mutateCapsuleCreatedBy = async (
  db: Harness["db"],
  capsuleID: string,
  mutate: (createdBy: { userId: string; instanceId: string; operationId?: string }) => void,
) => {
  const row = await run(db.get<{ created_by_json: string }>(sql`SELECT created_by_json FROM context_capsule WHERE id = ${capsuleID}`))
  if (!row) return
  const createdBy = JSON.parse(row.created_by_json) as { userId: string; instanceId: string; operationId?: string }
  mutate(createdBy)
  await run(
    db.run(sql`UPDATE context_capsule SET created_by_json = ${JSON.stringify(createdBy)} WHERE id = ${capsuleID}`),
  )
}

const snapshotInput = (
  attachments: readonly SessionContextAttachmentInput[],
  overrides: Partial<Parameters<CtxPackMaterializer["snapshotForSessionInput"]>[0]> = {},
): Parameters<CtxPackMaterializer["snapshotForSessionInput"]>[0] => ({
  actor,
  targetInstanceID: "inst-1",
  targetFunctionalityID: "builtin:chat",
  attachments,
  budget: { ...DefaultInteractiveContextBudget, maximumBytes: 1_000_000, maximumEstimatedTokens: 1_000_000 },
  ...overrides,
})

const capsuleCount = (db: Harness["db"]) =>
  run(db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM context_capsule`))

// --- materialize ----------------------------------------------------------------

describe("CtxPack materializer — materialize", () => {
  test("happy path: capsule stored with the frozen shape; result returns ONLY the five fields", async () => {
    await withMaterialize({}, async ({ repository, capsuleStore, materializer }) => {
      const pack = await createPack(repository)
      const result = await materializePack(materializer, pack)

      // The result is exactly the frozen projection — no extra fields.
      expect(result).toEqual({
        contextCapsuleID: result.contextCapsuleID,
        sourceCtxPackID: pack.id,
        label: pack.title,
        contentHash: pack.contentHash,
        estimatedTokens: pack.estimatedTokens,
      })
      expect(result.contextCapsuleID.startsWith("ctxkpsl_")).toBe(true)

      const stored = await run(capsuleStore.get("ws-1", result.contextCapsuleID))
      expect(stored).toBeDefined()
      expect(stored!.version).toBe(1)
      expect(stored!.workspaceId).toBe("ws-1")
      expect(stored!.purpose).toBe("ctxpack-attachment")
      expect(stored!.createdBy).toEqual({ userId: "user-1", instanceId: "inst-1" })
      expect(stored!.audience).toEqual(["builtin:chat"])
      expect(stored!.summary).toBe(pack.title)
      expect(stored!.facts).toEqual([
        { key: "ctxpack.id", value: pack.id, sourceRef: { type: "ctxpack", id: pack.id }, sensitivity: pack.sensitivity },
        { key: "ctxpack.fragmentCount", value: 2, sourceRef: { type: "ctxpack", id: pack.id }, sensitivity: pack.sensitivity },
      ])
      // One ctxpack reference + one ctxpack.fragment reference per fragment.
      expect(stored!.references).toHaveLength(1 + pack.fragments.length)
      expect(stored!.references[0]).toEqual({
        kind: "ctxpack",
        ref: { type: "ctxpack", id: pack.id },
        label: pack.title,
        contentHash: pack.contentHash,
        sensitivity: pack.sensitivity,
      })
      expect(stored!.references.slice(1).map((entry) => (entry as { ref: { id: string } }).ref.id)).toEqual(
        pack.fragments.map((fragment) => fragment.id),
      )
      // Fragment labels fall back to `Fragment <ordinal + 1>` when unset.
      expect(stored!.references.slice(1).map((entry) => (entry as { label: string }).label)).toEqual([
        "Fragment 1",
        "Second label",
      ])
      expect(stored!.artifactRefs).toEqual([])
      expect(stored!.recentEvents).toEqual([])
      expect(stored!.budget).toEqual(DefaultInteractiveContextBudget)
      expect(stored!.contentHash).toBe(pack.contentHash)
      expect(stored!.expiresAt).toBeUndefined()
    })
  })

  test("expectedContentHash mismatch -> CtxPackContentChanged, no capsule stored", async () => {
    await withMaterialize({}, async ({ db, repository, materializer }) => {
      const pack = await createPack(repository)
      const result = await outcome(
        materializer.materialize(actor, materializeRequest(pack, { expectedContentHash: "sha256:stale" })),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackContentChanged", currentContentHash: pack.contentHash })
      expect(await capsuleCount(db)).toEqual({ count: 0 })
    })
  })

  test("deleted pack -> CtxPackDeleted", async () => {
    await withMaterialize({}, async ({ db, repository, materializer }) => {
      const pack = await createPack(repository)
      await run(repository.softDelete("ws-1", pack.id, 1))
      const result = await outcome(materializer.materialize(actor, materializeRequest(pack)))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackDeleted", ctxPackID: pack.id })
      expect(await capsuleCount(db)).toEqual({ count: 0 })
    })
  })

  test("pack-read and attach rights are BOTH checked (deny each, assert error)", async () => {
    // No pack read -> denied on ctxpack.materialize.
    await withMaterialize({ rights: () => ["write"] }, async ({ db, repository, materializer }) => {
      const pack = await createPack(repository)
      const result = await outcome(materializer.materialize(actor, materializeRequest(pack)))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackCapabilityDenied", operation: "ctxpack.materialize" })
      expect(await capsuleCount(db)).toEqual({ count: 0 })
    })

    // No attach write -> denied on chat.context.attach.
    await withMaterialize({ rights: () => ["read"] }, async ({ db, repository, materializer }) => {
      const pack = await createPack(repository)
      const result = await outcome(materializer.materialize(actor, materializeRequest(pack)))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackCapabilityDenied", operation: "chat.context.attach" })
      expect(await capsuleCount(db)).toEqual({ count: 0 })
    })
  })

  test("sentinel: fragment text appears ONLY in the stored capsule reference summary", async () => {
    await withMaterialize({}, async ({ repository, capsuleStore, materializer, entries }) => {
      const pack = await createPack(repository, {
        fragments: [{ clientFragmentID: "frag-secret", text: `Secret material ${SENTINEL} here.`, source: source() }],
      })
      const result = await materializePack(materializer, pack)

      // Never in the result projection.
      expect(JSON.stringify(result)).not.toContain(SENTINEL)
      // It lives only in the durable capsule reference summary.
      const stored = await run(capsuleStore.get("ws-1", result.contextCapsuleID))
      const fragmentRef = stored!.references.find(
        (entry) => (entry as { kind?: string }).kind === "ctxpack.fragment",
      ) as { summary: string }
      expect(fragmentRef.summary).toContain(SENTINEL)

      // Error paths carry hashes/ids only.
      const mismatch = await outcome(
        materializer.materialize(actor, materializeRequest(pack, { expectedContentHash: "sha256:wrong" })),
      )
      expect(mismatch.ok).toBe(false)
      if (!mismatch.ok) expect(JSON.stringify(mismatch.error)).not.toContain(SENTINEL)

      // Diagnostics carry bytes/counts only.
      expect(JSON.stringify(entries)).not.toContain(SENTINEL)
    })
  })

  test("snapshot rejects capsules that were written for a different workspace", async () => {
    await withMaterialize({}, async ({ repository, db, materializer }) => {
      const pack = await createPack(repository)
      const first = await materializePack(materializer, pack)
      await mutateCapsuleJson(db, first.contextCapsuleID, (capsule) => {
        capsule.workspaceId = "ws-other"
      })

      const result = await outcome(
        materializer.snapshotForSessionInput(snapshotInput([attachmentOf(pack, first)])),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackCapsuleTargetMismatch", target: "workspace" })
    })
  })

  test("snapshot rejects capsules written for a different purpose", async () => {
    await withMaterialize({}, async ({ repository, db, materializer }) => {
      const pack = await createPack(repository)
      const first = await materializePack(materializer, pack)
      await mutateCapsuleJson(db, first.contextCapsuleID, (capsule) => {
        capsule.purpose = "other-purpose"
      })

      const result = await outcome(
        materializer.snapshotForSessionInput(snapshotInput([attachmentOf(pack, first)])),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackCapsuleTargetMismatch", target: "purpose" })
    })
  })

  test("snapshot rejects capsules written for a different target instance", async () => {
    await withMaterialize({}, async ({ repository, db, materializer }) => {
      const pack = await createPack(repository)
      const first = await materializePack(materializer, pack)
      await mutateCapsuleCreatedBy(db, first.contextCapsuleID, (createdBy) => {
        createdBy.instanceId = "inst-other"
      })

      const result = await outcome(
        materializer.snapshotForSessionInput(snapshotInput([attachmentOf(pack, first)])),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackCapsuleTargetMismatch", target: "instance" })
    })
  })

  test("snapshot rejects capsules written for a different target functionality", async () => {
    await withMaterialize({}, async ({ repository, db, materializer }) => {
      const pack = await createPack(repository)
      const first = await materializePack(materializer, pack)
      await mutateCapsuleJson(db, first.contextCapsuleID, (capsule) => {
        capsule.audience = ["builtin:other"]
      })

      const result = await outcome(
        materializer.snapshotForSessionInput(snapshotInput([attachmentOf(pack, first)])),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackCapsuleTargetMismatch", target: "audience" })
    })
  })

  test("materialize does NOT change usage counters (recordUse never called)", async () => {
    const spyRecordUse = (repository: CtxPackRepository) => {
      const original = repository.recordUse
      let calls = 0
      return {
        repository: { ...repository, recordUse: ((...args: Parameters<CtxPackRepository["recordUse"]>) => {
          calls++
          return original(...args)
        }) as CtxPackRepository["recordUse"] },
        count: () => calls,
      }
    }

    await withMaterialize({}, async ({ repository, materializer }) => {
      const spy = spyRecordUse(repository)
      const pack = await createPack(spy.repository)
      await materializePack(materializer, pack)
      expect(spy.count()).toBe(0)

      const fresh = await run(spy.repository.get("ws-1", pack.id, false))
      expect(fresh.usage).toEqual({ attachedCount: 0, lastAttachedAt: null })
    })
  })
})

// --- snapshotForSessionInput -------------------------------------------------------

describe("CtxPack materializer — snapshotForSessionInput", () => {
  test("zero attachments -> empty v1 snapshot", async () => {
    await withMaterialize({}, async ({ materializer }) => {
      const snapshot = await run(
        materializer.snapshotForSessionInput(snapshotInput([], { budget: DefaultInteractiveContextBudget })),
      )
      expect(snapshot).toEqual({ version: 1, attachments: [], byteLength: 0, estimatedTokens: 0, createdAt: snapshot.createdAt })
      expect(snapshot.createdAt).toBeGreaterThan(0)
      expect(Object.isFrozen(snapshot)).toBe(true)
    })
  })

  test("duplicate capsule ids reject the whole snapshot", async () => {
    await withMaterialize({}, async ({ repository, materializer }) => {
      const pack = await createPack(repository)
      const first = await materializePack(materializer, pack)
      const attachment = attachmentOf(pack, first)
      const result = await outcome(
        materializer.snapshotForSessionInput(snapshotInput([attachment, attachment])),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toEqual({ _tag: "CtxPackSnapshotDuplicateCapsule", contextCapsuleID: first.contextCapsuleID })
      }
    })
  })

  test("capsule hash mismatch rejects the whole snapshot", async () => {
    await withMaterialize({}, async ({ repository, materializer }) => {
      const pack = await createPack(repository)
      const first = await materializePack(materializer, pack)
      const result = await outcome(
        materializer.snapshotForSessionInput(
          snapshotInput([{ ...attachmentOf(pack, first), contentHash: "sha256:stale" }]),
        ),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackContentChanged", currentContentHash: pack.contentHash })
    })
  })

  test("more than 8 attachments reject with too-many-attachments", async () => {
    await withMaterialize({}, async ({ materializer }) => {
      const attachments = Array.from({ length: 9 }, (_, index) => ({
        contextCapsuleID: `ctxkpsl_fake_${index}`,
        label: `fake-${index}`,
        contentHash: "sha256:h",
        source: { kind: "ctxpack" as const, ctxPackID: `ctxpk_fake_${index}` },
      }))
      const result = await outcome(materializer.snapshotForSessionInput(snapshotInput(attachments)))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackInvalidSelection", reason: "too-many-attachments" })
    })
  })

  test("missing capsule -> CtxPackCapsuleMissing", async () => {
    await withMaterialize({}, async ({ materializer }) => {
      const result = await outcome(
        materializer.snapshotForSessionInput(
          snapshotInput([{ contextCapsuleID: "ctxkpsl_nonexistent", label: "x", contentHash: "sha256:h", source: { kind: "ctxpack", ctxPackID: "ctxpk_x" } }]),
        ),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackCapsuleMissing" })
    })
  })

  test("expired capsule -> CtxPackCapsuleExpired", async () => {
    await withMaterialize({}, async ({ repository, capsuleStore, materializer }) => {
      const pack = await createPack(repository)
      const stored = await run(
        capsuleStore.store({
          id: "",
          version: 1,
          workspaceId: "ws-1",
          createdBy: { userId: "user-1", instanceId: "inst-1" },
          purpose: "ctxpack-attachment",
          audience: ["builtin:chat"],
          summary: "expired",
          facts: [],
          references: [],
          artifactRefs: [],
          recentEvents: [],
          budget: DefaultInteractiveContextBudget,
          contentHash: "sha256:expired",
          createdAt: Date.now() - 120_000,
          expiresAt: Date.now() - 60_000,
        } satisfies StoredCapsule),
      )
      const result = await outcome(
        materializer.snapshotForSessionInput(
          snapshotInput([{ contextCapsuleID: stored.id, label: "expired", contentHash: "sha256:expired", source: { kind: "ctxpack", ctxPackID: pack.id } }]),
        ),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatchObject({ _tag: "CtxPackCapsuleExpired" })
        if (result.error._tag === "CtxPackCapsuleExpired") expect(result.error.expiresAt).toBeLessThanOrEqual(Date.now())
      }
    })
  })

  test("deleted pack and missing fragment both reject the whole snapshot", async () => {
    await withMaterialize({}, async ({ repository, materializer }) => {
      const pack = await createPack(repository)
      const first = await materializePack(materializer, pack)

      // Deleted pack -> CtxPackDeleted.
      await run(repository.softDelete("ws-1", pack.id, 1))
      const deleted = await outcome(materializer.snapshotForSessionInput(snapshotInput([attachmentOf(pack, first)])))
      expect(deleted.ok).toBe(false)
      if (!deleted.ok) expect(deleted.error).toEqual({ _tag: "CtxPackDeleted", ctxPackID: pack.id })
    })
  })

  test("missing fragment reference rejects the whole snapshot", async () => {
    await withMaterialize({}, async ({ repository, capsuleStore, materializer }) => {
      const pack = await createPack(repository)
      // A capsule whose fragment reference points at a fragment that does not
      // exist in the CURRENT pack row.
      const stored = await run(
        capsuleStore.store({
          id: "",
          version: 1,
          workspaceId: "ws-1",
          createdBy: { userId: "user-1", instanceId: "inst-1" },
          purpose: "ctxpack-attachment",
          audience: ["builtin:chat"],
          summary: "stale refs",
          facts: [],
          references: [
            {
              kind: "ctxpack.fragment",
              ref: { type: "ctxpack-fragment", id: "ctxpkf_gone" },
              label: "gone",
              summary: "gone",
              contentHash: "sha256:gone",
              sensitivity: "workspace",
            },
          ],
          artifactRefs: [],
          recentEvents: [],
          budget: DefaultInteractiveContextBudget,
          contentHash: "sha256:match",
          createdAt: Date.now(),
          expiresAt: undefined,
        } satisfies StoredCapsule),
      )
      const result = await outcome(
        materializer.snapshotForSessionInput(
          snapshotInput([{ contextCapsuleID: stored.id, label: "stale", contentHash: "sha256:match", source: { kind: "ctxpack", ctxPackID: pack.id } }]),
        ),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackContentChanged", currentContentHash: pack.contentHash })
    })
  })

  test("over-budget rejects the whole snapshot (bytes and tokens)", async () => {
    await withMaterialize({}, async ({ repository, materializer }) => {
      const pack = await createPack(repository)
      const first = await materializePack(materializer, pack)

      const tinyBytes = await outcome(
        materializer.snapshotForSessionInput(
          snapshotInput([attachmentOf(pack, first)], { budget: { ...DefaultInteractiveContextBudget, maximumBytes: 8, maximumEstimatedTokens: 1_000_000 } }),
        ),
      )
      expect(tinyBytes.ok).toBe(false)
      if (!tinyBytes.ok) {
        expect(tinyBytes.error).toMatchObject({ _tag: "CtxPackSnapshotOverBudget" })
        if (tinyBytes.error._tag === "CtxPackSnapshotOverBudget") {
          expect(tinyBytes.error.maximum).toBe(8)
          expect(tinyBytes.error.current).toBeGreaterThan(8)
        }
      }

      const tinyTokens = await outcome(
        materializer.snapshotForSessionInput(
          snapshotInput([attachmentOf(pack, first)], { budget: { ...DefaultInteractiveContextBudget, maximumBytes: 1_000_000, maximumEstimatedTokens: 1 } }),
        ),
      )
      expect(tinyTokens.ok).toBe(false)
      if (!tinyTokens.ok) {
        expect(tinyTokens.error).toMatchObject({ _tag: "CtxPackSnapshotOverBudget" })
        if (tinyTokens.error._tag === "CtxPackSnapshotOverBudget") {
          expect(tinyTokens.error.maximum).toBe(1)
          expect(tinyTokens.error.current).toBeGreaterThan(1)
        }
      }
    })
  })

  test("one denied reference rejects ALL (no partial snapshot)", async () => {
    await withMaterialize({}, async ({ repository, materializer, entries }) => {
      const packA = await createPack(repository)
      const capA = await materializePack(materializer, packA)

      // packB is private and owned by someone else: readable only by its owner.
      const packB = await createPack(repository, { createdByUserID: "owner-1", sensitivity: "private", idempotencyKey: "create-b" })
      const capB = await run(
        materializer.materialize({ userID: "owner-1", workspaceID: "ws-1" }, materializeRequest(packB)),
      )

      const result = await outcome(
        materializer.snapshotForSessionInput(snapshotInput([attachmentOf(packA, capA), attachmentOf(packB, capB)])),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackCapabilityDenied", operation: "ctxpack.read" })
      // No partial snapshot: the failed call recorded nothing.
      expect(entries).toHaveLength(2) // only the two successful materialize calls
      const before = entries.length
      await outcome(materializer.snapshotForSessionInput(snapshotInput([attachmentOf(packA, capA), attachmentOf(packB, capB)])))
      expect(entries.length).toBe(before)
    })
  })

  test("order is preserved (attachments + fragment ordinals); no reusable grant fields", async () => {
    await withMaterialize({}, async ({ repository, materializer }) => {
      const packA = await createPack(repository, { idempotencyKey: "create-a" })
      const packB = await createPack(repository, { idempotencyKey: "create-b", fragments: [fragmentInput(0)] })
      const capA = await materializePack(materializer, packA)
      const capB = await materializePack(materializer, packB)

      // Deliberately reversed input order.
      const snapshot = await run(
        materializer.snapshotForSessionInput(snapshotInput([attachmentOf(packB, capB), attachmentOf(packA, capA)])),
      )
      expect(snapshot.version).toBe(1)
      expect(snapshot.attachments.map((attachment) => attachment.contextCapsuleID)).toEqual([
        capB.contextCapsuleID,
        capA.contextCapsuleID,
      ])
      expect(snapshot.attachments[0]!.sourceCtxPackID).toBe(packB.id)
      expect(snapshot.attachments[1]!.sourceCtxPackID).toBe(packA.id)
      expect(snapshot.attachments[0]!.fragments).toHaveLength(1)
      expect(snapshot.attachments[1]!.fragments.map((fragment) => fragment.text)).toEqual(
        packA.fragments.map((fragment) => fragment.text),
      )
      expect(snapshot.attachments[1]!.fragments.map((fragment) => fragment.contentHash)).toEqual(
        packA.fragments.map((fragment) => fragment.contentHash),
      )
      expect(snapshot.attachments[1]!.fragments.map((fragment) => fragment.source)).toEqual(
        packA.fragments.map((fragment) => fragment.source),
      )
      expect(snapshot.attachments[1]!.label).toBe(packA.title)
      expect(snapshot.attachments[1]!.contentHash).toBe(packA.contentHash)

      // byteLength/tokens come from JSON.stringify of the payload.
      const payload = { version: 1, attachments: snapshot.attachments, createdAt: snapshot.createdAt }
      const expectedBytes = new TextEncoder().encode(JSON.stringify(payload)).length
      expect(snapshot.byteLength).toBe(expectedBytes)
      expect(snapshot.estimatedTokens).toBe(Math.ceil(expectedBytes / 4))

      // The snapshot is exactly the frozen shape: no reusable grant fields.
      const expected: SessionContextSnapshot = {
        version: 1,
        attachments: snapshot.attachments,
        byteLength: snapshot.byteLength,
        estimatedTokens: snapshot.estimatedTokens,
        createdAt: snapshot.createdAt,
      }
      expect(snapshot).toEqual(expected)
    })
  })

  test("snapshot is deep-immutable: later pack deletion + row mutation cannot change it", async () => {
    await withMaterialize({}, async ({ repository, materializer, db }) => {
      const pack = await createPack(repository)
      const first = await materializePack(materializer, pack)
      const snapshot = await run(materializer.snapshotForSessionInput(snapshotInput([attachmentOf(pack, first)])))

      expect(Object.isFrozen(snapshot)).toBe(true)
      expect(Object.isFrozen(snapshot.attachments[0]!)).toBe(true)
      expect(Object.isFrozen(snapshot.attachments[0]!.fragments[0]!)).toBe(true)
      expect(Object.isFrozen(snapshot.attachments[0]!.fragments[0]!.source)).toBe(true)
      const before = JSON.stringify(snapshot)
      const originalText = snapshot.attachments[0]!.fragments[0]!.text

      // Delete the pack and mutate the underlying rows.
      await run(repository.softDelete("ws-1", pack.id, 1))
      await run(db.run(sql`UPDATE ctx_pack_fragment SET text_content = 'MUTATED_AFTER_SNAPSHOT' WHERE ctx_pack_id = ${pack.id}`))
      await run(db.run(sql`UPDATE ctx_pack SET title = 'mutated-title' WHERE id = ${pack.id}`))

      expect(JSON.stringify(snapshot)).toBe(before)
      expect(snapshot.attachments[0]!.fragments[0]!.text).toBe(originalText)
      expect(snapshot.attachments[0]!.fragments[0]!.text).not.toContain("MUTATED")
    })
  })

  test("diagnostics recorder receives bytes/counts only (sentinel absent)", async () => {
    await withMaterialize({}, async ({ repository, materializer, entries }) => {
      const pack = await createPack(repository, {
        fragments: [{ clientFragmentID: "frag-secret", text: `Snapshot secret ${SENTINEL} here.`, source: source() }],
      })
      const first = await materializePack(materializer, pack)
      await run(materializer.snapshotForSessionInput(snapshotInput([attachmentOf(pack, first)])))

      expect(entries.length).toBe(2) // one materialize + one snapshot
      for (const entry of entries) {
        expect(Object.keys(entry).sort()).toEqual(["attachmentCount", "byteLength", "estimatedTokens", "operation", "workspaceID"])
      }
      expect(JSON.stringify(entries)).not.toContain(SENTINEL)
      // The snapshot itself does carry fragment text (that is its purpose).
      const snapshot = await run(materializer.snapshotForSessionInput(snapshotInput([attachmentOf(pack, first)])))
      expect(JSON.stringify(snapshot)).toContain(SENTINEL)
    })
  })

  test("layer wiring: DiagnosticsService provided through the layer reaches the materializer", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.applyOnly(db, [ctxPackMigration, capsuleMigration])
        const entries: MaterializeDiagnosticsEntry[] = []
        const recorder: MaterializeDiagnostics = {
          record: (entry) =>
            Effect.sync(() => {
              entries.push(entry)
            }),
        }
        const service = yield* MaterializerService.pipe(
          Effect.provide(
            Layer.provide(
              Layer.provide(
                Layer.provide(
                  Layer.provide(
                    materializeLayer,
                    Layer.succeed(DiagnosticsService, recorder),
                  ),
                  Layer.succeed(CtxPackRepositoryService, makeRepository(db)),
                ),
                Layer.provide(capsuleLayer, Layer.succeed(Database.Service, { db })),
              ),
              Layer.provide(
                Layer.provide(
                  capabilityLayer,
                  Layer.succeed(WorkspaceMembershipService, { isMember: () => Effect.succeed(true) }),
                ),
                Layer.succeed(UserWorkspaceRightsService, { rightsFor: () => Effect.succeed(ALL) }),
              ),
            ),
          ),
        )
        const repository = makeRepository(db)
        const pack = yield* repository.create({
          workspaceID: "ws-1",
          createdByUserID: "user-1",
          title: "Layer pack",
          keywords: [],
          sensitivity: "workspace",
          fragments: [{ clientFragmentID: "frag-0", text: "Layer pack text.", source: source() }],
          idempotencyKey: "create-layer",
          now: 1787300020000,
        })
        const result = yield* service.materialize(actor, materializeRequest(pack))
        expect(result.contextCapsuleID.startsWith("ctxkpsl_")).toBe(true)
        expect(entries).toHaveLength(1)
        expect(entries[0]!.operation).toBe("materialize")
        expect(JSON.stringify(entries)).not.toContain(SENTINEL)
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
    )
  })
})
