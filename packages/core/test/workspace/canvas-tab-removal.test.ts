import { describe, expect } from "bun:test"
import { and, eq, sql } from "drizzle-orm"
import { Effect, Exit } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { CanvasTabService } from "@opencode-ai/core/workspace/canvas-tab"
import { WorkspaceService } from "@opencode-ai/core/workspace/service"
import {
  CanvasTabBlockTable,
  CanvasTabTable,
  FunctionalityInstanceTable,
  LayoutOptionTable,
  LayoutTable,
} from "@opencode-ai/core/workspace/sql"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { Project } from "@opencode-ai/schema/project"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { CanvasTab } from "@opencode-ai/schema/canvas-tab"
import { Workspace } from "@opencode-ai/schema/workspace"
import { testEffect } from "../lib/effect"

const layer = AppNodeBuilder.build(
  LayerNode.group([Database.node, EventV2.node, SessionProjector.node, WorkspaceService.node, CanvasTabService.node]),
)

const it = testEffect(layer)
const tuple = Workspace.Layout.Tuple.make({ user: "", style: "default", deviceClass: "desktop" })

describe("workspace block removal", () => {
  it.effect("archives every owned tab and removes the block from every layout tuple atomically", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "remove-block" })
      const blockID = "block-remove"
      const firstSessionID = SessionSchema.ID.make("ses_remove_first")
      const secondSessionID = SessionSchema.ID.make("ses_remove_second")
      const now = Date.now()

      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make(process.cwd()), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values(
          [firstSessionID, secondSessionID].map((id) => ({
            id,
            runtime: "v2" as const,
            project_id: Project.ID.global,
            workspace_id: info.id,
            slug: id,
            directory: AbsolutePath.make(process.cwd()),
            title: id,
            version: "test",
            time_created: now,
            time_updated: now,
          })),
        )
        .run()
        .pipe(Effect.orDie)

      const firstLayout = yield* workspace.layout.get(info.id, tuple, "remove-client")
      const block = {
        id: blockID,
        functionality: "builtin:master-agent",
        transform: { x: 0, y: 0, w: 4, h: 4, z: 0 },
      }
      yield* workspace.layout.save(info.id, tuple, [block], firstLayout.revision, "remove-client")

      const secondLayoutID = crypto.randomUUID()
      yield* db
        .insert(LayoutTable)
        .values({
          id: secondLayoutID,
          workspace_id: info.id,
          revision: 1,
          blocks: [block],
          time_updated: now,
        })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(LayoutOptionTable)
        .values({
          workspace_id: info.id,
          user: "default",
          style: "default",
          device_class: "mobile",
          layout_id: secondLayoutID,
        })
        .run()
        .pipe(Effect.orDie)

      yield* db
        .insert(FunctionalityInstanceTable)
        .values({
          id: crypto.randomUUID(),
          workspace_id: info.id,
          block_id: blockID,
          functionality_id: "builtin:master-agent",
          revision: 0,
          configuration: {
            version: 1,
            directoryBinding: { mode: "workspace-primary" },
            sessionBinding: { mode: "owned", sessionID: secondSessionID, generation: 1 },
          },
          time_updated: now,
        })
        .run()
        .pipe(Effect.orDie)
      yield* tabs.enroll(info.id, "master-agent", blockID, firstSessionID, "First", now)
      yield* tabs.add(
        {
          workspaceID: info.id,
          kind: "master-agent",
          blockID,
          conversationID: secondSessionID,
          title: "Second",
          createdAt: now + 1,
        },
        0,
        "remove-second",
      )

      const notifications: string[] = []
      const observed: { owned: number; removed: boolean }[] = []
      const events = yield* EventV2.Service
      const unsubscribe = yield* events.listen((event) =>
        Effect.gen(function* () {
          notifications.push(event.type)
          observed.push({
            owned: (yield* tabs.listOwned(info.id, "master-agent", blockID, undefined, 10)).items.length,
            removed: (yield* workspace.block.get(info.id, blockID).pipe(Effect.orDie)) === undefined,
          })
        }),
      )

      const removed = yield* workspace.block.archiveAndRemove(
        info.id,
        blockID,
        "master-agent",
        tuple,
        1,
        "remove-client",
        "default",
      )
      expect(removed.archivedCount).toBe(2)
      expect(removed.layoutRevision).toBe(2)
      expect(removed.tabRevision).toBe(2)
      yield* unsubscribe
      expect(notifications.filter((type) => type === "workspace.layout.updated")).toHaveLength(2)
      expect(notifications).toContain("workspace.functionality.instance.changed")
      expect(observed).toHaveLength(5)
      expect(observed.every((snapshot) => snapshot.owned === 0 && snapshot.removed)).toBe(true)
      expect((yield* tabs.listArchived(info.id, "master-agent", "", undefined, 10)).items).toHaveLength(2)
      expect(yield* workspace.block.get(info.id, blockID)).toBeUndefined()
      expect(
        (yield* db
          .select({ archived: SessionTable.time_archived })
          .from(SessionTable)
          .where(eq(SessionTable.id, firstSessionID))
          .get())?.archived,
      ).not.toBeNull()
      expect(
        (yield* db
          .select({ archived: SessionTable.time_archived })
          .from(SessionTable)
          .where(eq(SessionTable.id, secondSessionID))
          .get())?.archived,
      ).not.toBeNull()

      const layouts = yield* db
        .select({ blocks: LayoutTable.blocks, revision: LayoutTable.revision })
        .from(LayoutTable)
        .where(eq(LayoutTable.workspace_id, info.id))
        .all()
      expect(layouts.every((layout) => !layout.blocks.some((item) => item.id === blockID))).toBe(true)
      expect(layouts.map((layout) => layout.revision).sort()).toEqual([2, 2])

      const fence = yield* db
        .select({ deleted: CanvasTabBlockTable.deleted_at })
        .from(CanvasTabBlockTable)
        .where(
          and(
            eq(CanvasTabBlockTable.workspace_id, info.id),
            eq(CanvasTabBlockTable.kind, "master-agent"),
            eq(CanvasTabBlockTable.block_id, blockID),
          ),
        )
        .get()
      expect(fence?.deleted).not.toBeNull()
      const instance = yield* db
        .select()
        .from(FunctionalityInstanceTable)
        .where(eq(FunctionalityInstanceTable.block_id, blockID))
        .get()
      expect(instance?.deleted_at).toBeNumber()
      expect(instance?.revision).toBe(1)

      const retry = yield* workspace.block.archiveAndRemove(
        info.id,
        blockID,
        "master-agent",
        tuple,
        1,
        "remove-client",
        "default",
      )
      expect(retry).toEqual({ archivedCount: 0, layoutRevision: 2, tabRevision: 2 })
      const serialized = (yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, firstSessionID))
        .all()).map((row) => ({
        id: row.id,
        type: row.type,
        seq: row.seq,
        aggregateID: row.aggregate_id,
        data: row.data,
      }))
      expect(serialized).toHaveLength(1)
      yield* db.delete(EventTable).where(eq(EventTable.aggregate_id, firstSessionID)).run()
      yield* db.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, firstSessionID)).run()
      yield* db.update(SessionTable).set({ time_archived: null }).where(eq(SessionTable.id, firstSessionID)).run()
      yield* events.replayAll(serialized)
      expect(
        (yield* db.select().from(SessionTable).where(eq(SessionTable.id, firstSessionID)).get())?.time_archived,
      ).toBeNumber()
    }),
  )

  it.effect("rejects a stale layout revision without changing registry or layout state", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "remove-block-cas" })
      const blockID = "block-cas"
      const layout = yield* workspace.layout.get(info.id, tuple, "remove-client")
      yield* workspace.layout.save(
        info.id,
        tuple,
        [{ id: blockID, functionality: "builtin:master-agent", transform: { x: 0, y: 0, w: 4, h: 4, z: 0 } }],
        layout.revision,
        "remove-client",
      )
      yield* tabs.enroll(info.id, "master-agent", blockID, "ses_cas", "CAS", Date.now())

      const result = yield* workspace.block
        .archiveAndRemove(info.id, blockID, "master-agent", tuple, 0, "remove-client", "default")
        .pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      expect((yield* tabs.listOwned(info.id, "master-agent", blockID, undefined, 10)).items).toHaveLength(1)
      expect(yield* workspace.block.get(info.id, blockID)).toBeDefined()
    }),
  )

  it.effect("rolls back session events, archive, binding and layout when the final layout write fails", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const events = yield* EventV2.Service
      const notifications: string[] = []
      yield* events.listen((event) =>
        Effect.sync(() => {
          notifications.push(event.type)
        }),
      )
      yield* fixture.db.run(
        sql`CREATE TEMP TRIGGER reject_removal BEFORE UPDATE ON layout BEGIN SELECT RAISE(ABORT, 'forced layout failure'); END`,
      )
      const result = yield* remove(fixture).pipe(Effect.exit)
      yield* fixture.db.run(sql`DROP TRIGGER reject_removal`)
      expect(Exit.isFailure(result)).toBe(true)
      expect(notifications).toEqual([])
      expect((yield* fixture.tabs.block(fixture.id, "master-agent", "block")).revision).toBe(0)
      expect((yield* fixture.tabs.listOwned(fixture.id, "master-agent", "block", undefined, 10)).items).toHaveLength(1)
      expect(yield* fixture.workspace.block.get(fixture.id, "block")).toBeDefined()
      expect(
        (yield* fixture.db.select().from(SessionTable).where(eq(SessionTable.id, fixture.sessionID)).get())
          ?.time_archived,
      ).toBeNull()
      expect(
        (yield* fixture.db
          .select()
          .from(FunctionalityInstanceTable)
          .where(eq(FunctionalityInstanceTable.workspace_id, fixture.id))
          .get())?.deleted_at,
      ).toBeNull()
      expect(
        yield* fixture.db.select().from(EventTable).where(eq(EventTable.aggregate_id, fixture.sessionID)).all(),
      ).toHaveLength(0)
    }),
  )

  it.effect("rejects old layout saves that delete or change the type of a session block", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      for (const blocks of [[], [{ ...fixture.block, functionality: "builtin:notes" }]]) {
        const result = yield* fixture.workspace.layout.save(fixture.id, tuple, blocks, 1, "client").pipe(Effect.exit)
        expect(String(result)).toContain("Workspace.InvalidLayoutError")
      }
      expect(yield* fixture.workspace.block.get(fixture.id, "block")).toEqual(fixture.block)
    }),
  )

  it.effect("fences re-enrollment, new tabs, selection and layout resurrection after removal", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const tab = (yield* fixture.tabs.block(fixture.id, "master-agent", "block")).selected
      yield* remove(fixture)
      expect(
        String(
          yield* fixture.tabs.enroll(fixture.id, "master-agent", "block", "another", "Another", 2).pipe(Effect.exit),
        ),
      ).toContain("CanvasTab.DeletedBlockError")
      expect(
        String(
          yield* fixture.tabs
            .add(
              {
                workspaceID: fixture.id,
                kind: "master-agent",
                blockID: "block",
                conversationID: "another",
                title: "Another",
                createdAt: 2,
              },
              0,
              "another-tab",
            )
            .pipe(Effect.exit),
        ),
      ).toContain("CanvasTab.DeletedBlockError")
      expect(
        Exit.isFailure(
          yield* fixture.tabs
            .select({ workspaceID: fixture.id, kind: "master-agent", blockID: "block", tabID: tab.id }, 0)
            .pipe(Effect.exit),
        ),
      ).toBe(true)
      expect(
        String(yield* fixture.workspace.layout.save(fixture.id, tuple, [fixture.block], 2, "client").pipe(Effect.exit)),
      ).toContain("Workspace.InvalidLayoutError")
    }),
  )

  it.effect("authorizes the user, block type and layout holder before archiving", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      expect(
        String(
          yield* fixture.workspace.block
            .archiveAndRemove(fixture.id, "block", "master-agent", tuple, 1, "client", "other-user")
            .pipe(Effect.exit),
        ),
      ).toContain("Workspace.NotFoundError")
      expect(
        String(
          yield* fixture.workspace.block
            .archiveAndRemove(fixture.id, "block", "operating-chat", tuple, 1, "client", "default")
            .pipe(Effect.exit),
        ),
      ).toContain("CanvasTab.WrongKindError")
      expect(
        String(
          yield* fixture.workspace.block
            .archiveAndRemove(fixture.id, "block", "master-agent", tuple, 1, "other-client", "default")
            .pipe(Effect.exit),
        ),
      ).toContain("Workspace.LayoutHandedOverError")
      expect((yield* fixture.tabs.listOwned(fixture.id, "master-agent", "block", undefined, 10)).items).toHaveLength(1)
    }),
  )

  it.effect("removes an uninitialized block and fences its first enrollment", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const tabs = yield* CanvasTabService.Service
      const info = yield* workspace.create({ name: "empty-block" })
      yield* workspace.layout.get(info.id, tuple, "client")
      yield* workspace.layout.save(
        info.id,
        tuple,
        [{ id: "block", functionality: "builtin:chat-relay", transform: { x: 0, y: 0, w: 4, h: 4, z: 0 } }],
        0,
        "client",
      )
      expect(
        yield* workspace.block.archiveAndRemove(info.id, "block", "chat-relay", tuple, 1, "client", "default"),
      ).toEqual({ archivedCount: 0, layoutRevision: 2, tabRevision: 1 })
      expect(String(yield* tabs.enroll(info.id, "chat-relay", "block", "page", "Page", 1).pipe(Effect.exit))).toContain(
        "CanvasTab.DeletedBlockError",
      )
    }),
  )

  it.effect("serializes a racing create or select with removal without leaving owned tabs", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const first = (yield* fixture.tabs.block(fixture.id, "master-agent", "block")).selected
      const candidate = SessionSchema.ID.create()
      const session = yield* fixture.db.select().from(SessionTable).where(eq(SessionTable.id, fixture.sessionID)).get()
      yield* fixture.db
        .insert(SessionTable)
        .values({ ...session!, id: candidate })
        .run()
      const results = yield* Effect.all(
        [
          remove(fixture).pipe(Effect.exit),
          fixture.tabs
            .add(
              {
                workspaceID: fixture.id,
                kind: "master-agent",
                blockID: "block",
                conversationID: candidate,
                title: "Second",
                createdAt: 2,
              },
              0,
              "racing-tab",
            )
            .pipe(Effect.exit),
          fixture.tabs
            .select({ workspaceID: fixture.id, kind: "master-agent", blockID: "block", tabID: first.id }, 0)
            .pipe(Effect.exit),
        ],
        { concurrency: "unbounded" },
      )
      expect(Exit.isSuccess(results[0])).toBe(true)
      if (Exit.isSuccess(results[1]))
        expect(
          (yield* fixture.db.select().from(SessionTable).where(eq(SessionTable.id, candidate)).get())?.time_archived,
        ).toBeNumber()
      expect((yield* fixture.tabs.listOwned(fixture.id, "master-agent", "block", undefined, 10)).items).toHaveLength(0)
      expect(yield* fixture.workspace.block.get(fixture.id, "block")).toBeUndefined()
    }),
  )

  it.effect("enrolls and archives the existing binding when removal is its first registry access", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      yield* fixture.db.delete(CanvasTabBlockTable).where(eq(CanvasTabBlockTable.workspace_id, fixture.id)).run()
      yield* fixture.db.delete(CanvasTabTable).where(eq(CanvasTabTable.workspace_id, fixture.id)).run()
      expect((yield* remove(fixture)).archivedCount).toBe(1)
      expect(
        (yield* fixture.tabs.listArchived(fixture.id, "master-agent", "", undefined, 10)).items[0]?.conversationID,
      ).toBe(fixture.sessionID)
      expect(
        (yield* fixture.db.select().from(SessionTable).where(eq(SessionTable.id, fixture.sessionID)).get())
          ?.time_archived,
      ).toBeNumber()
    }),
  )

  it.effect("requires the block in the authoritative tuple even if another tuple contains it", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const id = crypto.randomUUID()
      yield* fixture.db
        .insert(LayoutTable)
        .values({ id, workspace_id: fixture.id, revision: 0, blocks: [], time_updated: 1 })
        .run()
      yield* fixture.db
        .insert(LayoutOptionTable)
        .values({ workspace_id: fixture.id, user: "default", style: "default", device_class: "mobile", layout_id: id })
        .run()
      const result = yield* fixture.workspace.block
        .archiveAndRemove(
          fixture.id,
          "block",
          "master-agent",
          { ...tuple, deviceClass: "mobile" },
          0,
          "client",
          "default",
        )
        .pipe(Effect.exit)
      expect(String(result)).toContain("CanvasTab.NotFoundError")
      expect((yield* fixture.tabs.listOwned(fixture.id, "master-agent", "block", undefined, 10)).items).toHaveLength(1)
    }),
  )

  it.effect("does not remove a block whose persisted binding cannot be decoded", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      yield* fixture.db
        .update(FunctionalityInstanceTable)
        .set({ configuration: { invalid: true } })
        .where(eq(FunctionalityInstanceTable.workspace_id, fixture.id))
        .run()
      expect(String(yield* remove(fixture).pipe(Effect.exit))).toContain("Workspace.InvalidLayoutError")
      expect(yield* fixture.workspace.block.get(fixture.id, "block")).toBeDefined()
    }),
  )

  it.effect("rejects a missing registry header when owned tabs still exist", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      yield* fixture.db.delete(CanvasTabBlockTable).where(eq(CanvasTabBlockTable.workspace_id, fixture.id)).run()
      expect(String(yield* remove(fixture).pipe(Effect.exit))).toContain("Workspace.InvalidLayoutError")
      expect(yield* fixture.workspace.block.get(fixture.id, "block")).toBeDefined()
      expect((yield* fixture.tabs.listOwned(fixture.id, "master-agent", "block", undefined, 10)).items).toHaveLength(1)
      expect(
        (yield* fixture.db.select().from(SessionTable).where(eq(SessionTable.id, fixture.sessionID)).get())
          ?.time_archived,
      ).toBeNull()
    }),
  )

  it.effect("rejects an incomplete deletion marker instead of reporting successful removal", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      yield* fixture.tabs.archiveBlock({ workspaceID: fixture.id, kind: "master-agent", blockID: "block" }, 0)
      expect(String(yield* remove(fixture).pipe(Effect.exit))).toContain("Workspace.InvalidLayoutError")
      expect(yield* fixture.workspace.block.get(fixture.id, "block")).toBeDefined()
      expect(
        (yield* fixture.db
          .select()
          .from(FunctionalityInstanceTable)
          .where(eq(FunctionalityInstanceTable.workspace_id, fixture.id))
          .get())?.deleted_at,
      ).toBeNull()
    }),
  )

  it.effect("rejects an archived row that still claims block ownership", () =>
    Effect.gen(function* () {
      const fixture = yield* setup("chat-relay")
      yield* fixture.db
        .update(CanvasTabTable)
        .set({ time_archived: 1 })
        .where(eq(CanvasTabTable.workspace_id, fixture.id))
        .run()
      expect(String(yield* remove(fixture).pipe(Effect.exit))).toContain("Workspace.InvalidLayoutError")
      expect(yield* fixture.workspace.block.get(fixture.id, "block")).toBeDefined()
    }),
  )

  for (const kind of ["operating-chat", "chat-relay"] as const) {
    it.effect(`archives ${kind} tabs while preserving their conversation data`, () =>
      Effect.gen(function* () {
        const fixture = yield* setup(kind)
        yield* fixture.db
          .update(CanvasTabTable)
          .set({ snapshot: { messages: [{ text: "Saved conversation" }] } })
          .where(eq(CanvasTabTable.workspace_id, fixture.id))
          .run()
        expect((yield* remove(fixture)).archivedCount).toBe(1)
        expect((yield* fixture.tabs.listArchived(fixture.id, kind, "", undefined, 10)).items[0]?.conversationID).toBe(
          fixture.sessionID,
        )
        expect(
          (yield* fixture.db.select().from(CanvasTabTable).where(eq(CanvasTabTable.workspace_id, fixture.id)).get())
            ?.snapshot,
        ).toEqual({ messages: [{ text: "Saved conversation" }] })
        const session = yield* fixture.db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, fixture.sessionID))
          .get()
        expect(session?.title).toBe("First")
        if (kind === "operating-chat") expect(session?.time_archived).toBeNumber()
        if (kind === "chat-relay") expect(session?.time_archived).toBeNull()
      }),
    )
  }
})

