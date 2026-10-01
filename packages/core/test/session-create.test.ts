import { describe, expect } from "bun:test"
import path from "path"
import { DateTime, Effect, Exit, Layer, Stream } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { asc, eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { SessionSharePendingTable, SessionShareTable } from "@opencode-ai/core/share/sql"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionOwnership } from "@opencode-ai/core/session/execution/ownership"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionHistory } from "@opencode-ai/core/session/history"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionContextEpochTable, SessionDeletionTable, SessionExecutionTable, SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { testEffect } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const id = SessionV2.ID.create()

describe("SessionV2.create", () => {
  it.effect("removes only a prepared and host-cleaned native lineage, retaining replay tombstones", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const root = yield* session.create({ location })
      const child = yield* session.create({ location })
      const other = yield* session.create({ location })
      yield* db.update(SessionTable).set({ parent_id: root.id }).where(eq(SessionTable.id, child.id)).run()
      const input = { sessionID: root.id, authorizedIDs: [root.id, child.id] }
      const fence = yield* session.prepareDeleteLineage(input)
      const hostCleanup = { completed: "host-cleanup-complete" as const, fence }
      const event = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, root.id)).get()

      yield* db.insert(SessionSharePendingTable).values({ session_id: child.id, time_created: Date.now() }).run()
      expect(yield* session.finalizeDeleteLineage({ ...input, hostCleanup }).pipe(Effect.flip))
        .toEqual(new SessionV2.SharedSessionError({ sessionID: child.id }))
      yield* db.delete(SessionSharePendingTable).where(eq(SessionSharePendingTable.session_id, child.id)).run()
      yield* db.update(SessionTable).set({ share_url: "https://example.test/legacy" })
        .where(eq(SessionTable.id, child.id)).run()
      expect(yield* session.finalizeDeleteLineage({ ...input, hostCleanup }).pipe(Effect.flip))
        .toEqual(new SessionV2.SharedSessionError({ sessionID: child.id }))
      yield* db.update(SessionTable).set({ share_url: null }).where(eq(SessionTable.id, child.id)).run()
      expect(yield* session.finalizeDeleteLineage({ ...input, hostCleanup: {
        ...hostCleanup, fence: { ...fence, sessions: fence.sessions.map((item) => ({ ...item, seq: item.seq + 1 })) },
      } }).pipe(Effect.flip)).toEqual(new SessionV2.DeletionFenceChangedError({ sessionID: root.id }))
      expect((yield* db.select().from(SessionTable).all()).map((row) => row.id).sort())
        .toEqual([root.id, child.id, other.id].sort())

      yield* session.finalizeDeleteLineage({ ...input, hostCleanup })
      expect((yield* db.select().from(SessionTable).all()).map((row) => row.id)).toEqual([other.id])
      expect((yield* db.select().from(SessionDeletionTable).all()).map((row) => row.session_id).sort())
        .toEqual([root.id, child.id].sort())
      expect(yield* db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, root.id)).all())
        .toEqual([])
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, root.id)).all()).toEqual([])
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, child.id)).all()).toEqual([])
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, other.id)).all()).toHaveLength(1)
      if (event) yield* events.replay({
        id: event.id, type: event.type, seq: event.seq, aggregateID: event.aggregate_id, data: event.data,
      })
      expect(yield* db.select().from(SessionTable).where(eq(SessionTable.id, root.id)).get()).toBeUndefined()
    }),
  )

  it.effect("revokes exact local replay claims after fencing before native deletion", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const root = yield* session.create({ location })
      const child = yield* session.create({ location })
      yield* db.update(SessionTable).set({ parent_id: root.id }).where(eq(SessionTable.id, child.id)).run()
      yield* events.claim(root.id, "workspace-a")
      yield* events.claim(child.id, "workspace-b")
      const input = { sessionID: root.id, authorizedIDs: [root.id, child.id] }
      const fence = yield* session.prepareDeleteLineage(input)
      const hostCleanup = { completed: "host-cleanup-complete" as const, fence }
      expect(yield* session.finalizeDeleteLineage({ ...input, hostCleanup }).pipe(Effect.flip))
        .toEqual(new SessionV2.DeletionFenceChangedError({ sessionID: root.id }))
      expect(yield* session.revokeDeleteLineageReplayClaims({ ...input, fence, expectedOwners: [
        { id: root.id, ownerID: "workspace-a" }, { id: child.id, ownerID: "wrong" },
      ] }).pipe(Effect.flip)).toEqual(new SessionV2.DeletionFenceChangedError({ sessionID: root.id }))
      expect(yield* db.select({ ownerID: EventSequenceTable.owner_id }).from(EventSequenceTable)
        .where(eq(EventSequenceTable.aggregate_id, child.id)).get()).toEqual({ ownerID: "workspace-b" })
      const claims = { ...input, fence, expectedOwners: [
        { id: root.id, ownerID: "workspace-a" }, { id: child.id, ownerID: "workspace-b" },
      ] }
      yield* session.revokeDeleteLineageReplayClaims(claims)
      yield* session.revokeDeleteLineageReplayClaims(claims)
      expect(Exit.isFailure(yield* events.claim(root.id, "new-owner").pipe(Effect.exit))).toBe(true)
      expect(Exit.isFailure(yield* events.remove(root.id).pipe(Effect.exit))).toBe(true)
      yield* session.finalizeDeleteLineage({ ...input, hostCleanup })
      expect(yield* db.select().from(SessionTable).where(eq(SessionTable.id, root.id)).get()).toBeUndefined()
    }),
  )

  it.effect("refuses native deletion when a fenced event sequence advances or has an unexpected replay owner", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const db = (yield* Database.Service).db
      const root = yield* session.create({ location })
      const input = { sessionID: root.id, authorizedIDs: [root.id] }
      const fence = yield* session.prepareDeleteLineage(input)
      const hostCleanup = { completed: "host-cleanup-complete" as const, fence }
      yield* db.update(EventSequenceTable).set({ seq: fence.sessions[0]!.seq + 1 })
        .where(eq(EventSequenceTable.aggregate_id, root.id)).run()
      expect(yield* session.finalizeDeleteLineage({ ...input, hostCleanup }).pipe(Effect.flip))
        .toEqual(new SessionV2.DeletionFenceChangedError({ sessionID: root.id }))
      yield* db.update(EventSequenceTable).set({ seq: fence.sessions[0]!.seq, owner_id: "remote" })
        .where(eq(EventSequenceTable.aggregate_id, root.id)).run()
      expect(yield* session.finalizeDeleteLineage({ ...input, hostCleanup }).pipe(Effect.flip))
        .toEqual(new SessionV2.DeletionFenceChangedError({ sessionID: root.id }))
      yield* db.update(EventSequenceTable).set({ owner_id: null })
        .where(eq(EventSequenceTable.aggregate_id, root.id)).run()
      yield* db.insert(SessionExecutionTable).values({ session_id: root.id, epoch: 1, handoff_id: "stale" }).run()
      expect(yield* session.finalizeDeleteLineage({ ...input, hostCleanup }).pipe(Effect.flip))
        .toEqual(new SessionV2.ExecutionStillOwnedError({ sessionID: root.id }))
      yield* db.delete(SessionExecutionTable).where(eq(SessionExecutionTable.session_id, root.id)).run()
      expect(yield* db.select().from(SessionTable).where(eq(SessionTable.id, root.id)).get()).toBeDefined()
    }),
  )

  it.effect("keeps an older fence without a sequence out of the native deletion path", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const db = (yield* Database.Service).db
      const root = yield* session.create({ location })
      yield* db.insert(SessionDeletionTable).values({ session_id: root.id, time_created: Date.now() }).run()
      const input = { sessionID: root.id, authorizedIDs: [root.id] }
      expect(yield* session.prepareDeleteLineage(input).pipe(Effect.flip))
        .toEqual(new SessionV2.DeletionFenceChangedError({ sessionID: root.id }))
      expect(yield* db.select().from(SessionTable).where(eq(SessionTable.id, root.id)).get()).toBeDefined()
    }),
  )

  it.effect("reads a complete lineage snapshot without changing its Sessions", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const db = (yield* Database.Service).db
      const root = yield* session.create({ location })
      const child = yield* session.create({ location: Location.Ref.make({ directory: AbsolutePath.make("/other") }) })
      const grandchild = yield* session.create({ location })
      const unrelated = yield* session.create({ location })
      yield* db.update(SessionTable).set({ parent_id: root.id }).where(eq(SessionTable.id, child.id)).run().pipe(Effect.orDie)
      yield* db.update(SessionTable).set({ parent_id: child.id }).where(eq(SessionTable.id, grandchild.id)).run().pipe(Effect.orDie)

      expect((yield* session.lineage(root.id)).map((item) => item.id)).toEqual([root.id, child.id, grandchild.id])
      expect((yield* session.lineage(child.id)).map((item) => item.id)).toEqual([child.id, grandchild.id])
      expect(yield* Effect.flip(session.lineage(SessionV2.ID.create()))).toBeInstanceOf(SessionV2.NotFoundError)
      expect(yield* session.get(unrelated.id)).toEqual(unrelated)
      expect(yield* session.list()).toHaveLength(4)
    }),
  )

  it.effect("prepares only the exact authorized lineage and retains unrelated Sessions", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const db = (yield* Database.Service).db
      const root = yield* session.create({ location })
      const child = yield* session.create({ location })
      const other = yield* session.create({ location })
      yield* db.update(SessionTable).set({ parent_id: root.id }).where(eq(SessionTable.id, child.id)).run()

      expect(yield* session.prepareDeleteLineage({ sessionID: root.id, authorizedIDs: [root.id] }).pipe(Effect.flip))
        .toEqual(new SessionV2.LineageChangedError({ sessionID: root.id }))
      expect(yield* db.select().from(SessionDeletionTable).all()).toEqual([])

      yield* session.prepareDeleteLineage({ sessionID: root.id, authorizedIDs: [child.id, root.id] })
      yield* session.prepareDeleteLineage({ sessionID: root.id, authorizedIDs: [root.id, child.id] })
      expect((yield* db.select().from(SessionDeletionTable).all()).map((row) => row.session_id).sort())
        .toEqual([root.id, child.id].sort())
      expect((yield* session.list()).map((row) => row.id).sort()).toEqual([root.id, child.id, other.id].sort())
      expect(yield* session.get(other.id)).toEqual(other)
    }),
  )

  it.effect("rejects known remote ownership and sharing before fencing a lineage", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const db = (yield* Database.Service).db
      const root = yield* session.create({ location })
      const child = yield* session.create({ location })
      yield* db.update(SessionTable).set({ parent_id: root.id }).where(eq(SessionTable.id, child.id)).run()
      const input = { sessionID: root.id, authorizedIDs: [root.id, child.id] }
      const lease = yield* SessionExecutionOwnership.acquire(db, child.id, "remote")

      expect(yield* session.prepareDeleteLineage(input).pipe(Effect.flip))
        .toEqual(new SessionV2.ExecutionStillOwnedError({ sessionID: child.id }))
      expect(yield* db.select().from(SessionDeletionTable).all()).toEqual([])
      yield* SessionExecutionOwnership.release(db, lease)
      yield* db.insert(SessionSharePendingTable).values({ session_id: child.id, time_created: Date.now() }).run()
      expect(yield* session.prepareDeleteLineage(input).pipe(Effect.flip))
        .toEqual(new SessionV2.SharedSessionError({ sessionID: child.id }))
      expect(yield* db.select().from(SessionDeletionTable).all()).toEqual([])
      yield* db.delete(SessionSharePendingTable).where(eq(SessionSharePendingTable.session_id, child.id)).run()
      yield* db.insert(SessionShareTable).values({ session_id: child.id, id: "share", secret: "secret", url: "https://example.test/share" }).run()
      expect(yield* session.prepareDeleteLineage(input).pipe(Effect.flip))
        .toEqual(new SessionV2.SharedSessionError({ sessionID: child.id }))
      expect(yield* db.select().from(SessionShareTable).where(eq(SessionShareTable.session_id, child.id)).get())
        .toMatchObject({ id: "share", secret: "secret" })
      yield* db.delete(SessionShareTable).where(eq(SessionShareTable.session_id, child.id)).run()
      yield* db.update(SessionTable).set({ share_url: "https://example.test/legacy" })
        .where(eq(SessionTable.id, child.id)).run()
      expect(yield* session.prepareDeleteLineage(input).pipe(Effect.flip))
        .toEqual(new SessionV2.SharedSessionError({ sessionID: child.id }))
      yield* db.update(SessionTable).set({ share_url: null }).where(eq(SessionTable.id, child.id)).run()
      yield* session.prepareDeleteLineage(input)
      expect((yield* db.select().from(SessionDeletionTable).all()).map((row) => row.session_id).sort())
        .toEqual([root.id, child.id].sort())
    }),
  )

  it.effect("runs host preflight in the first transaction before writing lineage fences", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const db = (yield* Database.Service).db
      const root = yield* session.create({ location })
      const child = yield* session.create({ location })
      yield* db.update(SessionTable).set({ parent_id: root.id }).where(eq(SessionTable.id, child.id)).run()
      const conflict = new Error("bound in host")
      const rejected = yield* session.prepareDeleteLineage({
        sessionID: root.id,
        authorizedIDs: [root.id, child.id],
        preflight: (ids) => Effect.gen(function* () {
          expect(ids).toEqual([root.id, child.id])
          yield* db.insert(SessionDeletionTable).values({ session_id: root.id, time_created: Date.now() }).run()
          return yield* Effect.fail(conflict)
        }),
      }).pipe(Effect.flip)
      expect(rejected).toBe(conflict)
      expect(yield* db.select().from(SessionDeletionTable).all()).toEqual([])
    }),
  )

  it.effect("rejects a new projected child after its parent lineage is fenced", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const root = yield* session.create({ location })
      yield* session.prepareDeleteLineage({ sessionID: root.id, authorizedIDs: [root.id] })
      const childID = SessionV2.ID.create()
      const rejected = yield* events.publish(SessionV1.Event.Created, {
        sessionID: childID,
        info: SessionV1.SessionInfo.make({
          id: childID,
          parentID: root.id,
          slug: "child",
          version: "test",
          projectID: root.projectID,
          directory: root.location.directory,
          title: "child",
          time: { created: 0, updated: 0 },
        }),
      }).pipe(Effect.catchDefect(Effect.succeed))
      expect(rejected).toBeInstanceOf(SessionInput.AdmissionClosed)
      expect(yield* db.select().from(SessionTable).where(eq(SessionTable.id, childID)).get()).toBeUndefined()
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, childID)).all()).toEqual([])
    }),
  )

  it.effect("rejects reparenting an existing Session under a fenced parent", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const root = yield* session.create({ location })
      const child = yield* session.create({ location })
      yield* session.prepareDeleteLineage({ sessionID: root.id, authorizedIDs: [root.id] })
      const before = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, child.id)).all()

      const rejected = yield* events.publish(SessionV1.Event.Updated, {
        sessionID: child.id,
        info: SessionV1.SessionInfo.make({
          id: child.id,
          parentID: root.id,
          slug: "child",
          version: "test",
          projectID: child.projectID,
          directory: child.location.directory,
          title: child.title,
          time: { created: 0, updated: 1 },
        }),
      }).pipe(Effect.catchDefect(Effect.succeed))
      expect(rejected).toBeInstanceOf(SessionInput.AdmissionClosed)
      expect(yield* db.select({ parentID: SessionTable.parent_id }).from(SessionTable)
        .where(eq(SessionTable.id, child.id)).get()).toEqual({ parentID: null })
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, child.id)).all()).toEqual(before)
    }),
  )

  it.effect("creates a fresh projected session when the ID is omitted", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service

      const first = yield* session.create({ location })
      const second = yield* session.create({ location })

      expect(second.id).not.toBe(first.id)
      expect(yield* session.list()).toHaveLength(2)
    }),
  )

  it.effect("returns the original session when the ID is retried", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const input = { id, location }

      const first = yield* session.create(input)
      const retried = yield* session.create(input)

      expect(retried).toEqual(first)
      expect(yield* session.list()).toEqual([first])
    }),
  )

  it.effect("does not recreate a tombstoned Session ID", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const db = (yield* Database.Service).db
      const created = yield* session.create({ id, location })
      expect(yield* session.create({ id, location })).toEqual(created)
      yield* session.fenceAdmissions(id)
      yield* db.delete(SessionTable).where(eq(SessionTable.id, id)).run().pipe(Effect.orDie)

      const rejected = yield* session.create({ id, location }).pipe(Effect.catchDefect(Effect.succeed))
      expect(rejected).toBeInstanceOf(EventV2.DurableAggregateClosedError)
      expect(yield* db.select().from(SessionTable).where(eq(SessionTable.id, id)).get()).toBeUndefined()
    }),
  )

  it.effect("stores supplied immutable create attributes", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const workspaceID = WorkspaceV2.ID.make("wrk_test")
      const model = ModelV2.Ref.make({
        id: ModelV2.ID.make("sonnet"),
        providerID: ProviderV2.ID.anthropic,
        variant: ModelV2.VariantID.make("fast"),
      })

      expect(
        yield* session.create({
          location: Location.Ref.make({ directory: location.directory, workspaceID }),
          agent: AgentV2.ID.make("build"),
          model,
        }),
      ).toMatchObject({ location: { directory: location.directory, workspaceID }, agent: "build", model })
    }),
  )

  it.effect("returns the existing Session when one ID is reused with different create arguments", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ id, location })
      const changed = [
        { id, location: Location.Ref.make({ directory: AbsolutePath.make("/other") }) },
        { id, location, agent: AgentV2.ID.make("build") },
        {
          id,
          location,
          model: ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic }),
        },
      ]

      for (const input of changed) {
        expect(yield* session.create(input)).toEqual(created)
      }
      expect(yield* session.list()).toHaveLength(1)
    }),
  )

  it.effect("returns one recorded session to concurrent exact retries", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const input = { id, location }

      const created = yield* Effect.all([session.create(input), session.create(input)], { concurrency: "unbounded" })

      expect(created[1]).toEqual(created[0])
      expect(yield* session.list()).toEqual([created[0]])
    }),
  )

  it.effect("returns the current Session projection after updates", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const input = { id, location }
      const created = yield* session.create(input)

      yield* db.update(SessionTable).set({ agent: "build" }).where(eq(SessionTable.id, id)).run().pipe(Effect.orDie)

      expect(yield* session.create(input)).toMatchObject({ id: created.id, agent: "build" })
    }),
  )

  it.effect("returns the current Session projection after projected updates", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const input = { id, location }
      const created = yield* session.create(input)

      yield* events.publish(SessionV1.Event.Updated, {
        sessionID: id,
        info: SessionV1.SessionInfo.make({
          id,
          slug: "updated",
          version: "test",
          projectID: created.projectID,
          directory: created.location.directory,
          title: "updated",
          agent: "build",
          time: { created: 0, updated: 1 },
        }),
      })

      expect(yield* session.create(input)).toMatchObject({ id, agent: "build" })
    }),
  )

  it.effect("replays an unshare update with a cleared share URL", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const created = yield* session.create({ location })
      const info = SessionV1.SessionInfo.make({
        id: created.id,
        slug: "share-replay",
        version: "test",
        projectID: created.projectID,
        directory: created.location.directory,
        title: created.title,
        time: { created: 0, updated: 1 },
      })
      yield* events.publish(SessionV1.Event.Updated, {
        sessionID: created.id, info: { ...info, share: { url: "https://example.test/share" } },
      })
      yield* events.publish(SessionV1.Event.Updated, {
        sessionID: created.id, info: { ...info, share: undefined },
      })
      const serialized = (yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id))
        .orderBy(asc(EventTable.seq)).all()).map((event) => ({
        id: event.id, aggregateID: event.aggregate_id, seq: event.seq, type: event.type, data: event.data,
      }))
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (value) => Effect.promise(() => value[Symbol.asyncDispose]()),
      )
      const targetLayer = AppNodeBuilder.build(
        LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node]),
        [[Database.node, Database.layerFromPath(path.join(tmp.path, "share-replay.sqlite"))]],
      )
      yield* Effect.gen(function* () {
        const targetDb = (yield* Database.Service).db
        yield* targetDb.insert(ProjectTable).values({
          id: ProjectV2.ID.global, worktree: location.directory, sandboxes: [],
        }).run().pipe(Effect.orDie)
        yield* (yield* EventV2.Service).replayAll(serialized)
        expect(yield* targetDb.select({ url: SessionTable.share_url }).from(SessionTable)
          .where(eq(SessionTable.id, created.id)).get()).toEqual({ url: null })
      }).pipe(Effect.provide(Layer.fresh(targetLayer)))
    }),
  )

  it.effect("persists creation through the existing legacy created event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toMatchObject([{ type: EventV2.versionedType(SessionV1.Event.Created.type, 1) }])
    }),
  )

  it.effect("persists caller-ID creation through the existing created event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ id, location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).get().pipe(Effect.orDie),
      ).toMatchObject({
        data: { sessionID: id },
      })
    }),
  )

  it.effect("omits legacy creation rows from the V2 Session event stream", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })
      yield* session.prompt({ sessionID: created.id, prompt: Prompt.make({ text: "Hello" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, created.id, Number.MAX_SAFE_INTEGER)

      expect(
        Array.from(yield* session.events({ sessionID: created.id }).pipe(Stream.take(2), Stream.runCollect)),
      ).toMatchObject([
        { durable: { seq: 1 }, type: "session.next.prompt.admitted", data: { prompt: { text: "Hello" } } },
        { durable: { seq: 2 }, type: "session.next.prompted" },
      ])
    }),
  )

  it.effect("replays one prompt lifecycle into a fresh target database", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const sourceEvents = yield* EventV2.Service
      const sourceDb = (yield* Database.Service).db
      const created = yield* session.create({ id: SessionV2.ID.make("ses_fresh_target_replay"), location })
      const admitted = yield* session.prompt({
        sessionID: created.id,
        prompt: Prompt.make({ text: "Replay lifecycle" }),
        resume: false,
      })
      yield* SessionInput.promoteSteers(sourceDb, sourceEvents, created.id, Number.MAX_SAFE_INTEGER)
      const serialized = (yield* sourceDb
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, created.id))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)).map((event) => ({
        id: event.id,
        aggregateID: event.aggregate_id,
        seq: event.seq,
        type: event.type,
        data: event.data,
      }))

      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const targetDatabase = Database.layerFromPath(path.join(tmp.path, "target.sqlite"))
      const targetLayer = AppNodeBuilder.build(
        LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node]),
        [[Database.node, targetDatabase]],
      )

      yield* Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const events = yield* EventV2.Service
        const store = yield* SessionStore.Service
        yield* db
          .insert(ProjectTable)
          .values({ id: ProjectV2.ID.global, worktree: location.directory, sandboxes: [] })
          .run()
          .pipe(Effect.orDie)

        expect(yield* store.get(created.id)).toBeUndefined()
        expect(yield* events.replayAll(serialized.slice(0, 2))).toBe(created.id)
        expect(yield* SessionInput.find(db, admitted.id)).toMatchObject({
          id: admitted.id,
          sessionID: created.id,
          prompt: { text: "Replay lifecycle" },
          delivery: "steer",
          admittedSeq: 1,
        })
        expect(yield* store.context(created.id)).toEqual([])

        expect(yield* events.replayAll(serialized.slice(2))).toBe(created.id)
        expect(yield* SessionInput.find(db, admitted.id)).toMatchObject({
          id: admitted.id,
          sessionID: created.id,
          prompt: { text: "Replay lifecycle" },
          delivery: "steer",
          admittedSeq: 1,
          promotedSeq: 2,
        })
        expect(yield* store.context(created.id)).toMatchObject([
          { id: admitted.id, type: "user", text: "Replay lifecycle" },
        ])
        expect(
          (yield* db
            .select()
            .from(EventTable)
            .where(eq(EventTable.aggregate_id, created.id))
            .orderBy(asc(EventTable.seq))
            .all()
            .pipe(Effect.orDie)).map((event) => [event.seq, event.type]),
        ).toEqual([
          [0, EventV2.versionedType(SessionV1.Event.Created.type, 1)],
          [1, EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1)],
          [2, EventV2.versionedType(SessionEvent.Prompted.type, 1)],
        ])
      }).pipe(Effect.provide(Layer.fresh(targetLayer)))
    }),
  )

  it.effect("does not mask unrelated created projector defects", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const event = yield* EventV2.Service
      const defect = new Error("unrelated projector defect")
      yield* event.project(SessionV1.Event.Created, () => Effect.die(defect))

      expect(yield* session.create({ id, location }).pipe(Effect.catchDefect(Effect.succeed))).toBe(defect)
    }),
  )

  it.effect("reports unfinished Session operations as unavailable", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const unavailable = (
        effect: Effect.Effect<void, SessionV2.NotFoundError | SessionV2.OperationUnavailableError>,
      ) =>
        effect.pipe(
          Effect.flip,
          Effect.map((error) => (error instanceof SessionV2.OperationUnavailableError ? error.operation : "not-found")),
        )

      expect(yield* unavailable(session.shell({ sessionID: created.id, command: "pwd" }))).toBe("shell")
      expect(yield* unavailable(session.skill({ sessionID: created.id, skill: "review" }))).toBe("skill")
    }),
  )

  it.effect("switches the selected agent through the durable Session event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })

      yield* session.switchAgent({ sessionID: created.id, agent: "plan" })

      expect(yield* session.get(created.id)).toMatchObject({ agent: "plan" })
      expect(
        Array.from(yield* session.events({ sessionID: created.id }).pipe(Stream.take(1), Stream.runCollect)),
      ).toMatchObject([{ type: "session.next.agent.switched", data: { agent: "plan" } }])
    }),
  )

  it.effect("rejects an agent switch for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const missing = SessionV2.ID.make("ses_missing_agent_switch")

      expect(
        yield* session.switchAgent({ sessionID: missing, agent: "plan" }).pipe(
          Effect.flip,
          Effect.map((error) => error._tag),
        ),
      ).toBe("Session.NotFoundError")
    }),
  )

  it.effect("switches the selected model through the durable Session event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const model = ModelV2.Ref.make({
        id: ModelV2.ID.make("sonnet"),
        providerID: ProviderV2.ID.anthropic,
        variant: ModelV2.VariantID.make("high"),
      })

      yield* session.switchModel({ sessionID: created.id, model })

      expect(yield* session.get(created.id)).toMatchObject({ model })
      expect(
        Array.from(yield* session.events({ sessionID: created.id }).pipe(Stream.take(1), Stream.runCollect)),
      ).toMatchObject([{ type: "session.next.model.switched", data: { model } }])
    }),
  )

  it.effect("ignores a model switch when the selected model is unchanged", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const model = ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic })

      yield* session.switchModel({ sessionID: created.id, model })
      yield* session.switchModel({ sessionID: created.id, model })

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toHaveLength(2)
      expect(yield* session.get(created.id)).toMatchObject({ model })
    }),
  )

  it.effect("treats an omitted variant as the default variant", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const model = ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic })
      const created = yield* session.create({ location, model })

      yield* session.switchModel({
        sessionID: created.id,
        model: ModelV2.Ref.make({ ...model, variant: ModelV2.VariantID.make("default") }),
      })

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toHaveLength(1)
    }),
  )

  it.effect("rejects a model switch for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const missing = SessionV2.ID.make("ses_missing_model_switch")

      expect(
        yield* session
          .switchModel({
            sessionID: missing,
            model: ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic }),
          })
          .pipe(
            Effect.flip,
            Effect.map((error) => error._tag),
          ),
      ).toBe("Session.NotFoundError")
    }),
  )
})

