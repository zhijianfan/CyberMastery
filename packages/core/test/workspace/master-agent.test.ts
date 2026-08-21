import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Cause, DateTime, Deferred, Effect, Exit, Fiber, Layer, Option, Ref } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { BindingResolverService, MasterAgentService, bindingResolverNode } from "@opencode-ai/core/workspace/master-agent"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { FunctionalityInstance } from "@opencode-ai/core/workspace/functionality-instance"
import { FunctionalityInstanceTable } from "@opencode-ai/core/workspace/sql"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { testEffect } from "../lib/effect"

// Deterministic Session port stub: create records the requested location and
// inserts a minimal session row (so pending inputs can be checked against
// real FK constraints). The barrier (gate/bothCreated) forces concurrent
// ensures/resets to interleave at a known point instead of relying on timing
// sleeps: when enabled, create blocks until the second candidate exists.
type StubState = {
  readonly created: Ref.Ref<ReadonlyArray<SessionSchema.ID>>
  readonly creation: Ref.Ref<ReadonlyArray<{ agent?: string; model?: ModelV2.Ref }>>
  readonly configuration: Ref.Ref<ReadonlyArray<{ sessionID: SessionSchema.ID; agent: string; model?: ModelV2.Ref }>>
  readonly locations: Ref.Ref<ReadonlyArray<{ directory: string; workspaceID: Workspace.ID | undefined }>>
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
    title: "master-agent-test",
    location: { directory, workspaceID },
  })

const makePortStub = (state: StubState) =>
  Layer.effect(
    MasterAgentService.SessionPortService,
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
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
            yield* db
              .insert(SessionTable)
              .values({
                id,
                project_id: Project.ID.global,
                workspace_id: input.location.workspaceID,
                slug: "master-agent-test",
                directory: input.location.directory,
                title: "master-agent-test",
                version: "test",
              })
              .run()
              .pipe(Effect.orDie)
            yield* Ref.update(state.created, (list) => [...list, id])
            yield* Ref.update(state.creation, (list) => [
              ...list,
              {
                agent: (input as { agent?: string }).agent,
                model: (input as { model?: ModelV2.Ref }).model,
              },
            ])
            yield* Ref.update(state.locations, (list) => [
              ...list,
              { directory: input.location.directory, workspaceID: input.location.workspaceID },
            ])
            const { gate, bothCreated } = state
            if (state.barrier && gate && bothCreated) {
              if ((yield* Ref.get(state.created)).length >= 2) yield* Deferred.succeed(bothCreated, void 0)
              yield* Deferred.await(gate)
            }
            return makeInfo(id, input.location.directory, input.location.workspaceID)
          }),
        active: Ref.get(state.active),
        configure: (input) =>
          Ref.update(state.configuration, (list) => [
            ...list,
            { sessionID: input.sessionID, agent: input.agent, model: input.model },
          ]),
        cleanupLosingCandidate: (sessionID) =>
          Ref.update(state.discarded, (set) => new Set(set).add(sessionID)).pipe(Effect.as("removed" as const)),
      })
    }),
  )

// Default module-level stub for the sequential lifecycle tests. The state is
// shared across tests in this file (bun runs them sequentially); tests that
// assert on it reset the parts they depend on.
const stubState: StubState = {
  created: Ref.makeUnsafe<ReadonlyArray<SessionSchema.ID>>([]),
  creation: Ref.makeUnsafe<ReadonlyArray<{ agent?: string; model?: ModelV2.Ref }>>([]),
  configuration: Ref.makeUnsafe<ReadonlyArray<{ sessionID: SessionSchema.ID; agent: string; model?: ModelV2.Ref }>>([]),
  locations: Ref.makeUnsafe<ReadonlyArray<{ directory: string; workspaceID: Workspace.ID | undefined }>>([]),
  discarded: Ref.makeUnsafe<ReadonlySet<SessionSchema.ID>>(new Set()),
  active: Ref.makeUnsafe<ReadonlySet<SessionSchema.ID>>(new Set()),
  barrier: false,
}

