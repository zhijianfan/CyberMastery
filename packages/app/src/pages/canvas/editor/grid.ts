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

// The panel is not scrollable. An empty packing strip is reserved on each
// side; each strip takes PANEL_PACKING_RATIO of the panel width.
export const PANEL_PACKING_RATIO = 0.05

export interface PanelRect {
  x: number
  y: number
  w: number
  h: number
}

export function snap(value: number, cell = DEFAULT_CELL): number {
  if (cell <= 0) return value
  return Math.round(value / cell) * cell
}

// The visible area blocks may occupy: the panel minus the empty packing on
// the left and right sides (5% of the panel width each).
export function packedPanel(panel: { w: number; h: number }, ratio = PANEL_PACKING_RATIO): PanelRect {
  const packX = panel.w * ratio
  return { x: packX, y: 0, w: panel.w - 2 * packX, h: panel.h }
}

function clampSize(value: number, min: number, max: number | null) {
  return Math.max(min, Math.min(value, max ?? value))
}

export function clampBlockSize(rect: GridRect, constraints: GridConstraints): GridRect {
  return {
    ...rect,
    w: clampSize(rect.w, constraints.minW, constraints.maxW),
    h: clampSize(rect.h, constraints.minH, constraints.maxH),
  }
}

export function clampBlock(rect: GridRect, panel: { w: number; h: number }, constraints: GridConstraints): GridRect {
  const area = packedPanel(panel)
  const capW = Math.min(constraints.maxW ?? area.w, area.w)
  const capH = Math.min(constraints.maxH ?? area.h, area.h)
  const w = Math.min(capW, Math.max(rect.w, Math.min(constraints.minW, capW)))
  const h = Math.min(capH, Math.max(rect.h, Math.min(constraints.minH, capH)))
  return { x: rect.x, y: rect.y, w, h, z: rect.z }
}

export function initialSquareSize(
  preferred: number,
  panel: { w: number; h: number },
  constraints: GridConstraints,
): number {
  const area = packedPanel(panel)
  return Math.max(
    0,
    Math.min(
      Math.max(preferred, constraints.minW, constraints.minH),
      area.w,
      area.h,
      constraints.maxW ?? area.w,
      constraints.maxH ?? area.h,
    ),
  )
}

export function clampInitialSquare(
  rect: GridRect,
  panel: { w: number; h: number },
  constraints: GridConstraints,
): GridRect {
  const side = initialSquareSize(Math.max(rect.w, rect.h), panel, constraints)
  return moveBlock({ ...rect, w: side, h: side }, { dx: 0, dy: 0 }, panel)
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
  void panel
  return { ...rect, x: snap(rect.x + delta.dx), y: snap(rect.y + delta.dy) }
}

function overlaps(a: GridRect, b: GridRect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function settleBlocks(
  blocks: readonly GridRect[],
  panel: { w: number; h: number },
  constraints: GridConstraints,
): GridRect[] {
  return resolveOverlap(blocks.map((block) => clampBlock(block, panel, constraints)))
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
  const area = packedPanel(panel)
  return clampBlock({ x: area.x, y: area.y, w: snap(area.w), h: snap(area.h), z: 0 }, panel, constraints)
}
