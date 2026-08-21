import { desc, sql, type SQL } from "drizzle-orm"
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Context, Effect, Layer } from "effect"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import type { CtxPackError, CtxPackListRequest, CtxPackListResult, CtxPackSort } from "@opencode-ai/schema/ctxpack"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"

// Tables ----------------------------------------------------------------------

export const CtxPackTable = sqliteTable(
  "ctx_pack",
  {
    id: text().$type<CtxPack.ID>().primaryKey(),
    workspace_id: text().notNull(),
    created_by_user_id: text().notNull(),
    title: text().notNull(),
    sensitivity: text().$type<CtxPack.Sensitivity>().notNull(),
    revision: integer().notNull(),
    content_hash: text().notNull(),
    byte_length: integer().notNull(),
    estimated_tokens: integer().notNull(),
    attached_count: integer()
      .notNull()
      .default(0),
    last_attached_at: integer(),
    create_idempotency_key: text().notNull(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
    time_deleted: integer(),
  },
  (table) => [
    uniqueIndex("ctx_pack_create_idempotency_idx").on(table.workspace_id, table.created_by_user_id, table.create_idempotency_key),
    index("ctx_pack_workspace_created_idx").on(table.workspace_id, desc(table.time_created), desc(table.id)),
    index("ctx_pack_workspace_updated_idx").on(table.workspace_id, desc(table.time_updated), desc(table.id)),
    index("ctx_pack_workspace_usage_idx").on(table.workspace_id, desc(table.attached_count), desc(table.id)),
    index("ctx_pack_workspace_last_used_idx").on(table.workspace_id, desc(table.last_attached_at), desc(table.id)),
  ],
)

export const CtxPackFragmentTable = sqliteTable(
  "ctx_pack_fragment",
  {
    id: text().$type<CtxPack.FragmentID>().primaryKey(),
    ctx_pack_id: text()
      .$type<CtxPack.ID>()
      .notNull()
      .references(() => CtxPackTable.id),
    ordinal: integer().notNull(),
    text_content: text().notNull(),
    content_hash: text().notNull(),
    byte_length: integer().notNull(),
    estimated_tokens: integer().notNull(),
    source_workspace_id: text().notNull(),
    source_block_id: text().notNull(),
    source_functionality_id: text().notNull(),
    source_kind: text().$type<CtxPack.SourceKind>().notNull(),
    source_direction: text().$type<CtxPack.Direction>().notNull(),
    source_timestamp: integer(),
    captured_at: integer().notNull(),
    entity_ref_json: text({ mode: "json" }).$type<{ type: string; id: string } | null>(),
    source_label: text(),
    source_metadata_json: text({ mode: "json" }).notNull().$type<Record<string, string | number | boolean | null>>(),
    source_sensitivity: text().$type<CtxPack.Sensitivity>().notNull(),
  },
  (table) => [
    uniqueIndex("ctx_pack_fragment_pack_ordinal_idx").on(table.ctx_pack_id, table.ordinal),
    index("ctx_pack_fragment_pack_idx").on(table.ctx_pack_id, table.ordinal),
    index("ctx_pack_fragment_source_block_idx").on(table.source_workspace_id, table.source_block_id, table.ctx_pack_id),
    index("ctx_pack_fragment_source_functionality_idx").on(
      table.source_workspace_id,
      table.source_functionality_id,
      table.ctx_pack_id,
    ),
    index("ctx_pack_fragment_source_kind_idx").on(table.source_workspace_id, table.source_kind, table.ctx_pack_id),
  ],
)

export const CtxPackKeywordTable = sqliteTable(
  "ctx_pack_keyword",
  {
    ctx_pack_id: text()
      .$type<CtxPack.ID>()
      .notNull()
      .references(() => CtxPackTable.id),
    ordinal: integer().notNull(),
    keyword_display: text().notNull(),
    keyword_normalized: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ctx_pack_id, table.keyword_normalized] }),
    index("ctx_pack_keyword_lookup_idx").on(table.keyword_normalized, table.ctx_pack_id),
  ],
)

