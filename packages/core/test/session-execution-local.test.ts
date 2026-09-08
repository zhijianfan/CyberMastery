import { describe, expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, LayerMap } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationError, LocationServices } from "@opencode-ai/core/location-services"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionLocal } from "@opencode-ai/core/session/execution/local"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"
import { Workspace } from "@opencode-ai/schema/workspace"
import { SessionV1 } from "@opencode-ai/schema/v1/session"
import { LLMError, TransportReason } from "@opencode-ai/llm"

const first = SessionSchema.ID.create()
const second = SessionSchema.ID.create()
const location = Location.Ref.make({
  directory: AbsolutePath.make(process.cwd()),
  workspaceID: Workspace.ID.make("wrk_execution"),
})

function layer(run: SessionRunner.Interface["run"]) {
  return AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionExecutionLocal.node]), [
    [
      LocationServiceMap.node,
      Layer.effect(
        LocationServiceMap.Service,
        LayerMap.make((_ref: Location.Ref) => Layer.succeed(SessionRunner.Service, { run })).pipe(
          // Execution only uses the runner from the Location's service map.
          Effect.map((map) => map as unknown as LayerMap.LayerMap<Location.Ref, LocationServices, LocationError>),
        ),
      ),
    ],
  ])
}

const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  const events = yield* EventV2.Service
  const execution = yield* SessionExecution.Service
  yield* database.db
    .insert(ProjectTable)
    .values({
      id: ProjectV2.ID.global,
      worktree: location.directory,
      sandboxes: [],
    })
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .insert(SessionTable)
    .values(
      [first, second].map((id) => ({
        id,
        runtime: "v2" as const,
        project_id: ProjectV2.ID.global,
        workspace_id: location.workspaceID,
        directory: location.directory,
        slug: "execution-test",
        title: "execution-test",
        version: "test",
      })),
    )
    .run()
    .pipe(Effect.orDie)
  const statuses: EventV2.Payload[] = []
  const notifications: EventV2.Payload[] = []
  yield* events.listen((event) =>
    Effect.sync(() => {
      if (event.type === SessionStatusEvent.Status.type) statuses.push(event)
      if (event.type === SessionStatusEvent.Status.type || event.type === SessionV1.Event.Error.type)
        notifications.push(event)
    }),
  )
  return { execution, statuses, notifications }
})

describe("SessionExecutionLocal preflight errors", () => {
  const providerID = ProviderV2.ID.make("test")
  const modelID = ModelV2.ID.make("test-model")
  test.each([
    [new SessionRunnerModel.ModelNotSelectedError({ sessionID: first }), `No model is available for session ${first}`],
    [new SessionRunnerModel.ModelUnavailableError({ providerID, modelID }), "Model unavailable: test/test-model"],
    [
      new SessionRunnerModel.VariantUnavailableError({ providerID, modelID, variant: ModelV2.VariantID.make("high") }),
      "Variant unavailable for test/test-model: high",
    ],
    [
      new SessionRunnerModel.UnsupportedApiError({ providerID, modelID, api: "test-api" }),
      "Unsupported API for test/test-model: test-api",
    ],
    [new Integration.AuthorizationError({ cause: new Error("secret-token-must-not-leak") }), "Authorization failed"],
  ] as const)("reports %s before idle while preserving the failure", async (failure, message) => {
    await Effect.gen(function* () {
      const state = yield* setup
      const result = yield* state.execution.resume(first).pipe(Effect.flip)
      expect(result).toBe(failure)
      expect(state.notifications.map((event) => ({ type: event.type, data: event.data }))).toEqual([
        { type: "session.status", data: { sessionID: first, status: { type: "busy" } } },
        {
          type: "session.error",
          data: { sessionID: first, error: { name: "UnknownError", data: { message } } },
        },
        { type: "session.status", data: { sessionID: first, status: { type: "idle" } } },
      ])
      expect(state.notifications[1].location).toEqual(location)
    }).pipe(Effect.scoped, Effect.provide(layer(() => Effect.fail(failure))), Effect.runPromise)
  })

  test("does not duplicate provider errors or report user interruption as an error", async () => {
    const failure = new LLMError({
      module: "test",
      method: "stream",
      reason: new TransportReason({ message: "Provider unavailable" }),
    })
    await Effect.gen(function* () {
      const state = yield* setup
      yield* state.execution.resume(first).pipe(Effect.exit)
      yield* state.execution.resume(second).pipe(Effect.exit)
      expect(state.notifications.filter((event) => event.type === SessionV1.Event.Error.type)).toEqual([])
    }).pipe(
      Effect.scoped,
      Effect.provide(layer((input) => (input.sessionID === first ? Effect.fail(failure) : Effect.interrupt))),
      Effect.runPromise,
    )
  })
})

