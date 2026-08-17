import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { MasterAgentService } from "@opencode-ai/core/workspace/master-agent"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { FunctionalityInstance } from "@opencode-ai/core/workspace/functionality-instance"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { testEffect } from "../lib/effect"

// Lightweight Session stub: create returns a fresh Info, active is always
// empty (so reset is never blocked by a "running" session in these tests).
const sessionStub = Layer.succeed(
  SessionV2.Service,
  SessionV2.Service.of({
    list: Effect.succeed([]),
    create: (input) =>
      Effect.gen(function* () {
        const id = input.id ?? SessionSchema.ID.create()
        return SessionSchema.Info.make({
          id,
          projectID: Project.ID.make("prj_test"),
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now(), updated: Date.now() },
          title: "master-agent-test",
          location: {
            directory: AbsolutePath.make(process.cwd()),
          },
        })
      }),
    get: Effect.succeed(undefined),
    messages: Effect.succeed([]),
    message: Effect.succeed(undefined),
    context: Effect.succeed([]),
    events: () => Effect.succeed([]) as never,
    history: Effect.succeed({ events: [], hasMore: false }),
    switchAgent: Effect.void,
    switchModel: Effect.void,
    prompt: Effect.succeed(undefined) as never,
    revert: Effect.succeed(undefined) as never,
    title: Effect.succeed(undefined) as never,
    archive: Effect.succeed(undefined) as never,
    fork: Effect.succeed(undefined) as never,
    remove: Effect.succeed(undefined) as never,
    active: Effect.succeed(new Set<SessionSchema.ID>()),
  }) as SessionV2.Service,
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, WorkspaceService.node, FunctionalityInstance.node, MasterAgentService.node]),
    [[LayerNode.from(SessionV2.Service, sessionStub)]],
  ),
)

const tuple = Workspace.Layout.Tuple.make({ user: "test", style: "default", deviceClass: "desktop" })

function withBlock(workspaceID: Workspace.ID, blockID: string) {
  return Effect.gen(function* () {
    const workspace = yield* WorkspaceService.Service
    const layout = yield* workspace.layout.get(workspaceID, tuple, "master-agent-test")
    yield* workspace.layout.save(
      workspaceID,
      tuple,
      [
        { id: blockID, functionality: "builtin:master-agent", transform: { x: 0, y: 0, w: 4, h: 4, z: 0 } },
        { id: "legacy", functionality: "builtin:chat", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
      ],
      layout.revision,
      "master-agent-test",
    )
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

      const reset = yield* masterAgent.reset(info.id, "block-a", a.sessionID, a.revision)
      expect(reset.sessionID).not.toBe(a.sessionID)
      expect(reset.generation).toBe(a.generation + 1)

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
})
