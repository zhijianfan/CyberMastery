import { describe, expect, test } from "bun:test"
import { measureTabMinimum, visibleTabs } from "./canvas-tab-layout"

const entries = [
  { id: "new", title: "Newest session", createdAt: 30 },
  { id: "middle", title: "Middle session", createdAt: 20 },
  { id: "old", title: "An older session", createdAt: 10 },
]

describe("visibleTabs", () => {
  test("keeps the selected older tab visible when the strip has room", () => {
    const result = visibleTabs(entries, "old", 420, { new: 100, middle: 100, old: 100 })

    expect(result.visible).toContain("old")
    expect(result.overflow).not.toContain("old")
  })

  test("moves whole tabs to overflow at narrow widths", () => {
    const result = visibleTabs(entries, "new", 220, { new: 100, middle: 100, old: 100 })

    expect(result.visible.length).toBeLessThan(3)
    expect([...result.visible, ...result.overflow]).toEqual(["new", "middle", "old"])
  })

  test("uses stable newest-first order for equal creation times and Unicode titles", () => {
    const result = visibleTabs(
      [
        { id: "b", title: "東京のセッション", createdAt: 10 },
        { id: "a", title: "A very long session title", createdAt: 10 },
      ],
      "a",
      420,
      { a: 180, b: 160 },
    )

    expect(result.visible).toEqual(["a", "b"])
  })

  test("uses raw ID ordering rather than locale collation", () => {
    const result = visibleTabs(
      [
        { id: "Z", title: "Z", createdAt: 10 },
        { id: "a", title: "a", createdAt: 10 },
      ],
      undefined,
      420,
      { Z: 100, a: 100 },
    )

    expect(result.visible).toEqual(["Z", "a"])
  })

  test("measures the first 16 graphemes with the supplied tab font", () => {
    expect(measureTabMinimum("👩‍💻 alpha beta gamma", "16px serif", (text, font) => text.length + font.length)).toBe(96)
  })
})