describe("SessionExecutionLocal status", () => {
  test("publishes one busy/idle pair for a wake joined by concurrent resumes", async () => {
    const started = Deferred.makeUnsafe<void>()
    const finish = Deferred.makeUnsafe<void>()
    await Effect.gen(function* () {
      const state = yield* setup
      yield* state.execution.wake(first)
      yield* Deferred.await(started)
      const resumed = yield* state.execution.resume(first).pipe(Effect.forkChild)
      const joined = yield* state.execution.resume(first).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(state.statuses.map((event) => event.data)).toEqual([{ sessionID: first, status: { type: "busy" } }])
      expect(yield* state.execution.active).toEqual(new Set([first]))
      yield* Deferred.succeed(finish, undefined)
      yield* Effect.all([Fiber.join(resumed), Fiber.join(joined)])
      expect(state.statuses.map((event) => event.data)).toEqual([
        { sessionID: first, status: { type: "busy" } },
        { sessionID: first, status: { type: "idle" } },
      ])
      expect(state.statuses.map((event) => event.location)).toEqual([location, location])
      expect(yield* state.execution.active).toEqual(new Set())
    }).pipe(
      Effect.scoped,
      Effect.provide(layer(() => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(finish))))),
      Effect.runPromise,
    )
  })

  test("publishes idle after a runner failure or defect", async () => {
    await Effect.gen(function* () {
      const state = yield* setup
      const failed = yield* state.execution.resume(first).pipe(Effect.exit)
      const defect = yield* state.execution.resume(second).pipe(Effect.exit)
      expect(Exit.isFailure(failed) && Cause.hasFails(failed.cause)).toBeTrue()
      expect(Exit.isFailure(defect) && Cause.hasDies(defect.cause)).toBeTrue()
      expect(state.statuses.map((event) => event.data)).toEqual([
        { sessionID: first, status: { type: "busy" } },
        { sessionID: first, status: { type: "idle" } },
        { sessionID: second, status: { type: "busy" } },
        { sessionID: second, status: { type: "idle" } },
      ])
      expect(yield* state.execution.active).toEqual(new Set())
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layer((input) =>
          input.sessionID === first
            ? Effect.fail(new SessionRunnerModel.ModelNotSelectedError({ sessionID: input.sessionID }))
            : Effect.die("runner defect"),
        ),
      ),
      Effect.runPromise,
    )
  })

  test("publishes idle before interruption completes and ignores idle interruption", async () => {
    const started = Deferred.makeUnsafe<void>()
    await Effect.gen(function* () {
      const state = yield* setup
      yield* state.execution.interrupt(first)
      expect(state.statuses).toEqual([])
      yield* state.execution.wake(first)
      yield* Deferred.await(started)
      yield* state.execution.interrupt(first)
      expect(state.statuses.map((event) => event.data)).toEqual([
        { sessionID: first, status: { type: "busy" } },
        { sessionID: first, status: { type: "idle" } },
      ])
      expect(yield* state.execution.active).toEqual(new Set())
    }).pipe(
      Effect.scoped,
      Effect.provide(layer(() => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)))),
      Effect.runPromise,
    )
  })

  test("keeps concurrent sessions busy independently", async () => {
    const started = [Deferred.makeUnsafe<void>(), Deferred.makeUnsafe<void>()]
    const finish = [Deferred.makeUnsafe<void>(), Deferred.makeUnsafe<void>()]
    await Effect.gen(function* () {
      const state = yield* setup
      const a = yield* state.execution.resume(first).pipe(Effect.forkChild)
      yield* Deferred.await(started[0])
      const b = yield* state.execution.resume(second).pipe(Effect.forkChild)
      yield* Deferred.await(started[1])
      yield* Deferred.succeed(finish[0], undefined)
      yield* Fiber.join(a)
      expect(state.statuses.map((event) => event.data)).toEqual([
        { sessionID: first, status: { type: "busy" } },
        { sessionID: second, status: { type: "busy" } },
        { sessionID: first, status: { type: "idle" } },
      ])
      expect(yield* state.execution.active).toEqual(new Set([second]))
      yield* Deferred.succeed(finish[1], undefined)
      yield* Fiber.join(b)
      expect(state.statuses.at(-1)?.data).toEqual({ sessionID: second, status: { type: "idle" } })
      expect(yield* state.execution.active).toEqual(new Set())
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layer((input) => {
          const index = input.sessionID === first ? 0 : 1
          return Deferred.succeed(started[index], undefined).pipe(Effect.andThen(Deferred.await(finish[index])))
        }),
      ),
      Effect.runPromise,
    )
  })
})
