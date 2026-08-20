// MasterAgent API integration tests (Track V1, server side).
//
// Exercises the full real stack through the in-memory HttpApi client: real
// Database, WorkspaceService (D4), FunctionalityInstance (F1 CAS),
// MasterAgentService (F4), the real SessionV2 session domain, and the real
// EventV2 bus, all mounted through the S2 composition (WorkspaceHandler) with
// the S1 handler layer and the permissive access port.
//
// Contract basis: devplan/master-agent/master-agent-max-parallel-plan/02-contracts-and-data-model.md
// §8 (publish only after persistence; transient, never replayed) and §11
// (reconnect triggers authoritative get/ensure). The S2 mount shape this file
// tests against is the landed composition in packages/server/src/handlers/
// workspace.ts (MasterAgent group merged under the Workspace handler).
//
// Session execution is not started: SessionExecution is the noop layer and
// ProjectV2 resolves to the global project (same pattern as
// packages/core/test/session-create.test.ts).

import { describe, expect, it } from "bun:test"
import { Cause, Effect, Exit, FileSystem, Layer, Path, Ref, Scope } from "effect"
import { Etag, HttpPlatform, HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { HttpApiTest } from "effect/unstable/httpapi"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { FunctionalityInstance } from "@opencode-ai/core/workspace/functionality-instance"
import { MasterAgentService } from "@opencode-ai/core/workspace/master-agent"
import { MasterAgent } from "@opencode-ai/schema/master-agent"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { SchemaErrorMiddleware } from "@opencode-ai/protocol/middleware/schema-error"
import { Api } from "../../src/api"
import { WorkspaceHandler } from "../../src/handlers/workspace"
import { masterAgentAccessLive } from "../../src/handlers/workspace-master-agent-access"
import { LocationMiddleware } from "../../src/location"
import { SessionLocationMiddleware } from "../../src/middleware/session-location"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

// A fresh real stack per test, so EventV2 listeners never leak between tests;
// the shared database file is the only cross-test state.
const realStack = () =>
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      WorkspaceService.node,
      FunctionalityInstance.node,
      MasterAgentService.node,
    ]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  )

// Every Api/group middleware key must be present for the in-memory client;
// pass them through as no-ops.
const noopMiddleware = Layer.mergeAll(
  Layer.succeed(
    Authorization,
    Authorization.of((effect) => effect),
  ),
  Layer.succeed(
    SchemaErrorMiddleware,
    SchemaErrorMiddleware.of((effect) => effect),
  ),
  Layer.succeed(
    LocationMiddleware,
    LocationMiddleware.of((httpEffect) => httpEffect as never),
  ),
  Layer.succeed(
    SessionLocationMiddleware,
    SessionLocationMiddleware.of((httpEffect) => httpEffect as never),
  ),
)

const serverLayer = () =>
  WorkspaceHandler.pipe(
    Layer.provideMerge(masterAgentAccessLive),
    Layer.provideMerge(realStack()),
    Layer.provideMerge(HttpPlatform.layer.pipe(Layer.provideMerge(FileSystem.layerNoop({})))),
    Layer.provideMerge(Path.layer),
    Layer.provideMerge(Etag.layer),
    Layer.provideMerge(noopMiddleware),
  )

const compositionClient = Effect.gen(function* () {
  const client = yield* HttpApiTest.groups(Api, ["server.workspace", "server.workspace.masterAgent"])
  return { workspace: client["server.workspace"], masterAgent: client["server.workspace.masterAgent"] }
})

type Client = Effect.Success<typeof compositionClient>

const run = <A, E, R>(
  value: Effect.Effect<A, E, R | Scope.Scope>,
  layer: Layer.Layer<never, never, never> | Layer.Layer<R, never>,
) =>
  Effect.gen(function* () {
    const exit = yield* value.pipe(
      Effect.scoped,
      Effect.provide(layer as unknown as Layer.Layer<R, never>),
      Effect.exit,
    )
    if (Exit.isFailure(exit)) {
      for (const err of Cause.prettyErrors(exit.cause)) {
        yield* Effect.logError(err)
      }
    }
    return yield* exit
  }).pipe(Effect.runPromise)

// Effect v4-beta inference gap: the composed handler layer keeps a phantom
// Request<"Requires", Service> requirement even though the test layers satisfy
// it at runtime (17/17 pass). Cast at the boundary only.
const provide = (layer: unknown) => layer as Layer.Layer<never, never, never>

const tuple = Workspace.Layout.Tuple.make({ user: "", style: "default", deviceClass: "desktop" })
const clientID = "master-agent-api-test"

