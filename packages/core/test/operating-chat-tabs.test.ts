import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { DateTime, Deferred, Effect, Fiber, Layer, Ref } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { CanvasTabService } from "@opencode-ai/core/workspace/canvas-tab"
import { FunctionalityInstance } from "@opencode-ai/core/workspace/functionality-instance"
import { OperatingChatSessionService } from "@opencode-ai/core/workspace/operating-chat-session"
import { WorkspaceService } from "@opencode-ai/core/workspace/service"
import { Project } from "@opencode-ai/schema/project"
import { Prompt } from "@opencode-ai/schema/prompt"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { testEffect } from "./lib/effect"

type State = {
  readonly created: Ref.Ref<ReadonlyArray<SessionSchema.ID>>
  readonly active: Ref.Ref<ReadonlySet<SessionSchema.ID>>
  readonly createGate: Ref.Ref<{ entered: Deferred.Deferred<void>; release: Deferred.Deferred<void> } | undefined>
}

const makeInfo = (id: SessionSchema.ID, directory: typeof AbsolutePath.Type, workspaceID: Workspace.ID) =>
  SessionSchema.Info.make({
    id,
    runtime: "v2",
    projectID: Project.ID.global,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(Date.now()), updated: DateTime.makeUnsafe(Date.now()) },
    title: "operating-chat-tabs",
    location: { directory, workspaceID },
  })

