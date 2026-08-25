export * as SessionInput from "./input"

import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm"
import { Cause, Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import {
  Admitted,
  Delivery,
  SessionContextAttachmentInput,
  SessionContextSnapshot,
} from "@opencode-ai/schema/session-input"
import { DefaultInteractiveContextBudget } from "../context-broker/capsule"
import type { ContextBudget } from "../context-broker/capsule"
import type { Database } from "../database/database"
import { makeGlobalNode, tags } from "../effect/app-node"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { EventTable } from "../event/sql"
import { SessionContextProfile } from "./context-profile"
import { contextRequestHash } from "./context-sidecar"
import { SessionContextTransferReadiness } from "./context-transfer-readiness"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionSchema } from "./schema"
import {
  CorruptContextSnapshot,
  MissingPrivateContext,
  decodeContextSlot,
  isPendingV2,
  type Stored as StoredContextSlot,
} from "./context-slot"
import { SessionInputTable, SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

export { Admitted, Delivery }
export type { SessionContextAttachmentInput, SessionContextSnapshot }
export { CorruptContextSnapshot, MissingPrivateContext }

export type SessionInputRow = typeof SessionInputTable.$inferSelect

const decodePrompt = Schema.decodeUnknownSync(Prompt)
const encodePrompt = Schema.encodeSync(Prompt)
const decodePromptAdmitted = Schema.decodeUnknownEffect(SessionEvent.PromptAdmitted.data)
const decodeJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)
const decodeJsonOption = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodePromptIdentity = Schema.decodeUnknownOption(Schema.Struct({ messageID: SessionMessage.ID }))

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

const findRow = Effect.fn("SessionInput.findRow")(function* (db: DatabaseService, id: SessionMessage.ID) {
  return yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, id)).get().pipe(Effect.orDie)
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

export interface SessionContextAssemblyPort {
  readonly assemble: (input: {
    readonly actor?: { readonly userID: string; readonly workspaceID?: string }
    readonly sessionID: SessionSchema.ID
    readonly promptText: string
    readonly explicitAttachments: readonly SessionContextAttachmentInput[]
    readonly budget: ContextBudget
    readonly profile: SessionContextProfile.Profile
    readonly mode: SessionContextTransferReadiness.Mode
  }) => Effect.Effect<{ readonly snapshot?: SessionContextSnapshot }, ContextAttachmentError>
}

export class SessionContextAssemblyPortService extends Context.Service<
  SessionContextAssemblyPortService,
  SessionContextAssemblyPort
>()("@opencode/v2/SessionContextAssemblyPort") {}

export const SessionContextAssemblyPort = {
  node: LayerNode.unbound(SessionContextAssemblyPortService, tags.values.global),
  cleanLayer: Layer.succeed(
    SessionContextAssemblyPortService,
    SessionContextAssemblyPortService.of({
      assemble: (input) =>
        input.explicitAttachments.length === 0
          ? Effect.succeed({})
          : Effect.fail(new ContextAttachmentError({ code: "transfer-unavailable" })),
    }),
  ),
}

export const cleanContextAssemblyNode = makeGlobalNode({
  service: SessionContextAssemblyPortService,
  layer: SessionContextAssemblyPort.cleanLayer,
  deps: [],
})

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

const persistContextSnapshot = Effect.fn("SessionInput.persistContextSnapshot")(function* (
  db: DatabaseService,
  id: SessionMessage.ID,
  sessionID: SessionSchema.ID,
  promptText: string,
  snapshot?: SessionContextSnapshot,
) {
  if (snapshot === undefined) return
  yield* decodeContextSlot(snapshot, promptText, id)
  if (snapshot.version === 2) {
    const row = yield* findRow(db, id)
    if (row === undefined || !isPendingV2(row.context_snapshot_json)) return yield* new MissingPrivateContext({ id })
  }
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
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          ? Effect.interrupt
          : Effect.logError(
              `ctxpack admission usage recording failed: ${snapshot.attachments.length} attachments, ${ctxPackIDs.length} distinct packs`,
            ),
      ),
    )
})

