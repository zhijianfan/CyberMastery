import { afterEach, describe, expect, test } from "bun:test"
import { createComponent, createSignal } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import type { ServerEvent, ServerSDK } from "@/context/server-sdk"
import { ChatRelayRuntimeAdapter } from "../blocks/chat-relay/runtime"
import { ctxPackBrowserRegistration } from "../blocks/ctxpack-browser/adapter"
import { BlockRuntimeHost } from "./block-runtime-host"
import type { BlockRuntimeRegistration, BlockRuntimeServices, RuntimeBlockHandle } from "./contracts"
import { createBlockRuntimeEventRouter } from "./event-router"
import { BlockRuntimeProvider } from "./provider"
import { operatingChatRuntimeRegistration } from "./registrations/operating-chat"

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
type FakeServerEntry = {
  name: string
  details: { id?: string; type: string; properties: unknown; reconnected?: boolean }
}

function makeDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue
    reject = rejectValue
  })
  return { promise, resolve, reject }
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

test("opening a context pack keeps its detail selected in the mounted runtime", async () => {
  const pack = {
    id: "pack-1",
    workspaceID: "workspace-1",
    title: "Context pack",
    keywords: [],
    sensitivity: "workspace",
    revision: 1,
    contentHash: "pack-hash",
    byteLength: 0,
    estimatedTokens: 0,
    fragments: [],
    usage: { attachedCount: 0, lastAttachedAt: null },
    createdByUserID: "user-1",
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  }
  const services = {
    ...makeServices(),
    serverSDK: () =>
      ({
        client: {
          v2: {
            workspace: {
              ctxpack: {
                list: async () => ({ data: { items: [], nextCursor: null, totalEstimate: 0 } }),
                get: async () => ({ data: pack }),
              },
            },
          },
        },
      }) as unknown as ServerSDK,
  }
  let handle: RuntimeBlockHandle | undefined
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () =>
      h(BlockRuntimeHost as never, {
        blockID: "context-packs",
        functionalityID: "builtin:ctxpack-browser",
        registration: ctxPackBrowserRegistration as never,
        services,
        onHandle: (value: RuntimeBlockHandle) => {
          handle = value
        },
        children: h("div"),
      }) as never,
    host,
  )

  try {
    await wait()
    expect(handle?.status()).toBe("ready")
    await handle!.dispatch({ type: "open", ctxPackID: pack.id })
    expect(handle?.view()).toMatchObject({ selected: pack })

    await handle!.dispatch({ type: "close-detail" })
    expect(handle?.view()).toMatchObject({ selected: null })
  } finally {
    dispose()
  }
})

test("canonical ChatRelay binding events invalidate and refetch the runtime", async () => {
  let emit: ((event: { details: { type: string; properties: unknown } }) => void) | undefined
  let ensures = 0
  const router = createBlockRuntimeEventRouter({
    listen: (handler) => {
      emit = handler
      return () => {
        emit = undefined
      }
    },
  })
  const sdk = {
    client: {
      v2: {
        workspace: {
          chatRelay: {
            ensure: async () => {
              ensures += 1
              return {
                data: {
                  workspaceID: "workspace-1",
                  blockID: "block-1",
                  functionalityInstanceID: "instance-1",
                  sessionID: `session-${ensures}`,
                  directory: "/repo",
                  generation: ensures,
                  revision: ensures,
                },
              }
            },
          },
        },
      },
    },
  } as unknown as ServerSDK
  const services = {
    ...makeServices(),
    serverSDK: () => sdk,
    eventRouter: router as never,
  } satisfies BlockRuntimeServices
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () =>
      h(BlockRuntimeHost as never, {
        blockID: "block-1",
        functionalityID: "builtin:chat-relay",
        registration: ChatRelayRuntimeAdapter as never,
        services,
        workspaceID: "workspace-1",
        onHandle: (handle: RuntimeBlockHandle) => {
          observedHandle = handle
        },
        children: h("div"),
      }) as never,
    host,
  )

  await wait()
  expect(observedHandle.view()).toMatchObject({ sessionID: "session-1" })

  emit?.({
    details: {
      type: "workspace.chatRelay.binding.updated",
      properties: {
        workspaceID: "workspace-1",
        blockID: "block-1",
        sessionID: "session-2",
        generation: 2,
        revision: 2,
      },
    },
  })
  await wait()

  expect(ensures).toBe(2)
  expect(observedHandle.view()).toMatchObject({ sessionID: "session-2" })
  dispose()
  router.dispose()
})

