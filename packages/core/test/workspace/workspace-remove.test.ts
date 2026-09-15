import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { Workspace } from "@opencode-ai/schema/workspace"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, WorkspaceService.node])))

describe("workspace removal", () => {
  it.effect("rejects existing and missing workspaces before lookup or deletion", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "protected" })

      expect(yield* workspace.remove(info.id).pipe(Effect.flip)).toBeInstanceOf(
        WorkspaceService.WorkspaceRemovalUnsupportedError,
      )
      expect(yield* workspace.remove(Workspace.ID.make("wrk_missing")).pipe(Effect.flip)).toBeInstanceOf(
        WorkspaceService.WorkspaceRemovalUnsupportedError,
      )
      expect((yield* workspace.get(info.id)).id).toBe(info.id)
    }),
  )
})
