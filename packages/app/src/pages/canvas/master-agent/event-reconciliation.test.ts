import { describe, expect, test } from "bun:test"
import {
  createMasterAgentEventReconciliation,
  type BindingEventEntry,
  type MasterAgentEventReconciliationInput,
} from "./event-reconciliation"
import type { MasterAgent } from "./types"

function updatedEntry(overrides: Partial<MasterAgent.BindingUpdatedEvent> = {}): BindingEventEntry {
  return {
    name: "global",
    details: {
      type: "workspace.master-agent.binding.updated",
      properties: {
        workspaceID: "ws-1",
        blockID: "block-1",
        sessionID: "session-1",
        generation: 1,
        revision: 1,
        ...overrides,
      },
    },
  }
}

function unrelatedEntry(): BindingEventEntry {
  return { name: "global", details: { type: "session.updated", properties: { id: "session-1" } } }
}

function malformedEntry(): BindingEventEntry {
  return {
    name: "global",
    details: { type: "workspace.master-agent.binding.updated", properties: { workspaceID: "ws-1", blockID: 3 } },
  }
}

function createEnv(overrides: Partial<MasterAgentEventReconciliationInput> = {}) {
  const state = { workspaceID: "ws-1" }
  const known = new Set<string>()
  const revisions = new Map<string, number>()
  const dispatched: MasterAgent.BindingUpdatedEvent[] = []
  const refetched: string[] = []
  const eventListeners: Array<(entry: BindingEventEntry) => void> = []
  const reconnectListeners: Array<() => void> = []
  const unsubscribed = { events: 0, reconnect: 0 }
  const input: MasterAgentEventReconciliationInput = {
    workspaceID: () => state.workspaceID,
    isKnownBlock: (blockID) => known.has(blockID),
    knownBlocks: () => [...known],
    currentRevision: (blockID) => revisions.get(blockID),
    onBindingUpdated: (event) => {
      dispatched.push(event)
      revisions.set(event.blockID, event.revision)
    },
    refetch: (blockID) => refetched.push(blockID),
    listen: (listener) => {
      eventListeners.push(listener)
      return () => {
        const index = eventListeners.indexOf(listener)
        if (index !== -1) eventListeners.splice(index, 1)
        unsubscribed.events += 1
      }
    },
    onReconnect: (listener) => {
      reconnectListeners.push(listener)
      return () => {
        const index = reconnectListeners.indexOf(listener)
        if (index !== -1) reconnectListeners.splice(index, 1)
        unsubscribed.reconnect += 1
      }
    },
    ...overrides,
  }
  const reconciliation = createMasterAgentEventReconciliation(input)
  return {
    input,
    reconciliation,
    dispatched,
    refetched,
    unsubscribed,
    setWorkspaceID: (workspaceID: string) => {
      state.workspaceID = workspaceID
    },
    mount: (blockID: string, revision: number) => {
      known.add(blockID)
      revisions.set(blockID, revision)
    },
    mountLoading: (blockID: string) => {
      known.add(blockID)
    },
    remove: (blockID: string) => {
      known.delete(blockID)
      revisions.delete(blockID)
    },
    emit: (entry: BindingEventEntry) => {
      for (const listener of eventListeners) listener(entry)
    },
    reconnect: () => {
      for (const listener of reconnectListeners) listener()
    },
  }
}