const reconcileExisting = Effect.fn("SessionInput.reconcileExisting")(function* (
  db: DatabaseService,
  row: typeof SessionInputTable.$inferSelect,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly contextRequestHash: string
  },
) {
  const admitted = fromRow(row)
  const storedHash =
    row.context_snapshot_json === null || row.context_snapshot_json === undefined
      ? contextRequestHash([])
      : (yield* decodeContextSlot(row.context_snapshot_json, input.prompt.text, admitted.id).pipe(
          Effect.mapError((error) => new ContextAttachmentError({ code: error._tag })),
        )).contextRequestHash
  if (!equivalent(admitted, input)) return yield* Effect.die(new LifecycleConflict({ id: admitted.id }))
  if (storedHash !== input.contextRequestHash) return yield* Effect.die(new LifecycleConflict({ id: admitted.id }))
  return admitted
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
  const requestedHash = contextRequestHash(input.contextAttachments ?? [])
  const existing = yield* findRow(db, input.id)
  if (existing !== undefined)
    return yield* reconcileExisting(db, existing, { ...input, contextRequestHash: requestedHash })

  const readiness = yield* SessionContextTransferReadiness.Service
  return yield* readiness.withPermit({ sessionID: input.sessionID }, (mode) =>
    Effect.gen(function* () {
      const profilePort = yield* SessionContextProfile.Service
      const profile = yield* profilePort
        .resolve(input.sessionID)
        .pipe(Effect.mapError((error) => new ContextAttachmentError({ code: error._tag })))
      const assembly = yield* SessionContextAssemblyPortService
      const context = yield* assembly.assemble({
        actor: input.actor,
        sessionID: input.sessionID,
        promptText: input.prompt.text,
        explicitAttachments: input.contextAttachments ?? [],
        budget: DefaultInteractiveContextBudget,
        profile,
        mode,
      })
      const timestamp = yield* DateTime.now
      const result = yield* events
        .publish(
          SessionEvent.PromptAdmitted,
          {
            messageID: input.id,
            sessionID: input.sessionID,
            timestamp,
            prompt: input.prompt,
            delivery: input.delivery,
            ...(context.snapshot?.version === 2 ? { modelContextVersion: 2 as const } : {}),
          },
          {
            commit: () =>
              profilePort
                .revalidate(input.sessionID, profile)
                .pipe(
                  Effect.andThen(
                    persistContextSnapshot(db, input.id, input.sessionID, input.prompt.text, context.snapshot),
                  ),
                  Effect.orDie,
                ),
          },
        )
        .pipe(
          Effect.map((event) => {
            if (event.durable === undefined) throw new Error("Prompt admission event is missing aggregate sequence")
            return {
              admitted: Admitted.make({
                admittedSeq: event.durable.seq,
                id: input.id,
                sessionID: input.sessionID,
                prompt: input.prompt,
                delivery: input.delivery,
                timeCreated: timestamp,
              }),
              created: true,
            }
          }),
          Effect.catchDefect((defect) => {
            if (
              defect instanceof SessionContextProfile.StaleError ||
              defect instanceof SessionContextProfile.AmbiguousError
            )
              return Effect.fail(new ContextAttachmentError({ code: defect._tag }))
            if (defect instanceof MissingPrivateContext || defect instanceof CorruptContextSnapshot)
              return Effect.fail(new ContextAttachmentError({ code: defect._tag }))
            if (!(defect instanceof LifecycleConflict)) return Effect.die(defect)
            return findRow(db, input.id).pipe(
              Effect.flatMap((row) =>
                row === undefined
                  ? Effect.die(defect)
                  : reconcileExisting(db, row, { ...input, contextRequestHash: requestedHash }).pipe(
                      Effect.mapError((error) => new ContextAttachmentError({ code: error._tag })),
                      Effect.map((admitted) => ({ admitted, created: false })),
                    ),
              ),
            )
          }),
        )
      if (!result.created || input.actor === undefined || input.actor.userID.length === 0) return result.admitted
      const row = yield* findRow(db, input.id)
      if (row?.context_snapshot_json === null || row?.context_snapshot_json === undefined) return result.admitted
      const snapshot = (yield* decodeContextSlot(row.context_snapshot_json, input.prompt.text, input.id).pipe(
        Effect.mapError((error) => new ContextAttachmentError({ code: error._tag })),
      )).snapshot
      const workspaceID = profile.kind === "operating-chat" ? profile.workspaceID : input.actor.workspaceID
      if (workspaceID !== undefined)
        yield* recordContextUsage({ userID: input.actor.userID, workspaceID }, snapshot, result.admitted)
      return result.admitted
    }),
  )
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
    readonly modelContextVersion?: 2
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
      context_snapshot_json:
        input.modelContextVersion === 2 ? ({ state: "pending", version: 2 } satisfies StoredContextSlot) : null,
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
    snapshots.push(
      (yield* decodeContextSlot(
        row.context_snapshot_json,
        decodePrompt(row.prompt).text,
        SessionMessage.ID.make(row.id),
      )).snapshot,
    )
  }
  return snapshots
})

