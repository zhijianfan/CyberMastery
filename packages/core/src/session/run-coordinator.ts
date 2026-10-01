export * as SessionRunCoordinator from "./run-coordinator"

import { Deferred, Effect, Exit, Fiber, FiberSet, Scope } from "effect"

/** Serializes execution for each key while allowing different keys to run concurrently. */
export interface Coordinator<Key, E> {
  /** Snapshots keys with an execution owned by this coordinator. */
  readonly active: Effect.Effect<ReadonlySet<Key>>
  /** Starts execution while idle or joins the active execution. */
  readonly run: (key: Key) => Effect.Effect<void, E>
  /** Joins only the execution already active for this key. */
  readonly wait: (key: Key) => Effect.Effect<void>
  /** Runs an action at an idle boundary without starting a drain. */
  readonly exclusive: (key: Key, action: Effect.Effect<void, E>) => Effect.Effect<void, E>
  /** Registers one coalesced follow-up after newly recorded work. */
  readonly wake: (key: Key) => Effect.Effect<void>
  /** Stops active execution and waits for its cleanup. */
  readonly interrupt: (key: Key) => Effect.Effect<void>
  /** Permanently prevents starts for this key and joins active cleanup. */
  readonly stop: (key: Key) => Effect.Effect<void>
}

type Entry<E> = {
  readonly done: Deferred.Deferred<void, E>
  readonly finished: Deferred.Deferred<void>
  readonly exclusive: boolean
  owner?: Fiber.Fiber<void, never>
  pendingWake: boolean
  successor?: Entry<E>
  canceledSuccessors: Entry<E>[]
  successorForce: boolean
  stopping: boolean
}

export const make = <Key, E>(options: {
  readonly drain: (key: Key, force: boolean) => Effect.Effect<void, E>
}): Effect.Effect<Coordinator<Key, E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const active = new Map<Key, Entry<E>>()
    const stopped = new Set<Key>()
    const fork = yield* FiberSet.makeRuntime<never, void, never>()

    const makeEntry = (exclusive = false): Entry<E> => ({
      done: Deferred.makeUnsafe<void, E>(),
      finished: Deferred.makeUnsafe<void>(),
      exclusive,
      pendingWake: false,
      canceledSuccessors: [],
      successorForce: false,
      stopping: false,
    })

    const start = (key: Key, entry: Entry<E>, force: boolean, successor = false, action?: Effect.Effect<void, E>) => {
      const ready = Deferred.makeUnsafe<void>()
      const owner = fork(
        (successor ? Effect.yieldNow : Deferred.await(ready)).pipe(
          Effect.andThen(Effect.suspend(() => action ?? options.drain(key, force))),
          Effect.onExit((exit) => Effect.sync(() => settle(key, entry, exit))),
          Effect.exit,
          Effect.asVoid,
        ),
      )
      entry.owner = owner
      if (!successor) Deferred.doneUnsafe(ready, Effect.void)
    }

    const settle = (key: Key, entry: Entry<E>, exit: Exit.Exit<void, E>) => {
      if (stopped.has(key)) {
        active.delete(key)
        if (entry.successor) Deferred.doneUnsafe(entry.successor.done, exit)
        entry.canceledSuccessors.forEach((successor) => Deferred.doneUnsafe(successor.done, exit))
        Deferred.doneUnsafe(entry.done, exit)
        Deferred.doneUnsafe(entry.finished, Effect.void)
        return
      }
      if (entry.exclusive) {
        if (!entry.successor) active.delete(key)
        else {
          active.set(key, entry.successor)
          start(key, entry.successor, entry.successorForce, true)
        }
        entry.canceledSuccessors.forEach((successor) => Deferred.doneUnsafe(successor.done, exit))
        Deferred.doneUnsafe(entry.done, exit)
        Deferred.doneUnsafe(entry.finished, Effect.void)
        return
      }
      if (Exit.isSuccess(exit) && !entry.stopping && entry.pendingWake) {
        entry.pendingWake = false
        start(key, entry, false, true)
        return
      }

      const successor = entry.pendingWake ? makeEntry() : undefined
      if (successor === undefined) active.delete(key)
      else {
        active.set(key, successor)
        start(key, successor, false, true)
      }
      Deferred.doneUnsafe(entry.done, exit)
      Deferred.doneUnsafe(entry.finished, Effect.void)
    }

    const run = (key: Key): Effect.Effect<void, E> =>
      Effect.uninterruptibleMask((restore) => {
        if (stopped.has(key)) return Effect.void
        const entry = active.get(key)
        if (entry !== undefined) {
          if (entry.stopping) return restore(Deferred.await(entry.done).pipe(Effect.andThen(run(key))))
          if (entry.exclusive) {
            const successor = entry.successor ?? makeEntry()
            entry.successor = successor
            entry.successorForce = true
            return restore(Deferred.await(successor.done))
          }
          return restore(Deferred.await(entry.done))
        }

        const next = makeEntry()
        active.set(key, next)
        start(key, next, true)
        return restore(Deferred.await(next.done))
      })

    const exclusive = (key: Key, action: Effect.Effect<void, E>): Effect.Effect<void, E> =>
      Effect.uninterruptibleMask((restore) => {
        if (stopped.has(key)) return Effect.void
        const entry = active.get(key)
        if (entry !== undefined)
          return restore(Deferred.await(entry.done).pipe(Effect.exit, Effect.andThen(exclusive(key, action))))
        const next = makeEntry(true)
        active.set(key, next)
        start(key, next, false, false, action)
        return restore(Deferred.await(next.done))
      })

    const wake = (key: Key) =>
      Effect.sync(() => {
        if (stopped.has(key)) return
        const entry = active.get(key)
        if (entry !== undefined) {
          if (entry.exclusive) {
            entry.successor ??= makeEntry()
            return
          }
          entry.pendingWake = true
          return
        }

        const next = makeEntry()
        active.set(key, next)
        start(key, next, false)
      })

    const interrupt = (key: Key): Effect.Effect<void> =>
      Effect.suspend(() => {
        const entry = active.get(key)
        if (entry?.owner === undefined) return Effect.void
        entry.stopping = true
        entry.pendingWake = false
        if (entry.exclusive) {
          if (entry.successor) entry.canceledSuccessors.push(entry.successor)
          entry.successor = undefined
          entry.successorForce = false
        }
        return Fiber.interrupt(entry.owner)
      })

    const wait = (key: Key) => Effect.suspend(() => {
      const entry = active.get(key)
      return entry ? Deferred.await(entry.finished) : Effect.void
    })

    const stop = (key: Key): Effect.Effect<void> =>
      Effect.uninterruptible(
        Effect.suspend(() => {
          stopped.add(key)
          const entry = active.get(key)
          if (entry?.owner === undefined) return Effect.void
          entry.stopping = true
          entry.pendingWake = false
          return Fiber.interrupt(entry.owner)
        }),
      )

    return { active: Effect.sync(() => new Set(active.keys())), run, wait, exclusive, wake, interrupt, stop }
  })
