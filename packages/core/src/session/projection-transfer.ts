export * as SessionProjectionTransfer from "./projection-transfer"

import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { and, asc, eq, isNotNull, lte, or, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { isSqlError } from "effect/unstable/sql/SqlError"
import { Durable } from "@opencode-ai/schema/durable-event-manifest"
import { SessionContextSnapshot } from "@opencode-ai/schema/session-input"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import { Database } from "../database/database"
import { tags } from "../effect/app-node"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { EventSequenceTable, EventTable } from "../event/sql"
import { SystemContext } from "../system-context/index"
import { WorkspaceV2 } from "../workspace"
import { SessionCompactionContext } from "./compaction-context"
import { SessionContextEpoch } from "./context-epoch"
import { SessionContextSlot } from "./context-slot"
import { SessionEvent } from "./event"
import { SessionInput } from "./input"
import { SessionMessage } from "./message"
import { SessionProjector } from "./projector"
import { SessionSchema } from "./schema"
import { SessionContextEpochTable, SessionInputTable, SessionMessageTable, SessionTable } from "./sql"

export const PublicEventV1 = Schema.Struct({
  id: EventV2.ID,
  type: Schema.String,
  seq: NonNegativeInt,
  aggregateID: SessionSchema.ID,
  data: Schema.Record(Schema.String, Schema.Unknown),
})
export type PublicEventV1 = typeof PublicEventV1.Type

export const PublicEventIdentityV1 = Schema.Struct({
  eventID: EventV2.ID,
  aggregateID: SessionSchema.ID,
  seq: NonNegativeInt,
  eventType: Schema.String,
  eventDataHash: Schema.String,
})
export type PublicEventIdentityV1 = typeof PublicEventIdentityV1.Type

export const EventContextEnvelopeV1 = Schema.Struct({
  version: Schema.Literal(1),
  eventID: EventV2.ID,
  aggregateID: SessionSchema.ID,
  seq: NonNegativeInt,
  eventType: Schema.String,
  eventDataHash: Schema.String,
  messageID: SessionMessage.ID,
  kind: Schema.Literals(["input", "compaction"]),
  sidecarSchemaVersion: NonNegativeInt,
  contentHash: Schema.String,
  payload: Schema.String,
})
export type EventContextEnvelopeV1 = typeof EventContextEnvelopeV1.Type

export const EpochEnvelopeV1 = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("context-epoch"),
  aggregateID: SessionSchema.ID,
  sourceSeq: NonNegativeInt,
  baselineSeq: NonNegativeInt,
  epochSchemaVersion: Schema.Literal(1),
  contentHash: Schema.String,
  payload: Schema.String,
})
export type EpochEnvelopeV1 = typeof EpochEnvelopeV1.Type

export const DeletionV1 = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("reverted-target"),
  aggregateID: SessionSchema.ID,
  targetMessageID: SessionMessage.ID,
  targetKind: Schema.Literals(["input", "compaction"]),
  deletionCause: Schema.Literals(["message-seq", "input-admitted-seq", "input-promoted-seq"]),
  targetEvent: PublicEventIdentityV1,
  deletingEvent: PublicEventIdentityV1,
  boundaryMessageID: SessionMessage.ID,
  boundaryEvent: PublicEventIdentityV1,
  promotionEvent: PublicEventIdentityV1.pipe(Schema.optional),
})
export type DeletionV1 = typeof DeletionV1.Type

export const BundleV1 = Schema.Struct({
  version: Schema.Literal(1),
  aggregateID: SessionSchema.ID,
  sourceSeq: NonNegativeInt,
  events: Schema.Array(PublicEventV1),
  contexts: Schema.Array(EventContextEnvelopeV1),
  deletions: Schema.Array(DeletionV1),
  epoch: EpochEnvelopeV1.pipe(Schema.optional),
})
export type BundleV1 = typeof BundleV1.Type

const EpochPayload = Schema.Struct({ baseline: Schema.String, snapshot: SystemContext.Snapshot })

export class Invalid extends Schema.TaggedErrorClass<Invalid>()("SessionProjectionTransfer.Invalid", {
  reason: Schema.String,
}) {}

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("SessionProjectionTransfer.Conflict", {
  kind: Schema.Literals(["event", "input", "compaction", "epoch"]),
  targetID: Schema.String,
}) {}

export class ProjectionDefect extends Schema.TaggedErrorClass<ProjectionDefect>()(
  "SessionProjectionTransfer.ProjectionDefect",
  { aggregateID: SessionSchema.ID, targetID: Schema.String },
) {}

export type Error = Invalid | Conflict | ProjectionDefect

