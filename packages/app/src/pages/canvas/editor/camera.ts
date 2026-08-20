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
export function zoomCamera(
  camera: Camera,
  nextScale: number,
  anchor: Point,
  viewport: Size,
  viewportOrigin: Point = { x: 0, y: 0 },
): Camera {
  const scale = clampScale(nextScale)
  const point = { x: anchor.x - viewportOrigin.x, y: anchor.y - viewportOrigin.y }
  const before = screenToWorld(camera, point)
  const next = {
    x: point.x - before.x * scale,
    y: point.y - before.y * scale,
    scale,
  }
  return clampCamera(next, viewport)
}

// Canvas translation is intentionally unbounded; only zoom has limits.
export function clampCamera(camera: Camera, _viewport: Size): Camera {
  return { ...camera, scale: clampScale(camera.scale) }
}

export function panCamera(camera: Camera, delta: Point, _viewport: Size): Camera {
  return panCameraFree(camera, delta)
}

// The camera follows the pointer 1:1 at every zoom level.
export function panCameraFree(camera: Camera, delta: Point): Camera {
  return { ...camera, x: camera.x + delta.x, y: camera.y + delta.y }
}
