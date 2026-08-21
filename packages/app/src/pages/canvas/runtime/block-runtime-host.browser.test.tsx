import { afterEach, describe, expect, test } from "bun:test"
import { createComponent, createSignal } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import type { ServerEvent } from "@/context/server-sdk"
import { BlockRuntimeHost } from "./block-runtime-host"
import type { BlockRuntimeRegistration, BlockRuntimeServices, RuntimeBlockHandle } from "./contracts"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

const Fragment = (props: { children?: unknown }) => props.children
;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

afterEach(() => {
  document.body.innerHTML = ""
})

const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 5))

function makeDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolveValue) => {
    resolve = resolveValue
  })
  return { promise, resolve }
}

const makeServices = (): BlockRuntimeServices => ({
  serverSDK: (() => undefined) as never,
  eventRouter: {
    on: () => () => {},
    off: () => {},
    onReconnect: () => () => {},
  },
  workspace: {
    id: () => "workspace-1",
    epoch: () => 0,
    connected: () => true,
    awaitDescriptorPersisted: async () => {},
  },
  localView: {
    read: () => undefined,
    write: () => {},
    delete: () => {},
    clearAll: () => {},
  },
})

let observedHandle: RuntimeBlockHandle

test("BlockRuntimeHost resolves, coalesces events, refreshes on reconnect, and preserves stale view", async () => {
  let eventListener: ((event: ServerEvent) => void) | undefined
  let reconnectListener: (() => void) | undefined
  let resolves = 0
  let fail = true
  let resolveGate: Promise<void> | undefined
  let releaseResolve: (() => void) | undefined
  const commands: unknown[] = []
  const disposed: number[] = []

  const services = {
    serverSDK: (() => undefined) as never,
    eventRouter: {
      on: (_key, listener) => {
        eventListener = listener
        return () => {
          eventListener = undefined
        }
      },
      off: () => {},
      onReconnect: (listener) => {
        reconnectListener = listener
        return () => {
          reconnectListener = undefined
        }
      },
    },
    workspace: {
      id: () => "workspace-1",
      epoch: () => 0,
      connected: () => true,
      awaitDescriptorPersisted: async () => {},
    },
    localView: {
      read: () => undefined,
      write: () => {},
      delete: () => {},
      clearAll: () => {},
    },
  } satisfies BlockRuntimeServices

  const registration = {
    functionalityID: "builtin:test",
    mode: "projected",
    resolve: async () => {
      if (fail) throw new Error("offline")
      resolves += 1
      await resolveGate
      return resolves
    },
    eventKeys: () => [{ type: "workspace.functionality.instance.changed", blockID: "block-1" }],
    onEvent: () => "invalidate",
    select: ({ resolved }) => resolved,
    dispatch: async ({ command }) => {
      commands.push(command)
    },
    dispose: (resolved) => {
      disposed.push(resolved)
    },
  } satisfies BlockRuntimeRegistration<number, number, { type: "run" }>

  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () =>
      h(BlockRuntimeHost as never, {
        blockID: "block-1",
        functionalityID: "builtin:test",
        registration: registration as never,
        services,
        workspaceID: "workspace-1",
        onHandle: (handle: RuntimeBlockHandle) => {
          observedHandle = handle
        },
        children: h("div", { "data-testid": "child" }),
      }) as never,
    host,
  )

  await wait()
  expect(observedHandle.status()).toBe("error")
  expect(observedHandle.view()).toBeUndefined()

  fail = false
  reconnectListener?.()
  await wait()
  expect(observedHandle.status()).toBe("ready")
  expect(observedHandle.view()).toBe(1)

  const event = { type: "workspace.functionality.instance.changed", properties: {} } as ServerEvent
  eventListener?.(event)
  eventListener?.(event)
  await wait()
  expect(resolves).toBe(2)
  expect(observedHandle.view()).toBe(2)

  resolveGate = new Promise<void>((resolve) => {
    releaseResolve = resolve
  })
  eventListener?.(event)
  await wait()
  expect(resolves).toBe(3)
  eventListener?.(event)
  resolveGate = undefined
  releaseResolve?.()
  await wait()
  expect(resolves).toBe(4)
  expect(observedHandle.view()).toBe(4)

  fail = true
  reconnectListener?.()
  await wait()
  expect(observedHandle.status()).toBe("error")
  expect(observedHandle.view()).toBe(4)

  fail = false
  await observedHandle.dispatch({ type: "run" })
  expect(commands).toEqual([{ type: "run" }])
  expect(observedHandle.view()).toBe(5)

  dispose()
  expect(disposed).toEqual([1, 2, 3, 4, 5])
})

