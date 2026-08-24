import { describe, expect, test } from "bun:test"

import { createBlockRuntimeEventRouter } from "./event-router"

type BusEvent = {
  details: {
    id?: string
    type: string
    properties: unknown
  }
}

const createFakeBus = () => {
  const handlers = new Set<(event: BusEvent) => void>()
  let subscribeCount = 0
  let unsubscribeCount = 0

  return {
    get subscribeCount() {
      return subscribeCount
    },
    get unsubscribeCount() {
      return unsubscribeCount
    },
    listen: (handler: (event: BusEvent) => void) => {
      handlers.add(handler)
      subscribeCount += 1
      return () => {
        if (handlers.delete(handler)) {
          unsubscribeCount += 1
        }
      }
    },
    emit: (event: BusEvent) => {
      for (const handler of handlers) {
        handler(event)
      }
    },
  }
}

describe("createBlockRuntimeEventRouter", () => {
  test("two listeners receive same key and unsubscribes are counted correctly", () => {
    const bus = createFakeBus()
    const router = createBlockRuntimeEventRouter(bus) as any
    const event = {
      details: {
        type: "canvas.block.updated",
        properties: {
          workspaceID: "workspace-a",
          blockID: "block-a",
        },
      },
    }
    let first = 0
    let second = 0

    const un1 = router.on(
      {
        type: "canvas.block.updated",
        workspaceID: "workspace-a",
        blockID: "block-a",
      },
      () => {
        first += 1
      },
    )
    const un2 = router.on(
      {
        type: "canvas.block.updated",
        workspaceID: "workspace-a",
        blockID: "block-a",
      },
      () => {
        second += 1
      },
    )

    expect(bus.subscribeCount).toBe(1)

    bus.emit(event)
    expect(first).toBe(1)
    expect(second).toBe(1)

    un1()
    bus.emit(event)
    expect(first).toBe(1)
    expect(second).toBe(2)

    un2()
    bus.emit(event)
    expect(first).toBe(1)
    expect(second).toBe(2)
    expect(bus.unsubscribeCount).toBe(1)

    router.dispose()
  })

  test("predicate listener matches only the intended events", () => {
    const bus = createFakeBus()
    const router = createBlockRuntimeEventRouter(bus) as any
    let count = 0
    const unsubscribe = router.on(
      (event: { type: string; properties: unknown }) => event.type === "match-me",
      () => {
        count += 1
      },
    )

    bus.emit({
      details: {
        type: "match-me",
        properties: {},
      },
    })
    bus.emit({
      details: {
        type: "ignore-me",
        properties: {},
      },
    })

    expect(count).toBe(1)

    unsubscribe()
    bus.emit({
      details: {
        type: "match-me",
        properties: {},
      },
    })
    expect(count).toBe(1)
  })

  test("reconnect listeners are notified", () => {
    const bus = createFakeBus()
    const router = createBlockRuntimeEventRouter(bus) as any
    let count = 0
    const unsubA = router.onReconnect(() => {
      count += 1
    })
    const unsubB = router.onReconnect(() => {
      count += 10
    })

    router.notifyReconnect()
    expect(count).toBe(11)

    unsubA()
    router.notifyReconnect()
    expect(count).toBe(21)

    unsubB()
    router.notifyReconnect()
    expect(count).toBe(21)
  })

  test("preserves IDs and filters a duplicate after the first delivery completes", () => {
    const bus = createFakeBus()
    const router = createBlockRuntimeEventRouter(bus) as any
    const received: Array<string | undefined> = []
    router.on({ type: "match-me" }, (event: { id?: string }) => received.push(event.id))
    const event = { details: { id: "event-1", type: "match-me", properties: {} } }

    bus.emit(event)
    bus.emit(event)

    expect(received).toEqual(["event-1"])
  })

  test("accepts the oldest ID again after the 256-entry window evicts it", () => {
    const bus = createFakeBus()
    const router = createBlockRuntimeEventRouter(bus) as any
    const received: string[] = []
    router.on({ type: "match-me" }, (event: { id?: string }) => received.push(event.id!))

    for (let index = 0; index <= 256; index += 1) {
      bus.emit({ details: { id: `event-${index}`, type: "match-me", properties: {} } })
    }
    bus.emit({ details: { id: "event-0", type: "match-me", properties: {} } })

    expect(received).toHaveLength(258)
    expect(received.at(-1)).toBe("event-0")
  })

  test("delivers no-ID events at least once each", () => {
    const bus = createFakeBus()
    const router = createBlockRuntimeEventRouter(bus) as any
    let received = 0
    router.on({ type: "match-me" }, () => received++)
    const event = { details: { type: "match-me", properties: {} } }

    bus.emit(event)
    bus.emit(event)

    expect(received).toBe(2)
  })

  test("dispose clears duplicate history for a later subscription", () => {
    const bus = createFakeBus()
    const event = { details: { id: "event-1", type: "match-me", properties: {} } }
    const router = createBlockRuntimeEventRouter(bus) as any
    let received = 0
    router.on({ type: "match-me" }, () => received++)
    bus.emit(event)
    router.dispose()

    router.on({ type: "match-me" }, () => received++)
    bus.emit(event)

    expect(received).toBe(2)
  })
})
