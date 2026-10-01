import { Cause, Effect, Layer } from "effect"
import { LocationServiceMap } from "../../location-service-map"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionRunner } from "../runner"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"
import { SessionExecutionOwnership } from "./ownership"
import { Database } from "../../database/database"

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const db = (yield* Database.Service).db
    const ownerID = crypto.randomUUID()
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, force) {
        return yield* Effect.acquireUseRelease(
          SessionExecutionOwnership.acquire(db, sessionID, ownerID).pipe(
            Effect.catchTag("SessionExecution.Closed", () => Effect.succeed(undefined)),
            Effect.orDie,
          ),
          (lease) => Effect.gen(function* () {
            if (!lease) return
            const session = yield* store.get(sessionID)
            if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
            return yield* SessionRunner.Service.use((runner) => runner.run({ sessionID, force })).pipe(
              Effect.provide(locations.get(session.location)),
              SessionExecutionOwnership.withLease(lease),
            )
          }),
          (lease) => lease ? SessionExecutionOwnership.release(db, lease) : Effect.void,
        ).pipe(
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
      stopAndJoin: coordinator.stop,
      resume: coordinator.run,
      wake: coordinator.wake,
      takeover: (sessionID) =>
        SessionExecutionOwnership.takeover(db, sessionID, ownerID).pipe(
          Effect.orDie,
          // Fence before interruption: cleanup can schedule a pending successor.
          Effect.andThen(coordinator.interrupt(sessionID)),
          Effect.andThen(coordinator.wake(sessionID)),
          Effect.uninterruptible,
        ),
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [SessionStore.node, LocationServiceMap.node, Database.node],
})

export * as SessionExecutionLocal from "./local"
