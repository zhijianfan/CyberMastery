export * as CtxPack from "./ctxpack"

import { createHash } from "node:crypto"
import { Schema } from "effect"
import { Event } from "./event"
import { ascending } from "./identifier"
import { NonNegativeInt, optional, statics } from "./schema"

// IDs -----------------------------------------------------------------------

export const ID = Schema.String.check(Schema.isStartsWith("ctxpk_")).pipe(
  Schema.brand("CtxPack.ID"),
  statics((schema) => {
    const create = () => schema.make("ctxpk_" + ascending())
    return {
      create,
      ascending: (id?: string) => {
        if (!id) return create()
        if (!id.startsWith("ctxpk_")) throw new Error(`ID ${id} does not start with ctxpk_`)
        return schema.make(id)
      },
    }
  }),
)
export type ID = typeof ID.Type

export const FragmentID = Schema.String.check(Schema.isStartsWith("ctxpkf_")).pipe(
  Schema.brand("CtxPack.FragmentID"),
  statics((schema) => {
    const create = () => schema.make("ctxpkf_" + ascending())
    return {
      create,
      ascending: (id?: string) => {
        if (!id) return create()
        if (!id.startsWith("ctxpkf_")) throw new Error(`ID ${id} does not start with ctxpkf_`)
        return schema.make(id)
      },
    }
  }),
)
export type FragmentID = typeof FragmentID.Type

// Unions ---------------------------------------------------------------------

export const SourceKind = Schema.Literals(["message", "tool-output", "terminal", "file", "search", "note", "block-text"])
export type SourceKind = typeof SourceKind.Type

export const Direction = Schema.Literals(["sent", "received", "generated", "unknown"])
export type Direction = typeof Direction.Type

export const Sensitivity = Schema.Literals(["public", "workspace", "private"])
export type Sensitivity = typeof Sensitivity.Type

// Shapes ---------------------------------------------------------------------

export const MetadataValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null])

export const Source = Schema.Struct({
  workspaceID: Schema.String,
  blockID: Schema.String,
  functionalityID: Schema.String,
  kind: SourceKind,
  direction: Direction,
  sourceTimestamp: Schema.NullOr(NonNegativeInt),
  capturedAt: NonNegativeInt,
  entityRef: Schema.NullOr(Schema.Struct({ type: Schema.String, id: Schema.String })),
  label: Schema.NullOr(Schema.String),
  metadata: Schema.Record(Schema.String, MetadataValue),
  sensitivity: Sensitivity,
}).annotate({ identifier: "CtxPack.Source" })
export interface Source extends Schema.Schema.Type<typeof Source> {}

// M1: plain String on the wire — the non-empty-after-normalization check is
// enforced by the core service (validation.ts); a makeFilter here would make
// the create payload unportable for httpapi-codegen.
const fragmentText = Schema.String

export const FragmentInput = Schema.Struct({
  clientFragmentID: Schema.String,
  text: fragmentText,
  source: Source,
}).annotate({ identifier: "CtxPack.FragmentInput" })
export interface FragmentInput extends Schema.Schema.Type<typeof FragmentInput> {}

export const Fragment = Schema.Struct({
  id: FragmentID,
  ordinal: NonNegativeInt,
  contentHash: Schema.String,
  byteLength: NonNegativeInt,
  estimatedTokens: NonNegativeInt,
  clientFragmentID: Schema.String,
  text: fragmentText,
  source: Source,
}).annotate({ identifier: "CtxPack.Fragment" })
export interface Fragment extends Schema.Schema.Type<typeof Fragment> {}

export const Usage = Schema.Struct({
  attachedCount: NonNegativeInt,
  lastAttachedAt: Schema.NullOr(NonNegativeInt),
}).annotate({ identifier: "CtxPack.Usage" })
export interface Usage extends Schema.Schema.Type<typeof Usage> {}

export const Info = Schema.Struct({
  id: ID,
  workspaceID: Schema.String,
  title: Schema.String,
  keywords: Schema.Array(Schema.String),
  sensitivity: Sensitivity,
  revision: NonNegativeInt,
  contentHash: Schema.String,
  byteLength: NonNegativeInt,
  estimatedTokens: NonNegativeInt,
  fragments: Schema.Array(Fragment),
  usage: Usage,
  createdByUserID: Schema.String,
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
  deletedAt: Schema.NullOr(NonNegativeInt),
}).annotate({ identifier: "CtxPack.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Summary = Schema.Struct({
  id: ID,
  workspaceID: Schema.String,
  title: Schema.String,
  keywords: Schema.Array(Schema.String),
  sensitivity: Sensitivity,
  revision: NonNegativeInt,
  contentHash: Schema.String,
  byteLength: NonNegativeInt,
  estimatedTokens: NonNegativeInt,
  fragmentCount: NonNegativeInt,
  sourceBlockIDs: Schema.Array(Schema.String),
  sourceFunctionalityIDs: Schema.Array(Schema.String),
  sourceKinds: Schema.Array(SourceKind),
  usage: Usage,
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
  deletedAt: Schema.NullOr(NonNegativeInt),
}).annotate({ identifier: "CtxPack.Summary" })
export interface Summary extends Schema.Schema.Type<typeof Summary> {}