test("replacement registration owns subscriptions and disposal", async () => {
  const eventListeners = new Map<string, (event: ServerEvent) => void>()
  const reconnectListeners = new Set<() => void>()
  const disposed: string[] = []
  const events: string[] = []
  const registration = (name: string) =>
    ({
      functionalityID: "builtin:test",
      mode: "projected",
      resolve: async () => name,
      eventKeys: () => [{ type: name }],
      onEvent: ({ resolved }) => {
        events.push(resolved)
        return "ignore"
      },
      select: ({ resolved }) => resolved,
      dispose: (resolved) => {
        disposed.push(resolved)
      },
    }) satisfies BlockRuntimeRegistration<string, string, never>
  const first = registration("first")
  const second = registration("second")
  const [current, setCurrent] = createSignal(first)
  const services = {
    serverSDK: (() => undefined) as never,
    eventRouter: {
      on: (key, listener) => {
        eventListeners.set(key.type, listener)
        return () => {
          eventListeners.delete(key.type)
        }
      },
      off: () => {},
      onReconnect: (listener) => {
        reconnectListeners.add(listener)
        return () => {
          reconnectListeners.delete(listener)
        }
      },
    },
    workspace: {
      id: () => "workspace-1",
      epoch: () => 0,
      connected: () => true,
      awaitDescriptorPersisted: async () => {},
    },
    localView: {
      read: () => undefined,
      write: () => {},
      delete: () => {},
      clearAll: () => {},
    },
  } satisfies BlockRuntimeServices
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () =>
      h(BlockRuntimeHost as never, {
        blockID: "block-1",
        functionalityID: "builtin:test",
        get registration() {
          return current() as never
        },
        services,
        workspaceID: "workspace-1",
        children: h("div"),
      }) as never,
    host,
  )

  await wait()
  expect([...eventListeners.keys()]).toEqual(["first"])

  setCurrent(second)
  await wait()
  expect(disposed).toEqual(["first"])
  expect([...eventListeners.keys()]).toEqual(["second"])
  expect(reconnectListeners.size).toBe(1)

  eventListeners.get("second")?.({ type: "second", properties: {} } as unknown as ServerEvent)
  expect(events).toEqual(["second"])

  dispose()
  expect(disposed).toEqual(["first", "second"])
  expect(eventListeners.size).toBe(0)
  expect(reconnectListeners.size).toBe(0)
})

test("missing runtime services is unavailable without resolving", async () => {
  let resolves = 0
  let handle: RuntimeBlockHandle | undefined
  const registration = {
    functionalityID: "builtin:test",
    mode: "projected",
    resolve: async () => {
      resolves += 1
      return undefined
    },
    select: () => undefined,
  } satisfies BlockRuntimeRegistration<undefined, undefined, never>
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () =>
      h(BlockRuntimeHost as never, {
        blockID: "block-1",
        functionalityID: "builtin:test",
        registration: registration as never,
        workspaceID: "workspace-1",
        onHandle: (next: RuntimeBlockHandle) => {
          handle = next
        },
        children: h("div"),
      }) as never,
    host,
  )

  await wait()
  expect(handle?.status()).toBe("unavailable")
  expect(resolves).toBe(0)
  dispose()
})

