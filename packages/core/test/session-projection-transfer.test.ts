import { createHash } from "node:crypto"
import { describe, expect } from "bun:test"
import { and, asc, eq } from "drizzle-orm"
import { DateTime, Effect, Exit, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionCompactionContext } from "@opencode-ai/core/session/compaction-context"
import { SessionContextSidecar } from "@opencode-ai/core/session/context-sidecar"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionInputTable, SessionContextEpochTable, SessionMessageTable } from "@opencode-ai/core/session/sql"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionProjectionTransfer } from "@opencode-ai/core/session/projection-transfer"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { testEffect } from "./lib/effect"

const layer = AppNodeBuilder.build(
  LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionProjectionTransfer.node]),
)
const it = testEffect(layer)
const directory = AbsolutePath.make("/projection-transfer")
const workspaceID = WorkspaceV2.ID.make("wrk_projection_transfer")

const canonical = (value: unknown): string =>
  JSON.stringify(
    Array.isArray(value)
      ? value.map((item) => JSON.parse(canonical(item)))
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, item]) => [key, JSON.parse(canonical(item))]),
          )
        : value,
  )

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`

const insertProject = (db: Database.Interface["db"]) =>
  db
    .insert(ProjectTable)
    .values({ id: ProjectV2.ID.global, worktree: directory, sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)

const createSession = Effect.fnUntraced(function* (
  db: Database.Interface["db"],
  events: EventV2.Interface,
  sessionID: SessionV2.ID,
) {
  yield* insertProject(db)
  const location = Location.Ref.make({ directory, workspaceID })
  yield* events.publish(
    SessionV1.Event.Created,
    {
      sessionID,
      info: SessionV1.SessionInfo.make({
        id: sessionID,
        projectID: ProjectV2.ID.global,
        workspaceID,
        slug: "transfer",
        directory,
        title: "Transfer",
        version: "test",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 1 },
      }),
    },
    { location },
  )
})

const admitV2 = Effect.fnUntraced(function* (
  db: Database.Interface["db"],
  events: EventV2.Interface,
  sessionID: SessionV2.ID,
  messageID: SessionMessage.ID,
  text: string,
) {
  const snapshot = yield* SessionContextSidecar.renderContextSidecar({
    promptText: text,
    attachments: [],
    recall: { policy: "operating-chat-v1", status: "no-match" },
    budget: {
      maximumBytes: 32_768,
      maximumEstimatedTokens: 8_192,
    },
    createdAt: 2,
  })
  yield* events.publish(
    SessionEvent.PromptAdmitted,
    {
      sessionID,
      messageID,
      timestamp: DateTime.makeUnsafe(2),
      prompt: { text },
      delivery: "steer",
      modelContextVersion: 2,
    },
    {
      commit: () =>
        db
          .update(SessionInputTable)
          .set({ context_snapshot_json: snapshot })
          .where(eq(SessionInputTable.id, messageID))
          .run()
          .pipe(Effect.orDie, Effect.asVoid),
    },
  )
  return snapshot
})

const promote = (events: EventV2.Interface, sessionID: SessionV2.ID, messageID: SessionMessage.ID, text: string) =>
  events.publish(SessionEvent.Prompted, {
    sessionID,
    messageID,
    timestamp: DateTime.makeUnsafe(2),
    prompt: { text },
    delivery: "steer",
  })

const compact = Effect.fnUntraced(function* (
  db: Database.Interface["db"],
  events: EventV2.Interface,
  sessionID: SessionV2.ID,
  messageID: SessionMessage.ID,
) {
  const context = SessionCompactionContext.make({ summary: "private summary", recent: "private recent", createdAt: 4 })
  yield* events.publish(
    SessionEvent.Compaction.Ended,
    {
      sessionID,
      messageID,
      timestamp: DateTime.makeUnsafe(4),
      reason: "auto",
      text: SessionCompactionContext.SENTINEL,
      recent: "clean recent",
    },
    { commit: (seq) => SessionCompactionContext.commit(db, { sessionID, messageID, seq, context }) },
  )
  return context
})

const insertEpoch = (
  db: Database.Interface["db"],
  sessionID: SessionV2.ID,
  baselineSeq: number,
  baseline = "private baseline",
) =>
  db
    .insert(SessionContextEpochTable)
    .values({ session_id: sessionID, baseline, snapshot: {}, baseline_seq: baselineSeq })
    .run()
    .pipe(Effect.orDie)

const freshTarget = <A, E, R>(
  effect: Effect.Effect<A, E, R | SessionProjectionTransfer.Service | Database.Service | EventV2.Service>,
) =>
  effect.pipe(
    Effect.provide(
      Layer.fresh(
        AppNodeBuilder.build(
          LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionProjectionTransfer.node]),
          [[Database.node, Database.layerFromPath(":memory:")]],
        ),
      ),
    ),
  )

const exportComplete = Effect.fnUntraced(function* (sessionID: SessionV2.ID) {
  const { db } = yield* Database.Service
  const events = yield* EventV2.Service
  const transfer = yield* SessionProjectionTransfer.Service
  const inputID = SessionMessage.ID.make(`msg_input_${sessionID}`)
  const compactionID = SessionMessage.ID.make(`msg_compaction_${sessionID}`)
  yield* createSession(db, events, sessionID)
  const input = yield* admitV2(db, events, sessionID, inputID, "clean prompt")
  yield* promote(events, sessionID, inputID, "clean prompt")
  const compaction = yield* compact(db, events, sessionID, compactionID)
  yield* insertEpoch(db, sessionID, yield* EventV2.latestSequence(db, sessionID))
  return { bundle: yield* transfer.export({ sessionID }), inputID, compactionID, input, compaction }
})

describe("SessionProjectionTransfer", () => {
  it.effect("exports and atomically restores exact input, compaction, and epoch private state", () =>
    Effect.gen(function* () {
      const source = yield* exportComplete(SessionV2.ID.make("ses_transfer_cycle"))

      expect(source.bundle.version).toBe(1)
      expect(source.bundle.contexts.map((item) => item.kind)).toEqual(["input", "compaction"])
      expect(source.bundle.epoch).toMatchObject({ kind: "context-epoch", baselineSeq: 3, sourceSeq: 3 })
      expect(JSON.stringify(source.bundle.events)).not.toContain("private summary")
      expect(JSON.stringify(source.bundle.events)).not.toContain("private baseline")

      yield* freshTarget(
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          const transfer = yield* SessionProjectionTransfer.Service
          yield* insertProject(db)
          yield* transfer.restoreBatch({ bundle: source.bundle })

          expect(
            (yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, source.inputID)).get())
              ?.context_snapshot_json,
          ).toEqual(source.input)
          const compactionRow = yield* db
            .select({ context: SessionMessageTable.model_context_json })
            .from(SessionMessageTable)
            .where(eq(SessionMessageTable.id, source.compactionID))
            .get()
            .pipe(Effect.orDie)
          expect(yield* SessionCompactionContext.decode(compactionRow?.context, source.compactionID)).toEqual(
            source.compaction,
          )
          expect(
            yield* db
              .select()
              .from(SessionContextEpochTable)
              .where(eq(SessionContextEpochTable.session_id, source.bundle.aggregateID))
              .get(),
          ).toMatchObject({ baseline: "private baseline", snapshot: {}, baseline_seq: 3 })
        }),
      )
    }),
  )

  it.effect("rejects strict outer identity and hash tampering before the first write", () =>
    Effect.gen(function* () {
      const source = yield* exportComplete(SessionV2.ID.make("ses_transfer_outer_validation"))
      const original = source.bundle.contexts[0]!
      const mutations = [
        { ...original, eventID: EventV2.ID.create() },
        { ...original, aggregateID: SessionV2.ID.make("ses_wrong") },
        { ...original, seq: original.seq + 1 },
        { ...original, eventType: EventV2.versionedType(SessionEvent.Prompted.type, 1) },
        { ...original, eventDataHash: "sha256:wrong" },
        { ...original, messageID: SessionMessage.ID.make("msg_wrong") },
        { ...original, contentHash: "sha256:wrong" },
        { ...original, sidecarSchemaVersion: 99 },
      ]

      for (const mutation of mutations) {
        yield* freshTarget(
          Effect.gen(function* () {
            const { db } = yield* Database.Service
            const transfer = yield* SessionProjectionTransfer.Service
            yield* insertProject(db)
            const exit = yield* transfer
              .restoreBatch({ bundle: { ...source.bundle, contexts: [mutation, ...source.bundle.contexts.slice(1)] } })
              .pipe(Effect.exit)
            expect(Exit.isFailure(exit)).toBe(true)
            expect(yield* db.select().from(EventTable).all()).toEqual([])
          }),
        )
      }
    }),
  )

  it.effect("reruns the strict inner decoder after an attacker recomputes the outer payload hash", () =>
    Effect.gen(function* () {
      const source = yield* exportComplete(SessionV2.ID.make("ses_transfer_inner_validation"))
      const input = source.bundle.contexts.find((item) => item.kind === "input")!
      const parsed = JSON.parse(input.payload) as Record<string, unknown>
      parsed.attachments = [
        { selection: "automatic", sourceCtxPackID: "forged", label: "forged", contentHash: "forged" },
      ]
      const payload = canonical(parsed)
      const tampered = { ...input, payload, contentHash: hash(payload) }

      const exit = yield* SessionProjectionTransfer.Service.use((transfer) =>
        transfer.restoreBatch({
          bundle: {
            ...source.bundle,
            contexts: source.bundle.contexts.map((item) => (item === input ? tampered : item)),
          },
        }),
      ).pipe(Effect.exit)

      expect(String(exit)).toContain("SessionProjectionTransfer.Invalid")
    }),
  )

  it.effect("rejects an incomplete required-private manifest before the first projector", () =>
    Effect.gen(function* () {
      const source = yield* exportComplete(SessionV2.ID.make("ses_transfer_incomplete"))
      const incomplete = {
        ...source.bundle,
        contexts: source.bundle.contexts.filter((context) => context.kind !== "input"),
      }

      yield* freshTarget(
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          const events = yield* EventV2.Service
          const transfer = yield* SessionProjectionTransfer.Service
          const projected: number[] = []
          yield* insertProject(db)
          yield* events.project(SessionEvent.PromptAdmitted, (event) =>
            Effect.sync(() => projected.push(event.durable!.seq)),
          )

          const exit = yield* transfer.restoreBatch({ bundle: incomplete }).pipe(Effect.exit)

          expect(String(exit)).toContain("SessionProjectionTransfer.Invalid")
          expect(projected).toEqual([])
          expect(yield* db.select().from(EventTable).all()).toEqual([])
        }),
      )
    }),
  )

  it.effect("repairs missing sidecars for exact events only while their projected targets still exist", () =>
    Effect.gen(function* () {
      const source = yield* exportComplete(SessionV2.ID.make("ses_transfer_repair"))
      yield* freshTarget(
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          const transfer = yield* SessionProjectionTransfer.Service
          yield* insertProject(db)
          yield* transfer.restoreBatch({ bundle: source.bundle })
          yield* db
            .update(SessionInputTable)
            .set({ context_snapshot_json: { state: "pending", version: 2 } })
            .where(eq(SessionInputTable.id, source.inputID))
            .run()
            .pipe(Effect.orDie)
          yield* db
            .update(SessionMessageTable)
            .set({ model_context_json: null })
            .where(eq(SessionMessageTable.id, source.compactionID))
            .run()
            .pipe(Effect.orDie)

          yield* transfer.restoreBatch({ bundle: source.bundle })
          expect(
            (yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, source.inputID)).get())
              ?.context_snapshot_json,
          ).toEqual(source.input)
          const compactionRow = yield* db
            .select({ context: SessionMessageTable.model_context_json })
            .from(SessionMessageTable)
            .where(eq(SessionMessageTable.id, source.compactionID))
            .get()
            .pipe(Effect.orDie)
          expect(yield* SessionCompactionContext.decode(compactionRow?.context, source.compactionID)).toEqual(
            source.compaction,
          )

          yield* db.delete(SessionInputTable).where(eq(SessionInputTable.id, source.inputID)).run().pipe(Effect.orDie)
          const exit = yield* transfer.restoreBatch({ bundle: source.bundle }).pipe(Effect.exit)
          expect(String(exit)).toContain("SessionProjectionTransfer.ProjectionDefect")
          expect(
            yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, source.inputID)).get(),
          ).toBeUndefined()
        }),
      )
    }),
  )

  it.effect("rejects a conflicting exact-event sidecar without changing it", () =>
    Effect.gen(function* () {
      const source = yield* exportComplete(SessionV2.ID.make("ses_transfer_conflict"))
      yield* freshTarget(
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          const transfer = yield* SessionProjectionTransfer.Service
          yield* insertProject(db)
          yield* transfer.restoreBatch({ bundle: source.bundle })
          const conflicting = yield* SessionContextSidecar.renderContextSidecar({
            promptText: "clean prompt",
            attachments: [],
            recall: { policy: "operating-chat-v1", status: "unavailable" },
            budget: {
              maximumBytes: 32_768,
              maximumEstimatedTokens: 8_192,
            },
            createdAt: 99,
          })
          yield* db
            .update(SessionInputTable)
            .set({ context_snapshot_json: conflicting })
            .where(eq(SessionInputTable.id, source.inputID))
            .run()
            .pipe(Effect.orDie)

          const exit = yield* transfer.restoreBatch({ bundle: source.bundle }).pipe(Effect.exit)
          expect(String(exit)).toContain("SessionProjectionTransfer.Conflict")
          expect(
            (yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, source.inputID)).get())
              ?.context_snapshot_json,
          ).toEqual(conflicting)
        }),
      )
    }),
  )

  it.effect("returns a typed event conflict for divergent exact public history", () =>
    Effect.gen(function* () {
      const source = yield* exportComplete(SessionV2.ID.make("ses_transfer_event_conflict"))
      yield* freshTarget(
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          const transfer = yield* SessionProjectionTransfer.Service
          yield* insertProject(db)
          yield* transfer.restoreBatch({ bundle: source.bundle })
          const created = source.bundle.events[0]!
          const changed = {
            ...created,
            data: {
              ...created.data,
              info: { ...(created.data.info as Record<string, unknown>), title: "Divergent" },
            },
          }

          const exit = yield* transfer
            .restoreBatch({ bundle: { ...source.bundle, events: [changed, ...source.bundle.events.slice(1)] } })
            .pipe(Effect.exit)

          expect(String(exit)).toContain("SessionProjectionTransfer.Conflict")
        }),
      )
    }),
  )

  it.effect("exports and restores a content-free proof for a reverted V2 input", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const transfer = yield* SessionProjectionTransfer.Service
      const sessionID = SessionV2.ID.make("ses_transfer_reverted_input")
      const boundaryID = SessionMessage.ID.make("msg_boundary_input")
      const inputID = SessionMessage.ID.make("msg_reverted_input")
      yield* createSession(db, events, sessionID)
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID,
        messageID: boundaryID,
        timestamp: DateTime.makeUnsafe(2),
        text: "boundary",
      })
      yield* admitV2(db, events, sessionID, inputID, "deleted prompt")
      yield* promote(events, sessionID, inputID, "deleted prompt")
      yield* events.publish(SessionEvent.RevertEvent.Committed, {
        sessionID,
        messageID: boundaryID,
        timestamp: DateTime.makeUnsafe(5),
      })

      const bundle = yield* transfer.export({ sessionID })
      expect(bundle.contexts).toEqual([])
      expect(bundle.deletions).toHaveLength(1)
      expect(bundle.deletions[0]).toMatchObject({
        kind: "reverted-target",
        targetMessageID: inputID,
        targetKind: "input",
        deletionCause: "input-admitted-seq",
      })
      expect(JSON.stringify(bundle.deletions)).not.toContain("deleted prompt")

      yield* freshTarget(
        Effect.gen(function* () {
          const targetDb = (yield* Database.Service).db
          const targetTransfer = yield* SessionProjectionTransfer.Service
          yield* insertProject(targetDb)
          yield* targetTransfer.restoreBatch({ bundle })
          expect(
            yield* targetDb.select().from(SessionInputTable).where(eq(SessionInputTable.id, inputID)).get(),
          ).toBeUndefined()
          expect(
            yield* targetDb.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, inputID)).get(),
          ).toBeUndefined()
        }),
      )
    }),
  )

  it.effect(
    "uses ordinary projector deletion for a new compaction revert and defects on a resurrected retained target",
    () =>
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        const events = yield* EventV2.Service
        const transfer = yield* SessionProjectionTransfer.Service
        const sessionID = SessionV2.ID.make("ses_transfer_reverted_compaction")
        const boundaryID = SessionMessage.ID.make("msg_boundary_compaction")
        const compactionID = SessionMessage.ID.make("msg_reverted_compaction")
        yield* createSession(db, events, sessionID)
        yield* events.publish(SessionEvent.Synthetic, {
          sessionID,
          messageID: boundaryID,
          timestamp: DateTime.makeUnsafe(2),
          text: "boundary",
        })
        yield* compact(db, events, sessionID, compactionID)
        const beforeRevert = yield* transfer.export({ sessionID })
        yield* events.publish(SessionEvent.RevertEvent.Committed, {
          sessionID,
          messageID: boundaryID,
          timestamp: DateTime.makeUnsafe(5),
        })
        const afterRevert = yield* transfer.export({ sessionID })

        expect(afterRevert.contexts).toEqual([])
        expect(afterRevert.deletions).toMatchObject([
          {
            targetMessageID: compactionID,
            targetKind: "compaction",
            deletionCause: "message-seq",
          },
        ])
        expect(JSON.stringify(afterRevert.deletions)).not.toContain("private summary")

        yield* freshTarget(
          Effect.gen(function* () {
            const targetDb = (yield* Database.Service).db
            const targetTransfer = yield* SessionProjectionTransfer.Service
            yield* insertProject(targetDb)
            yield* targetTransfer.restoreBatch({ bundle: beforeRevert })
            const projected = yield* targetDb
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.id, compactionID))
              .get()
              .pipe(Effect.orDie)
            expect(projected).toBeDefined()

            yield* targetTransfer.restoreBatch({ bundle: afterRevert })
            expect(
              yield* targetDb.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, compactionID)).get(),
            ).toBeUndefined()
            yield* targetTransfer.restoreBatch({ bundle: afterRevert })

            yield* targetDb.insert(SessionMessageTable).values(projected!).run().pipe(Effect.orDie)
            const exit = yield* targetTransfer.restoreBatch({ bundle: afterRevert }).pipe(Effect.exit)
            expect(String(exit)).toContain("SessionProjectionTransfer.ProjectionDefect")
            expect(
              yield* targetDb.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, compactionID)).get(),
            ).toBeDefined()
          }),
        )
      }),
  )

  it.effect("rejects forged target, deleting, boundary, and event-hash fields in a deletion proof", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const transfer = yield* SessionProjectionTransfer.Service
      const sessionID = SessionV2.ID.make("ses_transfer_deletion_tamper")
      const boundaryID = SessionMessage.ID.make("msg_boundary_tamper")
      const inputID = SessionMessage.ID.make("msg_input_tamper")
      yield* createSession(db, events, sessionID)
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID,
        messageID: boundaryID,
        timestamp: DateTime.makeUnsafe(2),
        text: "boundary",
      })
      yield* admitV2(db, events, sessionID, inputID, "tamper target")
      yield* events.publish(SessionEvent.RevertEvent.Committed, {
        sessionID,
        messageID: boundaryID,
        timestamp: DateTime.makeUnsafe(4),
      })
      const bundle = yield* transfer.export({ sessionID })
      const proof = bundle.deletions[0]!
      const mutations = [
        { ...proof, targetMessageID: SessionMessage.ID.make("msg_wrong_target") },
        { ...proof, targetEvent: { ...proof.targetEvent, eventID: EventV2.ID.create() } },
        { ...proof, targetEvent: { ...proof.targetEvent, eventDataHash: "sha256:changed" } },
        { ...proof, deletingEvent: { ...proof.deletingEvent, seq: proof.deletingEvent.seq - 1 } },
        { ...proof, deletingEvent: { ...proof.deletingEvent, eventDataHash: "sha256:changed" } },
        { ...proof, boundaryMessageID: SessionMessage.ID.make("msg_wrong_boundary") },
        { ...proof, boundaryEvent: { ...proof.boundaryEvent, eventID: EventV2.ID.create() } },
      ]

      for (const mutation of mutations) {
        const exit = yield* transfer.restoreBatch({ bundle: { ...bundle, deletions: [mutation] } }).pipe(Effect.exit)
        expect(String(exit)).toContain("SessionProjectionTransfer.Invalid")
      }
    }),
  )

  it.effect("requires the exact promotion proof when admission precedes the revert boundary", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const transfer = yield* SessionProjectionTransfer.Service
      const sessionID = SessionV2.ID.make("ses_transfer_reverted_promotion")
      const inputID = SessionMessage.ID.make("msg_reverted_promotion")
      const boundaryID = SessionMessage.ID.make("msg_boundary_promotion")
      const otherID = SessionMessage.ID.make("msg_other_promotion")
      yield* createSession(db, events, sessionID)
      yield* admitV2(db, events, sessionID, inputID, "promoted late")
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID,
        messageID: boundaryID,
        timestamp: DateTime.makeUnsafe(3),
        text: "boundary",
      })
      yield* promote(events, sessionID, otherID, "other prompt")
      yield* promote(events, sessionID, inputID, "promoted late")
      yield* events.publish(SessionEvent.RevertEvent.Committed, {
        sessionID,
        messageID: boundaryID,
        timestamp: DateTime.makeUnsafe(5),
      })
      const bundle = yield* transfer.export({ sessionID })
      const deletion = bundle.deletions[0]!

      expect(deletion).toMatchObject({ deletionCause: "input-promoted-seq", targetMessageID: inputID })
      expect(deletion.promotionEvent).toBeDefined()
      const missingExit = yield* transfer
        .restoreBatch({ bundle: { ...bundle, deletions: [{ ...deletion, promotionEvent: undefined }] } })
        .pipe(Effect.exit)
      expect(String(missingExit)).toContain("SessionProjectionTransfer.Invalid")
      const wrongPromotion = bundle.events.find(
        (event) =>
          event.type === EventV2.versionedType(SessionEvent.Prompted.type, 1) && event.data.messageID === otherID,
      )!
      const wrongPromotionIdentity = {
        eventID: wrongPromotion.id,
        aggregateID: wrongPromotion.aggregateID,
        seq: wrongPromotion.seq,
        eventType: wrongPromotion.type,
        eventDataHash: hash(canonical(wrongPromotion.data)),
      }
      const wrongExit = yield* transfer
        .restoreBatch({ bundle: { ...bundle, deletions: [{ ...deletion, promotionEvent: wrongPromotionIdentity }] } })
        .pipe(Effect.exit)
      expect(String(wrongExit)).toContain("SessionProjectionTransfer.Invalid")
    }),
  )

  it.effect("fails export and restore when a retained revert still has its deleted target projected", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const transfer = yield* SessionProjectionTransfer.Service
      const sessionID = SessionV2.ID.make("ses_transfer_revert_inverse")
      const boundaryID = SessionMessage.ID.make("msg_boundary_inverse")
      const inputID = SessionMessage.ID.make("msg_inverse_input")
      yield* createSession(db, events, sessionID)
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID,
        messageID: boundaryID,
        timestamp: DateTime.makeUnsafe(2),
        text: "boundary",
      })
      const snapshot = yield* admitV2(db, events, sessionID, inputID, "inverse")
      yield* events.publish(SessionEvent.RevertEvent.Committed, {
        sessionID,
        messageID: boundaryID,
        timestamp: DateTime.makeUnsafe(4),
      })
      yield* db
        .insert(SessionInputTable)
        .values({
          id: inputID,
          session_id: sessionID,
          prompt: { text: "inverse" },
          delivery: "steer",
          admitted_seq: 2,
          context_snapshot_json: snapshot,
          time_created: 3,
        })
        .run()
        .pipe(Effect.orDie)

      const exit = yield* transfer.export({ sessionID }).pipe(Effect.exit)
      expect(String(exit)).toContain("SessionProjectionTransfer.ProjectionDefect")
    }),
  )

  it.effect("restores missing and identical epochs but fences divergent replacements", () =>
    Effect.gen(function* () {
      const source = yield* exportComplete(SessionV2.ID.make("ses_transfer_epoch_fence"))
      yield* freshTarget(
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          const events = yield* EventV2.Service
          const transfer = yield* SessionProjectionTransfer.Service
          yield* insertProject(db)
          yield* transfer.restoreBatch({ bundle: source.bundle })
          yield* transfer.restoreBatch({ bundle: source.bundle })
          yield* db
            .update(SessionContextEpochTable)
            .set({ baseline: "local divergence" })
            .where(eq(SessionContextEpochTable.session_id, source.bundle.aggregateID))
            .run()
            .pipe(Effect.orDie)
          expect(String(yield* transfer.restoreBatch({ bundle: source.bundle }).pipe(Effect.exit))).toContain(
            "SessionProjectionTransfer.Conflict",
          )

          yield* events.claim(source.bundle.aggregateID, "owner-a")
          expect(
            String(
              yield* transfer
                .restoreBatch({
                  bundle: source.bundle,
                  expectedWorkspaceID: workspaceID,
                  expectedOwnerID: "owner-b",
                })
                .pipe(Effect.exit),
            ),
          ).toContain("SessionProjectionTransfer.Conflict")
          yield* transfer.restoreBatch({
            bundle: source.bundle,
            expectedWorkspaceID: workspaceID,
            expectedOwnerID: "owner-a",
          })
          expect(
            yield* db
              .select({ baseline: SessionContextEpochTable.baseline })
              .from(SessionContextEpochTable)
              .where(eq(SessionContextEpochTable.session_id, source.bundle.aggregateID))
              .get(),
          ).toEqual({ baseline: "private baseline" })

          yield* events.publish(SessionEvent.ContextUpdated, {
            sessionID: source.bundle.aggregateID,
            messageID: SessionMessage.ID.make("msg_local_advance"),
            timestamp: DateTime.makeUnsafe(10),
            text: "local",
          })
          yield* db
            .update(SessionContextEpochTable)
            .set({ baseline: "new local divergence" })
            .where(eq(SessionContextEpochTable.session_id, source.bundle.aggregateID))
            .run()
            .pipe(Effect.orDie)
          expect(
            String(
              yield* transfer
                .restoreBatch({ bundle: source.bundle, expectedWorkspaceID: workspaceID, expectedOwnerID: "owner-a" })
                .pipe(Effect.exit),
            ),
          ).toContain("SessionProjectionTransfer.Conflict")
        }),
      )
    }),
  )

  it.effect("reports transfer required from private rows or retained public requiredness events", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const transfer = yield* SessionProjectionTransfer.Service
      const cleanID = SessionV2.ID.make("ses_transfer_required_clean")
      yield* createSession(db, events, cleanID)
      expect(yield* transfer.required({ workspaceID })).toBe(false)

      const requiredID = SessionV2.ID.make("ses_transfer_required_reverted")
      const boundaryID = SessionMessage.ID.make("msg_required_boundary")
      const inputID = SessionMessage.ID.make("msg_required_input")
      yield* createSession(db, events, requiredID)
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID: requiredID,
        messageID: boundaryID,
        timestamp: DateTime.makeUnsafe(2),
        text: "boundary",
      })
      yield* admitV2(db, events, requiredID, inputID, "required")
      yield* events.publish(SessionEvent.RevertEvent.Committed, {
        sessionID: requiredID,
        messageID: boundaryID,
        timestamp: DateTime.makeUnsafe(4),
      })

      expect(yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, inputID)).get()).toBeUndefined()
      expect(yield* transfer.required({ workspaceID })).toBe(true)
      expect(yield* transfer.required({ workspaceID: WorkspaceV2.ID.make("wrk_other") })).toBe(false)
    }),
  )

  it.effect("fails closed when plain EventV2 replay leaves required input or compaction markers unresolved", () =>
    Effect.gen(function* () {
      const source = yield* exportComplete(SessionV2.ID.make("ses_transfer_plain_replay"))
      yield* freshTarget(
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          const events = yield* EventV2.Service
          const transfer = yield* SessionProjectionTransfer.Service
          yield* insertProject(db)
          yield* events.replayAll(source.bundle.events)
          const exit = yield* transfer.export({ sessionID: source.bundle.aggregateID }).pipe(Effect.exit)
          expect(String(exit)).toContain("SessionProjectionTransfer.ProjectionDefect")
          expect(
            yield* db
              .select({ context: SessionInputTable.context_snapshot_json })
              .from(SessionInputTable)
              .where(eq(SessionInputTable.id, source.inputID))
              .get(),
          ).toEqual({ context: { state: "pending", version: 2 } })
          expect(
            yield* db
              .select({ context: SessionMessageTable.model_context_json })
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.id, source.compactionID))
              .get(),
          ).toEqual({ context: null })
        }),
      )
    }),
  )
})
