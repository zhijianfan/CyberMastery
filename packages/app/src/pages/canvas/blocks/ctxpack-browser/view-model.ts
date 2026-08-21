/**
 * CtxPackBrowser view/command contract.
 *
 * This is the exact surface consumed by lane R1's runtime adapter
 * (CtxPackBrowserView + CtxPackBrowserCommand) — do not rename or reshape.
 * The component renders against a pure projection accessor + fake dispatch;
 * no server SDK, no runtime registration, no EventV2 — those are R1/M1.
 */

import type { Accessor } from "solid-js"
import type { CtxPackInfo, CtxPackListQuery, CtxPackPatchInput, CtxPackSummary } from "./types"

export interface CtxPackBrowserView {
  status: "loading" | "ready" | "stale" | "permission-denied" | "unavailable" | "error"
  query: CtxPackListQuery
  items: CtxPackSummary[]
  nextCursor: string | null
  selected: CtxPackInfo | null
  loadingMore: boolean
  errorCode: string | null
  canCreate: boolean
  canPatch: boolean
  canDelete: boolean
  canMaterialize: boolean
}

export type CtxPackBrowserCommand =
  | { type: "set-query"; patch: Partial<CtxPackListQuery> }
  | { type: "load-more" }
  | { type: "open"; ctxPackID: string }
  | { type: "close-detail" }
  | { type: "patch-metadata"; ctxPackID: string; expectedRevision: number; patch: CtxPackPatchInput }
  | { type: "remove"; ctxPackID: string; expectedRevision: number }
  | { type: "restore"; ctxPackID: string; expectedRevision: number }

export interface CtxPackBrowserProps {
  view: Accessor<CtxPackBrowserView>
  dispatch(command: CtxPackBrowserCommand): Promise<void>
  createDragPayload(summary: CtxPackSummary): string
  attachToFocusedInput(summary: CtxPackSummary): Promise<void>
}

export function initialCtxPackBrowserView(): CtxPackBrowserView {
  return {
    status: "loading",
    query: {
      workspaceID: "",
      query: "",
      keyword: null,
      sourceBlockID: null,
      sourceFunctionalityID: null,
      sourceKind: null,
      sensitivity: null,
      createdAfter: null,
      createdBefore: null,
      includeDeleted: false,
      sort: "created-desc",
      cursor: null,
      limit: 30,
    },
    items: [],
    nextCursor: null,
    selected: null,
    loadingMore: false,
    errorCode: null,
    canCreate: false,
    canPatch: false,
    canDelete: false,
    canMaterialize: false,
  }
}
