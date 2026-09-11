// CtxPack validation: the frozen v1 limits for create / patch / list inputs.
// The service re-checks everything here even though the schema layer already
// encodes most of these constraints, because the service is a public boundary
// that can be invoked with un-decoded input.

import { Effect, Schema } from "effect"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import type {
  CtxPackCreateRequest,
  CtxPackError,
  CtxPackListRequest,
  CtxPackPatchRequest,
} from "@opencode-ai/schema/ctxpack"

// Frozen limits --------------------------------------------------------------

export const LIMITS = {
  titleMaxCodePoints: 120,
  keywordMaxCount: 12,
  keywordMaxCodePoints: 48,
  fragmentMinCount: 1,
  fragmentMaxCount: 32,
  fragmentMaxBytes: 8 * 1024,
  totalMaxBytes: 32 * 1024,
  totalMaxEstimatedTokens: 6000,
  listLimitMin: 1,
  listLimitMax: 50,
  queryMaxCodePoints: 256,
} as const

export const SENSITIVITY_RANK: Readonly<Record<CtxPack.Sensitivity, number>> = {
  public: 0,
  workspace: 1,
  private: 2,
}

export function codePointLength(value: string): number {
  return Array.from(value).length
}

function isSensitivity(value: unknown): value is CtxPack.Sensitivity {
  return typeof value === "string" && value in SENSITIVITY_RANK
}

// Normalized outputs ----------------------------------------------------------

export interface NormalizedCreate {
  title: string
  keywords: string[]
  tags: CtxPack.Tag[]
  sensitivity: CtxPack.Sensitivity
  fragments: Array<{ clientFragmentID: string; text: string; source: CtxPack.Source }>
}

export interface NormalizedPatch {
  title?: string
  keywords?: string[]
  tags?: CtxPack.Tag[]
  sensitivity?: CtxPack.Sensitivity
}

// Helpers ---------------------------------------------------------------------

const invalidSelection = (reason: string): Effect.Effect<never, CtxPackError> =>
  Effect.fail<CtxPackError>({ _tag: "CtxPackInvalidSelection", reason })

function normalizeTags(tags: readonly CtxPack.Tag[]) {
  return Schema.decodeUnknownEffect(Schema.Array(CtxPack.Tag))(tags).pipe(
    Effect.map((tags) => [...new Set(tags)]),
    Effect.mapError((): CtxPackError => ({ _tag: "CtxPackInvalidSelection", reason: "unknown CtxPack tag" })),
  )
}

function normalizeKeywords(keywords: readonly string[]): Effect.Effect<string[], CtxPackError> {
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of keywords) {
    const normalized = CtxPack.normalizeKeyword(raw)
    if (normalized.length === 0) return invalidSelection("keywords must be 1-48 code points after normalization")
    if (codePointLength(normalized) > LIMITS.keywordMaxCodePoints)
      return invalidSelection("keyword must be at most 48 code points")
    const dedupeKey = normalized.toLowerCase()
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey)
      result.push(normalized)
    }
  }
  if (result.length > LIMITS.keywordMaxCount) return invalidSelection("at most 12 keywords")
  return Effect.succeed(result)
}

export function validateTitle(title: string): Effect.Effect<string, CtxPackError> {
  const trimmed = title.trim()
  const length = codePointLength(trimmed)
  if (length < 1 || length > LIMITS.titleMaxCodePoints)
    return invalidSelection(`title must be 1-${LIMITS.titleMaxCodePoints} code points`)
  return Effect.succeed(trimmed)
}

// Create ----------------------------------------------------------------------

