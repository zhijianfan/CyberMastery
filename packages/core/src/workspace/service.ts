export * as WorkspaceService from "./service"

import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { CanvasTab } from "@opencode-ai/schema/canvas-tab"
import { MasterAgent } from "@opencode-ai/schema/master-agent"
import { OperatingChat } from "@opencode-ai/schema/operating-chat"
import { Workspace } from "@opencode-ai/schema/workspace"
import { WorkspaceEvent } from "@opencode-ai/schema/workspace-event"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"
import { SessionEvent } from "../session/event"
import { SessionProjector } from "../session/projector"
import { SessionSchema } from "../session/schema"
import { SessionTable } from "../session/sql"
import { CanvasTabService } from "./canvas-tab"
import { MasterAgentBuiltin } from "./builtins/master-agent"
import { CoderModelCodec } from "./coder-model-codec"
import { createDefaultLayout } from "./default-layout"
import {
  CanvasTabBlockTable,
  CanvasTabTable,
  FunctionalityInstanceTable,
  LayoutAuthorityTable,
  LayoutOptionTable,
  LayoutTable,
  WorkspaceGitTable,
  WorkspaceV2Table,
} from "./sql"

export type UpdatePatch = {
  name?: string
  style?: string
  directories?: readonly string[]
  pluginIDs?: readonly string[]
  skillIDs?: readonly string[]
  operatingAgent?: string
  model?: string
  coderModel?: string | null
}

export class WorkspaceNotFoundError extends Schema.TaggedErrorClass<WorkspaceNotFoundError>()(
  "Workspace.NotFoundError",
  {
    workspaceID: Workspace.ID,
  },
) {}

export class WorkspaceRemovalUnsupportedError extends Schema.TaggedErrorClass<WorkspaceRemovalUnsupportedError>()(
  "Workspace.RemovalUnsupportedError",
  {},
) {}

export class LayoutConflictError extends Schema.TaggedErrorClass<LayoutConflictError>()(
  "Workspace.LayoutConflictError",
  {
    currentRevision: Schema.Number,
  },
) {}

export class LayoutHandedOverError extends Schema.TaggedErrorClass<LayoutHandedOverError>()(
  "Workspace.LayoutHandedOverError",
  {
    currentRevision: Schema.Number,
  },
) {}

