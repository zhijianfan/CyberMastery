import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CanvasTabService } from "@opencode-ai/core/workspace/canvas-tab"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { CanvasTabTable } from "@opencode-ai/core/workspace/sql"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, WorkspaceService.node, CanvasTabService.node])),
)

describe("canvas tab registry", () => {
  it.effect("pages archived tabs by creation and stable identity within one workspace and kind", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const tabs = yield* CanvasTabService.Service
      const current = yield* workspace.create({ name: "canvas-tab-page" })
      const other = yield* workspace.create({ name: "canvas-tab-page-other" })

      yield* database.db
        .insert(CanvasTabTable)
        .values([
          {
            id: "a-older-id",
            workspace_id: current.id,
            kind: "master-agent",
            conversation_id: "older-conversation",
            origin_block_id: "block-old",
            owner_block_id: null,
            title: "Alpha older",
            time_created: 10,
            time_archived: 20,
            snapshot: null,
          },
          {
            id: "z-newer-id",
            workspace_id: current.id,
            kind: "master-agent",
            conversation_id: "newer-conversation",
            origin_block_id: "block-new",
            owner_block_id: null,
            title: "Alpha newer",
            time_created: 10,
            time_archived: 30,
            snapshot: null,
          },
          {
            id: "other-id",
            workspace_id: other.id,
            kind: "master-agent",
            conversation_id: "other-conversation",
            origin_block_id: "other-block",
            owner_block_id: null,
            title: "Alpha other workspace",
            time_created: 10,
            time_archived: 40,
            snapshot: null,
          },
          {
            id: "other-kind-id",
            workspace_id: current.id,
            kind: "operating-chat",
            conversation_id: "other-kind-conversation",
            origin_block_id: "other-kind-block",
            owner_block_id: null,
            title: "Alpha other kind",
            time_created: 10,
            time_archived: 50,
            snapshot: null,
          },
        ])
        .run()

      const page = yield* tabs.listArchived(current.id, "master-agent", "alpha", undefined, 2)
      expect(page.items.map((item) => item.id)).toEqual(["z-newer-id", "a-older-id"])
      expect(page.next).toEqual({ createdAt: 10, id: "a-older-id" })
      expect(page.items.every((item) => item.workspaceID === current.id)).toBe(true)
      expect(page.items.every((item) => item.kind === "master-agent")).toBe(true)
      expect((yield* tabs.listArchived(current.id, "master-agent", "alpha", page.next, 2)).items).toEqual([])
    }),
  )

  it.effect("enroll is idempotent and keeps a single owner for a conversation", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "canvas-tab-enroll" })

      const first = yield* tabs.enroll(info.id, "master-agent", "block-1", "session-1", "First", 10)
      const again = yield* tabs.enroll(info.id, "master-agent", "block-1", "session-1", "First", 10)
      expect(again.id).toBe(first.id)
      expect((yield* tabs.listOwned(info.id, "master-agent", "block-1", undefined, 10)).items).toHaveLength(1)

      const error = yield* tabs.enroll(info.id, "master-agent", "block-2", "session-1", "First", 10).pipe(Effect.flip)
      expect(error._tag).toBe("CanvasTab.BusyError")
    }),
  )

  it.effect("add and select use the block revision as a compare-and-swap guard", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "canvas-tab-cas" })

      yield* tabs.enroll(info.id, "master-agent", "block-1", "session-1", "First", 10)
      const added = yield* tabs.add(
        {
          workspaceID: info.id,
          kind: "master-agent",
          blockID: "block-1",
          conversationID: "session-2",
          title: "Second",
          createdAt: 20,
        },
        0,
        "request-2",
      )
      expect(added.revision).toBe(1)
      expect(added.selected.id).toBe("request-2")
      const retried = yield* tabs.add(
        {
          workspaceID: info.id,
          kind: "master-agent",
          blockID: "block-1",
          conversationID: "session-2",
          title: "Second",
          createdAt: 20,
        },
        0,
        "request-2",
      )
      expect(retried).toEqual(added)

      const stale = yield* tabs
        .add(
          {
            workspaceID: info.id,
            kind: "master-agent",
            blockID: "block-1",
            conversationID: "session-3",
            title: "Third",
            createdAt: 30,
          },
          0,
          "request-3",
        )
        .pipe(Effect.flip)
      expect(stale._tag).toBe("CanvasTab.StaleRevisionError")

      const first = (yield* tabs.listOwned(info.id, "master-agent", "block-1", undefined, 10)).items.find(
        (item) => item.conversationID === "session-1",
      )!
      const selected = yield* tabs.select(
        { workspaceID: info.id, kind: "master-agent", blockID: "block-1", tabID: first.id },
        added.revision,
      )
      expect(selected.revision).toBe(added.revision + 1)
      expect(selected.selected.id).toBe(first.id)
    }),
  )

  it.effect("archive fences a block and restore transfers an archived tab", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "canvas-tab-restore" })

      yield* tabs.enroll(info.id, "master-agent", "block-1", "session-1", "First", 10)
      const archived = yield* tabs.archiveBlock({ workspaceID: info.id, kind: "master-agent", blockID: "block-1" }, 0)
      expect(archived.revision).toBe(1)
      expect(archived.archivedCount).toBe(1)

      const deleted = yield* tabs
        .enroll(info.id, "master-agent", "block-1", "session-2", "Second", 20)
        .pipe(Effect.flip)
      expect(deleted._tag).toBe("CanvasTab.DeletedBlockError")

      yield* tabs.enroll(info.id, "master-agent", "block-2", "session-2", "Second", 20)
      const archivedPage = yield* tabs.listArchived(info.id, "master-agent", "first", undefined, 10)
      const restored = yield* tabs.restore(
        { workspaceID: info.id, kind: "master-agent", blockID: "block-2", tabID: archivedPage.items[0]!.id },
        0,
      )
      expect(restored.revision).toBe(1)
      expect(restored.selected.id).toBe(archivedPage.items[0]!.id)
      expect((yield* tabs.listArchived(info.id, "master-agent", "first", undefined, 10)).items).toHaveLength(0)
      expect((yield* tabs.listOwned(info.id, "master-agent", "block-2", undefined, 10)).items).toHaveLength(2)
    }),
  )

  it.effect("rejects selecting a tab through the wrong kind", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "canvas-tab-kind" })
      const entry = yield* tabs.enroll(info.id, "master-agent", "block-1", "session-1", "First", 10)

      const error = yield* tabs
        .select({ workspaceID: info.id, kind: "operating-chat", blockID: "block-1", tabID: entry.id }, 0)
        .pipe(Effect.flip)
      expect(error._tag).toBe("CanvasTab.WrongKindError")
    }),
  )
})