export interface Interface {
  readonly export: (input: {
    readonly sessionID: SessionSchema.ID
    readonly after?: number
  }) => Effect.Effect<BundleV1, Error>
  readonly restoreBatch: (input: {
    readonly bundle: unknown
    readonly expectedWorkspaceID?: WorkspaceV2.ID
    readonly expectedOwnerID?: string
    readonly publish?: boolean
  }) => Effect.Effect<void, Error>
  readonly required: (input: { readonly workspaceID?: WorkspaceV2.ID }) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionProjectionTransfer") {}

type DatabaseService = Database.Interface["db"]
type DecodedEvent = { readonly event: EventV2.SerializedEvent; readonly data: Record<string, unknown> }
type PreparedContext = {
  readonly envelope: EventContextEnvelopeV1
  readonly payload: SessionContextSnapshot | SessionCompactionContext.V1
}
type PreparedEpoch = { readonly envelope: EpochEnvelopeV1; readonly payload: typeof EpochPayload.Type }

const decodeBundle = Schema.decodeUnknownOption(BundleV1, { onExcessProperty: "error" })
const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodeSnapshot = Schema.decodeUnknownOption(SessionContextSnapshot, { onExcessProperty: "error" })
const decodeCompaction = Schema.decodeUnknownOption(SessionCompactionContext.V1, { onExcessProperty: "error" })
const decodeEpoch = Schema.decodeUnknownOption(EpochPayload, { onExcessProperty: "error" })
const promptAdmittedType = EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1)
const promptedType = EventV2.versionedType(SessionEvent.Prompted.type, 1)
const compactionType = EventV2.versionedType(SessionEvent.Compaction.Ended.type, 1)
const revertType = EventV2.versionedType(SessionEvent.RevertEvent.Committed.type, 1)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service

    const exportBundle = Effect.fn("SessionProjectionTransfer.export")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly after?: number
    }) {
      return yield* db
        .transaction(() =>
          Effect.gen(function* () {
            const sourceSeq = yield* EventV2.latestSequence(db, input.sessionID)
            if (sourceSeq < 0) return yield* new Invalid({ reason: "aggregate-not-found" })
            const history = yield* readEvents(db, input.sessionID, sourceSeq)
            const decoded = yield* Effect.forEach(history, decodeEvent)
            const inputs = yield* SessionInput.transferRows(db, input.sessionID)
            const messages = yield* db
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.session_id, input.sessionID))
              .all()
              .pipe(Effect.orDie)
            const inputBySequence = new Map(inputs.map((row) => [row.admitted_seq, row]))
            const messageByID = new Map(messages.map((row) => [row.id, row]))
            const contexts: EventContextEnvelopeV1[] = []
            const deletions: DeletionV1[] = []

            for (const target of decoded) {
              if (target.event.type === promptAdmittedType) {
                const row = inputBySequence.get(target.event.seq)
                const required = target.data.modelContextVersion === 2 || row?.context_snapshot_json != null
                if (!required) continue
                const proof = deletionProof(decoded, messages, target, "input")
                if (proof && row) return yield* defect(input.sessionID, row.id)
                if (!row) {
                  if (!proof) return yield* defect(input.sessionID, String(target.data.messageID))
                  deletions.push(proof)
                  continue
                }
                if (row.context_snapshot_json == null || SessionContextSlot.isPending(row.context_snapshot_json))
                  return yield* defect(input.sessionID, row.id)
                const snapshot = yield* SessionContextSlot.requireComplete(
                  SessionMessage.ID.make(row.id),
                  row.context_snapshot_json,
                  String(target.data.prompt && (target.data.prompt as Record<string, unknown>).text),
                ).pipe(Effect.mapError(() => new Invalid({ reason: "input-sidecar-corrupt" })))
                contexts.push(
                  contextEnvelope(target, SessionMessage.ID.make(row.id), "input", snapshot.version, snapshot),
                )
                continue
              }
              if (target.event.type !== compactionType || target.data.text !== SessionCompactionContext.sentinel)
                continue
              const messageID = SessionMessage.ID.make(String(target.data.messageID))
              const row = messageByID.get(messageID)
              const proof = deletionProof(decoded, messages, target, "compaction")
              if (proof && row) return yield* defect(input.sessionID, messageID)
              if (!row) {
                if (!proof) return yield* defect(input.sessionID, messageID)
                deletions.push(proof)
                continue
              }
              if (row.model_context_json == null) return yield* defect(input.sessionID, messageID)
              const context = yield* SessionCompactionContext.decode(messageID, row.model_context_json).pipe(
                Effect.mapError(() => new Invalid({ reason: "compaction-sidecar-corrupt" })),
              )
              contexts.push(contextEnvelope(target, messageID, "compaction", context.version, context))
            }

            const epoch = yield* SessionContextEpoch.readTransfer(db, input.sessionID)
            const envelope = epoch
              ? yield* makeEpoch(input.sessionID, sourceSeq, epoch.baseline_seq, epoch.baseline, epoch.snapshot)
              : undefined
            return BundleV1.make({
              version: 1,
              aggregateID: input.sessionID,
              sourceSeq,
              events: history.filter((event) => event.seq > (input.after ?? -1)),
              contexts,
              deletions,
              epoch: envelope,
            })
          }),
        )
        .pipe(Effect.catchIf(isSqlError, Effect.die))
    })

    const restoreBatch = Effect.fn("SessionProjectionTransfer.restoreBatch")(function* (input: {
      readonly bundle: unknown
      readonly expectedWorkspaceID?: WorkspaceV2.ID
      readonly expectedOwnerID?: string
      readonly publish?: boolean
    }) {
      const bundle = decodeBundle(input.bundle)
      if (Option.isNone(bundle)) return yield* new Invalid({ reason: "bundle-schema" })
      yield* validateBundleShape(bundle.value)
      const preparedContexts = yield* Effect.forEach(bundle.value.contexts, prepareContext)
      const preparedEpoch = bundle.value.epoch ? yield* prepareEpoch(bundle.value.epoch) : undefined
      const decodedIncoming = yield* Effect.forEach(bundle.value.events, decodeEvent)

      yield* events
        .replayBatch(bundle.value.events, {
          publish: input.publish,
          ownerID: input.expectedOwnerID,
          strictOwner: input.expectedOwnerID !== undefined,
          validate: () =>
            Effect.gen(function* () {
              const history = yield* mergedHistory(db, bundle.value.aggregateID, decodedIncoming)
              yield* validateRelations(history, bundle.value, preparedContexts)
              yield* validateManifest(db, bundle.value.aggregateID, history, preparedContexts, bundle.value.deletions)
              if (preparedEpoch)
                yield* validateEpochReplacement(
                  db,
                  bundle.value,
                  preparedEpoch,
                  input.expectedWorkspaceID,
                  input.expectedOwnerID,
                )
            }),
          commit: () =>
            Effect.gen(function* () {
              const history = yield* Effect.flatMap(
                readEvents(db, bundle.value.aggregateID, bundle.value.sourceSeq),
                (rows) => Effect.forEach(rows, decodeEvent),
              )
              yield* validateRelations(history, bundle.value, preparedContexts)
              const deletionTargets = new Set(bundle.value.deletions.map(deletionKey))
              for (const context of preparedContexts)
                yield* restoreContext(db, bundle.value.aggregateID, context, deletionTargets)
              if (preparedEpoch)
                yield* restoreEpoch(db, bundle.value, preparedEpoch, input.expectedWorkspaceID, input.expectedOwnerID)
              yield* validateProjection(db, bundle.value.aggregateID, history)
            }),
        })
        .pipe(
          Effect.catchDefect((cause) =>
            cause instanceof EventV2.InvalidDurableEventError
              ? Effect.fail(new Conflict({ kind: "event", targetID: bundle.value.aggregateID }))
              : Effect.die(cause),
          ),
        )
    })

    const required = Effect.fn("SessionProjectionTransfer.required")(function* (input: {
      readonly workspaceID?: WorkspaceV2.ID
    }) {
      const placement = input.workspaceID === undefined ? undefined : eq(SessionTable.workspace_id, input.workspaceID)
      const privateInput = yield* db
        .select({ id: SessionInputTable.id })
        .from(SessionInputTable)
        .innerJoin(SessionTable, eq(SessionTable.id, SessionInputTable.session_id))
        .where(and(placement, isNotNull(SessionInputTable.context_snapshot_json)))
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      if (privateInput) return true
      const privateMessage = yield* db
        .select({ id: SessionMessageTable.id })
        .from(SessionMessageTable)
        .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.session_id))
        .where(and(placement, isNotNull(SessionMessageTable.model_context_json)))
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      if (privateMessage) return true
      const epoch = yield* db
        .select({ id: SessionContextEpochTable.session_id })
        .from(SessionContextEpochTable)
        .innerJoin(SessionTable, eq(SessionTable.id, SessionContextEpochTable.session_id))
        .where(placement)
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      if (epoch) return true
      const retained = yield* db
        .select({ id: EventTable.id })
        .from(EventTable)
        .innerJoin(SessionTable, eq(SessionTable.id, EventTable.aggregate_id))
        .where(
          and(
            placement,
            or(
              and(
                eq(EventTable.type, promptAdmittedType),
                sql`json_extract(${EventTable.data}, '$.modelContextVersion') = 2`,
              ),
              and(
                eq(EventTable.type, compactionType),
                sql`json_extract(${EventTable.data}, '$.text') = ${SessionCompactionContext.sentinel}`,
              ),
            ),
          ),
        )
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      return retained !== undefined
    })

    return Service.of({ export: exportBundle, restoreBatch, required })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Database.node, EventV2.node, SessionProjector.node],
  tag: tags.values.global,
})