// Usage admission ledger (M1 addition: C2's durable table lives here so the
// drizzle schema glob picks it up for fresh databases; the raw SQL migration
// `20260821_ctxpack_usage.ts` must agree exactly).
export const CtxPackUsageAdmissionTable = sqliteTable(
  "ctx_pack_usage_admission",
  {
    ctx_pack_id: text().notNull(),
    session_input_id: text().notNull(),
    time_recorded: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.ctx_pack_id, table.session_input_id] })],
)

// The FTS5 virtual table is created by the raw SQL migration for existing
// databases, but the fresh-database snapshot path (schema.gen.ts) cannot
// express virtual tables — drizzle has no portable FTS5 support. Ensure it
// exists lazily so fresh databases get a working index before the first
// write/search. Idempotent; cheap after the first call.
export const ensureCtxPackFts = Effect.fn("CtxPackSQL.ensureFts")(function* (db: Database.Interface["db"]) {
  yield* db.run(
    sql`CREATE VIRTUAL TABLE IF NOT EXISTS ctx_pack_fts USING fts5(
      ctx_pack_id UNINDEXED,
      workspace_id UNINDEXED,
      title,
      keywords,
      content,
      tokenize = 'unicode61 remove_diacritics 2'
    )`,
  )
})

// Rows ------------------------------------------------------------------------

type CtxPackRow = {
  id: string
  workspace_id: string
  created_by_user_id: string
  title: string
  sensitivity: string
  revision: number
  content_hash: string
  byte_length: number
  estimated_tokens: number
  attached_count: number
  last_attached_at: number | null
  create_idempotency_key: string
  time_created: number
  time_updated: number
  time_deleted: number | null
}

type CtxPackFragmentRow = {
  id: string
  ctx_pack_id: string
  ordinal: number
  text_content: string
  content_hash: string
  byte_length: number
  estimated_tokens: number
  source_workspace_id: string
  source_block_id: string
  source_functionality_id: string
  source_kind: string
  source_direction: string
  source_timestamp: number | null
  captured_at: number
  entity_ref_json: string | null
  source_label: string | null
  source_metadata_json: string
  source_sensitivity: string
}

type CtxPackKeywordRow = {
  ctx_pack_id: string
  ordinal: number
  keyword_display: string
  keyword_normalized: string
}

// Errors ----------------------------------------------------------------------

const CTX_PACK_ERROR_TAGS = new Set([
  "CtxPackNotFound",
  "CtxPackDeleted",
  "CtxPackRevisionConflict",
  "CtxPackContentChanged",
  "CtxPackInvalidSelection",
  "CtxPackBudgetExceeded",
  "CtxPackSecretSourceDenied",
  "CtxPackCrossWorkspaceDenied",
  "CtxPackPermissionDenied",
  "CtxPackSearchCursorInvalid",
])

function isCtxPackError(value: unknown): value is CtxPackError {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    typeof (value as { _tag: unknown })._tag === "string" &&
    CTX_PACK_ERROR_TAGS.has((value as { _tag: string })._tag)
  )
}

// Storage failures surface as defects; only domain errors fail the effect.
function toDomainError<A, E>(effect: Effect.Effect<A, E, never>): Effect.Effect<A, CtxPackError, never> {
  return Effect.catch(effect, (error) => (isCtxPackError(error) ? Effect.fail(error) : Effect.die(error)))
}

// Cursors ---------------------------------------------------------------------

const CURSOR_VERSION = 1

function encodeCursor(sort: CtxPackSort, value: string | number | null, id: string): string {
  return Buffer.from(JSON.stringify({ version: CURSOR_VERSION, sort, value, id })).toString("base64url")
}

function decodeCursor(cursor: string, sort: CtxPackSort): { value: string | number | null; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    if (parsed === null || typeof parsed !== "object") return null
    const record = parsed as Record<string, unknown>
    if (record.version !== CURSOR_VERSION) return null
    if (record.sort !== sort) return null
    if (typeof record.id !== "string" || record.id.length === 0) return null
    const value = record.value
    if (value !== null && typeof value !== "string" && typeof value !== "number") return null
    return { value, id: record.id }
  } catch {
    return null
  }
}

