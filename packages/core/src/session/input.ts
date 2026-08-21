export * as SessionInput from "./input"

import { and, asc, eq, isNull, lte } from "drizzle-orm"
import { Context, DateTime, Effect, Option, Schema } from "effect"
import { Admitted, Delivery, SessionContextAttachmentInput, SessionContextSnapshot } from "@opencode-ai/schema/session-input"
import type { CtxPackError } from "@opencode-ai/schema/ctxpack"
import type { MaterializeError } from "../ctxpack/materialize"
import { DefaultInteractiveContextBudget } from "../context-broker/capsule"
import type { ContextBudget } from "../context-broker/capsule"
import type { Database } from "../database/database"
import type { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionSchema } from "./schema"
import { SessionInputTable, SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

export { Admitted, Delivery }
export type { SessionContextAttachmentInput, SessionContextSnapshot }

export type SessionInputRow = typeof SessionInputTable.$inferSelect

const decodePrompt = Schema.decodeUnknownSync(Prompt)
const encodePrompt = Schema.encodeSync(Prompt)
const decodeContextSnapshot = Schema.decodeUnknownEffect(SessionContextSnapshot)

const fromRow = (row: typeof SessionInputTable.$inferSelect): Admitted =>
  Admitted.make({
    admittedSeq: row.admitted_seq,
    id: SessionMessage.ID.make(row.id),
    sessionID: SessionSchema.ID.make(row.session_id),
    prompt: decodePrompt(row.prompt),
    delivery: row.delivery,
    timeCreated: DateTime.makeUnsafe(row.time_created),
    ...(row.promoted_seq === null ? {} : { promotedSeq: row.promoted_seq }),
  })

export const find = Effect.fn("SessionInput.find")(function* (db: DatabaseService, id: SessionMessage.ID) {
  const row = yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, id)).get().pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

export class LifecycleConflict extends Schema.TaggedErrorClass<LifecycleConflict>()("SessionInput.LifecycleConflict", {
  id: SessionMessage.ID,
}) {}

// Context-attachment admission failure (snapshot materialization rejected the
// request). Carries a stable machine-readable code only — never fragment text.
export class ContextAttachmentError extends Schema.TaggedErrorClass<ContextAttachmentError>()(
  "SessionInput.ContextAttachmentError",
  {
    code: Schema.String,
  },
) {}

// Corrupt durable context_snapshot_json on read. Never silently ignored and
// never rematerialized live: callers decide between failing the turn and
// surfacing the defect.
export class CorruptContextSnapshot extends Schema.TaggedErrorClass<CorruptContextSnapshot>()(
  "SessionInput.CorruptContextSnapshot",
  {
    id: SessionMessage.ID,
  },
) {}

// --- Context-snapshot + usage ports -------------------------------------------
//
// Injected ports so admission stays decoupled from the CtxPack materializer
// and the usage recorder. M1 wires the real X1 `CtxPackMaterializer` (its
// `snapshotForSessionInput` is structurally identical to this port) and the
// real C2 usage recorder; tests provide fakes.

export interface SessionCtxSnapshotPort {
  snapshotForSessionInput(input: {
    actor: { userID: string; workspaceID: string }
    targetInstanceID: string
    targetFunctionalityID: string
    attachments: readonly SessionContextAttachmentInput[]
    budget: ContextBudget
  }): Effect.Effect<SessionContextSnapshot, SessionSnapshotError>
}

// The frozen materializer failure surface (X1's union + the S1 CtxPackError
// union). Carries ids/hashes/counts only — never fragment text.
export type SessionSnapshotError = CtxPackError | MaterializeError

export class SessionCtxSnapshotPortService extends Context.Service<SessionCtxSnapshotPortService, SessionCtxSnapshotPort>()(
  "@opencode/v2/SessionCtxSnapshotPort",
) {}

export interface CtxPackUsagePort {
  // Best-effort recording: failures must never fail admission.
  recordAdmittedUse(input: {
    workspaceID: string
    userID: string
    ctxPackIDs: ReadonlyArray<string>
    sessionInputID: SessionMessage.ID
    admittedAt: number
  }): Effect.Effect<void, unknown>
}

export class CtxPackUsagePortService extends Context.Service<CtxPackUsagePortService, CtxPackUsagePort>()(
  "@opencode/v2/CtxPackUsagePort",
) {}

// The session-scoped functionality instance id for capability subjects
// (frozen: no SessionSchema-derived helper exists; see HANDOFF-Q1).
const sessionTargetInstanceID = (sessionID: SessionSchema.ID) => `chat-instance:${sessionID}`

const toContextAttachmentError = (error: CtxPackError | MaterializeError) =>
  new ContextAttachmentError({ code: error._tag })

// Resolves and validates the durable snapshot BEFORE the admission event is
// published. Any failure rejects the whole admission: no event, no input row.
// Returns the validated actor alongside the snapshot for the usage hook.
const admitContextSnapshot = Effect.fn("SessionInput.admitContextSnapshot")(function* (
  input: {
    readonly sessionID: SessionSchema.ID
    readonly contextAttachments?: ReadonlyArray<SessionContextAttachmentInput>
    readonly actor?: { readonly userID: string; readonly workspaceID?: string }
  },
) {
  const attachments = input.contextAttachments
  if (attachments === undefined || attachments.length === 0) return undefined
  // Transport-level budget guards (M1: the wire schema keeps no refinements —
  // httpapi-codegen rejects them as unportable — so admission enforces the
  // frozen limits: at most 8 attachments, no duplicate capsule IDs).
  if (attachments.length > 8) return yield* new ContextAttachmentError({ code: "too-many-attachments" })
  const seen = new Set<string>()
  for (const attachment of attachments) {
    if (seen.has(attachment.contextCapsuleID))
      return yield* new ContextAttachmentError({ code: "duplicate-capsule" })
    seen.add(attachment.contextCapsuleID)
  }
  if (input.actor === undefined || input.actor.userID.length === 0)
    return yield* new ContextAttachmentError({ code: "missing-actor" })
  const userID = input.actor.userID
  const workspaceID = input.actor.workspaceID
  if (workspaceID === undefined) return yield* new ContextAttachmentError({ code: "missing-workspace" })
  const port = Context.getOption(yield* Effect.context(), SessionCtxSnapshotPortService)
  if (Option.isNone(port)) return yield* new ContextAttachmentError({ code: "snapshot-port-unavailable" })
  const snapshot = yield* port.value
    .snapshotForSessionInput({
      actor: { userID, workspaceID },
      targetInstanceID: sessionTargetInstanceID(input.sessionID),
      targetFunctionalityID: "builtin:chat",
      attachments,
      budget: DefaultInteractiveContextBudget,
    })
    .pipe(Effect.mapError(toContextAttachmentError))
  // Validate the port result against the local schema copy before persisting.
  const validated = yield* decodeContextSnapshot(snapshot).pipe(
    Effect.mapError(() => new ContextAttachmentError({ code: "invalid-snapshot" })),
  )
  return { snapshot: validated, actor: { userID, workspaceID } }
})

// The projector inserts the input row while publishing the durable event; the
// snapshot is written immediately after, in the same admission scope, before
// any ack is returned. Missing row after publish is a durable-state defect.
const persistContextSnapshot = Effect.fn("SessionInput.persistContextSnapshot")(function* (
  db: DatabaseService,
  id: SessionMessage.ID,
  sessionID: SessionSchema.ID,
  snapshot: SessionContextSnapshot,
) {
  const updated = yield* db
    .update(SessionInputTable)
    .set({ context_snapshot_json: snapshot })
    .where(and(eq(SessionInputTable.id, id), eq(SessionInputTable.session_id, sessionID)))
    .returning({ id: SessionInputTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!updated) return yield* Effect.die(`Session input row missing for context snapshot: ${id}`)
})

// Best-effort usage recording AFTER admission commits. Failure never fails
// admission and never retries the prompt; diagnostics carry counts only.
const recordContextUsage = Effect.fn("SessionInput.recordContextUsage")(function* (
  actor: { readonly userID: string; readonly workspaceID: string },
  snapshot: SessionContextSnapshot,
  admitted: Admitted,
) {
  const usage = Context.getOption(yield* Effect.context(), CtxPackUsagePortService)
  if (Option.isNone(usage)) return
  const ctxPackIDs = [...new Set(snapshot.attachments.map((attachment) => attachment.sourceCtxPackID))]
  if (ctxPackIDs.length === 0) return
  yield* usage.value
    .recordAdmittedUse({
      workspaceID: actor.workspaceID,
      userID: actor.userID,
      ctxPackIDs,
      sessionInputID: admitted.id,
      admittedAt: DateTime.toEpochMillis(admitted.timeCreated),
    })
    .pipe(
      Effect.catch(() =>
        Effect.logError(
          `ctxpack admission usage recording failed: ${snapshot.attachments.length} attachments, ${ctxPackIDs.length} distinct packs`,
        ),
      ),
    )
})

export const admit = Effect.fn("SessionInput.admit")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly contextAttachments?: ReadonlyArray<SessionContextAttachmentInput>
    readonly actor?: { readonly userID: string; readonly workspaceID?: string }
  },
) {
  const existing = yield* find(db, input.id)
  if (existing !== undefined) return existing
  const timestamp = yield* DateTime.now
  // Snapshot BEFORE the durable admission event: any failure rejects the whole
  // admission (no event, no input row, no partial prompt).
  const context = yield* admitContextSnapshot(input)
  const commit = context ? () => persistContextSnapshot(db, input.id, input.sessionID, context.snapshot) : undefined
  const admitted = yield* events
    .publish(SessionEvent.PromptAdmitted, {
      messageID: input.id,
      sessionID: input.sessionID,
      timestamp,
      prompt: input.prompt,
      delivery: input.delivery,
    }, context === undefined ? undefined : { commit })
    .pipe(
      Effect.flatMap((event) =>
        event.durable === undefined
          ? Effect.die("Prompt admission event is missing aggregate sequence")
          : Effect.succeed(
              Admitted.make({
                admittedSeq: event.durable.seq,
                id: input.id,
                sessionID: input.sessionID,
                prompt: input.prompt,
                delivery: input.delivery,
                timeCreated: timestamp,
              }),
            ),
      ),
      Effect.catchDefect((defect) =>
        find(db, input.id).pipe(Effect.flatMap((stored) => (stored ? Effect.succeed(stored) : Effect.die(defect)))),
      ),
    )
  if (context !== undefined) {
    yield* recordContextUsage(context.actor, context.snapshot, admitted)
  }
  return admitted
})