function readEvents(db: DatabaseService, sessionID: SessionSchema.ID, highWater: number) {
  return db
    .select()
    .from(EventTable)
    .where(and(eq(EventTable.aggregate_id, sessionID), lte(EventTable.seq, highWater)))
    .orderBy(asc(EventTable.seq))
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) =>
        rows.map(
          (row): PublicEventV1 => ({
            id: row.id,
            aggregateID: SessionSchema.ID.make(row.aggregate_id),
            seq: row.seq,
            type: row.type,
            data: row.data,
          }),
        ),
      ),
    )
}

function decodeEvent(event: EventV2.SerializedEvent): Effect.Effect<DecodedEvent, Invalid> {
  const definition = Durable.get(event.type)
  if (!definition?.durable) return Effect.fail(new Invalid({ reason: "event-type" }))
  const decoded = Schema.decodeUnknownOption(definition.data, { onExcessProperty: "error" })(event.data)
  if (Option.isNone(decoded)) return Effect.fail(new Invalid({ reason: "event-data" }))
  const data = Schema.encodeUnknownSync(definition.data)(decoded.value) as Record<string, unknown>
  if (canonical(data) !== canonical(event.data)) return Effect.fail(new Invalid({ reason: "event-data" }))
  if (data[definition.durable.aggregate] !== event.aggregateID)
    return Effect.fail(new Invalid({ reason: "event-aggregate" }))
  return Effect.succeed({ event, data })
}

