import { describe, expect } from "bun:test"
import { asc, eq } from "drizzle-orm"
import { DateTime, Deferred, Effect, Exit, Fiber, Layer, Ref } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionInputTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { CanvasTabService } from "@opencode-ai/core/workspace/canvas-tab"
import { FunctionalityInstance } from "@opencode-ai/core/workspace/functionality-instance"
import { MasterAgentService } from "@opencode-ai/core/workspace/master-agent"
import { WorkspaceService } from "@opencode-ai/core/workspace/service"
import { CanvasTabTable } from "@opencode-ai/core/workspace/sql"
import { Project } from "@opencode-ai/schema/project"
import { MasterAgent } from "@opencode-ai/schema/master-agent"
import { Prompt } from "@opencode-ai/schema/prompt"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { testEffect } from "../lib/effect"

type Gate = {
  readonly sessionID?: SessionSchema.ID
  readonly entered: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<void>
}

type State = {
  readonly created: Ref.Ref<ReadonlyArray<SessionSchema.ID>>
  readonly active: Ref.Ref<ReadonlySet<SessionSchema.ID>>
  readonly createGate: Ref.Ref<Gate | undefined>
  readonly configureGate: Ref.Ref<Gate | undefined>
}

const makeInfo = (id: SessionSchema.ID, directory: typeof AbsolutePath.Type, workspaceID: Workspace.ID) =>
  SessionSchema.Info.make({
    id,
    runtime: "v2",
    projectID: Project.ID.global,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(Date.now()), updated: DateTime.makeUnsafe(Date.now()) },
    title: "master-agent-tabs",
    location: { directory, workspaceID },
  })

const makePort = (state: State) =>
  Layer.effect(
    MasterAgentService.SessionPortService,
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const events = yield* EventV2.Service
      return MasterAgentService.SessionPortService.of({
        create: (input) =>
          Effect.gen(function* () {
            const id = input.id ?? SessionSchema.ID.create()
            yield* db
              .insert(ProjectTable)
              .values({ id: Project.ID.global, worktree: AbsolutePath.make(process.cwd()), sandboxes: [] })
              .onConflictDoNothing()
              .run()
              .pipe(Effect.orDie)
            const now = Date.now()
            yield* db
              .insert(SessionTable)
              .values({
                id,
                runtime: "v2",
                project_id: Project.ID.global,
                workspace_id: input.location.workspaceID,
                slug: "master-agent-tabs",
                directory: input.location.directory,
                title: "master-agent-tabs",
                version: "test",
                time_created: now,
                time_updated: now,
              })
              .run()
              .pipe(Effect.orDie)
            yield* Ref.update(state.created, (items) => [...items, id])
            const gate = yield* Ref.get(state.createGate)
            if (gate) {
              yield* Deferred.succeed(gate.entered, undefined)
              yield* Deferred.await(gate.release)
            }
            return makeInfo(id, input.location.directory, input.location.workspaceID!)
          }),
        configure: (input) =>
          Effect.gen(function* () {
            const gate = yield* Ref.get(state.configureGate)
            if (gate && (!gate.sessionID || gate.sessionID === input.sessionID)) {
              yield* Deferred.succeed(gate.entered, undefined)
              yield* Deferred.await(gate.release)
            }
            const timestamp = yield* DateTime.now
            yield* events.publish(SessionEvent.AgentSwitched, {
              sessionID: input.sessionID,
              messageID: SessionMessage.ID.create(),
              timestamp,
              agent: input.agent,
            })
            if (input.model) {
              yield* events.publish(SessionEvent.ModelSwitched, {
                sessionID: input.sessionID,
                messageID: SessionMessage.ID.create(),
                timestamp,
                model: input.model,
              })
            }
          }),
        active: Ref.get(state.active),
        reserveIdle: (sessionID) => Ref.get(state.active).pipe(Effect.map((active) => !active.has(sessionID))),
        cleanupLosingCandidate: () => Effect.succeed("removed" as const),
      })
    }),
  )

const state: State = {
  created: Ref.makeUnsafe<ReadonlyArray<SessionSchema.ID>>([]),
  active: Ref.makeUnsafe<ReadonlySet<SessionSchema.ID>>(new Set()),
  createGate: Ref.makeUnsafe<Gate | undefined>(undefined),
  configureGate: Ref.makeUnsafe<Gate | undefined>(undefined),
}

