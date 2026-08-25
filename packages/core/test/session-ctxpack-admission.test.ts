import { describe, expect, test } from "bun:test"
import { DateTime, Deferred, Effect, Fiber, Layer, Logger, Option } from "effect"
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
import { SessionContextSlot } from "@opencode-ai/core/session/context-slot"
import { SessionContextSidecar } from "@opencode-ai/core/session/context-sidecar"
import { SessionContextTransferReadiness } from "@opencode-ai/core/session/context-transfer-readiness"
import { SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import type { SessionContextAttachmentInput, SessionContextSnapshot, SessionContextSnapshotV1 } from "@opencode-ai/schema/session-input"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import { CtxPackSessionContext } from "@opencode-ai/core/ctxpack/index"
import type { CtxPackMaterializer } from "@opencode-ai/core/ctxpack/materialize"
import { DefaultInteractiveContextBudget } from "@opencode-ai/core/context-broker/capsule"
import { SessionContextProfile } from "@opencode-ai/core/session/context-profile"
import { testEffect } from "./lib/effect"
import { genericProfileReplacement, localOnlyReadinessReplacement } from "./fixture/session-context"

// --- Fakes -------------------------------------------------------------------

const SENTINEL = "CTXPACK_SECRET_SENTINEL_7812"

const portCalls: Array<{
  actor: { userID: string; workspaceID: string }
  targetInstanceID: string
  targetFunctionalityID: string
  attachments: ReadonlyArray<SessionContextAttachmentInput>
  budget: unknown
}> = []
let snapshotFailure: ({ readonly _tag: string } & Readonly<Record<string, unknown>>) | undefined = undefined

const usageRecords: Array<{
  workspaceID: string
  userID: string
  ctxPackIDs: ReadonlyArray<string>
  sessionInputID: SessionMessage.ID
  admittedAt: number
}> = []
let usageFailure = false

// Deterministic snapshot so queue vs steer and replay comparisons can be deep-equal.
const fakeSnapshot = (attachments: ReadonlyArray<SessionContextAttachmentInput>): SessionContextSnapshotV1 => ({
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

const assemblyPort = Layer.succeed(
  SessionInput.SessionContextAssemblyPortService,
  SessionInput.SessionContextAssemblyPortService.of({
    assemble: (input) =>
      Effect.gen(function* () {
        const target = input.profile.kind === "operating-chat"
          ? { instanceID: input.profile.functionalityInstanceID, functionalityID: input.profile.functionalityID }
          : { instanceID: `chat-instance:${input.sessionID}`, functionalityID: "builtin:chat" }
        portCalls.push({
          actor: input.actor as { userID: string; workspaceID: string },
          targetInstanceID: target.instanceID,
          targetFunctionalityID: target.functionalityID,
          attachments: input.explicitAttachments,
          budget: input.budget,
        })
        if (snapshotFailure !== undefined)
          return yield* new SessionInput.SessionContextAssemblyError({ code: snapshotFailure._tag })
        return {
          snapshot: input.explicitAttachments.length === 0 ? undefined : fakeSnapshot(input.explicitAttachments),
          usageCtxPackIDs: input.explicitAttachments.map((attachment) => attachment.source.ctxPackID),
        }
      }),
  }),
)

const usagePort = Layer.succeed(
  SessionInput.CtxPackUsagePortService,
  SessionInput.CtxPackUsagePortService.of({
    recordAdmittedUse: (input): Effect.Effect<void, unknown> => {
      usageRecords.push({ ...input })
      return usageFailure ? Effect.fail(new Error("usage recorder unavailable")) : Effect.void
    },
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
      genericProfileReplacement,
      localOnlyReadinessReplacement,
      [SessionInput.sessionContextAssemblyPortNode, assemblyPort],
    ],
  ).pipe(Layer.provideMerge(usagePort)),
)

let readySnapshotTampered = false
const readyAssembly = Layer.succeed(
  SessionInput.SessionContextAssemblyPortService,
  SessionInput.SessionContextAssemblyPortService.of({
    assemble: (input) => {
      const v1 = fakeSnapshot(input.explicitAttachments)
      return SessionContextSidecar.render({
        cleanText: input.promptText,
        explicitAttachments: v1.attachments.map((item) => ({ selection: "explicit" as const, ...item })),
        automaticAttachments: [],
        recall: { policy: "disabled", status: "disabled" },
        budget: input.budget,
        createdAt: 1_700_000_000_000,
      }).pipe(
        Effect.map((snapshot) => ({
          snapshot:
            input.explicitAttachments.length === 0
              ? undefined
              : readySnapshotTampered
                ? { ...snapshot, apiContentHash: "sha256:tampered" }
                : snapshot,
          usageCtxPackIDs: snapshot.attachments.map((item) => item.sourceCtxPackID),
        })),
        Effect.mapError(() => new SessionInput.SessionContextAssemblyError({ code: "CtxPackSnapshotOverBudget" })),
      )
    },
  }),
)
let readyMode: SessionContextTransferReadiness.Mode = "v2-enriched"
const readyReadiness = Layer.succeed(
  SessionContextTransferReadiness.Service,
  SessionContextTransferReadiness.Service.of({ acquire: () => Effect.succeed(readyMode) }),
)
const itReady = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [SessionExecution.node, execution],
      genericProfileReplacement,
      [SessionContextTransferReadiness.node, readyReadiness],
      [SessionInput.sessionContextAssemblyPortNode, readyAssembly],
    ],
  ).pipe(Layer.provideMerge(usagePort)),
)

