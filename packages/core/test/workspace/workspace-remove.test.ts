import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { Workspace } from "@opencode-ai/schema/workspace"
import { LayoutTable, WorkspaceV2Table } from "@opencode-ai/core/workspace/sql"
import { eq } from "drizzle-orm"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, WorkspaceService.node])))

describe("workspace archive", () => {
  it.effect("hides an archived workspace without erasing its durable layout or context", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const database = yield* Database.Service
      const info = yield* workspace.create({ name: "protected", user: "owner" })
      const other = yield* workspace.create({ name: "other", user: "owner" })
      const tuple = Workspace.Layout.Tuple.make({ user: "owner", style: "default", deviceClass: "desktop" })
      const layout = yield* workspace.layout.get(info.id, tuple, "archive-test")

      expect(yield* workspace.remove(info.id, "stranger").pipe(Effect.flip)).toBeInstanceOf(
        WorkspaceService.WorkspaceNotFoundError,
      )
      expect((yield* workspace.get(info.id, "owner")).id).toBe(info.id)
      yield* workspace.remove(info.id, "owner")
      expect((yield* workspace.list("owner")).map((item) => item.id)).toEqual([other.id])
      expect(yield* workspace.get(info.id, "owner").pipe(Effect.flip)).toBeInstanceOf(
        WorkspaceService.WorkspaceNotFoundError,
      )
      expect(yield* workspace.layout.get(info.id, tuple, "archive-test").pipe(Effect.flip)).toBeInstanceOf(
        WorkspaceService.WorkspaceNotFoundError,
      )
      expect(yield* workspace.remove(info.id, "owner").pipe(Effect.flip)).toBeInstanceOf(
        WorkspaceService.WorkspaceNotFoundError,
      )
      expect(yield* workspace.remove(Workspace.ID.make("wrk_missing"), "owner").pipe(Effect.flip)).toBeInstanceOf(
        WorkspaceService.WorkspaceNotFoundError,
      )
      expect((yield* workspace.get(info.id)).name).toBe("protected")
      expect(
        (yield* database.db.select().from(WorkspaceV2Table).where(eq(WorkspaceV2Table.id, info.id)).get())
          ?.time_deleted,
      ).toBeNumber()
      expect((yield* database.db.select().from(LayoutTable).where(eq(LayoutTable.id, layout.id)).get())?.id).toBe(
        layout.id,
      )
    }),
  )
})