type SortSpec = {
  readonly column: SQL
  readonly direction: "ASC" | "DESC"
  readonly nullsLast: boolean
  readonly value: (row: CtxPackRow) => string | number | null
}

const SORTS: Record<CtxPackSort, SortSpec> = {
  "created-desc": { column: sql`p.time_created`, direction: "DESC", nullsLast: false, value: (row) => row.time_created },
  "created-asc": { column: sql`p.time_created`, direction: "ASC", nullsLast: false, value: (row) => row.time_created },
  "updated-desc": { column: sql`p.time_updated`, direction: "DESC", nullsLast: false, value: (row) => row.time_updated },
  "title-asc": { column: sql`p.title`, direction: "ASC", nullsLast: false, value: (row) => row.title },
  "tokens-desc": { column: sql`p.estimated_tokens`, direction: "DESC", nullsLast: false, value: (row) => row.estimated_tokens },
  "most-attached": { column: sql`p.attached_count`, direction: "DESC", nullsLast: false, value: (row) => row.attached_count },
  "recently-attached": {
    column: sql`p.last_attached_at`,
    direction: "DESC",
    nullsLast: true,
    value: (row) => row.last_attached_at,
  },
}

function cursorCondition(sort: SortSpec, cursor: { value: string | number | null; id: string }): SQL {
  const { column, direction, nullsLast } = sort
  const value = cursor.value
  const id = cursor.id
  if (direction === "DESC") {
    if (nullsLast && value === null) return sql`(${column} IS NULL AND p.id < ${id})`
    if (nullsLast) return sql`(${column} IS NULL OR ${column} < ${value} OR (${column} = ${value} AND p.id < ${id}))`
    return sql`(${column} < ${value} OR (${column} = ${value} AND p.id < ${id}))`
  }
  if (nullsLast && value === null) return sql`(${column} IS NULL AND p.id > ${id})`
  if (nullsLast) return sql`(${column} IS NULL OR ${column} > ${value} OR (${column} = ${value} AND p.id > ${id}))`
  return sql`(${column} > ${value} OR (${column} = ${value} AND p.id > ${id}))`
}

// Mapping ---------------------------------------------------------------------

function fragmentFrom(row: CtxPackFragmentRow): CtxPack.Fragment {
  return {
    id: row.id as CtxPack.FragmentID,
    ordinal: row.ordinal,
    // The clientFragmentID is a create-time input; it is not persisted. The
    // server-assigned fragment id doubles as the stable client reference.
    clientFragmentID: row.id,
    text: row.text_content,
    source: {
      workspaceID: row.source_workspace_id,
      blockID: row.source_block_id,
      functionalityID: row.source_functionality_id,
      kind: row.source_kind as CtxPack.SourceKind,
      direction: row.source_direction as CtxPack.Direction,
      sourceTimestamp: row.source_timestamp,
      capturedAt: row.captured_at,
      entityRef: row.entity_ref_json === null ? null : JSON.parse(row.entity_ref_json),
      label: row.source_label,
      metadata: JSON.parse(row.source_metadata_json),
      sensitivity: row.source_sensitivity as CtxPack.Sensitivity,
    },
    contentHash: row.content_hash,
    byteLength: row.byte_length,
    estimatedTokens: row.estimated_tokens,
  }
}

function infoFrom(row: CtxPackRow, fragments: CtxPackFragmentRow[], keywords: CtxPackKeywordRow[]): CtxPack.Info {
  return {
    id: row.id as CtxPack.ID,
    workspaceID: row.workspace_id,
    title: row.title,
    keywords: keywords.map((keyword) => keyword.keyword_display),
    sensitivity: row.sensitivity as CtxPack.Sensitivity,
    revision: row.revision,
    contentHash: row.content_hash,
    byteLength: row.byte_length,
    estimatedTokens: row.estimated_tokens,
    fragments: fragments.map(fragmentFrom),
    usage: { attachedCount: row.attached_count, lastAttachedAt: row.last_attached_at },
    createdByUserID: row.created_by_user_id,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
    deletedAt: row.time_deleted,
  }
}

