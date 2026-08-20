import { expect, test } from "bun:test"
import {
  DEFAULT_CELL,
  clampBlock,
  clampInitialSquare,
  fitDefaultLayout,
  initialSquareSize,
  moveBlock,
  normalizeZOrder,
  packedPanel,
  resizeBlock,
  resolveOverlap,
  snap,
  type GridConstraints,
  type GridRect,
} from "./grid"

const free: GridConstraints = { minW: 32, minH: 32, maxW: null, maxH: null, initialAspect: "free" }

test("snaps values to the nearest grid cell", () => {
  expect(DEFAULT_CELL).toBe(16)
  expect(snap(0)).toBe(0)
  expect(snap(20)).toBe(16)
  expect(snap(24)).toBe(32)
  expect(snap(25)).toBe(32)
  expect(snap(-25)).toBe(-32)
  expect(snap(6, 10)).toBe(10)
  expect(snap(4, 10)).toBe(0)
  expect(snap(10, 0)).toBe(10)
})

test("reserves 5% empty packing on each side of the panel", () => {
  expect(packedPanel({ w: 100, h: 100 })).toEqual({ x: 5, y: 0, w: 90, h: 100 })
  expect(packedPanel({ w: 320, h: 208 })).toEqual({ x: 16, y: 0, w: 288, h: 208 })
})

test("preserves positions outside the visible panel", () => {
  const block: GridRect = { x: -32, y: -16, w: 64, h: 64, z: 3 }
  expect(clampBlock(block, { w: 100, h: 100 }, free)).toEqual(block)
  expect(clampBlock({ x: 90, y: 90, w: 64, h: 64, z: 3 }, { w: 100, h: 100 }, free)).toEqual({
    x: 90,
    y: 90,
    w: 64,
    h: 64,
    z: 3,
  })
})

test("clamps oversized and undersized blocks to constraints", () => {
  expect(clampBlock({ x: 0, y: 0, w: 400, h: 400, z: 0 }, { w: 100, h: 100 }, free)).toEqual({
    x: 0,
    y: 0,
    w: 90,
    h: 100,
    z: 0,
  })
  expect(clampBlock({ x: 0, y: 0, w: 8, h: 8, z: 0 }, { w: 100, h: 100 }, free)).toEqual({
    x: 0,
    y: 0,
    w: 32,
    h: 32,
    z: 0,
  })
})

test("viewport caps override block minima on a constrained panel", () => {
  const minimum: GridConstraints = { ...free, minW: 64, minH: 64 }
  expect(clampBlock({ x: 0, y: 0, w: 8, h: 8, z: 0 }, { w: 50, h: 40 }, minimum)).toEqual({
    x: 0,
    y: 0,
    w: 45,
    h: 40,
    z: 0,
  })
})

test("derives a viewport-safe initial square in portrait and narrow panels", () => {
  const square: GridConstraints = { minW: 248, minH: 124, maxW: 760, maxH: 760, initialAspect: "square" }

  expect(initialSquareSize(440, { w: 100, h: 300 }, square)).toBe(90)
  expect(initialSquareSize(440, { w: 50, h: 40 }, square)).toBe(40)
  expect(clampInitialSquare({ x: 0, y: 0, w: 200, h: 200, z: 1 }, { w: 400, h: 200 }, square)).toEqual({
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    z: 1,
  })
  expect(clampInitialSquare({ x: 0, y: 0, w: 40, h: 40, z: 2 }, { w: 50, h: 40 }, square)).toEqual({
    x: 0,
    y: 0,
    w: 40,
    h: 40,
    z: 2,
  })
})

test("caps block size at the maximum constraint", () => {
  const bounded: GridConstraints = { ...free, maxW: 48, maxH: 48 }
  expect(clampBlock({ x: 0, y: 0, w: 80, h: 80, z: 1 }, { w: 100, h: 100 }, bounded)).toEqual({
    x: 0,
    y: 0,
    w: 48,
    h: 48,
    z: 1,
  })
})