test("a replayed event ID does not refetch again after the first refresh completes", async () => {
  let emit:
    | ((entry: {
        name: string
        details: { id: string; type: string; properties: Record<string, unknown> }
      }) => void)
    | undefined
  let ensures = 0
  let handle: RuntimeBlockHandle | undefined
  const sdk = {
    event: {
      listen: (listener: typeof emit) => {
        emit = listener
        return () => {
          emit = undefined
        }
      },
    },
    client: {
      v2: {
        workspace: {
          chatRelay: {
            ensure: async () => ({
              data: {
                workspaceID: "workspace-1",
                blockID: "block-1",
                functionalityInstanceID: "instance-1",
                sessionID: "session-1",
                directory: "/repo",
                generation: 1,
                revision: 1,
              },
            }),
          },
        },
      },
    },
  } as unknown as ServerSDK
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () =>
      createComponent(BlockRuntimeProvider as never, {
        workspaceID: () => "workspace-1",
        workspaceEpoch: () => 0,
        connected: () => true,
        awaitDescriptorPersisted: async () => {},
        recoverWorkspace: async () => false,
        serverSDK: () => sdk,
        localView: makeServices().localView,
        children: () =>
          createComponent(BlockRuntimeHost as never, {
            blockID: "block-1",
            functionalityID: "builtin:chat-relay",
            registration: {
              ...ChatRelayRuntimeAdapter,
              resolve: async (input: Parameters<typeof ChatRelayRuntimeAdapter.resolve>[0]) => {
                ensures += 1
                return ChatRelayRuntimeAdapter.resolve(input)
              },
            },
            workspaceID: "workspace-1",
            onHandle: (next: RuntimeBlockHandle) => {
              handle = next
            },
            children: h("div"),
          }),
      }) as never,
    host,
  )

  await wait()
  expect(handle?.view()).toMatchObject({ sessionID: "session-1" })
  const event = {
    name: "global",
    details: {
      id: "evt_duplicate",
      type: "workspace.chatRelay.binding.updated",
      properties: { workspaceID: "workspace-1", blockID: "block-1" },
    },
  }
  emit?.(event)
  await wait()
  expect(ensures).toBe(2)

  emit?.(event)
  await wait()
  expect(ensures).toBe(2)
  dispose()
})

test("reconnect during a failing non-reconnect refresh schedules one trailing authoritative request", async () => {
  const router = createBlockRuntimeEventRouter({ listen: () => () => {} })
  const olderRefresh = makeDeferred<void>()
  let resolves = 0
  let handle: RuntimeBlockHandle | undefined
  const registration = {
    functionalityID: "builtin:test",
    mode: "native",
    resolve: async () => {
      resolves += 1
      if (resolves === 2) await olderRefresh.promise
      return resolves
    },
    select: ({ resolved }) => resolved,
  } satisfies BlockRuntimeRegistration<number, number, never>
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () =>
      h(BlockRuntimeHost as never, {
        blockID: "block-1",
        functionalityID: "builtin:test",
        registration: registration as never,
        services: { ...makeServices(), eventRouter: router as never },
        workspaceID: "workspace-1",
        onHandle: (next: RuntimeBlockHandle) => {
          handle = next
        },
        children: h("div"),
      }) as never,
    host,
  )

  await wait()
  expect(handle?.view()).toBe(1)
  const pending = handle!.refresh("manual")
  await wait()
  expect(resolves).toBe(2)

  router.notifyReconnect()
  router.notifyReconnect()
  olderRefresh.reject(new Error("older refresh failed"))
  await pending
  await wait()
  expect(resolves).toBe(3)
  expect(handle?.view()).toBe(3)
  dispose()
  router.dispose()
})