const makePort = (state: State) =>
  Layer.effect(
    OperatingChatSessionService.SessionPortService,
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const events = yield* EventV2.Service
      return OperatingChatSessionService.SessionPortService.of({
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
                slug: "operating-chat-tabs",
                directory: input.location.directory,
                title: "operating-chat-tabs",
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
            if (!input.model) return
            yield* events.publish(SessionEvent.ModelSwitched, {
              sessionID: input.sessionID,
              messageID: SessionMessage.ID.create(),
              timestamp: yield* DateTime.now,
              model: input.model,
            })
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
  createGate: Ref.makeUnsafe<{ entered: Deferred.Deferred<void>; release: Deferred.Deferred<void> } | undefined>(
    undefined,
  ),
}

const layer = AppNodeBuilder.build(
  LayerNode.group([
    Database.node,
    EventV2.node,
    SessionProjector.node,
    WorkspaceService.node,
    FunctionalityInstance.node,
    CanvasTabService.node,
    OperatingChatSessionService.node,
  ]),
  [[OperatingChatSessionService.sessionPortLive, makePort(state)]],
)

const it = testEffect(layer)
const tuple = Workspace.Layout.Tuple.make({ user: "", style: "default", deviceClass: "desktop" })

function withBlock(workspaceID: Workspace.ID, blockID: string) {
  return Effect.gen(function* () {
    const workspace = yield* WorkspaceService.Service
    const layout = yield* workspace.layout.get(workspaceID, tuple, "operating-chat-tabs")
    yield* workspace.layout.save(
      workspaceID,
      tuple,
      [
        { id: blockID, functionality: "builtin:operating-chat-session", transform: { x: 0, y: 0, w: 4, h: 4, z: 0 } },
        ...layout.blocks,
      ],
      layout.revision,
      "operating-chat-tabs",
    )
  })
}

describe("Operating Chat canvas tabs", () => {
  it.effect("rejects stale and foreign-owned tabs without changing their model or events", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const operating = yield* OperatingChatSessionService.Service
      const tabs = yield* CanvasTabService.Service
      const database = yield* Database.Service
      const info = yield* workspace.create({ name: "operating-tabs-config-rejection" })
      yield* workspace.update(info.id, { model: "ollama:qwen3-coder-30b" })
      yield* withBlock(info.id, "block-a")
      yield* withBlock(info.id, "block-b")
      const first = yield* operating.ensure(info.id, "block-a")
      const firstTab = (yield* tabs.listOwned(info.id, "operating-chat", "block-a", undefined, 10)).items[0]
      const next = yield* operating.createTab(info.id, "block-a", first.revision, "config-rejection")
      const other = yield* operating.ensure(info.id, "block-b")
      const stale = yield* operating
        .selectTab(info.id, "block-a", firstTab.id, next.binding.revision, 0)
        .pipe(Effect.exit)
      const foreign = yield* operating.selectTab(info.id, "block-b", firstTab.id, other.revision, 0).pipe(Effect.exit)
      expect(String(stale)).toContain("CanvasTab.StaleRevisionError")
      expect(String(foreign)).toContain("CanvasTab.BusyError")
      expect(
        (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, first.sessionID)).get())?.model,
      ).toBeNull()
      expect(
        yield* database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, first.sessionID)).all(),
      ).toEqual([])
    }),
  )

  it.effect("rejects a create when input is admitted during candidate creation", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const operating = yield* OperatingChatSessionService.Service
      const tabs = yield* CanvasTabService.Service
      const database = yield* Database.Service
      const info = yield* workspace.create({ name: "operating-tabs-admission" })
      yield* withBlock(info.id, "block-a")
      const first = yield* operating.ensure(info.id, "block-a")
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* Ref.set(state.createGate, { entered, release })
      const creating = yield* operating
        .createTab(info.id, "block-a", first.revision, "admission-race")
        .pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      yield* database.db
        .insert(SessionInputTable)
        .values({
          id: SessionMessage.ID.create(),
          session_id: first.sessionID,
          prompt: Prompt.make({ text: "pending" }),
          delivery: "queue",
          admitted_seq: 0,
        })
        .run()
      yield* Deferred.succeed(release, undefined)
      const result = yield* Fiber.join(creating).pipe(Effect.exit)
      yield* Ref.set(state.createGate, undefined)
      expect(String(result)).toContain("OperatingChat.BusyError")
      expect((yield* operating.get(info.id, "block-a"))?.sessionID).toBe(first.sessionID)
      expect((yield* tabs.listOwned(info.id, "operating-chat", "block-a", undefined, 10)).items).toHaveLength(1)
    }),
  )

  it.effect("creates and selects block-owned V2 sessions", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const operating = yield* OperatingChatSessionService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "operating-tabs" })
      yield* withBlock(info.id, "block-a")

      const first = yield* operating.ensure(info.id, "block-a")
      const firstTab = (yield* tabs.listOwned(info.id, "operating-chat", "block-a", undefined, 10)).items[0]
      const next = yield* operating.createTab(info.id, "block-a", first.revision, "request-1")
      const selected = yield* operating.selectTab(
        info.id,
        "block-a",
        firstTab.id,
        next.binding.revision,
        next.tabRevision,
      )
      expect(selected.binding.sessionID).toBe(first.sessionID)
    }),
  )

  it.effect("reconciles an exact create retry and rejects an active current session", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const operating = yield* OperatingChatSessionService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "operating-tabs-retry" })
      yield* withBlock(info.id, "block-a")

      const first = yield* operating.ensure(info.id, "block-a")
      const before = (yield* Ref.get(state.created)).length
      yield* Ref.set(state.active, new Set([first.sessionID]))
      const busy = yield* operating.createTab(info.id, "block-a", first.revision, "request-busy").pipe(Effect.exit)
      expect(String(busy)).toContain("OperatingChat.BusyError")
      expect((yield* Ref.get(state.created)).length).toBe(before)
      yield* Ref.set(state.active, new Set())

      const created = yield* operating.createTab(info.id, "block-a", first.revision, "request-retry")
      const retried = yield* operating.createTab(info.id, "block-a", first.revision, "request-retry")
      expect(retried.binding.sessionID).toBe(created.binding.sessionID)
      expect((yield* Ref.get(state.created)).length).toBe(before + 1)
      expect((yield* tabs.listOwned(info.id, "operating-chat", "block-a", undefined, 10)).items).toHaveLength(2)
    }),
  )

  it.effect("clears the archived marker when restoring a prior tab", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const workspace = yield* WorkspaceService.Service
      const operating = yield* OperatingChatSessionService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "operating-tabs-archive" })
      yield* withBlock(info.id, "block-a")

      const first = yield* operating.ensure(info.id, "block-a")
      const firstTab = (yield* tabs.listOwned(info.id, "operating-chat", "block-a", undefined, 10)).items[0]
      yield* events.publish(SessionEvent.ArchiveStateChanged, {
        sessionID: first.sessionID,
        timestamp: DateTime.makeUnsafe(Date.now()),
        archived: true,
      })
      yield* withBlock(info.id, "block-b")
      yield* tabs.archiveBlock({ workspaceID: info.id, kind: "operating-chat", blockID: "block-a" }, 0)
      const second = yield* operating.ensure(info.id, "block-b")
      const restored = yield* operating.selectTab(info.id, "block-b", firstTab.id, second.revision, 0)
      expect(restored.binding.sessionID).toBe(first.sessionID)

      const row = yield* db
        .select({ archived: SessionTable.time_archived })
        .from(SessionTable)
        .where(eq(SessionTable.id, first.sessionID))
        .get()
      expect(row?.archived).toBeNull()
    }),
  )
})
