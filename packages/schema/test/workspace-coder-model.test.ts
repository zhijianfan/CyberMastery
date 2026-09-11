import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Workspace } from "../src/workspace"

const base = {
  id: Workspace.ID.ascending("wrk_test01"),
  name: "n",
  style: "s",
  directories: [],
  pluginIDs: [],
  skillIDs: [],
  git: [],
  time: { created: 0, updated: 0 },
}

describe("Workspace.Info coderModel decode", () => {
  test("accepts an explicit null (cleared coder model)", () => {
    const info = Schema.decodeUnknownSync(Workspace.Info)({ ...base, coderModel: null })

    expect(info.coderModel).toBeNull()
  })

  test("decodes a concrete model selection", () => {
    const info = Schema.decodeUnknownSync(Workspace.Info)({
      ...base,
      coderModel: "anthropic/claude-sonnet-4",
    })

    expect(info.coderModel).toBe("anthropic/claude-sonnet-4")
  })

  test("decodes rows predating the field as undefined", () => {
    const info = Schema.decodeUnknownSync(Workspace.Info)(base)

    expect(info.coderModel).toBeUndefined()
  })
})

describe("Workspace.Info coderModel encode round-trip", () => {
  test("round-trips an explicit null", () => {
    const decoded = Schema.decodeUnknownSync(Workspace.Info)({ ...base, coderModel: null })
    const encoded = Schema.encodeSync(Workspace.Info)(decoded)

    expect(encoded.coderModel).toBeNull()
  })

  test("round-trips a concrete model selection", () => {
    const decoded = Schema.decodeUnknownSync(Workspace.Info)({
      ...base,
      coderModel: "anthropic/claude-sonnet-4",
    })
    const encoded = Schema.encodeSync(Workspace.Info)(decoded)

    expect(encoded.coderModel).toBe("anthropic/claude-sonnet-4")
  })

  test("omits an absent coderModel instead of encoding null", () => {
    const encoded = Schema.encodeSync(Workspace.Info)({ ...base, coderModel: undefined })

    expect("coderModel" in encoded).toBe(false)
  })

  test("keeps omitted distinct from explicit null on the wire", () => {
    const omitted = Schema.encodeSync(Workspace.Info)({ ...base, coderModel: undefined })
    const cleared = Schema.encodeSync(Workspace.Info)({ ...base, coderModel: null })

    expect("coderModel" in omitted).toBe(false)
    expect(cleared.coderModel).toBeNull()
  })
})

describe("Workspace.ModelSelection", () => {
  test("round-trips model IDs containing colons with a variant", () => {
    const selection = { providerID: "ollama-cloud", modelID: "gpt-oss:120b", variant: "high" }
    const encoded = Workspace.ModelSelection.encode(selection)

    expect(encoded).toBe("ollama-cloud:gpt-oss%3A120b:high")
    expect(Workspace.ModelSelection.decode(encoded)).toEqual(selection)
  })

  test("keeps ordinary model keys backward compatible", () => {
    expect(Workspace.ModelSelection.encode({ providerID: "openai", modelID: "gpt-5" })).toBe("openai:gpt-5")
    expect(Workspace.ModelSelection.decode("openai:gpt-5:high")).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
      variant: "high",
    })
  })

  test("decodes legacy slash keys at the first separator", () => {
    expect(Workspace.ModelSelection.decode("ollama-cloud/gpt-oss:120b")).toEqual({
      providerID: "ollama-cloud",
      modelID: "gpt-oss:120b",
    })
    expect(Workspace.ModelSelection.decode("openrouter/meta-llama/llama-3.3")).toEqual({
      providerID: "openrouter",
      modelID: "meta-llama/llama-3.3",
    })
  })
})
