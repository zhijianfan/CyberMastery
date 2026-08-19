import { createBlockRuntimeStore, type BlockRuntimeBatchStats } from "@/state/block-runtime-store"
import type { BlockDescriptor, BlockRuntimeAdapter, BlockRuntimeContext, RuntimeEventEnvelope, RuntimeResourceState } from "./types"
import type { BlockRuntimeRegistry } from "./registry"

export interface RuntimeControllerInput {
  registry: BlockRuntimeRegistry
  context: BlockRuntimeContext
}

type AnyBlockRuntimeAdapter = BlockRuntimeAdapter<BlockDescriptor, unknown, unknown>

interface RuntimeBucket {
  adapter: AnyBlockRuntimeAdapter
  descriptor: BlockDescriptor
  bindings: ReturnType<AnyBlockRuntimeAdapter["getBindings"]>
  bindingKey: string
  store: ReturnType<typeof createBlockRuntimeStore>
  blocks: Set<string>
  unsubscribe: (() => void) | undefined
  cursor: string
  snapshotTask: Promise<void> | undefined
  reconnectScheduled: boolean
  resyncScheduled: boolean
  resyncCount: number
  resyncReason: string | undefined
}

export interface RuntimeControllerDiagnostics {
  activeBlockSubscriptions: number
  lastCursor: string | undefined
  resyncCount: number
  resyncReason: string | undefined
  batchStats: BlockRuntimeBatchStats
}

export interface RuntimeBlockController {
  id: () => string
  descriptor: () => BlockDescriptor
  state: () => RuntimeResourceState
  view: () => unknown
  dispatch: (command: unknown) => Promise<void>
  dispose: () => void
}

export interface RuntimeController {
  mount: (descriptor: BlockDescriptor) => Promise<RuntimeBlockController>
  diagnostics: () => RuntimeControllerDiagnostics
}

const createBindingKey = (bindings: RuntimeBucket["bindings"]) =>
  [...bindings]
    .sort((left, right) => {
      const leftKey = `${left.type}:${left.id}:${left.parentID ?? ""}`
      const rightKey = `${right.type}:${right.id}:${right.parentID ?? ""}`
      return leftKey.localeCompare(rightKey)
    })
    .map((binding) => `${binding.type}:${binding.id}:${binding.parentID ?? ""}`)
    .join("|")

const makeConnectionResource = (bindings: RuntimeBucket["bindings"]) =>
  bindings[0] ?? { type: "session", id: "runtime" }

const createConnectionEvent = (cursor: string, status: "connecting" | "connected" | "disconnected", resource: RuntimeEventEnvelope["resource"]) => ({
  cursor,
  timestamp: Date.now(),
  resource,
  event: `connection.${status}` as const,
  data: { status },
})

const mergeBatchStats = (left: BlockRuntimeBatchStats, right: BlockRuntimeBatchStats): BlockRuntimeBatchStats => ({
  queued: left.queued + right.queued,
  flushes: left.flushes + right.flushes,
  appliedEvents: left.appliedEvents + right.appliedEvents,
  droppedEvents: left.droppedEvents + right.droppedEvents,
  duplicateEvents: left.duplicateEvents + right.duplicateEvents,
})

