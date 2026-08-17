import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, WorkspaceService.node])))

describe("workspace coderModel persistence", () => {
  it.effect("new workspaces read coderModel as null", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "coder" })
      expect(info.coderModel).toBeUndefined()
    }),
  )

  it.effect("patch sets a coder model and persists across reads", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "coder-2" })
      const updated = yield* workspace.update(info.id, { coderModel: "anthropic/claude-haiku" })
      expect(updated.coderModel).toBe("anthropic/claude-haiku")
      const fetched = yield* workspace.get(info.id)
      expect(fetched?.coderModel).toBe("anthropic/claude-haiku")
      expect(fetched?.model).toBeUndefined()
    }),
  )

  it.effect("patch back to null disables coder routing", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "coder-3" })
      yield* workspace.update(info.id, { coderModel: "anthropic/claude-haiku" })
      const cleared = yield* workspace.update(info.id, { coderModel: "" })
      expect(cleared.coderModel).toBeUndefined()
    }),
  )

  it.effect("other workspace fields survive a coderModel patch", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "coder-4" })
      const patched = yield* workspace.update(info.id, { name: "renamed", coderModel: "openai/gpt-4o-mini" })
      expect(patched.name).toBe("renamed")
      expect(patched.coderModel).toBe("openai/gpt-4o-mini")
    }),
  )
})
