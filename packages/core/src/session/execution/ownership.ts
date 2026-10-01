export * as SessionExecutionOwnership from "./ownership"

import { and, eq } from "drizzle-orm"
import { Context, Effect, Schema } from "effect"
import type { Database } from "../../database/database"
import { SessionSchema } from "../schema"
import { SessionDeletionTable, SessionExecutionTable } from "../sql"

type DatabaseService = Database.Interface["db"]

export interface Lease {
  readonly sessionID: SessionSchema.ID
  readonly ownerID: string
  readonly epoch: number
}

export class OwnerConflict extends Schema.TaggedErrorClass<OwnerConflict>()("SessionExecution.OwnerConflict", {
  sessionID: SessionSchema.ID,
}) {}

export class Closed extends Schema.TaggedErrorClass<Closed>()("SessionExecution.Closed", {
  sessionID: SessionSchema.ID,
}) {}

export class StaleLease extends Schema.TaggedErrorClass<StaleLease>()("SessionExecution.StaleLease", {
  sessionID: SessionSchema.ID,
}) {}

export class HandoffConflict extends Schema.TaggedErrorClass<HandoffConflict>()("SessionExecution.HandoffConflict", {
  sessionID: SessionSchema.ID,
}) {}

export class HandoffReceiptMismatch extends Schema.TaggedErrorClass<HandoffReceiptMismatch>()(
  "SessionExecution.HandoffReceiptMismatch",
  { sessionID: SessionSchema.ID },
) {}

export interface HandoffTarget {
  readonly handoffID: string
  readonly targetOwnerID: string
  /** The caller supplies a canonical endpoint string for exact receipt comparison. */
  readonly targetEndpoint: string
}

export interface HandoffSnapshot {
  readonly handoffID: string
  readonly digest: string
  readonly seq: number
}

export interface HandoffReceipt extends HandoffSnapshot {
  readonly targetOwnerID: string
  readonly targetEndpoint: string
}

const current = Context.Reference<Lease | undefined>("SessionExecutionOwnership.current", {
  defaultValue: () => undefined,
})

/** Acquire an unowned Session. An existing live owner must release or be explicitly fenced first. */
export const acquire = Effect.fn("SessionExecutionOwnership.acquire")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  ownerID: string,
) {
  return yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const closed = yield* db.select({ id: SessionDeletionTable.session_id }).from(SessionDeletionTable)
            .where(eq(SessionDeletionTable.session_id, sessionID)).get().pipe(Effect.orDie)
          if (closed) return yield* new Closed({ sessionID })
          const row = yield* db
            .select()
            .from(SessionExecutionTable)
            .where(eq(SessionExecutionTable.session_id, sessionID))
            .get()
            .pipe(Effect.orDie)
          if (row?.handoff_state) return yield* new HandoffConflict({ sessionID })
          if (row?.owner_id && row.owner_id !== ownerID) return yield* new OwnerConflict({ sessionID })
          if (row?.owner_id === ownerID) return { sessionID, ownerID, epoch: row.epoch }
          const epoch = (row?.epoch ?? 0) + 1
          yield* db
            .insert(SessionExecutionTable)
            .values({ session_id: sessionID, owner_id: ownerID, epoch })
            .onConflictDoUpdate({ target: SessionExecutionTable.session_id, set: { owner_id: ownerID, epoch } })
            .run()
            .pipe(Effect.orDie)
          return { sessionID, ownerID, epoch }
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.catchTag("SqlError", Effect.die))
})

/** Atomic handoff after the current worker has drained or been interrupted. */
export const transfer = Effect.fn("SessionExecutionOwnership.transfer")(function* (
  db: DatabaseService,
  lease: Lease,
  ownerID: string,
) {
  return yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const row = yield* db
            .select({
              ownerID: SessionExecutionTable.owner_id,
              epoch: SessionExecutionTable.epoch,
              handoff: SessionExecutionTable.handoff_state,
            })
            .from(SessionExecutionTable)
            .where(eq(SessionExecutionTable.session_id, lease.sessionID))
            .get()
            .pipe(Effect.orDie)
          if (row?.handoff) return yield* new HandoffConflict({ sessionID: lease.sessionID })
          if (!row || row.ownerID !== lease.ownerID || row.epoch !== lease.epoch)
            return yield* new StaleLease({ sessionID: lease.sessionID })
          const epoch = row.epoch + 1
          yield* db
            .update(SessionExecutionTable)
            .set({ owner_id: ownerID, epoch })
            .where(eq(SessionExecutionTable.session_id, lease.sessionID))
            .run()
            .pipe(Effect.orDie)
          return { sessionID: lease.sessionID, ownerID, epoch }
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.catchTag("SqlError", Effect.die))
})

