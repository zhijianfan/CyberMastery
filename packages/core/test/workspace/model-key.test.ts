import { describe, expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelKey } from "@opencode-ai/core/workspace/model-key"

describe("workspace model key", () => {
  test("decodes provider, slash-containing model ID, and optional variant", () => {
    expect(ModelKey.decode("openai:gpt-5.3-codex/spark:reasoning")).toEqual(
      ModelV2.Ref.make({
        providerID: ProviderV2.ID.make("openai"),
        id: ModelV2.ID.make("gpt-5.3-codex/spark"),
        variant: ModelV2.VariantID.make("reasoning"),
      }),
    )
    expect(ModelKey.decode("openai:gpt-5.3-codex/spark")).toEqual(
      ModelV2.Ref.make({
        providerID: ProviderV2.ID.make("openai"),
        id: ModelV2.ID.make("gpt-5.3-codex/spark"),
      }),
    )
  })

  test("rejects missing, empty, and extra key segments", () => {
    for (const value of [undefined, "", "openai", ":model", "openai:", "openai:model:", "a:b:c:d"]) {
      expect(ModelKey.decode(value)).toBeUndefined()
    }
  })
})