function summaryFrom(row: CtxPackRow, fragments: CtxPackFragmentRow[], keywords: CtxPackKeywordRow[]): CtxPack.Summary {
  return {
    id: row.id as CtxPack.ID,
    workspaceID: row.workspace_id,
    title: row.title,
    keywords: keywords.map((keyword) => keyword.keyword_display),
    sensitivity: row.sensitivity as CtxPack.Sensitivity,
    revision: row.revision,
    contentHash: row.content_hash,
    byteLength: row.byte_length,
    estimatedTokens: row.estimated_tokens,
    fragmentCount: fragments.length,
    sourceBlockIDs: [...new Set(fragments.map((fragment) => fragment.source_block_id))],
    sourceFunctionalityIDs: [...new Set(fragments.map((fragment) => fragment.source_functionality_id))],
    sourceKinds: [...new Set(fragments.map((fragment) => fragment.source_kind))] as CtxPack.SourceKind[],
    usage: { attachedCount: row.attached_count, lastAttachedAt: row.last_attached_at },
    createdAt: row.time_created,
    updatedAt: row.time_updated,
    deletedAt: row.time_deleted,
  }
}

function ftsKeywords(keywords: CtxPackKeywordRow[]): string {
  return keywords
    .map((keyword) => keyword.keyword_normalized)
    .join(" ")
    .trim()
}

function ftsContent(fragments: CtxPackFragmentRow[]): string {
  return fragments
    .map((fragment) => fragment.text_content)
    .join("\n")
}

// Repository ------------------------------------------------------------------

type Db = Database.Interface["db"]