function identity(event: DecodedEvent): PublicEventIdentityV1 {
  return {
    eventID: event.event.id,
    aggregateID: SessionSchema.ID.make(event.event.aggregateID),
    seq: event.event.seq,
    eventType: event.event.type,
    eventDataHash: digest(canonical(event.data)),
  }
}

function contextEnvelope(
  event: DecodedEvent,
  messageID: SessionMessage.ID,
  kind: "input" | "compaction",
  sidecarSchemaVersion: number,
  value: unknown,
): EventContextEnvelopeV1 {
  const payload = canonical(value)
  return {
    version: 1,
    ...identity(event),
    messageID,
    kind,
    sidecarSchemaVersion,
    contentHash: digest(payload),
    payload,
  }
}

function makeEpoch(
  aggregateID: SessionSchema.ID,
  sourceSeq: number,
  baselineSeq: number,
  baseline: string,
  snapshot: unknown,
) {
  const decoded = Schema.decodeUnknownOption(SystemContext.Snapshot, { onExcessProperty: "error" })(snapshot)
  if (Option.isNone(decoded) || baselineSeq > sourceSeq)
    return Effect.fail(new Invalid({ reason: "epoch-sidecar-corrupt" }))
  const payload = canonical({ baseline, snapshot: decoded.value })
  return Effect.succeed<EpochEnvelopeV1>({
    version: 1,
    kind: "context-epoch",
    aggregateID,
    sourceSeq,
    baselineSeq,
    epochSchemaVersion: 1,
    contentHash: digest(payload),
    payload,
  })
}

function deletionProof(
  history: ReadonlyArray<DecodedEvent>,
  messages: ReadonlyArray<typeof SessionMessageTable.$inferSelect>,
  target: DecodedEvent,
  kind: "input" | "compaction",
): DeletionV1 | undefined {
  const messageID = SessionMessage.ID.make(String(target.data.messageID))
  const promotion =
    kind === "input"
      ? history.find((event) => event.event.type === promptedType && event.data.messageID === messageID)
      : undefined
  for (const deleting of history.filter(
    (event) => event.event.type === revertType && event.event.seq > (promotion?.event.seq ?? target.event.seq),
  )) {
    const boundaryMessageID = SessionMessage.ID.make(String(deleting.data.messageID))
    const boundary = messages.find((message) => message.id === boundaryMessageID)
    if (!boundary) continue
    const boundaryEvent = history.find((event) => event.event.seq === boundary.seq)
    if (!boundaryEvent || messageIDOf(boundaryEvent) !== boundaryMessageID) continue
    const cause = SessionProjector.deletionCause(
      kind === "compaction"
        ? { kind, seq: target.event.seq }
        : { kind, admittedSeq: target.event.seq, promotedSeq: promotion?.event.seq },
      boundary.seq,
    )
    if (!cause) continue
    return {
      version: 1,
      kind: "reverted-target",
      aggregateID: SessionSchema.ID.make(target.event.aggregateID),
      targetMessageID: messageID,
      targetKind: kind,
      deletionCause: cause,
      targetEvent: identity(target),
      deletingEvent: identity(deleting),
      boundaryMessageID,
      boundaryEvent: identity(boundaryEvent),
      ...(cause === "input-promoted-seq" && promotion ? { promotionEvent: identity(promotion) } : {}),
    }
  }
}

