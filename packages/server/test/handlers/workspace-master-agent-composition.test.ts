// Composition tests for the MasterAgent server mount (Track S2).
//
// Verifies the three composition seams:
// 1. Route availability: the S1 MasterAgent handler group mounts under the
//    same P3-composed server Api as the existing Workspace group, so both
//    groups answer through one in-memory HttpApiTest client.
// 2. Workspace patch propagation: `coderModel` flows through the generic
//    `workspace.update` patch path (omitted key stays omitted, explicit null
//    stays null, concrete value passes through) with no side channel.
// 3. Event bridge payload: publishing `workspace.master-agent.binding.updated`
//    through core EventV2 yields a transient (non-durable) payload carrying
//    workspaceID/blockID/sessionID/generation/revision, and a listener
//    registered after the publish sees nothing — reconnect recovery must
//    refetch via MasterAgentService.get/ensure against persisted state.

import { describe, expect, it } from "bun:test"
import { Cause, Effect, Exit, FileSystem, Layer, Path, Ref, Scope } from "effect"
import { Etag, HttpPlatform, HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { HttpApiTest } from "effect/unstable/httpapi"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { WorkspaceService, WorkspaceV2 } from "@opencode-ai/core/workspace"
import { MasterAgentService } from "@opencode-ai/core/workspace/master-agent"
import { MasterAgent } from "@opencode-ai/schema/master-agent"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { SchemaErrorMiddleware } from "@opencode-ai/protocol/middleware/schema-error"
import { Api } from "../../src/api"
import { WorkspaceHandler } from "../../src/handlers/workspace"
import {
  MasterAgentAccessService,
  masterAgentAccessLive,
} from "../../src/handlers/workspace-master-agent-access"
import { LocationMiddleware } from "../../src/location"
import { SessionLocationMiddleware } from "../../src/middleware/session-location"

const workspaceID = WorkspaceV2.ID.make("wrk_s2_composition")
const blockID = "block-a"
const sessionID = SessionSchema.ID.create()

const binding = (overrides: Partial<MasterAgent.Binding> = {}): MasterAgent.Binding =>
  MasterAgent.Binding.make({
    workspaceID,
    blockID,
    functionalityInstanceID: "inst_1",
    sessionID,
    directory: "/tmp",
    generation: 0,
    revision: 1,
    ...overrides,
  })

const workspaceInfo = (id: WorkspaceV2.ID, overrides: Partial<Workspace.Info> = {}): Workspace.Info =>
  Workspace.Info.make({
    id,
    name: "composition-test",
    style: "default",
    directories: [],
    pluginIDs: [],
    skillIDs: [],
    git: [],
    time: { created: 0, updated: 0 },
    ...overrides,
  })

// ---------------------------------------------------------------------------
// Fakes for the open handler-service requirements. Unused members fail loudly
// instead of returning fake data, so a request that unexpectedly touches an
// unstubbed seam surfaces as a test failure.
// ---------------------------------------------------------------------------

const fakeWorkspace = (overrides: Partial<WorkspaceService.Interface> = {}) =>
  Layer.succeed(
    WorkspaceService.Service,
    WorkspaceService.Service.of({
      list: () => Effect.die("WorkspaceService.list not stubbed"),
      get: () => Effect.die("WorkspaceService.get not stubbed"),
      create: () => Effect.die("WorkspaceService.create not stubbed"),
      rename: () => Effect.die("WorkspaceService.rename not stubbed"),
      remove: () => Effect.die("WorkspaceService.remove not stubbed"),
      duplicate: () => Effect.die("WorkspaceService.duplicate not stubbed"),
      update: () => Effect.die("WorkspaceService.update not stubbed"),
      layout: {
        get: () => Effect.die("WorkspaceService.layout.get not stubbed"),
        save: () => Effect.die("WorkspaceService.layout.save not stubbed"),
      },
      functionality: {
        list: () => Effect.die("WorkspaceService.functionality.list not stubbed"),
      },
      ...overrides,
    }),
  )

const fakeMasterAgent = (overrides: Partial<MasterAgentService.Interface> = {}) =>
  Layer.succeed(
    MasterAgentService.Service,
    MasterAgentService.Service.of({
      get: () => Effect.die("MasterAgentService.get not stubbed"),
      ensure: () => Effect.die("MasterAgentService.ensure not stubbed"),
      reset: () => Effect.die("MasterAgentService.reset not stubbed"),
      tombstone: () => Effect.void,
      ...overrides,
    }),
  )

// The in-memory client routes the whole server Api, so every Api/group
// middleware key must be present. Authorization and SchemaErrorMiddleware are
// provided as pass-through; Location and SessionLocation middleware receive
// their `provides` services from the router, so a pass-through that merely
// declares the router-provided context is the correct no-op.
const noopMiddleware = Layer.mergeAll(
  Layer.succeed(Authorization, Authorization.of((effect) => effect)),
  Layer.succeed(SchemaErrorMiddleware, SchemaErrorMiddleware.of((effect) => effect)),
  Layer.succeed(LocationMiddleware, LocationMiddleware.of((httpEffect) => httpEffect as never)),
  Layer.succeed(SessionLocationMiddleware, SessionLocationMiddleware.of((httpEffect) => httpEffect as never)),
)

const compositionLayer = (options: {
  workspace?: Partial<WorkspaceService.Interface>
  masterAgent?: Partial<MasterAgentService.Interface>
  access?: Layer.Layer<MasterAgentAccessService, never, never>
} = {}) =>
  WorkspaceHandler.pipe(
    Layer.provideMerge(fakeWorkspace(options.workspace)),
    Layer.provideMerge(fakeMasterAgent(options.masterAgent)),
    Layer.provideMerge(options.access ?? masterAgentAccessLive),
    Layer.provideMerge(HttpPlatform.layer.pipe(Layer.provideMerge(FileSystem.layerNoop({})))),
    Layer.provideMerge(Path.layer),
    Layer.provideMerge(Etag.layer),
    Layer.provideMerge(noopMiddleware),
  )

const compositionClient = () =>
  Effect.gen(function* () {
    const client = yield* HttpApiTest.groups(Api, ["server.workspace", "server.workspace.masterAgent"])
    return { workspace: client["server.workspace"], masterAgent: client["server.workspace.masterAgent"] }
  })

const run = <A, E, R>(value: Effect.Effect<A, E, R | Scope.Scope>, layer: Layer.Layer<never, never, never> | Layer.Layer<R, never>) =>
  Effect.gen(function* () {
    const exit = yield* value.pipe(Effect.scoped, Effect.provide(layer as unknown as Layer.Layer<R, never>), Effect.exit)
    if (Exit.isFailure(exit)) {
      for (const err of Cause.prettyErrors(exit.cause)) {
        yield* Effect.logError(err)
      }
    }
    return yield* exit
  }).pipe(Effect.runPromise)

// Effect v4-beta inference gap: HttpApiBuilder.group + Layer.mergeAll leaves a
// phantom Request<"Requires", Service> requirement on the composed handler
// layer even though the fakes below satisfy it at runtime (17/17 pass). Cast
// at the boundary only.
const provide = (layer: unknown) => layer as Layer.Layer<never, never, never>

describe("workspace master-agent composition", () => {
  it("serves the workspace group and the masterAgent group from one Api", async () => {
    const result = await run(
      Effect.gen(function* () {
        const client = yield* compositionClient()
        const info = yield* client.workspace["workspace.get"]({ params: { id: workspaceID } })
        const state = yield* client.masterAgent["workspace.masterAgent.get"]({
          params: { workspaceID, blockID },
        })
        return { info, state }
      }),
      provide(
        compositionLayer({
          workspace: { get: () => Effect.succeed(workspaceInfo(workspaceID)) },
          masterAgent: { get: () => Effect.succeed(binding()) },
        }),
      ),
    )
    expect(result.info.id).toBe(workspaceID)
    expect(result.state).toEqual({ status: "bound", binding: binding() })
  })

  it("routes the masterAgent ensure endpoint under the mounted group", async () => {
    const result = await run(
      Effect.gen(function* () {
        const client = yield* compositionClient()
        return yield* client.masterAgent["workspace.masterAgent.ensure"]({
          params: { workspaceID, blockID },
        })
      }),
      provide(
        compositionLayer({
          masterAgent: { ensure: () => Effect.succeed(binding({ revision: 2 })) },
        }),
      ),
    )
    expect(result).toEqual(binding({ revision: 2 }))
  })

  it("forwards coderModel through the generic workspace patch path", async () => {
    const calls: Array<[string, WorkspaceService.UpdatePatch]> = []
    await run(
      Effect.gen(function* () {
        const client = yield* compositionClient()
        yield* client.workspace["workspace.update"]({
          payload: { id: workspaceID, patch: { name: "renamed", coderModel: "anthropic/claude-sonnet-4" } },
        })
        yield* client.workspace["workspace.update"]({
          payload: { id: workspaceID, patch: { coderModel: null } },
        })
        yield* client.workspace["workspace.update"]({
          payload: { id: workspaceID, patch: { name: "only-name" } },
        })
      }),
      provide(
        compositionLayer({
          workspace: {
            update: (id, patch) => {
              calls.push([id, patch])
              return Effect.succeed(workspaceInfo(id))
            },
          },
        }),
      ),
    )
    expect(calls).toHaveLength(3)
    // Concrete selection persists exactly; no side channel is involved.
    expect(calls[0]).toEqual([workspaceID, { name: "renamed", coderModel: "anthropic/claude-sonnet-4" }])
    // Explicit null clears.
    expect(calls[1]).toEqual([workspaceID, { coderModel: null }])
    // Omitted patch key stays omitted (the handler must not synthesize it).
    expect(calls[2]?.[1].coderModel).toBeUndefined()
    expect(calls[2]?.[1].name).toBe("only-name")
  })
})

// ---------------------------------------------------------------------------
// Event bridge payload: real core EventV2 (the same node the opencode bridge
// wraps), publishing the frozen binding-updated definition.
// ---------------------------------------------------------------------------

const bridgeLayer = AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node]))