export const contextSnapshotsByMessageID = Effect.fn("SessionInput.contextSnapshotsByMessageID")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  messages: ReadonlyArray<SessionMessage.User>,
) {
  if (messages.length === 0) return new Map<SessionMessage.ID, SessionContextSnapshot>()
  const ids = messages.map((message) => message.id)
  const eventData = sql<string>`CAST(${EventTable.data} AS TEXT)`
  const contextSnapshot = sql<string | null>`CAST(${SessionInputTable.context_snapshot_json} AS TEXT)`
  const rows = yield* db
    .select({
      id: SessionInputTable.id,
      admittedSeq: SessionInputTable.admitted_seq,
      contextSnapshot,
    })
    .from(SessionInputTable)
    .where(and(eq(SessionInputTable.session_id, sessionID), inArray(SessionInputTable.id, ids)))
    .all()
    .pipe(Effect.orDie)
  const rowByID = new Map(rows.map((row) => [row.id, row]))
  const presentEvents =
    rows.length === 0
      ? []
      : yield* db
          .select({ seq: EventTable.seq, data: eventData })
          .from(EventTable)
          .where(
            and(
              eq(EventTable.aggregate_id, sessionID),
              eq(EventTable.type, EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1)),
              inArray(
                EventTable.seq,
                rows.map((row) => row.admittedSeq),
              ),
            ),
          )
          .all()
          .pipe(Effect.orDie)
  const missingIDs = messages.filter((message) => !rowByID.has(message.id)).map((message) => message.id)
  // A deleted input row also deletes its admission-sequence join key. The
  // content-free public message ID is the only remaining way to associate its
  // requiredness marker. Guard JSON parsing in SQL so malformed unrelated
  // events stay outside this fallback; if the marker's own message ID is also
  // damaged, authenticated projection repair must restore the missing row.
  const eventMessageID = sql<string | null>`CASE WHEN json_valid(CAST(${EventTable.data} AS TEXT)) THEN json_extract(${EventTable.data}, '$.messageID') END`
  const missingEvents =
    missingIDs.length === 0
      ? []
      : yield* db
          .select({ seq: EventTable.seq, data: eventData })
          .from(EventTable)
          .where(
            and(
              eq(EventTable.aggregate_id, sessionID),
              eq(EventTable.type, EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1)),
              inArray(eventMessageID, missingIDs),
            ),
          )
          .all()
          .pipe(Effect.orDie)
  const eventBySeq = new Map(presentEvents.map((event) => [event.seq, event]))
  const eventsByMessageID = new Map<SessionMessage.ID, typeof missingEvents>()
  for (const event of missingEvents) {
    const value = decodeJsonOption(event.data)
    if (Option.isNone(value)) continue
    const identity = decodePromptIdentity(value.value)
    if (Option.isNone(identity) || !missingIDs.includes(identity.value.messageID)) continue
    eventsByMessageID.set(identity.value.messageID, [
      ...(eventsByMessageID.get(identity.value.messageID) ?? []),
      event,
    ])
  }

  const snapshots = new Map<SessionMessage.ID, SessionContextSnapshot>()
  for (const message of messages) {
    const row = rowByID.get(message.id)
    const candidates = eventsByMessageID.get(message.id) ?? []
    const event = row === undefined ? candidates[0] : eventBySeq.get(row.admittedSeq)
    if (candidates.length > 1) return yield* new CorruptContextSnapshot({ id: message.id })
    const data =
      event === undefined
        ? undefined
        : yield* decodeJson(event.data).pipe(
            Effect.flatMap(decodePromptAdmitted),
            Effect.mapError(() => new CorruptContextSnapshot({ id: message.id })),
          )
    if (data !== undefined && (data.sessionID !== sessionID || data.messageID !== message.id))
      return yield* new CorruptContextSnapshot({ id: message.id })
    const required = data?.modelContextVersion === 2
    if (row === undefined || row.contextSnapshot === null) {
      if (required) return yield* new MissingPrivateContext({ id: message.id })
      continue
    }
    const stored = yield* decodeJson(row.contextSnapshot).pipe(
      Effect.mapError(() => new CorruptContextSnapshot({ id: message.id })),
    )
    const snapshot = (yield* decodeContextSlot(stored, message.text, message.id)).snapshot
    if (required !== (snapshot.version === 2)) return yield* new CorruptContextSnapshot({ id: message.id })
    snapshots.set(message.id, snapshot)
  }
  return snapshots as ReadonlyMap<SessionMessage.ID, SessionContextSnapshot>
})
