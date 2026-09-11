import { Cause, Effect, Layer } from "effect"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"
import { SessionV1 } from "@opencode-ai/schema/v1/session"
import { EventV2 } from "../../event"
import { LocationServiceMap } from "../../location-service-map"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionRunner } from "../runner"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
export const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const events = yield* EventV2.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      onActiveChange: (sessionID, active) =>
        Effect.gen(function* () {
          const session = yield* store.get(sessionID)
          if (!session) return
          yield* events.publish(
            SessionStatusEvent.Status,
            { sessionID, status: { type: active ? "busy" : "idle" } },
            { location: session.location },
          )
        }).pipe(
          Effect.asVoid,
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterrupts(cause),
            (cause) => Effect.logError("Failed to publish Session status", cause),
          ),
        ),
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, force) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        return yield* SessionRunner.Service.use((runner) => runner.run({ sessionID, force })).pipe(
          Effect.provide(locations.get(session.location)),
          Effect.tapError((error) => {
            const message =
              error._tag === "Integration.Authorization"
                ? "Authorization failed"
                : error._tag === "SessionRunnerModel.ModelNotSelectedError" ||
                    error._tag === "SessionRunnerModel.ModelUnavailableError" ||
                    error._tag === "SessionRunnerModel.VariantUnavailableError" ||
                    error._tag === "SessionRunnerModel.UnsupportedApiError"
                  ? error.message
                  : undefined
            if (!message) return Effect.void
            return events.publish(
              SessionV1.Event.Error,
              { sessionID, error: { name: "UnknownError", data: { message } } },
              { location: session.location },
            )
          }),
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("Failed to drain Session", cause).pipe(Effect.annotateLogs({ sessionID })),
          ),
        )
      }),
    })

    return SessionExecution.Service.of({
      active: coordinator.active,
      interrupt: coordinator.interrupt,
      resume: coordinator.run,
      wake: coordinator.wake,
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [SessionStore.node, LocationServiceMap.node, EventV2.node],
})

export * as SessionExecutionLocal from "./local"