function validateBundleShape(bundle: BundleV1): Effect.Effect<void, Invalid> {
  if (
    bundle.events.some((event) => event.aggregateID !== bundle.aggregateID || event.seq > bundle.sourceSeq) ||
    bundle.contexts.some((context) => context.aggregateID !== bundle.aggregateID) ||
    bundle.deletions.some((deletion) => deletion.aggregateID !== bundle.aggregateID) ||
    (bundle.epoch !== undefined &&
      (bundle.epoch.aggregateID !== bundle.aggregateID || bundle.epoch.sourceSeq !== bundle.sourceSeq))
  )
    return Effect.fail(new Invalid({ reason: "bundle-identity" }))
  for (const [index, event] of bundle.events.entries())
    if (index > 0 && event.seq !== bundle.events[index - 1]!.seq + 1)
      return Effect.fail(new Invalid({ reason: "bundle-sequence" }))
  return Effect.void
}

function prepareContext(envelope: EventContextEnvelopeV1): Effect.Effect<PreparedContext, Invalid> {
  const value = decodeJson(envelope.payload)
  if (
    Option.isNone(value) ||
    canonical(value.value) !== envelope.payload ||
    digest(envelope.payload) !== envelope.contentHash
  )
    return Effect.fail(new Invalid({ reason: "context-payload" }))
  if (envelope.kind === "input") {
    const decoded = decodeSnapshot(value.value)
    if (Option.isNone(decoded) || decoded.value.version !== envelope.sidecarSchemaVersion)
      return Effect.fail(new Invalid({ reason: "context-schema" }))
    return Effect.succeed({ envelope, payload: decoded.value })
  }
  const decoded = decodeCompaction(value.value)
  if (Option.isNone(decoded) || decoded.value.version !== envelope.sidecarSchemaVersion)
    return Effect.fail(new Invalid({ reason: "context-schema" }))
  return Effect.succeed({ envelope, payload: decoded.value })
}

function prepareEpoch(envelope: EpochEnvelopeV1): Effect.Effect<PreparedEpoch, Invalid> {
  const value = decodeJson(envelope.payload)
  if (
    Option.isNone(value) ||
    canonical(value.value) !== envelope.payload ||
    digest(envelope.payload) !== envelope.contentHash
  )
    return Effect.fail(new Invalid({ reason: "epoch-payload" }))
  const decoded = decodeEpoch(value.value)
  if (Option.isNone(decoded) || envelope.baselineSeq > envelope.sourceSeq)
    return Effect.fail(new Invalid({ reason: "epoch-schema" }))
  return Effect.succeed({ envelope, payload: decoded.value })
}

function mergedHistory(
  db: DatabaseService,
  aggregateID: SessionSchema.ID,
  incoming: ReadonlyArray<DecodedEvent>,
): Effect.Effect<ReadonlyArray<DecodedEvent>, Invalid> {
  return Effect.gen(function* () {
    const retained = yield* Effect.flatMap(readEvents(db, aggregateID, Number.MAX_SAFE_INTEGER), (rows) =>
      Effect.forEach(rows, decodeEvent),
    )
    const bySequence = new Map(retained.map((event) => [event.event.seq, event]))
    for (const event of incoming) bySequence.set(event.event.seq, event)
    return [...bySequence.values()].sort((left, right) => left.event.seq - right.event.seq)
  })
}

function validateRelations(
  history: ReadonlyArray<DecodedEvent>,
  bundle: BundleV1,
  contexts: ReadonlyArray<PreparedContext>,
): Effect.Effect<void, Invalid> {
  return Effect.gen(function* () {
    for (const context of contexts) {
      const event = requireIdentity(history, context.envelope)
      if (!event || event.data.messageID !== context.envelope.messageID)
        return yield* new Invalid({ reason: "context-event-identity" })
      if (context.envelope.kind === "input") {
        if (event.event.type !== promptAdmittedType) return yield* new Invalid({ reason: "context-event-type" })
        yield* SessionContextSlot.requireComplete(
          context.envelope.messageID,
          context.payload,
          String(event.data.prompt && (event.data.prompt as Record<string, unknown>).text),
        ).pipe(Effect.mapError(() => new Invalid({ reason: "input-inner" })))
        continue
      }
      if (event.event.type !== compactionType || event.data.text !== SessionCompactionContext.sentinel)
        return yield* new Invalid({ reason: "context-event-type" })
      yield* SessionCompactionContext.decode(context.envelope.messageID, context.payload).pipe(
        Effect.mapError(() => new Invalid({ reason: "compaction-inner" })),
      )
    }
    for (const deletion of bundle.deletions) yield* validateDeletion(history, deletion)
  })
}

