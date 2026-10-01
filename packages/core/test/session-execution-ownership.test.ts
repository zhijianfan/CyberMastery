import { describe, expect } from "bun:test"
import { DateTime, Deferred, Effect, Exit, Fiber, Option } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionContextEpoch } from "@opencode-ai/core/session/context-epoch"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecutionOwnership } from "@opencode-ai/core/session/execution/ownership"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import {
  SessionContextEpochTable,
  SessionDeletionTable,
  SessionExecutionTable,
  SessionMessageTable,
  SessionTable,
} from "@opencode-ai/core/session/sql"
import { SystemContext } from "@opencode-ai/core/system-context"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node])))
const sessionID = SessionSchema.ID.make("ses_execution_ownership")
const target = { handoffID: "handoff-one", targetOwnerID: "remote", targetEndpoint: "https://remote.example" }
const snapshot = { handoffID: target.handoffID, digest: "sha256:snapshot", seq: 0 }
const receipt = { ...target, ...snapshot }
const setup = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "test",
      directory: "/project",
      title: "test",
      version: "test",
    })
    .run()
  return db
})

describe("Session execution ownership", () => {
  it.effect("rejects acquiring execution after the durable admission fence", () =>
    Effect.gen(function* () {
      const db = yield* setup
      yield* db.insert(SessionDeletionTable).values({ session_id: sessionID, time_created: Date.now() }).run()
      expect(yield* Effect.flip(SessionExecutionOwnership.acquire(db, sessionID, "worker")))
        .toBeInstanceOf(SessionExecutionOwnership.Closed)
      expect(yield* db.select().from(SessionExecutionTable).where(eq(SessionExecutionTable.session_id, sessionID)).get())
        .toBeUndefined()
    }),
  )

  it.effect("rejects takeover after the fence without changing an active lease", () =>
    Effect.gen(function* () {
      const db = yield* setup
      const lease = yield* SessionExecutionOwnership.acquire(db, sessionID, "old")
      yield* db.insert(SessionDeletionTable).values({ session_id: sessionID, time_created: Date.now() }).run()
      expect(yield* Effect.flip(SessionExecutionOwnership.takeover(db, sessionID, "new")))
        .toBeInstanceOf(SessionExecutionOwnership.Closed)
      expect(yield* db.select().from(SessionExecutionTable).where(eq(SessionExecutionTable.session_id, sessionID)).get())
        .toMatchObject({ owner_id: lease.ownerID, epoch: lease.epoch })
      yield* SessionExecutionOwnership.release(db, lease)
      expect(yield* db.select().from(SessionExecutionTable).where(eq(SessionExecutionTable.session_id, sessionID)).get())
        .toMatchObject({ owner_id: null, epoch: lease.epoch })
    }),
  )

  it.effect("serializes takeover behind a committing fence", () =>
    Effect.gen(function* () {
      const db = yield* setup
      const lease = yield* SessionExecutionOwnership.acquire(db, sessionID, "old")
      const written = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      const writer = yield* db.transaction(() => Effect.gen(function* () {
        yield* db.insert(SessionDeletionTable).values({ session_id: sessionID, time_created: Date.now() }).run()
        yield* Deferred.succeed(written, undefined)
        yield* Deferred.await(release)
      }), { behavior: "immediate" }).pipe(Effect.forkChild)
      yield* Deferred.await(written)
      const takeover = yield* Deferred.succeed(started, undefined).pipe(
        Effect.andThen(SessionExecutionOwnership.takeover(db, sessionID, "new")),
        Effect.exit,
        Effect.forkChild,
      )
      yield* Deferred.await(started)
      yield* Effect.yieldNow
      const pending = takeover.pollUnsafe() === undefined
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(writer)
      expect(pending).toBeTrue()
      expect(Exit.findErrorOption(yield* Fiber.join(takeover)).pipe(Option.getOrUndefined))
        .toBeInstanceOf(SessionExecutionOwnership.Closed)
      expect(yield* db.select().from(SessionExecutionTable).where(eq(SessionExecutionTable.session_id, sessionID)).get())
        .toMatchObject({ owner_id: lease.ownerID, epoch: lease.epoch })
    }),
  )

  it.effect("rejects handoff reservation after the fence without creating ownership state", () =>
    Effect.gen(function* () {
      const db = yield* setup
      yield* db.insert(SessionDeletionTable).values({ session_id: sessionID, time_created: Date.now() }).run()
      expect(yield* Effect.flip(SessionExecutionOwnership.reserve(db, sessionID, target)))
        .toBeInstanceOf(SessionExecutionOwnership.Closed)
      expect(yield* db.select().from(SessionExecutionTable).where(eq(SessionExecutionTable.session_id, sessionID)).get())
        .toBeUndefined()
    }),
  )

  it.effect("serializes reservation behind a committing fence", () =>
    Effect.gen(function* () {
      const db = yield* setup
      const written = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      const writer = yield* db.transaction(() => Effect.gen(function* () {
        yield* db.insert(SessionDeletionTable).values({ session_id: sessionID, time_created: Date.now() }).run()
        yield* Deferred.succeed(written, undefined)
        yield* Deferred.await(release)
      }), { behavior: "immediate" }).pipe(Effect.forkChild)
      yield* Deferred.await(written)
      const reservation = yield* Deferred.succeed(started, undefined).pipe(
        Effect.andThen(SessionExecutionOwnership.reserve(db, sessionID, target)),
        Effect.exit,
        Effect.forkChild,
      )
      yield* Deferred.await(started)
      yield* Effect.yieldNow
      const pending = reservation.pollUnsafe() === undefined
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(writer)
      expect(pending).toBeTrue()
      expect(Exit.findErrorOption(yield* Fiber.join(reservation)).pipe(Option.getOrUndefined))
        .toBeInstanceOf(SessionExecutionOwnership.Closed)
      expect(yield* db.select().from(SessionExecutionTable).where(eq(SessionExecutionTable.session_id, sessionID)).get())
        .toBeUndefined()
    }),
  )

  it.effect("cannot revive ownership through transfer or handoff after quiescence", () =>
    Effect.gen(function* () {
      const db = yield* setup
      const lease = yield* SessionExecutionOwnership.acquire(db, sessionID, "old")
      yield* SessionExecutionOwnership.release(db, lease)
      yield* db.insert(SessionDeletionTable).values({ session_id: sessionID, time_created: Date.now() }).run()
      const before = yield* db.select().from(SessionExecutionTable).where(eq(SessionExecutionTable.session_id, sessionID)).get()
      expect(Exit.isFailure(yield* SessionExecutionOwnership.transfer(db, lease, "new").pipe(Effect.exit))).toBeTrue()
      expect(Exit.isFailure(yield* SessionExecutionOwnership.seal(db, sessionID, snapshot).pipe(Effect.exit))).toBeTrue()
      expect(Exit.isFailure(yield* SessionExecutionOwnership.commit(db, sessionID, receipt).pipe(Effect.exit))).toBeTrue()
      expect(Exit.isFailure(yield* SessionExecutionOwnership.abort(db, sessionID, target.handoffID).pipe(Effect.exit)))
        .toBeTrue()
      expect(yield* db.select().from(SessionExecutionTable).where(eq(SessionExecutionTable.session_id, sessionID)).get())
        .toEqual(before)
    }),
  )

  it.effect("reads only committed handoff proofs without changing stored ownership", () =>
    Effect.gen(function* () {
      const db = yield* setup
      for (const phase of ["missing", "reserved", "sealed", "committed"]) {
        if (phase === "reserved") yield* SessionExecutionOwnership.reserve(db, sessionID, target)
        if (phase === "sealed") yield* SessionExecutionOwnership.seal(db, sessionID, snapshot)
        if (phase === "committed") yield* SessionExecutionOwnership.commit(db, sessionID, receipt)
        const before = yield* db.select().from(SessionExecutionTable).all()
        const result = yield* SessionExecutionOwnership.committedHandoff(db, sessionID).pipe(Effect.exit)
        if (phase === "committed") {
          if (Exit.isFailure(result)) return yield* result
          const proof: SessionExecutionOwnership.HandoffReceipt = result.value
          expect(proof).toEqual(receipt)
        }
        if (phase !== "committed")
          expect(Exit.findErrorOption(result).pipe(Option.getOrUndefined)).toEqual(
            new SessionExecutionOwnership.HandoffConflict({ sessionID }),
          )
        expect(yield* db.select().from(SessionExecutionTable).all()).toEqual(before)
      }
      expect(
        Exit.findErrorOption(
          yield* SessionExecutionOwnership.committedHandoff(db, SessionSchema.ID.make("ses_missing")).pipe(Effect.exit),
        ).pipe(Option.getOrUndefined),
      ).toBeInstanceOf(SessionExecutionOwnership.HandoffConflict)
    }),
  )

  it.effect("rejects incomplete committed proof rows without repairing them", () =>
    Effect.gen(function* () {
      const db = yield* setup
      yield* SessionExecutionOwnership.reserve(db, sessionID, target)
      yield* SessionExecutionOwnership.seal(db, sessionID, snapshot)
      yield* SessionExecutionOwnership.commit(db, sessionID, receipt)
      const complete = (yield* db.select().from(SessionExecutionTable).get())!
      for (const field of [
        "handoff_id",
        "prepared_digest",
        "prepared_seq",
        "target_owner_id",
        "target_endpoint",
      ] as const) {
        yield* db
          .update(SessionExecutionTable)
          .set({ ...complete, [field]: null })
          .run()
        const before = yield* db.select().from(SessionExecutionTable).get()
        expect(
          Exit.findErrorOption(yield* SessionExecutionOwnership.committedHandoff(db, sessionID).pipe(Effect.exit)).pipe(
            Option.getOrUndefined,
          ),
        ).toBeInstanceOf(SessionExecutionOwnership.HandoffConflict)
        expect(yield* db.select().from(SessionExecutionTable).get()).toEqual(before)
      }
    }),
  )

  for (const rollback of [false, true]) {
    it.effect(`reads a concurrent handoff only after its transaction ${rollback ? "rolls back" : "commits"}`, () =>
      Effect.gen(function* () {
        const db = yield* setup
        yield* SessionExecutionOwnership.reserve(db, sessionID, target)
        yield* SessionExecutionOwnership.seal(db, sessionID, snapshot)
        const written = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const reading = yield* Deferred.make<void>()
        const writer = yield* db
          .transaction(() =>
            Effect.gen(function* () {
              yield* SessionExecutionOwnership.commit(db, sessionID, receipt)
              yield* Deferred.succeed(written, undefined)
              yield* Deferred.await(release)
              if (rollback) return yield* Effect.fail("rollback")
            }),
          )
          .pipe(Effect.exit, Effect.forkChild)
        yield* Deferred.await(written)
        const reader = yield* Deferred.succeed(reading, undefined).pipe(
          Effect.andThen(SessionExecutionOwnership.committedHandoff(db, sessionID)),
          Effect.exit,
          Effect.forkChild,
        )
        yield* Deferred.await(reading)
        yield* Effect.yieldNow
        expect(reader.pollUnsafe()).toBeUndefined()
        yield* Deferred.succeed(release, undefined)
        expect(Exit.isFailure(yield* Fiber.join(writer))).toBe(rollback)
        const result = yield* Fiber.join(reader)
        if (rollback)
          expect(Exit.findErrorOption(result).pipe(Option.getOrUndefined)).toBeInstanceOf(
            SessionExecutionOwnership.HandoffConflict,
          )
        if (!rollback) {
          if (Exit.isFailure(result)) return yield* result
          expect(result.value).toEqual(receipt)
        }
      }),
    )
  }

  it.effect("serializes commit against abort without reopening a committed source", () =>
    Effect.gen(function* () {
      const db = yield* setup
      yield* SessionExecutionOwnership.reserve(db, sessionID, target)
      yield* SessionExecutionOwnership.seal(db, sessionID, snapshot)
      const results = yield* Effect.all(
        [
          SessionExecutionOwnership.commit(db, sessionID, receipt).pipe(Effect.exit),
          SessionExecutionOwnership.abort(db, sessionID, target.handoffID).pipe(Effect.exit),
        ],
        { concurrency: "unbounded" },
      )
      expect(results.filter(Exit.isSuccess)).toHaveLength(1)
      const row = yield* db.select().from(SessionExecutionTable).get()
      expect(row?.handoff_state).toBe(Exit.isSuccess(results[0]!) ? "committed" : null)
      expect(Exit.isSuccess(yield* SessionExecutionOwnership.acquire(db, sessionID, "next").pipe(Effect.exit))).toBe(
        Exit.isSuccess(results[1]!),
      )
    }),
  )

  it.effect("retries exact handoff phases and rejects conflicting receipts", () =>
    Effect.gen(function* () {
      const db = yield* setup
      yield* SessionExecutionOwnership.reserve(db, sessionID, target)
      const before = yield* db.select().from(SessionExecutionTable).get()
      yield* SessionExecutionOwnership.reserve(db, sessionID, target)
      expect(yield* db.select().from(SessionExecutionTable).get()).toEqual(before)
      expect(
        Exit.isFailure(
          yield* SessionExecutionOwnership.reserve(db, sessionID, { ...target, targetOwnerID: "other" }).pipe(
            Effect.exit,
          ),
        ),
      ).toBe(true)
      yield* SessionExecutionOwnership.seal(db, sessionID, snapshot)
      yield* SessionExecutionOwnership.seal(db, sessionID, snapshot)
      expect(
        Exit.isFailure(
          yield* SessionExecutionOwnership.seal(db, sessionID, { ...snapshot, digest: "different" }).pipe(Effect.exit),
        ),
      ).toBe(true)
      for (const invalid of [
        { ...receipt, targetOwnerID: "other" },
        { ...receipt, targetEndpoint: "https://other.example" },
        { ...receipt, digest: "different" },
        { ...receipt, seq: 1 },
        { ...receipt, handoffID: "other" },
      ]) {
        expect(Exit.isFailure(yield* SessionExecutionOwnership.commit(db, sessionID, invalid).pipe(Effect.exit))).toBe(
          true,
        )
        expect((yield* db.select().from(SessionExecutionTable).get())?.handoff_state).toBe("reserved")
      }
      yield* SessionExecutionOwnership.commit(db, sessionID, receipt)
      yield* SessionExecutionOwnership.commit(db, sessionID, receipt)
      expect(
        Exit.isFailure(
          yield* SessionExecutionOwnership.commit(db, sessionID, { ...receipt, digest: "other" }).pipe(Effect.exit),
        ),
      ).toBe(true)
      expect(
        Exit.isFailure(yield* SessionExecutionOwnership.abort(db, sessionID, target.handoffID).pipe(Effect.exit)),
      ).toBe(true)
      expect(Exit.isFailure(yield* SessionExecutionOwnership.takeover(db, sessionID, "other").pipe(Effect.exit))).toBe(
        true,
      )
      expect((yield* db.select().from(SessionExecutionTable).get())?.handoff_state).toBe("committed")
    }),
  )

  it.effect("serializes acquisition against reservation and abort cannot release another handoff", () =>
    Effect.gen(function* () {
      const db = yield* setup
      const results = yield* Effect.all(
        [
          SessionExecutionOwnership.acquire(db, sessionID, "worker").pipe(Effect.exit),
          SessionExecutionOwnership.reserve(db, sessionID, target).pipe(Effect.exit),
        ],
        { concurrency: "unbounded" },
      )
      expect(results.filter(Exit.isSuccess)).toHaveLength(1)
      const row = yield* db.select().from(SessionExecutionTable).get()
      if (row?.owner_id) {
        yield* SessionExecutionOwnership.release(db, { sessionID, ownerID: row.owner_id, epoch: row.epoch })
        yield* SessionExecutionOwnership.reserve(db, sessionID, target)
      }
      expect(Exit.isFailure(yield* SessionExecutionOwnership.abort(db, sessionID, "wrong").pipe(Effect.exit))).toBe(
        true,
      )
      yield* SessionExecutionOwnership.abort(db, sessionID, target.handoffID)
      const lease = yield* SessionExecutionOwnership.acquire(db, sessionID, "after-abort")
      expect(lease.epoch).toBeGreaterThan(row!.epoch)
      expect(Exit.isFailure(yield* SessionExecutionOwnership.commit(db, sessionID, receipt).pipe(Effect.exit))).toBe(
        true,
      )
      yield* SessionExecutionOwnership.assertCurrent(db, sessionID).pipe(SessionExecutionOwnership.withLease(lease))
    }),
  )

  it.effect("freezes pending admission, events, replay and context until abort", () =>
    Effect.gen(function* () {
      const db = yield* setup
      const events = yield* EventV2.Service
      const input = {
        sessionID,
        id: SessionMessage.ID.create(),
        prompt: Prompt.make({ text: "pending" }),
        delivery: "queue" as const,
      }
      const pending = yield* SessionInput.admit(db, events, input)
      yield* SessionExecutionOwnership.reserve(db, sessionID, target)
      const before = yield* EventV2.latestSequence(db, sessionID)
      expect(Exit.isFailure(yield* events.remove(sessionID).pipe(Effect.exit))).toBe(true)
      expect(Exit.isFailure(yield* events.claim(sessionID, "late-replay-owner").pipe(Effect.exit))).toBe(true)
      expect(Exit.isFailure(yield* SessionInput.admit(db, events, input).pipe(Effect.exit))).toBe(true)
      expect(
        Exit.isFailure(
          yield* SessionInput.admit(db, events, { ...input, id: SessionMessage.ID.create() }).pipe(Effect.exit),
        ),
      ).toBe(true)
      const messageID = SessionMessage.ID.create()
      const data = { sessionID, messageID, timestamp: yield* DateTime.now, text: "late" }
      expect(Exit.isFailure(yield* events.publish(SessionEvent.ContextUpdated, data).pipe(Effect.exit))).toBe(true)
      expect(
        Exit.isFailure(
          yield* events
            .replay({
              id: EventV2.ID.create(),
              type: EventV2.versionedType(SessionEvent.ContextUpdated.type, 1),
              aggregateID: sessionID,
              seq: before + 1,
              data: { ...data, timestamp: DateTime.toEpochMillis(data.timestamp) },
            })
            .pipe(Effect.exit),
        ),
      ).toBe(true)
      expect(
        Exit.isFailure(
          yield* SessionContextEpoch.initialize(db, Effect.succeed(SystemContext.empty), sessionID).pipe(Effect.exit),
        ),
      ).toBe(true)
      expect(yield* db.select().from(SessionContextEpochTable).get()).toBeUndefined()
      expect(
        yield* db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, messageID)).get(),
      ).toBeUndefined()
      expect(yield* EventV2.latestSequence(db, sessionID)).toBe(before)
      expect(yield* SessionInput.find(db, input.id)).toEqual(pending)
      yield* SessionExecutionOwnership.abort(db, sessionID, target.handoffID)
      expect(yield* SessionInput.admit(db, events, input)).toEqual(pending)
      yield* events.publish(SessionEvent.ContextUpdated, data)
      expect(yield* EventV2.latestSequence(db, sessionID)).toBe(before + 1)
    }),
  )

  it.effect("serializes competing owners and rejects stale release after transfer", () =>
    Effect.gen(function* () {
      const db = yield* setup
      const results = yield* Effect.all(
        ["one", "two"].map((owner) => SessionExecutionOwnership.acquire(db, sessionID, owner).pipe(Effect.exit)),
        { concurrency: "unbounded" },
      )
      expect(results.filter(Exit.isSuccess)).toHaveLength(1)
      expect(results.filter(Exit.isFailure)).toHaveLength(1)
      expect(Exit.findErrorOption(results.find(Exit.isFailure)!).pipe(Option.getOrUndefined)).toBeInstanceOf(
        SessionExecutionOwnership.OwnerConflict,
      )
      const winner = results.find(Exit.isSuccess)!
      const successor = yield* SessionExecutionOwnership.transfer(db, winner.value, "successor")
      yield* SessionExecutionOwnership.release(db, winner.value)
      yield* SessionExecutionOwnership.assertCurrent(db, sessionID).pipe(SessionExecutionOwnership.withLease(successor))
      expect(successor.epoch).toBe(winner.value.epoch + 1)
      expect(
        Exit.findErrorOption(
          yield* SessionExecutionOwnership.transfer(db, winner.value, "late").pipe(Effect.exit),
        ).pipe(Option.getOrUndefined),
      ).toBeInstanceOf(SessionExecutionOwnership.StaleLease)
      yield* SessionExecutionOwnership.assertCurrent(db, sessionID).pipe(SessionExecutionOwnership.withLease(successor))
      yield* SessionExecutionOwnership.release(db, successor)
      const reacquired = yield* SessionExecutionOwnership.acquire(db, sessionID, successor.ownerID)
      expect(reacquired.epoch).toBe(successor.epoch + 1)
      yield* SessionExecutionOwnership.release(db, successor)
      yield* SessionExecutionOwnership.assertCurrent(db, sessionID).pipe(
        SessionExecutionOwnership.withLease(reacquired),
      )
    }),
  )

  it.effect("rejects stale events before projectors and permits independent admission", () =>
    Effect.gen(function* () {
      const db = yield* setup
      const events = yield* EventV2.Service
      const lease = yield* SessionExecutionOwnership.acquire(db, sessionID, "old")
      yield* SessionExecutionOwnership.takeover(db, sessionID, "new")
      const before = yield* EventV2.latestSequence(db, sessionID)
      const messageID = SessionMessage.ID.create()
      const result = yield* events
        .publish(SessionEvent.ContextUpdated, {
          sessionID,
          messageID,
          timestamp: yield* DateTime.now,
          text: "stale",
        })
        .pipe(SessionExecutionOwnership.withLease(lease), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      expect(yield* EventV2.latestSequence(db, sessionID)).toBe(before)
      expect(
        yield* db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, messageID)).get(),
      ).toBeUndefined()
      const admitted = yield* SessionInput.admit(db, events, {
        sessionID,
        id: SessionMessage.ID.create(),
        prompt: Prompt.make({ text: "new input" }),
        delivery: "steer",
      })
      expect(admitted.promotedSeq).toBeUndefined()
    }),
  )

  it.effect("fences direct context initialization and reset", () =>
    Effect.gen(function* () {
      const db = yield* setup
      const lease = yield* SessionExecutionOwnership.acquire(db, sessionID, "old")
      yield* SessionExecutionOwnership.takeover(db, sessionID, "new")
      const context = Effect.succeed(SystemContext.empty)
      expect(
        Exit.isFailure(
          yield* SessionContextEpoch.initialize(db, context, sessionID).pipe(
            SessionExecutionOwnership.withLease(lease),
            Effect.exit,
          ),
        ),
      ).toBe(true)
      yield* db
        .insert(SessionContextEpochTable)
        .values({ session_id: sessionID, baseline: "current", snapshot: {}, baseline_seq: -1 })
        .run()
      expect(
        Exit.isFailure(
          yield* SessionContextEpoch.reset(db, sessionID).pipe(SessionExecutionOwnership.withLease(lease), Effect.exit),
        ),
      ).toBe(true)
      expect(
        (yield* db
          .select()
          .from(SessionContextEpochTable)
          .where(eq(SessionContextEpochTable.session_id, sessionID))
          .get())?.baseline,
      ).toBe("current")
    }),
  )

  it.effect("admits a child input under a parent lease and still fences stale parent work", () =>
    Effect.gen(function* () {
      const db = yield* setup
      const events = yield* EventV2.Service
      const childID = SessionSchema.ID.make("ses_execution_ownership_child")
      yield* db.insert(SessionTable).values({
        id: childID,
        project_id: Project.ID.global,
        slug: "child",
        directory: "/project",
        title: "child",
        version: "test",
        parent_id: sessionID,
      }).run()
      const lease = yield* SessionExecutionOwnership.acquire(db, sessionID, "owner")
      const admitted = yield* SessionInput.admit(db, events, {
        sessionID: childID,
        id: SessionMessage.ID.create(),
        prompt: Prompt.make({ text: "delegated child input" }),
        delivery: "steer",
      }).pipe(SessionExecutionOwnership.withLease(lease))
      expect(admitted.sessionID).toBe(childID)
      yield* SessionExecutionOwnership.takeover(db, sessionID, "new-owner")
      expect(
        Exit.findErrorOption(yield* SessionExecutionOwnership.assertCurrent(db, sessionID).pipe(
          SessionExecutionOwnership.withLease(lease),
          Effect.exit,
        )).pipe(Option.getOrUndefined),
      ).toBeInstanceOf(SessionExecutionOwnership.StaleLease)
    }),
  )
})
