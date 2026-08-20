import { expect, test } from "bun:test"
import { clampCamera, clampScale, panCamera, panCameraFree, screenToWorld, worldToScreen, zoomCamera } from "./camera"

const camera = { x: 80, y: 54, scale: 1 }
const viewport = { w: 1200, h: 800 }

test("keeps camera translation unbounded", () => {
  expect(clampCamera({ x: 5000, y: -9000, scale: 1 }, viewport)).toEqual({ x: 5000, y: -9000, scale: 1 })
  expect(panCamera({ x: 5000, y: -9000, scale: 1 }, { x: 3000, y: -4000 }, viewport)).toEqual({
    x: 8000,
    y: -13000,
    scale: 1,
  })
})

test("clamps scale to the zoom range", () => {
  expect(clampScale(0.1)).toBe(0.42)
  expect(clampScale(0.7)).toBe(0.7)
  expect(clampScale(9)).toBe(1.75)
})

test("converts between screen and world coordinates", () => {
  expect(screenToWorld({ x: 100, y: 50, scale: 2 }, { x: 300, y: 150 })).toEqual({ x: 100, y: 50 })
  expect(worldToScreen({ x: 100, y: 50, scale: 2 }, { x: 100, y: 50 })).toEqual({ x: 300, y: 150 })
})

test("zoom keeps the world point under the anchor fixed", () => {
  const anchor = { x: 600, y: 400 }
  const before = screenToWorld(camera, anchor)
  const next = zoomCamera(camera, 1.4, anchor, viewport)
  expect(next.scale).toBe(1.4)
  expect(before).toEqual(screenToWorld(next, anchor))
})

test("zoom keeps the world point under the cursor fixed in an offset viewport", () => {
  const cursor = { x: 840, y: 520 }
  const origin = { x: 240, y: 120 }
  const anchor = { x: cursor.x - origin.x, y: cursor.y - origin.y }
  const before = screenToWorld(camera, anchor)
  const next = zoomCamera(camera, 1.4, cursor, viewport, origin)

  expect(before).toEqual(screenToWorld(next, anchor))
})

test("zoom clamps at the scale bounds", () => {
  expect(zoomCamera(camera, 10, { x: 0, y: 0 }, viewport).scale).toBe(1.75)
  expect(zoomCamera(camera, 0.01, { x: 0, y: 0 }, viewport).scale).toBe(0.42)
})

test("free pan follows the pointer 1:1 at any zoom without clamping", () => {
  expect(panCameraFree({ x: 10, y: 20, scale: 2 }, { x: 30, y: -40 })).toEqual({ x: 40, y: -20, scale: 2 })
  expect(panCameraFree({ x: 960, y: 540, scale: 0.42 }, { x: -50, y: 25 })).toEqual({ x: 910, y: 565, scale: 0.42 })
})
