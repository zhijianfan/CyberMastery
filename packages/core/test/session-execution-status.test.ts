import { describe, expect } from "bun:test"
import { Context, Deferred, Effect, Exit, Fiber, Layer, LayerMap, Stream } from "effect"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Project } from "@opencode-ai/schema/project"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationError, LocationServices } from "@opencode-ai/core/location-services"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionLocal } from "@opencode-ai/core/session/execution/local"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionStore.node])))
const directory = AbsolutePath.make("/session-status-test")

const executionWith = (run: SessionRunner.Interface["run"]) =>
  Effect.gen(function* () {
    // A real Location map hosts a controlled runner; no provider or filesystem execution is involved.
    const locations = yield* LayerMap.make((_location: Location.Ref) => Layer.succeed(SessionRunner.Service, { run }))
    const context = yield* Layer.build(SessionExecutionLocal.layer).pipe(
      Effect.provideService(
        LocationServiceMap.Service,
        locations as unknown as LayerMap.LayerMap<Location.Ref, LocationServices, LocationError>,
      ),
    )
    return Context.get(context, SessionExecution.Service)
  })

const insertSession = (name: string) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    yield* database.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: directory, sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const id = SessionSchema.ID.make(`ses_status_${name}_${crypto.randomUUID()}`)
    yield* database.db
      .insert(SessionTable)
      .values({ id, runtime: "v2", project_id: Project.ID.global, slug: name, directory, title: name, version: "test" })
      .run()
      .pipe(Effect.orDie)
    return id
  })

describe("local session execution status", () => {
  it.effect("publishes ordered busy/idle for successful work with the stored location and no durable event", () =>
    Effect.gen(function* () {
      const sessionID = yield* insertSession("success")
      const events = yield* EventV2.Service
      const received = yield* events
        .subscribe(SessionStatusEvent.Status)
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow
      const execution = yield* executionWith(() => Effect.void)
      yield* execution.resume(sessionID)
      const statuses = yield* Fiber.join(received)
      expect(statuses.map((event) => event.data)).toEqual([
        { sessionID, status: { type: "busy" } },
        { sessionID, status: { type: "idle" } },
      ])
      expect(statuses.every((event) => event.location?.directory === directory && event.durable === undefined)).toBe(
        true,
      )
      expect(Array.from(yield* execution.active)).toEqual([])
    }),
  )

  it.effect("publishes idle after typed runner failure and interruption", () =>
    Effect.gen(function* () {
      const failedID = yield* insertSession("failure")
      const interruptedID = yield* insertSession("interrupt")
      const events = yield* EventV2.Service
      const started = yield* Deferred.make<void>()
      const received = yield* events
        .subscribe(SessionStatusEvent.Status)
        .pipe(Stream.take(4), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow
      const execution = yield* executionWith(({ sessionID }) =>
        sessionID === failedID
          ? Effect.fail(new SessionRunnerModel.ModelNotSelectedError({ sessionID }))
          : Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      )
      expect(Exit.isFailure(yield* execution.resume(failedID).pipe(Effect.exit))).toBe(true)
      yield* execution.wake(interruptedID)
      yield* Deferred.await(started)
      yield* execution.interrupt(interruptedID)
      const statuses = yield* Fiber.join(received)
      expect(statuses.map((event) => [event.data.sessionID, event.data.status.type])).toEqual([
        [failedID, "busy"],
        [failedID, "idle"],
        [interruptedID, "busy"],
        [interruptedID, "idle"],
      ])
      expect(Array.from(yield* execution.active)).toEqual([])
    }),
  )
})