const buildLayer = (state: StubState) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      WorkspaceService.node,
      FunctionalityInstance.node,
      MasterAgentService.node,
      bindingResolverNode,
    ]),
    [[MasterAgentService.sessionPortLive, makePortStub(state)]],
  )

const it = testEffect(buildLayer(stubState))

const tuple = Workspace.Layout.Tuple.make({ user: "", style: "default", deviceClass: "desktop" })

// Adds a master-agent block to the workspace layout, preserving existing
// blocks so multiple blocks can coexist in the same layout.
function withBlock(workspaceID: Workspace.ID, blockID: string) {
  return Effect.gen(function* () {
    const workspace = yield* WorkspaceService.Service
    const layout = yield* workspace.layout.get(workspaceID, tuple, "master-agent-test")
    const blocks = [
      { id: blockID, functionality: "builtin:master-agent", transform: { x: 0, y: 0, w: 4, h: 4, z: 0 } },
      ...layout.blocks.filter((entry) => entry.id !== blockID),
    ]
    yield* workspace.layout.save(workspaceID, tuple, blocks, layout.revision, "master-agent-test")
  })
}

describe("master-agent session lifecycle", () => {
  it.effect("ensure creates and binds one session; repeated ensure is idempotent", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "ma-1" })
      yield* withBlock(info.id, "block-a")
      const first = yield* masterAgent.ensure(info.id, "block-a")
      expect(first.sessionID.startsWith("ses_")).toBe(true)
      const second = yield* masterAgent.ensure(info.id, "block-a")
      expect(second.sessionID).toBe(first.sessionID)
      expect(second.revision).toBe(first.revision)
    }),
  )

  it.effect("ensure creates the configured parallel master session from the workspace model", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "ma-model" })
      yield* workspace.update(info.id, { model: "openai:gpt-5.3-codex/spark:reasoning" })
      yield* withBlock(info.id, "block-a")
      yield* Ref.set(stubState.creation, [])
      yield* masterAgent.ensure(info.id, "block-a")
      expect(yield* Ref.get(stubState.creation)).toEqual([
        {
          agent: "parallel-master",
          model: ModelV2.Ref.make({
            providerID: ProviderV2.ID.make("openai"),
            id: ModelV2.ID.make("gpt-5.3-codex/spark"),
            variant: ModelV2.VariantID.make("reasoning"),
          }),
        },
      ])
    }),
  )

  it.effect("ensure reconfigures an existing binding without creating another session", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "ma-reconfigure" })
      yield* workspace.update(info.id, { model: "openai:gpt-5.3-codex/spark:reasoning" })
      yield* withBlock(info.id, "block-a")
      const binding = yield* masterAgent.ensure(info.id, "block-a")
      yield* Ref.set(stubState.creation, [])
      yield* Ref.set(stubState.configuration, [])
      yield* masterAgent.ensure(info.id, "block-a")
      expect(yield* Ref.get(stubState.creation)).toEqual([])
      expect(yield* Ref.get(stubState.configuration)).toEqual([
        {
          sessionID: binding.sessionID,
          agent: "parallel-master",
          model: ModelV2.Ref.make({
            providerID: ProviderV2.ID.make("openai"),
            id: ModelV2.ID.make("gpt-5.3-codex/spark"),
            variant: ModelV2.VariantID.make("reasoning"),
          }),
        },
      ])
    }),
  )

  it.effect("reset creates a parallel master session with the current workspace model", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "ma-reset-model" })
      yield* withBlock(info.id, "block-a")
      const binding = yield* masterAgent.ensure(info.id, "block-a")
      yield* workspace.update(info.id, { model: "anthropic:claude/code:fast" })
      yield* Ref.set(stubState.creation, [])
      yield* masterAgent.reset(info.id, "block-a", binding.sessionID, binding.revision)
      expect(yield* Ref.get(stubState.creation)).toEqual([
        {
          agent: "parallel-master",
          model: ModelV2.Ref.make({
            providerID: ProviderV2.ID.make("anthropic"),
            id: ModelV2.ID.make("claude/code"),
            variant: ModelV2.VariantID.make("fast"),
          }),
        },
      ])
    }),
  )

  it.effect("two blocks receive distinct sessions", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "ma-2" })
      yield* withBlock(info.id, "block-a")
      yield* withBlock(info.id, "block-b")
      const a = yield* masterAgent.ensure(info.id, "block-a")
      const b = yield* masterAgent.ensure(info.id, "block-b")
      expect(a.sessionID).not.toBe(b.sessionID)
    }),
  )

  it.effect("reset changes only the target block and rejects stale revisions", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "ma-3" })
      yield* withBlock(info.id, "block-a")
      yield* withBlock(info.id, "block-b")
      const a = yield* masterAgent.ensure(info.id, "block-a")
      const b = yield* masterAgent.ensure(info.id, "block-b")

      const stale = yield* masterAgent.reset(info.id, "block-a", a.sessionID, a.revision + 10).pipe(Effect.flip)
      expect(stale._tag).toBe("MasterAgent.StaleBindingError")

      const wrongSession = yield* masterAgent
        .reset(info.id, "block-a", SessionSchema.ID.create(), a.revision)
        .pipe(Effect.flip)
      expect(wrongSession._tag).toBe("MasterAgent.StaleBindingError")

      const reset = yield* masterAgent.reset(info.id, "block-a", a.sessionID, a.revision)
      expect(reset.sessionID).not.toBe(a.sessionID)
      expect(reset.generation).toBe(a.generation + 1)
      expect(reset.revision).toBe(a.revision + 1)

      const untouched = yield* masterAgent.get(info.id, "block-b")
      expect(untouched?.sessionID).toBe(b.sessionID)
    }),
  )

  it.effect("wrong functionality id is rejected", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "ma-4" })
      const layout = yield* workspace.layout.get(info.id, tuple, "master-agent-test")
      yield* workspace.layout.save(
        info.id,
        tuple,
        [{ id: "block-x", functionality: "builtin:chat", transform: { x: 0, y: 0, w: 4, h: 4, z: 0 } }],
        layout.revision,
        "master-agent-test",
      )
      const error = yield* masterAgent.ensure(info.id, "block-x").pipe(Effect.flip)
      expect(error._tag).toBe("MasterAgent.WrongFunctionalityError")
    }),
  )

  it.effect("tombstone removes the instance but preserves the session", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "ma-5" })
      yield* withBlock(info.id, "block-a")
      const binding = yield* masterAgent.ensure(info.id, "block-a")
      yield* masterAgent.tombstone(info.id, "block-a")
      const after = yield* masterAgent.get(info.id, "block-a")
      expect(after).toBeUndefined()
      const rebound = yield* masterAgent.ensure(info.id, "block-a")
      expect(rebound.sessionID).not.toBe(binding.sessionID)
    }),
  )

  it.effect("reset refuses a session that is still active", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "ma-6" })
      yield* withBlock(info.id, "block-a")
      const binding = yield* masterAgent.ensure(info.id, "block-a")
      yield* Ref.set(stubState.active, new Set([binding.sessionID]))
      const error = yield* masterAgent.reset(info.id, "block-a", binding.sessionID, binding.revision).pipe(Effect.flip)
      expect(error._tag).toBe("MasterAgent.BusyError")
    }),
  )

  it.effect("reset refuses a session with pending inputs, then succeeds once promoted", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "ma-7" })
      yield* withBlock(info.id, "block-a")
      const binding = yield* masterAgent.ensure(info.id, "block-a")
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
      const error = yield* masterAgent.reset(info.id, "block-a", binding.sessionID, binding.revision).pipe(Effect.flip)
      expect(error._tag).toBe("MasterAgent.BusyError")
      yield* db
        .update(SessionInputTable)
        .set({ promoted_seq: 1 })
        .where(eq(SessionInputTable.session_id, binding.sessionID))
        .run()
        .pipe(Effect.orDie)
      const reset = yield* masterAgent.reset(info.id, "block-a", binding.sessionID, binding.revision)
      expect(reset.sessionID).not.toBe(binding.sessionID)
    }),
  )

  it.effect("ensure honors a fixed directory binding before session creation; reset preserves it", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "ma-8" })
      yield* withBlock(info.id, "block-a")
      // Seed an unbound instance with a fixed directory binding, as a host
      // integration would. ensure must create the session there, and reset
      // must not downgrade the binding to workspace-primary.
      yield* db
        .insert(FunctionalityInstanceTable)
        .values({
          id: crypto.randomUUID(),
          workspace_id: info.id,
          block_id: "block-a",
          functionality_id: "builtin:master-agent",
          revision: 0,
          configuration: {
            version: 1,
            directoryBinding: { mode: "fixed", directory: "/srv/agent" },
            sessionBinding: null,
          },
          deleted_at: null,
          time_updated: Date.now(),
        })
        .run()
        .pipe(Effect.orDie)
      const binding = yield* masterAgent.ensure(info.id, "block-a")
      expect(binding.directory).toBe("/srv/agent")
      const locations = yield* Ref.get(stubState.locations)
      expect(locations[locations.length - 1]?.directory).toBe("/srv/agent")
      const reset = yield* masterAgent.reset(info.id, "block-a", binding.sessionID, binding.revision)
      expect(reset.directory).toBe("/srv/agent")
    }),
  )

  it.effect("resolves only the exact live master-agent session binding", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const resolver = yield* BindingResolverService.Service
      const info = yield* workspace.create({ name: "ma-resolve" })
      yield* withBlock(info.id, "block-a")
      yield* withBlock(info.id, "block-b")
      const first = yield* masterAgent.ensure(info.id, "block-a")
      const other = yield* masterAgent.ensure(info.id, "block-b")
      expect(yield* resolver.resolveSession(first.sessionID)).toEqual(first)
      expect(yield* resolver.resolveSession(other.sessionID)).toEqual(other)
      expect(yield* resolver.resolveSession(SessionSchema.ID.create())).toBeUndefined()

      yield* db
        .update(FunctionalityInstanceTable)
        .set({ configuration: { malformed: true } })
        .where(eq(FunctionalityInstanceTable.id, first.functionalityInstanceID))
        .run()
        .pipe(Effect.orDie)
      expect(yield* resolver.resolveSession(first.sessionID)).toBeUndefined()
      expect(yield* resolver.resolveSession(other.sessionID)).toEqual(other)

      const second = yield* masterAgent.reset(info.id, "block-b", other.sessionID, other.revision)
      expect(yield* resolver.resolveSession(other.sessionID)).toBeUndefined()
      expect(yield* resolver.resolveSession(second.sessionID)).toEqual(second)

      yield* masterAgent.tombstone(info.id, "block-b")
      expect(yield* resolver.resolveSession(second.sessionID)).toBeUndefined()
    }),
  )
})