test("resizes from the southeast corner with snapping", () => {
  const block: GridRect = { x: 0, y: 0, w: 64, h: 64, z: 1 }
  expect(resizeBlock(block, { dx: 16, dy: 32 }, "se", free)).toEqual({ x: 0, y: 0, w: 80, h: 96, z: 1 })
  expect(resizeBlock(block, { dx: 10, dy: 10 }, "se", free)).toEqual({ x: 0, y: 0, w: 80, h: 80, z: 1 })
})

test("resizes from each corner", () => {
  const block: GridRect = { x: 64, y: 64, w: 64, h: 64, z: 2 }
  expect(resizeBlock(block, { dx: -16, dy: -16 }, "nw", free)).toEqual({ x: 48, y: 48, w: 80, h: 80, z: 2 })
  expect(resizeBlock({ x: 0, y: 64, w: 64, h: 64, z: 3 }, { dx: 32, dy: -16 }, "ne", free)).toEqual({
    x: 0,
    y: 48,
    w: 96,
    h: 80,
    z: 3,
  })
  expect(resizeBlock({ x: 64, y: 0, w: 64, h: 64, z: 4 }, { dx: -16, dy: 32 }, "sw", free)).toEqual({
    x: 48,
    y: 0,
    w: 80,
    h: 96,
    z: 4,
  })
})

test("enforces min and max sizes while resizing", () => {
  expect(resizeBlock({ x: 0, y: 0, w: 64, h: 64, z: 1 }, { dx: -100, dy: -100 }, "se", free)).toEqual({
    x: 0,
    y: 0,
    w: 32,
    h: 32,
    z: 1,
  })
  expect(resizeBlock({ x: 64, y: 64, w: 64, h: 64, z: 2 }, { dx: 64, dy: 64 }, "nw", free)).toEqual({
    x: 128,
    y: 128,
    w: 32,
    h: 32,
    z: 2,
  })
  const capped: GridConstraints = { ...free, maxW: 80, maxH: 80 }
  expect(resizeBlock({ x: 0, y: 0, w: 64, h: 64, z: 3 }, { dx: 48, dy: 48 }, "se", capped)).toEqual({
    x: 0,
    y: 0,
    w: 80,
    h: 80,
    z: 3,
  })
})

test("moves blocks with snapping anywhere on the canvas", () => {
  const block: GridRect = { x: 16, y: 16, w: 32, h: 32, z: 5 }
  expect(moveBlock(block, { dx: 16, dy: 24 }, { w: 100, h: 100 })).toEqual({ x: 32, y: 48, w: 32, h: 32, z: 5 })
  expect(moveBlock(block, { dx: 10, dy: 0 }, { w: 100, h: 100 })).toEqual({ x: 32, y: 16, w: 32, h: 32, z: 5 })
  expect(moveBlock(block, { dx: -1000, dy: -1000 }, { w: 100, h: 100 })).toEqual({ x: -976, y: -976, w: 32, h: 32, z: 5 })
  expect(moveBlock(block, { dx: 1000, dy: 1000 }, { w: 100, h: 100 })).toEqual({ x: 1024, y: 1024, w: 32, h: 32, z: 5 })
})

test("preserves block positions anywhere on the canvas", () => {
  const block: GridRect = { x: -8000, y: 12000, w: 64, h: 64, z: 3 }
  expect(clampBlock(block, { w: 100, h: 100 }, free)).toEqual(block)
  expect(moveBlock(block, { dx: -32, dy: 48 }, { w: 100, h: 100 })).toEqual({
    ...block,
    x: -8032,
    y: 12048,
  })
})

test("pushes overlapping blocks down by default", () => {
  const blocks: GridRect[] = [
    { x: 0, y: 0, w: 32, h: 32, z: 0 },
    { x: 16, y: 16, w: 32, h: 32, z: 1 },
  ]
  expect(resolveOverlap(blocks)).toEqual([
    { x: 0, y: 0, w: 32, h: 32, z: 0 },
    { x: 16, y: 32, w: 32, h: 32, z: 1 },
  ])
})