/** Explicit crash takeover. The caller must decide that uncertain provider/tool work will not be replayed. */
export const takeover = Effect.fn("SessionExecutionOwnership.takeover")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  ownerID: string,
) {
  return yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const closed = yield* db.select({ id: SessionDeletionTable.session_id }).from(SessionDeletionTable)
            .where(eq(SessionDeletionTable.session_id, sessionID)).get().pipe(Effect.orDie)
          if (closed) return yield* new Closed({ sessionID })
          const row = yield* db
            .select({ epoch: SessionExecutionTable.epoch, handoff: SessionExecutionTable.handoff_state })
            .from(SessionExecutionTable)
            .where(eq(SessionExecutionTable.session_id, sessionID))
            .get()
            .pipe(Effect.orDie)
          if (row?.handoff) return yield* new HandoffConflict({ sessionID })
          const epoch = (row?.epoch ?? 0) + 1
          yield* db
            .insert(SessionExecutionTable)
            .values({ session_id: sessionID, owner_id: ownerID, epoch })
            .onConflictDoUpdate({ target: SessionExecutionTable.session_id, set: { owner_id: ownerID, epoch } })
            .run()
            .pipe(Effect.orDie)
          return { sessionID, ownerID, epoch }
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.catchTag("SqlError", Effect.die))
})

/** Release only the lease that completed or was interrupted. A stale owner cannot release its successor. */
export const release = Effect.fn("SessionExecutionOwnership.release")(function* (db: DatabaseService, lease: Lease) {
  yield* db
    .update(SessionExecutionTable)
    .set({ owner_id: null })
    .where(
      and(
        eq(SessionExecutionTable.session_id, lease.sessionID),
        eq(SessionExecutionTable.owner_id, lease.ownerID),
        eq(SessionExecutionTable.epoch, lease.epoch),
      ),
    )
    .run()
    .pipe(Effect.orDie)
})

/** Freeze an idle source before exporting its snapshot. No provider work is resumed by this operation. */
export const reserve = Effect.fn("SessionExecutionOwnership.reserve")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  target: HandoffTarget,
) {
  return yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const closed = yield* db.select({ id: SessionDeletionTable.session_id }).from(SessionDeletionTable)
            .where(eq(SessionDeletionTable.session_id, sessionID)).get().pipe(Effect.orDie)
          if (closed) return yield* new Closed({ sessionID })
          const row = yield* db
            .select()
            .from(SessionExecutionTable)
            .where(eq(SessionExecutionTable.session_id, sessionID))
            .get()
            .pipe(Effect.orDie)
          if (
            row?.handoff_state &&
            row.handoff_id === target.handoffID &&
            row.target_owner_id === target.targetOwnerID &&
            row.target_endpoint === target.targetEndpoint
          )
            return
          if (row?.owner_id || row?.handoff_state) return yield* new HandoffConflict({ sessionID })
          yield* db
            .insert(SessionExecutionTable)
            .values({
              session_id: sessionID,
              owner_id: null,
              epoch: (row?.epoch ?? 0) + 1,
              handoff_id: target.handoffID,
              handoff_state: "reserved",
              target_owner_id: target.targetOwnerID,
              target_endpoint: target.targetEndpoint,
            })
            .onConflictDoUpdate({
              target: SessionExecutionTable.session_id,
              set: {
                epoch: (row?.epoch ?? 0) + 1,
                handoff_id: target.handoffID,
                handoff_state: "reserved",
                target_owner_id: target.targetOwnerID,
                target_endpoint: target.targetEndpoint,
              },
            })
            .run()
            .pipe(Effect.orDie)
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.catchTag("SqlError", Effect.die))
})

/** Record the exact snapshot sent to the target after the source has been frozen. */
export const seal = Effect.fn("SessionExecutionOwnership.seal")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  snapshot: HandoffSnapshot,
) {
  return yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const row = yield* db
            .select()
            .from(SessionExecutionTable)
            .where(eq(SessionExecutionTable.session_id, sessionID))
            .get()
            .pipe(Effect.orDie)
          if (!row?.handoff_state || row.handoff_id !== snapshot.handoffID)
            return yield* new HandoffConflict({ sessionID })
          if (row.prepared_digest === snapshot.digest && row.prepared_seq === snapshot.seq) return
          if (row.handoff_state !== "reserved" || row.prepared_digest !== null)
            return yield* new HandoffConflict({ sessionID })
          yield* db
            .update(SessionExecutionTable)
            .set({ prepared_digest: snapshot.digest, prepared_seq: snapshot.seq })
            .where(eq(SessionExecutionTable.session_id, sessionID))
            .run()
            .pipe(Effect.orDie)
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.catchTag("SqlError", Effect.die))
})

