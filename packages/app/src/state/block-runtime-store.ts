import { batch } from "solid-js"
import { createStore } from "solid-js/store"
import type {
  AuthRuntimeState,
  MessagePartRuntimeState,
  MessageRuntimeState,
  PermissionRuntimeState,
  RuntimeEventEnvelope,
  RuntimeResourceBinding,
  RuntimeResourceState,
  RuntimeSnapshot,
  SessionRuntimeState,
} from "@/pages/canvas/runtime/types"

export interface BlockRuntimeBatchStats {
  queued: number
  flushes: number
  appliedEvents: number
  droppedEvents: number
  duplicateEvents: number
}

export interface ApplyEventResult {
  applied: boolean
  duplicate: boolean
  stale: boolean
  gap: boolean
  needsResync: boolean
}

export interface BlockRuntimeStore {
  state: () => RuntimeResourceState
  connection: () => RuntimeResourceState["connection"]
  authByProvider: () => RuntimeResourceState["authByProvider"]
  sessionsByID: () => RuntimeResourceState["sessionsByID"]
  messagesByID: () => RuntimeResourceState["messagesByID"]
  partsByID: () => RuntimeResourceState["partsByID"]
  permissionsByID: () => RuntimeResourceState["permissionsByID"]
  needsResync: () => boolean
  resyncReason: () => string | undefined
  batchStats: () => BlockRuntimeBatchStats
  applySnapshot(snapshot: RuntimeSnapshot<RuntimeResourceState>): void
  applyEvent<T>(event: RuntimeEventEnvelope<T>): ApplyEventResult
}

interface MutableRuntimeState {
  connection: RuntimeResourceState["connection"]
  authByProvider: RuntimeResourceState["authByProvider"]
  sessionsByID: RuntimeResourceState["sessionsByID"]
  messagesByID: RuntimeResourceState["messagesByID"]
  partsByID: RuntimeResourceState["partsByID"]
  permissionsByID: RuntimeResourceState["permissionsByID"]
}

const createEmptyState = (): RuntimeResourceState => ({
  connection: { status: "connecting" },
  authByProvider: {},
  sessionsByID: {},
  messagesByID: {},
  partsByID: {},
  permissionsByID: {},
})

const toNumberCursor = (cursor: string) => {
  const value = Number.parseInt(cursor, 10)
  return Number.isNaN(value) ? undefined : value
}

const toObjectPatch = (value: unknown) => {
  if (value === null || value === undefined) return undefined
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  return undefined
}

const mergeObjects = (current: unknown, patch: Record<string, unknown>) => {
  if (current === undefined) return patch
  if (typeof current !== "object" || current === null || Array.isArray(current)) return patch
  return { ...(current as Record<string, unknown>), ...patch }
}

const makeResourceKey = (resource: RuntimeResourceBinding) =>
  `${resource.type}:${resource.id}${resource.parentID === undefined ? "" : `:${resource.parentID}`}`

const toConnectionStatus = (event: string) => {
  if (event === "connection.connected") return "connected" as const
  if (event === "connection.disconnected") return "disconnected" as const
  if (event === "connection.connecting") return "connecting" as const
  if (event === "connection.error") return "disconnected" as const
  return undefined
}

const createBatchScheduler = (flush: () => void) => {
  let scheduled = false
  return () => {
    if (scheduled) return
    scheduled = true
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        scheduled = false
        flush()
      })
      return
    }
    queueMicrotask(() => {
      scheduled = false
      flush()
    })
  }
}

const buildNextStateFromSnapshot = (snapshot: RuntimeSnapshot<RuntimeResourceState>) => ({
  connection: { ...snapshot.state.connection, cursor: snapshot.cursor },
  authByProvider: { ...snapshot.state.authByProvider },
  sessionsByID: { ...snapshot.state.sessionsByID },
  messagesByID: { ...snapshot.state.messagesByID },
  partsByID: { ...snapshot.state.partsByID },
  permissionsByID: { ...snapshot.state.permissionsByID },
})