test("pushes right when that clears the overlap sooner", () => {
  const blocks: GridRect[] = [
    { x: 0, y: 0, w: 16, h: 64, z: 0 },
    { x: 8, y: 32, w: 64, h: 16, z: 1 },
  ]
  expect(resolveOverlap(blocks)).toEqual([
    { x: 0, y: 0, w: 16, h: 64, z: 0 },
    { x: 16, y: 32, w: 64, h: 16, z: 1 },
  ])
})

test("resolves overlap chains deterministically without moving earlier blocks", () => {
  const blocks: GridRect[] = [
    { x: 0, y: 0, w: 32, h: 32, z: 0 },
    { x: 16, y: 16, w: 32, h: 32, z: 1 },
    { x: 32, y: 32, w: 32, h: 32, z: 2 },
  ]
  const resolved = resolveOverlap(blocks)
  expect(resolved).toEqual(resolveOverlap(blocks))
  expect(resolved[0]).toEqual(blocks[0])
  expect(resolved).toEqual([
    { x: 0, y: 0, w: 32, h: 32, z: 0 },
    { x: 16, y: 32, w: 32, h: 32, z: 1 },
    { x: 48, y: 32, w: 32, h: 32, z: 2 },
  ])
})

test("leaves touching and separated blocks alone", () => {
  const blocks: GridRect[] = [
    { x: 0, y: 0, w: 32, h: 32, z: 0 },
    { x: 32, y: 0, w: 32, h: 32, z: 1 },
    { x: 100, y: 100, w: 32, h: 32, z: 2 },
  ]
  expect(resolveOverlap(blocks)).toEqual(blocks)
})

test("assigns deterministic z order from input order", () => {
  expect(
    normalizeZOrder([
      { x: 1, y: 2, w: 3, h: 4, z: 99 },
      { x: 5, y: 6, w: 7, h: 8, z: -3 },
    ]),
  ).toEqual([
    { x: 1, y: 2, w: 3, h: 4, z: 0 },
    { x: 5, y: 6, w: 7, h: 8, z: 1 },
  ])
})

test("settles edge-overlap chains inside the packed panel without reintroducing overlap after clamping", async () => {
  const grid = (await import("./grid")) as typeof import("./grid") & {
    settleBlocks?: (
      blocks: readonly GridRect[],
      panel: { w: number; h: number },
      constraints: GridConstraints,
    ) => GridRect[]
  }
  const blocks: GridRect[] = [
    { x: 20, y: 0, w: 180, h: 150, z: 0 },
    { x: 20, y: 0, w: 180, h: 150, z: 1 },
    { x: 20, y: 0, w: 180, h: 150, z: 2 },
  ]

  expect(grid.settleBlocks?.(blocks, { w: 400, h: 300 }, { ...free, minW: 1, minH: 1 })).toEqual([
    { x: 20, y: 0, w: 180, h: 150, z: 0 },
    { x: 20, y: 150, w: 180, h: 150, z: 1 },
    { x: 20, y: 300, w: 180, h: 150, z: 2 },
  ])
})

test("fits a full-panel block into the packed grid", () => {
  expect(fitDefaultLayout({ w: 100, h: 100 }, free)).toEqual({ x: 5, y: 0, w: 90, h: 96, z: 0 })
  expect(fitDefaultLayout({ w: 320, h: 208 }, free)).toEqual({ x: 16, y: 0, w: 288, h: 208, z: 0 })
  const capped: GridConstraints = { ...free, maxW: 64, maxH: 64 }
  expect(fitDefaultLayout({ w: 100, h: 100 }, capped)).toEqual({ x: 5, y: 0, w: 64, h: 64, z: 0 })
  const minimum: GridConstraints = { ...free, minW: 120, minH: 120 }
  expect(fitDefaultLayout({ w: 100, h: 100 }, minimum)).toEqual({ x: 5, y: 0, w: 90, h: 100, z: 0 })
})
