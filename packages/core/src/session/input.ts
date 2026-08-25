export * as SessionInput from "./input"

import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { Admitted, Delivery, SessionContextAttachmentInput, SessionContextSnapshot } from "@opencode-ai/schema/session-input"
import { DefaultInteractiveContextBudget } from "../context-broker/capsule"
import type { ContextBudget } from "../context-broker/capsule"
import { tags } from "../effect/app-node"
import { LayerNode } from "../effect/layer-node"
import type { Database } from "../database/database"
import type { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionSchema } from "./schema"
import { SessionInputTable, SessionMessageTable } from "./sql"
import { SessionContextProfile } from "./context-profile"
import { SessionContextTransferReadiness } from "./context-transfer-readiness"
import { SessionContextSlot } from "./context-slot"
import { SessionContextSidecar } from "./context-sidecar"

type DatabaseService = Database.Interface["db"]

export { Admitted, Delivery }
export type { SessionContextAttachmentInput, SessionContextSnapshot }
export const MissingPrivateContext = SessionContextSlot.MissingPrivateContext
export type MissingPrivateContext = SessionContextSlot.MissingPrivateContext

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
  const row = yield* findRow(db, id)
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

// Corrupt durable context_snapshot_json on read. Never silently ignored and
// never rematerialized live: callers decide between failing the turn and
// surfacing the defect.
export class CorruptContextSnapshot extends Schema.TaggedErrorClass<CorruptContextSnapshot>()(
  "SessionInput.CorruptContextSnapshot",
  {
    id: SessionMessage.ID,
  },
) {}

// --- Context assembly + usage ports -------------------------------------------
//
// Injected ports so admission stays decoupled from the CtxPack materializer
// and the usage recorder. M1 wires the real X1 `CtxPackMaterializer` (its
// `snapshotForSessionInput` is structurally identical to this port) and the
// real C2 usage recorder; tests provide fakes.

export class SessionContextAssemblyError extends Schema.TaggedErrorClass<SessionContextAssemblyError>()(
  "SessionInput.SessionContextAssemblyError",
  { code: Schema.String },
) {}

export interface SessionContextAssemblyPort {
  assemble(input: {
    actor?: { userID: string; workspaceID?: string }
    sessionID: SessionSchema.ID
    promptText: string
    explicitAttachments: readonly SessionContextAttachmentInput[]
    budget: ContextBudget
    profile: SessionContextProfile.Profile
    mode: SessionContextTransferReadiness.Mode
  }): Effect.Effect<{
    snapshot?: SessionContextSnapshot
    usageCtxPackIDs: readonly string[]
  }, SessionContextAssemblyError>
}

export class SessionContextAssemblyPortService extends Context.Service<
  SessionContextAssemblyPortService,
  SessionContextAssemblyPort
>()("@opencode/v2/SessionContextAssemblyPort") {}

