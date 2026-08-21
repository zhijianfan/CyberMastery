/**
 * CtxPackBrowser — local (frozen) type surface for the context-pack browser view.
 *
 * These types are SELF-CONTAINED local definitions. Lane S1 owns the canonical
 * schema types in parallel; M1 will align this file's imports to S1's types.
 * Field names are frozen — do not rename.
 */

export type CtxPackSensitivity = "public" | "workspace" | "private"

export type CtxPackSourceKind =
  | "message"
  | "tool-output"
  | "terminal"
  | "file"
  | "search"
  | "note"
  | "block-text"

export type CtxPackSort =
  | "created-desc"
  | "created-asc"
  | "updated-desc"
  | "title-asc"
  | "tokens-desc"
  | "most-attached"
  | "recently-attached"

export interface CtxPackUsage {
  attachedCount: number
  lastAttachedAt: number | null
}

export interface CtxPackSummary {
  id: string
  workspaceID: string
  title: string
  keywords: string[]
  sensitivity: CtxPackSensitivity
  revision: number
  contentHash: string
  byteLength: number
  estimatedTokens: number
  fragmentCount: number
  sourceBlockIDs: string[]
  sourceFunctionalityIDs: string[]
  sourceKinds: CtxPackSourceKind[]
  usage: CtxPackUsage
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface CtxPackSource {
  workspaceID: string
  blockID: string
  functionalityID: string
  kind: CtxPackSourceKind
  direction: "sent" | "received" | "generated" | "unknown"
  sourceTimestamp: number | null
  capturedAt: number
  entityRef: { type: string; id: string } | null
  label: string | null
  metadata: Record<string, string | number | boolean | null>
  sensitivity: CtxPackSensitivity
}

export interface CtxPackFragment {
  id: string
  clientFragmentID: string
  text: string
  source: CtxPackSource
  ordinal: number
  contentHash: string
  byteLength: number
  estimatedTokens: number
}

export interface CtxPackInfo {
  id: string
  workspaceID: string
  title: string
  keywords: string[]
  sensitivity: CtxPackSensitivity
  revision: number
  contentHash: string
  byteLength: number
  estimatedTokens: number
  fragments: CtxPackFragment[]
  usage: CtxPackUsage
  createdByUserID: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface CtxPackListQuery {
  workspaceID: string
  query: string
  keyword: string | null
  sourceBlockID: string | null
  sourceFunctionalityID: string | null
  sourceKind: CtxPackSourceKind | null
  sensitivity: CtxPackSensitivity | null
  createdAfter: number | null
  createdBefore: number | null
  includeDeleted: boolean
  sort: CtxPackSort
  cursor: string | null
  limit: number
}

export interface CtxPackPatchInput {
  title?: string
  keywords?: string[]
  sensitivity?: CtxPackSensitivity
}

export const CTXPACK_DRAG_MIME = "application/x-opencode-ctxpack+json"
