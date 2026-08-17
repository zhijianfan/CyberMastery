export interface Camera {
  x: number
  y: number
  scale: number
}

export interface Size {
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export const MIN_SCALE = 0.42
export const MAX_SCALE = 1.75

export const WORLD_SIZE: Size = { w: 4000, h: 2400 }

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function screenToWorld(camera: Camera, point: Point): Point {
  return {
    x: (point.x - camera.x) / camera.scale,
    y: (point.y - camera.y) / camera.scale,
  }
}

export function worldToScreen(camera: Camera, point: Point): Point {
  return {
    x: point.x * camera.scale + camera.x,
    y: point.y * camera.scale + camera.y,
  }
}

// Zooms towards an anchor point so the world coordinate under the cursor
// stays put. The anchor is given in screen space.
export function zoomCamera(camera: Camera, nextScale: number, anchor: Point, viewport: Size): Camera {
  const scale = clampScale(nextScale)
  const before = screenToWorld(camera, anchor)
  const next = {
    x: anchor.x - before.x * scale,
    y: anchor.y - before.y * scale,
    scale,
  }
  return clampCamera(next, viewport)
}

// Keeps the world covering the viewport: when the scaled world is smaller
// than the viewport in a dimension it is centered, otherwise translation is
// clamped so the world edges never pull inside the viewport.
export function clampCamera(camera: Camera, viewport: Size): Camera {
  const w = WORLD_SIZE.w * camera.scale
  const h = WORLD_SIZE.h * camera.scale
  const x = w <= viewport.w ? (viewport.w - w) / 2 : Math.min(0, Math.max(viewport.w - w, camera.x))
  const y = h <= viewport.h ? (viewport.h - h) / 2 : Math.min(0, Math.max(viewport.h - h, camera.y))
  return { x, y, scale: clampScale(camera.scale) }
}

export function panCamera(camera: Camera, delta: Point, viewport: Size): Camera {
  return clampCamera({ ...camera, x: camera.x + delta.x, y: camera.y + delta.y }, viewport)
}

// Free pan: the camera follows the pointer 1:1 at every zoom level, with no
// clamping. The grabbed world point stays locked under the cursor (like
// dragging a map); zoom re-clamps the camera back into bounds.
export function panCameraFree(camera: Camera, delta: Point): Camera {
  return { ...camera, x: camera.x + delta.x, y: camera.y + delta.y }
}
