import { expect, test } from "bun:test"
import {
  DEFAULT_CELL,
  clampBlock,
  fitDefaultLayout,
  moveBlock,
  normalizeZOrder,
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

test("clamps negative and out-of-panel positions", () => {
  const block: GridRect = { x: -32, y: -16, w: 64, h: 64, z: 3 }
  expect(clampBlock(block, { w: 100, h: 100 }, free)).toEqual({ x: 0, y: 0, w: 64, h: 64, z: 3 })
  expect(clampBlock({ x: 90, y: 90, w: 64, h: 64, z: 3 }, { w: 100, h: 100 }, free)).toEqual({
    x: 36,
    y: 36,
    w: 64,
    h: 64,
    z: 3,
  })
})

test("clamps oversized and undersized blocks to constraints", () => {
  expect(clampBlock({ x: 0, y: 0, w: 400, h: 400, z: 0 }, { w: 100, h: 100 }, free)).toEqual({
    x: 0,
    y: 0,
    w: 100,
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

test("moves blocks with snapping and panel clamping", () => {
  const block: GridRect = { x: 16, y: 16, w: 32, h: 32, z: 5 }
  expect(moveBlock(block, { dx: 16, dy: 24 }, { w: 100, h: 100 })).toEqual({ x: 32, y: 40, w: 32, h: 32, z: 5 })
  expect(moveBlock(block, { dx: 10, dy: 0 }, { w: 100, h: 100 })).toEqual({ x: 32, y: 16, w: 32, h: 32, z: 5 })
  expect(moveBlock(block, { dx: -1000, dy: -1000 }, { w: 100, h: 100 })).toEqual({ x: 0, y: 0, w: 32, h: 32, z: 5 })
  expect(moveBlock(block, { dx: 1000, dy: 1000 }, { w: 100, h: 100 })).toEqual({ x: 68, y: 68, w: 32, h: 32, z: 5 })
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

test("fits a full-panel block into the snapped grid", () => {
  expect(fitDefaultLayout({ w: 100, h: 100 }, free)).toEqual({ x: 0, y: 0, w: 96, h: 96, z: 0 })
  expect(fitDefaultLayout({ w: 320, h: 208 }, free)).toEqual({ x: 0, y: 0, w: 320, h: 208, z: 0 })
  const capped: GridConstraints = { ...free, maxW: 64, maxH: 64 }
  expect(fitDefaultLayout({ w: 100, h: 100 }, capped)).toEqual({ x: 0, y: 0, w: 64, h: 64, z: 0 })
  const minimum: GridConstraints = { ...free, minW: 120, minH: 120 }
  expect(fitDefaultLayout({ w: 100, h: 100 }, minimum)).toEqual({ x: 0, y: 0, w: 120, h: 120, z: 0 })
})
