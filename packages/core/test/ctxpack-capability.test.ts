import { describe, expect, test } from "bun:test"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Effect, Layer } from "effect"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import ctxPackMigration from "@opencode-ai/core/database/migration/20260821_ctxpack"
import ctxPackTagsMigration from "@opencode-ai/core/database/migration/20260910043029_ctxpack-tags"
import capsuleMigration from "@opencode-ai/core/database/migration/20260821_capsule"
import { make as makeRepository } from "@opencode-ai/core/ctxpack/sql"
import type { CtxPackRepository } from "@opencode-ai/core/ctxpack/sql"
import {
  denyRules,
  layer as capabilityLayer,
  Service as CapabilityService,
  UserWorkspaceRightsService,
  WorkspaceMembershipService,
} from "@opencode-ai/core/capability/service"
import type { Right } from "@opencode-ai/core/capability/subjects"
import { layer as capsuleLayer, Service as ContextCapsuleStoreService } from "@opencode-ai/core/context-broker/capsule"
import { make as makeMaterializer } from "@opencode-ai/core/ctxpack/materialize"
import type { CtxPackMaterializeRequest, CtxPackMaterializer } from "@opencode-ai/core/ctxpack/materialize"
import { requirePackOperation, requireWorkspaceOperation } from "@opencode-ai/core/ctxpack/access"

const ALL: Right[] = ["read", "write", "execute"]
const READ_ONLY: Right[] = ["read"]
const WRITE_ONLY: Right[] = ["write"]

const makeDb = EffectDrizzleSqlite.makeWithDefaults()

interface Harness {
  repository: CtxPackRepository
  capabilityLayer: Layer.Layer<CapabilityService>
  materializer: CtxPackMaterializer
}

