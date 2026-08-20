import { describe, expect, test } from "bun:test"
import { Cause, DateTime, Effect, Exit, Layer, Ref, Stream } from "effect"
import type { MasterAgentService } from "@opencode-ai/core/workspace/master-agent"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { MasterAgentEvents } from "@opencode-ai/core/workspace/master-agent-events"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { FunctionalityInstance } from "@opencode-ai/core/workspace/functionality-instance"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { MasterAgent } from "@opencode-ai/schema/master-agent"
import { testEffect } from "../lib/effect"

// Lightweight Session stub: create returns a fresh Info, active is always
// empty (so reset is never blocked by a "running" session in these tests).
// Unused members fail loudly instead of returning fake data.
const makeInfo = (id: SessionSchema.ID) =>
  SessionSchema.Info.make({
    id,
    projectID: Project.ID.make("prj_test"),
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(Date.now()), updated: DateTime.makeUnsafe(Date.now()) },
    title: "master-agent-events-test",
    location: {
      directory: AbsolutePath.make(process.cwd()),
    },
  })

const sessionStub = Layer.succeed(
  SessionV2.Service,
  SessionV2.Service.of({
    list: () => Effect.succeed([]),
    create: (input) => Effect.succeed(makeInfo(input.id ?? SessionSchema.ID.create())),
    get: (sessionID) => Effect.succeed(makeInfo(sessionID)),
    messages: () => Effect.succeed([]),
    message: () => Effect.succeed(undefined),
    context: () => Effect.succeed([]),
    events: () => Stream.empty,
    history: () => Effect.succeed({ events: [], hasMore: false }),
    switchAgent: () => Effect.void,
    switchModel: () => Effect.void,
    prompt: () => Effect.die(new Error("prompt not stubbed")),
    shell: () => Effect.die(new Error("shell not stubbed")),
    skill: () => Effect.die(new Error("skill not stubbed")),
    compact: () => Effect.die(new Error("compact not stubbed")),
    wait: () => Effect.die(new Error("wait not stubbed")),
    active: Effect.succeed(new Set<SessionSchema.ID>()),
    resume: () => Effect.void,
    interrupt: () => Effect.void,
    revert: {
      stage: () => Effect.die(new Error("revert not stubbed")),
      clear: () => Effect.die(new Error("revert not stubbed")),
      commit: () => Effect.die(new Error("revert not stubbed")),
    },
  }),
)

// Uses the deprecated listen() deliberately: it registers the callback
// synchronously and publish() invokes listeners in the publishing fiber, so
// event counts are deterministic without relying on fiber scheduling.
function collectBindingUpdated(events: EventV2.Interface) {
  return Effect.gen(function* () {
    const received = yield* Ref.make<ReadonlyArray<EventV2.Payload<typeof MasterAgent.BindingUpdated>>>([])
    yield* events.listen((event) =>
      Ref.update(received, (list) =>
        event.type === MasterAgent.BindingUpdated.type
          ? [...list, event as EventV2.Payload<typeof MasterAgent.BindingUpdated>]
          : list,
      ),
    )
    return received
  })
}

const publisherIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, MasterAgentEvents.node])),
)

describe("master-agent binding events", () => {
  publisherIt.effect("publisher emits a validated binding-updated event", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const publisher = yield* MasterAgentEvents.MasterAgentEventPublisherService
      const received = yield* collectBindingUpdated(events)

      yield* publisher.bindingUpdated({
        workspaceID: Workspace.ID.make("wrk_pub_test"),
        blockID: "block-a",
        sessionID: SessionSchema.ID.create(),
        generation: 0,
        revision: 3,
      })

      const collected = yield* Ref.get(received)
      expect(collected).toHaveLength(1)
      const [event] = collected
      expect(event?.type).toBe(MasterAgent.BindingUpdated.type)
      expect(event?.data).toMatchObject({
        workspaceID: "wrk_pub_test",
        blockID: "block-a",
        generation: 0,
        revision: 3,
      })
      expect(event?.data.sessionID.startsWith("ses_")).toBe(true)
    }),
  )

  publisherIt.effect("publisher dies on an invalid payload and publishes nothing", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const publisher = yield* MasterAgentEvents.MasterAgentEventPublisherService
      const received = yield* collectBindingUpdated(events)

      const missingField = yield* publisher
        .bindingUpdated({
          workspaceID: Workspace.ID.make("wrk_pub_bad"),
          blockID: "block-a",
          sessionID: SessionSchema.ID.create(),
          generation: 0,
          // revision deliberately omitted — simulates an untyped caller
        } as MasterAgentEvents.BindingUpdatedEvent)
        .pipe(Effect.exit)
      expect(Exit.isFailure(missingField)).toBe(true)

      const negativeGeneration = yield* publisher
        .bindingUpdated({
          workspaceID: Workspace.ID.make("wrk_pub_bad"),
          blockID: "block-a",
          sessionID: SessionSchema.ID.create(),
          generation: -1,
          revision: 0,
        } as MasterAgentEvents.BindingUpdatedEvent)
        .pipe(Effect.exit)
      expect(Exit.isFailure(negativeGeneration)).toBe(true)

      expect(yield* Ref.get(received)).toHaveLength(0)
    }),
  )
})

