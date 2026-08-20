import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { Workspace } from "@opencode-ai/schema/workspace"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, WorkspaceService.node])))

const tuple = Workspace.Layout.Tuple.make({ user: "test", style: "default", deviceClass: "desktop" })

function makeBlocks(id: string): readonly Workspace.Block.Record[] {
  return [
    Workspace.Block.Record.make({ id: "block-1", functionality: "builtin:chat", transform: { x: 0, y: 0, w: 4, h: 4, z: 0 } }),
    Workspace.Block.Record.make({ id, functionality: "builtin:chat", transform: { x: 8, y: 0, w: 4, h: 4, z: 0 } }),
  ]
}

describe("layout authority handover", () => {
  it.effect("get claims authority and save from the holder succeeds", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "handover" })
      const initial = yield* workspace.layout.get(info.id, tuple, "client-a")
      expect(initial.revision).toBe(0)
      const saved = yield* workspace.layout.save(info.id, tuple, makeBlocks("a"), initial.revision, "client-a")
      expect(saved.revision).toBe(1)
      expect(saved.blocks.map((block) => block.id)).toEqual(["block-1", "a"])
    }),
  )

  it.effect("a client that pulls last owns the layout; the previous holder is handed over", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "handover-2" })

      const first = yield* workspace.layout.get(info.id, tuple, "client-a")
      const saved = yield* workspace.layout.save(info.id, tuple, makeBlocks("a"), first.revision, "client-a")
      expect(saved.revision).toBe(1)

      // client-b connects: authority is handed over.
      const pulled = yield* workspace.layout.get(info.id, tuple, "client-b")
      expect(pulled.revision).toBe(1)

      // The stale holder's save is rejected as handed-over with the current revision.
      const handedOver = yield* workspace.layout
        .save(info.id, tuple, makeBlocks("stale"), 1, "client-a")
        .pipe(Effect.flip)
      expect(handedOver._tag).toBe("Workspace.LayoutHandedOverError")
      if (handedOver._tag === "Workspace.LayoutHandedOverError") {
        expect(handedOver.currentRevision).toBe(1)
      }

      // The current holder can save.
      const savedByB = yield* workspace.layout.save(info.id, tuple, makeBlocks("b"), 1, "client-b")
      expect(savedByB.revision).toBe(2)
    }),
  )

  it.effect("revision conflicts still reject same-holder stale saves", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "handover-3" })

      const first = yield* workspace.layout.get(info.id, tuple, "client-a")
      yield* workspace.layout.save(info.id, tuple, makeBlocks("a"), first.revision, "client-a")

      const conflict = yield* workspace.layout
        .save(info.id, tuple, makeBlocks("stale"), 0, "client-a")
        .pipe(Effect.flip)
      expect(conflict._tag).toBe("Workspace.LayoutConflictError")
      if (conflict._tag === "Workspace.LayoutConflictError") {
        expect(conflict.currentRevision).toBe(1)
      }
    }),
  )
})