// Real S1 repository rows + real X0 services; membership and rights are the
// only fakes.
const withHarness = <A>(
  options: { member: boolean; rights: (userID: string) => Right[] },
  f: (harness: Harness) => Promise<A>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* DatabaseMigration.applyOnly(db, [ctxPackMigration, ctxPackTagsMigration, capsuleMigration])
      const repository = makeRepository(db)
      const capsuleStore = yield* ContextCapsuleStoreService.pipe(
        Effect.provide(Layer.provide(capsuleLayer, Layer.succeed(Database.Service, { db }))),
      )
      const capabilityLayerWithFakes = Layer.provide(
        Layer.provide(
          capabilityLayer,
          Layer.succeed(WorkspaceMembershipService, { isMember: () => Effect.succeed(options.member) }),
        ),
        Layer.succeed(UserWorkspaceRightsService, {
          rightsFor: (userID: string) => Effect.succeed(options.rights(userID)),
        }),
      )
      const capability = yield* CapabilityService.pipe(Effect.provide(capabilityLayerWithFakes))
      const materializer = makeMaterializer({ repository, capability, capsuleStore })
      return yield* Effect.promise(() => f({ repository, capabilityLayer: capabilityLayerWithFakes, materializer }))
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

const runAccess = <A, E>(
  capabilityLayer: Layer.Layer<CapabilityService>,
  effect: Effect.Effect<A, E, CapabilityService>,
) => Effect.runPromise(Effect.provide(effect, capabilityLayer))

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

const createPack = (repository: CtxPackRepository, overrides: Partial<CtxPackRepository.Create> = {}) =>
  run(
    repository.create({
      workspaceID: "ws-1",
      createdByUserID: "user-1",
      title: "Pump findings",
      keywords: ["pump"],
      sensitivity: "workspace",
      fragments: [
        {
          clientFragmentID: "frag-0",
          text: "Fragment zero about the pump.",
          source: source(),
        },
      ],
      idempotencyKey: `create-${Math.random()}`,
      now: 1787300020000,
      ...overrides,
    }),
  )

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

describe("CtxPack capability wiring (access.ts + materializer)", () => {
  test("read-only user can list/get/materialize but not create/patch/remove (deny tags)", async () => {
    await withHarness({ member: true, rights: () => READ_ONLY }, async ({ repository, capabilityLayer }) => {
      const pack = await createPack(repository)

      await expect(
        runAccess(
          capabilityLayer,
          requirePackOperation({ userID: "user-1", workspaceID: "ws-1", operation: "ctxpack.read", pack }),
        ),
      ).resolves.toBeUndefined()
      await expect(
        runAccess(
          capabilityLayer,
          requirePackOperation({ userID: "user-1", workspaceID: "ws-1", operation: "ctxpack.materialize", pack }),
        ),
      ).resolves.toBeUndefined()
      // Workspace-scoped list gate reuses the read operation (v1 wiring).
      await expect(
        runAccess(
          capabilityLayer,
          requireWorkspaceOperation({ userID: "user-1", workspaceID: "ws-1", operation: "ctxpack.read" }),
        ),
      ).resolves.toBeUndefined()

      for (const operation of ["ctxpack.create", "ctxpack.patch", "ctxpack.remove"]) {
        const denied = await runAccess(
          capabilityLayer,
          requirePackOperation({ userID: "user-1", workspaceID: "ws-1", operation, pack }),
        ).then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        )
        expect(denied.ok, operation).toBe(false)
        if (!denied.ok) expect(denied.error).toEqual({ _tag: "CtxPackPermissionDenied", operation })
      }
    })
  })

  test("writer WITHOUT target-chat attach right cannot materialize (deny on chat.context.attach)", async () => {
    await withHarness({ member: true, rights: () => ["read", "write"] }, async ({ repository, materializer }) => {
      const pack = await createPack(repository)
      denyRules.push({ operation: "chat.context.attach", subjectType: "FunctionalityInstance" })
      try {
        const result = await outcome(
          materializer.materialize({ userID: "user-1", workspaceID: "ws-1" }, materializeRequest(pack)),
        )
        expect(result.ok).toBe(false)
        if (!result.ok)
          expect(result.error).toEqual({ _tag: "CtxPackCapabilityDenied", operation: "chat.context.attach" })
      } finally {
        denyRules.pop()
      }
    })
  })

  test("target-chat-write WITHOUT pack read cannot materialize", async () => {
    await withHarness({ member: true, rights: () => WRITE_ONLY }, async ({ repository, materializer }) => {
      const pack = await createPack(repository)
      const result = await outcome(
        materializer.materialize({ userID: "user-1", workspaceID: "ws-1" }, materializeRequest(pack)),
      )
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.error).toEqual({ _tag: "CtxPackCapabilityDenied", operation: "ctxpack.materialize" })
    })
  })

  test("cross-workspace pack denied before capability (actor.workspaceID mismatch)", async () => {
    await withHarness({ member: true, rights: () => ALL }, async ({ repository, materializer }) => {
      const pack = await createPack(repository)
      // Actor's workspace does not contain the pack: the repository lookup
      // fails before any capability check runs.
      const result = await outcome(
        materializer.materialize(
          { userID: "user-1", workspaceID: "ws-other" },
          materializeRequest(pack, { workspaceID: "ws-other" }),
        ),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackNotFound", ctxPackID: pack.id })
    })
  })

  test("private pack owned by another user -> materialize denied", async () => {
    await withHarness({ member: true, rights: () => ALL }, async ({ repository, materializer }) => {
      const pack = await createPack(repository, { createdByUserID: "owner-1", sensitivity: "private" })
      const result = await outcome(
        materializer.materialize({ userID: "user-2", workspaceID: "ws-1" }, materializeRequest(pack)),
      )
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.error).toEqual({ _tag: "CtxPackCapabilityDenied", operation: "ctxpack.materialize" })
    })
  })

  test("removed functionality (unknown functionalityID) still passes if the capability provider allows", async () => {
    await withHarness({ member: true, rights: () => ALL }, async ({ repository, materializer }) => {
      const pack = await createPack(repository)
      // The host check is capability-based only: v1 has no registry-gated
      // audience invalidation, so an unknown target functionality proceeds.
      const result = await outcome(
        materializer.materialize(
          { userID: "user-1", workspaceID: "ws-1" },
          materializeRequest(pack, { targetFunctionalityID: "func:removed" }),
        ),
      )
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.contextCapsuleID.startsWith("ctxkpsl_")).toBe(true)
    })
  })

  test("stale client rights projection cannot bypass host checks (request has no rights field)", async () => {
    await withHarness({ member: true, rights: () => READ_ONLY }, async ({ repository, materializer }) => {
      const pack = await createPack(repository)

      // Schema-level: the frozen request type carries no client-supplied
      // rights field — this object literal must not typecheck.
      const withRights: CtxPackMaterializeRequest = {
        workspaceID: "ws-1",
        ctxPackID: pack.id,
        expectedContentHash: pack.contentHash,
        targetInstanceID: "inst-1",
        targetFunctionalityID: "builtin:chat",
        // @ts-expect-error the frozen CtxPackMaterializeRequest has no rights field
        rights: ["write"],
      }

      // Runtime: even if a stale client smuggles a rights claim, the host
      // checks server-side rights only. The user has pack read but no attach
      // write, so the smuggled ["write"] must not help.
      const smuggled = { ...withRights } as CtxPackMaterializeRequest & { rights: string[] }
      const result = await outcome(materializer.materialize({ userID: "user-1", workspaceID: "ws-1" }, smuggled))
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.error).toEqual({ _tag: "CtxPackCapabilityDenied", operation: "chat.context.attach" })
    })
  })
})