// Event ----------------------------------------------------------------------

export const CtxPackChanged = Event.define({
  type: "workspace.ctxpack.changed",
  schema: {
    workspaceID: Schema.String,
    ctxPackID: Schema.String,
    revision: Schema.Int,
    change: Schema.Literals(["created", "metadata-updated", "deleted", "restored", "used"]),
  },
})

export const Definitions = Event.inventory(CtxPackChanged)

// Normalization ---------------------------------------------------------------

export function normalizeSelectedText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim()
}

export function normalizeKeyword(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ")
}

// Hashing + token estimation ---------------------------------------------------

export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8")
}

export function contentHash(
  fragments: ReadonlyArray<{ readonly ordinal: number; readonly text: string; readonly source: Source }>,
): string {
  const canonical = JSON.stringify(
    fragments.map((fragment) => ({
      ordinal: fragment.ordinal,
      text: normalizeSelectedText(fragment.text),
      source: canonicalizeSource(fragment.source),
    })),
  )
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`
}

export function estimateTokens(utf8ByteLength: number): number {
  return Math.ceil(utf8ByteLength / 4)
}

function canonicalizeSource(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeSource)
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = canonicalizeSource((value as Record<string, unknown>)[key])
    }
    return result
  }
  return value
}

// Sort ------------------------------------------------------------------------

export const Sort = Schema.Literals([
  "created-desc",
  "created-asc",
  "updated-desc",
  "title-asc",
  "tokens-desc",
  "most-attached",
  "recently-attached",
])
export type CtxPackSort = typeof Sort.Type

// Requests --------------------------------------------------------------------

// M1: the wire payload carries no refinements — httpapi-codegen rejects
// Schema.check filters as unportable. The frozen limits (title length,
// keyword count/length, fragment count, cross-workspace sources) are enforced
// by the core service (validation.ts) and surface as CtxPackInvalidSelection /
// CtxPackCrossWorkspaceDenied.
export const CreateRequest = Schema.Struct({
  workspaceID: Schema.String,
  title: Schema.String,
  keywords: Schema.Array(Schema.String),
  sensitivity: Sensitivity,
  fragments: Schema.Array(FragmentInput),
  idempotencyKey: Schema.String,
}).annotate({ identifier: "CtxPack.CreateRequest" })
export interface CtxPackCreateRequest extends Schema.Schema.Type<typeof CreateRequest> {}

export const PatchRequest = Schema.Struct({
  workspaceID: Schema.String,
  ctxPackID: ID,
  expectedRevision: NonNegativeInt,
  patch: Schema.Struct({
    title: optional(Schema.String),
    keywords: optional(Schema.Array(Schema.String)),
    sensitivity: optional(Sensitivity),
  }),
  idempotencyKey: Schema.String,
}).annotate({ identifier: "CtxPack.PatchRequest" })
export interface CtxPackPatchRequest extends Schema.Schema.Type<typeof PatchRequest> {}

export const ListRequest = Schema.Struct({
  workspaceID: Schema.String,
  query: Schema.String,
  keyword: Schema.NullOr(Schema.String),
  sourceBlockID: Schema.NullOr(Schema.String),
  sourceFunctionalityID: Schema.NullOr(Schema.String),
  sourceKind: Schema.NullOr(SourceKind),
  sensitivity: Schema.NullOr(Sensitivity),
  createdAfter: Schema.NullOr(NonNegativeInt),
  createdBefore: Schema.NullOr(NonNegativeInt),
  includeDeleted: Schema.Boolean,
  sort: Sort,
  cursor: Schema.NullOr(Schema.String),
  limit: NonNegativeInt,
}).annotate({ identifier: "CtxPack.ListRequest" })
export interface CtxPackListRequest extends Schema.Schema.Type<typeof ListRequest> {}

export const ListResult = Schema.Struct({
  items: Schema.Array(Summary),
  nextCursor: Schema.NullOr(Schema.String),
  totalEstimate: Schema.NullOr(NonNegativeInt),
}).annotate({ identifier: "CtxPack.ListResult" })
export interface CtxPackListResult extends Schema.Schema.Type<typeof ListResult> {}

// Errors ----------------------------------------------------------------------

export type CtxPackError =
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