const managedModes: SessionContextTransferReadiness.Mode[] = []
const managedAssembly = Layer.succeed(
  SessionInput.SessionContextAssemblyPortService,
  SessionInput.SessionContextAssemblyPortService.of({
    assemble: (input) => {
      managedModes.push(input.mode)
      if (input.mode !== "v1-clean-only")
        return Effect.fail(new SessionInput.SessionContextAssemblyError({ code: "unexpected-mode" }))
      if (input.explicitAttachments.length > 0)
        return Effect.fail(new SessionInput.SessionContextAssemblyError({ code: "transfer-unavailable" }))
      return Effect.succeed({ usageCtxPackIDs: [] })
    },
  }),
)
const itManaged = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [SessionExecution.node, execution],
      genericProfileReplacement,
      [SessionContextTransferReadiness.node, SessionContextTransferReadiness.managedNotReadyNode],
      [SessionInput.sessionContextAssemblyPortNode, managedAssembly],
    ],
  ),
)

let staleProfile = false
let profileResolveCalls = 0
let profileRevalidateCalls = 0
const guardedProfile = Layer.succeed(
  SessionContextProfile.Service,
  SessionContextProfile.Service.of({
    resolve: () =>
      Effect.sync(() => {
        profileResolveCalls++
        return { kind: "generic" as const }
      }),
    revalidate: (id) =>
      Effect.gen(function* () {
        profileRevalidateCalls++
        if (staleProfile) return yield* new SessionContextProfile.StaleError({ sessionID: id })
      }),
  }),
)
const itGuarded = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [SessionExecution.node, execution],
      [SessionContextProfile.node, guardedProfile],
      [SessionContextTransferReadiness.node, readyReadiness],
      [SessionInput.sessionContextAssemblyPortNode, readyAssembly],
    ],
  ).pipe(Layer.provideMerge(usagePort)),
)