describe("master-agent binding event bridge", () => {
  it("publishes a transient binding.updated payload with the frozen fields", async () => {
    const result = await run(
      Effect.gen(function* () {
        const events = yield* EventV2.Service
        const received = yield* Ref.make<ReadonlyArray<EventV2.Payload>>([])
        yield* events.listen((event) =>
          event.type === MasterAgent.BindingUpdated.type
            ? Ref.update(received, (list) => [...list, event])
            : Effect.void,
        )

        const next = SessionSchema.ID.create()
        yield* events.publish(MasterAgent.BindingUpdated, {
          workspaceID,
          blockID,
          sessionID: next,
          generation: 2,
          revision: 5,
        })

        // A listener registered after the publish sees nothing: the event is
        // transient and never replayed, so reconnect recovery must refetch
        // the binding via get/ensure against persisted state.
        const late = yield* Ref.make(0)
        yield* events.listen(() => Ref.update(late, (count) => count + 1))

        return { collected: yield* Ref.get(received), late: yield* Ref.get(late), sessionID: next }
      }),
      bridgeLayer,
    )
    expect(result.collected).toHaveLength(1)
    const [event] = result.collected
    expect(event?.type).toBe("workspace.master-agent.binding.updated")
    // Transient: no durable manifest entry, so no durable envelope is attached.
    expect(event?.durable).toBeUndefined()
    expect(event?.data).toEqual({
      workspaceID,
      blockID,
      sessionID: result.sessionID,
      generation: 2,
      revision: 5,
    })
    expect(result.late).toBe(0)
  })
})