export const createBlockRuntimeController = (input: RuntimeControllerInput): RuntimeController => {
  const mounted = new Map<string, {
    descriptor: BlockDescriptor
    bucket: RuntimeBucket
    key: string
    controller: RuntimeBlockController
  }>()
  const buckets = new Map<string, RuntimeBucket>()

  const applySnapshot = async (bucket: RuntimeBucket) => {
    const snapshot = await bucket.adapter.hydrate(bucket.descriptor, input.context)
    bucket.store.applySnapshot(snapshot)
    bucket.cursor = snapshot.cursor
    bucket.resyncReason = undefined
  }

  const connect = (bucket: RuntimeBucket, cursor: string) => {
    const resource = makeConnectionResource(bucket.bindings)
    bucket.unsubscribe?.()
    bucket.unsubscribe = input.context.subscribe(bucket.bindings, cursor, (event) => {
      const result = bucket.store.applyEvent(event)

      if (result.needsResync) {
        void scheduleResync(bucket, bucket.store.resyncReason() ?? "sequence gap")
        return
      }

      if (event.event === "connection.disconnected" || event.event === "connection.error") {
        void scheduleReconnect(bucket)
      }
    })
    bucket.store.applyEvent(createConnectionEvent(cursor, "connecting", resource))
  }

  const scheduleReconnect = (bucket: RuntimeBucket) => {
    if (bucket.reconnectScheduled) return
    bucket.reconnectScheduled = true

    void Promise.resolve().then(() => {
      if (bucket.blocks.size === 0) {
        bucket.reconnectScheduled = false
        return
      }

      const cursor = bucket.store.connection().cursor ?? bucket.cursor
      if (bucket.unsubscribe) {
        bucket.unsubscribe()
      }

      try {
        connect(bucket, cursor)
      } catch {
        void scheduleResync(bucket, "failed to resume")
      }

      bucket.reconnectScheduled = false
    })
  }

  const scheduleResync = (bucket: RuntimeBucket, reason: string) => {
    if (bucket.resyncScheduled) return
    bucket.resyncScheduled = true

    void Promise.resolve().then(async () => {
      if (bucket.blocks.size === 0) {
        bucket.resyncScheduled = false
        return
      }

      bucket.resyncCount += 1
      bucket.resyncReason = reason
      try {
        await applySnapshot(bucket)
        connect(bucket, bucket.cursor)
        bucket.resyncReason = undefined
      } catch {
        // keep the latest in-memory snapshot intact on failure
      } finally {
        bucket.resyncScheduled = false
      }
    })
  }

  const destroyBucket = (key: string, bucket: RuntimeBucket) => {
    if (bucket.blocks.size > 0) return
    bucket.unsubscribe?.()
    bucket.unsubscribe = undefined
    buckets.delete(key)
  }

  const createBucket = (descriptor: BlockDescriptor, adapter: AnyBlockRuntimeAdapter, bindings: RuntimeBucket["bindings"]) => {
    const bucket: RuntimeBucket = {
      adapter,
      descriptor,
      bindings,
      bindingKey: createBindingKey(bindings),
      store: createBlockRuntimeStore(),
      blocks: new Set(),
      unsubscribe: undefined,
      cursor: "0",
      snapshotTask: undefined,
      reconnectScheduled: false,
      resyncScheduled: false,
      resyncCount: 0,
      resyncReason: undefined,
    }

    bucket.snapshotTask = (async () => {
      await applySnapshot(bucket)
      connect(bucket, bucket.cursor)
    })().finally(() => {
      bucket.snapshotTask = undefined
    })

    return bucket
  }

  const resolveBucket = async (descriptor: BlockDescriptor) => {
    const adapter = input.registry.resolve(descriptor.functionalityID)
    if (!adapter) {
      throw new Error(`No runtime adapter for functionalityID: ${descriptor.functionalityID}`)
    }

    const bindings = adapter.getBindings(descriptor)
    const bindingKey = createBindingKey(bindings)
    const key = `${descriptor.functionalityID}:${bindingKey}`
    const existing = buckets.get(key)
    if (existing !== undefined) {
      existing.adapter = adapter
      existing.descriptor = descriptor
      existing.bindingKey = bindingKey
      if (existing.snapshotTask) await existing.snapshotTask
      return { bucket: existing, key }
    }

    const bucket = createBucket(descriptor, adapter, bindings)
    buckets.set(key, bucket)
    if (bucket.snapshotTask) await bucket.snapshotTask
    return { bucket, key }
  }

  const keyFor = (descriptor: BlockDescriptor, adapter: AnyBlockRuntimeAdapter) => {
    const bindingKey = createBindingKey(adapter.getBindings(descriptor))
    return `${descriptor.functionalityID}:${bindingKey}`
  }

  const diagnostics = (): RuntimeControllerDiagnostics => {
    let activeBlockSubscriptions = 0
    let lastCursor: string | undefined
    let resyncCount = 0
    let lastResyncReason: string | undefined
    let batchStats: RuntimeControllerDiagnostics["batchStats"] = {
      queued: 0,
      flushes: 0,
      appliedEvents: 0,
      droppedEvents: 0,
      duplicateEvents: 0,
    }

    for (const bucket of buckets.values()) {
      activeBlockSubscriptions += bucket.blocks.size
      resyncCount += bucket.resyncCount
      if (bucket.resyncReason !== undefined) lastResyncReason = bucket.resyncReason
      batchStats = mergeBatchStats(batchStats, bucket.store.batchStats())
      const cursor = bucket.store.connection().cursor
      if (cursor !== undefined) lastCursor = cursor
    }

    return {
      activeBlockSubscriptions,
      lastCursor,
      resyncCount,
      resyncReason: lastResyncReason,
      batchStats,
    }
  }

  return {
    async mount(descriptor) {
      const adapter = input.registry.resolve(descriptor.functionalityID)
      if (!adapter) {
        throw new Error(`No runtime adapter for functionalityID: ${descriptor.functionalityID}`)
      }

      const bucketKey = keyFor(descriptor, adapter)
      const existing = mounted.get(descriptor.id)
      if (existing !== undefined) {
        if (existing.key === bucketKey) {
          existing.descriptor = descriptor
          existing.bucket.descriptor = descriptor
          return existing.controller
        }
        existing.descriptor = descriptor
        existing.bucket.blocks.delete(descriptor.id)
        mounted.delete(descriptor.id)
        if (existing.bucket.blocks.size === 0) {
          destroyBucket(existing.key, existing.bucket)
        }
      }

      const { bucket, key } = await resolveBucket(descriptor)

      bucket.blocks.add(descriptor.id)

      const controller: RuntimeBlockController = {
        id: () => descriptor.id,
        descriptor: () => {
          const current = mounted.get(descriptor.id)
          return current === undefined ? descriptor : current.descriptor
        },
        state: () => bucket.store.state(),
        view: () => {
          const current = mounted.get(descriptor.id)
          if (current === undefined) {
            return bucket.adapter.select(descriptor, bucket.store.state())
          }
          return current.bucket.adapter.select(current.descriptor, current.bucket.store.state())
        },
        dispatch: async (command) => {
          const current = mounted.get(descriptor.id)
          if (current === undefined) return
          await current.bucket.adapter.dispatch(current.descriptor, command as never, input.context)
        },
        dispose() {
          const current = mounted.get(descriptor.id)
          if (current === undefined) return
          current.bucket.blocks.delete(descriptor.id)
          mounted.delete(descriptor.id)
          if (current.bucket.blocks.size === 0) {
            destroyBucket(current.key, current.bucket)
          }
        },
      }

      mounted.set(descriptor.id, { descriptor, bucket, key, controller })
      return controller
    },
    diagnostics,
  }
}
