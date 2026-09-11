import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Workspace } from "../src/workspace"

describe("Workspace.Block.Transform", () => {
  test.each([
    { x: -144, y: 32 },
    { x: 32, y: -352 },
    { x: -144, y: -352 },
    { x: 0, y: 0 },
  ])("round-trips canvas position $x, $y", (position) => {
    const transform = { ...position, w: 248, h: 124, z: 1 }
    expect(
      Schema.encodeSync(Workspace.Block.Transform)(Schema.decodeUnknownSync(Workspace.Block.Transform)(transform)),
    ).toEqual(transform)
  })

  test.each(["x", "y", "w", "h", "z"])("rejects non-integer or non-finite %s", (field) => {
    const decode = Schema.decodeUnknownSync(Workspace.Block.Transform)
    for (const value of [0.5, NaN, Infinity, -Infinity]) {
      expect(() => decode({ x: 0, y: 0, w: 248, h: 124, z: 1, [field]: value })).toThrow()
    }
  })

  test.each(["w", "h"])("requires positive %s", (field) => {
    const decode = Schema.decodeUnknownSync(Workspace.Block.Transform)
    expect(() => decode({ x: 0, y: 0, w: 248, h: 124, z: 1, [field]: 0 })).toThrow()
    expect(() => decode({ x: 0, y: 0, w: 248, h: 124, z: 1, [field]: -1 })).toThrow()
  })
})
