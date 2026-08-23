import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { FunctionalityInstance } from "@opencode-ai/core/workspace/functionality-instance"
import { OperatingChatSessionService } from "@opencode-ai/core/workspace/operating-chat-session"
import { WorkspaceService } from "@opencode-ai/core/workspace/service"
import { FunctionalityInstanceTable } from "@opencode-ai/core/workspace/sql"
import { OperatingChat } from "@opencode-ai/schema/operating-chat"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { DateTime, Deferred, Effect, Fiber, Layer, Ref, Stream } from "effect"
import { testEffect } from "./lib/effect"

type StubState = {
  readonly created: Ref.Ref<
    ReadonlyArray<{ id: SessionSchema.ID; model: ModelV2.Ref; directory: typeof AbsolutePath.Type }>
  >
  readonly configured: Ref.Ref<ReadonlyArray<{ sessionID: SessionSchema.ID; model: ModelV2.Ref }>>
  readonly discarded: Ref.Ref<ReadonlySet<SessionSchema.ID>>
  readonly active: Ref.Ref<ReadonlySet<SessionSchema.ID>>
  barrier: boolean
  readonly gate?: Deferred.Deferred<void>
  readonly bothCreated?: Deferred.Deferred<void>
}

const makeInfo = (id: SessionSchema.ID, directory: typeof AbsolutePath.Type, workspaceID: Workspace.ID | undefined) =>
  SessionSchema.Info.make({
    id,
    projectID: Project.ID.global,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(Date.now()), updated: DateTime.makeUnsafe(Date.now()) },
    title: "operating-chat-test",
    location: { directory, workspaceID },
  })

const makePort = (state: StubState) =>
  Layer.effect(
    OperatingChatSessionService.SessionPortService,
    Effect.gen(function* () {
      const { db } = yield* Database.Service
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
            yield* db
              .insert(SessionTable)
              .values({
                id,
                project_id: Project.ID.global,
                workspace_id: input.location.workspaceID,
                slug: "operating-chat-test",
                directory: input.location.directory,
                title: "operating-chat-test",
                version: "test",
              })
              .run()
              .pipe(Effect.orDie)
            yield* Ref.update(state.created, (entries) => [
              ...entries,
              { id, model: input.model, directory: input.location.directory },
            ])
            const { gate, bothCreated } = state
            if (state.barrier && gate && bothCreated) {
              if ((yield* Ref.get(state.created)).length >= 2) yield* Deferred.succeed(bothCreated, void 0)
              yield* Deferred.await(gate)
            }
            return makeInfo(id, input.location.directory, input.location.workspaceID)
          }),
        configure: (input) => Ref.update(state.configured, (entries) => [...entries, input]),
        active: Ref.get(state.active),
        cleanupLosingCandidate: (sessionID) =>
          Effect.gen(function* () {
            yield* db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
            yield* Ref.update(state.discarded, (entries) => new Set(entries).add(sessionID))
            return "removed" as const
          }),
      })
    }),
  )

const state: StubState = {
  created: Ref.makeUnsafe<
    ReadonlyArray<{ id: SessionSchema.ID; model: ModelV2.Ref; directory: typeof AbsolutePath.Type }>
  >([]),
  configured: Ref.makeUnsafe<ReadonlyArray<{ sessionID: SessionSchema.ID; model: ModelV2.Ref }>>([]),
  discarded: Ref.makeUnsafe<ReadonlySet<SessionSchema.ID>>(new Set()),
  active: Ref.makeUnsafe<ReadonlySet<SessionSchema.ID>>(new Set()),
  barrier: false,
}

const qwen = ModelV2.Ref.make({
  providerID: ProviderV2.ID.make("ollama"),
  id: ModelV2.ID.make("qwen3-coder-30b"),
})

const buildLayer = (value: StubState) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      WorkspaceService.node,
      FunctionalityInstance.node,
      OperatingChatSessionService.node,
    ]),
    [[OperatingChatSessionService.sessionPortLive, makePort(value)]],
  )

const it = testEffect(buildLayer(state))
const tuple = Workspace.Layout.Tuple.make({ user: "", style: "default", deviceClass: "desktop" })

function withBlock(workspaceID: Workspace.ID, blockID: string) {
  return Effect.gen(function* () {
    const workspace = yield* WorkspaceService.Service
    const layout = yield* workspace.layout.get(workspaceID, tuple, "operating-chat-test")
    yield* workspace.layout.save(
      workspaceID,
      tuple,
      [
        {
          id: blockID,
          functionality: "builtin:operating-chat-session",
          transform: { x: 0, y: 0, w: 4, h: 4, z: 0 },
        },
        ...layout.blocks.filter((entry) => entry.id !== blockID),
      ],
      layout.revision,
      "operating-chat-test",
    )
  })
}