const applyResourceEvent = (
  state: MutableRuntimeState,
  event: RuntimeEventEnvelope,
) => {
  const id = event.resource.id

  if (event.event === "removed") {
    if (event.resource.type === "auth") {
      const nextAuthByProvider = { ...state.authByProvider }
      delete nextAuthByProvider[id]
      return { authByProvider: nextAuthByProvider }
    }
    if (event.resource.type === "session") {
      const nextSessionsByID = { ...state.sessionsByID }
      delete nextSessionsByID[id]
      return { sessionsByID: nextSessionsByID }
    }
    if (event.resource.type === "message") {
      const nextMessages = { ...state.messagesByID }
      const nextParts = { ...state.partsByID }
      const sessionID = nextMessages[id]?.sessionID
      if (sessionID !== undefined) {
        for (const [partID, part] of Object.entries(nextParts)) {
          if (part.messageID === id) delete nextParts[partID]
        }
      }
      delete nextMessages[id]
      return { messagesByID: nextMessages, partsByID: nextParts }
    }
    if (event.resource.type === "message-part") {
      const nextPartsByID = { ...state.partsByID }
      delete nextPartsByID[id]
      return { partsByID: nextPartsByID }
    }
    const nextPermissions = { ...state.permissionsByID }
    delete nextPermissions[id]
    return { permissionsByID: nextPermissions }
  }

  const patch = toObjectPatch(event.data)
  if (!patch || Object.keys(patch).length === 0) return undefined

  if (event.resource.type === "auth") {
    const current = state.authByProvider[id]
    return {
      authByProvider: {
        ...state.authByProvider,
        [id]: mergeObjects(current, patch) as unknown as AuthRuntimeState,
      },
    }
  }
  if (event.resource.type === "session") {
    const current = state.sessionsByID[id]
    return {
      sessionsByID: {
        ...state.sessionsByID,
        [id]: mergeObjects(current, patch) as unknown as SessionRuntimeState,
      },
    }
  }
  if (event.resource.type === "message") {
    const current = state.messagesByID[id]
    return {
      messagesByID: {
        ...state.messagesByID,
        [id]: mergeObjects(current, patch) as unknown as MessageRuntimeState,
      },
    }
  }
  if (event.resource.type === "message-part") {
    const current = state.partsByID[id]
    return {
      partsByID: {
        ...state.partsByID,
        [id]: mergeObjects(current, patch) as unknown as MessagePartRuntimeState,
      },
    }
  }

  const current = state.permissionsByID[id]
  return {
    permissionsByID: {
      ...state.permissionsByID,
      [id]: mergeObjects(current, patch) as unknown as PermissionRuntimeState,
    },
  }
}

const applyConnectionEvent = (connection: RuntimeResourceState["connection"], event: RuntimeEventEnvelope) => {
  const status = toConnectionStatus(event.event)
  if (status === undefined) return undefined
  const data = toObjectPatch(event.data)
  const lastError = data?.lastError
  if (status === connection.status && lastError === connection.lastError) return undefined
  return {
    ...connection,
    status,
    cursor: event.cursor,
    ...(typeof lastError === "string" ? { lastError } : {}),
  }
}

