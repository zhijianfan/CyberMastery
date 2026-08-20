export interface FakeServerEventEnvelope {
  type: string
  details?: { type: string; properties?: unknown }
  revision?: number
  id?: string
}

type FakeServerEventListener = (entry: FakeServerEventEnvelope & { id: string; revision: number }) => void

function asError(message: string) {
  const error = new Error(message)
  error.name = "FakeServerEventBus"
  return error
}

export interface FakeServerEventBus {
  start: () => void
  listen: (listener: FakeServerEventListener) => () => void
  on: (_scope: string, listener: FakeServerEventListener) => () => void
  emit: (entry: FakeServerEventEnvelope) => FakeServerEventEnvelope & { id: string; revision: number }
  fire: (entry: FakeServerEventEnvelope) => void
  pause: () => void
  resume: () => void
  disconnect: () => void
  reconnect: () => void
  listenerCount: () => number
  queuedCount: () => number
  assertListenerCount: (count: number) => void
  assertQueuedCount: (count: number) => void
  getEventId: () => string
  getRevision: () => number
  reset: () => void
  readonly state: {
    started: boolean
    paused: boolean
    connected: boolean
    revision: number
    lastEventID: string
  }
}

export function createFakeServerEventBus() {
  const listeners = new Set<FakeServerEventListener>()
  const queued: (FakeServerEventEnvelope & { id: string; revision: number })[] = []
  let started = false
  let paused = false
  let connected = true
  let revision = 0

  function formatEventID(nextRevision: number) {
    return `evt-${String(nextRevision).padStart(6, "0")}`
  }

  function assertActive() {
    if (connected) return
    throw asError("server event bus is disconnected")
  }

  function emitEntry(entry: FakeServerEventEnvelope) {
    assertActive()
    revision += 1
    const envelope = {
      ...entry,
      revision,
      id: entry.id ?? formatEventID(revision),
    } satisfies FakeServerEventEnvelope & { id: string; revision: number }

    if (paused) {
      queued.push(envelope)
      return envelope
    }

    for (const listener of listeners) listener(envelope)
    return envelope
  }

  function flushQueued() {
    const next = [...queued]
    queued.length = 0
    for (const event of next) {
      for (const listener of listeners) listener(event)
    }
  }

  const bus: FakeServerEventBus = {
    start() {
      started = true
    },
    listen(listener) {
      if (!started) bus.start()
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    on(_scope, listener) {
      return bus.listen(listener)
    },
    emit(entry) {
      return emitEntry(entry)
    },
    fire(entry) {
      emitEntry(entry)
    },
    pause() {
      paused = true
    },
    resume() {
      paused = false
      flushQueued()
    },
    disconnect() {
      connected = false
    },
    reconnect() {
      connected = true
      flushQueued()
    },
    listenerCount() {
      return listeners.size
    },
    queuedCount() {
      return queued.length
    },
    assertListenerCount(count) {
      if (listeners.size !== count) throw asError(`expected ${count} event listeners, got ${listeners.size}`)
    },
    assertQueuedCount(count) {
      if (queued.length !== count) throw asError(`expected ${count} queued events, got ${queued.length}`)
    },
    getEventId() {
      return formatEventID(revision)
    },
    getRevision() {
      return revision
    },
    reset() {
      listeners.clear()
      queued.length = 0
      started = false
      paused = false
      connected = true
      revision = 0
    },
    get state() {
      return {
        started,
        paused,
        connected,
        revision,
        lastEventID: formatEventID(revision),
      }
    },
  }

  return bus
}
