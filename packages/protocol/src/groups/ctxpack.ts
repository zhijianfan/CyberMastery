// CtxPack typed routes (Track P1).
//
// Thin typed surface for workspace context packs: create, get, list, patch,
// remove, restore, and materialize. The handler layer
// (packages/server/src/handlers/ctxpack.ts) translates between this group and
// the CtxPack core service; no business logic lives here. The materialize
// response never carries capsule contents — its success schema is limited to
// pack metadata (contextCapsuleID, sourceCtxPackID, label, contentHash,
// estimatedTokens).

import { CtxPack } from "@opencode-ai/schema/ctxpack"
import { NonNegativeInt, optional } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Effect, Encoding, Result, Schema, SchemaGetter } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"

const root = "/api/workspace/:workspaceID/ctxpack"

// Typed errors serializing the frozen domain tags to stable client codes.
// Each maps 1:1 to a CtxPack domain error `_tag`; the handler owns the
// translation (packages/server/src/handlers/ctxpack.ts).
export class CtxPackNotFoundError extends Schema.TaggedErrorClass<CtxPackNotFoundError>()(
  "CtxPackNotFoundError",
  {
    ctxPackID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class CtxPackDeletedError extends Schema.TaggedErrorClass<CtxPackDeletedError>()(
  "CtxPackDeletedError",
  {
    ctxPackID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class CtxPackRevisionConflictError extends Schema.TaggedErrorClass<CtxPackRevisionConflictError>()(
  "CtxPackRevisionConflictError",
  {
    currentRevision: NonNegativeInt,
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export class CtxPackContentChangedError extends Schema.TaggedErrorClass<CtxPackContentChangedError>()(
  "CtxPackContentChangedError",
  {
    currentContentHash: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export class CtxPackInvalidSelectionError extends Schema.TaggedErrorClass<CtxPackInvalidSelectionError>()(
  "CtxPackInvalidSelectionError",
  {
    reason: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export class CtxPackBudgetExceededError extends Schema.TaggedErrorClass<CtxPackBudgetExceededError>()(
  "CtxPackBudgetExceededError",
  {
    bytes: NonNegativeInt,
    estimatedTokens: NonNegativeInt,
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export class CtxPackSecretSourceDeniedError extends Schema.TaggedErrorClass<CtxPackSecretSourceDeniedError>()(
  "CtxPackSecretSourceDeniedError",
  {
    clientFragmentID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export class CtxPackCrossWorkspaceDeniedError extends Schema.TaggedErrorClass<CtxPackCrossWorkspaceDeniedError>()(
  "CtxPackCrossWorkspaceDeniedError",
  {
    sourceWorkspaceID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export class CtxPackPermissionDeniedError extends Schema.TaggedErrorClass<CtxPackPermissionDeniedError>()(
  "CtxPackPermissionDeniedError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 403 },
) {}

export class CtxPackSearchCursorInvalidError extends Schema.TaggedErrorClass<CtxPackSearchCursorInvalidError>()(
  "CtxPackSearchCursorInvalidError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

const CtxPackParams = {
  workspaceID: Workspace.ID,
}

const CtxPackIDParams = {
  workspaceID: Workspace.ID,
  ctxPackID: CtxPack.ID,
}

// Wire payload for create: workspaceID arrives in params (input-field
// collision with the payload is rejected by httpapi-codegen), so the handler
// merges params into the frozen CtxPackCreateRequest domain shape. No
// refinements here — the core service validates all limits.
export const CtxPackCreatePayload = Schema.Struct({
  title: Schema.String,
  keywords: Schema.Array(Schema.String),
  tags: optional(Schema.Array(CtxPack.Tag)),
  sensitivity: CtxPack.Sensitivity,
  fragments: Schema.Array(CtxPack.FragmentInput),
  idempotencyKey: Schema.String,
}).annotate({ identifier: "CtxPack.CreatePayload" })

// Wire payload for patch: workspaceID/ctxPackID come from params.
export const CtxPackPatchPayload = Schema.Struct({
  expectedRevision: NonNegativeInt,
  patch: Schema.Struct({
    title: optional(Schema.String),
    keywords: optional(Schema.Array(Schema.String)),
    tags: optional(Schema.Array(CtxPack.Tag)),
    sensitivity: optional(CtxPack.Sensitivity),
  }),
  idempotencyKey: Schema.String,
}).annotate({ identifier: "CtxPack.PatchPayload" })

// Payload for the CAS remove/restore endpoints.
export const CtxPackRevisionPayload = Schema.Struct({
  expectedRevision: NonNegativeInt,
}).annotate({ identifier: "CtxPack.RevisionPayload" })

// Materialize request/result. The result shape is frozen and deliberately
// excludes capsule contents. The wire payload carries only the fields that
// are not already in the URL (workspaceID/ctxPackID come from params); the
// handler merges params + payload into X1's frozen CtxPackMaterializeRequest.
export const CtxPackMaterializeRequest = Schema.Struct({
  expectedContentHash: Schema.String,
  targetInstanceID: Schema.String,
  targetFunctionalityID: Schema.String,
}).annotate({ identifier: "CtxPack.MaterializeRequest" })

export const CtxPackMaterializeResult = Schema.Struct({
  contextCapsuleID: Schema.String,
  sourceCtxPackID: CtxPack.ID,
  label: Schema.String,
  tags: optional(Schema.Array(CtxPack.Tag)),
  contentHash: Schema.String,
  estimatedTokens: NonNegativeInt,
}).annotate({ identifier: "CtxPack.MaterializeResult" })

// List query ---------------------------------------------------------------
//
// Wire-level cursor stays a plain string; the check rejects malformed cursors
// so a bad cursor surfaces as a typed request error at decode time instead of
// reaching the service. Semantic cursor validity remains the service's
// concern (CtxPackSearchCursorInvalidError). The cursor format mirrors the
// repo convention (base64url-encoded payload, see groups/session.ts).
const CtxPackListCursor = Schema.String.check(
  Schema.makeFilter(
    (cursor) => {
      if (cursor.length === 0) return "cursor must not be empty"
      const decoded = Encoding.decodeBase64UrlString(cursor)
      return Result.isFailure(decoded) ? "cursor must be a valid base64url string" : undefined
    },
    { identifier: "CtxPack.ListCursor" },
  ),
)

// Wire list query: plain optional strings only. httpapi-codegen rejects the
// decoding-default/transform schemas (unportable encoding links), so wire→
// domain normalization (defaults, int parsing, sort literal validation,
// cursor shape check) lives in the handler and maps failures to typed errors.
export const CtxPackListQuery = Schema.Struct({
  query: optional(Schema.String),
  keyword: optional(Schema.String),
  sourceBlockID: optional(Schema.String),
  sourceFunctionalityID: optional(Schema.String),
  sourceKind: optional(Schema.String),
  sensitivity: optional(Schema.String),
  createdAfter: optional(Schema.String),
  createdBefore: optional(Schema.String),
  includeDeleted: optional(Schema.String),
  sort: optional(Schema.String),
  cursor: optional(Schema.String),
  limit: optional(Schema.String),
}).annotate({ identifier: "CtxPack.ListQuery" })

// The handler maps the full frozen domain error union onto this group's error
// schemas, so every endpoint declares the full set; M1 may refine the lists
// per endpoint once the real service contracts land.
const CtxPackErrors = [
  CtxPackNotFoundError,
  CtxPackDeletedError,
  CtxPackRevisionConflictError,
  CtxPackContentChangedError,
  CtxPackInvalidSelectionError,
  CtxPackBudgetExceededError,
  CtxPackSecretSourceDeniedError,
  CtxPackCrossWorkspaceDeniedError,
  CtxPackPermissionDeniedError,
  CtxPackSearchCursorInvalidError,
]

export const CtxPackGroup = HttpApiGroup.make("server.workspace.ctxpack")
  .add(
    HttpApiEndpoint.post("workspace.ctxpack.create", root, {
      params: CtxPackParams,
      payload: CtxPackCreatePayload,
      success: CtxPack.Info,
      error: CtxPackErrors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.ctxpack.create",
        summary: "Create a context pack",
        description: "Create a context pack from selected fragments in the workspace.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("workspace.ctxpack.get", `${root}/:ctxPackID`, {
      params: CtxPackIDParams,
      success: CtxPack.Info,
      error: CtxPackErrors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.ctxpack.get",
        summary: "Get a context pack",
        description: "Retrieve a context pack by ID, including its fragments.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("workspace.ctxpack.list", root, {
      params: CtxPackParams,
      query: CtxPackListQuery,
      success: CtxPack.ListResult,
      error: CtxPackErrors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.ctxpack.list",
        summary: "List context packs",
        description: "List context packs in a workspace with filtering, sorting, and cursor pagination.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("workspace.ctxpack.patch", `${root}/:ctxPackID`, {
      params: CtxPackIDParams,
      payload: CtxPackPatchPayload,
      success: CtxPack.Info,
      error: CtxPackErrors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.ctxpack.patch",
        summary: "Patch a context pack",
        description: "Update a context pack's metadata, guarded by the expected revision.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("workspace.ctxpack.remove", `${root}/:ctxPackID`, {
      params: CtxPackIDParams,
      payload: CtxPackRevisionPayload,
      success: HttpApiSchema.NoContent,
      error: CtxPackErrors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.ctxpack.remove",
        summary: "Remove a context pack",
        description: "Soft-delete a context pack, guarded by the expected revision.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.ctxpack.restore", `${root}/:ctxPackID/restore`, {
      params: CtxPackIDParams,
      payload: CtxPackRevisionPayload,
      success: CtxPack.Info,
      error: CtxPackErrors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.ctxpack.restore",
        summary: "Restore a context pack",
        description: "Restore a soft-deleted context pack, guarded by the expected revision.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.ctxpack.materialize", `${root}/:ctxPackID/materialize`, {
      params: CtxPackIDParams,
      payload: CtxPackMaterializeRequest,
      success: CtxPackMaterializeResult,
      error: CtxPackErrors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.ctxpack.materialize",
        summary: "Materialize a context pack",
        description:
          "Materialize a context pack into a context capsule. The response carries capsule metadata only, never capsule contents.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "ctxpack",
      description: "Context pack routes.",
    }),
  )
