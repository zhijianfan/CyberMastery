import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { LayoutAuthorityTable, LayoutOptionTable, LayoutTable, WorkspaceV2Table } from "@opencode-ai/core/workspace/sql"
import { Workspace } from "@opencode-ai/schema/workspace"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, WorkspaceService.node])))

const tuple = Workspace.Layout.Tuple.make({ user: "test", style: "default", deviceClass: "desktop" })

function makeBlocks(id: string): readonly Workspace.Block.Record[] {
  return [
    Workspace.Block.Record.make({
      id: "block-1",
      functionality: "builtin:chat",
      transform: { x: 0, y: 0, w: 4, h: 4, z: 0 },
    }),
    Workspace.Block.Record.make({ id, functionality: "builtin:chat", transform: { x: 8, y: 0, w: 4, h: 4, z: 0 } }),
  ]
}

describe("layout authority handover", () => {
  it.effect("stores an omitted user as the reserved default identity", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "anonymous" })

      expect((yield* workspace.list()).map((item) => item.id)).toContain(info.id)
      expect((yield* workspace.list("default")).map((item) => item.id)).toContain(info.id)
      expect((yield* workspace.get(info.id, "default")).id).toBe(info.id)
    }),
  )

  it.effect("adopts an authenticated legacy workspace and normalizes spoofed tuple owners", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const { db } = yield* Database.Service
      const workspaceID = Workspace.ID.make("wrk_legacy_authenticated")
      yield* db
        .insert(WorkspaceV2Table)
        .values({
          id: workspaceID,
          name: "legacy authenticated",
          style: "default",
          directories: [],
          plugin_ids: [],
          skill_ids: [],
          user: "",
          time_created: 1,
          time_updated: 1,
        })
        .run()
      yield* db
        .insert(LayoutTable)
        .values([
          { id: "layout-legacy-a", workspace_id: workspaceID, revision: 0, blocks: [], time_updated: 1 },
          { id: "layout-legacy-z", workspace_id: workspaceID, revision: 0, blocks: [], time_updated: 2 },
        ])
        .run()
      yield* db
        .insert(LayoutOptionTable)
        .values([
          {
            workspace_id: workspaceID,
            user: "mallory",
            style: "default",
            device_class: "desktop",
            layout_id: "layout-legacy-z",
          },
          {
            workspace_id: workspaceID,
            user: "",
            style: "default",
            device_class: "desktop",
            layout_id: "layout-legacy-a",
          },
        ])
        .run()
      yield* db
        .insert(LayoutAuthorityTable)
        .values([
          {
            workspace_id: workspaceID,
            user: "",
            style: "default",
            device_class: "desktop",
            holder_id: "legacy-holder",
            held_at: 1,
          },
          {
            workspace_id: workspaceID,
            user: "mallory",
            style: "default",
            device_class: "desktop",
            holder_id: "spoofed-holder",
            held_at: 2,
          },
        ])
        .run()

      expect((yield* workspace.list("alice")).map((item) => item.id)).toContain(workspaceID)
      expect(
        yield* db
          .select({ user: WorkspaceV2Table.user })
          .from(WorkspaceV2Table)
          .where(eq(WorkspaceV2Table.id, workspaceID))
          .get(),
      ).toEqual({ user: "alice" })
      expect(
        yield* db
          .select({ user: LayoutOptionTable.user, layoutID: LayoutOptionTable.layout_id })
          .from(LayoutOptionTable)
          .where(eq(LayoutOptionTable.workspace_id, workspaceID))
          .all(),
      ).toEqual([{ user: "alice", layoutID: "layout-legacy-a" }])
      expect(
        yield* db
          .select({ user: LayoutAuthorityTable.user, holderID: LayoutAuthorityTable.holder_id })
          .from(LayoutAuthorityTable)
          .where(eq(LayoutAuthorityTable.workspace_id, workspaceID))
          .all(),
      ).toEqual([{ user: "alice", holderID: "spoofed-holder" }])
      expect(
        (yield* workspace.layout.get(
          workspaceID,
          { user: "alice", style: "default", deviceClass: "desktop" },
          "client-a",
        )).id,
      ).toBe("layout-legacy-a")
      expect((yield* workspace.get(workspaceID, "mallory").pipe(Effect.flip))._tag).toBe("Workspace.NotFoundError")
    }),
  )

  it.effect("allows only one concurrent identity to adopt a legacy workspace", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const { db } = yield* Database.Service
      const workspaceID = Workspace.ID.make("wrk_legacy_concurrent")
      yield* db
        .insert(WorkspaceV2Table)
        .values({
          id: workspaceID,
          name: "legacy concurrent",
          style: "default",
          directories: [],
          plugin_ids: [],
          skill_ids: [],
          user: "",
          time_created: 1,
          time_updated: 1,
        })
        .run()
      yield* db
        .insert(LayoutTable)
        .values({ id: "layout-legacy-concurrent", workspace_id: workspaceID, revision: 0, blocks: [], time_updated: 1 })
        .run()
      yield* db
        .insert(LayoutOptionTable)
        .values({
          workspace_id: workspaceID,
          user: "mallory",
          style: "default",
          device_class: "desktop",
          layout_id: "layout-legacy-concurrent",
        })
        .run()

      const winners = yield* Effect.all(
        ["alice", "bob"].map((user) =>
          workspace.get(workspaceID, user).pipe(Effect.match({ onFailure: () => false, onSuccess: () => true })),
        ),
        { concurrency: "unbounded" },
      )
      const owner = yield* db
        .select({ user: WorkspaceV2Table.user })
        .from(WorkspaceV2Table)
        .where(eq(WorkspaceV2Table.id, workspaceID))
        .get()

      expect(winners.filter(Boolean)).toHaveLength(1)
      expect(owner).toBeDefined()
      expect(["alice", "bob"]).toContain(owner!.user)
      expect(
        yield* db
          .select({ user: LayoutOptionTable.user })
          .from(LayoutOptionTable)
          .where(eq(LayoutOptionTable.workspace_id, workspaceID))
          .all(),
      ).toEqual([{ user: owner!.user }])
    }),
  )

  it.effect("creates an empty default layout", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "canonical-default", user: tuple.user })

      expect((yield* workspace.layout.get(info.id, tuple, "client-a")).blocks).toEqual([])
    }),
  )

  it.effect("rejects an undersized chat block", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "undersized-chat", user: tuple.user })
      const initial = yield* workspace.layout.get(info.id, tuple, "client-a")
      const error = yield* workspace.layout
        .save(
          info.id,
          tuple,
          [
            Workspace.Block.Record.make({
              id: "small-chat",
              functionality: "builtin:chat",
              transform: { x: 0, y: 0, w: 1, h: 1, z: 0 },
            }),
          ],
          initial.revision,
          "client-a",
        )
        .pipe(Effect.flip)

      expect(error._tag).toBe("Workspace.InvalidLayoutError")
    }),
  )

  it.effect("block lookup ignores layouts with no active option", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const { db } = yield* Database.Service
      const info = yield* workspace.create({ name: "active-blocks", user: tuple.user })
      yield* workspace.layout.get(info.id, tuple, "client-a")
      yield* db
        .insert(LayoutTable)
        .values({
          id: "orphan-layout",
          workspace_id: info.id,
          revision: 0,
          blocks: [
            Workspace.Block.Record.make({
              id: "orphan-block",
              functionality: "builtin:chat-relay",
              transform: { x: 0, y: 0, w: 4, h: 4, z: 0 },
            }),
          ],
          time_updated: Date.now(),
        })
        .run()

      expect(yield* workspace.block.get(info.id, "orphan-block")).toBeUndefined()
    }),
  )

  it.effect("get claims authority and save from the holder succeeds", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "handover", user: tuple.user })
      const initial = yield* workspace.layout.get(info.id, tuple, "client-a")
      expect(initial.revision).toBe(0)
      const saved = yield* workspace.layout.save(info.id, tuple, makeBlocks("a"), initial.revision, "client-a")
      expect(saved.revision).toBe(1)
      expect(saved.blocks.map((block) => block.id)).toEqual(["block-1", "a"])
    }),
  )

  it.effect("saves and reloads blocks moved left and above the canvas origin", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "negative-coordinates", user: tuple.user })
      const initial = yield* workspace.layout.get(info.id, tuple, "client-a")
      const block = Workspace.Block.Record.make({
        id: "moved-block",
        functionality: "builtin:notes",
        transform: { x: -144, y: -352, w: 248, h: 124, z: 1 },
      })

      const saved = yield* workspace.layout.save(info.id, tuple, [block], initial.revision, "client-a")
      const restored = yield* workspace.layout.get(info.id, tuple, "client-a")
      expect(saved.blocks).toEqual([block])
      expect(restored.blocks).toEqual([block])
      expect(restored.revision).toBe(initial.revision + 1)
    }),
  )

  it.effect("a client that pulls last owns the layout; the previous holder is handed over", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "handover-2", user: tuple.user })

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
      const info = yield* workspace.create({ name: "handover-3", user: tuple.user })

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

  it.effect("rejects unknown functionality, invalid size, and duplicate block IDs", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "validated-layout", user: tuple.user })
      const initial = yield* workspace.layout.get(info.id, tuple, "client-a")

      const unknown = yield* workspace.layout
        .save(
          info.id,
          tuple,
          [
            Workspace.Block.Record.make({
              id: "unknown",
              functionality: "plugin:missing",
              transform: { x: 0, y: 0, w: 4, h: 4, z: 0 },
            }),
          ],
          initial.revision,
          "client-a",
        )
        .pipe(Effect.flip)
      expect(unknown._tag).toBe("Workspace.InvalidLayoutError")

      const invalidSize = yield* workspace.layout
        .save(
          info.id,
          tuple,
          [
            Workspace.Block.Record.make({
              id: "small",
              functionality: "builtin:notes",
              transform: { x: 0, y: 0, w: 1, h: 1, z: 0 },
            }),
          ],
          initial.revision,
          "client-a",
        )
        .pipe(Effect.flip)
      expect(invalidSize._tag).toBe("Workspace.InvalidLayoutError")

      const duplicate = yield* workspace.layout
        .save(info.id, tuple, makeBlocks("block-1"), initial.revision, "client-a")
        .pipe(Effect.flip)
      expect(duplicate._tag).toBe("Workspace.InvalidLayoutError")
    }),
  )

  it.effect("lists built-ins and workspace-enabled plugin functionality", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "functionality-catalog", user: tuple.user })
      yield* workspace.update(info.id, { pluginIDs: ["plugin:diagram"] }, tuple.user)
      const catalog = yield* workspace.functionality.list(info.id, tuple.user)

      expect(catalog.some((item) => item.id === "builtin:chat" && item.kind === "builtin")).toBe(true)
      expect(catalog.some((item) => item.id === "plugin:diagram" && item.kind === "plugin")).toBe(true)
    }),
  )

  it.effect("offers Context Packs in the catalog and persists an added browser block", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "ctxpack-browser", user: tuple.user })
      const catalog = yield* workspace.functionality.list(info.id, tuple.user)

      expect(catalog.find((item) => item.id === "builtin:ctxpack-browser")).toMatchObject({
        kind: "builtin",
        label: "Context Packs",
      })

      const initial = yield* workspace.layout.get(info.id, tuple, "client-a")
      const block = Workspace.Block.Record.make({
        id: "context-packs",
        functionality: "builtin:ctxpack-browser",
        transform: { x: 0, y: 0, w: 5, h: 4, z: 1 },
      })
      yield* workspace.layout.save(info.id, tuple, [...initial.blocks, block], initial.revision, "client-a")

      const restored = yield* workspace.layout.get(info.id, tuple, "client-a")
      expect(restored.blocks).toContainEqual(block)
    }),
  )

  it.effect("scopes workspace reads and lists to the owning user", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const owned = yield* workspace.create({ name: "owned", user: "alice" })
      yield* workspace.create({ name: "other", user: "bob" })

      expect((yield* workspace.list("alice")).map((item) => item.id)).toContain(owned.id)
      const denied = yield* workspace.get(owned.id, "bob").pipe(Effect.flip)
      expect(denied._tag).toBe("Workspace.NotFoundError")
    }),
  )
})
