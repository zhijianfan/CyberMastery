import { describe, expect } from "bun:test"
import { Credential } from "@opencode-ai/core/credential"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Integration } from "@opencode-ai/core/integration"
import { Effect } from "effect"
import { Auth } from "../../src/auth"
import { sessionContextReplacements } from "../../src/effect/session-context"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Auth.node, Credential.node]), sessionContextReplacements))

describe("chat credential composition", () => {
  it.effect("exposes the connected ChatGPT account to V2 chat sessions", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      yield* auth.set("openai", {
        type: "oauth",
        access: "chatgpt-access",
        refresh: "chatgpt-refresh",
        expires: 4_000_000_000_000,
        accountId: "chatgpt-account",
      })

      const connected = yield* credentials.list(Integration.ID.make("openai"))
      expect(connected).toHaveLength(1)
      expect(connected[0].value).toMatchObject({
        type: "oauth",
        access: "chatgpt-access",
        metadata: { accountID: "chatgpt-account" },
      })
    }),
  )
})
