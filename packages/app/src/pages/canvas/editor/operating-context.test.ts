import { describe, expect, test } from "bun:test"
import {
  OPERATING_CONTEXT_LIMIT,
  appendExchange,
  compactSummary,
  defaultOperatingLayers,
  type OperatingExchange,
} from "./operating-context"

function exchange(index: number, role: "user" | "assistant" = "assistant"): OperatingExchange {
  return { index, role, text: `turn ${index}`, at: 1000 + index }
}

describe("defaultOperatingLayers", () => {
  test("builds the OperatingContext stack in spec order", () => {
    const layers = defaultOperatingLayers()
    expect(layers.map((layer) => layer.layer)).toEqual(["workspace", "block", "operational", "custom"])
    expect(layers[1]?.text).toContain("OperatingChatSession")
  })
})

describe("appendExchange", () => {
  test("appends indexed exchanges while under the context limit", () => {
    const history = appendExchange([], { role: "user", text: "hello", at: 5 })
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ index: 1, role: "user", text: "hello", at: 5 })
    const next = appendExchange(history, { role: "assistant", text: "hi" })
    expect(next[1]).toMatchObject({ index: 2, role: "assistant", text: "hi" })
  })

  test("compacts the oldest exchanges once the limit is reached", () => {
    let history: OperatingExchange[] = []
    for (let index = 0; index < OPERATING_CONTEXT_LIMIT; index++) {
      history = appendExchange(history, { role: "assistant", text: `turn ${index}` })
    }
    history = appendExchange(history, { role: "user", text: "overflow", at: 9999 })
    expect(history).toHaveLength(OPERATING_CONTEXT_LIMIT)
    expect(history[0]?.text).toContain("[compacted]")
    expect(history.at(-1)).toMatchObject({ index: OPERATING_CONTEXT_LIMIT + 1, text: "overflow", at: 9999 })
  })

  test("keeps exchange indices monotonic across compactions", () => {
    let history: OperatingExchange[] = []
    for (let index = 0; index < OPERATING_CONTEXT_LIMIT + 6; index++) {
      history = appendExchange(history, { role: "assistant", text: `turn ${index}` })
    }
    const indices = history.map((entry) => entry.index)
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1])
    }
  })
})

describe("compactSummary", () => {
  test("wraps the dropped exchanges into one compacted record", () => {
    const summary = compactSummary([exchange(1, "user"), exchange(2)], 5000)
    expect(summary.role).toBe("assistant")
    expect(summary.text).toBe("[compacted] user: turn 1 assistant: turn 2")
    expect(summary.at).toBe(5000)
    expect(summary.index).toBe(1)
  })
})