describe("SessionV2.fork", () => {
  it.effect("copies assistant tools, shell links, and compaction without inheriting current agent or model", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const now = yield* DateTime.now
      const model = ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic })
      const source = yield* session.create({ location, agent: AgentV2.ID.make("build"), model })
      const assistant = SessionMessage.Assistant.make({
        id: SessionMessage.ID.create(), type: "assistant", agent: "build", model,
        time: { created: now, completed: now },
        content: [
          SessionMessage.AssistantText.make({ type: "text", id: "text-original", text: "Used a tool" }),
          SessionMessage.AssistantTool.make({
            type: "tool", id: "call-original", name: "shell", provider: { executed: false },
            state: SessionMessage.ToolStateCompleted.make({
              status: "completed", input: { command: "pwd" }, structured: {}, content: [],
            }),
            time: { created: now, ran: now, completed: now },
          }),
        ],
      })
      const shell = SessionMessage.Shell.make({
        id: SessionMessage.ID.create(), type: "shell", callID: "call-original",
        command: "pwd", output: "/project", time: { created: now, completed: now },
      })
      const compaction = SessionMessage.Compaction.make({
        id: SessionMessage.ID.create(), type: "compaction", reason: "manual",
        summary: "Prior work", recent: "Used a tool", time: { created: now },
      })
      for (const message of [assistant, shell, compaction])
        yield* events.publish(SessionEvent.MessageImported, { sessionID: source.id, timestamp: now, message })

      const fork = yield* session.fork({ sessionID: source.id })
      const copied = yield* session.messages({ sessionID: fork.id, order: "asc" })
      expect(fork.agent).toBeUndefined()
      expect(fork.model).toBeUndefined()
      expect(copied.map((message) => message.type)).toEqual(["assistant", "shell", "compaction"])
      expect(copied.map((message) => message.id)).not.toEqual([assistant.id, shell.id, compaction.id])
      expect(copied[0]).toMatchObject({ content: [{ id: "text-original" }, { id: "call-original" }] })
      expect(copied[1]).toMatchObject({ callID: "call-original" })
      expect(yield* session.context(fork.id)).toEqual([copied[2]])
      expect(yield* session.messages({ sessionID: source.id, order: "asc" })).toEqual([assistant, shell, compaction])
    }),
  )

  it.effect("copies the visible prefix before a selected message with fresh IDs", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const source = yield* session.create({ location, title: "Original", metadata: { trace: { id: "source" } } })
      const ids = ["msg_z9_before", "msg_z1_before", "msg_a0_selected", "msg_a1_after"].map((id) => SessionMessage.ID.make(id))
      for (const [index, messageID] of ids.entries()) {
        yield* session.prompt({ sessionID: source.id, id: messageID, prompt: Prompt.make({ text: `turn ${index}` }), resume: false })
        yield* SessionInput.promoteSteers(db, events, source.id, Number.MAX_SAFE_INTEGER)
      }
      yield* session.prompt({ sessionID: source.id, prompt: Prompt.make({ text: "pending" }), resume: false })
      const original = yield* session.messages({ sessionID: source.id, order: "asc" })

      const copy = yield* session.forkCopy({ sessionID: source.id, messageID: ids[2]! })
      const fork = copy.session
      const copied = yield* session.messages({ sessionID: fork.id, order: "asc" })
      const firstInput = yield* SessionInput.find(db, copied[0]!.id)
      const imported = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, fork.id))
        .orderBy(asc(EventTable.seq)).all()
      expect(fork).toMatchObject({ title: "Original (fork #1)", metadata: { trace: { id: "source" } }, location })
      expect(fork.parentID).toBeUndefined()
      expect(copied.map((message) => message.type === "user" ? message.text : "")).toEqual(["turn 0", "turn 1"])
      expect(copied.map((message) => message.id)).not.toEqual(original.slice(0, 2).map((message) => message.id))
      expect(copy.copied).toEqual([
        { sourceMessageID: ids[0], targetMessageID: copied[0]!.id, sourceMessageSeq: 2, targetEventSeq: 1 },
        { sourceMessageID: ids[1], targetMessageID: copied[1]!.id, sourceMessageSeq: 4, targetEventSeq: 2 },
      ])
      expect(yield* SessionInput.hasPending(db, fork.id, "steer")).toBe(false)
      expect(firstInput).toMatchObject({ sessionID: fork.id, prompt: { text: "turn 0" }, admittedSeq: 1, promotedSeq: 1 })
      expect(imported[1]?.data).toMatchObject({ source: {
        sessionID: source.id, messageID: ids[0], kind: "admitted", seq: 1,
      } })
      const nested = yield* session.fork({ sessionID: fork.id })
      const nestedImport = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, nested.id))
        .orderBy(asc(EventTable.seq)).all()
      expect(nestedImport[1]?.data).toMatchObject({ source: {
        sessionID: fork.id, messageID: copied[0]!.id, kind: "imported", seq: 1,
      } })
      expect(yield* session.messages({ sessionID: source.id, order: "asc" })).toEqual(original)
      const importedRetry = yield* session.prompt({ sessionID: fork.id, id: copied[0]!.id,
        prompt: Prompt.make({ text: "turn 0" }), resume: false }).pipe(Effect.flip)
      expect(importedRetry).toEqual(new SessionV2.PromptConflictError({ sessionID: fork.id, messageID: copied[0]!.id }))
      expect(yield* session.prompt({ sessionID: source.id, id: ids[0]!,
        prompt: Prompt.make({ text: "turn 0" }), resume: false })).toMatchObject({ id: ids[0], sessionID: source.id })
      expect((yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, fork.id)).orderBy(asc(EventTable.seq)).all())
        .map((event) => event.type)).toEqual([
          EventV2.versionedType(SessionV1.Event.Created.type, 1),
          EventV2.versionedType(SessionEvent.PromptImported.type, 1),
          EventV2.versionedType(SessionEvent.PromptImported.type, 1),
        ])
    }),
  )

  it.effect("preserves promoted queue delivery while leaving pending inputs behind", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const source = yield* session.create({ location })
      yield* session.prompt({ sessionID: source.id, prompt: Prompt.make({ text: "promoted" }),
        delivery: "queue", resume: false })
      yield* SessionInput.promoteNextQueued(db, events, source.id)
      yield* session.prompt({ sessionID: source.id, prompt: Prompt.make({ text: "pending" }),
        delivery: "queue", resume: false })

      const copy = yield* session.forkCopy({ sessionID: source.id })
      const messages = yield* session.messages({ sessionID: copy.session.id })
      expect(messages).toHaveLength(1)
      expect(yield* SessionInput.find(db, messages[0]!.id)).toMatchObject({
        sessionID: copy.session.id, delivery: "queue", admittedSeq: 1, promotedSeq: 1,
      })
      expect(yield* SessionInput.hasPending(db, copy.session.id, "queue")).toBe(false)
      expect(yield* SessionInput.hasPending(db, source.id, "queue")).toBe(true)
    }),
  )

  it.effect("rejects a fork when its source input disagrees with the durable admission", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const source = yield* session.create({ location })
      const input = yield* session.prompt({ sessionID: source.id, prompt: Prompt.make({ text: "original" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, source.id, Number.MAX_SAFE_INTEGER)
      yield* db.update(SessionInputTable).set({ prompt: Prompt.make({ text: "tampered" }) })
        .where(eq(SessionInputTable.id, input.id)).run().pipe(Effect.orDie)
      const before = yield* session.list()
      const beforeEvents = yield* db.select().from(EventTable).all()

      expect(yield* session.fork({ sessionID: source.id }).pipe(Effect.flip)).toEqual(
        new SessionV2.ForkUnavailableError({ sessionID: source.id, reason: "missing-input" }),
      )
      expect(yield* session.list()).toEqual(before)
      expect(yield* db.select().from(EventTable).all()).toEqual(beforeEvents)
    }),
  )

  it.effect("forks a historical Prompted projection with an honest source pointer", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const source = yield* session.create({ location })
      const messageID = SessionMessage.ID.create()
      yield* events.publish(SessionEvent.Prompted, {
        sessionID: source.id,
        messageID,
        timestamp: yield* DateTime.now,
        prompt: Prompt.make({ text: "historical" }),
        delivery: "steer",
      })

      const fork = yield* session.fork({ sessionID: source.id })
      const imported = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, fork.id))
        .orderBy(asc(EventTable.seq)).all()
      expect((yield* session.messages({ sessionID: fork.id }))[0]).toMatchObject({ type: "user", text: "historical" })
      expect(imported[1]?.data).toMatchObject({ source: {
        sessionID: source.id, messageID, kind: "prompted", seq: 1,
      } })
      const prompted = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, source.id))
        .orderBy(asc(EventTable.seq)).all()
      yield* db.insert(EventTable).values({
        id: EventV2.ID.create(), aggregate_id: source.id, seq: 2,
        type: prompted[1]!.type, data: prompted[1]!.data,
      }).run().pipe(Effect.orDie)
      yield* db.update(SessionInputTable).set({ admitted_seq: 2 })
        .where(eq(SessionInputTable.id, messageID)).run().pipe(Effect.orDie)
      const before = yield* session.list()
      expect(yield* session.fork({ sessionID: source.id }).pipe(Effect.flip)).toEqual(
        new SessionV2.ForkUnavailableError({ sessionID: source.id, reason: "missing-input" }),
      )
      expect(yield* session.list()).toEqual(before)
    }),
  )

  it.effect("rejects unknown and foreign cutoffs before creating any Session or event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const source = yield* session.create({ location })
      const other = yield* session.create({ location })
      const foreignID = SessionMessage.ID.make("msg_foreign_cutoff")
      yield* session.prompt({ sessionID: other.id, id: foreignID, prompt: Prompt.make({ text: "foreign" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, other.id, Number.MAX_SAFE_INTEGER)
      const beforeSessions = yield* session.list()
      const beforeEvents = yield* db.select().from(EventTable).all()

      for (const messageID of [SessionMessage.ID.make("msg_unknown_cutoff"), foreignID]) {
        const error = yield* session.fork({ sessionID: source.id, messageID }).pipe(Effect.flip)
        expect(error).toEqual(new SessionV2.MessageNotFoundError({ sessionID: source.id, messageID }))
      }
      expect(yield* session.list()).toEqual(beforeSessions)
      expect(yield* db.select().from(EventTable).all()).toEqual(beforeEvents)
    }),
  )

  it.effect("copies an active epoch and preserves provider history across replay", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const source = yield* session.create({ location })
      const now = yield* DateTime.now
      yield* events.publish(SessionEvent.MessageImported, { sessionID: source.id, timestamp: now,
        message: SessionMessage.System.make({ id: SessionMessage.ID.create(), type: "system", text: "old", time: { created: now } }),
      })
      yield* session.prompt({ sessionID: source.id, prompt: Prompt.make({ text: "before" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, source.id, Number.MAX_SAFE_INTEGER)
      const baselineSeq = yield* EventV2.latestSequence(db, source.id)
      yield* db.insert(SessionContextEpochTable).values({
        session_id: source.id, baseline_seq: baselineSeq, baseline: "private baseline", snapshot: {},
      }).run().pipe(Effect.orDie)
      yield* events.publish(SessionEvent.MessageImported, { sessionID: source.id, timestamp: now,
        message: SessionMessage.System.make({ id: SessionMessage.ID.create(), type: "system", text: "new", time: { created: now } }),
      })
      yield* session.prompt({ sessionID: source.id, prompt: Prompt.make({ text: "after" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, source.id, Number.MAX_SAFE_INTEGER)
      const original = yield* session.messages({ sessionID: source.id, order: "asc" })
      const fork = yield* session.fork({ sessionID: source.id })
      const copied = yield* session.messages({ sessionID: fork.id, order: "asc" })
      const epoch = yield* db.select().from(SessionContextEpochTable).where(eq(SessionContextEpochTable.session_id, fork.id)).get()
      expect(copied.map((message) => message.type)).toEqual(original.map((message) => message.type))
      expect(epoch).toMatchObject({ baseline: "private baseline", snapshot: {}, baseline_seq: 2 })
      expect((yield* SessionHistory.entriesForRunner(db, fork.id, epoch!.baseline_seq)).map((entry) => entry.message))
        .toEqual(copied.slice(1))
      expect(yield* session.messages({ sessionID: source.id, order: "asc" })).toEqual(original)
      expect(yield* db.select().from(SessionContextEpochTable).where(eq(SessionContextEpochTable.session_id, source.id)).get())
        .toMatchObject({ baseline: "private baseline", snapshot: {}, baseline_seq: baselineSeq })

      const serialized = (yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, fork.id))
        .orderBy(asc(EventTable.seq)).all()).map((event) => ({
          id: event.id, aggregateID: event.aggregate_id, seq: event.seq, type: event.type, data: event.data,
        }))
      expect(serialized.map((event) => event.type)).toEqual([
        EventV2.versionedType(SessionV1.Event.Created.type, 1),
        ...copied.map((message) => EventV2.versionedType(
          message.type === "user" ? SessionEvent.PromptImported.type : SessionEvent.MessageImported.type, 1,
        )),
        EventV2.versionedType(SessionEvent.ContextImported.type, 1),
      ])
      const tmp = yield* Effect.acquireRelease(Effect.promise(() => tmpdir()),
        (value) => Effect.promise(() => value[Symbol.asyncDispose]()))
      yield* Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const events = yield* EventV2.Service
        yield* db.insert(ProjectTable).values({ id: ProjectV2.ID.global, worktree: location.directory, sandboxes: [] }).run()
        yield* events.replayAll(serialized)
        expect(yield* db.select().from(SessionContextEpochTable).where(eq(SessionContextEpochTable.session_id, fork.id)).get())
          .toEqual(epoch)
        expect((yield* SessionHistory.entriesForRunner(db, fork.id, epoch!.baseline_seq)).map((entry) => entry.message))
          .toEqual(copied.slice(1))
      }).pipe(Effect.provide(Layer.fresh(AppNodeBuilder.build(
        LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node]),
        [[Database.node, Database.layerFromPath(path.join(tmp.path, "epoch-replay.sqlite"))]],
      ))))
    }),
  )

  it.effect("allows a cutoff after the baseline and excludes the selected message", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const source = yield* session.create({ location })
      yield* session.prompt({ sessionID: source.id, prompt: Prompt.make({ text: "before baseline" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, source.id, Number.MAX_SAFE_INTEGER)
      yield* db.insert(SessionContextEpochTable).values({
        session_id: source.id, baseline_seq: yield* EventV2.latestSequence(db, source.id),
        baseline: "baseline", snapshot: {},
      }).run().pipe(Effect.orDie)
      const selected = SessionMessage.ID.create()
      yield* session.prompt({ sessionID: source.id, prompt: Prompt.make({ text: "after baseline" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, source.id, Number.MAX_SAFE_INTEGER)
      yield* session.prompt({ sessionID: source.id, id: selected, prompt: Prompt.make({ text: "selected" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, source.id, Number.MAX_SAFE_INTEGER)

      const fork = yield* session.fork({ sessionID: source.id, messageID: selected })
      const copied = yield* session.messages({ sessionID: fork.id, order: "asc" })
      const epoch = yield* db.select().from(SessionContextEpochTable).where(eq(SessionContextEpochTable.session_id, fork.id)).get()
      expect(copied.map((message) => message.type === "user" ? message.text : "")).toEqual([
        "before baseline", "after baseline",
      ])
      expect(epoch).toMatchObject({ baseline: "baseline", baseline_seq: 1 })
      expect((yield* SessionHistory.entriesForRunner(db, fork.id, epoch!.baseline_seq)).map((entry) => entry.message))
        .toEqual(copied)
    }),
  )

  it.effect("rejects a cutoff before a later context snapshot update", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const source = yield* session.create({ location })
      yield* db.insert(SessionContextEpochTable).values({
        session_id: source.id, baseline_seq: 0, baseline: "baseline", snapshot: {},
      }).run().pipe(Effect.orDie)
      const selected = SessionMessage.ID.create()
      yield* session.prompt({ sessionID: source.id, id: selected, prompt: Prompt.make({ text: "selected" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, source.id, Number.MAX_SAFE_INTEGER)
      yield* events.publish(SessionEvent.ContextUpdated, {
        sessionID: source.id, messageID: SessionMessage.ID.create(), timestamp: yield* DateTime.now, text: "updated",
      })
      const before = yield* session.list()
      expect(yield* session.fork({ sessionID: source.id, messageID: selected }).pipe(Effect.flip)).toEqual(
        new SessionV2.ForkUnavailableError({ sessionID: source.id, reason: "context-epoch" }),
      )
      expect(yield* session.list()).toEqual(before)
    }),
  )

  it.effect("rejects a nested fork cutoff before its imported snapshot", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const source = yield* session.create({ location })
      yield* db.insert(SessionContextEpochTable).values({
        session_id: source.id, baseline_seq: 0, baseline: "baseline", snapshot: {},
      }).run().pipe(Effect.orDie)
      yield* session.prompt({ sessionID: source.id, prompt: Prompt.make({ text: "before update" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, source.id, Number.MAX_SAFE_INTEGER)
      yield* events.publish(SessionEvent.ContextUpdated, {
        sessionID: source.id, messageID: SessionMessage.ID.create(), timestamp: yield* DateTime.now, text: "updated",
      })
      const child = yield* session.fork({ sessionID: source.id })
      const copied = yield* session.messages({ sessionID: child.id, order: "asc" })
      const before = yield* session.list()

      expect(yield* session.fork({ sessionID: child.id, messageID: copied[1]!.id }).pipe(Effect.flip)).toEqual(
        new SessionV2.ForkUnavailableError({ sessionID: child.id, reason: "context-epoch" }),
      )
      expect(yield* session.list()).toEqual(before)
    }),
  )

  it.effect("rejects a cutoff before the active baseline without creating a child", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const source = yield* session.create({ location })
      const first = SessionMessage.ID.create()
      for (const [index, id] of [first, SessionMessage.ID.create()].entries()) {
        yield* session.prompt({ sessionID: source.id, id, prompt: Prompt.make({ text: `turn ${index}` }), resume: false })
        yield* SessionInput.promoteSteers(db, events, source.id, Number.MAX_SAFE_INTEGER)
      }
      yield* db.insert(SessionContextEpochTable).values({
        session_id: source.id, baseline_seq: yield* EventV2.latestSequence(db, source.id),
        baseline: "private baseline", snapshot: {},
      }).run().pipe(Effect.orDie)
      const before = yield* session.list()
      const beforeEvents = yield* db.select().from(EventTable).all()
      expect(yield* session.forkCopy({ sessionID: source.id, messageID: first }).pipe(Effect.flip)).toEqual(
        new SessionV2.ForkUnavailableError({ sessionID: source.id, reason: "context-epoch" }),
      )
      expect(yield* session.list()).toEqual(before)
      expect(yield* db.select().from(EventTable).all()).toEqual(beforeEvents)
    }),
  )

  it.effect("replays the copied transcript and metadata into a fresh database", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const sourceDb = (yield* Database.Service).db
      const source = yield* session.create({ location, title: "Original (fork #1)", metadata: { origin: "source" } })
      yield* session.prompt({ sessionID: source.id, prompt: Prompt.make({ text: "hello" }), resume: false })
      yield* SessionInput.promoteSteers(sourceDb, events, source.id, Number.MAX_SAFE_INTEGER)
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID: source.id,
        messageID: SessionMessage.ID.create(),
        text: "note",
        timestamp: yield* DateTime.now,
      })
      const fork = yield* session.fork({ sessionID: source.id })
      const copied = yield* session.messages({ sessionID: fork.id, order: "asc" })
      expect(fork.title).toBe("Original (fork #2)")
      expect(copied[1]).toMatchObject({ type: "synthetic", sessionID: fork.id })
      const serialized = (yield* sourceDb.select().from(EventTable).where(eq(EventTable.aggregate_id, fork.id))
        .orderBy(asc(EventTable.seq)).all()).map((event) => ({
          id: event.id, aggregateID: event.aggregate_id, seq: event.seq, type: event.type, data: event.data,
        }))

      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (value) => Effect.promise(() => value[Symbol.asyncDispose]()),
      )
      const targetLayer = AppNodeBuilder.build(
        LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node]),
        [[Database.node, Database.layerFromPath(path.join(tmp.path, "fork-target.sqlite"))]],
      )
      yield* Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const targetEvents = yield* EventV2.Service
        const store = yield* SessionStore.Service
        yield* db.insert(ProjectTable).values({
          id: ProjectV2.ID.global, worktree: location.directory, sandboxes: [],
        }).run().pipe(Effect.orDie)
        yield* targetEvents.replayAll(serialized)
        expect(yield* store.get(fork.id)).toMatchObject({ title: fork.title, metadata: { origin: "source" } })
        expect(yield* store.context(fork.id)).toEqual(copied)
        expect(yield* SessionInput.find(db, copied[0]!.id)).toMatchObject({
          id: copied[0]!.id, sessionID: fork.id, prompt: { text: "hello" }, admittedSeq: 1, promotedSeq: 1,
        })
        expect((yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, fork.id))
          .orderBy(asc(EventTable.seq)).all())[1]?.data).toEqual(serialized[1]?.data)
      }).pipe(Effect.provide(Layer.fresh(targetLayer)))
    }),
  )

  it.effect("rolls back the new Session when an imported message projector fails", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const source = yield* session.create({ location })
      for (const text of ["first", "second"]) {
        yield* session.prompt({ sessionID: source.id, prompt: Prompt.make({ text }), resume: false })
        yield* SessionInput.promoteSteers(db, events, source.id, Number.MAX_SAFE_INTEGER)
      }
      yield* events.project(SessionEvent.PromptImported, (event) =>
        event.data.message.type === "user" && event.data.message.text === "second"
          ? Effect.die("import failed")
          : Effect.void,
      )

      expect(yield* session.fork({ sessionID: source.id }).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" })
      expect((yield* session.list()).map((item) => item.id)).toEqual([source.id])
      expect((yield* db.select().from(EventTable).all()).every((event) => event.aggregate_id === source.id)).toBe(true)
    }),
  )
})