// The lifecycle service (packages/core/src/workspace/master-agent.ts, owned by
// F4) is mid-flight and currently crashes at module load (missing LayerNode/
// tags imports), so it is imported lazily here. Unskip this suite once F4's
// file imports cleanly; the assertions already match the frozen contract
// (devplan/master-agent/master-agent-max-parallel-plan/02-contracts-and-data-model.md §8).
type IntegrationServices = {
  events: EventV2.Interface
  masterAgent: MasterAgentService.Interface
  workspace: WorkspaceService.Interface
}

async function runWithMasterAgent<A, E>(
  body: (services: IntegrationServices) => Effect.Effect<A, E, WorkspaceService.Service>,
): Promise<A> {
  const { MasterAgentService } = await import("@opencode-ai/core/workspace/master-agent")
  const layer = AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      WorkspaceService.node,
      FunctionalityInstance.node,
      MasterAgentService.node,
      MasterAgentEvents.node,
    ]),
    [[SessionV2.node, sessionStub]],
  )
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Effect.gen(function* () {
        return yield* body({
          events: yield* EventV2.Service,
          masterAgent: yield* MasterAgentService.Service,
          workspace: yield* WorkspaceService.Service,
        })
      }).pipe(Effect.scoped, Effect.provide(layer), Effect.exit)
    }),
  )
  if (Exit.isFailure(exit)) {
    for (const error of Cause.prettyErrors(exit.cause)) {
      console.error(error)
    }
    throw new Error("master-agent integration effect failed", { cause: exit.cause })
  }
  return exit.value
}

const tuple = Workspace.Layout.Tuple.make({ user: "", style: "default", deviceClass: "desktop" })

function withBlock(workspaceID: Workspace.ID, blockID: string) {
  return Effect.gen(function* () {
    const workspace = yield* WorkspaceService.Service
    const layout = yield* workspace.layout.get(workspaceID, tuple, "master-agent-events-test")
    yield* workspace.layout.save(
      workspaceID,
      tuple,
      [
        { id: blockID, functionality: "builtin:master-agent", transform: { x: 0, y: 0, w: 4, h: 4, z: 0 } },
        { id: "legacy", functionality: "builtin:chat", transform: { x: 0, y: 0, w: 4, h: 4, z: 0 } },
      ],
      layout.revision,
      "master-agent-events-test",
    )
  })
}

describe("master-agent binding events through the lifecycle service", () => {
  test("ensure publishes exactly one event for a successful transition", async () => {
    await runWithMasterAgent(({ events, masterAgent, workspace }) =>
      Effect.gen(function* () {
        const info = yield* workspace.create({ name: "e1-ensure" })
        yield* withBlock(info.id, "block-a")
        const received = yield* collectBindingUpdated(events)

        const binding = yield* masterAgent.ensure(info.id, "block-a")

        const collected = yield* Ref.get(received)
        expect(collected).toHaveLength(1)
        const [event] = collected
        expect(event?.data).toMatchObject({
          workspaceID: info.id,
          blockID: "block-a",
          sessionID: binding.sessionID,
          generation: 0,
          revision: binding.revision,
        })
      }),
    )
  })

  test("idempotent ensure publishes no event", async () => {
    await runWithMasterAgent(({ events, masterAgent, workspace }) =>
      Effect.gen(function* () {
        const info = yield* workspace.create({ name: "e1-idempotent" })
        yield* withBlock(info.id, "block-a")
        const received = yield* collectBindingUpdated(events)

        const first = yield* masterAgent.ensure(info.id, "block-a")
        expect(yield* Ref.get(received)).toHaveLength(1)

        const second = yield* masterAgent.ensure(info.id, "block-a")
        expect(second.sessionID).toBe(first.sessionID)
        expect(second.revision).toBe(first.revision)
        expect(yield* Ref.get(received)).toHaveLength(1)
      }),
    )
  })

  test("stale reset publishes no event", async () => {
    await runWithMasterAgent(({ events, masterAgent, workspace }) =>
      Effect.gen(function* () {
        const info = yield* workspace.create({ name: "e1-stale" })
        yield* withBlock(info.id, "block-a")
        const received = yield* collectBindingUpdated(events)

        const binding = yield* masterAgent.ensure(info.id, "block-a")

        const staleRevision = yield* masterAgent
          .reset(info.id, "block-a", binding.sessionID, binding.revision + 10)
          .pipe(Effect.flip)
        expect(staleRevision._tag).toBe("MasterAgent.StaleBindingError")

        const staleSession = yield* masterAgent
          .reset(info.id, "block-a", SessionSchema.ID.create(), binding.revision)
          .pipe(Effect.flip)
        expect(staleSession._tag).toBe("MasterAgent.StaleBindingError")

        expect(yield* Ref.get(received)).toHaveLength(1)
      }),
    )
  })

  test("reset publishes exactly one event with the next generation", async () => {
    await runWithMasterAgent(({ events, masterAgent, workspace }) =>
      Effect.gen(function* () {
        const info = yield* workspace.create({ name: "e1-reset" })
        yield* withBlock(info.id, "block-a")
        const received = yield* collectBindingUpdated(events)

        const binding = yield* masterAgent.ensure(info.id, "block-a")
        const reset = yield* masterAgent.reset(info.id, "block-a", binding.sessionID, binding.revision)

        const collected = yield* Ref.get(received)
        expect(collected).toHaveLength(2)
        const [, second] = collected
        expect(second?.data).toMatchObject({
          workspaceID: info.id,
          blockID: "block-a",
          sessionID: reset.sessionID,
          generation: binding.generation + 1,
          revision: reset.revision,
        })
      }),
    )
  })
})
