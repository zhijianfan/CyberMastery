import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { Prompt } from "./prompt-state"
import { createPromptState, DEFAULT_PROMPT, isPromptEqual } from "./prompt-state"

describe("prompt state initialization", () => {
  test("initializes prompt text, cursor, and model together", () => {
    createRoot((dispose) => {
      const model = { providerID: "anthropic", modelID: "claude", variant: "high" }
      const prompt = createPromptState({ prompt: "hello", model })

      expect(prompt.current()).toEqual([{ type: "text", content: "hello", start: 0, end: 5 }])
      expect(prompt.cursor()).toBe(5)
      expect(prompt.model.current()).toEqual(model)
      expect(prompt.model.current()).not.toBe(model)
      dispose()
    })
  })

  test("uses the default prompt without initial values", () => {
    createRoot((dispose) => {
      const prompt = createPromptState()

      expect(prompt.current()).toEqual(DEFAULT_PROMPT)
      expect(prompt.cursor()).toBeUndefined()
      expect(prompt.model.current()).toBeUndefined()
      dispose()
    })
  })

  test("compares skill parts by name and content hash", () => {
    const first: Prompt = [
      { type: "skill", name: "review", contentHash: "hash-a", content: "@review", start: 0, end: 7 },
    ]
    const same: Prompt = [
      { type: "skill", name: "review", contentHash: "hash-a", content: "@review", start: 3, end: 10 },
    ]
    const changed: Prompt = [
      { type: "skill", name: "review", contentHash: "hash-b", content: "@review", start: 0, end: 7 },
    ]

    expect(isPromptEqual(first, same)).toBeTrue()
    expect(isPromptEqual(first, changed)).toBeFalse()
  })
})