/** Commit only the receipt for the sealed snapshot; the source stays fenced permanently. */
export const commit = Effect.fn("SessionExecutionOwnership.commit")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  receipt: HandoffReceipt,
) {
  return yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const row = yield* db
            .select()
            .from(SessionExecutionTable)
            .where(eq(SessionExecutionTable.session_id, sessionID))
            .get()
            .pipe(Effect.orDie)
          if (!row?.handoff_state || row.handoff_id !== receipt.handoffID)
            return yield* new HandoffConflict({ sessionID })
          if (
            row.prepared_digest === null ||
            row.prepared_seq === null ||
            row.prepared_digest !== receipt.digest ||
            row.prepared_seq !== receipt.seq ||
            row.target_owner_id !== receipt.targetOwnerID ||
            row.target_endpoint !== receipt.targetEndpoint
          )
            return yield* new HandoffReceiptMismatch({ sessionID })
          if (row.handoff_state === "committed") return
          yield* db
            .update(SessionExecutionTable)
            .set({ handoff_state: "committed" })
            .where(eq(SessionExecutionTable.session_id, sessionID))
            .run()
            .pipe(Effect.orDie)
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.catchTag("SqlError", Effect.die))
})

/** Read the proof recorded by the source only after its handoff is committed. */
export const committedHandoff = Effect.fn("SessionExecutionOwnership.committedHandoff")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select({
      handoffID: SessionExecutionTable.handoff_id,
      digest: SessionExecutionTable.prepared_digest,
      seq: SessionExecutionTable.prepared_seq,
      targetOwnerID: SessionExecutionTable.target_owner_id,
      targetEndpoint: SessionExecutionTable.target_endpoint,
    })
    .from(SessionExecutionTable)
    .where(and(eq(SessionExecutionTable.session_id, sessionID), eq(SessionExecutionTable.handoff_state, "committed")))
    .get()
    .pipe(Effect.orDie)
  if (
    !row ||
    row.handoffID === null ||
    row.digest === null ||
    row.seq === null ||
    row.targetOwnerID === null ||
    row.targetEndpoint === null
  )
    return yield* new HandoffConflict({ sessionID })
  return {
    handoffID: row.handoffID,
    digest: row.digest,
    seq: row.seq,
    targetOwnerID: row.targetOwnerID,
    targetEndpoint: row.targetEndpoint,
  }
})

/** Cancel only this uncommitted reservation. */
export const abort = Effect.fn("SessionExecutionOwnership.abort")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  handoffID: string,
) {
  return yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const row = yield* db
            .select()
            .from(SessionExecutionTable)
            .where(eq(SessionExecutionTable.session_id, sessionID))
            .get()
            .pipe(Effect.orDie)
          if (row?.handoff_state !== "reserved" || row.handoff_id !== handoffID)
            return yield* new HandoffConflict({ sessionID })
          yield* db
            .update(SessionExecutionTable)
            .set({
              handoff_id: null,
              handoff_state: null,
              target_owner_id: null,
              target_endpoint: null,
              prepared_digest: null,
              prepared_seq: null,
            })
            .where(eq(SessionExecutionTable.session_id, sessionID))
            .run()
            .pipe(Effect.orDie)
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.catchTag("SqlError", Effect.die))
})

export const withLease =
  (lease: Lease) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, current, lease)

/** Called inside the durable event transaction before projectors and event insertion. */
export const assertCurrent = Effect.fn("SessionExecutionOwnership.assertCurrent")(function* (
  db: DatabaseService,
  aggregateID: string,
) {
  const lease = yield* current
  const row = yield* db
    .select({
      ownerID: SessionExecutionTable.owner_id,
      epoch: SessionExecutionTable.epoch,
      handoff: SessionExecutionTable.handoff_state,
    })
    .from(SessionExecutionTable)
    .where(eq(SessionExecutionTable.session_id, aggregateID as SessionSchema.ID))
    .get()
    .pipe(Effect.orDie)
  if (row?.handoff) return yield* new HandoffConflict({ sessionID: aggregateID as SessionSchema.ID })
  // A tool may admit a child Session while its parent drain owns a different lease.
  if (!lease || lease.sessionID !== aggregateID) return
  if (!row || row.ownerID !== lease.ownerID || row.epoch !== lease.epoch)
    return yield* new StaleLease({ sessionID: lease.sessionID })
})