describe("master-agent deterministic concurrency", () => {
  test("concurrent ensure: one binding wins, the loser returns it and discards only its unbound candidate", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const bothCreated = Effect.runSync(Deferred.make<void>())
    const state: StubState = {
      created: Effect.runSync(Ref.make<ReadonlyArray<SessionSchema.ID>>([])),
      creation: Effect.runSync(Ref.make<ReadonlyArray<{ agent?: string; model?: ModelV2.Ref }>>([])),
      configuration: Effect.runSync(
        Ref.make<ReadonlyArray<{ sessionID: SessionSchema.ID; agent: string; model?: ModelV2.Ref }>>([]),
      ),
      locations: Effect.runSync(
        Ref.make<ReadonlyArray<{ directory: string; workspaceID: Workspace.ID | undefined }>>([]),
      ),
      discarded: Effect.runSync(Ref.make<ReadonlySet<SessionSchema.ID>>(new Set())),
      active: Effect.runSync(Ref.make<ReadonlySet<SessionSchema.ID>>(new Set())),
      barrier: true,
      gate,
      bothCreated,
    }
    await Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "ma-race" })
      yield* withBlock(info.id, "block-a")

      const fiberA = yield* masterAgent.ensure(info.id, "block-a").pipe(Effect.forkChild)
      const fiberB = yield* masterAgent.ensure(info.id, "block-a").pipe(Effect.forkChild)
      // Both candidates exist before either may persist: the stub's create
      // blocks on the gate until the second create signals bothCreated.
      yield* Deferred.await(bothCreated)
      yield* Deferred.succeed(gate, void 0)
      const [a, b] = yield* Effect.all([Fiber.join(fiberA), Fiber.join(fiberB)])

      expect(a.sessionID).toBe(b.sessionID)
      const persisted = yield* masterAgent.get(info.id, "block-a")
      expect(persisted?.sessionID).toBe(a.sessionID)

      const created = yield* Ref.get(state.created)
      expect(created).toHaveLength(2)
      const discarded = yield* Ref.get(state.discarded)
      expect(discarded.size).toBe(1)
      // The winner's session is never discarded; only the unbound candidate is.
      expect(discarded.has(a.sessionID)).toBe(false)
      const loser = created.find((id) => id !== a.sessionID)
      expect(loser !== undefined && discarded.has(loser!)).toBe(true)
    }).pipe(Effect.provide(buildLayer(state)), Effect.runPromise)
  })

  test("concurrent reset: one CAS wins, the loser gets StaleBindingError and discards its candidate", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const bothCreated = Effect.runSync(Deferred.make<void>())
    const state: StubState = {
      created: Effect.runSync(Ref.make<ReadonlyArray<SessionSchema.ID>>([])),
      creation: Effect.runSync(Ref.make<ReadonlyArray<{ agent?: string; model?: ModelV2.Ref }>>([])),
      configuration: Effect.runSync(
        Ref.make<ReadonlyArray<{ sessionID: SessionSchema.ID; agent: string; model?: ModelV2.Ref }>>([]),
      ),
      locations: Effect.runSync(
        Ref.make<ReadonlyArray<{ directory: string; workspaceID: Workspace.ID | undefined }>>([]),
      ),
      discarded: Effect.runSync(Ref.make<ReadonlySet<SessionSchema.ID>>(new Set())),
      active: Effect.runSync(Ref.make<ReadonlySet<SessionSchema.ID>>(new Set())),
      barrier: false,
      gate,
      bothCreated,
    }
    await Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "ma-reset-race" })
      yield* withBlock(info.id, "block-a")
      const binding = yield* masterAgent.ensure(info.id, "block-a")
      // Only the two racing resets are gated.
      state.barrier = true
      yield* Ref.set(state.created, [])
      yield* Ref.set(state.discarded, new Set())

      const fiberA = yield* masterAgent
        .reset(info.id, "block-a", binding.sessionID, binding.revision)
        .pipe(Effect.forkChild)
      const fiberB = yield* masterAgent
        .reset(info.id, "block-a", binding.sessionID, binding.revision)
        .pipe(Effect.forkChild)
      yield* Deferred.await(bothCreated)
      yield* Deferred.succeed(gate, void 0)
      const exitA = yield* Fiber.join(fiberA).pipe(Effect.exit)
      const exitB = yield* Fiber.join(fiberB).pipe(Effect.exit)

      const successes = [exitA, exitB].filter(Exit.isSuccess).map((exit) => exit.value)
      const failures = [exitA, exitB].filter(Exit.isFailure).map((exit) => Cause.findErrorOption(exit.cause))
      expect(successes).toHaveLength(1)
      expect(failures).toHaveLength(1)
      const winner = successes[0]!
      expect(winner.generation).toBe(binding.generation + 1)
      expect(winner.sessionID).not.toBe(binding.sessionID)
      const stale = failures[0]!
      expect(Option.isSome(stale) && stale.value._tag === "MasterAgent.StaleBindingError").toBe(true)

      const persisted = yield* masterAgent.get(info.id, "block-a")
      expect(persisted?.sessionID).toBe(winner.sessionID)
      const discarded = yield* Ref.get(state.discarded)
      expect(discarded.size).toBe(1)
      // Neither the winner's session nor the old bound session is discarded.
      expect(discarded.has(winner.sessionID)).toBe(false)
      expect(discarded.has(binding.sessionID)).toBe(false)
    }).pipe(Effect.provide(buildLayer(state)), Effect.runPromise)
  })
})