function validateManifest(
  db: DatabaseService,
  aggregateID: SessionSchema.ID,
  history: ReadonlyArray<DecodedEvent>,
  contexts: ReadonlyArray<PreparedContext>,
  deletions: ReadonlyArray<DeletionV1>,
): Effect.Effect<void, Invalid> {
  return Effect.gen(function* () {
    const supplied = new Set(contexts.map((context) => `${context.envelope.kind}:${context.envelope.messageID}`))
    const deleted = new Set(deletions.map(deletionKey))
    for (const target of history) {
      if (target.event.type === promptAdmittedType && target.data.modelContextVersion === 2) {
        const messageID = SessionMessage.ID.make(String(target.data.messageID))
        if (supplied.has(`input:${messageID}`) || deleted.has(`input:${messageID}`)) continue
        const row = yield* db
          .select({ context: SessionInputTable.context_snapshot_json })
          .from(SessionInputTable)
          .where(and(eq(SessionInputTable.session_id, aggregateID), eq(SessionInputTable.id, messageID)))
          .get()
          .pipe(Effect.orDie)
        if (!row || row.context == null || SessionContextSlot.isPending(row.context))
          return yield* new Invalid({ reason: "incomplete-private-manifest" })
        yield* SessionContextSlot.requireComplete(
          messageID,
          row.context,
          String(target.data.prompt && (target.data.prompt as Record<string, unknown>).text),
        ).pipe(Effect.mapError(() => new Invalid({ reason: "input-inner" })))
        continue
      }
      if (target.event.type !== compactionType || target.data.text !== SessionCompactionContext.sentinel) continue
      const messageID = SessionMessage.ID.make(String(target.data.messageID))
      if (supplied.has(`compaction:${messageID}`) || deleted.has(`compaction:${messageID}`)) continue
      const row = yield* db
        .select({ context: SessionMessageTable.model_context_json })
        .from(SessionMessageTable)
        .where(and(eq(SessionMessageTable.session_id, aggregateID), eq(SessionMessageTable.id, messageID)))
        .get()
        .pipe(Effect.orDie)
      if (!row || row.context == null) return yield* new Invalid({ reason: "incomplete-private-manifest" })
      yield* SessionCompactionContext.decode(messageID, row.context).pipe(
        Effect.mapError(() => new Invalid({ reason: "compaction-inner" })),
      )
    }
  })
}

function validateDeletion(history: ReadonlyArray<DecodedEvent>, deletion: DeletionV1): Effect.Effect<void, Invalid> {
  const target = requireIdentity(history, deletion.targetEvent)
  const deleting = requireIdentity(history, deletion.deletingEvent)
  const boundary = requireIdentity(history, deletion.boundaryEvent)
  const promotion = deletion.promotionEvent ? requireIdentity(history, deletion.promotionEvent) : undefined
  if (!target || !deleting || !boundary || (deletion.promotionEvent && !promotion))
    return Effect.fail(new Invalid({ reason: "deletion-event-identity" }))
  if (
    target.data.messageID !== deletion.targetMessageID ||
    deleting.event.type !== revertType ||
    deleting.data.messageID !== deletion.boundaryMessageID ||
    messageIDOf(boundary) !== deletion.boundaryMessageID ||
    (promotion !== undefined &&
      (promotion.event.type !== promptedType || promotion.data.messageID !== deletion.targetMessageID)) ||
    deleting.event.seq <= (promotion?.event.seq ?? target.event.seq)
  )
    return Effect.fail(new Invalid({ reason: "deletion-relation" }))
  const cause = SessionProjector.deletionCause(
    deletion.targetKind === "compaction"
      ? { kind: "compaction", seq: target.event.seq }
      : { kind: "input", admittedSeq: target.event.seq, promotedSeq: promotion?.event.seq },
    boundary.event.seq,
  )
  if (
    cause !== deletion.deletionCause ||
    (cause === "input-promoted-seq") !== (promotion !== undefined) ||
    (deletion.targetKind === "input" && target.event.type !== promptAdmittedType) ||
    (deletion.targetKind === "compaction" &&
      (target.event.type !== compactionType || target.data.text !== SessionCompactionContext.sentinel))
  )
    return Effect.fail(new Invalid({ reason: "deletion-cause" }))
  return Effect.void
}