export function make(db: Db): CtxPackRepository {
  const selectRow = (workspaceID: string, ctxPackID: CtxPack.ID) =>
    db.get<CtxPackRow>(sql`SELECT * FROM ctx_pack WHERE id = ${ctxPackID} AND workspace_id = ${workspaceID}`)

  const selectFragments = (ctxPackID: CtxPack.ID) =>
    db.all<CtxPackFragmentRow>(sql`SELECT * FROM ctx_pack_fragment WHERE ctx_pack_id = ${ctxPackID} ORDER BY ordinal`)

  const selectKeywords = (ctxPackID: CtxPack.ID) =>
    db.all<CtxPackKeywordRow>(sql`SELECT * FROM ctx_pack_keyword WHERE ctx_pack_id = ${ctxPackID} ORDER BY ordinal`)

  const loadInfo = (workspaceID: string, ctxPackID: CtxPack.ID) =>
    Effect.gen(function* () {
      const row = yield* selectRow(workspaceID, ctxPackID)
      if (!row) return yield* Effect.fail({ _tag: "CtxPackNotFound", ctxPackID } satisfies CtxPackError)
      const [fragments, keywords] = yield* Effect.all([selectFragments(ctxPackID), selectKeywords(ctxPackID)])
      return infoFrom(row, fragments, keywords)
    })

  return {
    create(input) {
      return toDomainError(
        Effect.gen(function* () {
          const id = CtxPack.ID.create()
          const fragments = input.fragments.map((fragment, ordinal) => {
            const text = CtxPack.normalizeSelectedText(fragment.text)
            const byteLength = CtxPack.utf8ByteLength(text)
            return {
              id: CtxPack.FragmentID.create(),
              ordinal,
              clientFragmentID: fragment.clientFragmentID,
              text,
              source: fragment.source,
              contentHash: CtxPack.contentHash([{ ordinal, text: fragment.text, source: fragment.source }]),
              byteLength,
              estimatedTokens: CtxPack.estimateTokens(byteLength),
            }
          })
          const contentHash = CtxPack.contentHash(
            input.fragments.map((fragment, ordinal) => ({ ordinal, text: fragment.text, source: fragment.source })),
          )
          const byteLength = fragments.reduce((sum, fragment) => sum + fragment.byteLength, 0)
          const estimatedTokens = fragments.reduce((sum, fragment) => sum + fragment.estimatedTokens, 0)
          const keywords = input.keywords.map((keyword, ordinal) => ({
            ordinal,
            display: keyword,
            normalized: CtxPack.normalizeKeyword(keyword),
          }))

          const packID = yield* db.transaction((tx) =>
            Effect.gen(function* () {
              const inserted = yield* tx.get<{ id: CtxPack.ID }>(
                sql`INSERT INTO ctx_pack (id, workspace_id, created_by_user_id, title, sensitivity, revision, content_hash, byte_length, estimated_tokens, attached_count, last_attached_at, create_idempotency_key, time_created, time_updated, time_deleted) VALUES (${id}, ${input.workspaceID}, ${input.createdByUserID}, ${input.title}, ${input.sensitivity}, 1, ${contentHash}, ${byteLength}, ${estimatedTokens}, 0, NULL, ${input.idempotencyKey}, ${input.now}, ${input.now}, NULL) ON CONFLICT(workspace_id, created_by_user_id, create_idempotency_key) DO NOTHING RETURNING id`,
              )
              if (!inserted) {
                const winner = yield* tx.get<CtxPackRow>(
                  sql`SELECT * FROM ctx_pack WHERE workspace_id = ${input.workspaceID} AND created_by_user_id = ${input.createdByUserID} AND create_idempotency_key = ${input.idempotencyKey}`,
                )
                if (!winner) return yield* Effect.die(new Error("ctx_pack create race did not find winner row"))
                return winner.id as CtxPack.ID
              }
              for (const fragment of fragments) {
                yield* tx.run(
                  sql`INSERT INTO ctx_pack_fragment (id, ctx_pack_id, ordinal, text_content, content_hash, byte_length, estimated_tokens, source_workspace_id, source_block_id, source_functionality_id, source_kind, source_direction, source_timestamp, captured_at, entity_ref_json, source_label, source_metadata_json, source_sensitivity) VALUES (${fragment.id}, ${id}, ${fragment.ordinal}, ${fragment.text}, ${fragment.contentHash}, ${fragment.byteLength}, ${fragment.estimatedTokens}, ${fragment.source.workspaceID}, ${fragment.source.blockID}, ${fragment.source.functionalityID}, ${fragment.source.kind}, ${fragment.source.direction}, ${fragment.source.sourceTimestamp}, ${fragment.source.capturedAt}, ${JSON.stringify(fragment.source.entityRef)}, ${fragment.source.label}, ${JSON.stringify(fragment.source.metadata)}, ${fragment.source.sensitivity})`,
                )
              }
              for (const keyword of keywords) {
                yield* tx.run(
                  sql`INSERT INTO ctx_pack_keyword (ctx_pack_id, ordinal, keyword_display, keyword_normalized) VALUES (${id}, ${keyword.ordinal}, ${keyword.display}, ${keyword.normalized})`,
                )
              }
              yield* tx.run(
                sql`INSERT INTO ctx_pack_fts (ctx_pack_id, workspace_id, title, keywords, content) VALUES (${id}, ${input.workspaceID}, ${input.title}, ${keywords
                  .map((keyword) => keyword.normalized)
                  .join(" ")}, ${fragments.map((fragment) => fragment.text).join("\n")})`,
              )
              return id
            }),
          )
          return yield* loadInfo(input.workspaceID, packID)
        }),
      )
    },

    get(workspaceID, ctxPackID, includeDeleted) {
      return toDomainError(
        Effect.gen(function* () {
          const row = yield* selectRow(workspaceID, ctxPackID)
          if (!row) return yield* Effect.fail({ _tag: "CtxPackNotFound", ctxPackID } satisfies CtxPackError)
          if (row.time_deleted !== null && !includeDeleted)
            return yield* Effect.fail({ _tag: "CtxPackDeleted", ctxPackID } satisfies CtxPackError)
          return yield* loadInfo(workspaceID, ctxPackID)
        }),
      )
    },

    patchMetadata(input) {
      return toDomainError(
        Effect.gen(function* () {
          const row = yield* selectRow(input.workspaceID, input.ctxPackID)
          if (!row) return yield* Effect.fail({ _tag: "CtxPackNotFound", ctxPackID: input.ctxPackID } satisfies CtxPackError)
          if (row.time_deleted !== null)
            return yield* Effect.fail({ _tag: "CtxPackDeleted", ctxPackID: input.ctxPackID } satisfies CtxPackError)
          if (row.revision !== input.expectedRevision)
            return yield* Effect.fail({ _tag: "CtxPackRevisionConflict", currentRevision: row.revision } satisfies CtxPackError)

          const title = input.patch.title ?? row.title
          const sensitivity = input.patch.sensitivity ?? (row.sensitivity as CtxPack.Sensitivity)
          const revision = row.revision + 1
          const keywords =
            input.patch.keywords !== undefined
              ? input.patch.keywords.map((keyword, ordinal) => ({
                  ordinal,
                  display: keyword,
                  normalized: CtxPack.normalizeKeyword(keyword),
                }))
              : (yield* selectKeywords(input.ctxPackID)).map((keyword) => ({
                  ordinal: keyword.ordinal,
                  display: keyword.keyword_display,
                  normalized: keyword.keyword_normalized,
                }))

          yield* db.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.run(
                sql`UPDATE ctx_pack SET title = ${title}, sensitivity = ${sensitivity}, revision = ${revision}, time_updated = ${input.now} WHERE id = ${input.ctxPackID} AND workspace_id = ${input.workspaceID}`,
              )
              if (input.patch.keywords !== undefined) {
                yield* tx.run(sql`DELETE FROM ctx_pack_keyword WHERE ctx_pack_id = ${input.ctxPackID}`)
                for (const keyword of keywords) {
                  yield* tx.run(
                    sql`INSERT INTO ctx_pack_keyword (ctx_pack_id, ordinal, keyword_display, keyword_normalized) VALUES (${input.ctxPackID}, ${keyword.ordinal}, ${keyword.display}, ${keyword.normalized})`,
                  )
                }
              }
              // Metadata patches rewrite only the title/keywords fields of the FTS row.
              if (input.patch.title !== undefined || input.patch.keywords !== undefined) {
                yield* tx.run(
                  sql`UPDATE ctx_pack_fts SET title = ${title}, keywords = ${keywords
                    .map((keyword) => keyword.normalized)
                    .join(" ")} WHERE ctx_pack_id = ${input.ctxPackID}`,
                )
              }
            }),
          )
          return yield* loadInfo(input.workspaceID, input.ctxPackID)
        }),
      )
    },

    list(input) {
      return toDomainError(
        Effect.gen(function* () {
          const sort = SORTS[input.sort]
          const cursor = input.cursor === null ? null : decodeCursor(input.cursor, input.sort)
          if (input.cursor !== null && cursor === null)
            return yield* Effect.fail({ _tag: "CtxPackSearchCursorInvalid" } satisfies CtxPackError)

          const conditions: SQL[] = [sql`p.workspace_id = ${input.workspaceID}`]
          if (!input.includeDeleted) conditions.push(sql`p.time_deleted IS NULL`)
          if (input.sensitivity !== null) conditions.push(sql`p.sensitivity = ${input.sensitivity}`)
          if (input.createdAfter !== null) conditions.push(sql`p.time_created > ${input.createdAfter}`)
          if (input.createdBefore !== null) conditions.push(sql`p.time_created < ${input.createdBefore}`)
          if (input.keyword !== null)
            conditions.push(
              sql`EXISTS (SELECT 1 FROM ctx_pack_keyword k WHERE k.ctx_pack_id = p.id AND k.keyword_normalized = ${CtxPack.normalizeKeyword(input.keyword)})`,
            )
          if (input.sourceBlockID !== null)
            conditions.push(
              sql`EXISTS (SELECT 1 FROM ctx_pack_fragment f WHERE f.ctx_pack_id = p.id AND f.source_workspace_id = p.workspace_id AND f.source_block_id = ${input.sourceBlockID})`,
            )
          if (input.sourceFunctionalityID !== null)
            conditions.push(
              sql`EXISTS (SELECT 1 FROM ctx_pack_fragment f WHERE f.ctx_pack_id = p.id AND f.source_workspace_id = p.workspace_id AND f.source_functionality_id = ${input.sourceFunctionalityID})`,
            )
          if (input.sourceKind !== null)
            conditions.push(
              sql`EXISTS (SELECT 1 FROM ctx_pack_fragment f WHERE f.ctx_pack_id = p.id AND f.source_workspace_id = p.workspace_id AND f.source_kind = ${input.sourceKind})`,
            )
          if (input.query.trim().length > 0)
            conditions.push(
              sql`EXISTS (SELECT 1 FROM ctx_pack_fts WHERE ctx_pack_id = p.id AND workspace_id = p.workspace_id AND ctx_pack_fts MATCH ${input.query})`,
            )

          const where = sql`WHERE ${sql.join(conditions, sql` AND `)}`
          const orderBy = sql`ORDER BY ${sort.column} ${sql.raw(sort.direction)}, p.id ${sql.raw(sort.direction)}`

          const [rows, count] = yield* Effect.all([
            db.all<CtxPackRow>(
              sql`SELECT p.* FROM ctx_pack p ${where} ${cursor === null ? sql`` : sql`AND ${cursorCondition(sort, cursor)}`} ${orderBy} LIMIT ${input.limit + 1}`,
            ),
            db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM ctx_pack p ${where}`),
          ])

          const page = rows.slice(0, input.limit)
          const nextCursor =
            rows.length > input.limit ? encodeCursor(input.sort, sort.value(page[page.length - 1]!), page[page.length - 1]!.id) : null

          const ids = page.map((row) => row.id)
          let fragments: CtxPackFragmentRow[] = []
          let keywords: CtxPackKeywordRow[] = []
          if (ids.length > 0) {
            ;[fragments, keywords] = yield* Effect.all([
              db.all<CtxPackFragmentRow>(
                sql`SELECT * FROM ctx_pack_fragment WHERE ctx_pack_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) ORDER BY ctx_pack_id, ordinal`,
              ),
              db.all<CtxPackKeywordRow>(
                sql`SELECT * FROM ctx_pack_keyword WHERE ctx_pack_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) ORDER BY ctx_pack_id, ordinal`,
              ),
            ])
          }

          const fragmentsByPack = groupBy(ctxPackIDOfFragment, fragments)
          const keywordsByPack = groupBy(ctxPackIDOfKeyword, keywords)

          const result: CtxPackListResult = {
            items: page.map((row) => summaryFrom(row, fragmentsByPack.get(row.id) ?? [], keywordsByPack.get(row.id) ?? [])),
            nextCursor,
            totalEstimate: count?.count ?? null,
          }
          return result
        }),
      )
    },

    softDelete(workspaceID, ctxPackID, expectedRevision) {
      return toDomainError(
        Effect.gen(function* () {
          const row = yield* selectRow(workspaceID, ctxPackID)
          if (!row) return yield* Effect.fail({ _tag: "CtxPackNotFound", ctxPackID } satisfies CtxPackError)
          if (row.time_deleted !== null)
            return yield* Effect.fail({ _tag: "CtxPackDeleted", ctxPackID } satisfies CtxPackError)
          if (row.revision !== expectedRevision)
            return yield* Effect.fail({ _tag: "CtxPackRevisionConflict", currentRevision: row.revision } satisfies CtxPackError)

          yield* db.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.run(
                sql`UPDATE ctx_pack SET time_deleted = ${Date.now()} WHERE id = ${ctxPackID} AND workspace_id = ${workspaceID}`,
              )
              yield* tx.run(sql`DELETE FROM ctx_pack_fts WHERE ctx_pack_id = ${ctxPackID}`)
            }),
          )
          return yield* loadInfo(workspaceID, ctxPackID)
        }),
      )
    },

    restore(workspaceID, ctxPackID, expectedRevision) {
      return toDomainError(
        Effect.gen(function* () {
          const row = yield* selectRow(workspaceID, ctxPackID)
          if (!row) return yield* Effect.fail({ _tag: "CtxPackNotFound", ctxPackID } satisfies CtxPackError)
          if (row.revision !== expectedRevision)
            return yield* Effect.fail({ _tag: "CtxPackRevisionConflict", currentRevision: row.revision } satisfies CtxPackError)
          if (row.time_deleted !== null) {
            const [fragments, keywords] = yield* Effect.all([selectFragments(ctxPackID), selectKeywords(ctxPackID)])
            yield* db.transaction((tx) =>
              Effect.gen(function* () {
                yield* tx.run(
                  sql`UPDATE ctx_pack SET time_deleted = NULL WHERE id = ${ctxPackID} AND workspace_id = ${workspaceID}`,
                )
                yield* tx.run(
                  sql`INSERT INTO ctx_pack_fts (ctx_pack_id, workspace_id, title, keywords, content) VALUES (${ctxPackID}, ${workspaceID}, ${row.title}, ${ftsKeywords(keywords)}, ${ftsContent(fragments)})`,
                )
              }),
            )
          }
          return yield* loadInfo(workspaceID, ctxPackID)
        }),
      )
    },

    recordUse(workspaceID, ctxPackID, usedAt) {
      return toDomainError(
        Effect.gen(function* () {
          const row = yield* selectRow(workspaceID, ctxPackID)
          if (!row) return yield* Effect.fail({ _tag: "CtxPackNotFound", ctxPackID } satisfies CtxPackError)
          if (row.time_deleted !== null)
            return yield* Effect.fail({ _tag: "CtxPackDeleted", ctxPackID } satisfies CtxPackError)
          yield* db.run(
            sql`UPDATE ctx_pack SET attached_count = attached_count + 1, last_attached_at = MAX(COALESCE(last_attached_at, 0), ${usedAt}) WHERE id = ${ctxPackID} AND workspace_id = ${workspaceID}`,
          )
        }),
      )
    },
  }
}

function ctxPackIDOfFragment(row: CtxPackFragmentRow): string {
  return row.ctx_pack_id
}

function ctxPackIDOfKeyword(row: CtxPackKeywordRow): string {
  return row.ctx_pack_id
}

function groupBy<Key, Value>(keyOf: (value: Value) => Key, values: readonly Value[]): Map<Key, Value[]> {
  const result = new Map<Key, Value[]>()
  for (const value of values) {
    const key = keyOf(value)
    const bucket = result.get(key)
    if (bucket) bucket.push(value)
    else result.set(key, [value])
  }
  return result
}

// Service ---------------------------------------------------------------------

export interface CtxPackRepository {
  create(input: CtxPackRepository.Create): Effect.Effect<CtxPack.Info, CtxPackError>
  get(workspaceID: string, ctxPackID: CtxPack.ID, includeDeleted: boolean): Effect.Effect<CtxPack.Info, CtxPackError>
  patchMetadata(input: CtxPackRepository.Patch): Effect.Effect<CtxPack.Info, CtxPackError>
  list(input: CtxPackListRequest): Effect.Effect<CtxPackListResult, CtxPackError>
  softDelete(workspaceID: string, ctxPackID: CtxPack.ID, expectedRevision: number): Effect.Effect<CtxPack.Info, CtxPackError>
  restore(workspaceID: string, ctxPackID: CtxPack.ID, expectedRevision: number): Effect.Effect<CtxPack.Info, CtxPackError>
  recordUse(workspaceID: string, ctxPackID: CtxPack.ID, usedAt: number): Effect.Effect<void, CtxPackError>
}

export namespace CtxPackRepository {
  export interface Create {
    workspaceID: string
    createdByUserID: string
    title: string
    keywords: string[]
    sensitivity: CtxPack.Sensitivity
    fragments: Array<{ clientFragmentID: string; text: string; source: CtxPack.Source }>
    idempotencyKey: string
    now: number
  }

  export interface Patch {
    workspaceID: string
    ctxPackID: CtxPack.ID
    expectedRevision: number
    patch: { title?: string; keywords?: string[]; sensitivity?: CtxPack.Sensitivity }
    now: number
  }
}

export class CtxPackRepositoryService extends Context.Service<CtxPackRepositoryService, CtxPackRepository>()(
  "@opencode/v2/ctxpack/CtxPackRepository",
) {}

export const layer = Layer.effect(
  CtxPackRepositoryService,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* ensureCtxPackFts(db).pipe(Effect.orDie)
    return make(db)
  }),
)

export const node = makeGlobalNode({ service: CtxPackRepositoryService, layer, deps: [Database.node] })
