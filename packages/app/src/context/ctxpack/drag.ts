/**
 * CtxPack drag-and-drop transport (Wave 1 / U3).
 *
 * The drag payload carries identity metadata only: which workspace, which
 * CtxPack, its content hash, a display label, and an estimated size. It never
 * carries content-bearing fields or credentials — the DataTransfer only ever
 * receives the six payload fields plus the plain-text label.
 */

export const CTXPACK_DRAG_MIME = "application/x-opencode-ctxpack+json"

export interface CtxPackDragPayloadV1 {
  version: 1
  workspaceID: string
  ctxPackID: string
  contentHash: string
  label: string
  estimatedTokens: number
}

const CTXPACK_DRAG_PAYLOAD_KEYS = [
  "version",
  "workspaceID",
  "ctxPackID",
  "contentHash",
  "label",
  "estimatedTokens",
] as const

export function serializeCtxPackDragPayload(payload: CtxPackDragPayloadV1): string {
  return JSON.stringify(payload)
}

export function parseCtxPackDragPayload(dataTransfer: DataTransfer): CtxPackDragPayloadV1 | null {
  const raw = dataTransfer.getData(CTXPACK_DRAG_MIME)
  if (raw === "") return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const record = parsed as Record<string, unknown>
  if (Object.keys(record).length !== CTXPACK_DRAG_PAYLOAD_KEYS.length) return null
  for (const key of CTXPACK_DRAG_PAYLOAD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return null
  }
  if (record.version !== 1) return null
  if (typeof record.workspaceID !== "string" || record.workspaceID === "") return null
  if (typeof record.ctxPackID !== "string" || record.ctxPackID === "") return null
  if (typeof record.contentHash !== "string" || record.contentHash === "") return null
  if (typeof record.label !== "string" || record.label === "") return null
  if (typeof record.estimatedTokens !== "number") return null
  return {
    version: 1,
    workspaceID: record.workspaceID,
    ctxPackID: record.ctxPackID,
    contentHash: record.contentHash,
    label: record.label,
    estimatedTokens: record.estimatedTokens,
  }
}

/**
 * Drag-source helper (used by the CtxPack drag handle on dragstart): writes
 * the custom MIME with the serialized payload, the label as plain text, and
 * declares a copy effect. Nothing else ever enters the DataTransfer.
 */
export function applyCtxPackDrag(dataTransfer: DataTransfer, payload: CtxPackDragPayloadV1): void {
  dataTransfer.setData(CTXPACK_DRAG_MIME, serializeCtxPackDragPayload(payload))
  dataTransfer.setData("text/plain", payload.label)
  dataTransfer.effectAllowed = "copy"
}