describe("binding-updated filtering", () => {
  test("dispatches only newer revisions and ignores stale and duplicate events", () => {
    const env = createEnv()
    env.mount("block-1", 5)
    env.emit(updatedEntry({ revision: 6, sessionID: "session-6" }))
    env.emit(updatedEntry({ revision: 6 }))
    env.emit(updatedEntry({ revision: 5 }))
    expect(env.dispatched).toEqual([
      {
        type: "workspace.master-agent.binding.updated",
        workspaceID: "ws-1",
        blockID: "block-1",
        sessionID: "session-6",
        generation: 1,
        revision: 6,
      },
    ])
  })

  test("ignores events for a foreign workspace", () => {
    const env = createEnv()
    env.mount("block-1", 1)
    env.emit(updatedEntry({ workspaceID: "ws-2", revision: 7 }))
    expect(env.dispatched).toEqual([])
    expect(env.reconciliation.takeBuffered("block-1")).toBeUndefined()
  })

  test("ignores unrelated event types and malformed payloads", () => {
    const env = createEnv()
    env.mount("block-1", 1)
    env.emit(unrelatedEntry())
    env.emit(malformedEntry())
    expect(env.dispatched).toEqual([])
    expect(env.reconciliation.takeBuffered("block-1")).toBeUndefined()
  })

  test("applies out-of-order events by revision", () => {
    const env = createEnv()
    env.mount("block-1", 10)
    env.emit(updatedEntry({ revision: 8 }))
    env.emit(updatedEntry({ revision: 12 }))
    env.emit(updatedEntry({ revision: 9 }))
    expect(env.dispatched.map((event) => event.revision)).toEqual([12])
  })

  test("drops events for a removed block without dispatching", () => {
    const env = createEnv()
    env.mount("block-1", 2)
    env.remove("block-1")
    env.emit(updatedEntry({ revision: 3 }))
    expect(env.dispatched).toEqual([])
    env.mount("block-1", 2)
    expect(env.reconciliation.takeBuffered("block-1")?.revision).toBe(3)
  })
})

describe("event-before-block-mount", () => {
  test("keeps only the newest pre-mount event and hands it back once the block mounts", () => {
    const env = createEnv()
    env.emit(updatedEntry({ revision: 4, sessionID: "session-4" }))
    env.emit(updatedEntry({ revision: 3 }))
    expect(env.dispatched).toEqual([])
    env.mount("block-1", 3)
    const buffered = env.reconciliation.takeBuffered("block-1")
    expect(buffered?.revision).toBe(4)
    expect(buffered?.sessionID).toBe("session-4")
    expect(env.reconciliation.takeBuffered("block-1")).toBeUndefined()
  })

  test("drops a buffered event that is not newer than the mounted binding", () => {
    const env = createEnv()
    env.emit(updatedEntry({ revision: 4 }))
    env.mount("block-1", 6)
    expect(env.reconciliation.takeBuffered("block-1")).toBeUndefined()
  })

  test("keeps the buffered event while the block is still loading", () => {
    const env = createEnv()
    env.mountLoading("block-1")
    env.emit(updatedEntry({ revision: 4 }))
    expect(env.dispatched).toEqual([])
    expect(env.reconciliation.takeBuffered("block-1")).toBeUndefined()
    env.mount("block-1", 3)
    expect(env.reconciliation.takeBuffered("block-1")?.revision).toBe(4)
  })

  test("flushes buffered events automatically once the block becomes ready", () => {
    const env = createEnv()
    env.emit(updatedEntry({ blockID: "block-2", revision: 7 }))
    env.mount("block-1", 1)
    env.mount("block-2", 6)
    env.emit(updatedEntry({ revision: 2 }))
    expect(env.dispatched.map((event) => `${event.blockID}:${event.revision}`)).toEqual([
      "block-1:2",
      "block-2:7",
    ])
  })
})

describe("reconnect", () => {
  test("refetches every known block after reconnect", () => {
    const env = createEnv()
    env.mount("block-1", 1)
    env.mount("block-2", 3)
    env.reconnect()
    expect(env.refetched).toEqual(["block-1", "block-2"])
  })

  test("does not refetch unknown blocks", () => {
    const env = createEnv()
    env.emit(updatedEntry({ blockID: "block-9", revision: 1 }))
    env.reconnect()
    expect(env.refetched).toEqual([])
  })
})

describe("disposal", () => {
  test("unsubscribes both sources and stops dispatching", () => {
    const env = createEnv()
    env.mount("block-1", 1)
    env.reconciliation.dispose()
    expect(env.unsubscribed).toEqual({ events: 1, reconnect: 1 })
    env.emit(updatedEntry({ revision: 2 }))
    env.reconnect()
    expect(env.dispatched).toEqual([])
    expect(env.refetched).toEqual([])
    env.reconciliation.dispose()
    expect(env.unsubscribed).toEqual({ events: 1, reconnect: 1 })
  })

  test("drops buffered events on dispose", () => {
    const env = createEnv()
    env.emit(updatedEntry({ revision: 1 }))
    env.reconciliation.dispose()
    env.mount("block-1", 1)
    expect(env.reconciliation.takeBuffered("block-1")).toBeUndefined()
  })
})