function requireIdentity(
  history: ReadonlyArray<DecodedEvent>,
  expected: PublicEventIdentityV1,
): DecodedEvent | undefined {
  const event = history.find((item) => item.event.seq === expected.seq)
  if (!event) return
  const actual = identity(event)
  return actual.eventID === expected.eventID &&
    actual.aggregateID === expected.aggregateID &&
    actual.seq === expected.seq &&
    actual.eventType === expected.eventType &&
    actual.eventDataHash === expected.eventDataHash
    ? event
    : undefined
}

function restoreContext(
  db: DatabaseService,
  aggregateID: SessionSchema.ID,
  context: PreparedContext,
  deletionTargets: ReadonlySet<string>,
): Effect.Effect<void, Conflict | ProjectionDefect> {
  if (context.envelope.kind === "input")
    return Effect.gen(function* () {
      const row = yield* db
        .select()
        .from(SessionInputTable)
        .where(and(eq(SessionInputTable.session_id, aggregateID), eq(SessionInputTable.id, context.envelope.messageID)))
        .get()
        .pipe(Effect.orDie)
      if (!row) {
        if (deletionTargets.has(`input:${context.envelope.messageID}`)) return
        return yield* defect(aggregateID, context.envelope.messageID)
      }
      if (row.admitted_seq !== context.envelope.seq) return yield* defect(aggregateID, context.envelope.messageID)
      if (row.context_snapshot_json == null || SessionContextSlot.isPending(row.context_snapshot_json)) {
        yield* db
          .update(SessionInputTable)
          .set({ context_snapshot_json: context.payload as SessionContextSnapshot })
          .where(eq(SessionInputTable.id, context.envelope.messageID))
          .run()
          .pipe(Effect.orDie)
        return
      }
      if (!isDeepStrictEqual(row.context_snapshot_json, context.payload))
        return yield* new Conflict({ kind: "input", targetID: context.envelope.messageID })
    })
  return Effect.gen(function* () {
    const row = yield* db
      .select()
      .from(SessionMessageTable)
      .where(
        and(
          eq(SessionMessageTable.session_id, aggregateID),
          eq(SessionMessageTable.id, context.envelope.messageID),
          eq(SessionMessageTable.type, "compaction"),
        ),
      )
      .get()
      .pipe(Effect.orDie)
    if (!row) {
      if (deletionTargets.has(`compaction:${context.envelope.messageID}`)) return
      return yield* defect(aggregateID, context.envelope.messageID)
    }
    if (row.seq !== context.envelope.seq) return yield* defect(aggregateID, context.envelope.messageID)
    if (row.model_context_json == null) {
      yield* SessionCompactionContext.write(
        db,
        context.envelope.messageID,
        context.payload as SessionCompactionContext.V1,
      )
      return
    }
    if (!isDeepStrictEqual(row.model_context_json, context.payload))
      return yield* new Conflict({ kind: "compaction", targetID: context.envelope.messageID })
  })
}

function restoreEpoch(
  db: DatabaseService,
  bundle: BundleV1,
  epoch: PreparedEpoch,
  expectedWorkspaceID?: WorkspaceV2.ID,
  expectedOwnerID?: string,
): Effect.Effect<void, Conflict> {
  return Effect.gen(function* () {
    const stored = yield* SessionContextEpoch.readTransfer(db, bundle.aggregateID)
    if (!stored) {
      yield* db
        .insert(SessionContextEpochTable)
        .values({
          session_id: bundle.aggregateID,
          baseline: epoch.payload.baseline,
          snapshot: epoch.payload.snapshot,
          baseline_seq: epoch.envelope.baselineSeq,
        })
        .run()
        .pipe(Effect.orDie)
      return
    }
    if (
      stored.baseline === epoch.payload.baseline &&
      stored.baseline_seq === epoch.envelope.baselineSeq &&
      isDeepStrictEqual(stored.snapshot, epoch.payload.snapshot)
    )
      return
    const placement = yield* db
      .select({
        workspaceID: SessionTable.workspace_id,
        ownerID: EventSequenceTable.owner_id,
        seq: EventSequenceTable.seq,
      })
      .from(SessionTable)
      .innerJoin(EventSequenceTable, eq(EventSequenceTable.aggregate_id, SessionTable.id))
      .where(eq(SessionTable.id, bundle.aggregateID))
      .get()
      .pipe(Effect.orDie)
    if (
      expectedWorkspaceID === undefined ||
      expectedOwnerID === undefined ||
      placement?.workspaceID !== expectedWorkspaceID ||
      placement.ownerID !== expectedOwnerID ||
      placement.seq !== bundle.sourceSeq
    )
      return yield* new Conflict({ kind: "epoch", targetID: bundle.aggregateID })
    yield* db
      .update(SessionContextEpochTable)
      .set({
        baseline: epoch.payload.baseline,
        snapshot: epoch.payload.snapshot,
        baseline_seq: epoch.envelope.baselineSeq,
      })
      .where(eq(SessionContextEpochTable.session_id, bundle.aggregateID))
      .run()
      .pipe(Effect.orDie)
  })
}

