import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Fiber, Layer, Logger } from "effect"
import { and, eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionEvent } from "@opencode-ai/core/session/event"
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
import { renderContextSidecar } from "@opencode-ai/core/session/context-sidecar"
import { SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import type { SessionContextAttachmentInput, SessionContextSnapshot } from "@opencode-ai/schema/session-input"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { testEffect } from "./lib/effect"

// --- Fakes -------------------------------------------------------------------

const SENTINEL = "CTXPACK_SECRET_SENTINEL_7812"

let snapshotFailure: ({ readonly _tag: string } & Readonly<Record<string, unknown>>) | undefined = undefined

const usageRecords: Array<{
  workspaceID: string
  userID: string
  ctxPackIDs: ReadonlyArray<string>
  sessionInputID: SessionMessage.ID
  admittedAt: number
}> = []
let usageFailure: "none" | "typed" | "defect" | "interrupt" = "none"
let profileStale = false
let profileResolveCalls = 0
let profileRevalidateCalls = 0
let profileRevalidateEntered: Deferred.Deferred<void> | undefined
let profileRevalidateRelease: Deferred.Deferred<void> | undefined
const assemblyCalls: Array<{
  promptText: string
  mode: "v1-local-explicit" | "v1-clean-only" | "v2-enriched"
  attachments: ReadonlyArray<SessionContextAttachmentInput>
  actor?: { readonly userID: string; readonly workspaceID?: string }
  profile: SessionContextProfile.Profile
}> = []
let assemblyBarrier: Deferred.Deferred<void> | undefined
let readinessMode: SessionContextTransferReadiness.Mode = "v2-enriched"
let requestReadinessMode = (_mode: SessionContextTransferReadiness.Mode): Effect.Effect<void, never, never> =>
  Effect.die("readiness test controller is unavailable")
let resolvedProfile: SessionContextProfile.Profile = { kind: "generic" }

// Deterministic snapshot so queue vs steer and replay comparisons can be deep-equal.
const fakeSnapshot = (attachments: ReadonlyArray<SessionContextAttachmentInput>): SessionContextSnapshot => ({
  version: 1,
  attachments: attachments.map((attachment, index) => ({
    contextCapsuleID: attachment.contextCapsuleID,
    sourceCtxPackID: attachment.source.ctxPackID,
    label: attachment.label,
    contentHash: attachment.contentHash,
    fragments: [
      {
        text: `Fragment ${index} text for ${attachment.label} ${SENTINEL}`,
        source: {
          workspaceID: "wrk_test",
          blockID: `block_${index}`,
          functionalityID: "builtin:chat",
          kind: "note",
          direction: "unknown",
          sourceTimestamp: null,
          capturedAt: 1700000000000,
          entityRef: null,
          label: attachment.label,
          metadata: {},
          sensitivity: "workspace",
        },
        contentHash: `sha256:fragment_${index}`,
      },
    ],
  })),
  byteLength: 1234,
  estimatedTokens: 309,
  createdAt: 1700000000000,
})

const usagePort = Layer.succeed(
  SessionInput.CtxPackUsagePortService,
  SessionInput.CtxPackUsagePortService.of({
    recordAdmittedUse: (input): Effect.Effect<void, unknown> => {
      usageRecords.push({ ...input })
      if (usageFailure === "typed") return Effect.fail(new Error("usage recorder unavailable"))
      if (usageFailure === "defect") return Effect.die(new Error("usage recorder defect"))
      if (usageFailure === "interrupt") return Effect.interrupt
      return Effect.void
    },
  }),
)

const assemblyPort = Layer.succeed(
  SessionInput.SessionContextAssemblyPortService,
  SessionInput.SessionContextAssemblyPortService.of({
    assemble: (input) =>
      Effect.gen(function* () {
        assemblyCalls.push({
          promptText: input.promptText,
          mode: input.mode,
          attachments: input.explicitAttachments,
          actor: input.actor,
          profile: input.profile,
        })
        if (assemblyBarrier !== undefined) {
          if (assemblyCalls.length === 2) yield* Deferred.succeed(assemblyBarrier, undefined)
          yield* Deferred.await(assemblyBarrier)
        }
        if (snapshotFailure !== undefined)
          return yield* new SessionInput.ContextAttachmentError({ code: snapshotFailure._tag })
        if (input.mode === "v1-clean-only") {
          if (input.explicitAttachments.length > 0)
            return yield* new SessionInput.ContextAttachmentError({ code: "transfer-unavailable" })
          return {}
        }
        if (input.mode === "v1-local-explicit") {
          if (input.explicitAttachments.length === 0) return {}
          return { snapshot: fakeSnapshot(input.explicitAttachments) }
        }
        if (
          input.profile.kind === "operating-chat" &&
          (input.actor === undefined || input.actor.userID.length === 0) &&
          input.explicitAttachments.length > 0
        )
          return yield* new SessionInput.ContextAttachmentError({ code: "missing-actor" })
        if (input.profile.kind === "generic" && input.explicitAttachments.length === 0) return {}
        return {
          snapshot: yield* renderContextSidecar({
            promptText: input.promptText,
            attachments: input.explicitAttachments.map((item, index) => ({
              selection: "explicit" as const,
              contextCapsuleID: item.contextCapsuleID,
              sourceCtxPackID: item.source.ctxPackID,
              label: item.label,
              contentHash: item.contentHash,
              fragments: [{ contentHash: `fragment-${index}`, text: `Private ${index} ${SENTINEL}` }],
            })),
            recall:
              input.profile.kind === "operating-chat"
                ? {
                    policy: "operating-chat-v1" as const,
                    status:
                      input.actor === undefined || input.actor.userID.length === 0
                        ? ("unavailable" as const)
                        : ("no-match" as const),
                  }
                : { policy: "disabled" as const, status: "disabled" as const },
            budget: input.budget,
            createdAt: 1700000000000,
          }).pipe(
            Effect.mapError(() => new SessionInput.ContextAttachmentError({ code: "CtxPackSnapshotOverBudget" })),
          ),
        }
      }),
  }),
)

const profilePort = Layer.succeed(
  SessionContextProfile.Service,
  SessionContextProfile.Service.of({
    resolve: () =>
      Effect.sync(() => {
        profileResolveCalls++
        return resolvedProfile
      }),
    revalidate: (targetSessionID) =>
      Effect.gen(function* () {
        profileRevalidateCalls++
        if (profileRevalidateEntered !== undefined) yield* Deferred.succeed(profileRevalidateEntered, undefined)
        if (profileRevalidateRelease !== undefined) yield* Deferred.await(profileRevalidateRelease)
        if (profileStale) return yield* new SessionContextProfile.StaleError({ sessionID: targetSessionID })
      }),
  }),
)

const readinessPort = Layer.effect(
  SessionContextTransferReadiness.Service,
  Effect.gen(function* () {
    const released = yield* Deferred.make<void>()
    let active = 0
    requestReadinessMode = (mode) =>
      Effect.suspend(() =>
        (active === 0 ? Effect.void : Deferred.await(released)).pipe(
          Effect.andThen(
            Effect.sync(() => {
              readinessMode = mode
            }),
          ),
        ),
      )
    return SessionContextTransferReadiness.Service.of({
      withPermit: (_input, run) =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            active++
            return readinessMode
          }),
          run,
          () =>
            Effect.sync(() => {
              active--
              return active === 0
            }).pipe(Effect.flatMap((idle) => (idle ? Deferred.succeed(released, undefined) : Effect.void))),
        ),
    })
  }),
)