function setup(kind: CanvasTab.Kind = "master-agent") {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const workspace = yield* WorkspaceService.Service
    const tabs = yield* CanvasTabService.Service
    const info = yield* workspace.create({ name: "removal-fixture" })
    const sessionID = SessionSchema.ID.create()
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make(process.cwd()), sandboxes: [] })
      .onConflictDoNothing()
      .run()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        runtime: "v2",
        project_id: Project.ID.global,
        workspace_id: info.id,
        slug: "removal",
        directory: AbsolutePath.make(process.cwd()),
        title: "First",
        version: "test",
        time_created: 1,
        time_updated: 1,
      })
      .run()
    const block = {
      id: "block",
      functionality: kind === "operating-chat" ? "builtin:operating-chat-session" : `builtin:${kind}`,
      transform: { x: 0, y: 0, w: 4, h: 4, z: 0 },
    }
    yield* workspace.layout.get(info.id, tuple, "client")
    yield* workspace.layout.save(info.id, tuple, [block], 0, "client")
    yield* db
      .insert(FunctionalityInstanceTable)
      .values({
        id: crypto.randomUUID(),
        workspace_id: info.id,
        block_id: "block",
        functionality_id: block.functionality,
        revision: 0,
        configuration: {
          version: 1,
          directoryBinding: { mode: "workspace-primary" },
          sessionBinding: { mode: "owned", sessionID, generation: 0 },
        },
        time_updated: 1,
      })
      .run()
    yield* tabs.enroll(info.id, kind, "block", sessionID, "First", 1)
    return { db, workspace, tabs, id: info.id, sessionID, block, kind }
  })
}

function remove(fixture: Effect.Success<ReturnType<typeof setup>>) {
  return fixture.workspace.block.archiveAndRemove(fixture.id, "block", fixture.kind, tuple, 1, "client", "default")
}
