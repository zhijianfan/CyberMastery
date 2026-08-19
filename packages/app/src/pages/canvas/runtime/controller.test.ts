import { describe, expect, test } from "bun:test"
import type {
  BlockDescriptor,
  BlockRuntimeAdapter,
  BlockRuntimeContext,
  RuntimeEventEnvelope,
  RuntimeResourceBinding,
  RuntimeResourceState,
  RuntimeSnapshot,
} from "./types"
import { createBlockRuntimeController } from "./controller"
import { createBlockRuntimeRegistry, type BlockRuntimeRegistry } from "./registry"

const createSessionState = (status: "idle" | "busy" = "idle"): RuntimeResourceState => ({
  connection: { status: "connecting" },
  authByProvider: {},
  sessionsByID: {
    "session-1": {
      id: "session-1",
      status,
    },
  },
  messagesByID: {},
  partsByID: {},
  permissionsByID: {},
})

const createEvent = (
  cursor: string,
  resource: RuntimeResourceBinding,
  event: string,
  data: Record<string, unknown>,
  revision?: number,
): RuntimeEventEnvelope => ({
  cursor,
  revision,
  timestamp: Number.parseInt(cursor, 10),
  resource,
  event,
  data,
})

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const makeDescriptor = (id: string, functionalityID = "chat", bindingID = "session-1"): BlockDescriptor => ({
  id,
  functionalityID,
  layout: { x: 0, y: 0, width: 1, height: 1 },
  bindings: { sessionID: bindingID },
})

const createRuntimeController = (onSubscribe?: (isReady: boolean) => void) => {
  let snapshotCalls = 0
  let subscribeCalls = 0
  let unsubscribeCalls = 0
  let snapshotDone = false

  const subscribers = new Map<number, { callback: (event: RuntimeEventEnvelope) => void; active: boolean }>()
  let nextSubscriberID = 0
  let lastDescriptor: BlockDescriptor | undefined
  let nextSnapshotState: RuntimeSnapshot<RuntimeResourceState> = {
    cursor: "0",
    state: createSessionState("idle"),
  }

  const context: BlockRuntimeContext = {
    snapshot: async () => {
      snapshotCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 0))
      snapshotDone = true
      return {
        ...nextSnapshotState,
        state: {
          ...nextSnapshotState.state,
          sessionsByID: {
            ...nextSnapshotState.state.sessionsByID,
          },
        },
      }
    },
    subscribe: (_bindings, _cursor, onEvent) => {
      subscribeCalls += 1
      onSubscribe?.(snapshotDone)
      const id = nextSubscriberID
      nextSubscriberID += 1
      subscribers.set(id, { callback: onEvent, active: true })
      return () => {
        const current = subscribers.get(id)
        if (current !== undefined && current.active) {
          current.active = false
          unsubscribeCalls += 1
        }
      }
    },
  }

  const adapter: BlockRuntimeAdapter<BlockDescriptor, RuntimeResourceState, { payload: string }> = {
    getBindings: (descriptor) => [
      {
        type: "session",
        id: descriptor.bindings.sessionID ?? "session-1",
      },
    ],
    hydrate: async (descriptor, ctx) => {
      const snapshot = await ctx.snapshot(adapter.getBindings(descriptor))
      return snapshot
    },
    select: (_descriptor, resources) => resources,
    dispatch: async (descriptor) => {
      lastDescriptor = descriptor
    },
  }

  const registry: BlockRuntimeRegistry = createBlockRuntimeRegistry()
  registry.register("chat", adapter)

  const controller = createBlockRuntimeController({ registry, context })

  return {
    controller,
    get snapshotCalls() {
      return snapshotCalls
    },
    get subscribeCalls() {
      return subscribeCalls
    },
    get unsubscribeCalls() {
      return unsubscribeCalls
    },
    get activeSubscriptions() {
      return [...subscribers.values()].filter((value) => value.active).length
    },
    emit: (event: RuntimeEventEnvelope) => {
      for (const subscriber of subscribers.values()) {
        if (subscriber.active) {
          subscriber.callback(event)
        }
      }
    },
    get lastDescriptor() {
      return lastDescriptor
    },
    diagnostics: () => controller.diagnostics(),
    set nextSnapshot(state: RuntimeResourceState) {
      nextSnapshotState = { ...nextSnapshotState, state }
    },
    get snapshotDone() {
      return snapshotDone
    },
  }
}