let permitAssemblyReached: Deferred.Deferred<void> | undefined
let permitCommitAllowed: Deferred.Deferred<void> | undefined
let permitReleased: Deferred.Deferred<void> | undefined
let permitRevoked = false
let permitBlockCommit = false
const permitReadiness = Layer.succeed(
  SessionContextTransferReadiness.Service,
  SessionContextTransferReadiness.Service.of({
    acquire: () => {
      if (permitRevoked) return Effect.succeed("v1-local-explicit")
      return Effect.acquireRelease(
        Effect.succeed("v2-enriched" as const),
        () => permitReleased ? Deferred.succeed(permitReleased, undefined).pipe(Effect.asVoid) : Effect.void,
      )
    },
  }),
)
const permitAssembly = Layer.succeed(
  SessionInput.SessionContextAssemblyPortService,
  SessionInput.SessionContextAssemblyPortService.of({
    assemble: (input) =>
      Effect.gen(function* () {
        if (permitAssemblyReached) yield* Deferred.succeed(permitAssemblyReached, undefined)
        const v1 = fakeSnapshot(input.explicitAttachments)
        if (input.mode === "v1-local-explicit")
          return { snapshot: v1, usageCtxPackIDs: v1.attachments.map((item) => item.sourceCtxPackID) }
        const snapshot = yield* SessionContextSidecar.render({
          cleanText: input.promptText,
          explicitAttachments: v1.attachments.map((item) => ({ selection: "explicit" as const, ...item })),
          automaticAttachments: [],
          recall: { policy: "disabled", status: "disabled" },
          budget: input.budget,
          createdAt: 1_700_000_000_000,
        }).pipe(
          Effect.mapError(() => new SessionInput.SessionContextAssemblyError({ code: "CtxPackSnapshotOverBudget" })),
        )
        return { snapshot, usageCtxPackIDs: snapshot.attachments.map((item) => item.sourceCtxPackID) }
      }),
  }),
)
const permitProfile = Layer.succeed(
  SessionContextProfile.Service,
  SessionContextProfile.Service.of({
    resolve: () => Effect.succeed({ kind: "generic" }),
    revalidate: () =>
      permitBlockCommit && permitCommitAllowed ? Deferred.await(permitCommitAllowed) : Effect.void,
  }),
)
const itPermit = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [SessionExecution.node, execution],
      [SessionContextProfile.node, permitProfile],
      [SessionContextTransferReadiness.node, permitReadiness],
      [SessionInput.sessionContextAssemblyPortNode, permitAssembly],
    ],
  ).pipe(Layer.provideMerge(usagePort)),
)

const sessionID = SessionV2.ID.make("ses_ctxpack_admission")
const workspaceID = WorkspaceV2.ID.make("wrk_test")
const snapshotWriteFailureTrigger = "opencode_block_ctxpack_snapshot_update"

