import { CtxPack } from "@opencode-ai/schema/ctxpack"
import type { CtxPackError } from "@opencode-ai/schema/ctxpack"
import { and, eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Service as CapabilityService } from "../capability/service"
import { Database } from "../database/database"
import { CtxPackRepositoryService, CtxPackTable } from "./sql"
import type { CtxPackActor } from "./service"

export interface RecallCandidate {
  readonly ctxPackID: CtxPack.ID
  readonly contentHash: string
  readonly byteLength: number
  readonly estimatedTokens: number
  readonly rank: number
}

export interface RecallSnapshot {
  readonly sourceCtxPackID: CtxPack.ID
  readonly label: string
  readonly contentHash: string
  readonly fragments: readonly {
    readonly text: string
    readonly source: CtxPack.Source
    readonly contentHash: string
  }[]
}

export const MAX_RECALL_CANDIDATES = 16

const MAX_RECALL_TERMS = 8
const TOKEN = /[\p{L}\p{N}_]+/gu
const TOKEN_CHARACTER = /[\p{L}\p{N}_]/u
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "was",
  "were",
  "with",
])
const TRIVIAL_TURNS = new Set([
  "got it",
  "hello",
  "hey",
  "hi",
  "ok",
  "okay",
  "sounds good",
  "thank you",
  "thanks",
])

export function buildRecallTerms(text: string): readonly string[] {
  const seen = new Set<string>()
  return (text.normalize("NFKC").toLowerCase().match(TOKEN) ?? [])
    .filter((term) => {
      if (STOP_WORDS.has(term) || seen.has(term)) return false
      seen.add(term)
      return true
    })
    .slice(0, MAX_RECALL_TERMS)
}

export function isTrivialRecallTurn(text: string): boolean {
  return TRIVIAL_TURNS.has((text.normalize("NFKC").toLowerCase().match(TOKEN) ?? []).join(" "))
}

export function searchForRecall(input: {
  workspaceID: string
  terms: readonly string[]
}): Effect.Effect<readonly RecallCandidate[], never, Database.Service> {
  const query = input.terms
    .filter((term) => TOKEN_CHARACTER.test(term))
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(" OR ")
  if (query.length === 0) return Effect.succeed([])

  return Effect.gen(function* () {
    const database = yield* Database.Service
    const rows = yield* database.db.all<{
      ctx_pack_id: string
      content_hash: string
      byte_length: number
      estimated_tokens: number
      rank: number
    }>(
      sql`SELECT p.id AS ctx_pack_id, p.content_hash, p.byte_length, p.estimated_tokens, bm25(ctx_pack_fts) AS rank
          FROM ctx_pack_fts
          JOIN ctx_pack p ON p.id = ctx_pack_fts.ctx_pack_id AND p.workspace_id = ctx_pack_fts.workspace_id
          WHERE p.workspace_id = ${input.workspaceID}
            AND p.time_deleted IS NULL
            AND ctx_pack_fts MATCH ${query}
          ORDER BY bm25(ctx_pack_fts) ASC, p.id ASC
          LIMIT ${MAX_RECALL_CANDIDATES}`,
    )
    return rows.map((row) => ({
      ctxPackID: row.ctx_pack_id as CtxPack.ID,
      contentHash: row.content_hash,
      byteLength: row.byte_length,
      estimatedTokens: row.estimated_tokens,
      rank: row.rank,
    }))
  }).pipe(Effect.orDie)
}

export function snapshotCandidate(input: {
  actor: CtxPackActor
  targetInstanceID: string
  targetFunctionalityID: string
  ctxPackID: CtxPack.ID
  expectedContentHash: string
}): Effect.Effect<RecallSnapshot, CtxPackError, Database.Service | CtxPackRepositoryService | CapabilityService> {
  return Effect.gen(function* () {
    const database = yield* Database.Service
    const repository = yield* CtxPackRepositoryService
    const capability = yield* CapabilityService

    yield* capability
      .require({
        userID: input.actor.userID,
        operation: "chat.context.attach",
        subject: {
          type: "FunctionalityInstance",
          workspaceID: input.actor.workspaceID,
          instanceID: input.targetInstanceID,
          functionalityID: input.targetFunctionalityID,
        },
      })
      .pipe(
        Effect.mapError(
          (error) => ({ _tag: "CtxPackPermissionDenied", operation: error.operation }) satisfies CtxPackError,
        ),
      )

    const metadata = yield* database.db
      .select({
        id: CtxPackTable.id,
        sensitivity: CtxPackTable.sensitivity,
        createdByUserID: CtxPackTable.created_by_user_id,
        contentHash: CtxPackTable.content_hash,
        deletedAt: CtxPackTable.time_deleted,
      })
      .from(CtxPackTable)
      .where(and(eq(CtxPackTable.workspace_id, input.actor.workspaceID), eq(CtxPackTable.id, input.ctxPackID)))
      .get()
      .pipe(Effect.orDie)
    if (!metadata)
      return yield* Effect.fail({ _tag: "CtxPackNotFound", ctxPackID: input.ctxPackID } satisfies CtxPackError)

    yield* capability
      .require({
        userID: input.actor.userID,
        operation: "ctxpack.read",
        subject: {
          type: "CtxPack",
          workspaceID: input.actor.workspaceID,
          ctxPackID: metadata.id,
          sensitivity: metadata.sensitivity,
          createdByUserID: metadata.createdByUserID,
        },
      })
      .pipe(
        Effect.mapError(
          (error) => ({ _tag: "CtxPackPermissionDenied", operation: error.operation }) satisfies CtxPackError,
        ),
      )
    if (metadata.deletedAt !== null)
      return yield* Effect.fail({ _tag: "CtxPackDeleted", ctxPackID: metadata.id } satisfies CtxPackError)
    if (metadata.contentHash !== input.expectedContentHash)
      return yield* Effect.fail({
        _tag: "CtxPackContentChanged",
        currentContentHash: metadata.contentHash,
      } satisfies CtxPackError)

    const pack = yield* repository.get(input.actor.workspaceID, input.ctxPackID, true)
    if (pack.createdByUserID !== metadata.createdByUserID || pack.sensitivity !== metadata.sensitivity)
      return yield* Effect.fail({
        _tag: "CtxPackPermissionDenied",
        operation: "ctxpack.read",
      } satisfies CtxPackError)
    if (pack.deletedAt !== null)
      return yield* Effect.fail({ _tag: "CtxPackDeleted", ctxPackID: pack.id } satisfies CtxPackError)
    if (pack.contentHash !== input.expectedContentHash)
      return yield* Effect.fail({
        _tag: "CtxPackContentChanged",
        currentContentHash: pack.contentHash,
      } satisfies CtxPackError)

    return deepFreeze({
      sourceCtxPackID: pack.id,
      label: pack.title,
      contentHash: pack.contentHash,
      fragments: pack.fragments.map((fragment) => ({
        text: fragment.text,
        source: fragment.source,
        contentHash: fragment.contentHash,
      })),
    })
  })
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.keys(value).forEach((key) => deepFreeze((value as Record<string, unknown>)[key]))
    Object.freeze(value)
  }
  return value
}
