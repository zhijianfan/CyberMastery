import { describe, expect } from "bun:test"
import { DateTime, Effect, Exit, Option } from "effect"
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
import { SessionContextEpochTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SystemContext } from "@opencode-ai/core/system-context"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node])))
const sessionID = SessionSchema.ID.make("ses_execution_ownership")
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
        Exit.findErrorOption(yield* SessionExecutionOwnership.transfer(db, winner.value, "late").pipe(Effect.exit)).pipe(
          Option.getOrUndefined,
        ),
      ).toBeInstanceOf(SessionExecutionOwnership.StaleLease)
      yield* SessionExecutionOwnership.assertCurrent(db, sessionID).pipe(SessionExecutionOwnership.withLease(successor))
      yield* SessionExecutionOwnership.release(db, successor)
      const reacquired = yield* SessionExecutionOwnership.acquire(db, sessionID, successor.ownerID)
      expect(reacquired.epoch).toBe(successor.epoch + 1)
      yield* SessionExecutionOwnership.release(db, successor)
      yield* SessionExecutionOwnership.assertCurrent(db, sessionID).pipe(SessionExecutionOwnership.withLease(reacquired))
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
      expect(yield* db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, messageID)).get()).toBeUndefined()
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

  it.effect("does not allow leased work to bypass the fence with another aggregate", () =>
    Effect.gen(function* () {
      const db = yield* setup
      const lease = yield* SessionExecutionOwnership.acquire(db, sessionID, "owner")
      expect(
        Exit.isFailure(
          yield* SessionExecutionOwnership.assertCurrent(db, "another-session").pipe(
            SessionExecutionOwnership.withLease(lease),
            Effect.exit,
          ),
        ),
      ).toBe(true)
    }),
  )
})
