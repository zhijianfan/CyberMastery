export * as CanvasTabService from "./canvas-tab"

import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { CanvasTab } from "@opencode-ai/schema/canvas-tab"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"

type Db = Database.Interface["db"]
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0]

type TabRow = {
  readonly id: string
  readonly workspace_id: string
  readonly kind: CanvasTab.Kind
  readonly conversation_id: string
  readonly origin_block_id: string
  readonly owner_block_id: string | null
  readonly title: string
  readonly time_created: number
  readonly time_archived: number | null
  readonly snapshot: unknown
}

type BlockRow = {
  readonly workspace_id: string
  readonly kind: CanvasTab.Kind
  readonly block_id: string
  readonly selected_tab_id: string
  readonly revision: number
  readonly deleted_at: number | null
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("CanvasTab.NotFoundError", {
  workspaceID: Workspace.ID,
  kind: CanvasTab.Kind,
  blockID: Schema.optional(Schema.String),
  tabID: Schema.optional(Schema.String),
}) {}

export class WrongKindError extends Schema.TaggedErrorClass<WrongKindError>()("CanvasTab.WrongKindError", {
  workspaceID: Workspace.ID,
  kind: CanvasTab.Kind,
  tabID: Schema.optional(Schema.String),
  blockID: Schema.optional(Schema.String),
}) {}

export class StaleRevisionError extends Schema.TaggedErrorClass<StaleRevisionError>()("CanvasTab.StaleRevisionError", {
  workspaceID: Workspace.ID,
  blockID: Schema.String,
  expectedRevision: Schema.Number,
  currentRevision: Schema.optional(Schema.Number),
}) {}

export class BusyError extends Schema.TaggedErrorClass<BusyError>()("CanvasTab.BusyError", {
  workspaceID: Workspace.ID,
  kind: CanvasTab.Kind,
  blockID: Schema.optional(Schema.String),
  tabID: Schema.optional(Schema.String),
  ownerBlockID: Schema.optional(Schema.String),
}) {}

export class DeletedBlockError extends Schema.TaggedErrorClass<DeletedBlockError>()("CanvasTab.DeletedBlockError", {
  workspaceID: Workspace.ID,
  kind: CanvasTab.Kind,
  blockID: Schema.String,
}) {}

export { NotFoundError as NotFound }
export { WrongKindError as WrongKind }
export { StaleRevisionError as StaleRevision }
export { DeletedBlockError as DeletedBlock }
export { BusyError as Busy }

export interface AddInput {
  readonly workspaceID: Workspace.ID
  readonly kind: CanvasTab.Kind
  readonly blockID: string
  readonly conversationID: string
  readonly title: string
  readonly createdAt: number
  readonly snapshot?: unknown
}

export interface TabInput {
  readonly workspaceID: Workspace.ID
  readonly kind: CanvasTab.Kind
  readonly blockID: string
  readonly tabID: string
}

export interface ArchiveBlockInput {
  readonly workspaceID: Workspace.ID
  readonly kind: CanvasTab.Kind
  readonly blockID: string
}

export interface MutationResult {
  readonly revision: number
  readonly selected: CanvasTab.Entry
}

export interface ArchiveResult extends MutationResult {
  readonly archivedCount: number
}

export interface Interface {
  readonly listOwned: (
    workspaceID: Workspace.ID,
    kind: CanvasTab.Kind,
    blockID: string,
    cursor: CanvasTab.Cursor | null | undefined,
    limit: number,
  ) => Effect.Effect<CanvasTab.Page>
  readonly listArchived: (
    workspaceID: Workspace.ID,
    kind: CanvasTab.Kind,
    search: string,
    cursor: CanvasTab.Cursor | null | undefined,
    limit: number,
  ) => Effect.Effect<CanvasTab.Page>
  readonly enroll: (
    workspaceID: Workspace.ID,
    kind: CanvasTab.Kind,
    blockID: string,
    conversationID: string,
    title: string,
    createdAt: number,
  ) => Effect.Effect<CanvasTab.Entry, NotFoundError | WrongKindError | BusyError | DeletedBlockError>
  readonly add: (
    input: AddInput,
    expectedRevision: number,
    requestID: string,
  ) => Effect.Effect<
    MutationResult,
    NotFoundError | WrongKindError | StaleRevisionError | BusyError | DeletedBlockError
  >
  readonly select: (
    input: TabInput,
    expectedRevision: number,
  ) => Effect.Effect<
    MutationResult,
    NotFoundError | WrongKindError | StaleRevisionError | BusyError | DeletedBlockError
  >
  readonly restore: (
    input: TabInput,
    expectedRevision: number,
  ) => Effect.Effect<
    MutationResult,
    NotFoundError | WrongKindError | StaleRevisionError | BusyError | DeletedBlockError
  >
  readonly archiveBlock: (
    input: ArchiveBlockInput,
    expectedRevision: number,
  ) => Effect.Effect<ArchiveResult, NotFoundError | WrongKindError | StaleRevisionError | BusyError | DeletedBlockError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/CanvasTab") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const listOwned: Interface["listOwned"] = Effect.fn("CanvasTab.listOwned")(
      function* (workspaceID, kind, blockID, cursor, limit) {
        const pageSize = pageLimit(limit)
        const seek = cursor
          ? sql`AND (time_created < ${cursor.createdAt} OR (time_created = ${cursor.createdAt} AND id < ${cursor.id}))`
          : sql``
        const rows = yield* db
          .all<TabRow>(
            sql`
          SELECT id, workspace_id, kind, conversation_id, origin_block_id, owner_block_id, title, time_created, time_archived, snapshot
          FROM canvas_tab
          WHERE workspace_id = ${workspaceID}
            AND kind = ${kind}
            AND owner_block_id = ${blockID}
            AND time_archived IS NULL
            ${seek}
          ORDER BY time_created DESC, id DESC
          LIMIT ${pageSize + 1}
        `,
          )
          .pipe(Effect.orDie)
        return toPage(rows, pageSize)
      },
    )

    const listArchived: Interface["listArchived"] = Effect.fn("CanvasTab.listArchived")(
      function* (workspaceID, kind, search, cursor, limit) {
        const pageSize = pageLimit(limit)
        const seek = cursor
          ? sql`AND (time_created < ${cursor.createdAt} OR (time_created = ${cursor.createdAt} AND id < ${cursor.id}))`
          : sql``
        const normalized = search.trim().toLowerCase()
        const searchClause = normalized
          ? sql`AND (lower(title) LIKE ${likePattern(normalized)} ESCAPE '\\' OR id = ${search} OR conversation_id = ${search})`
          : sql``
        const rows = yield* db
          .all<TabRow>(
            sql`
          SELECT id, workspace_id, kind, conversation_id, origin_block_id, owner_block_id, title, time_created, time_archived, snapshot
          FROM canvas_tab
          WHERE workspace_id = ${workspaceID}
            AND kind = ${kind}
            AND time_archived IS NOT NULL
            ${searchClause}
            ${seek}
          ORDER BY time_created DESC, id DESC
          LIMIT ${pageSize + 1}
        `,
          )
          .pipe(Effect.orDie)
        return toPage(rows, pageSize)
      },
    )

    const enroll: Interface["enroll"] = Effect.fn("CanvasTab.enroll")(
      function* (workspaceID, kind, blockID, conversationID, title, createdAt) {
        return yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const block = yield* findBlock(tx, workspaceID, kind, blockID)
              if (block && block.deleted_at !== null) return yield* deletedBlock(workspaceID, kind, blockID)
              if (!block) yield* ensureBlockKind(tx, workspaceID, kind, blockID)

              const existing = yield* findConversation(tx, workspaceID, kind, conversationID)
              if (existing) {
                if (existing.owner_block_id === blockID && existing.time_archived === null) return fromRow(existing)
                if (existing.owner_block_id !== null && existing.owner_block_id !== blockID)
                  return yield* new BusyError({
                    workspaceID,
                    kind,
                    blockID,
                    tabID: existing.id,
                    ownerBlockID: existing.owner_block_id,
                  })
                return yield* new BusyError({ workspaceID, kind, blockID, tabID: existing.id })
              }

              const id = crypto.randomUUID()
              const inserted = yield* tx
                .get<TabRow>(
                  sql`
              INSERT INTO canvas_tab (
                id, workspace_id, kind, conversation_id, origin_block_id, owner_block_id, title, time_created, time_archived, snapshot
              ) VALUES (${id}, ${workspaceID}, ${kind}, ${conversationID}, ${blockID}, ${blockID}, ${title}, ${createdAt}, NULL, NULL)
              ON CONFLICT(workspace_id, kind, conversation_id) DO NOTHING
              RETURNING id, workspace_id, kind, conversation_id, origin_block_id, owner_block_id, title, time_created, time_archived, snapshot
            `,
                )
                .pipe(Effect.orDie)
              if (inserted) {
                if (block) {
                  yield* tx
                    .run(
                      sql`UPDATE canvas_tab_block SET selected_tab_id = ${id}, revision = revision + 1 WHERE workspace_id = ${workspaceID} AND kind = ${kind} AND block_id = ${blockID} AND deleted_at IS NULL`,
                    )
                    .pipe(Effect.orDie)
                } else {
                  yield* tx
                    .run(
                      sql`INSERT INTO canvas_tab_block (workspace_id, kind, block_id, selected_tab_id, revision, deleted_at) VALUES (${workspaceID}, ${kind}, ${blockID}, ${id}, 0, NULL)`,
                    )
                    .pipe(Effect.orDie)
                }
                return fromRow(inserted)
              }

              const winner = yield* findConversation(tx, workspaceID, kind, conversationID)
              if (!winner) return yield* Effect.die(new Error("canvas tab enrollment race lost its conversation row"))
              if (winner.owner_block_id === blockID && winner.time_archived === null) return fromRow(winner)
              return yield* new BusyError({
                workspaceID,
                kind,
                blockID,
                tabID: winner.id,
                ownerBlockID: winner.owner_block_id ?? undefined,
              })
            }),
          )
          .pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))
      },
    )

    const add: Interface["add"] = Effect.fn("CanvasTab.add")(function* (input, expectedRevision, requestID) {
      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const block = yield* requireLiveBlock(tx, input.workspaceID, input.kind, input.blockID)
            const existingRequest = yield* findTab(tx, requestID)
            if (existingRequest) {
              if (existingRequest.workspace_id !== input.workspaceID || existingRequest.kind !== input.kind)
                return yield* new BusyError({
                  workspaceID: input.workspaceID,
                  kind: input.kind,
                  blockID: input.blockID,
                  tabID: requestID,
                })
              if (existingRequest.owner_block_id !== input.blockID || existingRequest.time_archived !== null)
                return yield* new BusyError({
                  workspaceID: input.workspaceID,
                  kind: input.kind,
                  blockID: input.blockID,
                  tabID: requestID,
                  ownerBlockID: existingRequest.owner_block_id ?? undefined,
                })
              if (existingRequest.conversation_id !== input.conversationID)
                return yield* new BusyError({
                  workspaceID: input.workspaceID,
                  kind: input.kind,
                  blockID: input.blockID,
                  tabID: requestID,
                })
              return { revision: block.revision, selected: fromRow(existingRequest) }
            }

            const conversation = yield* findConversation(tx, input.workspaceID, input.kind, input.conversationID)
            if (conversation)
              return yield* new BusyError({
                workspaceID: input.workspaceID,
                kind: input.kind,
                blockID: input.blockID,
                tabID: conversation.id,
                ownerBlockID: conversation.owner_block_id ?? undefined,
              })

            const inserted = yield* tx
              .get<TabRow>(
                sql`
              INSERT INTO canvas_tab (
                id, workspace_id, kind, conversation_id, origin_block_id, owner_block_id, title, time_created, time_archived, snapshot
              ) VALUES (${requestID}, ${input.workspaceID}, ${input.kind}, ${input.conversationID}, ${input.blockID}, ${input.blockID}, ${input.title}, ${input.createdAt}, NULL, ${input.snapshot === undefined ? null : JSON.stringify(input.snapshot)})
              ON CONFLICT(workspace_id, kind, conversation_id) DO NOTHING
              RETURNING id, workspace_id, kind, conversation_id, origin_block_id, owner_block_id, title, time_created, time_archived, snapshot
            `,
              )
              .pipe(Effect.orDie)
            if (!inserted) {
              const winner = yield* findConversation(tx, input.workspaceID, input.kind, input.conversationID)
              if (!winner) return yield* Effect.die(new Error("canvas tab add race lost its conversation row"))
              return yield* new BusyError({
                workspaceID: input.workspaceID,
                kind: input.kind,
                blockID: input.blockID,
                tabID: winner.id,
                ownerBlockID: winner.owner_block_id ?? undefined,
              })
            }

            const claimed = yield* tx
              .get<{ revision: number }>(
                sql`
            UPDATE canvas_tab_block
            SET selected_tab_id = ${requestID}, revision = ${expectedRevision + 1}
            WHERE workspace_id = ${input.workspaceID}
              AND kind = ${input.kind}
              AND block_id = ${input.blockID}
              AND revision = ${expectedRevision}
              AND deleted_at IS NULL
            RETURNING revision
          `,
              )
              .pipe(Effect.orDie)
            if (!claimed)
              return yield* staleRevision(tx, input.workspaceID, input.kind, input.blockID, expectedRevision)
            return { revision: claimed.revision, selected: fromRow(inserted) }
          }),
        )
        .pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))
    })

    const select: Interface["select"] = Effect.fn("CanvasTab.select")(function* (input, expectedRevision) {
      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const target = yield* requireTarget(tx, input)
            if (target.owner_block_id !== input.blockID || target.time_archived !== null)
              return yield* new BusyError({
                workspaceID: input.workspaceID,
                kind: input.kind,
                blockID: input.blockID,
                tabID: input.tabID,
                ownerBlockID: target.owner_block_id ?? undefined,
              })
            const block = yield* requireLiveBlock(tx, input.workspaceID, input.kind, input.blockID)
            if (block.selected_tab_id === input.tabID) return { revision: block.revision, selected: fromRow(target) }
            const claimed = yield* tx
              .get<{ revision: number }>(
                sql`
            UPDATE canvas_tab_block
            SET selected_tab_id = ${input.tabID}, revision = ${expectedRevision + 1}
            WHERE workspace_id = ${input.workspaceID}
              AND kind = ${input.kind}
              AND block_id = ${input.blockID}
              AND revision = ${expectedRevision}
              AND deleted_at IS NULL
            RETURNING revision
          `,
              )
              .pipe(Effect.orDie)
            if (!claimed)
              return yield* staleRevision(tx, input.workspaceID, input.kind, input.blockID, expectedRevision)
            return { revision: claimed.revision, selected: fromRow(target) }
          }),
        )
        .pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))
    })

    const restore: Interface["restore"] = Effect.fn("CanvasTab.restore")(function* (input, expectedRevision) {
      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const target = yield* requireTarget(tx, input)
            const block = yield* requireLiveBlock(tx, input.workspaceID, input.kind, input.blockID)
            if (target.owner_block_id === input.blockID && target.time_archived === null) {
              if (block.selected_tab_id === input.tabID) return { revision: block.revision, selected: fromRow(target) }
              const claimed = yield* tx
                .get<{ revision: number }>(
                  sql`
              UPDATE canvas_tab_block
              SET selected_tab_id = ${input.tabID}, revision = ${expectedRevision + 1}
              WHERE workspace_id = ${input.workspaceID}
                AND kind = ${input.kind}
                AND block_id = ${input.blockID}
                AND revision = ${expectedRevision}
                AND deleted_at IS NULL
              RETURNING revision
            `,
                )
                .pipe(Effect.orDie)
              if (!claimed)
                return yield* staleRevision(tx, input.workspaceID, input.kind, input.blockID, expectedRevision)
              return { revision: claimed.revision, selected: fromRow(target) }
            }
            if (target.owner_block_id !== null || target.time_archived === null)
              return yield* new BusyError({
                workspaceID: input.workspaceID,
                kind: input.kind,
                blockID: input.blockID,
                tabID: input.tabID,
                ownerBlockID: target.owner_block_id ?? undefined,
              })

            const claimed = yield* tx
              .get<{ revision: number }>(
                sql`
            UPDATE canvas_tab_block
            SET selected_tab_id = ${input.tabID}, revision = ${expectedRevision + 1}
            WHERE workspace_id = ${input.workspaceID}
              AND kind = ${input.kind}
              AND block_id = ${input.blockID}
              AND revision = ${expectedRevision}
              AND deleted_at IS NULL
            RETURNING revision
          `,
              )
              .pipe(Effect.orDie)
            if (!claimed)
              return yield* staleRevision(tx, input.workspaceID, input.kind, input.blockID, expectedRevision)
            const moved = yield* tx
              .get<TabRow>(
                sql`
            UPDATE canvas_tab
            SET owner_block_id = ${input.blockID}, time_archived = NULL
            WHERE id = ${input.tabID}
              AND workspace_id = ${input.workspaceID}
              AND kind = ${input.kind}
              AND owner_block_id IS NULL
              AND time_archived IS NOT NULL
            RETURNING id, workspace_id, kind, conversation_id, origin_block_id, owner_block_id, title, time_created, time_archived, snapshot
          `,
              )
              .pipe(Effect.orDie)
            if (!moved)
              return yield* new BusyError({
                workspaceID: input.workspaceID,
                kind: input.kind,
                blockID: input.blockID,
                tabID: input.tabID,
              })
            return { revision: claimed.revision, selected: fromRow(moved) }
          }),
        )
        .pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))
    })

    const archiveBlock: Interface["archiveBlock"] = Effect.fn("CanvasTab.archiveBlock")(
      function* (input, expectedRevision) {
        return yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const block = yield* findBlock(tx, input.workspaceID, input.kind, input.blockID)
              if (!block) {
                yield* ensureBlockKind(tx, input.workspaceID, input.kind, input.blockID)
                return yield* new NotFoundError({
                  workspaceID: input.workspaceID,
                  kind: input.kind,
                  blockID: input.blockID,
                })
              }
              const selected = yield* findTab(tx, block.selected_tab_id)
              if (block.deleted_at !== null) {
                if (!selected)
                  return yield* new NotFoundError({
                    workspaceID: input.workspaceID,
                    kind: input.kind,
                    blockID: input.blockID,
                  })
                return { revision: block.revision, selected: fromRow(selected), archivedCount: 0 }
              }
              const archived = yield* tx
                .all<TabRow>(
                  sql`
              UPDATE canvas_tab
              SET owner_block_id = NULL, time_archived = ${Date.now()}
              WHERE workspace_id = ${input.workspaceID}
                AND kind = ${input.kind}
                AND owner_block_id = ${input.blockID}
                AND time_archived IS NULL
              RETURNING id, workspace_id, kind, conversation_id, origin_block_id, owner_block_id, title, time_created, time_archived, snapshot
            `,
                )
                .pipe(Effect.orDie)
              const claimed = yield* tx
                .get<{ revision: number }>(
                  sql`
            UPDATE canvas_tab_block
            SET revision = ${expectedRevision + 1}, deleted_at = ${Date.now()}
            WHERE workspace_id = ${input.workspaceID}
              AND kind = ${input.kind}
              AND block_id = ${input.blockID}
              AND revision = ${expectedRevision}
              AND deleted_at IS NULL
            RETURNING revision
          `,
                )
                .pipe(Effect.orDie)
              if (!claimed)
                return yield* staleRevision(tx, input.workspaceID, input.kind, input.blockID, expectedRevision)
              const selectedArchived =
                archived.find((row) => row.id === block.selected_tab_id) ??
                (selected ? { ...selected, owner_block_id: null, time_archived: Date.now() } : undefined)
              if (!selectedArchived)
                return yield* new NotFoundError({
                  workspaceID: input.workspaceID,
                  kind: input.kind,
                  blockID: input.blockID,
                })
              return { revision: claimed.revision, selected: fromRow(selectedArchived), archivedCount: archived.length }
            }),
          )
          .pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))
      },
    )

    return Service.of({ listOwned, listArchived, enroll, add, select, restore, archiveBlock })
  }),
)

