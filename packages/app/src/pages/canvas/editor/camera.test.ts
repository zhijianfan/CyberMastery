import { expect, test } from "bun:test"
import { clampCamera, clampScale, panCamera, screenToWorld, worldToScreen, zoomCamera } from "./camera"

const camera = { x: 80, y: 54, scale: 1 }
const viewport = { w: 1200, h: 800 }

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

test("zoom clamps at the scale bounds", () => {
  expect(zoomCamera(camera, 10, { x: 0, y: 0 }, viewport).scale).toBe(1.75)
  expect(zoomCamera(camera, 0.01, { x: 0, y: 0 }, viewport).scale).toBe(0.42)
})

test("clamps pan so the world always covers the viewport", () => {
  expect(clampCamera({ x: 500, y: -200, scale: 1 }, viewport)).toEqual({ x: 0, y: -200, scale: 1 })
  expect(clampCamera({ x: -9000, y: -9000, scale: 1 }, viewport)).toEqual({ x: -2800, y: -1600, scale: 1 })
})

test("centers the world when it is smaller than the viewport", () => {
  const next = clampCamera({ x: 12, y: 34, scale: 0.42 }, { w: 2000, h: 1600 })
  expect(next.scale).toBe(0.42)
  expect(next.x).toBe((2000 - 4000 * 0.42) / 2)
  expect(next.y).toBe((1600 - 2400 * 0.42) / 2)
})

test("pan moves the camera and clamps", () => {
  expect(panCamera({ x: 0, y: 0, scale: 1 }, { x: -200, y: 150 }, viewport)).toEqual({ x: -200, y: 0, scale: 1 })
  expect(panCamera({ x: -1000, y: -500, scale: 1 }, { x: -400, y: -200 }, viewport)).toEqual({
    x: -1400,
    y: -700,
    scale: 1,
  })
})
