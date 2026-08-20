import { expect, test } from "bun:test"
import type { BlockRuntimeServices } from "../contracts"
import type { ServerEvent } from "@/context/server-sdk"
import { createHostSessionBindingRegistration, type HostSessionBindingState } from "./session-binding"

interface Binding {
  sessionID: string
  revision: number
}

function makeDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue
    reject = rejectValue
  })
  return { promise, resolve, reject }
}

function abortError(): Error {
  const error = new Error("The operation was aborted")
  error.name = "AbortError"
  return error
}

function makeWorkspaceServices(
  workspaceID: string,
  options: {
    epoch?: number
    awaitDescriptorPersisted?: (blockID: string) => Promise<void>
  } = {},
) {
  const awaited = options.awaitDescriptorPersisted ?? (() => Promise.resolve())
  const epoch = options.epoch ?? 1
  return {
    id: () => workspaceID,
    epoch: () => epoch,
    connected: () => true,
    awaitDescriptorPersisted: (blockID: string) => awaited(blockID),
  } as BlockRuntimeServices["workspace"]
}

function makeServices(input: {
  workspaceID: string
  workspaceEpoch?: number
  awaitDescriptorPersisted?: (blockID: string) => Promise<void>
}) {
  return {
    serverSDK: () => ({}),
    eventRouter: {},
    workspace: makeWorkspaceServices(input.workspaceID, {
      epoch: input.workspaceEpoch,
      awaitDescriptorPersisted: input.awaitDescriptorPersisted,
    }),
    localView: {} as BlockRuntimeServices["localView"],
  } as unknown as BlockRuntimeServices
}

function changedEvent(blockID: string, revision: number, functionalityID = "builtin:host"): ServerEvent {
  return {
    id: "evt-1",
    type: "workspace.functionality.instance.changed",
    properties: {
      workspaceID: "workspace-1",
      blockID,
      functionalityID,
      revision,
    },
  } as unknown as ServerEvent
}

function legacyEvent(type: string, blockID: string, revision = 1): ServerEvent {
  return {
    id: "evt-2",
    type,
    properties: {
      workspaceID: "workspace-1",
      blockID,
      revision,
    },
  } as unknown as ServerEvent
}

function createAdapter(
  handlers: {
    get: () => Promise<HostSessionBindingState<Binding>>
    ensure: (signal?: AbortSignal) => Promise<Binding>
    reset: (binding: Binding, signal: AbortSignal) => Promise<void>
    normalizeError: (error: unknown) => unknown
    eventTypes?: readonly string[]
    validateBinding?: (value: unknown) => Binding | undefined
  },
) {
  return createHostSessionBindingRegistration<Binding, "reset">({
    functionalityID: "builtin:host",
    get: () => handlers.get(),
    ensure: (_services, signal) => handlers.ensure(signal),
    reset: (binding, _services, signal) => handlers.reset(binding, signal),
    normalizeError: handlers.normalizeError,
    eventTypes: handlers.eventTypes ?? ["workspace.master-agent.binding.updated", "workspace.chatRelay.binding.updated"],
    validateBinding: handlers.validateBinding ?? ((value): Binding | undefined => {
      if (!value || typeof value !== "object") return undefined
      const candidate = value as Partial<Binding>
      if (typeof candidate.sessionID !== "string") return undefined
      if (typeof candidate.revision !== "number") return undefined
      return candidate as Binding
    }),
  })
}