const wakeCalls: SessionV2.ID[] = []
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set<SessionV2.ID>()),
    resume: () => Effect.void,
    interrupt: () => Effect.void,
    wake: (sessionID) =>
      Effect.sync(() => {
        wakeCalls.push(sessionID)
      }),
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [SessionExecution.node, execution],
      [SessionInput.SessionContextAssemblyPort.node, assemblyPort],
      [SessionContextProfile.node, profilePort],
      [SessionContextTransferReadiness.node, readinessPort],
    ],
  ).pipe(Layer.provideMerge(usagePort)),
)

const sessionID = SessionV2.ID.make("ses_ctxpack_admission")
const workspaceID = WorkspaceV2.ID.make("wrk_test")
const operatingProfile: SessionContextProfile.Profile = {
  kind: "operating-chat",
  workspaceID,
  workspaceName: "Test workspace",
  blockID: "block-operating-chat",
  functionalityID: "builtin:operating-chat-session",
  functionalityInstanceID: "opchat:wrk_test:block-operating-chat",
  generation: 1,
  revision: 1,
  directory: "/project",
  operatingAgent: "test:model",
}
const snapshotWriteFailureTrigger = "opencode_block_ctxpack_snapshot_update"

const attachment = (contextCapsuleID: string, ctxPackID: string, label: string): SessionContextAttachmentInput => ({
  contextCapsuleID,
  label,
  contentHash: `sha256:${contextCapsuleID}`,
  source: { kind: "ctxpack", ctxPackID },
})

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  usageRecords.length = 0
  snapshotFailure = undefined
  usageFailure = "none"
  profileStale = false
  profileResolveCalls = 0
  profileRevalidateCalls = 0
  profileRevalidateEntered = undefined
  profileRevalidateRelease = undefined
  assemblyCalls.length = 0
  assemblyBarrier = undefined
  readinessMode = "v2-enriched"
  resolvedProfile = { kind: "generic" }
  yield* db.run(`DROP TRIGGER IF EXISTS ${snapshotWriteFailureTrigger}`).pipe(Effect.orDie)
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
      slug: "ctxpack-admission",
      directory: "/project",
      title: "ctxpack admission",
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