describe("runtime controller", () => {
  test("hydrates before subscribing", async () => {
    let subscribeAfterSnapshot = false
    const runtime = createRuntimeController((isReady) => {
      if (isReady) {
        subscribeAfterSnapshot = true
      }
    })

    const block = await runtime.controller.mount(makeDescriptor("block-1"))

    expect(subscribeAfterSnapshot).toBe(true)
    expect(block.id()).toBe("block-1")
  })

  test("shares one backend subscription across matching blocks", async () => {
    const runtime = createRuntimeController()
    const first = await runtime.controller.mount(makeDescriptor("block-1"))
    const second = await runtime.controller.mount(makeDescriptor("block-2"))

    expect(runtime.subscribeCalls).toBe(1)
    expect(runtime.activeSubscriptions).toBe(1)

    runtime.emit(createEvent("1", { type: "session", id: "session-1" }, "updated", { status: "busy" }))
    await flush()

    expect(first.state().sessionsByID["session-1"].status).toBe("busy")
    expect(second.state().sessionsByID["session-1"].status).toBe("busy")

    first.dispose()
    expect(runtime.activeSubscriptions).toBe(1)

    second.dispose()
    expect(runtime.activeSubscriptions).toBe(0)
    expect(runtime.unsubscribeCalls).toBe(1)
  })

  test("preserves UI state on disconnect", async () => {
    const runtime = createRuntimeController()
    const block = await runtime.controller.mount(makeDescriptor("block-1"))

    runtime.emit(createEvent("1", { type: "session", id: "session-1" }, "connection.disconnected", { status: "disconnected" }))
    await flush()

    expect(block.state().sessionsByID["session-1"].status).toBe("idle")
    expect(block.state().connection.status).not.toBe("connected")
  })

  test("updates descriptor without resetting runtime resources", async () => {
    const runtime = createRuntimeController()
    const first = await runtime.controller.mount({ ...makeDescriptor("block-1"), layout: { x: 0, y: 0, width: 2, height: 2 } })
    const second = await runtime.controller.mount({ ...makeDescriptor("block-1"), layout: { x: 1, y: 1, width: 3, height: 2 } })

    expect(first).toBe(second)
    expect(runtime.snapshotCalls).toBe(1)
    expect(runtime.subscribeCalls).toBe(1)

    await second.dispatch({ payload: "x" })
    expect(runtime.lastDescriptor?.layout.width).toBe(3)
  })

  test("cleans up only when last block unmounts", async () => {
    const runtime = createRuntimeController()
    const first = await runtime.controller.mount(makeDescriptor("block-1"))
    const second = await runtime.controller.mount(makeDescriptor("block-2"))

    first.dispose()
    expect(runtime.activeSubscriptions).toBe(1)

    second.dispose()
    expect(runtime.activeSubscriptions).toBe(0)
    expect(runtime.unsubscribeCalls).toBe(1)
  })

  test("resyncs on cursor gap and updates diagnostics", async () => {
    const runtime = createRuntimeController()
    await runtime.controller.mount(makeDescriptor("block-1"))

    runtime.emit(createEvent("2", { type: "session", id: "session-1" }, "updated", { status: "busy" }))
    await flush()

    await flush()
    const diagnostics = runtime.diagnostics()

    expect(diagnostics.resyncCount).toBe(1)
    expect(diagnostics.lastCursor).toBe("0")
  })
})
