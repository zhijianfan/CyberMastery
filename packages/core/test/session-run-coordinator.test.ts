import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

describe("SessionRunCoordinator", () => {
  it.effect("wait returns while idle without starting execution", () =>
    Effect.scoped(Effect.gen(function* () {
      let runs = 0
      const coordinator = yield* SessionRunCoordinator.make({ drain: () => Effect.sync(() => { runs++ }) })
      yield* coordinator.wait("session")
      expect(runs).toBe(0)
    })),
  )

  it.effect("wait joins an active drain and its coalesced wake", () =>
    Effect.scoped(Effect.gen(function* () {
      const firstStarted = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()
      const firstGate = yield* Deferred.make<void>()
      const secondGate = yield* Deferred.make<void>()
      const waited = yield* Deferred.make<void>()
      let runs = 0
      const coordinator = yield* SessionRunCoordinator.make({
        drain: () => Effect.sync(() => ++runs).pipe(Effect.flatMap((run) =>
          run === 1
            ? Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(firstGate)))
            : Deferred.succeed(secondStarted, undefined).pipe(Effect.andThen(Deferred.await(secondGate))),
        )),
      })

      yield* coordinator.wake("session")
      yield* Deferred.await(firstStarted)
      yield* coordinator.wake("session")
      const waiting = yield* coordinator.wait("session").pipe(Effect.andThen(Deferred.succeed(waited, undefined)), Effect.forkChild)
      yield* Deferred.succeed(firstGate, undefined)
      yield* Deferred.await(secondStarted)
      expect(yield* Deferred.isDone(waited)).toBeFalse()
      yield* Deferred.succeed(secondGate, undefined)
      yield* Fiber.join(waiting)
      expect(runs).toBe(2)
    })),
  )

  it.effect("interrupting a waiter leaves the active drain running", () =>
    Effect.scoped(Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const coordinator = yield* SessionRunCoordinator.make({
        drain: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate))),
      })
      yield* coordinator.wake("session")
      yield* Deferred.await(started)
      const waiter = yield* coordinator.wait("session").pipe(Effect.forkChild)
      yield* Fiber.interrupt(waiter)
      const exit = yield* Fiber.await(waiter)
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBeTrue()
      expect(Array.from(yield* coordinator.active)).toEqual(["session"])
      yield* Deferred.succeed(gate, undefined)
      yield* coordinator.wait("session")
    })),
  )

  it.effect("wait releases after interruption cleanup without joining a restart", () =>
    Effect.scoped(Effect.gen(function* () {
      const firstStarted = yield* Deferred.make<void>()
      const cleanupStarted = yield* Deferred.make<void>()
      const cleanupGate = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()
      const secondGate = yield* Deferred.make<void>()
      const waited = yield* Deferred.make<void>()
      let runs = 0
      const coordinator = yield* SessionRunCoordinator.make({
        drain: () => Effect.sync(() => ++runs).pipe(Effect.flatMap((run) =>
          run === 1
            ? Deferred.succeed(firstStarted, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() => Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate)))),
              )
            : Deferred.succeed(secondStarted, undefined).pipe(Effect.andThen(Deferred.await(secondGate))),
        )),
      })

      yield* coordinator.wake("session")
      yield* Deferred.await(firstStarted)
      const waiting = yield* coordinator.wait("session").pipe(Effect.andThen(Deferred.succeed(waited, undefined)), Effect.forkChild)
      const interrupt = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
      yield* Deferred.await(cleanupStarted)
      yield* coordinator.wake("session")
      expect(yield* Deferred.isDone(waited)).toBeFalse()
      yield* Deferred.succeed(cleanupGate, undefined)
      yield* Fiber.join(interrupt)
      yield* Deferred.await(secondStarted)
      yield* Fiber.join(waiting)
      expect(yield* Deferred.isDone(waited)).toBeTrue()
      yield* Deferred.succeed(secondGate, undefined)
    })),
  )

  it.effect("runs an exclusive action after the active drain without another provider turn", () =>
    Effect.scoped(Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const order: string[] = []
      const coordinator = yield* SessionRunCoordinator.make({
        drain: () => Effect.sync(() => order.push("drain")).pipe(
          Effect.andThen(Deferred.succeed(started, undefined)),
          Effect.andThen(Deferred.await(gate)),
        ),
      })
      const running = yield* coordinator.run("session").pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const exclusive = yield* coordinator.exclusive("session", Effect.sync(() => order.push("compact"))).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(order).toEqual(["drain"])
      yield* Deferred.succeed(gate, undefined)
      yield* Effect.all([Fiber.join(running), Fiber.join(exclusive)])
      expect(order).toEqual(["drain", "compact"])
    })),
  )

  it.effect("wait joins an exclusive action without joining its successor drain", () =>
    Effect.scoped(Effect.gen(function* () {
      const compactStarted = yield* Deferred.make<void>()
      const compactGate = yield* Deferred.make<void>()
      const drainStarted = yield* Deferred.make<void>()
      const drainGate = yield* Deferred.make<void>()
      const coordinator = yield* SessionRunCoordinator.make({
        drain: () => Deferred.succeed(drainStarted, undefined).pipe(Effect.andThen(Deferred.await(drainGate))),
      })
      const compact = yield* coordinator.exclusive("session", Deferred.succeed(compactStarted, undefined).pipe(
        Effect.andThen(Deferred.await(compactGate)),
      )).pipe(Effect.forkChild)
      yield* Deferred.await(compactStarted)
      const waited = yield* Deferred.make<void>()
      const waiting = yield* coordinator.wait("session").pipe(Effect.andThen(Deferred.succeed(waited, undefined)), Effect.forkChild)
      yield* Effect.yieldNow
      yield* coordinator.wake("session")
      expect(yield* Deferred.isDone(waited)).toBeFalse()
      yield* Deferred.succeed(compactGate, undefined)
      yield* Fiber.join(compact)
      yield* Deferred.await(drainStarted)
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(waited)).toBeTrue()
      yield* Deferred.succeed(drainGate, undefined)
      yield* Fiber.join(waiting)
    })),
  )

  it.effect("starts a resume queued during an exclusive action", () =>
    Effect.scoped(Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const drained = yield* Deferred.make<void>()
      const forces: boolean[] = []
      const coordinator = yield* SessionRunCoordinator.make({
        drain: (_key, force) => Effect.sync(() => forces.push(force)).pipe(Effect.andThen(Deferred.succeed(drained, undefined))),
      })
      const compact = yield* coordinator.exclusive("session", Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Deferred.await(gate)),
      )).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(compact)
      yield* Fiber.join(resumed)
      expect(yield* Deferred.isDone(drained)).toBeTrue()
      expect(forces).toEqual([true])
    })),
  )

  it.effect("completes an exclusive action before a later wake drain settles", () =>
    Effect.scoped(Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const drainStarted = yield* Deferred.make<void>()
      const drainGate = yield* Deferred.make<void>()
      const compactDone = yield* Deferred.make<void>()
      const coordinator = yield* SessionRunCoordinator.make({
        drain: () => Deferred.succeed(drainStarted, undefined).pipe(Effect.andThen(Deferred.await(drainGate))),
      })
      const compact = yield* coordinator.exclusive("session", Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Deferred.await(gate)),
      )).pipe(Effect.andThen(Deferred.succeed(compactDone, undefined)), Effect.forkChild)
      yield* Deferred.await(started)
      yield* coordinator.wake("session")
      yield* Deferred.succeed(gate, undefined)
      yield* Deferred.await(drainStarted)
      yield* Effect.yieldNow
      const completedBeforeDrain = yield* Deferred.isDone(compactDone)
      yield* Deferred.succeed(drainGate, undefined)
      yield* Fiber.join(compact)
      expect(completedBeforeDrain).toBeTrue()
    })),
  )

  it.effect("runs a wake received during exclusive interruption cleanup", () =>
    Effect.scoped(Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const cleanupStarted = yield* Deferred.make<void>()
      const cleanupGate = yield* Deferred.make<void>()
      const drained = yield* Deferred.make<void>()
      const coordinator = yield* SessionRunCoordinator.make({ drain: () => Deferred.succeed(drained, undefined) })
      const compact = yield* coordinator.exclusive("session", Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() => Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate)))),
      )).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const interrupt = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
      yield* Deferred.await(cleanupStarted)
      yield* coordinator.wake("session")
      yield* Deferred.succeed(cleanupGate, undefined)
      yield* Fiber.join(interrupt)
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(drained)).toBeTrue()
      yield* Fiber.await(compact)
    })),
  )

  it.effect("settles a queued resume after repeated exclusive interruptions", () =>
    Effect.scoped(Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const cleanupStarted = yield* Deferred.make<void>()
      const cleanupGate = yield* Deferred.make<void>()
      const coordinator = yield* SessionRunCoordinator.make({ drain: () => Effect.void })
      const compact = yield* coordinator.exclusive("session", Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() => Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate)))),
      )).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
      yield* Effect.yieldNow
      const first = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
      yield* Deferred.await(cleanupStarted)
      const second = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
      yield* Deferred.succeed(cleanupGate, undefined)
      yield* Effect.all([Fiber.join(first), Fiber.join(second)])
      const exit = yield* Fiber.await(resumed)
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBeTrue()
      yield* Fiber.await(compact)
    })),
  )

  it.effect("joins concurrent resumes for one key", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () => Effect.sync(() => runs++).pipe(Effect.andThen(Deferred.await(gate))),
        })

        const first = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        const second = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow

        expect(runs).toBe(1)
        yield* Deferred.succeed(gate, undefined)
        yield* Effect.all([Fiber.join(first), Fiber.join(second)])
        expect(runs).toBe(1)
      }),
    ),
  )

  it.effect("joins a wake-started execution without forcing a successor", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        const forces: boolean[] = []
        const coordinator = yield* SessionRunCoordinator.make<string, never>({
          drain: (_key, force) =>
            Effect.sync(() => forces.push(force)).pipe(
              Effect.andThen(Deferred.succeed(started, undefined)),
              Effect.andThen(Deferred.await(gate)),
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(started)
        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(resumed)

        expect(forces).toEqual([false])
      }),
    ),
  )

  it.effect("starts execution when woken while idle", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const drained = yield* Deferred.make<void>()
        const coordinator = yield* SessionRunCoordinator.make({ drain: () => Deferred.succeed(drained, undefined) })

        yield* coordinator.wake("session")
        yield* Deferred.await(drained)
      }),
    ),
  )

  it.effect("snapshots only active executions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const firstGate = yield* Deferred.make<void>()
        const secondGate = yield* Deferred.make<void>()
        const coordinator = yield* SessionRunCoordinator.make({
          drain: (key: string) =>
            Deferred.succeed(key === "first" ? firstStarted : secondStarted, undefined).pipe(
              Effect.andThen(Deferred.await(key === "first" ? firstGate : secondGate)),
            ),
        })

        expect(Array.from(yield* coordinator.active)).toEqual([])
        const first = yield* coordinator.run("first").pipe(Effect.forkChild)
        yield* Deferred.await(firstStarted)
        expect(Array.from(yield* coordinator.active)).toEqual(["first"])

        const second = yield* coordinator.run("second").pipe(Effect.forkChild)
        yield* Deferred.await(secondStarted)
        expect(Array.from(yield* coordinator.active)).toEqual(["first", "second"])

        yield* Deferred.succeed(firstGate, undefined)
        yield* Fiber.join(first)
        expect(Array.from(yield* coordinator.active)).toEqual(["second"])
        yield* Deferred.succeed(secondGate, undefined)
        yield* Fiber.join(second)
        expect(Array.from(yield* coordinator.active)).toEqual([])
      }),
    ),
  )

  it.effect("cleans active executions after failure and defect", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const failure = new Error("failed")
        const defect = new Error("defect")
        const coordinator = yield* SessionRunCoordinator.make({
          drain: (key: string) => (key === "failure" ? Effect.fail(failure) : Effect.die(defect)),
        })

        const failed = yield* coordinator.run("failure").pipe(Effect.exit)
        expect(Exit.isFailure(failed) && Cause.hasFails(failed.cause)).toBeTrue()
        expect(Array.from(yield* coordinator.active)).toEqual([])

        const died = yield* coordinator.run("defect").pipe(Effect.exit)
        expect(Exit.isFailure(died) && Cause.hasDies(died.cause)).toBeTrue()
        expect(Array.from(yield* coordinator.active)).toEqual([])
      }),
    ),
  )

  it.effect("cleans active executions when its scope closes", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const coordinator = yield* Effect.scoped(
        Effect.gen(function* () {
          const coordinator = yield* SessionRunCoordinator.make({
            drain: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
          })
          yield* coordinator.wake("session")
          yield* Deferred.await(started)
          expect(Array.from(yield* coordinator.active)).toEqual(["session"])
          return coordinator
        }),
      )

      expect(Array.from(yield* coordinator.active)).toEqual([])
    }),
  )

  it.effect("coalesces wakes received during active execution", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const firstGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(firstGate)))
                  : Deferred.succeed(secondStarted, undefined),
              ),
            ),
        })

        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.await(firstStarted)
        yield* Effect.all([coordinator.wake("session"), coordinator.wake("session"), coordinator.wake("session")], {
          concurrency: "unbounded",
        })
        yield* Deferred.succeed(firstGate, undefined)
        yield* Deferred.await(secondStarted)
        yield* Fiber.join(resumed)

        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("runs again when woken during the follow-up", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const secondGate = yield* Deferred.make<void>()
        const thirdStarted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.await(firstGate)
                  : run === 2
                    ? Deferred.succeed(secondStarted, undefined).pipe(Effect.andThen(Deferred.await(secondGate)))
                    : Deferred.succeed(thirdStarted, undefined),
              ),
            ),
        })

        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* coordinator.wake("session")
        yield* Deferred.succeed(firstGate, undefined)
        yield* Deferred.await(secondStarted)
        yield* coordinator.wake("session")
        yield* Deferred.succeed(secondGate, undefined)
        yield* Deferred.await(thirdStarted)
        yield* Fiber.join(resumed)

        expect(runs).toBe(3)
      }),
    ),
  )

  it.effect("does nothing when interrupted while idle", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* SessionRunCoordinator.make({ drain: () => Effect.void })
        yield* coordinator.interrupt("session")
      }),
    ),
  )

  it.effect("interrupts active execution and clears its pending wake", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const interrupted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.andThen(Deferred.succeed(started, undefined)),
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            ),
        })

        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.await(started)
        yield* coordinator.wake("session")
        yield* coordinator.interrupt("session")
        yield* Deferred.await(interrupted)

        const exit = yield* Fiber.await(resumed)
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBeTrue()
        expect(Array.from(yield* coordinator.active)).toEqual([])
        expect(runs).toBe(1)
      }),
    ),
  )

  it.effect("keeps an idle stopped key closed to wake and resume", () =>
    Effect.scoped(Effect.gen(function* () {
      const runs: string[] = []
      const coordinator = yield* SessionRunCoordinator.make({
        drain: (key: string) => Effect.sync(() => { runs.push(key) }),
      })
      yield* coordinator.stop("session")
      yield* coordinator.wake("session")
      yield* coordinator.run("session")
      yield* coordinator.run("other")
      expect(runs).toEqual(["other"])
    })),
  )

  it.effect("stops and joins active execution without starting queued or later drains", () =>
    Effect.scoped(Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const cleanupStarted = yield* Deferred.make<void>()
      const cleanupGate = yield* Deferred.make<void>()
      const stopDone = yield* Deferred.make<void>()
      let runs = 0
      const coordinator = yield* SessionRunCoordinator.make({
        drain: () => Effect.sync(() => ++runs).pipe(
          Effect.andThen(Deferred.succeed(started, undefined)),
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate)))),
        ),
      })

      yield* coordinator.wake("session")
      yield* Deferred.await(started)
      yield* coordinator.wake("session")
      const stop = yield* coordinator.stop("session").pipe(Effect.andThen(Deferred.succeed(stopDone, undefined)), Effect.forkChild)
      yield* Deferred.await(cleanupStarted)
      yield* coordinator.wake("session")
      yield* coordinator.run("session")
      const beforeCleanup = yield* Deferred.isDone(stopDone)
      yield* Deferred.succeed(cleanupGate, undefined)
      yield* Fiber.join(stop)
      expect(beforeCleanup).toBeFalse()
      yield* coordinator.wake("session")
      yield* coordinator.run("session")
      expect(Array.from(yield* coordinator.active)).toEqual([])
      expect(runs).toBe(1)
    })),
  )

  it.effect("runs a wake registered during interruption cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const cleanupStarted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.succeed(firstStarted, undefined).pipe(
                      Effect.andThen(Effect.never),
                      Effect.onInterrupt(() =>
                        Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate))),
                      ),
                    )
                  : Deferred.succeed(secondStarted, undefined),
              ),
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(firstStarted)
        const interrupt = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
        yield* Deferred.await(cleanupStarted)
        yield* coordinator.wake("session")
        yield* Deferred.succeed(cleanupGate, undefined)
        yield* Fiber.join(interrupt)
        yield* Deferred.await(secondStarted)

        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("starts a resume registered during interruption cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const cleanupStarted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const forces: boolean[] = []
        const coordinator = yield* SessionRunCoordinator.make<string, never>({
          drain: (_key, force) => {
            forces.push(force)
            return forces.length === 1
              ? Deferred.succeed(firstStarted, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.onInterrupt(() =>
                    Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate))),
                  ),
                )
              : Deferred.succeed(secondStarted, undefined)
          },
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(firstStarted)
        const interrupt = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
        yield* Deferred.await(cleanupStarted)
        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.succeed(cleanupGate, undefined)
        yield* Effect.all([Fiber.join(interrupt), Fiber.join(resumed)])
        yield* Deferred.await(secondStarted)

        expect(forces).toEqual([false, true])
      }),
    ),
  )

  it.effect("starts one follow-up when a wake races with failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const failure = new Error("failed")
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.await(gate).pipe(Effect.andThen(Effect.fail(failure)))
                  : Deferred.succeed(secondStarted, undefined),
              ),
            ),
        })

        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* coordinator.wake("session")
        yield* Deferred.succeed(gate, undefined)

        expect(yield* Fiber.join(resumed).pipe(Effect.flip)).toBe(failure)
        yield* Deferred.await(secondStarted)
        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("does not cancel execution when a joined waiter is interrupted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () => Effect.sync(() => runs++).pipe(Effect.andThen(Deferred.await(gate))),
        })

        const first = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        const second = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Fiber.interrupt(second)
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(first)

        expect(runs).toBe(1)
      }),
    ),
  )

  it.effect("runs different keys concurrently", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        const bothStarted = yield* Deferred.make<void>()
        let active = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++active).pipe(
              Effect.tap(() => (active === 2 ? Deferred.succeed(bothStarted, undefined) : Effect.void)),
              Effect.andThen(Deferred.await(gate)),
            ),
        })

        const first = yield* coordinator.run("first").pipe(Effect.forkChild)
        const second = yield* coordinator.run("second").pipe(Effect.forkChild)
        yield* Deferred.await(bothStarted)
        yield* Deferred.succeed(gate, undefined)
        yield* Effect.all([Fiber.join(first), Fiber.join(second)])
      }),
    ),
  )

  it.effect("trampolines synchronous self-waking execution", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const limit = 20_000
        const completed = yield* Deferred.make<void>()
        let runs = 0
        let wake: (key: string) => Effect.Effect<void> = () => Effect.void
        const coordinator = yield* SessionRunCoordinator.make<string, never>({
          drain: (key) =>
            Effect.sync(() => ++runs).pipe(
              Effect.tap((run) => (run < limit ? wake(key) : Deferred.succeed(completed, undefined))),
              Effect.asVoid,
            ),
        })
        wake = coordinator.wake

        yield* coordinator.wake("session")
        yield* Deferred.await(completed)

        expect(runs).toBe(limit)
      }),
    ),
  )
})
