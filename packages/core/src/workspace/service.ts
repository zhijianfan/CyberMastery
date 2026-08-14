export * as WorkspaceService from "./service"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { createDefaultLayout } from "./default-layout"
import { LayoutOptionTable, LayoutTable, WorkspaceGitTable, WorkspaceV2Table } from "./sql"

export type UpdatePatch = {
  name?: string
  style?: string
  directories?: string[]
  pluginIDs?: string[]
  skillIDs?: string[]
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Workspace.NotFoundError", {
  workspaceID: Workspace.ID,
}) {}

export class LayoutConflictError extends Schema.TaggedErrorClass<LayoutConflictError>()(
  "Workspace.LayoutConflictError",
  {
    currentRevision: Schema.Number,
  },
) {}

export interface Interface {
  readonly list: () => Effect.Effect<Workspace.Info[]>
  readonly get: (workspaceID: Workspace.ID) => Effect.Effect<Workspace.Info | undefined>
  readonly create: (input: { name: string }) => Effect.Effect<Workspace.Info>
  readonly rename: (workspaceID: Workspace.ID, name: string) => Effect.Effect<Workspace.Info, NotFoundError>
  readonly remove: (workspaceID: Workspace.ID) => Effect.Effect<void, NotFoundError>
  readonly duplicate: (workspaceID: Workspace.ID) => Effect.Effect<Workspace.Info, NotFoundError>
  readonly update: (workspaceID: Workspace.ID, patch: UpdatePatch) => Effect.Effect<Workspace.Info, NotFoundError>
  readonly layout: {
    readonly get: (workspaceID: Workspace.ID, tuple: Workspace.Layout.Tuple) => Effect.Effect<Workspace.Layout.Info>
    readonly save: (
      workspaceID: Workspace.ID,
      tuple: Workspace.Layout.Tuple,
      blocks: readonly Workspace.Block.Record[],
      expectedRevision: number,
    ) => Effect.Effect<Workspace.Layout.Info, LayoutConflictError>
  }
  readonly functionality: {
    readonly list: (workspaceID: Workspace.ID) => Effect.Effect<readonly Workspace.Functionality.Info[]>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Workspace") {}

const builtins = [
  Workspace.Functionality.Info.make({
    id: "builtin:chat",
    kind: "builtin",
    label: "Chat",
    minW: 4,
    minH: 4,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:online-search",
    kind: "builtin",
    label: "Online search",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:screenshot-browser",
    kind: "builtin",
    label: "Screenshot browser",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:application-window-stream",
    kind: "builtin",
    label: "Application window stream",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:chatgpt-router",
    kind: "builtin",
    label: "ChatGPT router",
    minW: 4,
    minH: 4,
    maxW: null,
    maxH: null,
  }),
] satisfies readonly Workspace.Functionality.Info[]

type WorkspaceRow = typeof WorkspaceV2Table.$inferSelect
type GitRow = typeof WorkspaceGitTable.$inferSelect
type LayoutRow = typeof LayoutTable.$inferSelect

function fromRows(row: WorkspaceRow, git: GitRow[]): Workspace.Info {
  return Workspace.Info.make({
    id: Workspace.ID.make(row.id),
    name: row.name,
    style: row.style,
    directories: row.directories,
    pluginIDs: row.plugin_ids,
    skillIDs: row.skill_ids,
    git: git.map((entry) => ({
      directory: entry.directory,
      branch: entry.branch ?? undefined,
      remote: entry.remote ?? undefined,
      dirty: entry.dirty,
    })),
    time: { created: row.time_created, updated: row.time_updated },
  })
}

function layoutFromRow(row: LayoutRow): Workspace.Layout.Info {
  return Workspace.Layout.Info.make({
    id: row.id,
    workspaceID: Workspace.ID.make(row.workspace_id),
    revision: row.revision,
    blocks: row.blocks,
  })
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const load = Effect.fn("Workspace.load")(function* (workspaceID: Workspace.ID) {
      const row = yield* db
        .select()
        .from(WorkspaceV2Table)
        .where(eq(WorkspaceV2Table.id, workspaceID))
        .get()
        .pipe(Effect.orDie)
      if (!row) return undefined
      const git = yield* db
        .select()
        .from(WorkspaceGitTable)
        .where(eq(WorkspaceGitTable.workspace_id, workspaceID))
        .all()
        .pipe(Effect.orDie)
      return fromRows(row, git)
    })

    const requireWorkspace = Effect.fn("Workspace.requireWorkspace")(function* (workspaceID: Workspace.ID) {
      const info = yield* load(workspaceID)
      if (!info) return yield* new NotFoundError({ workspaceID })
      return info
    })

    const findOption = Effect.fn("Workspace.findOption")(function* (
      workspaceID: Workspace.ID,
      user: string,
      style: string,
      deviceClass: string,
      deviceID: string | null,
    ) {
      return yield* db
        .select()
        .from(LayoutOptionTable)
        .where(
          and(
            eq(LayoutOptionTable.workspace_id, workspaceID),
            eq(LayoutOptionTable.user, user),
            eq(LayoutOptionTable.style, style),
            eq(LayoutOptionTable.device_class, deviceClass),
            deviceID === null ? isNull(LayoutOptionTable.device_id) : eq(LayoutOptionTable.device_id, deviceID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
    })

    const loadLayout = Effect.fn("Workspace.loadLayout")(function* (layoutID: string) {
      const row = yield* db.select().from(LayoutTable).where(eq(LayoutTable.id, layoutID)).get().pipe(Effect.orDie)
      return row ? layoutFromRow(row) : undefined
    })

    const findFallback = Effect.fn("Workspace.findFallback")(function* (
      workspaceID: Workspace.ID,
      user: string,
      style: string | undefined,
    ) {
      const rows = yield* db
        .select()
        .from(LayoutOptionTable)
        .where(
          style === undefined
            ? and(eq(LayoutOptionTable.workspace_id, workspaceID), eq(LayoutOptionTable.user, user))
            : and(
                eq(LayoutOptionTable.workspace_id, workspaceID),
                eq(LayoutOptionTable.user, user),
                eq(LayoutOptionTable.style, style),
              ),
        )
        .all()
        .pipe(Effect.orDie)
      return rows[0]
    })

    const resolveLayout = Effect.fn("Workspace.resolveLayout")(function* (
      workspaceID: Workspace.ID,
      tuple: Workspace.Layout.Tuple,
    ) {
      const exactDevice =
        tuple.deviceID === undefined
          ? undefined
          : yield* findOption(workspaceID, tuple.user, tuple.style, tuple.deviceClass, tuple.deviceID)
      const exactClass =
        yield* findOption(workspaceID, tuple.user, tuple.style, tuple.deviceClass, null)
      const byStyle = yield* findFallback(workspaceID, tuple.user, tuple.style)
      const byUser = yield* findFallback(workspaceID, tuple.user, undefined)
      const option = exactDevice ?? exactClass ?? byStyle ?? byUser
      if (option) {
        const layout = yield* loadLayout(option.layout_id)
        if (layout) return layout
      }
      const layout = createDefaultLayout(workspaceID)
      yield* db
        .insert(LayoutTable)
        .values({
          id: layout.id,
          workspace_id: workspaceID,
          revision: layout.revision,
          blocks: layout.blocks,
          time_updated: Date.now(),
        })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(LayoutOptionTable)
        .values({
          workspace_id: workspaceID,
          user: tuple.user,
          style: tuple.style,
          device_class: tuple.deviceClass,
          device_id: tuple.deviceID ?? null,
          layout_id: layout.id,
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      return layout
    })

    return Service.of({
      list: Effect.fn("Workspace.list")(function* () {
        const rows = yield* db
          .select()
          .from(WorkspaceV2Table)
          .orderBy(desc(WorkspaceV2Table.time_updated))
          .all()
          .pipe(Effect.orDie)
        if (rows.length === 0) return []
        const git = yield* db
          .select()
          .from(WorkspaceGitTable)
          .where(inArray(WorkspaceGitTable.workspace_id, rows.map((row) => row.id)))
          .all()
          .pipe(Effect.orDie)
        return rows.map((row) => fromRows(row, git.filter((entry) => entry.workspace_id === row.id)))
      }),
      get: Effect.fn("Workspace.get")(function* (workspaceID) {
        return yield* load(workspaceID)
      }),
      create: Effect.fn("Workspace.create")(function* (input) {
        const id = Workspace.ID.create()
        const now = Date.now()
        const info = Workspace.Info.make({
          id,
          name: input.name,
          style: "default",
          directories: [],
          pluginIDs: [],
          skillIDs: [],
          git: [],
          time: { created: now, updated: now },
        })
        yield* db
          .insert(WorkspaceV2Table)
          .values({
            id,
            name: info.name,
            style: info.style,
            directories: [],
            plugin_ids: [],
            skill_ids: [],
            // Identity is resolved at the protocol layer; the core defaults to the anonymous user.
            user: "",
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)
        return info
      }),
      rename: Effect.fn("Workspace.rename")(function* (workspaceID, name) {
        yield* requireWorkspace(workspaceID)
        yield* db
          .update(WorkspaceV2Table)
          .set({ name, time_updated: Date.now() })
          .where(eq(WorkspaceV2Table.id, workspaceID))
          .run()
          .pipe(Effect.orDie)
        return yield* requireWorkspace(workspaceID)
      }),
      remove: Effect.fn("Workspace.remove")(function* (workspaceID) {
        yield* requireWorkspace(workspaceID)
        yield* db.delete(WorkspaceV2Table).where(eq(WorkspaceV2Table.id, workspaceID)).run().pipe(Effect.orDie)
      }),
      duplicate: Effect.fn("Workspace.duplicate")(function* (workspaceID) {
        const source = yield* requireWorkspace(workspaceID)
        const id = Workspace.ID.create()
        const now = Date.now()
        const info = Workspace.Info.make({
          id,
          name: `${source.name} (copy)`,
          style: source.style,
          directories: source.directories,
          pluginIDs: source.pluginIDs,
          skillIDs: source.skillIDs,
          git: source.git,
          time: { created: now, updated: now },
        })
        yield* db
          .insert(WorkspaceV2Table)
          .values({
            id,
            name: info.name,
            style: info.style,
            directories: info.directories,
            plugin_ids: info.pluginIDs,
            skill_ids: info.skillIDs,
            user: "",
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)
        if (source.git.length > 0)
          yield* db
            .insert(WorkspaceGitTable)
            .values(
              source.git.map((entry) => ({
                workspace_id: id,
                directory: entry.directory,
                branch: entry.branch ?? null,
                remote: entry.remote ?? null,
                dirty: entry.dirty,
              })),
            )
            .run()
            .pipe(Effect.orDie)
        const layouts = yield* db
          .select()
          .from(LayoutTable)
          .where(eq(LayoutTable.workspace_id, workspaceID))
          .all()
          .pipe(Effect.orDie)
        const layoutIDs = new Map(layouts.map((row) => [row.id, crypto.randomUUID()]))
        if (layouts.length > 0)
          yield* db
            .insert(LayoutTable)
            .values(
              layouts.map((row) => ({
                id: layoutIDs.get(row.id)!,
                workspace_id: id,
                revision: row.revision,
                blocks: row.blocks,
                time_updated: row.time_updated,
              })),
            )
            .run()
            .pipe(Effect.orDie)
        const options = yield* db
          .select()
          .from(LayoutOptionTable)
          .where(eq(LayoutOptionTable.workspace_id, workspaceID))
          .all()
          .pipe(Effect.orDie)
        if (options.length > 0)
          yield* db
            .insert(LayoutOptionTable)
            .values(
              options.map((option) => ({
                workspace_id: id,
                user: option.user,
                style: option.style,
                device_class: option.device_class,
                device_id: option.device_id,
                layout_id: layoutIDs.get(option.layout_id) ?? option.layout_id,
              })),
            )
            .run()
            .pipe(Effect.orDie)
        return info
      }),
      update: Effect.fn("Workspace.update")(function* (workspaceID, patch) {
        yield* requireWorkspace(workspaceID)
        yield* db
          .update(WorkspaceV2Table)
          .set({
            ...(patch.name === undefined ? {} : { name: patch.name }),
            ...(patch.style === undefined ? {} : { style: patch.style }),
            ...(patch.directories === undefined ? {} : { directories: patch.directories }),
            ...(patch.pluginIDs === undefined ? {} : { plugin_ids: patch.pluginIDs }),
            ...(patch.skillIDs === undefined ? {} : { skill_ids: patch.skillIDs }),
            time_updated: Date.now(),
          })
          .where(eq(WorkspaceV2Table.id, workspaceID))
          .run()
          .pipe(Effect.orDie)
        return yield* requireWorkspace(workspaceID)
      }),
      layout: {
        get: Effect.fn("Workspace.layout.get")(function* (workspaceID, tuple) {
          return yield* resolveLayout(workspaceID, tuple)
        }),
        save: Effect.fn("Workspace.layout.save")(function* (workspaceID, tuple, blocks, expectedRevision) {
          const layout = yield* resolveLayout(workspaceID, tuple)
          if (layout.revision !== expectedRevision) {
            return yield* new LayoutConflictError({ currentRevision: layout.revision })
          }
          const revision = layout.revision + 1
          yield* db
            .update(LayoutTable)
            .set({ revision, blocks: [...blocks], time_updated: Date.now() })
            .where(eq(LayoutTable.id, layout.id))
            .run()
            .pipe(Effect.orDie)
          return Workspace.Layout.Info.make({
            id: layout.id,
            workspaceID: layout.workspaceID,
            revision,
            blocks: [...blocks],
          })
        }),
      },
      functionality: {
        list: Effect.fn("Workspace.functionality.list")(function* (_workspaceID) {
          // Plugin-contributed functionality joins the registry in a later track.
          return builtins
        }),
      },
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })

export { createDefaultLayout }