export const projectAdmitted = Effect.fn("SessionInput.projectAdmitted")(function* (
  db: DatabaseService,
  input: {
    readonly admittedSeq: number
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
  },
) {
  const message = yield* db
    .select({ id: SessionMessageTable.id })
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, input.id))
    .get()
    .pipe(Effect.orDie)
  if (message !== undefined) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  const stored = yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      admitted_seq: input.admittedSeq,
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .onConflictDoNothing()
    .returning({ id: SessionInputTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
})

export const projectPrompted = Effect.fn("SessionInput.projectPrompted")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
    readonly promotedSeq: number
  },
) {
  const updated = yield* db
    .update(SessionInputTable)
    .set({ promoted_seq: input.promotedSeq })
    .where(
      and(
        eq(SessionInputTable.id, input.id),
        eq(SessionInputTable.session_id, input.sessionID),
        isNull(SessionInputTable.promoted_seq),
      ),
    )
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (updated) {
    const stored = fromRow(updated)
    if (!matchesProjection(stored, input)) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  const stored = yield* find(db, input.id)
  if (stored) {
    if (!matchesProjection(stored, input) || stored.promotedSeq !== input.promotedSeq)
      return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      admitted_seq: input.promotedSeq,
      promoted_seq: input.promotedSeq,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .run()
    .pipe(Effect.orDie)
})

export const hasPending = Effect.fn("SessionInput.hasPending")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  delivery: Delivery,
) {
  const row = yield* db
    .select({ id: SessionInputTable.id })
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, delivery),
      ),
    )
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row !== undefined
})