export function validateCreate(request: CtxPackCreateRequest): Effect.Effect<NormalizedCreate, CtxPackError> {
  return Effect.gen(function* () {
    const title = yield* validateTitle(request.title)

    const keywords = yield* normalizeKeywords(request.keywords)
    const tags = yield* normalizeTags(request.tags ?? [])

    if (request.fragments.length < LIMITS.fragmentMinCount || request.fragments.length > LIMITS.fragmentMaxCount)
      return yield* invalidSelection(
        `fragments must be between ${LIMITS.fragmentMinCount} and ${LIMITS.fragmentMaxCount}`,
      )

    if (!isSensitivity(request.sensitivity))
      return yield* invalidSelection("pack sensitivity must be public, workspace, or private")

    const fragments: NormalizedCreate["fragments"] = []
    let totalBytes = 0
    for (const fragment of request.fragments) {
      const text = CtxPack.normalizeSelectedText(fragment.text)
      if (text.length === 0)
        return yield* invalidSelection(`fragment ${fragment.clientFragmentID} must not be empty after normalization`)

      const bytes = CtxPack.utf8ByteLength(text)
      if (bytes > LIMITS.fragmentMaxBytes)
        return yield* Effect.fail<CtxPackError>({
          _tag: "CtxPackBudgetExceeded",
          bytes,
          estimatedTokens: CtxPack.estimateTokens(bytes),
        })

      // Source workspace must be exactly the pack workspace.
      if (fragment.source.workspaceID !== request.workspaceID)
        return yield* Effect.fail<CtxPackError>({
          _tag: "CtxPackCrossWorkspaceDenied",
          sourceWorkspaceID: fragment.source.workspaceID,
        })

      // "secret" can never decode at the schema level; re-check at runtime for
      // callers that bypassed schema decoding.
      if (!isSensitivity(fragment.source.sensitivity))
        return yield* Effect.fail<CtxPackError>({
          _tag: "CtxPackSecretSourceDenied",
          clientFragmentID: fragment.clientFragmentID,
        })

      totalBytes += bytes
      fragments.push({ clientFragmentID: fragment.clientFragmentID, text, source: fragment.source })
    }

    const totalTokens = CtxPack.estimateTokens(totalBytes)
    if (totalBytes > LIMITS.totalMaxBytes || totalTokens > LIMITS.totalMaxEstimatedTokens)
      return yield* Effect.fail<CtxPackError>({
        _tag: "CtxPackBudgetExceeded",
        bytes: totalBytes,
        estimatedTokens: totalTokens,
      })

    // Requested pack sensitivity must be at least as strict as every source.
    const strictest = Math.max(...fragments.map((fragment) => SENSITIVITY_RANK[fragment.source.sensitivity]))
    if (SENSITIVITY_RANK[request.sensitivity] < strictest)
      return yield* invalidSelection(
        `requested sensitivity ${request.sensitivity} is weaker than the strictest fragment source sensitivity`,
      )

    return { title, keywords, tags, sensitivity: request.sensitivity, fragments }
  })
}

// Patch -----------------------------------------------------------------------

export function validatePatch(
  patch: CtxPackPatchRequest["patch"],
  fragmentSources: readonly CtxPack.Source[],
): Effect.Effect<NormalizedPatch, CtxPackError> {
  return Effect.gen(function* () {
    const result: NormalizedPatch = {}

    if (patch.title !== undefined) {
      result.title = yield* validateTitle(patch.title)
    }

    if (patch.keywords !== undefined) {
      result.keywords = yield* normalizeKeywords(patch.keywords)
    }

    if (patch.tags !== undefined) {
      result.tags = yield* normalizeTags(patch.tags)
    }

    if (patch.sensitivity !== undefined) {
      if (!isSensitivity(patch.sensitivity))
        return yield* invalidSelection("pack sensitivity must be public, workspace, or private")
      for (const source of fragmentSources) {
        if (!isSensitivity(source.sensitivity))
          return yield* invalidSelection("fragment source sensitivity must be public, workspace, or private")
      }
      const strictest = Math.max(...fragmentSources.map((source) => SENSITIVITY_RANK[source.sensitivity]))
      if (SENSITIVITY_RANK[patch.sensitivity] < strictest)
        return yield* invalidSelection(
          `requested sensitivity ${patch.sensitivity} is weaker than the strictest fragment source sensitivity`,
        )
      result.sensitivity = patch.sensitivity
    }

    return result
  })
}

// List ------------------------------------------------------------------------

export function validateListRequest(request: CtxPackListRequest): Effect.Effect<void, CtxPackError> {
  if (request.limit < LIMITS.listLimitMin || request.limit > LIMITS.listLimitMax)
    return invalidSelection(`limit must be between ${LIMITS.listLimitMin} and ${LIMITS.listLimitMax}`)
  if (codePointLength(request.query) > LIMITS.queryMaxCodePoints)
    return invalidSelection(`query must be at most ${LIMITS.queryMaxCodePoints} code points`)
  return Effect.void
}