const admittedEventCount = () =>
  Database.Service.use(({ db }) =>
    db
      .select()
      .from(EventTable)
      .where(eq(EventTable.type, EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1)))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows.length),
      ),
  )

const admittedEventCountForSession = () =>
  Database.Service.use(({ db }) =>
    db
      .select()
      .from(EventTable)
      .where(
        and(
          eq(EventTable.aggregate_id, sessionID),
          eq(EventTable.type, EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1)),
        ),
      )
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows.length),
      ),
  )

const sessionInputExists = (id: SessionMessage.ID) =>
  Database.Service.use(({ db }) =>
    db
      .select({ id: SessionInputTable.id })
      .from(SessionInputTable)
      .where(eq(SessionInputTable.id, id))
      .get()
      .pipe(
        Effect.orDie,
        Effect.map((row) => row !== undefined),
      ),
  )

describe("SessionInput admission with context attachments", () => {
  it.effect("stores V2 privately while the public event exposes only its version marker", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const message = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Private V2 prompt" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_v2", "ctxpk_v2", "V2")],
        resume: false,
      })

      const row = yield* admittedRow(message.id)
      expect(row.context_snapshot_json).toMatchObject({ version: 2, apiContent: expect.stringContaining(SENTINEL) })
      const event = yield* Database.Service.use(({ db }) =>
        db.select().from(EventTable).where(eq(EventTable.aggregate_id, sessionID)).get().pipe(Effect.orDie),
      )
      expect(event?.data).toMatchObject({ modelContextVersion: 2 })
      expect(JSON.stringify(event?.data)).not.toContain(SENTINEL)
      expect(profileResolveCalls).toBe(1)
      expect(profileRevalidateCalls).toBe(1)
    }),
  )

  it.effect("uses the authoritative OperatingChat profile and emits clean V2 without an empty wrapper", () =>
    Effect.gen(function* () {
      yield* setup
      resolvedProfile = operatingProfile
      const session = yield* SessionV2.Service
      const message = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Operating chat question" }),
        userID: "user_1",
        resume: false,
      })
      expect((yield* admittedRow(message.id)).context_snapshot_json).toMatchObject({
        version: 2,
        apiContent: "Operating chat question",
        recall: { policy: "operating-chat-v1", status: "no-match" },
      })
      expect(assemblyCalls[0]?.profile).toEqual(operatingProfile)
      expect(assemblyCalls[0]?.actor).toEqual({ userID: "user_1", workspaceID })
    }),
  )

  it.effect("admits unavailable clean OperatingChat context but rejects explicit context without identity", () =>
    Effect.gen(function* () {
      yield* setup
      resolvedProfile = operatingProfile
      const session = yield* SessionV2.Service
      const clean = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Anonymous operating chat" }),
        resume: false,
      })
      expect((yield* admittedRow(clean.id)).context_snapshot_json).toMatchObject({
        version: 2,
        apiContent: "Anonymous operating chat",
        recall: { policy: "operating-chat-v1", status: "unavailable" },
      })

      const rejectedID = SessionMessage.ID.create()
      const rejected = yield* session
        .prompt({
          id: rejectedID,
          sessionID,
          prompt: Prompt.make({ text: "Anonymous explicit operating chat" }),
          contextAttachments: [attachment("capsule_anonymous", "ctxpk_anonymous", "Anonymous")],
          resume: false,
        })
        .pipe(Effect.flip)
      expect(rejected).toMatchObject({ _tag: "SessionInput.ContextAttachmentError", code: "missing-actor" })
      expect(yield* sessionInputExists(rejectedID)).toBeFalse()
    }),
  )

  it.effect("reconciles exact retries before profile resolution or assembly and conflicts on label changes", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const id = SessionMessage.ID.create()
      const base = {
        id,
        sessionID,
        prompt: Prompt.make({ text: "Retry identity" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_retry", "ctxpk_retry", "Original")],
        resume: false,
      }
      yield* session.prompt(base)
      yield* session.prompt(base)
      const failure = yield* session
        .prompt({ ...base, contextAttachments: [attachment("capsule_retry", "ctxpk_retry", "Changed")] })
        .pipe(Effect.flip)

      expect(failure._tag).toBe("Session.PromptConflictError")
      expect(assemblyCalls).toHaveLength(1)
      expect(profileResolveCalls).toBe(1)
      expect(profileRevalidateCalls).toBe(1)
      expect(usageRecords).toHaveLength(1)
    }),
  )

  it.effect("revalidates even a sidecar-free generic admission and rolls stale authority back atomically", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      profileStale = true
      const id = SessionMessage.ID.create()
      const failure = yield* session
        .prompt({ sessionID, id, prompt: Prompt.make({ text: "Stale generic" }), userID: "user_1", resume: false })
        .pipe(Effect.flip)

      expect(failure._tag).toBe("SessionInput.ContextAttachmentError")
      expect(yield* sessionInputExists(id)).toBeFalse()
      expect(yield* admittedEventCountForSession()).toBe(0)
      expect(profileResolveCalls).toBe(1)
      expect(profileRevalidateCalls).toBe(1)
    }),
  )

  it.effect("admits one input row with the context snapshot in the same admission", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      const message = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Use the attached docs" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_1", "ctxpk_1", "Docs")],
        resume: false,
      })

      const row = yield* admittedRow(message.id)
      expect(row.context_snapshot_json).toMatchObject({
        version: 2,
        attachments: [
          { contextCapsuleID: "capsule_1", sourceCtxPackID: "ctxpk_1", label: "Docs", contentHash: "sha256:capsule_1" },
        ],
      })
      expect(assemblyCalls).toHaveLength(1)
      expect(assemblyCalls[0]?.actor).toEqual({ userID: "user_1", workspaceID: "wrk_test" })
      expect(assemblyCalls[0]?.attachments).toEqual([attachment("capsule_1", "ctxpk_1", "Docs")])
      expect(yield* admittedEventCount()).toBe(1)
      expect(usageRecords).toHaveLength(1)
      expect(usageRecords[0]).toMatchObject({ workspaceID: "wrk_test", userID: "user_1", ctxPackIDs: ["ctxpk_1"] })
    }),
  )

  it.effect("never persists an input row without its context snapshot", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      yield* db
        .run(
          `CREATE TRIGGER ${snapshotWriteFailureTrigger} BEFORE UPDATE OF context_snapshot_json ON session_input
          BEGIN
            SELECT RAISE(ABORT, 'snapshot write blocked');
          END;`,
        )
        .pipe(Effect.orDie)
      try {
        const messageID = SessionMessage.ID.create()
        const result = yield* session
          .prompt({
            id: messageID,
            sessionID,
            prompt: Prompt.make({ text: "Attachment with blocked snapshot write" }),
            userID: "user_1",
            contextAttachments: [attachment("capsule_blocked", "ctxpk_blocked", "Blocked")],
            resume: false,
          })
          .pipe(Effect.exit)

        expect(result._tag).toBe("Failure")
        expect(yield* sessionInputExists(messageID)).toBeFalse()
        expect(yield* admittedEventCountForSession()).toBe(0)
      } finally {
        yield* db.run(`DROP TRIGGER IF EXISTS ${snapshotWriteFailureTrigger}`).pipe(Effect.orDie)
      }
    }),
  )

  it.effect("rejects the whole admission when context assembly fails", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      snapshotFailure = { _tag: "CtxPackSnapshotOverBudget", current: 999, maximum: 100 }

      const failure = yield* session
        .prompt({
          sessionID,
          prompt: Prompt.make({ text: "Too big" }),
          userID: "user_1",
          contextAttachments: [attachment("capsule_big", "ctxpk_big", "Big")],
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure._tag).toBe("SessionInput.ContextAttachmentError")
      expect((failure as SessionInput.ContextAttachmentError).code).toBe("CtxPackSnapshotOverBudget")
      expect(yield* admittedCount()).toBe(0)
      expect(yield* admittedEventCount()).toBe(0)
      expect(usageRecords).toHaveLength(0)
    }),
  )

  it.effect("preserves attachment order across two attachments", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      const message = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Two packs" }),
        userID: "user_1",
        contextAttachments: [
          attachment("capsule_first", "ctxpk_first", "First"),
          attachment("capsule_second", "ctxpk_second", "Second"),
        ],
        resume: false,
      })

      const row = yield* admittedRow(message.id)
      const stored = row.context_snapshot_json
      expect(stored).not.toBeNull()
      if (stored?.version !== 2 || "state" in stored) throw new Error("expected version-2 context snapshot")
      expect(
        stored.attachments.map((entry) => (entry.selection === "explicit" ? entry.contextCapsuleID : undefined)),
      ).toEqual(["capsule_first", "capsule_second"])
      expect(stored!.attachments.map((entry) => entry.sourceCtxPackID)).toEqual(["ctxpk_first", "ctxpk_second"])
      expect(assemblyCalls[0]?.attachments.map((entry) => entry.contextCapsuleID)).toEqual([
        "capsule_first",
        "capsule_second",
      ])
    }),
  )

  it.effect("stores null and behaves exactly as before without attachments", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      const message = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Plain prompt" }),
        userID: "user_1",
        resume: false,
      })

      const row = yield* admittedRow(message.id)
      expect(row.context_snapshot_json).toBeNull()
      expect(row.prompt).toMatchObject({ text: "Plain prompt" })
      expect(row.delivery).toBe("steer")
      expect(assemblyCalls).toHaveLength(1)
      expect(usageRecords).toHaveLength(0)
      expect(yield* admittedEventCount()).toBe(1)
    }),
  )

  it.effect("uses explicit managed-not-ready and local-only modes without creating a V2 marker", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      readinessMode = "v1-clean-only"
      const clean = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Managed clean prompt" }),
        userID: "user_1",
        resume: false,
      })
      expect((yield* admittedRow(clean.id)).context_snapshot_json).toBeNull()

      const rejectedID = SessionMessage.ID.create()
      const rejected = yield* session
        .prompt({
          id: rejectedID,
          sessionID,
          prompt: Prompt.make({ text: "Managed explicit prompt" }),
          userID: "user_1",
          contextAttachments: [attachment("capsule_managed", "ctxpk_managed", "Managed")],
          resume: false,
        })
        .pipe(Effect.flip)
      expect(rejected).toMatchObject({ _tag: "SessionInput.ContextAttachmentError", code: "transfer-unavailable" })
      expect(yield* sessionInputExists(rejectedID)).toBeFalse()

      readinessMode = "v1-local-explicit"
      const local = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Local explicit prompt" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_local", "ctxpk_local", "Local")],
        resume: false,
      })
      expect((yield* admittedRow(local.id)).context_snapshot_json).toMatchObject({
        version: 1,
        attachments: [{ contextCapsuleID: "capsule_local" }],
      })
      expect(assemblyCalls.map((call) => call.mode)).toEqual(["v1-clean-only", "v1-clean-only", "v1-local-explicit"])
    }),
  )

  it.effect("holds the readiness permit through revalidation and atomic sidecar commit", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      profileRevalidateEntered = yield* Deferred.make<void>()
      profileRevalidateRelease = yield* Deferred.make<void>()
      const first = yield* Effect.forkChild(
        session.prompt({
          sessionID,
          prompt: Prompt.make({ text: "Commit before revocation" }),
          userID: "user_1",
          contextAttachments: [attachment("capsule_permit", "ctxpk_permit", "Permit")],
          resume: false,
        }),
      )
      yield* Deferred.await(profileRevalidateEntered)
      const revokeAcknowledged = yield* Deferred.make<void>()
      const revoke = yield* Effect.forkChild(
        requestReadinessMode("v1-local-explicit").pipe(Effect.andThen(Deferred.succeed(revokeAcknowledged, undefined))),
      )
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(revokeAcknowledged)).toBeFalse()

      yield* Deferred.succeed(profileRevalidateRelease, undefined)
      const committed = yield* Fiber.join(first)
      yield* Deferred.await(revokeAcknowledged)
      yield* Fiber.join(revoke)
      expect((yield* admittedRow(committed.id)).context_snapshot_json).toMatchObject({ version: 2 })

      profileRevalidateEntered = undefined
      profileRevalidateRelease = undefined
      const afterRevoke = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Local after revocation" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_after_revoke", "ctxpk_after_revoke", "Local")],
        resume: false,
      })
      expect((yield* admittedRow(afterRevoke.id)).context_snapshot_json).toMatchObject({ version: 1 })
    }),
  )

  it.effect("stores canonical V2 snapshots for queue and steer", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const attachments = [attachment("capsule_q", "ctxpk_q", "Queued docs")]

      const steered = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Steer with docs" }),
        userID: "user_1",
        contextAttachments: attachments,
        resume: false,
      })
      const queued = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Queue with docs" }),
        userID: "user_1",
        delivery: "queue",
        contextAttachments: attachments,
        resume: false,
      })

      const steerRow = yield* admittedRow(steered.id)
      const queueRow = yield* admittedRow(queued.id)
      expect(steerRow.delivery).toBe("steer")
      expect(queueRow.delivery).toBe("queue")
      expect(queueRow.context_snapshot_json).not.toEqual(steerRow.context_snapshot_json)
      expect(assemblyCalls).toHaveLength(2)
    }),
  )

  it.effect("replays the same idempotency key without duplicating snapshot or usage", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const id = SessionMessage.ID.create()
      const input = {
        sessionID,
        id,
        prompt: Prompt.make({ text: "Idempotent with docs" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_replay", "ctxpk_replay", "Replay docs")],
        resume: false,
      }

      const first = yield* session.prompt(input)
      const retried = yield* session.prompt(input)

      expect(retried).toEqual(first)
      expect(yield* admittedCount()).toBe(1)
      expect(assemblyCalls).toHaveLength(1)
      expect(usageRecords).toHaveLength(1)
      const row = yield* admittedRow(id)
      expect(row.context_snapshot_json).toMatchObject({ attachments: [{ contextCapsuleID: "capsule_replay" }] })
    }),
  )

  it.effect("records usage only for the winner of concurrent equal and conflicting admissions", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const equalID = SessionMessage.ID.create()
      assemblyBarrier = yield* Deferred.make<void>()
      const equalInput = {
        id: equalID,
        sessionID,
        prompt: Prompt.make({ text: "Concurrent equal" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_equal", "ctxpk_equal", "Equal")],
        resume: false,
      }
      const equal = yield* Effect.all(
        [session.prompt(equalInput).pipe(Effect.exit), session.prompt(equalInput).pipe(Effect.exit)],
        { concurrency: "unbounded" },
      )
      expect(equal.map((exit) => exit._tag)).toEqual(["Success", "Success"])
      expect(assemblyCalls).toHaveLength(2)
      expect(usageRecords).toHaveLength(1)

      assemblyCalls.length = 0
      assemblyBarrier = yield* Deferred.make<void>()
      const conflictID = SessionMessage.ID.create()
      const conflict = yield* Effect.all(
        [
          session
            .prompt({
              ...equalInput,
              id: conflictID,
              prompt: Prompt.make({ text: "Concurrent conflict" }),
              contextAttachments: [attachment("capsule_first_race", "ctxpk_first_race", "First")],
            })
            .pipe(Effect.exit),
          session
            .prompt({
              ...equalInput,
              id: conflictID,
              prompt: Prompt.make({ text: "Concurrent conflict" }),
              contextAttachments: [attachment("capsule_second_race", "ctxpk_second_race", "Second")],
            })
            .pipe(Effect.exit),
        ],
        { concurrency: "unbounded" },
      )
      expect(conflict.filter((exit) => exit._tag === "Success")).toHaveLength(1)
      expect(conflict.filter((exit) => exit._tag === "Failure")).toHaveLength(1)
      expect(assemblyCalls).toHaveLength(2)
      expect(usageRecords).toHaveLength(2)
      expect((yield* admittedRow(conflictID)).context_snapshot_json).toMatchObject({ version: 2 })
    }),
  )

  it.effect("keeps committed admissions on usage failure or defect and preserves interruption", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      usageFailure = "typed"
      const typed = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Typed usage failure" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_usage_typed", "ctxpk_usage_typed", "Typed")],
        resume: false,
      })
      expect(yield* sessionInputExists(typed.id)).toBeTrue()

      usageFailure = "defect"
      const defect = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Usage defect" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_usage_defect", "ctxpk_usage_defect", "Defect")],
        resume: false,
      })
      expect(yield* sessionInputExists(defect.id)).toBeTrue()

      usageFailure = "interrupt"
      const interruptedID = SessionMessage.ID.create()
      const interrupted = yield* session
        .prompt({
          id: interruptedID,
          sessionID,
          prompt: Prompt.make({ text: "Usage interruption" }),
          userID: "user_1",
          contextAttachments: [attachment("capsule_usage_interrupt", "ctxpk_usage_interrupt", "Interrupt")],
          resume: false,
        })
        .pipe(Effect.exit)
      expect(interrupted._tag).toBe("Failure")
      if (interrupted._tag === "Failure") expect(Cause.hasInterrupts(interrupted.cause)).toBeTrue()
      expect(yield* sessionInputExists(interruptedID)).toBeTrue()
      expect(usageRecords).toHaveLength(3)
    }),
  )

  it.effect("never leaks fragment text into errors or logs", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const sentinel = "CTXPACK_SECRET_SENTINEL_7812"

      // Failure path: error objects carry stable codes only.
      snapshotFailure = { _tag: "CtxPackContentChanged", currentContentHash: "sha256:changed" }
      const failure = yield* session
        .prompt({
          sessionID,
          prompt: Prompt.make({ text: "Failure path" }),
          userID: "user_1",
          contextAttachments: [attachment("capsule_sentinel", "ctxpk_sentinel", "Sentinel")],
          resume: false,
        })
        .pipe(Effect.flip)
      expect(JSON.stringify(failure)).not.toContain(sentinel)
      snapshotFailure = undefined

      // Success path with a failing usage recorder: admission still commits and
      // the captured logs carry counts only.
      const recordedLogs: string[] = []
      const logger = Logger.make((options) => {
        recordedLogs.push(String(options.message))
      })
      usageFailure = "typed"
      const message = yield* session
        .prompt({
          sessionID,
          prompt: Prompt.make({ text: "Success path" }),
          userID: "user_1",
          contextAttachments: [
            {
              contextCapsuleID: "capsule_sentinel",
              label: "Sentinel",
              contentHash: "sha256:capsule_sentinel",
              source: { kind: "ctxpack", ctxPackID: "ctxpk_sentinel" },
            },
          ],
          resume: false,
        })
        .pipe(Effect.provide(Logger.layer([logger])))

      const logs = recordedLogs.join("\n")
      expect(logs).toContain("ctxpack admission usage recording failed")
      expect(logs).not.toContain(sentinel)
      expect(JSON.stringify(message)).not.toContain(sentinel)
      // The sentinel is durable by design — in the stored snapshot, never in
      // logs or protocol results.
      const row = yield* admittedRow(message.id)
      expect(JSON.stringify(row.context_snapshot_json)).toContain(sentinel)
      expect(usageRecords).toHaveLength(1)
    }),
  )

  it.effect("surfaces corrupt stored snapshots as a typed durable-data error", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const message = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Corrupt me" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_corrupt", "ctxpk_corrupt", "Corrupt")],
        resume: false,
      })
      const { db } = yield* Database.Service
      yield* db
        .update(SessionInputTable)
        .set({ context_snapshot_json: { version: 99 } as unknown as SessionContextSnapshot })
        .where(eq(SessionInputTable.id, message.id))
        .run()
        .pipe(Effect.orDie)

      const rows = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, message.id))
        .all()
        .pipe(Effect.orDie)
      const failure = yield* SessionInput.contextSnapshotsOf(db, rows).pipe(Effect.flip)
      expect(failure._tag).toBe("SessionInput.CorruptContextSnapshot")
      expect(failure.id).toBe(message.id)
    }),
  )
})