function validateEpochReplacement(
  db: DatabaseService,
  bundle: BundleV1,
  epoch: PreparedEpoch,
  expectedWorkspaceID?: WorkspaceV2.ID,
  expectedOwnerID?: string,
): Effect.Effect<void, Conflict> {
  return Effect.gen(function* () {
    const stored = yield* SessionContextEpoch.readTransfer(db, bundle.aggregateID)
    if (
      !stored ||
      (stored.baseline === epoch.payload.baseline &&
        stored.baseline_seq === epoch.envelope.baselineSeq &&
        isDeepStrictEqual(stored.snapshot, epoch.payload.snapshot))
    )
      return
    const placement = yield* db
      .select({
        workspaceID: SessionTable.workspace_id,
        ownerID: EventSequenceTable.owner_id,
        seq: EventSequenceTable.seq,
      })
      .from(SessionTable)
      .innerJoin(EventSequenceTable, eq(EventSequenceTable.aggregate_id, SessionTable.id))
      .where(eq(SessionTable.id, bundle.aggregateID))
      .get()
      .pipe(Effect.orDie)
    if (
      expectedWorkspaceID === undefined ||
      expectedOwnerID === undefined ||
      placement?.workspaceID !== expectedWorkspaceID ||
      placement.ownerID !== expectedOwnerID ||
      placement.seq > bundle.sourceSeq
    )
      return yield* new Conflict({ kind: "epoch", targetID: bundle.aggregateID })
  })
}

function validateProjection(
  db: DatabaseService,
  aggregateID: SessionSchema.ID,
  history: ReadonlyArray<DecodedEvent>,
): Effect.Effect<void, Invalid | ProjectionDefect> {
  return Effect.gen(function* () {
    const inputs = yield* SessionInput.transferRows(db, aggregateID)
    const messages = yield* db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, aggregateID))
      .all()
      .pipe(Effect.orDie)
    const inputBySequence = new Map(inputs.map((row) => [row.admitted_seq, row]))
    const messageByID = new Map(messages.map((row) => [row.id, row]))
    for (const target of history) {
      if (target.event.type === promptAdmittedType && target.data.modelContextVersion === 2) {
        const row = inputBySequence.get(target.event.seq)
        const proof = deletionProof(history, messages, target, "input")
        if (proof ? row !== undefined : row === undefined)
          return yield* defect(aggregateID, String(target.data.messageID))
        if (!row) continue
        if (row.context_snapshot_json == null || SessionContextSlot.isPending(row.context_snapshot_json))
          return yield* defect(aggregateID, row.id)
        yield* SessionContextSlot.requireComplete(
          SessionMessage.ID.make(row.id),
          row.context_snapshot_json,
          String(target.data.prompt && (target.data.prompt as Record<string, unknown>).text),
        ).pipe(Effect.mapError(() => new Invalid({ reason: "input-inner" })))
        continue
      }
      if (target.event.type !== compactionType || target.data.text !== SessionCompactionContext.sentinel) continue
      const messageID = SessionMessage.ID.make(String(target.data.messageID))
      const row = messageByID.get(messageID)
      const proof = deletionProof(history, messages, target, "compaction")
      if (proof ? row !== undefined : row === undefined) return yield* defect(aggregateID, messageID)
      if (!row) continue
      if (row.model_context_json == null) return yield* defect(aggregateID, messageID)
      yield* SessionCompactionContext.decode(messageID, row.model_context_json).pipe(
        Effect.mapError(() => new Invalid({ reason: "compaction-inner" })),
      )
    }
  })
}

function deletionKey(deletion: DeletionV1) {
  return `${deletion.targetKind}:${deletion.targetMessageID}`
}

function messageIDOf(event: DecodedEvent) {
  if (event.event.type === EventV2.versionedType(SessionEvent.Step.Started.type, 1))
    return event.data.assistantMessageID
  if (
    [
      SessionEvent.AgentSwitched,
      SessionEvent.ModelSwitched,
      SessionEvent.Prompted,
      SessionEvent.ContextUpdated,
      SessionEvent.Synthetic,
      SessionEvent.Shell.Started,
      SessionEvent.Compaction.Ended,
    ].some((definition) => event.event.type === EventV2.versionedType(definition.type, definition.durable!.version))
  )
    return event.data.messageID
}

function defect(aggregateID: SessionSchema.ID, targetID: string) {
  return new ProjectionDefect({ aggregateID, targetID })
}

function canonical(value: unknown) {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  return value
}

function digest(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}