export const sessionContextAssemblyPortNode = LayerNode.unbound(SessionContextAssemblyPortService, tags.values.global)
export const genericContextProfileNode = LayerNode.make({
  service: SessionContextProfile.Service,
  layer: Layer.succeed(
    SessionContextProfile.Service,
    SessionContextProfile.Service.of({
      resolve: () => Effect.succeed({ kind: "generic" }),
      revalidate: (_sessionID, profile) =>
        profile.kind === "generic" ? Effect.void : Effect.die("generic profile changed unexpectedly"),
    }),
  ),
  deps: [],
  tag: tags.values.global,
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

const toContextAttachmentError = (error: SessionContextAssemblyError) =>
  new ContextAttachmentError({ code: error.code })

// Resolves and validates the durable snapshot BEFORE the admission event is
// published. Any failure rejects the whole admission: no event, no input row.
// Returns the validated actor alongside the snapshot for the usage hook.
const assembleContext = Effect.fn("SessionInput.assembleContext")(function* (
  input: {
    readonly sessionID: SessionSchema.ID
    readonly promptText: string
    readonly contextAttachments?: ReadonlyArray<SessionContextAttachmentInput>
    readonly contextTransferProof?: SessionContextTransferReadiness.RequestProof
    readonly actor?: { readonly userID: string; readonly workspaceID?: string }
  },
  services: {
    readonly assembly: SessionContextAssemblyPort
    readonly profiles: SessionContextProfile.Interface
    readonly readiness: SessionContextTransferReadiness.Interface
  },
) {
  const attachments = input.contextAttachments ?? []
  const mode = yield* services.readiness.acquire({ sessionID: input.sessionID, proof: input.contextTransferProof })
  const profile = yield* services.profiles.resolve(input.sessionID).pipe(
    Effect.mapError((error) => new ContextAttachmentError({ code: error._tag })),
  )
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
  const assembled = yield* services.assembly
    .assemble({
      actor: input.actor,
      sessionID: input.sessionID,
      promptText: input.promptText,
      explicitAttachments: attachments,
      budget: DefaultInteractiveContextBudget,
      profile,
      mode,
    })
    .pipe(Effect.mapError(toContextAttachmentError))
  const decodedSnapshot = assembled.snapshot
    ? yield* decodeContextSnapshot(assembled.snapshot).pipe(
        Effect.mapError(() => new ContextAttachmentError({ code: "invalid-snapshot" })),
      )
    : undefined
  const snapshot = decodedSnapshot?.version === 2
    ? yield* SessionContextSidecar.decode(decodedSnapshot, input.promptText).pipe(
        Effect.mapError(() => new ContextAttachmentError({ code: "invalid-snapshot" })),
      )
    : decodedSnapshot
  if (
    snapshot !== undefined &&
    (mode === "v1-clean-only" ||
      (mode === "v1-local-explicit" && snapshot.version !== 1) ||
      (mode === "v2-enriched" && snapshot.version !== 2))
  )
    return yield* new ContextAttachmentError({ code: "invalid-snapshot" })
  const workspaceID = profile.kind === "operating-chat" ? profile.workspaceID : input.actor?.workspaceID
  return {
    snapshot,
    usageCtxPackIDs: assembled.usageCtxPackIDs,
    profile,
    actor:
      input.actor === undefined || workspaceID === undefined
        ? undefined
        : { userID: input.actor.userID, workspaceID },
  }
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
  const row = yield* findRow(db, id)
  if (!row || row.session_id !== sessionID) return yield* Effect.die(`Session input row missing for context snapshot: ${id}`)
  if (snapshot.version === 2 && !SessionContextSlot.isPending(row.context_snapshot_json))
    return yield* Effect.die(`Session input row missing pending private context: ${id}`)
  if (snapshot.version === 1 && row.context_snapshot_json !== null)
    return yield* Effect.die(`Session input row already has private context: ${id}`)
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
  ctxPackIDs: readonly string[],
  admitted: Admitted,
) {
  const usage = Context.getOption(yield* Effect.context(), CtxPackUsagePortService)
  if (Option.isNone(usage)) return
  const distinct = [...new Set(ctxPackIDs)]
  if (distinct.length === 0) return
  yield* usage.value
    .recordAdmittedUse({
      workspaceID: actor.workspaceID,
      userID: actor.userID,
      ctxPackIDs: distinct,
      sessionInputID: admitted.id,
      admittedAt: DateTime.toEpochMillis(admitted.timeCreated),
    })
    .pipe(
      Effect.catch(() =>
        Effect.logError(
          `ctxpack admission usage recording failed: ${ctxPackIDs.length} selected packs, ${distinct.length} distinct packs`,
        ),
      ),
    )
})

const requestHash = (attachments: readonly SessionContextAttachmentInput[]) =>
  SessionContextSidecar.contextRequestHash(
    attachments.map((attachment) => ({
      contextCapsuleID: attachment.contextCapsuleID,
      sourceCtxPackID: attachment.source.ctxPackID,
      label: attachment.label,
      contentHash: attachment.contentHash,
    })),
  )

const storedRequestHash = Effect.fn("SessionInput.storedRequestHash")(function* (
  row: SessionInputRow,
  cleanText: string,
) {
  if (row.context_snapshot_json === null || row.context_snapshot_json === undefined) return requestHash([])
  const snapshot = yield* SessionContextSlot.requireComplete(
    SessionMessage.ID.make(row.id),
    row.context_snapshot_json,
    cleanText,
  ).pipe(
    Effect.mapError((error) =>
      error instanceof SessionContextSlot.MissingPrivateContext
        ? error
        : new CorruptContextSnapshot({ id: SessionMessage.ID.make(row.id) }),
    ),
  )
  if (snapshot.version === 2) return snapshot.contextRequestHash
  return SessionContextSidecar.contextRequestHash(snapshot.attachments)
})

const reconcile = Effect.fn("SessionInput.reconcile")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly contextAttachments?: ReadonlyArray<SessionContextAttachmentInput>
  },
  expectedContextRequestHash: string,
) {
  const row = yield* findRow(db, input.id)
  if (!row) return undefined
  const admitted = fromRow(row)
  const storedHash = yield* storedRequestHash(row, admitted.prompt.text)
  if (
    !equivalent(admitted, input) ||
    storedHash !== expectedContextRequestHash
  )
    return yield* new LifecycleConflict({ id: input.id })
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
    readonly contextTransferProof?: SessionContextTransferReadiness.RequestProof
    readonly actor?: { readonly userID: string; readonly workspaceID?: string }
  },
  services?: {
    readonly assembly: SessionContextAssemblyPort
    readonly profiles: SessionContextProfile.Interface
    readonly readiness: SessionContextTransferReadiness.Interface
  },
) {
  const expectedContextRequestHash = requestHash(input.contextAttachments ?? [])
  const existing = yield* reconcile(db, input, expectedContextRequestHash)
  if (existing !== undefined) return existing
  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      const timestamp = yield* DateTime.now
      if (!services && (input.contextAttachments?.length ?? 0) > 0)
        return yield* new ContextAttachmentError({ code: "context-assembly-unavailable" })
      const context = services
        ? yield* assembleContext({ ...input, promptText: input.prompt.text }, services)
        : { snapshot: undefined, usageCtxPackIDs: [], profile: undefined, actor: undefined }
      const profile = context.profile
      const commit = profile && services ? () =>
        Effect.gen(function* () {
          yield* services.profiles.revalidate(input.sessionID, profile).pipe(
            Effect.mapError((error) => new ContextAttachmentError({ code: error._tag })),
            Effect.orDie,
          )
          if (context.snapshot) yield* persistContextSnapshot(db, input.id, input.sessionID, context.snapshot)
        })
        : undefined
      const admitted = yield* events
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
          commit ? { commit } : undefined,
        )
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
          Effect.map((admitted) => ({ admitted, created: true as const })),
          Effect.catchDefect((defect) => {
            if (defect instanceof ContextAttachmentError)
              return Effect.fail<
                | ContextAttachmentError
                | CorruptContextSnapshot
                | SessionContextSlot.MissingPrivateContext
                | LifecycleConflict
              >(defect)
            if (!(defect instanceof LifecycleConflict)) return Effect.die(defect)
            return reconcile(db, input, expectedContextRequestHash).pipe(
              Effect.flatMap((admitted) =>
                admitted ? Effect.succeed({ admitted, created: false as const }) : Effect.die(defect),
              ),
            )
          }),
        )
      if (admitted.created && context.actor && context.snapshot)
        yield* recordContextUsage(
          context.actor,
          context.snapshot.attachments.map((attachment) => attachment.sourceCtxPackID),
          admitted.admitted,
        )
      return admitted
    }),
  )
  return result.admitted
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
      context_snapshot_json:
        input.modelContextVersion === 2 ? ({ state: "pending", version: 2 } satisfies SessionContextSlot.Pending) : null,
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

