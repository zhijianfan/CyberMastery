import { expect, test } from "bun:test"
import { sessionSurfaceDesktop } from "./session-surface-layout"

test("routed session layout follows the viewport breakpoint", () => {
  expect(sessionSurfaceDesktop({ embedded: false, viewportDesktop: true })).toBe(true)
  expect(sessionSurfaceDesktop({ embedded: false, viewportDesktop: false })).toBe(false)
})

test("embedded session layout follows its own measured width", () => {
  expect(sessionSurfaceDesktop({ embedded: true, viewportDesktop: true })).toBe(false)
  expect(sessionSurfaceDesktop({ embedded: true, containerWidth: 767, viewportDesktop: true })).toBe(false)
  expect(sessionSurfaceDesktop({ embedded: true, containerWidth: 768, viewportDesktop: false })).toBe(true)
})