test("classifies normalized and SDK-wrapped runtime errors", async () => {
  const cases = [
    { label: "normalized access denial", error: { type: "access-denied" }, status: "permission-denied" },
    { label: "normalized workspace absence", error: { type: "workspace-not-found" }, status: "unavailable" },
    { label: "normalized block absence", error: { type: "block-not-found" }, status: "unavailable" },
    { label: "normalized functionality mismatch", error: { type: "wrong-functionality" }, status: "unavailable" },
    {
      label: "wrapped unauthorized error",
      error: { cause: { body: { _tag: "MasterAgentUnauthorizedError" } } },
      status: "permission-denied",
    },
    {
      label: "wrapped access-denied error",
      error: { cause: { body: { _tag: "MasterAgentAccessDeniedError" } } },
      status: "permission-denied",
    },
    {
      label: "wrapped not-found error",
      error: { cause: { body: { _tag: "MasterAgentNotFoundError" } } },
      status: "unavailable",
    },
    {
      label: "wrapped wrong-functionality error",
      error: { cause: { body: { _tag: "MasterAgentWrongFunctionalityError" } } },
      status: "unavailable",
    },
    { label: "unknown error", error: { cause: { body: { _tag: "UnexpectedError" } } }, status: "error" },
  ] as const

  for (const entry of cases) {
    let handle: RuntimeBlockHandle | undefined
    const registration = {
      functionalityID: "builtin:test",
      mode: "projected",
      resolve: async () => {
        throw entry.error
      },
      select: ({ resolved }) => resolved,
    } satisfies BlockRuntimeRegistration<unknown, unknown, never>
    const host = document.createElement("div")
    document.body.append(host)
    const dispose = render(
      () =>
        h(BlockRuntimeHost as never, {
          blockID: "block-1",
          functionalityID: "builtin:test",
          registration: registration as never,
          services: makeServices(),
          workspaceID: "workspace-1",
          onHandle: (next: RuntimeBlockHandle) => {
            handle = next
          },
          children: h("div"),
        }) as never,
      host,
    )

    await wait()
    expect({ label: entry.label, status: handle?.status() }).toEqual({ label: entry.label, status: entry.status })
    dispose()
    host.remove()
  }
})

test("late resolve after registration replacement is disposed by its registration", async () => {
  const late = makeDeferred<string>()
  const disposed: string[] = []
  let handle: RuntimeBlockHandle | undefined
  const first = {
    functionalityID: "builtin:test",
    mode: "projected",
    resolve: async () => late.promise,
    select: ({ resolved }) => resolved,
    dispose: (resolved) => {
      disposed.push(`first:${resolved}`)
    },
  } satisfies BlockRuntimeRegistration<string, string, never>
  const second = {
    functionalityID: "builtin:test",
    mode: "projected",
    resolve: async () => "ready",
    select: ({ resolved }) => resolved,
    dispose: (resolved) => {
      disposed.push(`second:${resolved}`)
    },
  } satisfies BlockRuntimeRegistration<string, string, never>
  const [registration, setRegistration] = createSignal(first)
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () =>
      h(BlockRuntimeHost as never, {
        blockID: "block-1",
        functionalityID: "builtin:test",
        get registration() {
          return registration() as never
        },
        services: makeServices(),
        workspaceID: "workspace-1",
        onHandle: (next: RuntimeBlockHandle) => {
          handle = next
        },
        children: h("div"),
      }) as never,
    host,
  )

  await wait()
  setRegistration(second)
  late.resolve("late")
  await wait()

  expect(disposed).toEqual(["first:late"])
  expect(handle?.view()).toBe("ready")
  dispose()
})

test("late resolve after unmount is disposed by its registration", async () => {
  const late = makeDeferred<string>()
  const disposed: string[] = []
  const registration = {
    functionalityID: "builtin:test",
    mode: "projected",
    resolve: async () => late.promise,
    select: ({ resolved }) => resolved,
    dispose: (resolved) => {
      disposed.push(resolved)
    },
  } satisfies BlockRuntimeRegistration<string, string, never>
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () =>
      h(BlockRuntimeHost as never, {
        blockID: "block-1",
        functionalityID: "builtin:test",
        registration: registration as never,
        services: makeServices(),
        workspaceID: "workspace-1",
        children: h("div"),
      }) as never,
    host,
  )

  await wait()
  dispose()
  late.resolve("late")
  await wait()

  expect(disposed).toEqual(["late"])
})
