import { describe, expect, test } from "bun:test"
import { layerOf, layerOrder, withLayer } from "./layers"

const block = (id: string, z: number) => ({ id, z })

describe("layer order", () => {
  test("orders blocks front to back with layer 0 on top", () => {
    const blocks = [block("back", 1), block("front", 9), block("middle", 4)]
    expect(layerOrder(blocks).map((entry) => entry.id)).toEqual(["front", "middle", "back"])
    expect(layerOf(blocks, "front")).toBe(0)
    expect(layerOf(blocks, "middle")).toBe(1)
    expect(layerOf(blocks, "back")).toBe(2)
    expect(layerOf(blocks, "missing")).toBeUndefined()
  })

  test("keeps the caller's order for equal z values", () => {
    const blocks = [block("first", 2), block("second", 2), block("third", 2)]
    expect(layerOrder(blocks).map((entry) => entry.id)).toEqual(["first", "second", "third"])
  })
})

describe("withLayer", () => {
  test("moves a block to the requested layer and renumbers densely", () => {
    const blocks = [block("a", 3), block("b", 2), block("c", 1)]
    const next = withLayer(blocks, "c", 0)!
    expect(layerOrder(next).map((entry) => entry.id)).toEqual(["c", "a", "b"])
    expect(layerOf(next, "c")).toBe(0)
    expect(layerOf(next, "a")).toBe(1)
    expect(layerOf(next, "b")).toBe(2)
    expect(next.map((entry) => entry.z)).toEqual([3, 2, 1])
  })

  test("inserts below existing layers", () => {
    const blocks = [block("a", 3), block("b", 2), block("c", 1)]
    const next = withLayer(blocks, "a", 2)!
    expect(layerOrder(next).map((entry) => entry.id)).toEqual(["b", "c", "a"])
  })

  test("clamps out-of-range layers to the stack", () => {
    const blocks = [block("a", 3), block("b", 2), block("c", 1)]
    expect(layerOrder(withLayer(blocks, "a", 99)!).map((entry) => entry.id)).toEqual(["b", "c", "a"])
    expect(layerOrder(withLayer(blocks, "c", -4)!).map((entry) => entry.id)).toEqual(["c", "a", "b"])
  })

  test("rejects unknown blocks and non-finite layers", () => {
    const blocks = [block("a", 1)]
    expect(withLayer(blocks, "missing", 0)).toBeUndefined()
    expect(withLayer(blocks, "a", Number.NaN)).toBeUndefined()
    expect(withLayer(blocks, "a", Number.POSITIVE_INFINITY)).toBeUndefined()
  })
})
