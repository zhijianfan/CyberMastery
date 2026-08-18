// Handler tests for the MasterAgent lifecycle group (Track S1).
//
// The handler layer is exercised through the in-memory HttpApiTest client, so
// request encoding, routing, response encoding, and error decoding all run
// through the real HttpApi pipeline. The F4 lifecycle service and the access
// port are replaced with per-test fakes; the access-denial test proves the
// access check runs before any lifecycle call (the F4 fake dies if invoked).

import { describe, expect, it } from "bun:test"
import { Cause, Effect, Exit, FileSystem, Layer, Path, Scope } from "effect"
import { Etag, HttpPlatform } from "effect/unstable/http"
import { HttpApi, HttpApiTest } from "effect/unstable/httpapi"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { MasterAgentGroup } from "@opencode-ai/protocol/groups/workspace-master-agent"
import {
  AccessDeniedError,
  MasterAgentAccessService,
  masterAgentAccessLive,
} from "../../src/handlers/workspace-master-agent-access"
import {
  MasterAgentServicePort,
  WorkspaceMasterAgentHandler,
} from "../../src/handlers/workspace-master-agent"
import type { MasterAgentService } from "@opencode-ai/core/workspace/master-agent"

const workspaceID = WorkspaceV2.ID.make("wrk_s1_test")
const blockID = "block-a"
const sessionID = SessionSchema.ID.create()

type Binding = NonNullable<Effect.Success<ReturnType<MasterAgentService.Interface["get"]>>>

const binding = (overrides: Partial<Binding> = {}): Binding => ({
  workspaceID,
  blockID,
  functionalityInstanceID: "inst_1",
  sessionID,
  directory: "/tmp",
  generation: 0,
  revision: 1,
  ...overrides,
})

// F4's error classes are runtime values in a module that cannot be imported
// yet (see MasterAgentServicePort), so the fakes fail with plain tagged
// values typed as the F4 error classes.
const staleBindingError = (currentRevision: number): MasterAgentService.StaleBindingError =>
  ({ _tag: "MasterAgent.StaleBindingError", currentRevision }) as MasterAgentService.StaleBindingError
const busyError = (sessionID: SessionSchema.ID): MasterAgentService.BusyError =>
  ({ _tag: "MasterAgent.BusyError", sessionID }) as MasterAgentService.BusyError
const wrongFunctionalityError = (blockID: string): MasterAgentService.WrongFunctionalityError =>
  ({ _tag: "MasterAgent.WrongFunctionalityError", blockID }) as MasterAgentService.WrongFunctionalityError
const workspaceNotFoundError = (workspaceID: WorkspaceV2.ID): MasterAgentService.WorkspaceNotFoundError =>
  ({ _tag: "MasterAgent.WorkspaceNotFoundError", workspaceID }) as MasterAgentService.WorkspaceNotFoundError

const fakeMasterAgent = (overrides: Partial<MasterAgentService.Interface> = {}) =>
  Layer.succeed(
    MasterAgentServicePort,
    MasterAgentServicePort.of({
      get: () => Effect.die("MasterAgentService.get must not be called"),
      ensure: () => Effect.die("MasterAgentService.ensure must not be called"),
      reset: () => Effect.die("MasterAgentService.reset must not be called"),
      tombstone: () => Effect.void,
      ...overrides,
    }),
  )

const testApi = HttpApi.make("server").add(MasterAgentGroup)

// Self-contained layer: the handler group requires the F4 service and the
// access port from its environment, so they are merged in with provideMerge
// (kept in the layer's To so the in-memory client sees them at request time)
// while HttpPlatform's FileSystem requirement is wired internally.
const testLayer = (
  fake: Layer.Layer<MasterAgentServicePort, never, never>,
  access: Layer.Layer<MasterAgentAccessService, never, never> = masterAgentAccessLive,
) =>
  WorkspaceMasterAgentHandler.pipe(
    Layer.provideMerge(fake),
    Layer.provideMerge(access),
    Layer.provideMerge(HttpPlatform.layer.pipe(Layer.provideMerge(FileSystem.layerNoop({})))),
    Layer.provideMerge(Path.layer),
    Layer.provideMerge(Etag.layer),
  )

const groupClient = () =>
  Effect.gen(function* () {
    const client = yield* HttpApiTest.groups(testApi, ["server.workspace.masterAgent"])
    return client["server.workspace.masterAgent"]
  })

const run = <A, E, R>(value: Effect.Effect<A, E, R | Scope.Scope>, layer: Layer.Layer<R, never>) =>
  Effect.gen(function* () {
    const exit = yield* value.pipe(Effect.scoped, Effect.provide(layer), Effect.exit)
    if (Exit.isFailure(exit)) {
      for (const err of Cause.prettyErrors(exit.cause)) {
        yield* Effect.logError(err)
      }
    }
    return yield* exit
  }).pipe(Effect.runPromise)