// Loads active durable sidecars by owning user message ID. History owns
// ordering; this map only supplies exact private content for each message.
export const contextSnapshotsByMessageID = Effect.fn("SessionInput.contextSnapshotsByMessageID")(function* (
  db: DatabaseService,
  messages: readonly SessionMessage.Message[],
) {
  const users = messages.filter((message): message is SessionMessage.User => message.type === "user")
  if (users.length === 0) return new Map<SessionMessage.ID, SessionContextSnapshot>()
  const cleanText = new Map(users.map((message) => [message.id, message.text]))
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(inArray(SessionInputTable.id, users.map((message) => message.id)))
    .all()
    .pipe(Effect.orDie)
  return new Map(
    (
      yield* Effect.forEach(
        rows.filter((row) => row.context_snapshot_json !== null && row.context_snapshot_json !== undefined),
        (row) =>
          SessionContextSlot.requireComplete(
            SessionMessage.ID.make(row.id),
            row.context_snapshot_json,
            cleanText.get(row.id)!,
          ).pipe(
            Effect.mapError((error) =>
              error instanceof SessionContextSlot.MissingPrivateContext
                ? error
                : new CorruptContextSnapshot({ id: SessionMessage.ID.make(row.id) }),
            ),
            Effect.map((snapshot) => [row.id, snapshot] as const),
          ),
      )
    ),
  )
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
    const decoded = yield* SessionContextSlot.requireComplete(
      SessionMessage.ID.make(row.id),
      row.context_snapshot_json,
      decodePrompt(row.prompt).text,
    ).pipe(
      Effect.mapError((error) =>
        error instanceof SessionContextSlot.MissingPrivateContext
          ? error
          : new CorruptContextSnapshot({ id: SessionMessage.ID.make(row.id) }),
      ),
    )
    snapshots.push(decoded)
  }
  return snapshots
})
