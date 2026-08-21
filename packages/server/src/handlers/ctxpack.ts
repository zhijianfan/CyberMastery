// CtxPack handlers (Track P1).
//
// Thin translation layer between the P1 HttpApi group and the CtxPack core
// service: derive the actor from the authenticated request context, forward
// each endpoint's decoded payload to exactly one service method, and map
// typed domain errors onto the P1 protocol error schemas. No business logic
// lives here — no search, no permission checks, no SQL/FTS, no
// materialization; the core service owns all of it.
//
// The service interfaces below are LOCAL and frozen by the P1 brief. M1 swaps
// them for the real core services by re-providing the same Effect Context
// keys; this file does not need to change.
//
// The group is not yet composed into the shared server Api (M1 mounts it), so
// the handler layer is built against a local Api containing the frozen group.
// The group service key ("effect/httpapi/HttpApiGroup/server.workspace.ctxpack")
// derives solely from the group identifier, so the layer mounts unchanged once
// M1 composes the group into packages/protocol/src/api.ts.

import { CtxPack } from "@opencode-ai/schema/ctxpack"
import {
  CtxPackBudgetExceededError,
  CtxPackContentChangedError,
  CtxPackCrossWorkspaceDeniedError,
  CtxPackDeletedError,
  CtxPackGroup,
  CtxPackInvalidSelectionError,
  CtxPackMaterializeResult,
  CtxPackNotFoundError,
  CtxPackPermissionDeniedError,
  CtxPackRevisionConflictError,
  CtxPackSearchCursorInvalidError,
  CtxPackSecretSourceDeniedError,
  type CtxPackListQuery,
} from "@opencode-ai/protocol/groups/ctxpack"
import { CtxPackService, CtxPackMaterializer } from "@opencode-ai/core/ctxpack/index"
import type { CtxPackListRequest } from "@opencode-ai/schema/ctxpack"
import { Encoding, Effect, Result, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { requestUser } from "../middleware/authorization"
import { Api } from "../api"

// The frozen domain error union (mirrors packages/schema/src/ctxpack.ts
// CtxPackError). The handler maps `_tag`s onto the protocol error schemas.
type CtxPackDomainError =
  | { _tag: "CtxPackNotFound"; ctxPackID: string }
  | { _tag: "CtxPackDeleted"; ctxPackID: string }
  | { _tag: "CtxPackRevisionConflict"; currentRevision: number }
  | { _tag: "CtxPackContentChanged"; currentContentHash: string }
  | { _tag: "CtxPackInvalidSelection"; reason: string }
  | { _tag: "CtxPackBudgetExceeded"; bytes: number; estimatedTokens: number }
  | { _tag: "CtxPackSecretSourceDenied"; clientFragmentID: string }
  | { _tag: "CtxPackCrossWorkspaceDenied"; sourceWorkspaceID: string }
  | { _tag: "CtxPackPermissionDenied"; operation: string }
  | { _tag: "CtxPackSearchCursorInvalid" }

type CtxPackHttpError =
  | CtxPackNotFoundError
  | CtxPackDeletedError
  | CtxPackRevisionConflictError
  | CtxPackContentChangedError
  | CtxPackInvalidSelectionError
  | CtxPackBudgetExceededError
  | CtxPackSecretSourceDeniedError
  | CtxPackCrossWorkspaceDeniedError
  | CtxPackPermissionDeniedError
  | CtxPackSearchCursorInvalidError

function toHttpError(error: unknown): CtxPackHttpError {
  if (typeof error !== "object" || error === null || !("_tag" in error)) {
    return new CtxPackPermissionDeniedError({
      operation: "unknown",
      message: "Unknown ctxpack service error",
    })
  }
  switch ((error as CtxPackDomainError)._tag) {
    case "CtxPackNotFound": {
      const domain = error as Extract<CtxPackDomainError, { _tag: "CtxPackNotFound" }>
      return new CtxPackNotFoundError({
        ctxPackID: domain.ctxPackID,
        message: `CtxPack not found: ${domain.ctxPackID}`,
      })
    }
    case "CtxPackDeleted": {
      const domain = error as Extract<CtxPackDomainError, { _tag: "CtxPackDeleted" }>
      return new CtxPackDeletedError({
        ctxPackID: domain.ctxPackID,
        message: `CtxPack deleted: ${domain.ctxPackID}`,
      })
    }
    case "CtxPackRevisionConflict": {
      const domain = error as Extract<CtxPackDomainError, { _tag: "CtxPackRevisionConflict" }>
      return new CtxPackRevisionConflictError({
        currentRevision: domain.currentRevision,
        message: `CtxPack revision conflict: current is ${domain.currentRevision}`,
      })
    }
    case "CtxPackContentChanged": {
      const domain = error as Extract<CtxPackDomainError, { _tag: "CtxPackContentChanged" }>
      return new CtxPackContentChangedError({
        currentContentHash: domain.currentContentHash,
        message: `CtxPack content changed: ${domain.currentContentHash}`,
      })
    }
    case "CtxPackInvalidSelection": {
      const domain = error as Extract<CtxPackDomainError, { _tag: "CtxPackInvalidSelection" }>
      return new CtxPackInvalidSelectionError({
        reason: domain.reason,
        message: `Invalid ctxpack selection: ${domain.reason}`,
      })
    }
    case "CtxPackBudgetExceeded": {
      const domain = error as Extract<CtxPackDomainError, { _tag: "CtxPackBudgetExceeded" }>
      return new CtxPackBudgetExceededError({
        bytes: domain.bytes,
        estimatedTokens: domain.estimatedTokens,
        message: `CtxPack budget exceeded: ${domain.bytes} bytes (~${domain.estimatedTokens} tokens)`,
      })
    }
    case "CtxPackSecretSourceDenied": {
      const domain = error as Extract<CtxPackDomainError, { _tag: "CtxPackSecretSourceDenied" }>
      return new CtxPackSecretSourceDeniedError({
        clientFragmentID: domain.clientFragmentID,
        message: `Secret source denied for fragment ${domain.clientFragmentID}`,
      })
    }
    case "CtxPackCrossWorkspaceDenied": {
      const domain = error as Extract<CtxPackDomainError, { _tag: "CtxPackCrossWorkspaceDenied" }>
      return new CtxPackCrossWorkspaceDeniedError({
        sourceWorkspaceID: domain.sourceWorkspaceID,
        message: `Cross-workspace source denied: ${domain.sourceWorkspaceID}`,
      })
    }
    case "CtxPackPermissionDenied": {
      const domain = error as Extract<CtxPackDomainError, { _tag: "CtxPackPermissionDenied" }>
      return new CtxPackPermissionDeniedError({
        operation: domain.operation,
        message: `CtxPack operation denied: ${domain.operation}`,
      })
    }
    case "CtxPackSearchCursorInvalid":
      return new CtxPackSearchCursorInvalidError({ message: "CtxPack search cursor is invalid" })
    default:
      return new CtxPackPermissionDeniedError({
        operation: "unknown",
        message: `Unknown ctxpack service error: ${String((error as { _tag?: unknown })._tag)}`,
      })
  }
}

// Wire → domain normalization for the list endpoint. The wire query is plain
// optional strings (httpapi-codegen portability); this maps defaults, ints,
// literals, and the cursor shape onto the frozen CtxPackListRequest.
const SORTS = ["created-desc", "created-asc", "updated-desc", "title-asc", "tokens-desc", "most-attached", "recently-attached"] as const
const SOURCE_KINDS = ["message", "tool-output", "terminal", "file", "search", "note", "block-text"] as const
const SENSITIVITIES = ["public", "workspace", "private"] as const

function normalizeListQuery(
  workspaceID: string,
  query: Schema.Schema.Type<typeof CtxPackListQuery>,
): Effect.Effect<CtxPackListRequest, CtxPackDomainError> {
  const parseIntStrict = (value: string): number | undefined => {
    if (!/^\d+$/.test(value)) return undefined
    const parsed = Number.parseInt(value, 10)
    return Number.isSafeInteger(parsed) ? parsed : undefined
  }
  const text = query.query ?? ""
  if (Array.from(text).length > 256)
    return Effect.fail({ _tag: "CtxPackInvalidSelection", reason: "query too long" })
  const limit = query.limit === undefined ? 30 : parseIntStrict(query.limit)
  if (limit === undefined || limit < 1 || limit > 50)
    return Effect.fail({ _tag: "CtxPackInvalidSelection", reason: "invalid limit" })
  const sort = query.sort ?? "created-desc"
  if (!(SORTS as readonly string[]).includes(sort))
    return Effect.fail({ _tag: "CtxPackInvalidSelection", reason: "invalid sort" })
  if (query.sourceKind !== undefined && !(SOURCE_KINDS as readonly string[]).includes(query.sourceKind))
    return Effect.fail({ _tag: "CtxPackInvalidSelection", reason: "invalid sourceKind" })
  if (query.sensitivity !== undefined && !(SENSITIVITIES as readonly string[]).includes(query.sensitivity))
    return Effect.fail({ _tag: "CtxPackInvalidSelection", reason: "invalid sensitivity" })
  const createdAfter = query.createdAfter === undefined ? null : parseIntStrict(query.createdAfter)
  const createdBefore = query.createdBefore === undefined ? null : parseIntStrict(query.createdBefore)
  if (createdAfter === undefined || createdBefore === undefined)
    return Effect.fail({ _tag: "CtxPackInvalidSelection", reason: "invalid date filter" })
  const cursor = query.cursor ?? null
  if (cursor !== null && Result.isFailure(Encoding.decodeBase64UrlString(cursor)))
    return Effect.fail({ _tag: "CtxPackSearchCursorInvalid", message: "cursor must be a valid base64url string" })
  return Effect.succeed({
    workspaceID,
    query: text,
    keyword: query.keyword ?? null,
    sourceBlockID: query.sourceBlockID ?? null,
    sourceFunctionalityID: query.sourceFunctionalityID ?? null,
    sourceKind: query.sourceKind === undefined ? null : (query.sourceKind as CtxPack.SourceKind),
    sensitivity: query.sensitivity === undefined ? null : (query.sensitivity as CtxPack.Sensitivity),
    createdAfter,
    createdBefore,
    includeDeleted: query.includeDeleted === "true",
    sort: sort as CtxPackListRequest["sort"],
    cursor,
    limit,
  })
}

// M1 integration: built against the composed server Api with the real core
// services. The group service key ("effect/httpapi/HttpApiGroup/server.workspace.ctxpack")
// derives solely from the group identifier.
export const CtxPackHandler = HttpApiBuilder.group(Api, "server.workspace.ctxpack", (handlers) =>
  Effect.gen(function* () {
    const service = yield* CtxPackService.Service
    const materializer = yield* CtxPackMaterializer.Service

    return handlers
      .handle(
        "workspace.ctxpack.create",
        Effect.fn(function* (ctx) {
          const user = yield* requestUser
          return yield* service
            .create({ userID: user.id, workspaceID: ctx.params.workspaceID }, { workspaceID: ctx.params.workspaceID, ...ctx.payload })
            .pipe(Effect.mapError(toHttpError)) as Effect.Effect<CtxPack.Info, CtxPackHttpError>
        }),
      )
      .handle(
        "workspace.ctxpack.get",
        Effect.fn(function* (ctx) {
          const user = yield* requestUser
          return yield* service
            .get({ userID: user.id, workspaceID: ctx.params.workspaceID }, ctx.params.ctxPackID, false)
            .pipe(Effect.mapError(toHttpError)) as Effect.Effect<CtxPack.Info, CtxPackHttpError>
        }),
      )
      .handle(
        "workspace.ctxpack.list",
        Effect.fn(function* (ctx) {
          const user = yield* requestUser
          const request = yield* normalizeListQuery(ctx.params.workspaceID, ctx.query).pipe(Effect.mapError(toHttpError))
          return yield* service
            .list({ userID: user.id, workspaceID: ctx.params.workspaceID }, request)
            .pipe(Effect.mapError(toHttpError)) as Effect.Effect<CtxPack.CtxPackListResult, CtxPackHttpError>
        }),
      )
      .handle(
        "workspace.ctxpack.patch",
        Effect.fn(function* (ctx) {
          const user = yield* requestUser
          return yield* service
            .patch(
              { userID: user.id, workspaceID: ctx.params.workspaceID },
              { workspaceID: ctx.params.workspaceID, ctxPackID: ctx.params.ctxPackID, ...ctx.payload },
            )
            .pipe(Effect.mapError(toHttpError)) as Effect.Effect<CtxPack.Info, CtxPackHttpError>
        }),
      )
      .handle(
        "workspace.ctxpack.remove",
        Effect.fn(function* (ctx) {
          const user = yield* requestUser
          return yield* service
            .remove(
              { userID: user.id, workspaceID: ctx.params.workspaceID },
              { ctxPackID: ctx.params.ctxPackID, expectedRevision: ctx.payload.expectedRevision },
            )
            .pipe(Effect.map(() => undefined), Effect.mapError(toHttpError)) as Effect.Effect<
            void,
            CtxPackHttpError
          >
        }),
      )
      .handle(
        "workspace.ctxpack.restore",
        Effect.fn(function* (ctx) {
          const user = yield* requestUser
          return yield* service
            .restore(
              { userID: user.id, workspaceID: ctx.params.workspaceID },
              { ctxPackID: ctx.params.ctxPackID, expectedRevision: ctx.payload.expectedRevision },
            )
            .pipe(Effect.mapError(toHttpError)) as Effect.Effect<CtxPack.Info, CtxPackHttpError>
        }),
      )
      .handle(
        "workspace.ctxpack.materialize",
        Effect.fn(function* (ctx) {
          const user = yield* requestUser
          return yield* materializer
            .materialize(
              { userID: user.id, workspaceID: ctx.params.workspaceID },
              {
                workspaceID: ctx.params.workspaceID,
                ctxPackID: ctx.params.ctxPackID,
                ...ctx.payload,
              },
            )
            .pipe(Effect.mapError(toHttpError)) as Effect.Effect<
            Schema.Schema.Type<typeof CtxPackMaterializeResult>,
            CtxPackHttpError
          >
        }),
      )
  }),
)