const getRequest = { params: { workspaceID, blockID } }
const resetRequest = {
  params: { workspaceID, blockID },
  payload: { expectedSessionID: sessionID, expectedRevision: 1 },
}

describe("workspace.masterAgent handlers", () => {
  it("get returns a bound response", async () => {
    const result = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.masterAgent.get"](getRequest)
      }),
      testLayer(fakeMasterAgent({ get: () => Effect.succeed(binding()) })),
    )
    expect(result).toEqual({ status: "bound", binding: binding() })
  })

  it("get returns unbound when no instance exists", async () => {
    const result = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.masterAgent.get"](getRequest)
      }),
      testLayer(fakeMasterAgent({ get: () => Effect.succeed(undefined) })),
    )
    expect(result).toEqual({ status: "unbound" })
  })

  it("ensure is idempotent", async () => {
    const bound = binding()
    const layer = testLayer(fakeMasterAgent({ ensure: () => Effect.succeed(bound) }))
    const first = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.masterAgent.ensure"](getRequest)
      }),
      layer,
    )
    const second = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.masterAgent.ensure"](getRequest)
      }),
      layer,
    )
    expect(first).toEqual(bound)
    expect(second).toEqual(bound)
  })

  it("reset returns the new binding on success", async () => {
    const next = binding({ sessionID: SessionSchema.ID.create(), generation: 1, revision: 2 })
    const result = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.masterAgent.reset"](resetRequest)
      }),
      testLayer(fakeMasterAgent({ reset: () => Effect.succeed(next) })),
    )
    expect(result).toEqual({ status: "reset", binding: next })
  })

  it("reset forwards the expected session id and revision unchanged", async () => {
    const calls: Array<[string, string, string, number]> = []
    await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.masterAgent.reset"](resetRequest)
      }),
      testLayer(
        fakeMasterAgent({
          reset: (workspace, block, expectedSessionID, expectedRevision) => {
            calls.push([workspace, block, expectedSessionID, expectedRevision])
            return Effect.succeed(binding())
          },
        }),
      ),
    )
    expect(calls).toEqual([[workspaceID, blockID, sessionID, 1]])
  })

  it("reset reports a stale binding as a stale status", async () => {
    const result = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.masterAgent.reset"](resetRequest)
      }),
      testLayer(
        fakeMasterAgent({
          reset: () => Effect.fail(staleBindingError(7)),
        }),
      ),
    )
    expect(result).toEqual({ status: "stale", currentRevision: 7 })
  })

  it("reset reports a busy session as a busy status", async () => {
    const result = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.masterAgent.reset"](resetRequest)
      }),
      testLayer(
        fakeMasterAgent({
          reset: () => Effect.fail(busyError(sessionID)),
        }),
      ),
    )
    expect(result).toEqual({ status: "busy", reason: "session-active-or-pending-input" })
  })

  it("maps a wrong block type to the wrong-functionality error", async () => {
    const error = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.masterAgent.ensure"](getRequest).pipe(Effect.flip)
      }),
      testLayer(
        fakeMasterAgent({
          ensure: () => Effect.fail(wrongFunctionalityError(blockID)),
        }),
      ),
    )
    expect(error._tag).toBe("MasterAgentWrongFunctionalityError")
    if (error._tag !== "MasterAgentWrongFunctionalityError") throw new Error("unreachable")
    expect(error.blockID).toBe(blockID)
  })

  it("maps a missing workspace to the workspace-not-found error", async () => {
    const error = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.masterAgent.get"](getRequest).pipe(Effect.flip)
      }),
      testLayer(
        fakeMasterAgent({
          get: () => Effect.fail(workspaceNotFoundError(workspaceID)),
        }),
      ),
    )
    expect(error._tag).toBe("MasterAgentWorkspaceNotFoundError")
    if (error._tag !== "MasterAgentWorkspaceNotFoundError") throw new Error("unreachable")
    expect(error.workspaceID).toBe(workspaceID)
  })

  it("denies access before invoking the lifecycle service", async () => {
    const denyingAccess = Layer.succeed(
      MasterAgentAccessService,
      MasterAgentAccessService.of({
        requireAccess: () => Effect.fail(new AccessDeniedError({ workspaceID, blockID })),
      }),
    )
    const error = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.masterAgent.ensure"](getRequest).pipe(Effect.flip)
      }),
      testLayer(fakeMasterAgent(), denyingAccess),
    )
    expect(error._tag).toBe("MasterAgentAccessDeniedError")
    if (error._tag !== "MasterAgentAccessDeniedError") throw new Error("unreachable")
    expect(error.workspaceID).toBe(workspaceID)
    expect(error.blockID).toBe(blockID)
  })
})
