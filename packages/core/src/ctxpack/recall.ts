import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import type { CtxPackError } from "@opencode-ai/schema/ctxpack"
import { Capability } from "../capability/service"
import type { CapabilitySubject } from "../capability/subjects"
import { Database } from "../database/database"
import { requirePackOperation } from "./access"
import { CtxPackRepositoryService } from "./sql"
import type { CtxPackActor } from "./service"

export type RecallCandidate = {
  readonly ctxPackID: CtxPack.ID
  readonly contentHash: string
  readonly byteLength: number
  readonly estimatedTokens: number
  readonly rank: number
}

export type RecallSnapshot = {
  readonly sourceCtxPackID: CtxPack.ID
  readonly label: string
  readonly tags?: readonly CtxPack.Tag[]
  readonly contentHash: string
  readonly fragments: readonly {
    readonly text: string
    readonly source: CtxPack.Source
    readonly contentHash: string
  }[]
}

export const MAX_RECALL_CANDIDATES = 16

export const RECALL_STOP_WORDS_V1 = [
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
  "has",
  "have",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "with",
  "you",
] as const

const STOP_WORDS = new Set<string>(RECALL_STOP_WORDS_V1)
const TRIVIAL_TURNS = new Set(["hi", "hello", "hey", "ok", "okay", "thanks", "thank you", "got it", "sounds good"])
const TOKEN = /[\p{L}\p{N}]+/gu

export function buildRecallTerms(text: string): readonly string[] {
  const terms = Array.from(text.normalize("NFKC").toLowerCase().matchAll(TOKEN), (match) => match[0])
  return terms.filter((term, index) => !STOP_WORDS.has(term) && terms.indexOf(term) === index).slice(0, 8)
}

export function isTrivialRecallTurn(text: string): boolean {
  return TRIVIAL_TURNS.has(
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\p{P}+/gu, " ")
      .trim()
      .replace(/\s+/g, " "),
  )
}

export function searchForRecall(input: {
  workspaceID: string
  terms: readonly string[]
}): Effect.Effect<readonly RecallCandidate[], never, Database.Service> {
  const terms = buildRecallTerms(input.terms.join(" "))
  if (terms.length === 0) return Effect.succeed([])
  const query = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ")
  return Database.Service.pipe(
    Effect.flatMap((database) =>
      database.db.all<{
        ctx_pack_id: string
        content_hash: string
        byte_length: number
        estimated_tokens: number
        rank: number
      }>(sql`
        SELECT
          p.id AS ctx_pack_id,
          p.content_hash,
          p.byte_length,
          p.estimated_tokens,
          bm25(ctx_pack_fts) AS rank
        FROM ctx_pack_fts
        INNER JOIN ctx_pack p ON p.id = ctx_pack_fts.ctx_pack_id
        WHERE ctx_pack_fts.workspace_id = ${input.workspaceID}
          AND p.workspace_id = ${input.workspaceID}
          AND p.time_deleted IS NULL
          AND ctx_pack_fts MATCH ${query}
        ORDER BY bm25(ctx_pack_fts) ASC, p.id ASC
        LIMIT ${MAX_RECALL_CANDIDATES}
      `),
    ),
    Effect.map((rows) =>
      rows.map((row) => ({
        ctxPackID: row.ctx_pack_id as CtxPack.ID,
        contentHash: row.content_hash,
        byteLength: row.byte_length,
        estimatedTokens: row.estimated_tokens,
        rank: row.rank,
      })),
    ),
    Effect.orDie,
  )
}

export const snapshotCandidate = Effect.fn("CtxPackRecall.snapshotCandidate")(function* (request: {
  actor: CtxPackActor
  targetInstanceID: string
  targetFunctionalityID: string
  ctxPackID: CtxPack.ID
  expectedContentHash: string
}) {
  const repository = yield* CtxPackRepositoryService
  const capability = yield* Capability.Service
  const pack = yield* repository.get(request.actor.workspaceID, request.ctxPackID, true)
  yield* requirePackOperation({
    userID: request.actor.userID,
    workspaceID: request.actor.workspaceID,
    operation: "ctxpack.read",
    pack,
  })
  const subject: CapabilitySubject = {
    type: "FunctionalityInstance",
    workspaceID: request.actor.workspaceID,
    instanceID: request.targetInstanceID,
    functionalityID: request.targetFunctionalityID,
  }
  yield* capability
    .require({ userID: request.actor.userID, operation: "chat.context.attach", subject })
    .pipe(
      Effect.mapError(
        (error) => ({ _tag: "CtxPackPermissionDenied", operation: error.operation }) satisfies CtxPackError,
      ),
    )
  if (pack.deletedAt !== null) {
    return yield* Effect.fail({ _tag: "CtxPackDeleted", ctxPackID: pack.id } satisfies CtxPackError)
  }
  if (pack.contentHash !== request.expectedContentHash) {
    return yield* Effect.fail({
      _tag: "CtxPackContentChanged",
      currentContentHash: pack.contentHash,
    } satisfies CtxPackError)
  }
  return deepFreeze({
    sourceCtxPackID: pack.id,
    label: pack.title,
    ...(pack.tags?.length ? { tags: pack.tags } : {}),
    contentHash: pack.contentHash,
    fragments: pack.fragments.map((fragment) => ({
      text: fragment.text,
      source: fragment.source,
      contentHash: fragment.contentHash,
    })),
  }) satisfies RecallSnapshot
})

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}
