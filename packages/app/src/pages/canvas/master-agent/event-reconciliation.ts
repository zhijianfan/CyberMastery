// Binding-update event reconciliation for the master-agent block: consumes
// workspace.master-agent.binding.updated events, filters them to the active
// workspace and known blocks, drops revisions that are not newer than the
// current binding, and triggers authoritative refetches when the subscription
// reconnects. Events are transient; the server-persisted binding remains the
// source of truth, so no session is ever created client-side from an event.

import type { MasterAgent } from "./types"

const BINDING_UPDATED_TYPE = "workspace.master-agent.binding.updated"

export interface BindingEventEntry {
  name: string
  details: {
    type: string
    properties?: unknown
  }
}

export interface MasterAgentEventReconciliationInput {
  workspaceID: () => string | undefined
  isKnownBlock: (blockID: string) => boolean
  knownBlocks: () => string[]
  currentRevision: (blockID: string) => number | undefined
  onBindingUpdated: (event: MasterAgent.BindingUpdatedEvent) => void
  refetch: (blockID: string) => void
  listen: (listener: (entry: BindingEventEntry) => void) => () => void
  onReconnect: (listener: () => void) => () => void
}

export interface MasterAgentEventReconciliation {
  dispose: () => void
  takeBuffered: (blockID: string) => MasterAgent.BindingUpdatedEvent | undefined
}

export function createMasterAgentEventReconciliation(
  input: MasterAgentEventReconciliationInput,
): MasterAgentEventReconciliation {
  // A binding-updated event can arrive before its block is mounted or before
  // the block's initial get has finished. The newest event per block is
  // buffered and handed back once the block has an authoritative revision to
  // compare against; the mount flow's get/ensure remains authoritative.
  const buffered = new Map<string, MasterAgent.BindingUpdatedEvent>()

  function bufferEvent(event: MasterAgent.BindingUpdatedEvent) {
    const existing = buffered.get(event.blockID)
    if (existing && existing.revision >= event.revision) return
    buffered.set(event.blockID, event)
  }

  function drainBuffered() {
    for (const [blockID, event] of buffered) {
      if (!input.isKnownBlock(blockID)) continue
      const current = input.currentRevision(blockID)
      if (current === undefined) continue
      buffered.delete(blockID)
      if (event.revision <= current) continue
      input.onBindingUpdated(event)
    }
  }

  function handleEvent(entry: BindingEventEntry) {
    const event = parseBindingUpdated(entry)
    if (!event) return
    if (event.workspaceID !== input.workspaceID()) return
    const current = input.isKnownBlock(event.blockID) ? input.currentRevision(event.blockID) : undefined
    if (current === undefined) {
      bufferEvent(event)
      drainBuffered()
      return
    }
    if (event.revision > current) input.onBindingUpdated(event)
    drainBuffered()
  }

  function handleReconnect() {
    for (const blockID of input.knownBlocks()) input.refetch(blockID)
  }

  const stopListening = input.listen(handleEvent)
  const stopReconnect = input.onReconnect(handleReconnect)
  let disposed = false

  function takeBuffered(blockID: string) {
    const event = buffered.get(blockID)
    if (!event) return undefined
    const current = input.currentRevision(blockID)
    if (current === undefined) return undefined
    buffered.delete(blockID)
    if (event.revision <= current) return undefined
    return event
  }

  function dispose() {
    if (disposed) return
    disposed = true
    stopListening()
    stopReconnect()
    buffered.clear()
  }

  return { dispose, takeBuffered }
}

function parseBindingUpdated(entry: BindingEventEntry): MasterAgent.BindingUpdatedEvent | undefined {
  if (entry.details.type !== BINDING_UPDATED_TYPE) return undefined
  const properties = entry.details.properties
  if (!isRecord(properties)) return undefined
  if (typeof properties.workspaceID !== "string") return undefined
  if (typeof properties.blockID !== "string") return undefined
  if (typeof properties.sessionID !== "string") return undefined
  if (typeof properties.generation !== "number") return undefined
  if (typeof properties.revision !== "number") return undefined
  return {
    type: BINDING_UPDATED_TYPE,
    workspaceID: properties.workspaceID,
    blockID: properties.blockID,
    sessionID: properties.sessionID,
    generation: properties.generation,
    revision: properties.revision,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
