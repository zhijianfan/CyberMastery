export * as SessionExecutionOwnership from "./ownership"

import { and, eq } from "drizzle-orm"
import { Context, Effect, Schema } from "effect"
import type { Database } from "../../database/database"
import { SessionSchema } from "../schema"
import { SessionExecutionTable } from "../sql"

type DatabaseService = Database.Interface["db"]

export interface Lease {
  readonly sessionID: SessionSchema.ID
  readonly ownerID: string
  readonly epoch: number
}

export class OwnerConflict extends Schema.TaggedErrorClass<OwnerConflict>()("SessionExecution.OwnerConflict", {
  sessionID: SessionSchema.ID,
}) {}

export class StaleLease extends Schema.TaggedErrorClass<StaleLease>()("SessionExecution.StaleLease", {
  sessionID: SessionSchema.ID,
}) {}

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
          const row = yield* db
            .select()
            .from(SessionExecutionTable)
            .where(eq(SessionExecutionTable.session_id, sessionID))
            .get()
            .pipe(Effect.orDie)
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
            .select({ ownerID: SessionExecutionTable.owner_id, epoch: SessionExecutionTable.epoch })
            .from(SessionExecutionTable)
            .where(eq(SessionExecutionTable.session_id, lease.sessionID))
            .get()
            .pipe(Effect.orDie)
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
          const row = yield* db
            .select({ epoch: SessionExecutionTable.epoch })
            .from(SessionExecutionTable)
            .where(eq(SessionExecutionTable.session_id, sessionID))
            .get()
            .pipe(Effect.orDie)
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
    .pipe(Effect.orDie)
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
  if (!lease) return
  if (lease.sessionID !== aggregateID) return yield* new StaleLease({ sessionID: lease.sessionID })
  const row = yield* db
    .select({ ownerID: SessionExecutionTable.owner_id, epoch: SessionExecutionTable.epoch })
    .from(SessionExecutionTable)
    .where(eq(SessionExecutionTable.session_id, lease.sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!row || row.ownerID !== lease.ownerID || row.epoch !== lease.epoch)
    return yield* new StaleLease({ sessionID: lease.sessionID })
})
