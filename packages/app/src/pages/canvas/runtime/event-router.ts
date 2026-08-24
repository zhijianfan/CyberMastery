import type { ServerEvent } from "@/context/server-sdk"
import type { RuntimeEventKey } from "./contracts"

// Listen-input shape: the app event client delivers `{ name, details }` where
// `details` is the ServerEvent (type + properties). The router's public
// delivery shape to listener handlers is the ServerEvent itself (C contract).
type BlockRuntimeEvent = {
  details: {
    id?: string
    type: string
    properties: unknown
  }
}

type EventHandler = (event: ServerEvent) => void
type RuntimeEventPredicate = (event: ServerEvent) => boolean
type ReconnectHandler = () => void

type Listener = {
  id: number
  key: RuntimeEventKey
  handler: EventHandler
}

type PredicateListener = {
  id: number
  predicate: RuntimeEventPredicate
  handler: EventHandler
}

type EventMatchProperties = {
  workspaceID: unknown
  blockID: unknown
  functionalityID: unknown
  resourceID: unknown
}

type EventRouterInput = {
  listen: (handler: (event: BlockRuntimeEvent) => void) => () => void
}

const wildcard = "*"
const recentEventLimit = 256

const toRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    return {}
  }
  return value as Record<string, unknown>
}

const makeIndexKey = (
  type: string,
  workspaceID: unknown,
  blockID: unknown,
  functionalityID: unknown,
  resourceID: unknown,
) =>
  `${type}|${workspaceID ?? wildcard}|${blockID ?? wildcard}|${functionalityID ?? wildcard}|${resourceID ?? wildcard}`

const extractProperties = (event: BlockRuntimeEvent): EventMatchProperties => {
  const properties = toRecord(event.details.properties)

  return {
    workspaceID: properties.workspaceID,
    blockID: properties.blockID,
    functionalityID: properties.functionalityID,
    resourceID: properties.resourceID,
  }
}

const buildCombinations = (properties: EventMatchProperties, type: string) => {
  const { workspaceID, blockID, functionalityID, resourceID } = properties

  return [
    makeIndexKey(type, wildcard, wildcard, wildcard, wildcard),
    makeIndexKey(type, workspaceID, wildcard, wildcard, wildcard),
    makeIndexKey(type, wildcard, blockID, wildcard, wildcard),
    makeIndexKey(type, wildcard, wildcard, functionalityID, wildcard),
    makeIndexKey(type, wildcard, wildcard, wildcard, resourceID),
    makeIndexKey(type, workspaceID, blockID, wildcard, wildcard),
    makeIndexKey(type, workspaceID, wildcard, functionalityID, wildcard),
    makeIndexKey(type, workspaceID, wildcard, wildcard, resourceID),
    makeIndexKey(type, wildcard, blockID, functionalityID, wildcard),
    makeIndexKey(type, wildcard, blockID, wildcard, resourceID),
    makeIndexKey(type, wildcard, wildcard, functionalityID, resourceID),
    makeIndexKey(type, workspaceID, blockID, functionalityID, wildcard),
    makeIndexKey(type, workspaceID, blockID, wildcard, resourceID),
    makeIndexKey(type, workspaceID, wildcard, functionalityID, resourceID),
    makeIndexKey(type, wildcard, blockID, functionalityID, resourceID),
    makeIndexKey(type, workspaceID, blockID, functionalityID, resourceID),
  ]
}

const matchKeyProperties = (key: RuntimeEventKey, properties: EventMatchProperties) => {
  if (key.workspaceID !== undefined && key.workspaceID !== properties.workspaceID) {
    return false
  }
  if (key.blockID !== undefined && key.blockID !== properties.blockID) {
    return false
  }
  if (key.functionalityID !== undefined && key.functionalityID !== properties.functionalityID) {
    return false
  }
  if (key.resourceID !== undefined && key.resourceID !== properties.resourceID) {
    return false
  }

  return true
}