export const createBlockRuntimeStore = () => {
  const [state, setState] = createStore(createEmptyState())
  const [needsResync, setNeedsResync] = createStore({ value: false, reason: undefined as string | undefined })
  const [batchStats, setBatchStats] = createStore<BlockRuntimeBatchStats>({
    queued: 0,
    flushes: 0,
    appliedEvents: 0,
    droppedEvents: 0,
    duplicateEvents: 0,
  })

  const revisionByResource = new Map<string, number>()
  const pending = new Set<string>()
  const pendingEvents: RuntimeEventEnvelope[] = []
  let lastCursor: string | undefined
  let lastCursorNumber: number | undefined

  const flush = () => {
    if (pendingEvents.length === 0) return
    const events = pendingEvents.splice(0, pendingEvents.length)

    const next: MutableRuntimeState = {
      connection: { ...state.connection },
      authByProvider: { ...state.authByProvider },
      sessionsByID: { ...state.sessionsByID },
      messagesByID: { ...state.messagesByID },
      partsByID: { ...state.partsByID },
      permissionsByID: { ...state.permissionsByID },
    }

    for (const event of events) {
      const patch = applyResourceEvent(next, event)
      if (patch?.authByProvider) next.authByProvider = patch.authByProvider
      if (patch?.sessionsByID) next.sessionsByID = patch.sessionsByID
      if (patch?.messagesByID) next.messagesByID = patch.messagesByID
      if (patch?.partsByID) next.partsByID = patch.partsByID
      if (patch?.permissionsByID) next.permissionsByID = patch.permissionsByID
      next.connection.cursor = event.cursor
    }

    batch(() => {
      setState({ ...next })
    })

    setBatchStats((stats) => ({
      ...stats,
      flushes: stats.flushes + 1,
      queued: Math.max(stats.queued - events.length, 0),
      appliedEvents: stats.appliedEvents + events.length,
    }))
    events.forEach((event) => {
      pending.delete(event.cursor + ":" + makeResourceKey(event.resource))
    })
  }

  const scheduleFlush = createBatchScheduler(flush)

  return {
    state: () => state,
    connection: () => state.connection,
    authByProvider: () => state.authByProvider,
    sessionsByID: () => state.sessionsByID,
    messagesByID: () => state.messagesByID,
    partsByID: () => state.partsByID,
    permissionsByID: () => state.permissionsByID,
    needsResync: () => needsResync.value,
    resyncReason: () => needsResync.reason,
    batchStats: () => batchStats,
    applySnapshot(snapshot) {
      batch(() => {
        setState(buildNextStateFromSnapshot(snapshot))
      })
      setNeedsResync({ value: false, reason: undefined })
      revisionByResource.clear()
      if (pendingEvents.length > 0) {
        setBatchStats((stats) => ({
          ...stats,
          droppedEvents: stats.droppedEvents + pendingEvents.length,
          queued: 0,
        }))
      }
      pendingEvents.length = 0
      pending.clear()
      lastCursor = snapshot.cursor
      lastCursorNumber = toNumberCursor(snapshot.cursor)
    },
    applyEvent(event) {
      const connectionStatus = toConnectionStatus(event.event)
      if (connectionStatus !== undefined) {
        const connectionPatch = applyConnectionEvent(state.connection, event)
        if (connectionPatch) {
          setState("connection", connectionPatch)
        }
        if (lastCursor !== event.cursor) {
          lastCursor = event.cursor
          lastCursorNumber = toNumberCursor(event.cursor)
        }
        return { applied: true, duplicate: false, stale: false, gap: false, needsResync: false }
      }

      if (lastCursor === event.cursor) {
        pending.delete(lastCursor + ":" + makeResourceKey(event.resource))
        setBatchStats((stats) => ({ ...stats, duplicateEvents: stats.duplicateEvents + 1 }))
        return { applied: false, duplicate: true, stale: false, gap: false, needsResync: false }
      }

      const current = toNumberCursor(lastCursor ?? "")
      const next = toNumberCursor(event.cursor)
      if (current !== undefined && next !== undefined) {
        if (next <= current) {
          return {
            applied: false,
            duplicate: false,
            stale: true,
            gap: false,
            needsResync: false,
          }
        }
        if (next > current + 1) {
          lastCursor = event.cursor
          lastCursorNumber = next
          setNeedsResync({ value: true, reason: `cursor gap after ${current}: ${next}` })
          return {
            applied: false,
            duplicate: false,
            stale: false,
            gap: true,
            needsResync: true,
          }
        }
      }

      if (event.revision !== undefined) {
        const resourceKey = makeResourceKey(event.resource)
        const known = revisionByResource.get(resourceKey)
        if (known !== undefined && event.revision <= known) {
          return {
            applied: false,
            duplicate: false,
            stale: true,
            gap: false,
            needsResync: false,
          }
        }
        revisionByResource.set(resourceKey, event.revision)
      }

      const key = event.cursor + ":" + makeResourceKey(event.resource)
      if (pending.has(key)) {
        return {
          applied: false,
          duplicate: true,
          stale: false,
          gap: false,
          needsResync: false,
        }
      }

      lastCursor = event.cursor
      lastCursorNumber = next
      pending.add(key)
      pendingEvents.push(event)

      setBatchStats((stats) => ({ ...stats, queued: stats.queued + 1 }))
      scheduleFlush()

      return {
        applied: true,
        duplicate: false,
        stale: false,
        gap: false,
        needsResync: false,
      }
    },
  } satisfies BlockRuntimeStore
}