// Adds a master-agent block to the workspace layout through the HTTP API,
// preserving existing blocks so multiple blocks can coexist.
const withBlock = (client: Client, workspaceID: Workspace.ID, blockID: string) =>
  Effect.gen(function* () {
    const layout = yield* client.workspace["workspace.layout.get"]({
      payload: { workspaceID, tuple, clientID },
    })
    const saved = yield* client.workspace["workspace.layout.save"]({
      payload: {
        workspaceID,
        tuple,
        clientID,
        expectedRevision: layout.revision,
        blocks: [
          { id: blockID, functionality: "builtin:master-agent", transform: { x: 0, y: 0, w: 4, h: 4, z: 0 } },
          ...layout.blocks.filter((entry) => entry.id !== blockID),
        ],
      },
    })
    expect(saved.status).toBe("saved")
  })

const collectBindingUpdated = (events: EventV2.Interface) =>
  Effect.gen(function* () {
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

describe("master-agent api integration", () => {
  it("HTTP ensure persists a binding and publishes exactly one binding.updated event", async () => {
    const result = await run(
      Effect.gen(function* () {
        const client = yield* compositionClient
        const events = yield* EventV2.Service
        const received = yield* collectBindingUpdated(events)

        const info = yield* client.workspace["workspace.create"]({ payload: { name: "ma-api-1" } })
        yield* withBlock(client, info.id, "block-a")
        const binding = yield* client.masterAgent["workspace.masterAgent.ensure"]({
          params: { workspaceID: info.id, blockID: "block-a" },
        })
        const fetched = yield* client.masterAgent["workspace.masterAgent.get"]({
          params: { workspaceID: info.id, blockID: "block-a" },
        })
        return { binding, fetched, collected: yield* Ref.get(received) }
      }),
      provide(serverLayer()),
    )

    expect(result.collected).toHaveLength(1)
    const [event] = result.collected
    expect(event?.data).toEqual({
      workspaceID: result.binding.workspaceID,
      blockID: "block-a",
      sessionID: result.binding.sessionID,
      generation: result.binding.generation,
      revision: result.binding.revision,
    })
    expect(result.fetched).toEqual({ status: "bound", binding: result.binding })
  })

  it("a listener attached after ensure misses the transient event; get refetches persisted state", async () => {
    const result = await run(
      Effect.gen(function* () {
        const client = yield* compositionClient
        const events = yield* EventV2.Service

        const info = yield* client.workspace["workspace.create"]({ payload: { name: "ma-api-2" } })
        yield* withBlock(client, info.id, "block-b")
        const binding = yield* client.masterAgent["workspace.masterAgent.ensure"]({
          params: { workspaceID: info.id, blockID: "block-b" },
        })

        // "Reconnect": this listener was not attached when the event was
        // published, so the transient event is gone forever.
        const late = yield* collectBindingUpdated(events)

        // Authoritative refetch reads the persisted instance, not the events.
        const refetched = yield* client.masterAgent["workspace.masterAgent.get"]({
          params: { workspaceID: info.id, blockID: "block-b" },
        })
        return { binding, refetched, late: yield* Ref.get(late) }
      }),
      provide(serverLayer()),
    )

    expect(result.late).toHaveLength(0)
    expect(result.refetched).toEqual({ status: "bound", binding: result.binding })
  })

  it("HTTP reset replaces the binding and preserves the sibling block", async () => {
    const result = await run(
      Effect.gen(function* () {
        const client = yield* compositionClient
        const info = yield* client.workspace["workspace.create"]({ payload: { name: "ma-api-3" } })
        yield* withBlock(client, info.id, "block-a")
        yield* withBlock(client, info.id, "block-b")
        const a = yield* client.masterAgent["workspace.masterAgent.ensure"]({
          params: { workspaceID: info.id, blockID: "block-a" },
        })
        const b = yield* client.masterAgent["workspace.masterAgent.ensure"]({
          params: { workspaceID: info.id, blockID: "block-b" },
        })

        const stale = yield* client.masterAgent["workspace.masterAgent.reset"]({
          params: { workspaceID: info.id, blockID: "block-a" },
          payload: { expectedSessionID: a.sessionID, expectedRevision: a.revision + 10 },
        })
        expect(stale).toEqual({ status: "stale", currentRevision: a.revision })

        const reset = yield* client.masterAgent["workspace.masterAgent.reset"]({
          params: { workspaceID: info.id, blockID: "block-a" },
          payload: { expectedSessionID: a.sessionID, expectedRevision: a.revision },
        })
        const aAfter = yield* client.masterAgent["workspace.masterAgent.get"]({
          params: { workspaceID: info.id, blockID: "block-a" },
        })
        const bAfter = yield* client.masterAgent["workspace.masterAgent.get"]({
          params: { workspaceID: info.id, blockID: "block-b" },
        })
        return { a, b, reset, aAfter, bAfter }
      }),
      provide(serverLayer()),
    )

    expect(result.reset.status).toBe("reset")
    if (result.reset.status !== "reset") throw new Error("reset should have succeeded")
    expect(result.reset.binding.sessionID).not.toBe(result.a.sessionID)
    expect(result.reset.binding.generation).toBe(result.a.generation + 1)
    expect(result.aAfter).toEqual({ status: "bound", binding: result.reset.binding })
    expect(result.bAfter).toEqual({ status: "bound", binding: result.b })
  })
})