function pageLimit(limit: number) {
  return Math.max(1, Math.min(100, Math.trunc(limit)))
}

function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, "\\$&")}%`
}

function toPage(rows: readonly TabRow[], limit: number): CanvasTab.Page {
  const items = rows.slice(0, limit).map(fromRow)
  const last = items[items.length - 1]
  return {
    items,
    next: rows.length >= limit && last ? { createdAt: last.createdAt, id: last.id } : null,
  }
}

function fromRow(row: TabRow): CanvasTab.Entry {
  return {
    id: row.id,
    workspaceID: Workspace.ID.make(row.workspace_id),
    kind: row.kind,
    ...(row.owner_block_id === null ? {} : { blockID: row.owner_block_id }),
    conversationID: row.conversation_id,
    title: row.title,
    createdAt: row.time_created,
    ...(row.time_archived === null ? {} : { archivedAt: row.time_archived }),
    writable: row.time_archived === null,
  }
}

function findTab(tx: Transaction, tabID: string) {
  return tx
    .get<TabRow>(
      sql`
    SELECT id, workspace_id, kind, conversation_id, origin_block_id, owner_block_id, title, time_created, time_archived, snapshot
    FROM canvas_tab
    WHERE id = ${tabID}
  `,
    )
    .pipe(Effect.orDie)
}

function findConversation(tx: Transaction, workspaceID: Workspace.ID, kind: CanvasTab.Kind, conversationID: string) {
  return tx
    .get<TabRow>(
      sql`
    SELECT id, workspace_id, kind, conversation_id, origin_block_id, owner_block_id, title, time_created, time_archived, snapshot
    FROM canvas_tab
    WHERE workspace_id = ${workspaceID} AND kind = ${kind} AND conversation_id = ${conversationID}
  `,
    )
    .pipe(Effect.orDie)
}

function findBlock(tx: Transaction, workspaceID: Workspace.ID, kind: CanvasTab.Kind, blockID: string) {
  return tx
    .get<BlockRow>(
      sql`
    SELECT workspace_id, kind, block_id, selected_tab_id, revision, deleted_at
    FROM canvas_tab_block
    WHERE workspace_id = ${workspaceID} AND kind = ${kind} AND block_id = ${blockID}
  `,
    )
    .pipe(Effect.orDie)
}

function ensureBlockKind(tx: Transaction, workspaceID: Workspace.ID, kind: CanvasTab.Kind, blockID: string) {
  return Effect.gen(function* () {
    const other = yield* tx
      .get<{ kind: CanvasTab.Kind }>(
        sql`
      SELECT kind FROM canvas_tab_block WHERE workspace_id = ${workspaceID} AND block_id = ${blockID} LIMIT 1
    `,
      )
      .pipe(Effect.orDie)
    if (other && other.kind !== kind) return yield* new WrongKindError({ workspaceID, kind, blockID })
  })
}

function requireLiveBlock(tx: Transaction, workspaceID: Workspace.ID, kind: CanvasTab.Kind, blockID: string) {
  return Effect.gen(function* () {
    const block = yield* findBlock(tx, workspaceID, kind, blockID)
    if (!block) {
      yield* ensureBlockKind(tx, workspaceID, kind, blockID)
      return yield* new NotFoundError({ workspaceID, kind, blockID })
    }
    if (block.deleted_at !== null) return yield* new DeletedBlockError({ workspaceID, kind, blockID })
    return block
  })
}

function requireTarget(tx: Transaction, input: TabInput) {
  return Effect.gen(function* () {
    const target = yield* findTab(tx, input.tabID)
    if (!target || target.workspace_id !== input.workspaceID)
      return yield* new NotFoundError({ workspaceID: input.workspaceID, kind: input.kind, tabID: input.tabID })
    if (target.kind !== input.kind)
      return yield* new WrongKindError({
        workspaceID: input.workspaceID,
        kind: input.kind,
        blockID: input.blockID,
        tabID: input.tabID,
      })
    return target
  })
}

function staleRevision(
  tx: Transaction,
  workspaceID: Workspace.ID,
  kind: CanvasTab.Kind,
  blockID: string,
  expectedRevision: number,
) {
  return Effect.gen(function* () {
    const current = yield* findBlock(tx, workspaceID, kind, blockID)
    if (current?.deleted_at !== null) return yield* new DeletedBlockError({ workspaceID, kind, blockID })
    return yield* new StaleRevisionError({
      workspaceID,
      blockID,
      expectedRevision,
      currentRevision: current?.revision,
    })
  })
}

function deletedBlock(workspaceID: Workspace.ID, kind: CanvasTab.Kind, blockID: string) {
  return new DeletedBlockError({ workspaceID, kind, blockID })
}

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
