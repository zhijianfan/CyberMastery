import { describe, expect, test } from "bun:test"
import { createBlockRuntimeStore } from "./block-runtime-store"
import type {
  RuntimeEventEnvelope,
  RuntimeResourceBinding,
  RuntimeResourceState,
  RuntimeSnapshot,
} from "../pages/canvas/runtime/types"

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const sessionBinding: RuntimeResourceBinding = {
  type: "session",
  id: "session-1",
}

const createSnapshot = (cursor: string, status: RuntimeResourceState["connection"]["status"] = "connecting"): RuntimeSnapshot<RuntimeResourceState> => ({
  cursor,
  state: {
    connection: { status },
    authByProvider: {},
    sessionsByID: {
      "session-1": {
        id: "session-1",
        status: "idle",
        directory: "/workspace",
      },
    },
    messagesByID: {},
    partsByID: {},
    permissionsByID: {},
  },
})

const createEvent = (cursor: string, data: Record<string, unknown>, revision?: number): RuntimeEventEnvelope => ({
  cursor,
  revision,
  timestamp: Number.parseInt(cursor, 10),
  resource: sessionBinding,
  event: "updated",
  data,
})

describe("block runtime store", () => {
  test("applies snapshot then events in order", async () => {
    const store = createBlockRuntimeStore()

    store.applySnapshot(createSnapshot("1"))
    const event = createEvent("2", { status: "busy" })
    const result = store.applyEvent(event)

    expect(result.applied).toBe(true)
    expect(result.needsResync).toBe(false)

    await flush()
    expect(store.state().sessionsByID["session-1"].status).toBe("busy")
    expect(store.connection().cursor).toBe("2")
    expect(store.batchStats().queued).toBe(0)
    expect(store.batchStats().appliedEvents).toBe(1)
    expect(store.batchStats().flushes).toBe(1)
  })

  test("ignores duplicate cursor", async () => {
    const store = createBlockRuntimeStore()

    store.applySnapshot(createSnapshot("1"))
    const event = createEvent("1", { status: "busy" })
    const result = store.applyEvent(event)

    expect(result.applied).toBe(false)
    expect(result.duplicate).toBe(true)
    await flush()
    expect(store.state().sessionsByID["session-1"].status).toBe("idle")
    expect(store.batchStats().duplicateEvents).toBe(1)
  })

  test("ignores stale revisions", async () => {
    const store = createBlockRuntimeStore()

    store.applySnapshot(createSnapshot("1"))
    store.applyEvent(createEvent("2", { status: "busy" }, 7))
    await flush()

    const result = store.applyEvent(createEvent("3", { status: "idle" }, 7))
    await flush()

    expect(result.applied).toBe(false)
    expect(result.stale).toBe(true)
    expect(store.state().sessionsByID["session-1"].status).toBe("busy")
    expect(store.batchStats().appliedEvents).toBe(1)
  })

  test("marks needsResync on cursor gap", () => {
    const store = createBlockRuntimeStore()

    store.applySnapshot(createSnapshot("1"))
    const result = store.applyEvent(createEvent("3", { status: "busy" }))

    expect(result.applied).toBe(false)
    expect(result.gap).toBe(true)
    expect(result.needsResync).toBe(true)
    expect(store.needsResync()).toBe(true)
    expect(store.resyncReason()).toBe("cursor gap after 1: 3")
  })
})