const attachment = (contextCapsuleID: string, ctxPackID: string, label: string): SessionContextAttachmentInput => ({
  contextCapsuleID,
  label,
  contentHash: `sha256:${contextCapsuleID}`,
  source: { kind: "ctxpack", ctxPackID },
})

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  portCalls.length = 0
  usageRecords.length = 0
  snapshotFailure = undefined
  readySnapshotTampered = false
  readyMode = "v2-enriched"
  usageFailure = false
  managedModes.length = 0
  staleProfile = false
  profileResolveCalls = 0
  profileRevalidateCalls = 0
  permitAssemblyReached = undefined
  permitCommitAllowed = undefined
  permitReleased = undefined
  permitRevoked = false
  permitBlockCommit = false
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
        Effect.flatMap((row) => (row === undefined ? Effect.die(`missing session input row: ${id}`) : Effect.succeed(row))),
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
      .where(and(eq(EventTable.aggregate_id, sessionID), eq(EventTable.type, EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1))))
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
        version: 1,
        attachments: [
          { contextCapsuleID: "capsule_1", sourceCtxPackID: "ctxpk_1", label: "Docs", contentHash: "sha256:capsule_1" },
        ],
        byteLength: 1234,
        estimatedTokens: 309,
      })
      expect(portCalls).toHaveLength(1)
      expect(portCalls[0]?.actor).toEqual({ userID: "user_1", workspaceID: "wrk_test" })
      expect(portCalls[0]?.targetInstanceID).toBe(`chat-instance:${sessionID}`)
      expect(portCalls[0]?.targetFunctionalityID).toBe("builtin:chat")
      expect(portCalls[0]?.attachments).toEqual([attachment("capsule_1", "ctxpk_1", "Docs")])
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

  it.effect("rejects the whole admission when the snapshot port fails", () =>
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
      if (!stored || "state" in stored) throw new Error("expected a complete context snapshot")
      expect(stored!.attachments.map((entry) => entry.contextCapsuleID)).toEqual(["capsule_first", "capsule_second"])
      expect(stored!.attachments.map((entry) => entry.sourceCtxPackID)).toEqual(["ctxpk_first", "ctxpk_second"])
      expect(portCalls[0]?.attachments.map((entry) => entry.contextCapsuleID)).toEqual([
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
      expect(portCalls).toHaveLength(1)
      expect(portCalls[0]?.attachments).toEqual([])
      expect(usageRecords).toHaveLength(0)
      expect(yield* admittedEventCount()).toBe(1)
    }),
  )

  it.effect("stores identical snapshot shapes for queue and steer", () =>
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
      expect(queueRow.context_snapshot_json).toEqual(steerRow.context_snapshot_json)
      expect(portCalls).toHaveLength(2)
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
      expect(portCalls).toHaveLength(1)
      expect(usageRecords).toHaveLength(1)
      const row = yield* admittedRow(id)
      expect(row.context_snapshot_json).toMatchObject({ attachments: [{ contextCapsuleID: "capsule_replay" }] })
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
      usageFailure = true
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

      const rows = yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, message.id)).all().pipe(Effect.orDie)
      const failure = yield* SessionInput.contextSnapshotsOf(db, rows).pipe(Effect.flip)
      expect(failure._tag).toBe("SessionInput.CorruptContextSnapshot")
      expect(failure.id).toBe(message.id)
    }),
  )

  itReady.effect("rejects a noncanonical V2 sidecar returned by the assembly port", () =>
    Effect.gen(function* () {
      yield* setup
      readySnapshotTampered = true
      const session = yield* SessionV2.Service
      const id = SessionMessage.ID.create()
      const failure = yield* session
        .prompt({
          id,
          sessionID,
          prompt: Prompt.make({ text: "Reject tampered assembly" }),
          userID: "user_1",
          contextAttachments: [attachment("capsule_tampered", "ctxpk_tampered", "Tampered")],
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "SessionInput.ContextAttachmentError", code: "invalid-snapshot" })
      expect(yield* sessionInputExists(id)).toBeFalse()
      expect(yield* admittedEventCountForSession()).toBe(0)
      expect(usageRecords).toHaveLength(0)
    }),
  )

  itReady.effect("rejects a V2 sidecar when readiness selected a V1 mode", () =>
    Effect.gen(function* () {
      yield* setup
      readyMode = "v1-local-explicit"
      const session = yield* SessionV2.Service
      const id = SessionMessage.ID.create()
      const failure = yield* session
        .prompt({
          id,
          sessionID,
          prompt: Prompt.make({ text: "Readiness must gate V2" }),
          userID: "user_1",
          contextAttachments: [attachment("capsule_mode", "ctxpk_mode", "Mode")],
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "SessionInput.ContextAttachmentError", code: "invalid-snapshot" })
      expect(yield* sessionInputExists(id)).toBeFalse()
      expect(yield* admittedEventCountForSession()).toBe(0)
    }),
  )

  itReady.effect("stores generic explicit context as V2 with only the public version marker", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const message = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Generic V2 context" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_v2", "ctxpk_v2", "V2 docs")],
        resume: false,
      })

      expect((yield* admittedRow(message.id)).context_snapshot_json).toMatchObject({ version: 2 })
      const { db } = yield* Database.Service
      const event = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .all()
        .pipe(Effect.orDie, Effect.map((events) => events.find((item) => item.type === EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1))))
      expect(event?.data).toMatchObject({ modelContextVersion: 2 })
      expect(JSON.stringify(event?.data)).not.toContain("ctxpk_v2")
      expect(JSON.stringify(event?.data)).not.toContain("apiContent")
    }),
  )

  it.effect("conflicts when the same message ID changes only the explicit label", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const id = SessionMessage.ID.create()
      yield* session.prompt({
        id,
        sessionID,
        prompt: Prompt.make({ text: "Stable text" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_label", "ctxpk_label", "First label")],
        resume: false,
      })
      const failure = yield* session
        .prompt({
          id,
          sessionID,
          prompt: Prompt.make({ text: "Stable text" }),
          userID: "user_1",
          contextAttachments: [attachment("capsule_label", "ctxpk_label", "Changed label")],
          resume: false,
        })
        .pipe(Effect.flip)
      expect(failure._tag).toBe("Session.PromptConflictError")
      expect(portCalls).toHaveLength(1)
      expect(usageRecords).toHaveLength(1)
    }),
  )

  it.effect("conflicts when the same message ID changes explicit capsule, pack, or content identity", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const id = SessionMessage.ID.create()
      yield* session.prompt({
        id,
        sessionID,
        prompt: Prompt.make({ text: "Stable explicit identity" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_identity", "ctxpk_identity", "Identity")],
        resume: false,
      })
      const changed = {
        ...attachment("capsule_changed", "ctxpk_changed", "Identity"),
        contentHash: "sha256:changed-content",
      }
      const failure = yield* session
        .prompt({
          id,
          sessionID,
          prompt: Prompt.make({ text: "Stable explicit identity" }),
          userID: "user_1",
          contextAttachments: [changed],
          resume: false,
        })
        .pipe(Effect.flip)
      expect(failure._tag).toBe("Session.PromptConflictError")
    }),
  )

  it.effect("admits one concurrent winner and records usage once", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const id = SessionMessage.ID.create()
      const base = {
        id,
        sessionID,
        prompt: Prompt.make({ text: "Concurrent context" }),
        userID: "user_1",
        resume: false,
      } as const
      const exits = yield* Effect.all(
        [
          session.prompt({ ...base, contextAttachments: [attachment("capsule_win", "ctxpk_win", "Winner A")] }).pipe(Effect.exit),
          session.prompt({ ...base, contextAttachments: [attachment("capsule_win", "ctxpk_win", "Winner B")] }).pipe(Effect.exit),
        ],
        { concurrency: "unbounded" },
      )

      expect(exits.filter((exit) => exit._tag === "Success")).toHaveLength(1)
      expect(exits.filter((exit) => exit._tag === "Failure")).toHaveLength(1)
      expect(yield* admittedCount()).toBe(1)
      expect(usageRecords).toHaveLength(1)
    }),
  )

  it.effect("coalesces concurrent equal retries and records usage once", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        id: SessionMessage.ID.create(),
        sessionID,
        prompt: Prompt.make({ text: "Concurrent equal context" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_equal", "ctxpk_equal", "Equal")],
        resume: false,
      } as const
      const results = yield* Effect.all([session.prompt(input), session.prompt(input)], { concurrency: "unbounded" })
      expect(results[0]).toEqual(results[1])
      expect(yield* admittedCount()).toBe(1)
      expect(usageRecords).toHaveLength(1)
    }),
  )

  itReady.effect("fails exact retry and strict reads when a V2 marker is still pending", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        id: SessionMessage.ID.create(),
        sessionID,
        prompt: Prompt.make({ text: "Pending private context" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_pending", "ctxpk_pending", "Pending")],
        resume: false,
      } as const
      yield* session.prompt(input)
      const { db } = yield* Database.Service
      yield* db
        .update(SessionInputTable)
        .set({ context_snapshot_json: { state: "pending", version: 2 } })
        .where(eq(SessionInputTable.id, input.id))
        .run()
        .pipe(Effect.orDie)

      const retry = yield* session.prompt(input).pipe(Effect.flip)
      expect(retry).toMatchObject({ _tag: "SessionInput.MissingPrivateContext", id: input.id })
      const rows = yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, input.id)).all().pipe(Effect.orDie)
      const read = yield* SessionInput.contextSnapshotsOf(db, rows).pipe(Effect.flip)
      expect(read).toMatchObject({ _tag: "SessionInput.MissingPrivateContext", id: input.id })
    }),
  )

  itManaged.effect("keeps managed-not-ready clean prompts sidecar-free and rejects explicit transfer", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const clean = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Managed clean prompt" }),
        userID: "user_1",
        resume: false,
      })
      expect((yield* admittedRow(clean.id)).context_snapshot_json).toBeNull()

      const explicitID = SessionMessage.ID.create()
      const failure = yield* session
        .prompt({
          id: explicitID,
          sessionID,
          prompt: Prompt.make({ text: "Managed explicit prompt" }),
          userID: "user_1",
          contextAttachments: [attachment("capsule_managed", "ctxpk_managed", "Managed")],
          resume: false,
        })
        .pipe(Effect.flip)
      expect(failure).toMatchObject({ _tag: "SessionInput.ContextAttachmentError", code: "transfer-unavailable" })
      expect(yield* sessionInputExists(explicitID)).toBeFalse()
      expect(managedModes).toEqual(["v1-clean-only", "v1-clean-only"])
    }),
  )

  itPermit.effect("holds readiness through atomic commit and selects V1 after revocation", () =>
    Effect.gen(function* () {
      yield* setup
      permitAssemblyReached = yield* Deferred.make<void>()
      permitCommitAllowed = yield* Deferred.make<void>()
      permitReleased = yield* Deferred.make<void>()
      permitBlockCommit = true
      const session = yield* SessionV2.Service
      const firstID = SessionMessage.ID.create()
      const first = yield* session
        .prompt({
          id: firstID,
          sessionID,
          prompt: Prompt.make({ text: "Commit while permit is held" }),
          userID: "user_1",
          contextAttachments: [attachment("capsule_permit", "ctxpk_permit", "Permit")],
          resume: false,
        })
        .pipe(Effect.forkChild)

      yield* Deferred.await(permitAssemblyReached)
      permitRevoked = true
      expect(Option.isNone(yield* Deferred.poll(permitReleased))).toBeTrue()
      yield* Deferred.succeed(permitCommitAllowed, undefined)
      yield* Fiber.join(first)
      expect(Option.isSome(yield* Deferred.poll(permitReleased))).toBeTrue()
      expect((yield* admittedRow(firstID)).context_snapshot_json).toMatchObject({ version: 2 })

      permitBlockCommit = false
      const second = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Use V1 after revocation" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_after_revoke", "ctxpk_after_revoke", "After revoke")],
        resume: false,
      })
      expect((yield* admittedRow(second.id)).context_snapshot_json).toMatchObject({ version: 1 })
    }),
  )

  itGuarded.effect("returns an exact V2 retry before profile resolution or assembly", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        id: SessionMessage.ID.create(),
        sessionID,
        prompt: Prompt.make({ text: "Retry before profile" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_profile", "ctxpk_profile", "Profile")],
        resume: false,
      } as const
      const first = yield* session.prompt(input)
      staleProfile = true
      const retried = yield* session.prompt(input)

      expect(retried).toEqual(first)
      expect(profileResolveCalls).toBe(1)
      expect(profileRevalidateCalls).toBe(1)
      expect(usageRecords).toHaveLength(1)
    }),
  )

  itGuarded.effect("rolls back a stale profile without retaining the pending slot or usage", () =>
    Effect.gen(function* () {
      yield* setup
      staleProfile = true
      const session = yield* SessionV2.Service
      const id = SessionMessage.ID.create()
      const failure = yield* session
        .prompt({
          id,
          sessionID,
          prompt: Prompt.make({ text: "Stale at commit" }),
          userID: "user_1",
          contextAttachments: [attachment("capsule_stale", "ctxpk_stale", "Stale")],
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "SessionInput.ContextAttachmentError",
        code: "SessionContextProfile.StaleError",
      })
      expect(yield* sessionInputExists(id)).toBeFalse()
      expect(yield* admittedEventCountForSession()).toBe(0)
      expect(usageRecords).toHaveLength(0)
    }),
  )

  itReady.effect("projects a replayed V2 event to pending when no private commit hook exists", () =>
    Effect.gen(function* () {
      yield* setup
      const events = yield* EventV2.Service
      const session = yield* SessionV2.Service
      const id = SessionMessage.ID.create()
      const prompt = Prompt.make({ text: "Replay without private sidecar" })
      yield* events.publish(SessionEvent.PromptAdmitted, {
        messageID: id,
        sessionID,
        timestamp: DateTime.makeUnsafe(1_700_000_000_000),
        prompt,
        delivery: "steer",
        modelContextVersion: 2,
      })

      expect((yield* admittedRow(id)).context_snapshot_json).toEqual({ state: "pending", version: 2 })
      const retry = yield* session.prompt({ id, sessionID, prompt, resume: false }).pipe(Effect.flip)
      expect(retry).toMatchObject({ _tag: "SessionInput.MissingPrivateContext", id })
    }),
  )
})

