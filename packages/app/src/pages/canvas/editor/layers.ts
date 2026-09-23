export interface LayerBlock {
  id: string
  z: number
}

// Front-to-back stacking order: layer 0 is the frontmost block and higher
// layers sit below it. Ties keep the caller's array order.
export function layerOrder<T extends LayerBlock>(blocks: readonly T[]): T[] {
  return [...blocks].sort((a, b) => b.z - a.z)
}

export function layerOf(blocks: readonly LayerBlock[], id: string): number | undefined {
  const index = layerOrder(blocks).findIndex((block) => block.id === id)
  return index < 0 ? undefined : index
}

// Moves one block to the requested layer and renumbers every block densely so
// layer 0 stays on top. Returns undefined for an unknown block or a
// non-finite layer.
export function withLayer<T extends LayerBlock>(blocks: readonly T[], id: string, layer: number): T[] | undefined {
  if (!Number.isFinite(layer)) return undefined
  const ordered = layerOrder(blocks)
  const from = ordered.findIndex((block) => block.id === id)
  if (from < 0) return undefined
  const target = Math.max(0, Math.min(Math.round(layer), ordered.length - 1))
  const [moved] = ordered.splice(from, 1)
  ordered.splice(target, 0, moved)
  const top = ordered.length
  return ordered.map((block, index) => ({ ...block, z: top - index }))
}