describe("OperatingChat session lifecycle", () => {
  it.effect("requires operatingAgent and never falls back to workspace.model", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const operatingChat = yield* OperatingChatSessionService.Service
      const info = yield* workspace.create({ name: "unconfigured" })
      yield* workspace.update(info.id, { model: "openai:coordinator" })
      yield* withBlock(info.id, "block-a")

      const error = yield* operatingChat.ensure(info.id, "block-a").pipe(Effect.flip)
      expect(error._tag).toBe("OperatingChat.ConfigurationError")
    }),
  )

  it.effect("creates distinct modeled sessions per block and reconfigures existing bindings", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const operatingChat = yield* OperatingChatSessionService.Service
      const info = yield* workspace.create({ name: "modeled" })
      yield* workspace.update(info.id, { operatingAgent: "ollama:qwen3-coder-30b" })
      yield* withBlock(info.id, "block-a")
      yield* withBlock(info.id, "block-b")
      yield* Ref.set(state.created, [])
      yield* Ref.set(state.configured, [])

      const first = yield* operatingChat.ensure(info.id, "block-a")
      const second = yield* operatingChat.ensure(info.id, "block-b")
      expect(second.sessionID).not.toBe(first.sessionID)
      expect((yield* Ref.get(state.created)).map((entry) => entry.model)).toEqual([qwen, qwen])

      yield* operatingChat.ensure(info.id, "block-a")
      expect(yield* Ref.get(state.configured)).toEqual([{ sessionID: first.sessionID, model: qwen }])
    }),
  )

  it.effect("rejects reset while the bound Session is active", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const operatingChat = yield* OperatingChatSessionService.Service
      const info = yield* workspace.create({ name: "busy" })
      yield* workspace.update(info.id, { operatingAgent: "openai:gpt-5" })
      yield* withBlock(info.id, "block-a")
      const binding = yield* operatingChat.ensure(info.id, "block-a")
      yield* Ref.set(state.active, new Set<SessionSchema.ID>([binding.sessionID]))

      const error = yield* operatingChat
        .reset(info.id, "block-a", binding.sessionID, binding.revision)
        .pipe(Effect.flip)
      expect(error._tag).toBe("OperatingChat.BusyError")
      yield* Ref.set(state.active, new Set<SessionSchema.ID>())
    }),
  )

  it.effect("reset is revision-guarded and advances the binding generation", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const operatingChat = yield* OperatingChatSessionService.Service
      const info = yield* workspace.create({ name: "reset" })
      yield* workspace.update(info.id, { operatingAgent: "openai:gpt-5" })
      yield* withBlock(info.id, "block-a")
      const binding = yield* operatingChat.ensure(info.id, "block-a")

      const stale = yield* operatingChat
        .reset(info.id, "block-a", binding.sessionID, binding.revision + 1)
        .pipe(Effect.flip)
      expect(stale._tag).toBe("OperatingChat.StaleBindingError")

      const reset = yield* operatingChat.reset(info.id, "block-a", binding.sessionID, binding.revision)
      expect(reset.sessionID).not.toBe(binding.sessionID)
      expect(reset.generation).toBe(binding.generation + 1)
      expect(reset.revision).toBe(binding.revision + 1)
    }),
  )

  it.effect("rejects reset while Session input is pending", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const operatingChat = yield* OperatingChatSessionService.Service
      const info = yield* workspace.create({ name: "pending" })
      yield* workspace.update(info.id, { operatingAgent: "openai:gpt-5" })
      yield* withBlock(info.id, "block-a")
      const binding = yield* operatingChat.ensure(info.id, "block-a")
      yield* db
        .insert(SessionInputTable)
        .values({
          id: SessionMessage.ID.create(),
          session_id: binding.sessionID,
          prompt: Prompt.make({ text: "pending" }),
          delivery: "queue",
          admitted_seq: 0,
        })
        .run()
        .pipe(Effect.orDie)

      const error = yield* operatingChat
        .reset(info.id, "block-a", binding.sessionID, binding.revision)
        .pipe(Effect.flip)
      expect(error._tag).toBe("OperatingChat.BusyError")
    }),
  )

  it.effect("preserves a fixed directory binding across ensure and reset", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const operatingChat = yield* OperatingChatSessionService.Service
      const info = yield* workspace.create({ name: "fixed-directory" })
      yield* workspace.update(info.id, { operatingAgent: "openai:gpt-5" })
      yield* withBlock(info.id, "block-a")
      yield* db
        .insert(FunctionalityInstanceTable)
        .values({
          id: crypto.randomUUID(),
          workspace_id: info.id,
          block_id: "block-a",
          functionality_id: "builtin:operating-chat-session",
          revision: 0,
          configuration: {
            version: 1,
            directoryBinding: { mode: "fixed", directory: "/srv/operating" },
            sessionBinding: null,
          },
          deleted_at: null,
          time_updated: Date.now(),
        })
        .run()
        .pipe(Effect.orDie)

      const binding = yield* operatingChat.ensure(info.id, "block-a")
      expect(binding.directory).toBe("/srv/operating")
      const reset = yield* operatingChat.reset(info.id, "block-a", binding.sessionID, binding.revision)
      expect(reset.directory).toBe("/srv/operating")
      const created = yield* Ref.get(state.created)
      expect(created.slice(-2).map((entry) => entry.directory)).toEqual([
        AbsolutePath.make("/srv/operating"),
        AbsolutePath.make("/srv/operating"),
      ])
    }),
  )

  it.effect("publishes the persisted binding after ensure", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const operatingChat = yield* OperatingChatSessionService.Service
      const events = yield* EventV2.Service
      const info = yield* workspace.create({ name: "binding-event" })
      yield* workspace.update(info.id, { operatingAgent: "openai:gpt-5" })
      yield* withBlock(info.id, "block-a")
      const eventFiber = yield* events
        .subscribe(OperatingChat.BindingUpdated)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
      yield* Effect.yieldNow

      const binding = yield* operatingChat.ensure(info.id, "block-a")
      const received = Array.from(yield* Fiber.join(eventFiber))
      const persisted = yield* operatingChat.get(info.id, "block-a")
      expect(received).toHaveLength(1)
      expect(received[0]?.data).toEqual({
        workspaceID: info.id,
        blockID: "block-a",
        sessionID: binding.sessionID,
        generation: binding.generation,
        revision: binding.revision,
      })
      expect(persisted).toEqual(binding)
    }),
  )
})

