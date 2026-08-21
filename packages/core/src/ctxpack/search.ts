// CtxPack search: FTS query sanitization plus the two search entry points.
//
// S1's repository binds the FTS MATCH text as a parameter (injection-safe)
// but does NOT sanitize FTS5 syntax — a malformed query (unbalanced quotes,
// punctuation-only phrases) would surface as a SQL error/defect. This module
// is the sanitizing layer: buildFtsQuery turns raw user text into a sequence
// of quoted phrase tokens (never interpolated raw), and the search entry
// points refuse to run a MATCH on a query that produced no tokens.
//
// Metadata filters (sourceBlockID / sourceFunctionalityID / sourceKind /
// keyword / sensitivity / created range) INTERSECT with FTS (AND) via the
// repository predicate — they never replace it.

import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import type { CtxPackError, CtxPackListRequest, CtxPackListResult, CtxPackSort } from "@opencode-ai/schema/ctxpack"
import { Database } from "../database/database"
import type { CtxPackRepository } from "./sql"
import { LIMITS, codePointLength } from "./validation"

type Db = Database.Interface["db"]

// The FTS5 tokenizer (unicode61) tokenizes letters, digits, and underscores.
// Tokens without any of those can never match anything and some (e.g. a lone
// `"`) are FTS5 syntax hazards even when quoted — drop them up front.
const TOKEN_CHAR = /[\p{L}\p{N}_]/u

// Build a safe FTS5 MATCH expression from raw user text:
//   - tokenize on whitespace
//   - normalize each token (NFKC, trim, collapse inner whitespace)
//   - wrap every token in double quotes (phrase per token), escaping embedded
//     double quotes by doubling them
//   - join tokens with a space (AND)
// Empty / whitespace / punctuation-only queries return null — callers skip
// the MATCH entirely. Raw query text is NEVER interpolated unquoted.
//
// Example: `session.input` -> `"session.input"`
export function buildFtsQuery(query: string): string | null {
  const tokens = query
    .split(/\s+/)
    .map((token) => CtxPack.normalizeKeyword(token))
    .filter((token) => token.length > 0 && TOKEN_CHAR.test(token))
  if (tokens.length === 0) return null
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" ")
}

// Direct FTS lookup: matching ctx_pack_id values for a query, scoped to one
// workspace, joined via the ctx_pack_fts.ctx_pack_id column. Parameterized —
// no string concatenation into SQL. A query that sanitizes to nothing matches
// nothing (empty result, no MATCH executed).
export function matchFts(db: Db, workspaceID: string, query: string): Effect.Effect<CtxPack.ID[]> {
  const ftsQuery = buildFtsQuery(query)
  if (ftsQuery === null) return Effect.succeed([])
  return db
    .all<{ ctx_pack_id: string }>(
      sql`SELECT ctx_pack_id FROM ctx_pack_fts WHERE workspace_id = ${workspaceID} AND ctx_pack_fts MATCH ${ftsQuery}`,
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.ctx_pack_id as CtxPack.ID)))
    // Storage failures surface as defects, mirroring the repository idiom.
    .pipe(Effect.orDie)
}

export interface SearchPacksInput {
  workspaceID: string
  query: string
  keyword: string | null
  sourceBlockID: string | null
  sourceFunctionalityID: string | null
  sourceKind: CtxPack.SourceKind | null
  sensitivity: CtxPack.Sensitivity | null
  createdAfter: number | null
  createdBefore: number | null
  includeDeleted: boolean
  sort: CtxPackSort
  cursor: string | null
  limit: number
}

// Full search through the repository list predicate: the sanitized FTS query
// is ANDed with every metadata filter by the repository, keyset pagination
// (sortValue, id) uses S1's cursor codec, and the tie-breaker is always id.
// Frozen input limits are re-checked here (limit 1-50, query <= 256 code
// points) so search callers cannot bypass the service-level rules.
export function searchPacks(
  repository: CtxPackRepository,
  input: SearchPacksInput,
): Effect.Effect<CtxPackListResult, CtxPackError> {
  if (input.limit < LIMITS.listLimitMin || input.limit > LIMITS.listLimitMax)
    return Effect.fail<CtxPackError>({
      _tag: "CtxPackInvalidSelection",
      reason: `limit must be between ${LIMITS.listLimitMin} and ${LIMITS.listLimitMax}`,
    })
  if (codePointLength(input.query) > LIMITS.queryMaxCodePoints)
    return Effect.fail<CtxPackError>({
      _tag: "CtxPackInvalidSelection",
      reason: `query must be at most ${LIMITS.queryMaxCodePoints} code points`,
    })

  const request: CtxPackListRequest = {
    workspaceID: input.workspaceID,
    query: buildFtsQuery(input.query) ?? "",
    keyword: input.keyword,
    sourceBlockID: input.sourceBlockID,
    sourceFunctionalityID: input.sourceFunctionalityID,
    sourceKind: input.sourceKind,
    sensitivity: input.sensitivity,
    createdAfter: input.createdAfter,
    createdBefore: input.createdBefore,
    includeDeleted: input.includeDeleted,
    sort: input.sort,
    cursor: input.cursor,
    limit: input.limit,
  }
  return repository.list(request)
}
