import { describe, expect, it } from "bun:test"
import { OperatingChatSessionService } from "@opencode-ai/core/workspace/operating-chat-session"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { OperatingChatGroup } from "@opencode-ai/protocol/groups/operating-chat"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { SchemaErrorMiddleware } from "@opencode-ai/protocol/middleware/schema-error"
import { Session } from "@opencode-ai/schema/session"
import { Cause, Effect, Exit, FileSystem, Layer, Path, Scope } from "effect"
import { Etag, HttpPlatform } from "effect/unstable/http"
import { HttpApi, HttpApiTest } from "effect/unstable/httpapi"
import { AccessDeniedError, OperatingChatAccessService } from "../src/handlers/operating-chat-access"
import { OperatingChatHandler } from "../src/handlers/operating-chat"

const workspaceID = WorkspaceV2.ID.make("wrk_operating_handler")
const blockID = "block-a"
const sessionID = Session.ID.make("ses_operating_handler")

type Binding = NonNullable<Effect.Success<ReturnType<OperatingChatSessionService.Interface["get"]>>>

const binding = (overrides: Partial<Binding> = {}): Binding => ({
  workspaceID,
  blockID,
  functionalityInstanceID: "inst_operating_handler",
  sessionID,
  directory: "/tmp",
  generation: 0,
  revision: 1,
  ...overrides,
})

const fakeOperatingChat = (overrides: Partial<OperatingChatSessionService.Interface> = {}) =>
  Layer.succeed(
    OperatingChatSessionService.Service,
    OperatingChatSessionService.Service.of({
      get: () => Effect.die("OperatingChatSessionService.get must not be called"),
      ensure: () => Effect.die("OperatingChatSessionService.ensure must not be called"),
      reset: () => Effect.die("OperatingChatSessionService.reset must not be called"),
      ...overrides,
    }),
  )

const testApi = HttpApi.make("server").add(OperatingChatGroup)
const allowAccess = Layer.succeed(
  OperatingChatAccessService,
  OperatingChatAccessService.of({ requireAccess: () => Effect.void }),
)

const testLayer = (
  service: Layer.Layer<OperatingChatSessionService.Service, never, never>,
  access: Layer.Layer<OperatingChatAccessService, never, never> = allowAccess,
) =>
  OperatingChatHandler.pipe(
    Layer.provideMerge(service),
    Layer.provideMerge(access),
    Layer.provideMerge(HttpPlatform.layer.pipe(Layer.provideMerge(FileSystem.layerNoop({})))),
    Layer.provideMerge(Path.layer),
    Layer.provideMerge(Etag.layer),
    Layer.provideMerge(
      Layer.succeed(
        Authorization,
        Authorization.of((effect) => effect),
      ),
    ),
    Layer.provideMerge(
      Layer.succeed(
        SchemaErrorMiddleware,
        SchemaErrorMiddleware.of((effect) => effect),
      ),
    ),
  )

const groupClient = () =>
  Effect.gen(function* () {
    const client = yield* HttpApiTest.groups(testApi, ["server.workspace.operatingChat"])
    return client["server.workspace.operatingChat"]
  })

const run = <A, E, R>(value: Effect.Effect<A, E, R | Scope.Scope>, layer: Layer.Layer<R, never>) =>
  Effect.gen(function* () {
    const exit = yield* value.pipe(Effect.scoped, Effect.provide(layer), Effect.exit)
    if (Exit.isFailure(exit)) {
      for (const error of Cause.prettyErrors(exit.cause)) yield* Effect.logError(error)
    }
    return yield* exit
  }).pipe(Effect.runPromise)

const getRequest = { params: { workspaceID, blockID } }
const resetRequest = {
  params: { workspaceID, blockID },
  payload: { expectedSessionID: sessionID, expectedRevision: 1 },
}

describe("workspace.operatingChat handlers", () => {
  it("returns bound and unbound get responses", async () => {
    const bound = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.operatingChat.get"](getRequest)
      }),
      testLayer(fakeOperatingChat({ get: () => Effect.succeed(binding()) })),
    )
    const unbound = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.operatingChat.get"](getRequest)
      }),
      testLayer(fakeOperatingChat({ get: () => Effect.succeed(undefined) })),
    )

    expect(bound).toEqual({ status: "bound", binding: binding() })
    expect(unbound).toEqual({ status: "unbound" })
  })

  it("forwards ensure and reset inputs to the lifecycle service", async () => {
    const calls: unknown[][] = []
    const next = binding({ sessionID: Session.ID.make("ses_operating_reset"), generation: 1, revision: 2 })
    const layer = testLayer(
      fakeOperatingChat({
        ensure: (workspace, block) => {
          calls.push(["ensure", workspace, block])
          return Effect.succeed(binding())
        },
        reset: (workspace, block, expectedSessionID, expectedRevision) => {
          calls.push(["reset", workspace, block, expectedSessionID, expectedRevision])
          return Effect.succeed(next)
        },
      }),
    )
    const ensured = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.operatingChat.ensure"](getRequest)
      }),
      layer,
    )
    const reset = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.operatingChat.reset"](resetRequest)
      }),
      layer,
    )

    expect(ensured).toEqual(binding())
    expect(reset).toEqual(next)
    expect(calls).toEqual([
      ["ensure", workspaceID, blockID],
      ["reset", workspaceID, blockID, sessionID, 1],
    ])
  })

  it("maps configuration, stale-binding, and busy lifecycle failures", async () => {
    const configuration = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.operatingChat.ensure"](getRequest).pipe(Effect.flip)
      }),
      testLayer(
        fakeOperatingChat({
          ensure: () => Effect.fail(new OperatingChatSessionService.ConfigurationError({ workspaceID })),
        }),
      ),
    )
    const stale = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.operatingChat.reset"](resetRequest).pipe(Effect.flip)
      }),
      testLayer(
        fakeOperatingChat({
          reset: () => Effect.fail(new OperatingChatSessionService.StaleBindingError({ currentRevision: 7 })),
        }),
      ),
    )
    const busy = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.operatingChat.reset"](resetRequest).pipe(Effect.flip)
      }),
      testLayer(
        fakeOperatingChat({
          reset: () => Effect.fail(new OperatingChatSessionService.BusyError({ sessionID })),
        }),
      ),
    )

    expect(configuration._tag).toBe("OperatingChatConfigurationError")
    expect(stale).toMatchObject({ _tag: "OperatingChatStaleBindingError", currentRevision: 7 })
    expect(busy).toMatchObject({ _tag: "OperatingChatBusyError", sessionID })
  })

  it("denies access before invoking the lifecycle service", async () => {
    const denyAccess = Layer.succeed(
      OperatingChatAccessService,
      OperatingChatAccessService.of({
        requireAccess: () => Effect.fail(new AccessDeniedError({ workspaceID, blockID })),
      }),
    )
    const error = await run(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.operatingChat.ensure"](getRequest).pipe(Effect.flip)
      }),
      testLayer(fakeOperatingChat(), denyAccess),
    )

    expect(error).toMatchObject({ _tag: "OperatingChatAccessDeniedError", workspaceID, blockID })
  })
})