export const equivalent = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
  },
) => input.delivery === expected.delivery && matchesPrompt(input, expected)

const matchesPrompt = (input: Admitted, expected: { readonly sessionID: SessionSchema.ID; readonly prompt: Prompt }) =>
  input.sessionID === expected.sessionID &&
  JSON.stringify(encodePrompt(input.prompt)) === JSON.stringify(encodePrompt(expected.prompt))

const matchesProjection = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
  },
) =>
  equivalent(input, expected) &&
  DateTime.toEpochMillis(input.timeCreated) === DateTime.toEpochMillis(expected.timeCreated)

const publish = Effect.fn("SessionInput.publish")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  rows: ReadonlyArray<typeof SessionInputTable.$inferSelect>,
) {
  for (const row of rows) {
    const id = SessionMessage.ID.make(row.id)
    yield* events
      .publish(SessionEvent.Prompted, {
        sessionID,
        timestamp: DateTime.makeUnsafe(row.time_created),
        messageID: id,
        prompt: decodePrompt(row.prompt),
        delivery: row.delivery,
      })
      .pipe(
        Effect.catchDefect((defect) =>
          defect instanceof LifecycleConflict
            ? find(db, id).pipe(
                Effect.flatMap((stored) => (stored?.promotedSeq === undefined ? Effect.die(defect) : Effect.void)),
              )
            : Effect.die(defect),
        ),
      )
  }
  return rows
})

export const promoteSteers = Effect.fn("SessionInput.promoteSteers")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  cutoff: number,
) {
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, "steer"),
        lte(SessionInputTable.admitted_seq, cutoff),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .all()
    .pipe(Effect.orDie)
  return yield* publish(db, events, sessionID, rows)
})

export const promoteNextQueued = Effect.fn("SessionInput.promoteNextQueued")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, "queue"),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  if (row === undefined) return undefined
  return yield* publish(db, events, sessionID, [row]).pipe(Effect.map((rows) => rows[0]))
})

// Decodes the durable context_snapshot_json of the given input rows, in
// admitted order. Corrupt JSON is a typed durable-data error — never silently
// ignored, never rematerialized live.
export const contextSnapshotsOf = Effect.fn("SessionInput.contextSnapshotsOf")(function* (
  db: DatabaseService,
  rows: ReadonlyArray<SessionInputRow>,
) {
  const snapshots: SessionContextSnapshot[] = []
  for (const row of [...rows].sort((a, b) => a.admitted_seq - b.admitted_seq)) {
    if (row.context_snapshot_json === null || row.context_snapshot_json === undefined) continue
    const decoded = yield* decodeContextSnapshot(row.context_snapshot_json).pipe(
      Effect.mapError(() => new CorruptContextSnapshot({ id: SessionMessage.ID.make(row.id) })),
    )
    snapshots.push(decoded)
  }
  return snapshots
})
