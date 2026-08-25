import { describe, expect } from "bun:test"
import { Effect, Layer, Logger } from "effect"
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
import { SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import type { SessionContextAttachmentInput, SessionContextSnapshot } from "@opencode-ai/schema/session-input"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { testEffect } from "./lib/effect"

// --- Fakes -------------------------------------------------------------------

const SENTINEL = "CTXPACK_SECRET_SENTINEL_7812"

const portCalls: Array<{
  actor: { userID: string; workspaceID: string }
  targetInstanceID: string
  targetFunctionalityID: string
  attachments: ReadonlyArray<SessionContextAttachmentInput>
  budget: unknown
}> = []
let snapshotFailure: SessionInput.SessionSnapshotError | undefined = undefined

const usageRecords: Array<{
  workspaceID: string
  userID: string
  ctxPackIDs: ReadonlyArray<string>
  sessionInputID: SessionMessage.ID
  admittedAt: number
}> = []
let usageFailure = false

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

const snapshotPort = Layer.succeed(
  SessionInput.SessionCtxSnapshotPortService,
  SessionInput.SessionCtxSnapshotPortService.of({
    snapshotForSessionInput: (input) =>
      Effect.gen(function* () {
        portCalls.push({
          actor: input.actor,
          targetInstanceID: input.targetInstanceID,
          targetFunctionalityID: input.targetFunctionalityID,
          attachments: input.attachments,
          budget: input.budget,
        })
        if (snapshotFailure !== undefined) return yield* Effect.fail(snapshotFailure)
        return fakeSnapshot(input.attachments)
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
    [[SessionExecution.node, execution]],
  ).pipe(Layer.provideMerge(snapshotPort), Layer.provideMerge(usagePort)),
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
  usageFailure = false
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
      if (stored?.version !== 1) throw new Error("expected version-1 context snapshot")
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
      expect(portCalls).toHaveLength(0)
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
})
