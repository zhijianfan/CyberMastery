export interface GridRect {
  x: number
  y: number
  w: number
  h: number
  z: number
}

export interface GridConstraints {
  minW: number
  minH: number
  maxW: number | null
  maxH: number | null
  initialAspect: "square" | "free"
}

export const DEFAULT_CELL = 16

export function snap(value: number, cell = DEFAULT_CELL): number {
  if (cell <= 0) return value
  return Math.round(value / cell) * cell
}

function clampSize(value: number, min: number, max: number | null) {
  return Math.max(min, Math.min(value, max ?? value))
}

export function clampBlock(rect: GridRect, panel: { w: number; h: number }, constraints: GridConstraints): GridRect {
  const capW = Math.min(constraints.maxW ?? panel.w, panel.w)
  const capH = Math.min(constraints.maxH ?? panel.h, panel.h)
  const w = clampSize(rect.w, constraints.minW, capW)
  const h = clampSize(rect.h, constraints.minH, capH)
  const x = Math.min(Math.max(rect.x, 0), Math.max(0, panel.w - w))
  const y = Math.min(Math.max(rect.y, 0), Math.max(0, panel.h - h))
  return { x, y, w, h, z: rect.z }
}

export function resizeBlock(
  rect: GridRect,
  delta: { dx: number; dy: number },
  direction: "se" | "nw" | "ne" | "sw",
  constraints: GridConstraints,
): GridRect {
  const { minW, minH, maxW, maxH } = constraints
  if (direction === "se") {
    return {
      ...rect,
      w: clampSize(snap(rect.w + delta.dx), minW, maxW),
      h: clampSize(snap(rect.h + delta.dy), minH, maxH),
    }
  }
  if (direction === "nw") {
    return {
      ...rect,
      x: snap(rect.x + delta.dx),
      y: snap(rect.y + delta.dy),
      w: clampSize(snap(rect.w - delta.dx), minW, maxW),
      h: clampSize(snap(rect.h - delta.dy), minH, maxH),
    }
  }
  if (direction === "ne") {
    return {
      ...rect,
      y: snap(rect.y + delta.dy),
      w: clampSize(snap(rect.w + delta.dx), minW, maxW),
      h: clampSize(snap(rect.h - delta.dy), minH, maxH),
    }
  }
  return {
    ...rect,
    x: snap(rect.x + delta.dx),
    w: clampSize(snap(rect.w - delta.dx), minW, maxW),
    h: clampSize(snap(rect.h + delta.dy), minH, maxH),
  }
}

export function moveBlock(rect: GridRect, delta: { dx: number; dy: number }, panel: { w: number; h: number }): GridRect {
  const x = Math.min(Math.max(snap(rect.x + delta.dx), 0), Math.max(0, panel.w - rect.w))
  const y = Math.min(Math.max(snap(rect.y + delta.dy), 0), Math.max(0, panel.h - rect.h))
  return { ...rect, x, y }
}

function overlaps(a: GridRect, b: GridRect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function resolveOverlap(blocks: readonly GridRect[]): GridRect[] {
  const placed: GridRect[] = []
  for (const block of blocks) {
    let current = { ...block }
    let clear = false
    while (!clear) {
      clear = true
      for (const target of placed) {
        if (!overlaps(target, current)) continue
        // shift by the smaller displacement; ties push down
        const down = target.y + target.h - current.y
        const right = target.x + target.w - current.x
        current = down <= right ? { ...current, y: target.y + target.h } : { ...current, x: target.x + target.w }
        clear = false
        break
      }
    }
    placed.push(current)
  }
  return placed
}

export function normalizeZOrder(blocks: readonly GridRect[]): GridRect[] {
  return blocks.map((block, z) => ({ ...block, z }))
}

export function fitDefaultLayout(panel: { w: number; h: number }, constraints: GridConstraints): GridRect {
  return clampBlock({ x: 0, y: 0, w: snap(panel.w), h: snap(panel.h), z: 0 }, panel, constraints)
}
