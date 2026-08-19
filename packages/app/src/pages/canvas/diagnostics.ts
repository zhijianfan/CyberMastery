type BlockRuntimeConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "stale"
  | "error"

export type BlockRuntimeDiagnostics = {
  descriptor?: string
  bindings?: {
    blockID?: string
    functionalityID?: string
    resourceID?: string
    adapterFunctionalityID?: string
  }
  activeAdapterFunctionalityID?: string
  resourceSubscriptionCount?: number
  connectionState?: BlockRuntimeConnectionState
  lastCursor?: string
  lastRevision?: string | number
  lastSnapshotTime?: number
  resyncCount?: number
  resyncReason?: string
  eventBatchStats?: {
    flushCount?: number
    eventCount?: number
    droppedEventCount?: number
    maxBatchSize?: number
    avgBatchSize?: number
  }
}

const diagnosticsRegistry = new Map<() => BlockRuntimeDiagnostics, number>()

export function registerBlockRuntimeDiagnostics(stats: () => BlockRuntimeDiagnostics): () => void {
  const existing = diagnosticsRegistry.get(stats)
  if (existing === undefined) diagnosticsRegistry.set(stats, 1)
  else diagnosticsRegistry.set(stats, existing + 1)

  return () => {
    const current = diagnosticsRegistry.get(stats)
    if (current === undefined) return
    if (current <= 1) diagnosticsRegistry.delete(stats)
    else diagnosticsRegistry.set(stats, current - 1)
  }
}

export function getBlockRuntimeDiagnostics(): BlockRuntimeDiagnostics | undefined {
  const provider = [...diagnosticsRegistry.keys()].at(-1)
  if (provider === undefined) return undefined

  try {
    return provider()
  } catch {
    return undefined
  }
}

export function renderBlockRuntimeDiagnostics(diagnostics: BlockRuntimeDiagnostics | undefined = getBlockRuntimeDiagnostics()): string {
  if (!import.meta.env.DEV) return ""
  if (!diagnostics) return "block-runtime diagnostics: not registered"

  const lines: string[] = []
  if (diagnostics.descriptor !== undefined || diagnostics.bindings !== undefined) {
    const descriptor = diagnostics.descriptor ?? "(none)"
    const blockBinding = diagnostics.bindings
      ? `${diagnostics.bindings.blockID ?? "(no-block)"}/${diagnostics.bindings.functionalityID ?? "(no-functionality)"}`
      : "(no-binding)"
    lines.push(`descriptor: ${descriptor}`)
    lines.push(`bindings: ${blockBinding}`)
  }

  const activeAdapter = diagnostics.activeAdapterFunctionalityID
  if (activeAdapter !== undefined) lines.push(`active adapter functionalityID: ${activeAdapter}`)
  if (diagnostics.bindings?.adapterFunctionalityID !== undefined && activeAdapter === undefined) {
    lines.push(`binding adapter functionalityID: ${diagnostics.bindings.adapterFunctionalityID}`)
  }

  if (diagnostics.resourceSubscriptionCount !== undefined) {
    lines.push(`resource subscription count: ${diagnostics.resourceSubscriptionCount}`)
  }
  if (diagnostics.connectionState !== undefined) {
    lines.push(`connection state: ${diagnostics.connectionState}`)
  }
  if (diagnostics.lastCursor !== undefined || diagnostics.lastRevision !== undefined) {
    lines.push(
      `last cursor/revision: ${diagnostics.lastCursor ?? "(none)"}/${String(diagnostics.lastRevision ?? "(none)")}`,
    )
  }
  if (diagnostics.lastSnapshotTime !== undefined) {
    lines.push(`last snapshot time: ${new Date(diagnostics.lastSnapshotTime).toISOString()}`)
  }
  if (diagnostics.resyncCount !== undefined || diagnostics.resyncReason !== undefined) {
    lines.push(`resyncs: ${diagnostics.resyncCount ?? 0}${diagnostics.resyncReason ? ` (${diagnostics.resyncReason})` : ""}`)
  }

  if (diagnostics.eventBatchStats !== undefined) {
    const stats = diagnostics.eventBatchStats
    lines.push(
      `event batch stats: flush=${stats.flushCount ?? 0}, events=${stats.eventCount ?? 0}, dropped=${stats.droppedEventCount ?? 0}, max=${stats.maxBatchSize ?? 0}, avg=${stats.avgBatchSize ?? 0}`,
    )
  }

  return lines.join("\n")
}