describe("Session context SQL slot", () => {
  test("decodes complete V1/V2 and the exact private pending marker", () => {
    expect(SessionContextSlot.decodeStored(fakeSnapshot([]))).toMatchObject({ version: 1 })
    expect(SessionContextSlot.decodeStored({ state: "pending", version: 2 })).toEqual({ state: "pending", version: 2 })
    expect(() => SessionContextSlot.decodePublic({ state: "pending", version: 2 })).toThrow()
  })

  test("turns pending into the typed missing-private-context error", () => {
    const exit = Effect.runSyncExit(
      SessionContextSlot.requireComplete(SessionMessage.ID.make("msg_pending"), { state: "pending", version: 2 }, "Prompt"),
    )
    expect(exit._tag).toBe("Failure")
    expect(String(exit)).toContain("SessionInput.MissingPrivateContext")
  })
})

describe("CtxPack Session context assembly", () => {
  const assemblyCalls = { materialize: 0, search: 0, snapshots: [] as string[] }
  const profile: SessionContextProfile.Profile = {
    kind: "operating-chat",
    workspaceID: "wrk_test",
    workspaceName: "Test",
    blockID: "block_chat",
    functionalityID: "builtin:operating-chat-session",
    functionalityInstanceID: "fninst_chat",
    generation: 1,
    revision: 2,
    location: "/project",
    directory: "/project",
    operatingAgent: "openai:test",
  }
  const explicitAttachment = attachment("capsule_explicit", "ctxpk_explicit", "Explicit")
  const materializer = {
    materialize: () => Effect.die("unused"),
    snapshotForSessionInput: (input: Parameters<CtxPackMaterializer["snapshotForSessionInput"]>[0]) =>
      Effect.sync(() => {
        assemblyCalls.materialize++
        return fakeSnapshot(input.attachments)
      }),
  } as unknown as CtxPackMaterializer
  const service = CtxPackSessionContext.make({
    materializer,
    recall: {
      terms: (text) => [text],
      trivial: (text) => text === "thanks",
      search: () =>
        Effect.sync(() => {
          assemblyCalls.search++
          return ["ctxpk_explicit", "ctxpk_a", "ctxpk_denied", "ctxpk_b", "ctxpk_c", "ctxpk_d", "ctxpk_tail"].map(
            (id, rank) => ({
              ctxPackID: CtxPack.ID.make(id),
              contentHash: id === "ctxpk_explicit" ? explicitAttachment.contentHash : `sha256:${id}`,
              byteLength: 10,
              estimatedTokens: 3,
              rank,
            }),
          )
        }),
      snapshotCandidate: (input) => {
        assemblyCalls.snapshots.push(input.ctxPackID)
        if (input.ctxPackID === "ctxpk_denied") return Effect.fail<unknown>({ _tag: "CtxPackPermissionDenied" })
        return Effect.succeed({
          sourceCtxPackID: input.ctxPackID,
          label: `Title ${input.ctxPackID}`,
          contentHash: input.expectedContentHash,
          fragments: [{
            text: `Fragment ${input.ctxPackID}`,
            source: {
              workspaceID: "wrk_test",
              blockID: `block_${input.ctxPackID}`,
              functionalityID: "builtin:chat",
              kind: "note" as const,
              direction: "unknown" as const,
              sourceTimestamp: null,
              capturedAt: 1_700_000_000_000,
              entityRef: null,
              label: null,
              metadata: {},
              sensitivity: "workspace" as const,
            },
            contentHash: `sha256:fragment-${input.ctxPackID}`,
          }],
        })
      },
    },
  })
  const assemble = (overrides: Partial<Parameters<typeof service.assemble>[0]> = {}) =>
    service.assemble({
      actor: { userID: "user_1", workspaceID: "wrk_test" },
      sessionID,
      promptText: "deployment details",
      explicitAttachments: [],
      budget: {
        maximumBytes: 32 * 1024,
        maximumEstimatedTokens: 6_000,
        maximumFacts: 32,
        maximumReferences: 16,
        maximumArtifacts: 8,
        maximumRecentEvents: 8,
      },
      profile,
      mode: "v2-enriched",
      ...overrides,
    })

  const resetAssembly = () => {
    assemblyCalls.materialize = 0
    assemblyCalls.search = 0
    assemblyCalls.snapshots.length = 0
  }

  test("uses the real profile target, explicit-first order, four-auto limit, combined limit, and no automatic capsule materialization", () => {
    resetAssembly()
    const result = Effect.runSync(assemble({ explicitAttachments: [explicitAttachment] }))
    expect(result.snapshot?.version).toBe(2)
    expect(result.snapshot?.attachments[0]).toMatchObject({ selection: "explicit", sourceCtxPackID: "ctxpk_explicit" })
    expect(result.snapshot?.attachments.slice(1).map((item) => item.sourceCtxPackID)).toEqual([
      "ctxpk_a",
      "ctxpk_b",
      "ctxpk_c",
      "ctxpk_d",
    ])
    expect(result.snapshot?.attachments).toHaveLength(5)
    expect(assemblyCalls.materialize).toBe(1)
    expect(assemblyCalls.search).toBe(1)
    expect(assemblyCalls.snapshots).toContain("ctxpk_denied")
  })

  test("keeps local explicit V1 and managed-not-ready clean-only behavior search-free", () => {
    resetAssembly()
    const local = Effect.runSync(assemble({ mode: "v1-local-explicit", explicitAttachments: [explicitAttachment] }))
    expect(local.snapshot?.version).toBe(1)
    expect(assemblyCalls.search).toBe(0)
    expect(Effect.runSync(assemble({ mode: "v1-clean-only" })).snapshot).toBeUndefined()
    const unavailable = Effect.runSync(Effect.flip(assemble({ mode: "v1-clean-only", explicitAttachments: [explicitAttachment] })))
    expect(unavailable.code).toBe("transfer-unavailable")
    expect(assemblyCalls.search).toBe(0)
  })

  test("rejects workspace mismatch and missing-actor explicit context before query", () => {
    resetAssembly()
    expect(Effect.runSync(Effect.flip(assemble({ actor: { userID: "user_1", workspaceID: "wrong" } }))).code).toBe("workspace-mismatch")
    expect(Effect.runSync(Effect.flip(assemble({ actor: undefined, explicitAttachments: [explicitAttachment] }))).code).toBe("missing-actor")
    expect(assemblyCalls.search).toBe(0)
    expect(assemblyCalls.materialize).toBe(0)
  })

  test("skips trivial recall and admits no-actor OperatingChat clean text as unavailable", () => {
    resetAssembly()
    const trivial = Effect.runSync(assemble({ promptText: "thanks" }))
    expect(trivial.snapshot).toMatchObject({ version: 2, recall: { status: "skipped-trivial" } })
    const missing = Effect.runSync(assemble({ actor: undefined }))
    expect(missing.snapshot).toMatchObject({ version: 2, apiContent: "deployment details", recall: { status: "unavailable" } })
    expect(assemblyCalls.search).toBe(0)
  })

  test("fails closed for explicit errors and fails open with sanitized unavailable automatic status", () => {
    resetAssembly()
    const failingMaterializer = CtxPackSessionContext.make({
      materializer: {
        ...materializer,
        snapshotForSessionInput: (input) =>
          input.attachments.length === 0
            ? Effect.succeed(fakeSnapshot([]))
            : Effect.fail({ _tag: "CtxPackDeleted", ctxPackID: CtxPack.ID.make("ctxpk_deleted") }),
      } as CtxPackMaterializer,
      recall: {
        terms: () => ["deployment"],
        trivial: () => false,
        search: () => Effect.die("CTXPACK_SECRET_QUERY"),
        snapshotCandidate: () => Effect.die("unused"),
      },
    })
    expect(Effect.runSync(Effect.flip(failingMaterializer.assemble({
      actor: { userID: "user_1", workspaceID: "wrk_test" },
      sessionID,
      promptText: "secret query",
      explicitAttachments: [explicitAttachment],
      budget: DefaultInteractiveContextBudget,
      profile,
      mode: "v2-enriched",
    }))).code).toBe("CtxPackDeleted")
    const unavailable = Effect.runSync(
      failingMaterializer.assemble({
        actor: { userID: "user_1", workspaceID: "wrk_test" },
        sessionID,
        promptText: "secret query",
        explicitAttachments: [],
        budget: DefaultInteractiveContextBudget,
        profile,
        mode: "v2-enriched",
      }),
    )
    expect(unavailable.snapshot).toMatchObject({ recall: { status: "unavailable" }, apiContent: "secret query" })
    expect(JSON.stringify(unavailable)).not.toContain("CTXPACK_SECRET_QUERY")
  })
})