export class InvalidLayoutError extends Schema.TaggedErrorClass<InvalidLayoutError>()("Workspace.InvalidLayoutError", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly list: (user?: string) => Effect.Effect<Workspace.Info[]>
  /** Unscoped internal reads retain archived metadata for existing session context. */
  readonly get: (workspaceID: Workspace.ID, user?: string) => Effect.Effect<Workspace.Info, WorkspaceNotFoundError>
  readonly create: (input: { name: string; user?: string }) => Effect.Effect<Workspace.Info>
  readonly rename: (
    workspaceID: Workspace.ID,
    name: string,
    user?: string,
  ) => Effect.Effect<Workspace.Info, WorkspaceNotFoundError>
  readonly remove: (workspaceID: Workspace.ID, user?: string) => Effect.Effect<void, WorkspaceNotFoundError>
  readonly duplicate: (
    workspaceID: Workspace.ID,
    user?: string,
  ) => Effect.Effect<Workspace.Info, WorkspaceNotFoundError>
  readonly update: (
    workspaceID: Workspace.ID,
    patch: UpdatePatch,
    user?: string,
  ) => Effect.Effect<Workspace.Info, WorkspaceNotFoundError>
  readonly layout: {
    readonly get: (
      workspaceID: Workspace.ID,
      tuple: Workspace.Layout.Tuple,
      clientID: string,
      options?: { claimAuthority?: boolean },
    ) => Effect.Effect<Workspace.Layout.Info, WorkspaceNotFoundError>
    readonly save: (
      workspaceID: Workspace.ID,
      tuple: Workspace.Layout.Tuple,
      blocks: readonly Workspace.Block.Record[],
      expectedRevision: number,
      clientID: string,
    ) => Effect.Effect<
      Workspace.Layout.Info,
      InvalidLayoutError | LayoutConflictError | LayoutHandedOverError | WorkspaceNotFoundError
    >
  }
  readonly block: {
    readonly archiveAndRemove: (
      workspaceID: Workspace.ID,
      blockID: string,
      kind: CanvasTab.Kind,
      tuple: Workspace.Layout.Tuple,
      expectedLayoutRevision: number,
      clientID: string,
      user: string,
    ) => Effect.Effect<
      { archivedCount: number; layoutRevision: number; tabRevision: number },
      | WorkspaceNotFoundError
      | LayoutConflictError
      | LayoutHandedOverError
      | InvalidLayoutError
      | CanvasTabService.NotFoundError
      | CanvasTabService.WrongKindError
      | CanvasTabService.StaleRevisionError
      | CanvasTabService.DeletedBlockError
      | CanvasTabService.BusyError
    >
    readonly get: (
      workspaceID: Workspace.ID,
      blockID: string,
    ) => Effect.Effect<Workspace.Block.Record | undefined, WorkspaceNotFoundError>
  }
  readonly functionality: {
    readonly list: (
      workspaceID: Workspace.ID,
      user?: string,
    ) => Effect.Effect<readonly Workspace.Functionality.Info[], WorkspaceNotFoundError>
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
    id: "builtin:chat-relay",
    kind: "builtin",
    label: "ChatRelay",
    minW: 4,
    minH: 4,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:operating-chat-session",
    kind: "builtin",
    label: "Operating chat session",
    minW: 4,
    minH: 4,
    maxW: null,
    maxH: null,
  }),
  MasterAgentBuiltin,
  Workspace.Functionality.Info.make({
    id: "builtin:ctxpack-browser",
    kind: "builtin",
    label: "Context Packs",
    minW: 5,
    minH: 4,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:context",
    kind: "builtin",
    label: "Project context",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:tools",
    kind: "builtin",
    label: "Tool activity",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:files",
    kind: "builtin",
    label: "Workspace files",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:notes",
    kind: "builtin",
    label: "Scratchpad",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
  Workspace.Functionality.Info.make({
    id: "builtin:voice",
    kind: "builtin",
    label: "Voice input",
    minW: 4,
    minH: 3,
    maxW: null,
    maxH: null,
  }),
] satisfies readonly Workspace.Functionality.Info[]

const defaultUser = "default"
const sessionFunctionalities = {
  "master-agent": "builtin:master-agent",
  "operating-chat": "builtin:operating-chat-session",
  "chat-relay": "builtin:chat-relay",
} satisfies Record<CanvasTab.Kind, string>

function normalizeTuple(tuple: Workspace.Layout.Tuple): Workspace.Layout.Tuple {
  return { ...tuple, user: tuple.user || defaultUser }
}

function functionalities(workspace: Workspace.Info) {
  const builtinIDs = new Set(builtins.map((item) => item.id))
  return [
    ...builtins,
    ...workspace.pluginIDs
      .filter((id) => !builtinIDs.has(id))
      .map((id) =>
        Workspace.Functionality.Info.make({
          id,
          kind: "plugin",
          label: id.replace(/^plugin:/, ""),
          minW: 4,
          minH: 3,
          maxW: null,
          maxH: null,
        }),
      ),
  ]
}

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
    operatingAgent: row.operating_agent ?? undefined,
    model: row.model ?? undefined,
    coderModel: CoderModelCodec.decode(row.coder_model),
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
    const events = yield* EventV2.Service
    const tabs = yield* CanvasTabService.Service

    const adoptLegacy = Effect.fn("Workspace.adoptLegacy")(function* (user: string, workspaceID?: Workspace.ID) {
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const legacy = yield* tx
              .select({ id: WorkspaceV2Table.id })
              .from(WorkspaceV2Table)
              .where(
                workspaceID === undefined
                  ? eq(WorkspaceV2Table.user, "")
                  : and(eq(WorkspaceV2Table.id, workspaceID), eq(WorkspaceV2Table.user, "")),
              )
              .all()
            yield* Effect.forEach(legacy, (row) =>
              Effect.gen(function* () {
                const claimed = yield* tx
                  .update(WorkspaceV2Table)
                  .set({ user })
                  .where(and(eq(WorkspaceV2Table.id, row.id), eq(WorkspaceV2Table.user, "")))
                  .returning({ id: WorkspaceV2Table.id })
                  .get()
                if (!claimed) return
                yield* tx.run(sql`
                  INSERT INTO layout_option (workspace_id, user, style, device_class, layout_id)
                  SELECT workspace_id, ${user}, style, device_class, MIN(layout_id)
                  FROM layout_option
                  WHERE workspace_id = ${row.id}
                  GROUP BY workspace_id, style, device_class
                  ON CONFLICT(workspace_id, user, style, device_class)
                  DO UPDATE SET layout_id = excluded.layout_id
                `)
                yield* tx
                  .delete(LayoutOptionTable)
                  .where(and(eq(LayoutOptionTable.workspace_id, row.id), ne(LayoutOptionTable.user, user)))
                  .run()
                yield* tx.run(sql`
                  INSERT INTO layout_authority (workspace_id, user, style, device_class, holder_id, held_at)
                  SELECT workspace_id, ${user}, style, device_class, holder_id, held_at
                  FROM (
                    SELECT *, ROW_NUMBER() OVER (
                      PARTITION BY style, device_class
                      ORDER BY held_at DESC, holder_id
                    ) AS owner_rank
                    FROM layout_authority
                    WHERE workspace_id = ${row.id}
                  )
                  WHERE owner_rank = 1
                  ON CONFLICT(workspace_id, user, style, device_class)
                  DO UPDATE SET holder_id = excluded.holder_id, held_at = excluded.held_at
                `)
                yield* tx
                  .delete(LayoutAuthorityTable)
                  .where(and(eq(LayoutAuthorityTable.workspace_id, row.id), ne(LayoutAuthorityTable.user, user)))
                  .run()
              }),
            )
          }),
        )
        .pipe(Effect.orDie)
    })

    const findWorkspace = Effect.fn("Workspace.findWorkspace")(function* (
      workspaceID: Workspace.ID,
      user?: string,
      includeArchived = false,
    ) {
      return yield* db
        .select()
        .from(WorkspaceV2Table)
        .where(
          and(
            eq(WorkspaceV2Table.id, workspaceID),
            user === undefined ? undefined : eq(WorkspaceV2Table.user, user),
            includeArchived ? undefined : isNull(WorkspaceV2Table.time_deleted),
          ),
        )
        .get()
        .pipe(Effect.orDie)
    })

    const load = Effect.fn("Workspace.load")(function* (
      workspaceID: Workspace.ID,
      user?: string,
      includeArchived = false,
    ) {
      const scopedUser = user === "" ? defaultUser : user
      const existing = yield* findWorkspace(workspaceID, scopedUser, includeArchived)
      const row =
        existing ??
        (scopedUser === undefined
          ? undefined
          : yield* adoptLegacy(scopedUser, workspaceID).pipe(
              Effect.andThen(findWorkspace(workspaceID, scopedUser, includeArchived)),
            ))
      if (!row) return undefined
      const git = yield* db
        .select()
        .from(WorkspaceGitTable)
        .where(eq(WorkspaceGitTable.workspace_id, workspaceID))
        .all()
        .pipe(Effect.orDie)
      return fromRows(row, git)
    })

    const requireWorkspace = Effect.fn("Workspace.requireWorkspace")(function* (
      workspaceID: Workspace.ID,
      user?: string,
    ) {
      const info = yield* load(workspaceID, user)
      if (!info) return yield* new WorkspaceNotFoundError({ workspaceID })
      return info
    })

    const findOption = Effect.fn("Workspace.findOption")(function* (
      workspaceID: Workspace.ID,
      user: string,
      style: string,
      deviceClass: string,
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

    // Handover: pulling a layout claims authority for the requesting client.
    const claimAuthority = Effect.fn("Workspace.claimAuthority")(function* (
      workspaceID: Workspace.ID,
      tuple: Workspace.Layout.Tuple,
      clientID: string,
    ) {
      yield* db
        .insert(LayoutAuthorityTable)
        .values({
          workspace_id: workspaceID,
          user: tuple.user,
          style: tuple.style,
          device_class: tuple.deviceClass,
          holder_id: clientID,
          held_at: Date.now(),
        })
        .onConflictDoUpdate({
          target: [
            LayoutAuthorityTable.workspace_id,
            LayoutAuthorityTable.user,
            LayoutAuthorityTable.style,
            LayoutAuthorityTable.device_class,
          ],
          set: { holder_id: clientID, held_at: Date.now() },
        })
        .run()
        .pipe(Effect.orDie)
    })

    // Saves only go through for the client currently holding authority for the
    // tuple; a stale holder gets a handed-over rejection carrying the current
    // revision so it can re-pull (re-claim) and retry.
    const requireAuthority = Effect.fn("Workspace.requireAuthority")(function* (
      workspaceID: Workspace.ID,
      tuple: Workspace.Layout.Tuple,
      clientID: string,
      currentRevision: number,
    ) {
      const row = yield* db
        .select()
        .from(LayoutAuthorityTable)
        .where(
          and(
            eq(LayoutAuthorityTable.workspace_id, workspaceID),
            eq(LayoutAuthorityTable.user, tuple.user),
            eq(LayoutAuthorityTable.style, tuple.style),
            eq(LayoutAuthorityTable.device_class, tuple.deviceClass),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (row && row.holder_id !== clientID) {
        return yield* new LayoutHandedOverError({ currentRevision })
      }
      return undefined
    })

    const resolveLayout = Effect.fn("Workspace.resolveLayout")(function* (
      workspaceID: Workspace.ID,
      tuple: Workspace.Layout.Tuple,
    ) {
      const exactClass = yield* findOption(workspaceID, tuple.user, tuple.style, tuple.deviceClass)
      const byStyle = yield* findFallback(workspaceID, tuple.user, tuple.style)
      const byUser = yield* findFallback(workspaceID, tuple.user, undefined)
      const option = exactClass ?? byStyle ?? byUser
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
          layout_id: layout.id,
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      return layout
    })

    return Service.of({
      list: Effect.fn("Workspace.list")(function* (user = defaultUser) {
        const scopedUser = user || defaultUser
        yield* adoptLegacy(scopedUser)
        const rows = yield* db
          .select()
          .from(WorkspaceV2Table)
          .where(and(eq(WorkspaceV2Table.user, scopedUser), isNull(WorkspaceV2Table.time_deleted)))
          .orderBy(desc(WorkspaceV2Table.time_updated))
          .all()
          .pipe(Effect.orDie)
        if (rows.length === 0) return []
        const git = yield* db
          .select()
          .from(WorkspaceGitTable)
          .where(
            inArray(
              WorkspaceGitTable.workspace_id,
              rows.map((row) => row.id),
            ),
          )
          .all()
          .pipe(Effect.orDie)
        return rows.map((row) =>
          fromRows(
            row,
            git.filter((entry) => entry.workspace_id === row.id),
          ),
        )
      }),
      get: Effect.fn("Workspace.get")(function* (workspaceID, user) {
        if (user !== undefined) return yield* requireWorkspace(workspaceID, user)
        const archived = yield* load(workspaceID, undefined, true)
        if (!archived) return yield* new WorkspaceNotFoundError({ workspaceID })
        return archived
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
            coder_model: CoderModelCodec.encode(info.coderModel),
            user: input.user || defaultUser,
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)
        return info
      }),
      rename: Effect.fn("Workspace.rename")(function* (workspaceID, name, user) {
        yield* requireWorkspace(workspaceID, user)
        yield* db
          .update(WorkspaceV2Table)
          .set({ name, time_updated: Date.now() })
          .where(eq(WorkspaceV2Table.id, workspaceID))
          .run()
          .pipe(Effect.orDie)
        return yield* requireWorkspace(workspaceID, user)
      }),
      remove: Effect.fn("Workspace.remove")(function* (workspaceID, user) {
        yield* requireWorkspace(workspaceID, user)
        const archived = yield* db
          .update(WorkspaceV2Table)
          .set({ time_deleted: Date.now() })
          .where(and(eq(WorkspaceV2Table.id, workspaceID), isNull(WorkspaceV2Table.time_deleted)))
          .returning({ id: WorkspaceV2Table.id })
          .get()
          .pipe(Effect.orDie)
        if (!archived) return yield* new WorkspaceNotFoundError({ workspaceID })
      }),
      duplicate: Effect.fn("Workspace.duplicate")(function* (workspaceID, user) {
        const source = yield* requireWorkspace(workspaceID, user)
        const id = Workspace.ID.create()
        const now = Date.now()
        const info = Workspace.Info.make({
          id,
          name: `${source.name} (copy)`,
          style: source.style,
          directories: source.directories,
          pluginIDs: source.pluginIDs,
          skillIDs: source.skillIDs,
          operatingAgent: source.operatingAgent,
          model: source.model,
          coderModel: source.coderModel,
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
            operating_agent: info.operatingAgent ?? null,
            model: info.model ?? null,
            coder_model: CoderModelCodec.encode(info.coderModel),
            user: user || defaultUser,
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
                layout_id: layoutIDs.get(option.layout_id) ?? option.layout_id,
              })),
            )
            .run()
            .pipe(Effect.orDie)
        return info
      }),
      update: Effect.fn("Workspace.update")(function* (workspaceID, patch, user) {
        yield* requireWorkspace(workspaceID, user)
        yield* db
          .update(WorkspaceV2Table)
          .set({
            ...(patch.name === undefined ? {} : { name: patch.name }),
            ...(patch.style === undefined ? {} : { style: patch.style }),
            ...(patch.directories === undefined ? {} : { directories: patch.directories }),
            ...(patch.pluginIDs === undefined ? {} : { plugin_ids: patch.pluginIDs }),
            ...(patch.skillIDs === undefined ? {} : { skill_ids: patch.skillIDs }),
            ...(patch.operatingAgent === undefined ? {} : { operating_agent: patch.operatingAgent || null }),
            ...(patch.model === undefined ? {} : { model: patch.model || null }),
            ...(CoderModelCodec.encodePatch(patch.coderModel) ?? {}),
            time_updated: Date.now(),
          })
          .where(eq(WorkspaceV2Table.id, workspaceID))
          .run()
          .pipe(Effect.orDie)
        return yield* requireWorkspace(workspaceID, user)
      }),
      layout: {
        get: Effect.fn("Workspace.layout.get")(function* (workspaceID, tuple, clientID, options) {
          const normalized = normalizeTuple(tuple)
          yield* requireWorkspace(workspaceID, normalized.user)
          const layout = yield* resolveLayout(workspaceID, normalized)
          // Server-internal reads (block lifecycle services verifying layouts)
          // must not steal layout authority from the interactive clients.
          if (options?.claimAuthority !== false) yield* claimAuthority(workspaceID, normalized, clientID)
          return layout
        }),
        save: Effect.fn("Workspace.layout.save")(function* (workspaceID, tuple, blocks, expectedRevision, clientID) {
          return yield* events.atomic(
            Effect.gen(function* () {
              const normalized = normalizeTuple(tuple)
              const workspace = yield* requireWorkspace(workspaceID, normalized.user)
              const layout = yield* resolveLayout(workspaceID, normalized)
              yield* requireAuthority(workspaceID, normalized, clientID, layout.revision)
              if (layout.revision !== expectedRevision) {
                return yield* new LayoutConflictError({ currentRevision: layout.revision })
              }
              const catalog = new Map(functionalities(workspace).map((item) => [item.id, item]))
              if (blocks.some((block) => !catalog.has(block.functionality))) {
                return yield* new InvalidLayoutError({ message: "Layout contains an unknown functionality" })
              }
              if (
                blocks.some((block) => {
                  const functionality = catalog.get(block.functionality)!
                  return (
                    block.transform.w < functionality.minW ||
                    block.transform.h < functionality.minH ||
                    (functionality.maxW !== null && block.transform.w > functionality.maxW) ||
                    (functionality.maxH !== null && block.transform.h > functionality.maxH)
                  )
                })
              ) {
                return yield* new InvalidLayoutError({
                  message: "Layout block violates functionality size constraints",
                })
              }
              if (blocks.some((block) => block.id.length === 0)) {
                return yield* new InvalidLayoutError({ message: "Layout contains an empty block ID" })
              }
              if (new Set(blocks.map((block) => block.id)).size !== blocks.length) {
                return yield* new InvalidLayoutError({ message: "Layout contains duplicate block IDs" })
              }
              if (
                layout.blocks.some(
                  (previous) =>
                    Object.values(sessionFunctionalities).includes(previous.functionality) &&
                    !blocks.some((block) => block.id === previous.id && block.functionality === previous.functionality),
                )
              )
                return yield* new InvalidLayoutError({ message: "Session blocks must be archived before removal" })
              const deleted = yield* db
                .select({ blockID: CanvasTabBlockTable.block_id })
                .from(CanvasTabBlockTable)
                .where(
                  and(eq(CanvasTabBlockTable.workspace_id, workspaceID), isNotNull(CanvasTabBlockTable.deleted_at)),
                )
                .all()
                .pipe(Effect.orDie)
              if (blocks.some((block) => deleted.some((item) => item.blockID === block.id)))
                return yield* new InvalidLayoutError({ message: "Layout contains an archived block ID" })
              const revision = layout.revision + 1
              yield* db
                .update(LayoutTable)
                .set({ revision, blocks: [...blocks], time_updated: Date.now() })
                .where(eq(LayoutTable.id, layout.id))
                .run()
                .pipe(Effect.orDie)
              const info = Workspace.Layout.Info.make({
                id: layout.id,
                workspaceID: layout.workspaceID,
                revision,
                blocks: [...blocks],
              })
              // Realtime fan-out: connected clients re-pull when another client
              // (or surface) saves this layout. Transient event, not durable.
              yield* events.publish(WorkspaceEvent.LayoutUpdated, { workspaceID, revision }).pipe(Effect.orDie)
              return info
            }),
          )
        }),
      },
      block: {
        archiveAndRemove: Effect.fn("Workspace.block.archiveAndRemove")(
          function* (workspaceID, blockID, kind, tuple, expectedLayoutRevision, clientID, user) {
            return yield* events.atomic(
              Effect.gen(function* () {
                const normalized = normalizeTuple({ ...tuple, user })
                yield* requireWorkspace(workspaceID, normalized.user)
                const layout = yield* resolveLayout(workspaceID, normalized)
                yield* requireAuthority(workspaceID, normalized, clientID, layout.revision)
                const previous = yield* db
                  .select()
                  .from(CanvasTabBlockTable)
                  .where(
                    and(eq(CanvasTabBlockTable.workspace_id, workspaceID), eq(CanvasTabBlockTable.block_id, blockID)),
                  )
                  .get()
                  .pipe(Effect.orDie)
                if (previous && previous.kind !== kind)
                  return yield* new CanvasTabService.WrongKindError({ workspaceID, blockID, kind })
                const owned = yield* db
                  .select({ kind: CanvasTabTable.kind, archivedAt: CanvasTabTable.time_archived })
                  .from(CanvasTabTable)
                  .where(and(eq(CanvasTabTable.workspace_id, workspaceID), eq(CanvasTabTable.owner_block_id, blockID)))
                  .all()
                  .pipe(Effect.orDie)
                if (
                  owned.length > 0 &&
                  (!previous || owned.some((tab) => tab.kind !== kind || tab.archivedAt !== null))
                )
                  return yield* new InvalidLayoutError({ message: "Block tab ownership is inconsistent" })
                const layouts = yield* db
                  .select()
                  .from(LayoutTable)
                  .where(eq(LayoutTable.workspace_id, workspaceID))
                  .all()
                  .pipe(Effect.orDie)
                const matching = layouts.filter((row) => row.blocks.some((block) => block.id === blockID))
                if (previous?.deleted_at != null) {
                  const liveInstance = yield* db
                    .select({ id: FunctionalityInstanceTable.id })
                    .from(FunctionalityInstanceTable)
                    .where(
                      and(
                        eq(FunctionalityInstanceTable.workspace_id, workspaceID),
                        eq(FunctionalityInstanceTable.block_id, blockID),
                        isNull(FunctionalityInstanceTable.deleted_at),
                      ),
                    )
                    .get()
                    .pipe(Effect.orDie)
                  if (matching.length > 0 || owned.length > 0 || liveInstance)
                    return yield* new InvalidLayoutError({ message: "Block removal is incomplete" })
                  return { archivedCount: 0, layoutRevision: layout.revision, tabRevision: previous.revision }
                }
                if (layout.revision !== expectedLayoutRevision)
                  return yield* new LayoutConflictError({ currentRevision: layout.revision })
                const descriptor = layout.blocks.find((block) => block.id === blockID)
                if (!descriptor) return yield* new CanvasTabService.NotFoundError({ workspaceID, blockID, kind })
                if (descriptor.functionality !== sessionFunctionalities[kind])
                  return yield* new CanvasTabService.WrongKindError({ workspaceID, blockID, kind })
                if (
                  matching.some((row) =>
                    row.blocks.some(
                      (block) => block.id === blockID && block.functionality !== descriptor.functionality,
                    ),
                  )
                )
                  return yield* new CanvasTabService.WrongKindError({ workspaceID, blockID, kind })
                if (kind !== "chat-relay") {
                  const instance = yield* db
                    .select()
                    .from(FunctionalityInstanceTable)
                    .where(
                      and(
                        eq(FunctionalityInstanceTable.workspace_id, workspaceID),
                        eq(FunctionalityInstanceTable.block_id, blockID),
                        eq(FunctionalityInstanceTable.functionality_id, descriptor.functionality),
                        isNull(FunctionalityInstanceTable.deleted_at),
                      ),
                    )
                    .get()
                    .pipe(Effect.orDie)
                  const config = Schema.decodeUnknownOption(
                    kind === "master-agent" ? MasterAgent.InstanceConfiguration : OperatingChat.InstanceConfiguration,
                  )(instance?.configuration)
                  if (instance && Option.isNone(config))
                    return yield* new InvalidLayoutError({ message: "Block contains an invalid session binding" })
                  if (Option.isSome(config) && config.value.sessionBinding) {
                    const session = yield* db
                      .select()
                      .from(SessionTable)
                      .where(eq(SessionTable.id, config.value.sessionBinding.sessionID))
                      .get()
                      .pipe(Effect.orDie)
                    if (!session || session.workspace_id !== workspaceID || session.runtime !== "v2")
                      return yield* new InvalidLayoutError({
                        message: "Bound session does not belong to this workspace",
                      })
                    yield* tabs.enroll(workspaceID, kind, blockID, session.id, session.title, session.time_created)
                  }
                }
                const registry = yield* db
                  .select()
                  .from(CanvasTabBlockTable)
                  .where(
                    and(
                      eq(CanvasTabBlockTable.workspace_id, workspaceID),
                      eq(CanvasTabBlockTable.block_id, blockID),
                      eq(CanvasTabBlockTable.kind, kind),
                    ),
                  )
                  .get()
                  .pipe(Effect.orDie)
                const now = Date.now()
                const archived = registry
                  ? yield* db
                      .transaction((tx) =>
                        CanvasTabService.archiveBlockInTransaction(
                          tx,
                          { workspaceID, kind, blockID },
                          registry.revision,
                        ),
                      )
                      .pipe(Effect.catchTag("SqlError", Effect.die))
                  : undefined
                if (!registry)
                  yield* db
                    .insert(CanvasTabBlockTable)
                    .values({
                      workspace_id: workspaceID,
                      kind,
                      block_id: blockID,
                      // An uninitialized block has no selected tab; this row is only a deletion fence.
                      selected_tab_id: "",
                      revision: 1,
                      deleted_at: now,
                    })
                    .run()
                    .pipe(Effect.orDie)
                if (kind !== "chat-relay") {
                  yield* Effect.forEach(archived?.archived ?? [], (tab) =>
                    Effect.gen(function* () {
                      const sessionID = SessionSchema.ID.make(tab.conversationID)
                      const session = yield* db
                        .select()
                        .from(SessionTable)
                        .where(eq(SessionTable.id, sessionID))
                        .get()
                        .pipe(Effect.orDie)
                      if (!session || session.workspace_id !== workspaceID || session.runtime !== "v2")
                        return yield* new InvalidLayoutError({
                          message: "Tab session does not belong to this workspace",
                        })
                      yield* events.publish(SessionEvent.ArchiveStateChanged, {
                        sessionID,
                        timestamp: yield* DateTime.now,
                        archived: true,
                      })
                    }),
                  )
                }
                const instances = yield* db
                  .update(FunctionalityInstanceTable)
                  .set({
                    deleted_at: now,
                    time_updated: now,
                    revision: sql`${FunctionalityInstanceTable.revision} + 1`,
                  })
                  .where(
                    and(
                      eq(FunctionalityInstanceTable.workspace_id, workspaceID),
                      eq(FunctionalityInstanceTable.block_id, blockID),
                    ),
                  )
                  .returning()
                  .pipe(Effect.orDie)
                yield* Effect.forEach(matching, (row) =>
                  db
                    .update(LayoutTable)
                    .set({
                      blocks: row.blocks.filter((block) => block.id !== blockID),
                      revision: row.revision + 1,
                      time_updated: now,
                    })
                    .where(eq(LayoutTable.id, row.id))
                    .run()
                    .pipe(Effect.orDie),
                )
                yield* Effect.forEach(instances, (instance) =>
                  events.publish(WorkspaceEvent.FunctionalityInstanceChanged, {
                    workspaceID,
                    blockID,
                    functionalityID: instance.functionality_id,
                    instanceID: instance.id,
                    revision: instance.revision,
                    change: "tombstoned",
                  }),
                )
                yield* Effect.forEach(matching, (row) =>
                  events.publish(WorkspaceEvent.LayoutUpdated, { workspaceID, revision: row.revision + 1 }),
                )
                return {
                  archivedCount: archived?.archivedCount ?? 0,
                  layoutRevision: layout.revision + 1,
                  tabRevision: archived?.revision ?? 1,
                }
              }),
            )
          },
        ),
        get: Effect.fn("Workspace.block.get")(function* (workspaceID, blockID) {
          yield* requireWorkspace(workspaceID)
          const layouts = yield* db
            .select({ blocks: LayoutTable.blocks })
            .from(LayoutTable)
            .innerJoin(
              LayoutOptionTable,
              and(
                eq(LayoutOptionTable.layout_id, LayoutTable.id),
                eq(LayoutOptionTable.workspace_id, LayoutTable.workspace_id),
              ),
            )
            .where(eq(LayoutTable.workspace_id, workspaceID))
            .all()
            .pipe(Effect.orDie)
          return layouts.flatMap((layout) => layout.blocks).find((block) => block.id === blockID)
        }),
      },
      functionality: {
        list: Effect.fn("Workspace.functionality.list")(function* (workspaceID, user) {
          return functionalities(yield* requireWorkspace(workspaceID, user))
        }),
      },
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, EventV2.node, SessionProjector.node, CanvasTabService.node],
})

export { createDefaultLayout }