test("a Provider mounted after initial connection refreshes on its first observed real reconnect", async () => {
  const listeners = new Set<(event: FakeServerEntry) => void>()
  let resolves = 0
  const sdk = {
    event: {
      listen: (listener: (event: FakeServerEntry) => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
  } as unknown as ServerSDK
  const registration = {
    functionalityID: "builtin:test",
    mode: "native",
    resolve: async () => ++resolves,
    eventKeys: () => [{ type: "workspace.test.updated", workspaceID: "workspace-1" }],
    select: ({ resolved }) => resolved,
  } satisfies BlockRuntimeRegistration<number, number, never>
  const mount = () => {
    let handle: RuntimeBlockHandle | undefined
    const host = document.createElement("div")
    document.body.append(host)
    const dispose = render(
      () =>
        createComponent(BlockRuntimeProvider as never, {
          workspaceID: () => "workspace-1",
          workspaceEpoch: () => 0,
          connected: () => true,
          awaitDescriptorPersisted: async () => {},
          recoverWorkspace: async () => false,
          serverSDK: () => sdk,
          localView: makeServices().localView,
          children: () =>
            createComponent(BlockRuntimeHost as never, {
              blockID: "block-1",
              functionalityID: "builtin:test",
              registration: registration as never,
              workspaceID: "workspace-1",
              onHandle: (next: RuntimeBlockHandle) => {
                handle = next
              },
              children: h("div"),
            }),
        }) as never,
      host,
    )
    return { dispose, handle: () => handle }
  }

  const early = mount()
  await wait()
  expect(early.handle()?.view()).toBe(1)
  listeners.forEach((listener) =>
    listener({ name: "global", details: { type: "server.connected", properties: {}, reconnected: false } }),
  )
  await wait()
  expect(resolves).toBe(1)
  early.dispose()

  const late = mount()
  await wait()
  expect(late.handle()?.view()).toBe(2)
  listeners.forEach((listener) =>
    listener({ name: "global", details: { type: "server.connected", properties: {}, reconnected: true } }),
  )
  await wait()
  expect(resolves).toBe(3)
  expect(late.handle()?.view()).toBe(3)
  late.dispose()
})

test("remounting OperatingChat and ChatRelay reuses their server-owned session bindings", async () => {
  const ensureCalls = { operatingChat: 0, chatRelay: 0 }
  const sdk = {
    client: {
      v2: {
        workspace: {
          operatingChat: {
            ensure: async () => {
              ensureCalls.operatingChat += 1
              return {
                data: {
                  workspaceID: "workspace-1",
                  blockID: "operating-1",
                  functionalityInstanceID: "instance-operating",
                  sessionID: "session-operating-existing",
                  directory: "/repo",
                  generation: 1,
                  revision: 1,
                },
              }
            },
          },
          chatRelay: {
            ensure: async () => {
              ensureCalls.chatRelay += 1
              return {
                data: {
                  workspaceID: "workspace-1",
                  blockID: "relay-1",
                  functionalityInstanceID: "instance-relay",
                  sessionID: "session-relay-existing",
                  directory: "/repo",
                  generation: 1,
                  revision: 1,
                },
              }
            },
          },
        },
      },
    },
  } as unknown as ServerSDK
  const services = { ...makeServices(), serverSDK: () => sdk }

  for (const entry of [
    {
      blockID: "operating-1",
      functionalityID: "builtin:operating-chat-session",
      registration: operatingChatRuntimeRegistration,
      sessionID: "session-operating-existing",
    },
    {
      blockID: "relay-1",
      functionalityID: "builtin:chat-relay",
      registration: ChatRelayRuntimeAdapter,
      sessionID: "session-relay-existing",
    },
  ]) {
    for (let mount = 0; mount < 2; mount += 1) {
      let handle: RuntimeBlockHandle | undefined
      const host = document.createElement("div")
      document.body.append(host)
      const dispose = render(
        () =>
          h(BlockRuntimeHost as never, {
            blockID: entry.blockID,
            functionalityID: entry.functionalityID,
            registration: entry.registration as never,
            services,
            workspaceID: "workspace-1",
            onHandle: (next: RuntimeBlockHandle) => {
              handle = next
            },
            children: h("div"),
          }) as never,
        host,
      )
      await wait()
      expect(handle?.view()).toMatchObject({ sessionID: entry.sessionID })
      dispose()
      host.remove()
    }
  }

  expect(ensureCalls).toEqual({ operatingChat: 2, chatRelay: 2 })
})

test("two independent OperatingChat provider contexts converge after one reset", async () => {
  const listeners = new Set<(event: FakeServerEntry) => void>()
  let resetCalls = 0
  let binding = {
    workspaceID: "workspace-1",
    blockID: "operating-1",
    functionalityInstanceID: "instance-operating",
    sessionID: "session-original",
    directory: "/repo",
    generation: 1,
    revision: 1,
  }
  const makeSDK = () =>
    ({
      event: {
        listen: (listener: (event: FakeServerEntry) => void) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      },
      client: {
        v2: {
          workspace: {
            operatingChat: {
              ensure: async () => ({ data: binding }),
              reset: async () => {
                resetCalls += 1
                binding = { ...binding, sessionID: "session-replacement", generation: 2, revision: 2 }
                const event = {
                  name: "global",
                  details: {
                    id: "evt_operating_reset",
                    type: "workspace.operatingChat.binding.updated",
                    properties: binding,
                  },
                }
                listeners.forEach((listener) => listener(event))
                return { data: { status: "reset", binding } }
              },
            },
          },
        },
      },
    }) as unknown as ServerSDK
  const sdks = [makeSDK(), makeSDK()]
  const handles: Array<RuntimeBlockHandle | undefined> = []
  const disposes = [0, 1].map((index) => {
    const host = document.createElement("div")
    document.body.append(host)
    return render(
      () =>
        createComponent(BlockRuntimeProvider as never, {
          workspaceID: () => "workspace-1",
          workspaceEpoch: () => 0,
          connected: () => true,
          awaitDescriptorPersisted: async () => {},
          recoverWorkspace: async () => false,
          serverSDK: () => sdks[index]!,
          localView: makeServices().localView,
          children: () =>
            createComponent(BlockRuntimeHost as never, {
              blockID: "operating-1",
              functionalityID: "builtin:operating-chat-session",
              registration: operatingChatRuntimeRegistration as never,
              workspaceID: "workspace-1",
              onHandle: (handle: RuntimeBlockHandle) => {
                handles[index] = handle
              },
              children: h("div"),
            }),
        }) as never,
      host,
    )
  })

  await wait()
  expect(listeners.size).toBe(2)
  expect(handles.map((handle) => handle?.view())).toEqual([
    expect.objectContaining({ sessionID: "session-original" }),
    expect.objectContaining({ sessionID: "session-original" }),
  ])

  await handles[0]!.dispatch({ type: "reset" })
  await wait()
  expect(resetCalls).toBe(1)
  expect(handles.map((handle) => handle?.view())).toEqual([
    expect.objectContaining({ sessionID: "session-replacement", revision: 2 }),
    expect.objectContaining({ sessionID: "session-replacement", revision: 2 }),
  ])

  disposes.forEach((dispose) => dispose())
  expect(listeners.size).toBe(0)
})

test("a semantic invalidation during a reconnect refresh schedules one trailing refresh", async () => {
  let emit: ((event: { details: { type: string; properties: unknown } }) => void) | undefined
  const router = createBlockRuntimeEventRouter({
    listen: (listener) => {
      emit = listener
      return () => {
        emit = undefined
      }
    },
  })
  const reconnectRefresh = makeDeferred<void>()
  let resolves = 0
  let handle: RuntimeBlockHandle | undefined
  const registration = {
    functionalityID: "builtin:test",
    mode: "native",
    resolve: async () => {
      resolves += 1
      if (resolves === 2) await reconnectRefresh.promise
      return resolves
    },
    eventKeys: () => [{ type: "workspace.test.updated", workspaceID: "workspace-1" }],
    onEvent: () => "invalidate",
    select: ({ resolved }) => resolved,
  } satisfies BlockRuntimeRegistration<number, number, never>
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () =>
      h(BlockRuntimeHost as never, {
        blockID: "block-1",
        functionalityID: "builtin:test",
        registration: registration as never,
        services: { ...makeServices(), eventRouter: router as never },
        workspaceID: "workspace-1",
        onHandle: (next: RuntimeBlockHandle) => {
          handle = next
        },
        children: h("div"),
      }) as never,
    host,
  )

  await wait()
  router.notifyReconnect()
  router.notifyReconnect()
  await wait()
  expect(resolves).toBe(2)
  router.notifyReconnect()
  router.notifyReconnect()
  await wait()
  expect(resolves).toBe(2)
  emit?.({ details: { type: "workspace.test.updated", properties: { workspaceID: "workspace-1" } } })
  reconnectRefresh.resolve()
  await wait()

  expect(resolves).toBe(3)
  expect(handle?.view()).toBe(3)
  dispose()
  router.dispose()
})

test("BlockRuntimeHost resolves, coalesces events, refreshes on reconnect, and preserves stale view", async () => {
  let eventListener: ((event: ServerEvent) => void) | undefined
  let reconnectListener: (() => void) | undefined
  let resolves = 0
  let fail = true
  let resolveGate: Promise<void> | undefined
  let releaseResolve: (() => void) | undefined
  let dispatchGate: Promise<void> | undefined
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
      await dispatchGate
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

  const mutation = makeDeferred<void>()
  dispatchGate = mutation.promise
  const pending = observedHandle.dispatch({ type: "run" })
  await observedHandle.refresh("manual")
  expect(observedHandle.view()).toBe(6)
  mutation.resolve()
  await pending
  expect(observedHandle.view()).toBe(7)

  dispose()
  expect(disposed).toEqual([1, 2, 3, 4, 5, 6, 7])
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