describe("OperatingChat deterministic concurrency", () => {
  test("concurrent ensure returns one winner and cleans only the losing candidate", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const bothCreated = Effect.runSync(Deferred.make<void>())
    const concurrentState: StubState = {
      created: Effect.runSync(
        Ref.make<ReadonlyArray<{ id: SessionSchema.ID; model: ModelV2.Ref; directory: typeof AbsolutePath.Type }>>([]),
      ),
      configured: Effect.runSync(Ref.make<ReadonlyArray<{ sessionID: SessionSchema.ID; model: ModelV2.Ref }>>([])),
      discarded: Effect.runSync(Ref.make<ReadonlySet<SessionSchema.ID>>(new Set())),
      active: Effect.runSync(Ref.make<ReadonlySet<SessionSchema.ID>>(new Set())),
      barrier: true,
      gate,
      bothCreated,
    }

    await Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const operatingChat = yield* OperatingChatSessionService.Service
      const info = yield* workspace.create({ name: "ensure-race" })
      yield* workspace.update(info.id, { operatingAgent: "ollama:qwen3-coder-30b" })
      yield* withBlock(info.id, "block-a")

      const fiberA = yield* operatingChat.ensure(info.id, "block-a").pipe(Effect.forkChild)
      const fiberB = yield* operatingChat.ensure(info.id, "block-a").pipe(Effect.forkChild)
      yield* Deferred.await(bothCreated)
      yield* Deferred.succeed(gate, void 0)
      const [a, b] = yield* Effect.all([Fiber.join(fiberA), Fiber.join(fiberB)])

      expect(a.sessionID).toBe(b.sessionID)
      expect((yield* operatingChat.get(info.id, "block-a"))?.sessionID).toBe(a.sessionID)
      const created = yield* Ref.get(concurrentState.created)
      expect(created).toHaveLength(2)
      const discarded = yield* Ref.get(concurrentState.discarded)
      expect(discarded.size).toBe(1)
      expect(discarded.has(a.sessionID)).toBe(false)
      const loser = created.find((entry) => entry.id !== a.sessionID)
      expect(loser !== undefined && discarded.has(loser!.id)).toBe(true)
    }).pipe(Effect.provide(buildLayer(concurrentState)), Effect.runPromise)
  })
})