export const createBlockRuntimeEventRouter = (input: EventRouterInput) => {
  let nextListenerId = 0
  let listenerCount = 0

  const typedListeners = new Map<string, Set<Listener>>()
  const predicateListeners = new Set<PredicateListener>()
  const reconnectHandlers = new Set<ReconnectHandler>()
  const recentEventIDs = new Set<string>()
  let unsubscribe: undefined | (() => void)

  const makeSignature = (key: RuntimeEventKey) =>
    makeIndexKey(
      key.type,
      key.workspaceID ?? wildcard,
      key.blockID ?? wildcard,
      key.functionalityID ?? wildcard,
      key.resourceID ?? wildcard,
    )

  const ensureSubscribed = () => {
    if (unsubscribe !== undefined || listenerCount === 0) {
      return
    }

    unsubscribe = input.listen((event) => {
      const id = event.details.id
      if (id !== undefined) {
        if (recentEventIDs.has(id)) return
        recentEventIDs.add(id)
        if (recentEventIDs.size > recentEventLimit) recentEventIDs.delete(recentEventIDs.values().next().value!)
      }
      const properties = extractProperties(event)
      const routed = {
        id,
        type: event.details.type,
        properties: event.details.properties,
      } as ServerEvent
      const handlers = new Set<EventHandler>()

      for (const key of buildCombinations(properties, event.details.type)) {
        const listeners = typedListeners.get(key)
        if (listeners === undefined) {
          continue
        }

        for (const listener of listeners) {
          if (matchKeyProperties(listener.key, properties)) {
            handlers.add(listener.handler)
          }
        }
      }

      for (const listener of predicateListeners) {
        if (listener.predicate(routed)) {
          handlers.add(listener.handler)
        }
      }

      for (const handler of handlers) {
        handler(routed)
      }
    })
  }

  const teardownIfIdle = () => {
    if (listenerCount > 0) {
      return
    }

    if (unsubscribe === undefined) {
      return
    }

    unsubscribe()
    unsubscribe = undefined
  }

  const withTypedListenerById = (id: number, run: (signature: string, listeners: Set<Listener>) => void) => {
    for (const [signature, listeners] of typedListeners) {
      for (const listener of listeners) {
        if (listener.id !== id) {
          continue
        }
        run(signature, listeners)
        return
      }
    }
  }

  const removeTypedListener = (signature: string, listener: Listener) => {
    const listeners = typedListeners.get(signature)
    if (listeners === undefined) {
      return
    }

    listeners.delete(listener)
    listenerCount = listenerCount - 1
    if (listeners.size === 0) {
      typedListeners.delete(signature)
    }

    teardownIfIdle()
  }

  const removePredicateListener = (id: number) => {
    for (const listener of predicateListeners) {
      if (listener.id !== id) {
        continue
      }

      predicateListeners.delete(listener)
      listenerCount = listenerCount - 1
      teardownIfIdle()
      return
    }
  }

  const removeTypedListenersByKey = (key: RuntimeEventKey) => {
    const signature = makeSignature(key)
    const listeners = typedListeners.get(signature)
    if (listeners === undefined) {
      return
    }

    for (const listener of listeners) {
      listenerCount = listenerCount - 1
    }
    typedListeners.delete(signature)
    teardownIfIdle()
  }

  const on = (key: RuntimeEventKey, handler: EventHandler): (() => void) => {
    const signature = makeSignature(key)
    const listener: Listener = {
      id: nextListenerId++,
      key,
      handler,
    }

    const bucket = typedListeners.get(signature)
    if (bucket === undefined) {
      typedListeners.set(signature, new Set([listener]))
    } else {
      bucket.add(listener)
    }

    listenerCount = listenerCount + 1
    ensureSubscribed()

    return () => {
      withTypedListenerById(listener.id, (removeSignature) => {
        removeTypedListener(removeSignature, listener)
      })
    }
  }

  const off = (key: RuntimeEventKey, handler: EventHandler): void => {
    const signature = makeSignature(key)
    const listeners = typedListeners.get(signature)
    if (listeners === undefined) {
      return
    }

    for (const listener of listeners) {
      if (listener.handler !== handler) {
        continue
      }
      listeners.delete(listener)
      listenerCount = listenerCount - 1
      if (listeners.size === 0) {
        typedListeners.delete(signature)
      }
      teardownIfIdle()
      return
    }
  }

  const onPredicate = (predicate: RuntimeEventPredicate, handler: EventHandler): (() => void) => {
    const listener: PredicateListener = {
      id: nextListenerId++,
      predicate,
      handler,
    }

    predicateListeners.add(listener)
    listenerCount = listenerCount + 1
    ensureSubscribed()

    return () => {
      removePredicateListener(listener.id)
    }
  }

  const onReconnect = (handler: ReconnectHandler): (() => void) => {
    reconnectHandlers.add(handler)
    return () => {
      reconnectHandlers.delete(handler)
    }
  }

  const notifyReconnect = () => {
    for (const handler of reconnectHandlers) {
      handler()
    }
  }

  const offPredicate = (predicate: RuntimeEventPredicate, handler?: EventHandler): void => {
    for (const listener of predicateListeners) {
      if (listener.predicate !== predicate) {
        continue
      }
      if (handler !== undefined && listener.handler !== handler) {
        continue
      }

      predicateListeners.delete(listener)
      listenerCount = listenerCount - 1
      teardownIfIdle()
      return
    }
  }

  const dispose = () => {
    typedListeners.clear()
    predicateListeners.clear()
    reconnectHandlers.clear()
    recentEventIDs.clear()
    listenerCount = 0
    if (unsubscribe !== undefined) {
      unsubscribe()
      unsubscribe = undefined
    }
  }

  return {
    on: (keyOrPredicate: RuntimeEventKey | RuntimeEventPredicate, handler: EventHandler) =>
      typeof keyOrPredicate === "function"
        ? onPredicate(keyOrPredicate, handler)
        : on(keyOrPredicate, handler),
    off: (keyOrPredicate: RuntimeEventKey | RuntimeEventPredicate, handler?: EventHandler) => {
      if (typeof keyOrPredicate === "function") {
        offPredicate(keyOrPredicate, handler)
        return
      }

      if (handler === undefined) {
        removeTypedListenersByKey(keyOrPredicate)
      } else {
        off(keyOrPredicate, handler)
      }
    },
    onReconnect,
    notifyReconnect,
    dispose,
  }
}