const layer = AppNodeBuilder.build(
  LayerNode.group([
    Database.node,
    EventV2.node,
    SessionProjector.node,
    WorkspaceService.node,
    FunctionalityInstance.node,
    CanvasTabService.node,
    MasterAgentService.node,
  ]),
  [[MasterAgentService.sessionPortLive, makePort(state)]],
)

const it = testEffect(layer)
const tuple = Workspace.Layout.Tuple.make({ user: "", style: "default", deviceClass: "desktop" })

function withBlock(workspaceID: Workspace.ID, blockID: string) {
  return Effect.gen(function* () {
    const workspace = yield* WorkspaceService.Service
    const layout = yield* workspace.layout.get(workspaceID, tuple, "master-agent-tabs")
    yield* workspace.layout.save(
      workspaceID,
      tuple,
      [
        { id: blockID, functionality: "builtin:master-agent", transform: { x: 0, y: 0, w: 4, h: 4, z: 0 } },
        ...layout.blocks,
      ],
      layout.revision,
      "master-agent-tabs",
    )
  })
}

describe("Master Agent canvas tabs", () => {
  it.effect("reports a committed tab switch despite a binding observer defect", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const master = yield* MasterAgentService.Service
      const events = yield* EventV2.Service
      const info = yield* workspace.create({ name: "master-tabs-observer-defect" })
      yield* withBlock(info.id, "block-a")
      const first = yield* master.ensure(info.id, "block-a")
      yield* events.listen((event) =>
        event.type === MasterAgent.BindingUpdated.type ? Effect.die("broken binding observer") : Effect.void,
      )
      const next = yield* master.createTab(info.id, "block-a", first.revision, "observer-defect").pipe(Effect.exit)
      expect(Exit.isSuccess(next)).toBe(true)
      expect((yield* master.get(info.id, "block-a"))?.sessionID).not.toBe(first.sessionID)
    }),
  )

  it.effect("does not resurrect a binding when ensure loses to block removal", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const master = yield* MasterAgentService.Service
      const instances = yield* FunctionalityInstance.Service
      const info = yield* workspace.create({ name: "master-tabs-ensure-remove" })
      yield* withBlock(info.id, "block-a")
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* Ref.set(state.createGate, { entered, release })
      const ensuring = yield* master.ensure(info.id, "block-a").pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      const layout = yield* workspace.layout.get(info.id, tuple, "master-agent-tabs")
      yield* workspace.block.archiveAndRemove(
        info.id,
        "block-a",
        "master-agent",
        tuple,
        layout.revision,
        "master-agent-tabs",
        "",
      )
      yield* Deferred.succeed(release, undefined)
      const result = yield* Fiber.join(ensuring).pipe(Effect.exit)
      yield* Ref.set(state.createGate, undefined)
      expect(Exit.isFailure(result)).toBe(true)
      expect(yield* instances.get(info.id, "block-a", "builtin:master-agent")).toBeUndefined()
    }),
  )

  it.effect("does not reconfigure a target running outside its canvas block", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const master = yield* MasterAgentService.Service
      const tabs = yield* CanvasTabService.Service
      const database = yield* Database.Service
      const info = yield* workspace.create({ name: "master-tabs-active-target" })
      yield* withBlock(info.id, "block-a")
      const first = yield* master.ensure(info.id, "block-a")
      const firstTab = (yield* tabs.listOwned(info.id, "master-agent", "block-a", undefined, 10)).items[0]
      const next = yield* master.createTab(info.id, "block-a", first.revision, "active-target")
      yield* Ref.set(state.active, new Set([first.sessionID]))
      const result = yield* master
        .selectTab(info.id, "block-a", firstTab.id, next.binding.revision, next.tabRevision)
        .pipe(Effect.exit)
      yield* Ref.set(state.active, new Set())
      expect(String(result)).toContain("MasterAgent.BusyError")
      expect((yield* master.get(info.id, "block-a"))?.sessionID).toBe(next.binding.sessionID)
      expect(
        yield* database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, first.sessionID)).all(),
      ).toEqual([])
    }),
  )

  it.effect("preserves the first session and switches back to it", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const master = yield* MasterAgentService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "master-tabs" })
      yield* withBlock(info.id, "block-a")

      const first = yield* master.ensure(info.id, "block-a")
      const firstTab = (yield* tabs.listOwned(info.id, "master-agent", "block-a", undefined, 10)).items[0]
      const next = yield* master.createTab(info.id, "block-a", first.revision, "request-1")
      expect(next.binding.sessionID).not.toBe(first.sessionID)
      const failed = yield* master
        .selectTab(info.id, "block-a", firstTab.id, next.binding.revision, 0)
        .pipe(Effect.exit)
      expect(String(failed)).toContain("CanvasTab.StaleRevisionError")
      const afterFailed = yield* master.get(info.id, "block-a")
      const registryAfterFailed = yield* tabs.block(info.id, "master-agent", "block-a")
      expect(afterFailed?.sessionID).toBe(next.binding.sessionID)
      expect(registryAfterFailed.selected.id).toBe("request-1")
      expect(registryAfterFailed.revision).toBe(next.tabRevision)
      const selected = yield* master.selectTab(info.id, "block-a", firstTab.id, next.binding.revision, next.tabRevision)
      expect(selected.binding.sessionID).toBe(first.sessionID)
    }),
  )

  it.effect("does not configure a target when the tab revision is stale", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const master = yield* MasterAgentService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "master-tabs-stale-config" })
      yield* withBlock(info.id, "block-a")

      const first = yield* master.ensure(info.id, "block-a")
      const firstTab = (yield* tabs.listOwned(info.id, "master-agent", "block-a", undefined, 10)).items[0]
      const next = yield* master.createTab(info.id, "block-a", first.revision, "stale-config")
      const before = yield* db
        .select({ agent: SessionTable.agent, model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, first.sessionID))
        .get()
      const eventsBefore = yield* db
        .select({ id: EventTable.id })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, first.sessionID))
        .all()

      const rejected = yield* master
        .selectTab(info.id, "block-a", firstTab.id, next.binding.revision, 0)
        .pipe(Effect.exit)

      expect(String(rejected)).toContain("CanvasTab.StaleRevisionError")
      expect(
        yield* db
          .select({ agent: SessionTable.agent, model: SessionTable.model })
          .from(SessionTable)
          .where(eq(SessionTable.id, first.sessionID))
          .get(),
      ).toEqual(before)
      expect(
        yield* db
          .select({ id: EventTable.id })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, first.sessionID))
          .all(),
      ).toEqual(eventsBefore)
    }),
  )

  it.effect("does not create another session when a create request is retried exactly", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const master = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "master-tabs-retry" })
      yield* withBlock(info.id, "block-a")
      const first = yield* master.ensure(info.id, "block-a")

      const createdBefore = (yield* Ref.get(state.created)).length
      const created = yield* master.createTab(info.id, "block-a", first.revision, "request-retry")
      const retried = yield* master.createTab(info.id, "block-a", first.revision, "request-retry")
      expect(retried.binding.sessionID).toBe(created.binding.sessionID)
      expect((yield* Ref.get(state.created)).length).toBe(createdBefore + 1)
    }),
  )

  it.effect("restores the V2 archive marker through the durable event projector", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const workspace = yield* WorkspaceService.Service
      const master = yield* MasterAgentService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "master-tabs-archive" })
      yield* withBlock(info.id, "block-a")
      const first = yield* master.ensure(info.id, "block-a")
      const firstTab = (yield* tabs.listOwned(info.id, "master-agent", "block-a", undefined, 10)).items[0]

      yield* events.publish(SessionEvent.ArchiveStateChanged, {
        sessionID: first.sessionID,
        timestamp: DateTime.makeUnsafe(Date.now()),
        archived: true,
      })
      const archived = yield* db
        .select({ archived: SessionTable.time_archived })
        .from(SessionTable)
        .where(eq(SessionTable.id, first.sessionID))
        .get()
      expect(archived?.archived).not.toBeNull()

      yield* withBlock(info.id, "block-b")
      yield* tabs.archiveBlock({ workspaceID: info.id, kind: "master-agent", blockID: "block-a" }, 0)
      const second = yield* master.ensure(info.id, "block-b")
      const restored = yield* master.selectTab(info.id, "block-b", firstTab.id, second.revision, 0)

      expect(restored.binding.sessionID).toBe(first.sessionID)
      const unarchived = yield* db
        .select({ archived: SessionTable.time_archived })
        .from(SessionTable)
        .where(eq(SessionTable.id, first.sessionID))
        .get()
      expect(unarchived?.archived).toBeNull()

      const serialized = (yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, first.sessionID))
        .orderBy(asc(EventTable.seq))
        .all()).map((row) => ({
        id: row.id,
        type: row.type,
        seq: row.seq,
        aggregateID: row.aggregate_id,
        data: row.data,
      }))
      yield* db.delete(EventTable).where(eq(EventTable.aggregate_id, first.sessionID)).run().pipe(Effect.orDie)
      yield* db
        .delete(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, first.sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* db
        .delete(EventSequenceTable)
        .where(eq(EventSequenceTable.aggregate_id, first.sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* db
        .update(SessionTable)
        .set({ time_archived: Date.now() })
        .where(eq(SessionTable.id, first.sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* events.replayAll(serialized)
      const replayed = yield* db
        .select({ archived: SessionTable.time_archived })
        .from(SessionTable)
        .where(eq(SessionTable.id, first.sessionID))
        .get()
      expect(replayed?.archived).toBeNull()
    }),
  )

  it.effect("rejects busy and racing creates without changing the old selection", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const master = yield* MasterAgentService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "master-tabs-race" })
      yield* withBlock(info.id, "block-a")

      const first = yield* master.ensure(info.id, "block-a")
      const beforeBusy = (yield* Ref.get(state.created)).length
      yield* Ref.set(state.active, new Set([first.sessionID]))
      const busy = yield* master.createTab(info.id, "block-a", first.revision, "request-busy").pipe(Effect.exit)
      expect(Exit.isFailure(busy)).toBe(true)
      expect((yield* Ref.get(state.created)).length).toBe(beforeBusy)
      yield* Ref.set(state.active, new Set())
      yield* db
        .insert(SessionInputTable)
        .values({
          id: SessionMessage.ID.create(),
          session_id: first.sessionID,
          prompt: Prompt.make({ text: "pending" }),
          delivery: "queue",
          admitted_seq: 0,
        })
        .run()
        .pipe(Effect.orDie)
      const pending = yield* master.createTab(info.id, "block-a", first.revision, "request-pending").pipe(Effect.exit)
      expect(Exit.isFailure(pending)).toBe(true)
      expect((yield* Ref.get(state.created)).length).toBe(beforeBusy)
      yield* db
        .update(SessionInputTable)
        .set({ promoted_seq: 1 })
        .where(eq(SessionInputTable.session_id, first.sessionID))
        .run()
        .pipe(Effect.orDie)

      const left = yield* master.createTab(info.id, "block-a", first.revision, "request-left").pipe(Effect.forkChild)
      const right = yield* master.createTab(info.id, "block-a", first.revision, "request-right").pipe(Effect.forkChild)
      const [leftExit, rightExit] = yield* Effect.all([
        Fiber.join(left).pipe(Effect.exit),
        Fiber.join(right).pipe(Effect.exit),
      ])
      expect(Number(Exit.isSuccess(leftExit)) + Number(Exit.isSuccess(rightExit))).toBe(1)

      const current = yield* master.get(info.id, "block-a")
      expect(current).toBeDefined()
      const owned = (yield* tabs.listOwned(info.id, "master-agent", "block-a", undefined, 10)).items
      expect(owned).toHaveLength(2)
      const selected = owned.find((tab) => tab.conversationID === current?.sessionID)
      expect(selected?.id).toMatch(/^request-(left|right)$/)
    }),
  )

  it.effect("rechecks busy state after a candidate waits for admission", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const master = yield* MasterAgentService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "master-tabs-paused-create" })
      yield* withBlock(info.id, "block-a")

      const first = yield* master.ensure(info.id, "block-a")
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* Ref.set(state.createGate, { entered, release })
      const creating = yield* master
        .createTab(info.id, "block-a", first.revision, "paused-create")
        .pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      yield* db
        .insert(SessionInputTable)
        .values({
          id: SessionMessage.ID.create(),
          session_id: first.sessionID,
          prompt: Prompt.make({ text: "admitted while candidate creation is paused" }),
          delivery: "queue",
          admitted_seq: 0,
        })
        .run()
        .pipe(Effect.orDie)
      yield* Deferred.succeed(release, undefined)
      const rejected = yield* Fiber.join(creating).pipe(Effect.exit)
      yield* Ref.set(state.createGate, undefined)

      expect(String(rejected)).toContain("MasterAgent.BusyError")
      const current = yield* master.get(info.id, "block-a")
      expect(current?.sessionID).toBe(first.sessionID)
      expect((yield* tabs.listOwned(info.id, "master-agent", "block-a", undefined, 10)).items).toHaveLength(1)
    }),
  )

  it.effect("rolls back configuration and notifications when restore becomes busy", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const workspace = yield* WorkspaceService.Service
      const master = yield* MasterAgentService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "master-tabs-rollback-notify" })
      yield* withBlock(info.id, "block-a")

      const first = yield* master.ensure(info.id, "block-a")
      const firstTab = (yield* tabs.listOwned(info.id, "master-agent", "block-a", undefined, 10)).items[0]
      yield* events.publish(SessionEvent.ArchiveStateChanged, {
        sessionID: first.sessionID,
        timestamp: DateTime.makeUnsafe(Date.now()),
        archived: true,
      })
      yield* withBlock(info.id, "block-b")
      yield* tabs.archiveBlock({ workspaceID: info.id, kind: "master-agent", blockID: "block-a" }, 0)
      const second = yield* master.ensure(info.id, "block-b")

      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* Ref.set(state.configureGate, { sessionID: first.sessionID, entered, release })
      const archiveNotifications = yield* Ref.make(0)
      const unsubscribe = yield* events.listen((event) =>
        event.type === SessionEvent.ArchiveStateChanged.type
          ? Ref.update(archiveNotifications, (count) => count + 1)
          : Effect.void,
      )
      const selecting = yield* master
        .selectTab(info.id, "block-b", firstTab.id, second.revision, 0)
        .pipe(Effect.forkChild)
      yield* Deferred.await(entered)

      yield* Ref.set(state.active, new Set([second.sessionID]))
      yield* Deferred.succeed(release, undefined)
      const rejected = yield* Fiber.join(selecting).pipe(Effect.exit)
      yield* unsubscribe
      yield* Ref.set(state.configureGate, undefined)
      yield* Ref.set(state.active, new Set())

      expect(String(rejected)).toContain("MasterAgent.BusyError")
      expect(yield* Ref.get(archiveNotifications)).toBe(0)
      expect(
        yield* db
          .select({ archived: SessionTable.time_archived, agent: SessionTable.agent, model: SessionTable.model })
          .from(SessionTable)
          .where(eq(SessionTable.id, first.sessionID))
          .get(),
      ).toEqual(expect.objectContaining({ agent: null, model: null }))
      expect(
        (yield* db
          .select({ archived: SessionTable.time_archived })
          .from(SessionTable)
          .where(eq(SessionTable.id, first.sessionID))
          .get())?.archived,
      ).not.toBeNull()
      expect((yield* master.get(info.id, "block-b"))?.sessionID).toBe(second.sessionID)
    }),
  )

  it.effect("rejects a tab whose session belongs to another workspace", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const master = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "master-tabs-foreign" })
      const foreign = yield* workspace.create({ name: "master-tabs-other" })
      yield* withBlock(info.id, "block-a")
      yield* withBlock(foreign.id, "block-b")

      const current = yield* master.ensure(info.id, "block-a")
      const foreignSession = yield* master.ensure(foreign.id, "block-b")
      yield* db
        .insert(CanvasTabTable)
        .values({
          id: "foreign-tab",
          workspace_id: info.id,
          kind: "master-agent",
          conversation_id: foreignSession.sessionID,
          origin_block_id: "block-a",
          owner_block_id: null,
          title: "foreign",
          time_created: Date.now(),
          time_archived: Date.now(),
          snapshot: null,
        })
        .run()
        .pipe(Effect.orDie)

      const rejected = yield* master.selectTab(info.id, "block-a", "foreign-tab", current.revision, 0).pipe(Effect.exit)
      expect(String(rejected)).toContain("MasterAgent.WrongTabError")
    }),
  )
})