test("unbound -> ensure -> bound", async () => {
  let descriptorPersisted = 0
  const services = makeServices({
    workspaceID: "workspace-1",
    awaitDescriptorPersisted: async () => {
      descriptorPersisted += 1
    },
  })
  let getCalls = 0
  let ensureCalls = 0

  const registration = createAdapter({
    get: async () => {
      getCalls += 1
      return { status: "unbound" }
    },
    ensure: async () => {
      ensureCalls += 1
      return { sessionID: "session-1", revision: 1 }
    },
    reset: async () => {
      throw new Error("unexpected")
    },
    normalizeError: (error) => error,
  })

  const resolved = await registration.resolve({
    workspaceID: "workspace-1",
    block: { id: "block-1", functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    services,
    signal: new AbortController().signal,
  })

  expect(resolved.status).toBe("bound")
  if (resolved.status !== "bound") throw new Error("bound state expected")
  expect(resolved.binding.sessionID).toBe("session-1")
  expect(getCalls).toBe(1)
  expect(ensureCalls).toBe(1)
  expect(descriptorPersisted).toBe(1)
})

test("concurrent ensure calls converge", async () => {
  const services = makeServices({ workspaceID: "workspace-1" })
  let getCalls = 0
  let ensureCalls = 0
  const ensureDeferred = makeDeferred<Binding>()

  const registration = createAdapter({
    get: async () => {
      getCalls += 1
      return { status: "unbound" }
    },
    ensure: async (signal) => {
      ensureCalls += 1
      signal?.addEventListener("abort", () => ensureDeferred.reject(signal.reason ?? new Error("aborted")))
      return ensureDeferred.promise
    },
    reset: async () => {
      throw new Error("unexpected")
    },
    normalizeError: (error) => error,
  })

  const request = new AbortController()
  const p1 = registration.resolve({
    workspaceID: "workspace-1",
    block: { id: "block-1", functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    services,
    signal: request.signal,
  })
  const p2 = registration.resolve({
    workspaceID: "workspace-1",
    block: { id: "block-1", functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    services,
    signal: request.signal,
  })

  while (ensureCalls === 0) {
    await Promise.resolve()
  }

  expect(getCalls).toBe(1)

  ensureDeferred.resolve({ sessionID: "session-1", revision: 1 })
  const [first, second] = await Promise.all([p1, p2])

  expect(first).toEqual(second)
  if (first.status !== "bound" || second.status !== "bound") return
  expect(first.binding).toEqual(second.binding)
  expect(ensureCalls).toBe(1)
})

test("event arrives before initial get completes", async () => {
  const services = makeServices({ workspaceID: "workspace-1" })
  let getCalls = 0
  const getDeferred = makeDeferred<HostSessionBindingState<Binding>>()

  const registration = createAdapter({
    get: async () => {
      getCalls += 1
      return getDeferred.promise
    },
    ensure: async () => ({ sessionID: "session-2", revision: 2 }),
    reset: async () => {
      throw new Error("unexpected")
    },
    normalizeError: (error) => error,
  })

  const first = registration.resolve({
    workspaceID: "workspace-1",
    block: { id: "block-1", functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    services,
    signal: new AbortController().signal,
  })
  const pending = { status: "unbound" } as const

  const ev = registration.onEvent?.({
    event: changedEvent("block-1", 2),
    resolved: pending,
    services,
  })

  expect(ev).toBe("invalidate")

  const duplicate = registration.onEvent?.({
    event: changedEvent("block-1", 2),
    resolved: pending,
    services,
  })
  expect(duplicate).toBe("ignore")

  getDeferred.resolve({ status: "bound", binding: { sessionID: "session-2", revision: 2 } })

  const resolved = await first
  expect(resolved.status).toBe("bound")
  expect(getCalls).toBe(1)
})

test("newer event during refresh remains invalidating", async () => {
  const services = makeServices({ workspaceID: "workspace-1" })
  const refresh = makeDeferred<HostSessionBindingState<Binding>>()
  let getCalls = 0

  const registration = createAdapter({
    get: async () => {
      getCalls += 1
      if (getCalls === 1) return { status: "bound", binding: { sessionID: "session-1", revision: 1 } }
      return refresh.promise
    },
    ensure: async () => ({ sessionID: "session-1", revision: 1 }),
    reset: async () => {
      throw new Error("unexpected")
    },
    normalizeError: (error) => error,
  })
  const request = {
    workspaceID: "workspace-1",
    block: { id: "block-1", functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    services,
    signal: new AbortController().signal,
  }
  const resolved = await registration.resolve(request)

  expect(registration.onEvent?.({ event: changedEvent("block-1", 2), resolved, services })).toBe("invalidate")
  const resolving = registration.resolve(request)
  while (getCalls < 2) await Promise.resolve()

  expect(registration.onEvent?.({ event: changedEvent("block-1", 3), resolved, services })).toBe("invalidate")

  refresh.resolve({ status: "bound", binding: { sessionID: "session-1", revision: 3 } })
  await resolving
})

test("stale and lower revision event ignored", async () => {
  const services = makeServices({ workspaceID: "workspace-1" })
  const registration = createAdapter({
    get: async () => ({ status: "bound", binding: { sessionID: "session-1", revision: 10 } }),
    ensure: async () => ({ sessionID: "session-1", revision: 10 }),
    reset: async () => {
      throw new Error("unexpected")
    },
    normalizeError: (error) => error,
  })

  const initial = await registration.resolve({
    workspaceID: "workspace-1",
    block: { id: "block-1", functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    services,
    signal: new AbortController().signal,
  })

  const ignoreEqual = registration.onEvent?.({
    event: changedEvent("block-1", 10),
    resolved: initial,
    services,
  })
  const ignoreLower = registration.onEvent?.({
    event: changedEvent("block-1", 9),
    resolved: initial,
    services,
  })
  const invalidate = registration.onEvent?.({
    event: changedEvent("block-1", 11),
    resolved: initial,
    services,
  })

  expect(ignoreEqual).toBe("ignore")
  expect(ignoreLower).toBe("ignore")
  expect(invalidate).toBe("invalidate")
})

test("reconnect performs refetch", async () => {
  const services = makeServices({ workspaceID: "workspace-1" })
  let getCalls = 0

  const registration = createAdapter({
    get: async () => {
      getCalls += 1
      return { status: "bound", binding: { sessionID: "session-1", revision: getCalls } }
    },
    ensure: async () => ({ sessionID: "session-1", revision: 1 }),
    reset: async () => {
      throw new Error("unexpected")
    },
    normalizeError: (error) => error,
  })

  const initial = await registration.resolve({
    workspaceID: "workspace-1",
    block: { id: "block-1", functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    services,
    signal: new AbortController().signal,
  })

  const action = registration.onEvent?.({
    event: changedEvent("block-1", 5),
    resolved: initial,
    services,
  })

  expect(action).toBe("invalidate")

  await registration.resolve({
    workspaceID: "workspace-1",
    block: { id: "block-1", functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    services,
    signal: new AbortController().signal,
  })

  expect(getCalls).toBe(2)
})

test("reset busy is surfaced", async () => {
  const services = makeServices({ workspaceID: "workspace-1" })
  let resetCalls = 0

  const registration = createAdapter({
    get: async () => ({ status: "bound", binding: { sessionID: "session-1", revision: 1 } }),
    ensure: async () => ({ sessionID: "session-1", revision: 1 }),
    reset: async () => {
      resetCalls += 1
      throw new Error("busy")
    },
    normalizeError: (error) =>
      error instanceof Error && error.message === "busy" ? { type: "reset-busy" } : { type: "unknown" },
  })

  const resolved = await registration.resolve({
    workspaceID: "workspace-1",
    block: { id: "block-1", functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    services,
    signal: new AbortController().signal,
  })

  await expect(
    registration.dispatch!({
      resolved,
      command: "reset",
      services,
      signal: new AbortController().signal,
    }),
  ).rejects.toEqual({ type: "reset-busy" })
  expect(resetCalls).toBe(1)
})

test("reset stale then refetch", async () => {
  const services = makeServices({ workspaceID: "workspace-1" })
  let getCalls = 0

  const registration = createAdapter({
    get: async () => {
      getCalls += 1
      return { status: "bound", binding: { sessionID: `session-${getCalls}`, revision: getCalls } }
    },
    ensure: async () => ({ sessionID: "session-1", revision: 1 }),
    reset: async () => {
      throw { type: "stale-binding", current: { revision: 2 } }
    },
    normalizeError: (error) => error,
  })

  const resolved = await registration.resolve({
    workspaceID: "workspace-1",
    block: { id: "block-1", functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    services,
    signal: new AbortController().signal,
  })

  await expect(
    registration.dispatch!({
      resolved,
      command: "reset",
      services,
      signal: new AbortController().signal,
    }),
  ).rejects.toEqual({ type: "stale-binding", current: { revision: 2 } })

  expect(getCalls).toBeGreaterThan(1)
})

test("workspace epoch change disposes and re-resolves", async () => {
  const epoch = { value: 1 }
  const services = makeServices({ workspaceID: "workspace-1", workspaceEpoch: epoch.value })
  let getCalls = 0

  const registration = createAdapter({
    get: async () => {
      getCalls += 1
      return { status: "bound", binding: { sessionID: `session-${getCalls}`, revision: getCalls } }
    },
    ensure: async () => ({ sessionID: "session-1", revision: 1 }),
    reset: async () => {
      throw new Error("unexpected")
    },
    normalizeError: (error) => error,
    eventTypes: ["workspace.master-agent.binding.updated"],
    validateBinding: (value): Binding | undefined => {
      if (!value || typeof value !== "object") return undefined
      const candidate = value as Partial<Binding>
      if (typeof candidate.sessionID !== "string") return undefined
      if (typeof candidate.revision !== "number") return undefined
      return candidate as Binding
    },
  })

  await registration.resolve({
    workspaceID: "workspace-1",
    block: { id: "block-1", functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    services,
    signal: new AbortController().signal,
  })

  epoch.value = 2
  const next = makeServices({ workspaceID: "workspace-1", workspaceEpoch: epoch.value })
  await registration.resolve({
    workspaceID: "workspace-1",
    block: { id: "block-1", functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    services: next,
    signal: new AbortController().signal,
  })

  expect(getCalls).toBe(2)
})

test("request abort cancels ensure in flight", async () => {
  const services = makeServices({ workspaceID: "workspace-1" })
  let ensureCalls = 0
  const ensureDeferred = makeDeferred<Binding>()

  const registration = createAdapter({
    get: async () => ({ status: "unbound" }),
    ensure: async (signal) => {
      ensureCalls += 1
      return await ensureDeferred.promise.catch((reason) => {
        if (signal?.aborted) throw reason
        throw reason
      })
    },
    reset: async () => {
      throw new Error("unexpected")
    },
    normalizeError: (error) => error,
  })

  const controller = new AbortController()

  const running = registration.resolve({
    workspaceID: "workspace-1",
    block: { id: "block-1", functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    services,
    signal: controller.signal,
  })

  while (ensureCalls === 0) {
    await Promise.resolve()
  }

  controller.abort(abortError())
  ensureDeferred.reject(controller.signal.reason)
  await expect(running).rejects.toBeDefined()
  expect(controller.signal.aborted).toBe(true)
  expect(ensureCalls).toBe(1)
})

test("two blocks have isolated bindings", async () => {
  const services = makeServices({ workspaceID: "workspace-1" })
  let callsA = 0
  let callsB = 0

  const regA = createAdapter({
    get: async () => {
      callsA += 1
      return { status: "bound", binding: { sessionID: `a-${callsA}`, revision: callsA } }
    },
    ensure: async () => ({ sessionID: "session-a", revision: 1 }),
    reset: async () => {
      throw new Error("unexpected")
    },
    normalizeError: (error) => error,
    eventTypes: ["domain.binding.updated"],
  })

  const regB = createAdapter({
    get: async () => {
      callsB += 1
      return { status: "bound", binding: { sessionID: `b-${callsB}`, revision: callsB } }
    },
    ensure: async () => ({ sessionID: "session-b", revision: 1 }),
    reset: async () => {
      throw new Error("unexpected")
    },
    normalizeError: (error) => error,
    eventTypes: ["domain.binding.updated"],
  })

  const firstA = await regA.resolve({
    workspaceID: "workspace-1",
    block: { id: "block-a", functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    services,
    signal: new AbortController().signal,
  })

  const firstB = await regB.resolve({
    workspaceID: "workspace-1",
    block: { id: "block-b", functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    services,
    signal: new AbortController().signal,
  })

  const wrong = regA.onEvent?.({
    event: legacyEvent("domain.binding.updated", "block-b", 9),
    resolved: firstA,
    services,
  })

  expect(wrong).toBe("ignore")
  expect(firstA.status).toBe("bound")
  expect(firstB.status).toBe("bound")
  expect(callsA).toBe(1)
  expect(callsB).toBe(1)
})

test("shared registration preserves each resolved block identity", async () => {
  const services = makeServices({ workspaceID: "workspace-1" })
  let getCalls = 0
  const registration = createAdapter({
    get: async () => {
      getCalls += 1
      return { status: "bound", binding: { sessionID: `session-${getCalls}`, revision: 1 } }
    },
    ensure: async () => ({ sessionID: "session-1", revision: 1 }),
    reset: async () => {
      throw new Error("unexpected")
    },
    normalizeError: (error) => error,
  })
  const resolve = (blockID: string) =>
    registration.resolve({
      workspaceID: "workspace-1",
      block: { id: blockID, functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
      services,
      signal: new AbortController().signal,
    })

  const first = await resolve("block-a")
  const second = await resolve("block-b")

  expect(registration.eventKeys?.(first)).toContainEqual({
    type: "workspace.functionality.instance.changed",
    functionalityID: "builtin:host",
    workspaceID: "workspace-1",
    blockID: "block-a",
  })
  expect(registration.onEvent?.({ event: changedEvent("block-a", 2), resolved: first, services })).toBe("invalidate")
  expect(registration.onEvent?.({ event: changedEvent("block-b", 2), resolved: first, services })).toBe("ignore")
  expect(registration.eventKeys?.(second)).toContainEqual({
    type: "workspace.functionality.instance.changed",
    functionalityID: "builtin:host",
    workspaceID: "workspace-1",
    blockID: "block-b",
  })
})

test("concurrent resolves for different blocks do not share bindings", async () => {
  const services = makeServices({ workspaceID: "workspace-1" })
  const first = makeDeferred<HostSessionBindingState<Binding>>()
  const second = makeDeferred<HostSessionBindingState<Binding>>()
  let getCalls = 0
  const registration = createAdapter({
    get: async () => {
      getCalls += 1
      return getCalls === 1 ? first.promise : second.promise
    },
    ensure: async () => ({ sessionID: "unexpected", revision: 0 }),
    reset: async () => {
      throw new Error("unexpected")
    },
    normalizeError: (error) => error,
  })
  const resolve = (blockID: string) =>
    registration.resolve({
      workspaceID: "workspace-1",
      block: { id: blockID, functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
      services,
      signal: new AbortController().signal,
    })
  const resolvingFirst = resolve("block-a")
  const resolvingSecond = resolve("block-b")

  first.resolve({ status: "bound", binding: { sessionID: "session-a", revision: 1 } })
  second.resolve({ status: "bound", binding: { sessionID: "session-b", revision: 1 } })
  const [resolvedFirst, resolvedSecond] = await Promise.all([resolvingFirst, resolvingSecond])

  expect(getCalls).toBe(2)
  expect(resolvedFirst).toEqual({ status: "bound", binding: { sessionID: "session-a", revision: 1 } })
  expect(resolvedSecond).toEqual({ status: "bound", binding: { sessionID: "session-b", revision: 1 } })
})

test("concurrent dispatches for different blocks do not share commands", async () => {
  const services = makeServices({ workspaceID: "workspace-1" })
  const first = makeDeferred<void>()
  const second = makeDeferred<void>()
  let getCalls = 0
  const resets: string[] = []
  const registration = createAdapter({
    get: async () => {
      getCalls += 1
      return { status: "bound", binding: { sessionID: getCalls === 1 ? "session-a" : "session-b", revision: 1 } }
    },
    ensure: async () => ({ sessionID: "unexpected", revision: 0 }),
    reset: async (binding) => {
      resets.push(binding.sessionID)
      return binding.sessionID === "session-a" ? first.promise : second.promise
    },
    normalizeError: (error) => error,
  })
  const resolve = (blockID: string) =>
    registration.resolve({
      workspaceID: "workspace-1",
      block: { id: blockID, functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
      services,
      signal: new AbortController().signal,
    })
  const resolvedFirst = await resolve("block-a")
  const resolvedSecond = await resolve("block-b")
  const dispatch = (resolved: HostSessionBindingState<Binding>) =>
    registration.dispatch?.({ resolved, command: "reset", services, signal: new AbortController().signal })
  const dispatchingFirst = dispatch(resolvedFirst)
  const dispatchingSecond = dispatch(resolvedSecond)

  first.resolve(undefined)
  second.resolve(undefined)
  await Promise.all([dispatchingFirst, dispatchingSecond])

  expect(resets).toEqual(["session-a", "session-b"])
})

test("disposing one block does not abort another block command", async () => {
  const services = makeServices({ workspaceID: "workspace-1" })
  let getCalls = 0
  let release: (() => void) | undefined
  let commandSignal: AbortSignal | undefined
  const registration = createAdapter({
    get: async () => {
      getCalls += 1
      return { status: "bound", binding: { sessionID: getCalls === 1 ? "session-a" : "session-b", revision: 1 } }
    },
    ensure: async () => ({ sessionID: "unexpected", revision: 0 }),
    reset: async (_binding, signal) => {
      commandSignal = signal
      await new Promise<void>((resolve, reject) => {
        release = resolve
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    },
    normalizeError: (error) => error,
  })
  const resolve = (blockID: string) =>
    registration.resolve({
      workspaceID: "workspace-1",
      block: { id: blockID, functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
      services,
      signal: new AbortController().signal,
    })
  const resolvedFirst = await resolve("block-a")
  const resolvedSecond = await resolve("block-b")
  const dispatching = registration.dispatch?.({
    resolved: resolvedSecond,
    command: "reset",
    services,
    signal: new AbortController().signal,
  })

  registration.dispose?.(resolvedFirst)
  const aborted = commandSignal?.aborted
  release?.()
  await dispatching?.catch(() => {})

  expect(aborted).toBe(false)
})

test("shared registration dispatch recovers with its resolved block identity", async () => {
  const persisted: string[] = []
  const services = makeServices({
    workspaceID: "workspace-1",
    awaitDescriptorPersisted: async (blockID) => {
      persisted.push(blockID)
    },
  })
  let getCalls = 0
  const registration = createAdapter({
    get: async () => {
      getCalls += 1
      if (getCalls <= 2) return { status: "bound", binding: { sessionID: `session-${getCalls}`, revision: 1 } }
      return { status: "unbound" }
    },
    ensure: async () => ({ sessionID: "session-recovered", revision: 2 }),
    reset: async () => {
      throw { type: "stale-binding" }
    },
    normalizeError: (error) => error,
  })
  const resolve = (blockID: string) =>
    registration.resolve({
      workspaceID: "workspace-1",
      block: { id: blockID, functionalityID: "builtin:host", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
      services,
      signal: new AbortController().signal,
    })
  const first = await resolve("block-a")
  await resolve("block-b")

  await expect(
    registration.dispatch?.({
      resolved: first,
      command: "reset",
      services,
      signal: new AbortController().signal,
    }),
  ).rejects.toEqual({ type: "stale-binding" })
  expect(persisted).toEqual(["block-a"])
})
