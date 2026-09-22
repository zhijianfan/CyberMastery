import { describe, expect, test } from "bun:test"
import { visibleTabs } from "./canvas-tab-layout"

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
})
