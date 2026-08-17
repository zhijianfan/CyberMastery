import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { FunctionalityInstance } from "@opencode-ai/core/workspace/functionality-instance"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, WorkspaceService.node, FunctionalityInstance.node])),
)

describe("master-agent migration and instance storage", () => {
  it.effect("functionality instances persist and round-trip configuration", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const instances = yield* FunctionalityInstance.Service
      const info = yield* workspace.create({ name: "ma-migration" })
      const created = yield* instances.upsert({
        workspaceID: info.id,
        blockID: "block-a",
        functionalityID: "builtin:master-agent",
        configuration: {
          version: 1,
          directoryBinding: { mode: "workspace-primary" },
          sessionBinding: null,
        },
      })
      expect(created.revision).toBe(0)
      const loaded = yield* instances.get(info.id, "block-a", "builtin:master-agent")
      expect(loaded?.configuration).toEqual(created.configuration)
    }),
  )

  it.effect("upsert bumps the revision and preserves the instance id", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const instances = yield* FunctionalityInstance.Service
      const info = yield* workspace.create({ name: "ma-migration-2" })
      const first = yield* instances.upsert({
        workspaceID: info.id,
        blockID: "block-a",
        functionalityID: "builtin:master-agent",
        configuration: { version: 1, directoryBinding: { mode: "workspace-primary" }, sessionBinding: null },
      })
      const second = yield* instances.upsert({
        workspaceID: info.id,
        blockID: "block-a",
        functionalityID: "builtin:master-agent",
        configuration: { version: 1, directoryBinding: { mode: "fixed", directory: "/repo" }, sessionBinding: null },
      })
      expect(second.id).toBe(first.id)
      expect(second.revision).toBe(1)
      const loaded = yield* instances.get(info.id, "block-a", "builtin:master-agent")
      expect(loaded?.revision).toBe(1)
    }),
  )

  it.effect("different blocks keep independent instances", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const instances = yield* FunctionalityInstance.Service
      const info = yield* workspace.create({ name: "ma-migration-3" })
      yield* instances.upsert({
        workspaceID: info.id,
        blockID: "block-a",
        functionalityID: "builtin:master-agent",
        configuration: { version: 1, directoryBinding: { mode: "workspace-primary" }, sessionBinding: null },
      })
      yield* instances.upsert({
        workspaceID: info.id,
        blockID: "block-b",
        functionalityID: "builtin:master-agent",
        configuration: { version: 1, directoryBinding: { mode: "workspace-primary" }, sessionBinding: null },
      })
      const a = yield* instances.get(info.id, "block-a", "builtin:master-agent")
      const b = yield* instances.get(info.id, "block-b", "builtin:master-agent")
      expect(a?.id).not.toBe(b?.id)
    }),
  )
})
