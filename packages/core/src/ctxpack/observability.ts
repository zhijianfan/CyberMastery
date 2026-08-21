// CtxPack observability: metrics recorder + audit recorder.
//
// The metric names and label keys below are FROZEN by the CtxPack spec.
// Audit records carry ONLY the allowed field set (correlationId, workspaceID,
// ctxPackID, userID, operation, sensitivity, byteLength, estimatedTokens,
// fragmentCount, result, errorCode). NEVER text, keywords, titles, source
// metadata JSON, capsule bodies, or credentials — and never label values with
// title/keyword/workspace-name/fragment-text/block-label/userID.
//
// The repo's packages/core/src/observability only ships logging/OTLP helpers,
// so this module defines a minimal recorder interface with a no-op default.
// A production layer can swap in an OTel-backed implementation later.

import { Context, Layer } from "effect"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import { makeGlobalNode } from "../effect/app-node"

// Frozen metric contract: name -> allowed label keys (empty = no labels).
export const METRICS = {
  operationsTotal: { name: "ctxpack_operations_total", labels: ["operation", "status"] },
  operationDurationMs: { name: "ctxpack_operation_duration_ms", labels: ["operation"] },
  searchDurationMs: { name: "ctxpack_search_duration_ms", labels: ["has_query", "sort"] },
  materializedTotal: { name: "ctxpack_materialized_total", labels: ["status", "sensitivity"] },
  attachmentAdmissionTotal: { name: "ctxpack_attachment_admission_total", labels: ["status"] },
  selectedBytes: { name: "ctxpack_selected_bytes", labels: [] },
  estimatedTokens: { name: "ctxpack_estimated_tokens", labels: [] },
  eventPublishFailuresTotal: { name: "ctxpack_event_publish_failures_total", labels: [] },
} as const

export type CtxPackAuditOperation =
  | "create"
  | "patch"
  | "remove"
  | "restore"
  | "materialize"
  | "denied-materialize"
  | "admitted-use"

export type CtxPackAuditResult = "ok" | "denied" | "failed"

// Audit entry. Optional payload fields are OMITTED from the recorded object
// when unknown (e.g. a denied materialize never carries content statistics),
// so recorders only ever see the allowed field set.
export interface CtxPackAuditEntry {
  readonly correlationId: string | null
  readonly workspaceID: string
  readonly ctxPackID: string
  readonly userID: string
  readonly operation: CtxPackAuditOperation
  readonly sensitivity?: CtxPack.Sensitivity
  readonly byteLength?: number
  readonly estimatedTokens?: number
  readonly fragmentCount?: number
  readonly result: CtxPackAuditResult
  readonly errorCode?: string
}

export interface CtxPackMetricsRecorder {
  readonly operationsTotal: (attributes: { operation: string; status: string }) => void
  readonly operationDurationMs: (attributes: { operation: string }, value: number) => void
  readonly searchDurationMs: (attributes: { has_query: boolean; sort: string }, value: number) => void
  readonly materializedTotal: (attributes: { status: string; sensitivity: string }) => void
  readonly attachmentAdmissionTotal: (attributes: { status: string }) => void
  readonly selectedBytes: (value: number) => void
  readonly estimatedTokens: (value: number) => void
  readonly eventPublishFailuresTotal: () => void
}

export interface CtxPackAuditRecorder {
  readonly record: (entry: CtxPackAuditEntry) => void
}

export interface CtxPackObservability {
  readonly metrics: CtxPackMetricsRecorder
  readonly audit: CtxPackAuditRecorder
}

const noopMetrics: CtxPackMetricsRecorder = {
  operationsTotal: () => undefined,
  operationDurationMs: () => undefined,
  searchDurationMs: () => undefined,
  materializedTotal: () => undefined,
  attachmentAdmissionTotal: () => undefined,
  selectedBytes: () => undefined,
  estimatedTokens: () => undefined,
  eventPublishFailuresTotal: () => undefined,
}

export const noop: CtxPackObservability = {
  metrics: noopMetrics,
  audit: { record: () => undefined },
}

export class CtxPackObservabilityService extends Context.Service<
  CtxPackObservabilityService,
  CtxPackObservability
>()("@opencode/v2/CtxPackObservability") {}

export const layer = Layer.succeed(CtxPackObservabilityService, noop)

export const node = makeGlobalNode({ service: CtxPackObservabilityService, layer, deps: [] })

// Record helpers --------------------------------------------------------------
//
// Safe by construction: they only accept identity/statistics fields, never
// content. The service layer (C1) and the usage ledger (usage.ts) call these.

export interface RecordOperationInput {
  readonly correlationId: string | null
  readonly workspaceID: string
  readonly ctxPackID: string
  readonly userID: string
  readonly operation: CtxPackAuditOperation
  /** Metric status AND audit result: "ok" | "denied" | "failed". */
  readonly status: CtxPackAuditResult
  readonly durationMs: number
  readonly sensitivity?: CtxPack.Sensitivity
  readonly byteLength?: number
  readonly estimatedTokens?: number
  readonly fragmentCount?: number
  readonly errorCode?: string
}

export function recordOperation(observability: CtxPackObservability, input: RecordOperationInput): void {
  observability.metrics.operationsTotal({ operation: input.operation, status: input.status })
  observability.metrics.operationDurationMs({ operation: input.operation }, input.durationMs)
  observability.audit.record({
    correlationId: input.correlationId,
    workspaceID: input.workspaceID,
    ctxPackID: input.ctxPackID,
    userID: input.userID,
    operation: input.operation,
    ...(input.sensitivity !== undefined ? { sensitivity: input.sensitivity } : {}),
    ...(input.byteLength !== undefined ? { byteLength: input.byteLength } : {}),
    ...(input.estimatedTokens !== undefined ? { estimatedTokens: input.estimatedTokens } : {}),
    ...(input.fragmentCount !== undefined ? { fragmentCount: input.fragmentCount } : {}),
    result: input.status,
    ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
  })
}

export interface DeniedMaterializeInput {
  readonly correlationId: string | null
  readonly workspaceID: string
  readonly ctxPackID: string
  readonly userID: string
  readonly errorCode: string
  readonly durationMs?: number
}

// A denied materialize never knows content statistics, so its audit record
// carries only result + errorCode (plus the identity fields).
export function recordDeniedMaterialize(observability: CtxPackObservability, input: DeniedMaterializeInput): void {
  observability.metrics.operationsTotal({ operation: "materialize", status: "denied" })
  observability.metrics.operationDurationMs({ operation: "materialize" }, input.durationMs ?? 0)
  observability.audit.record({
    correlationId: input.correlationId,
    workspaceID: input.workspaceID,
    ctxPackID: input.ctxPackID,
    userID: input.userID,
    operation: "denied-materialize",
    result: "denied",
    errorCode: input.errorCode,
  })
}

export function recordSearch(
  observability: CtxPackObservability,
  input: { hasQuery: boolean; sort: string; durationMs: number },
): void {
  observability.metrics.searchDurationMs({ has_query: input.hasQuery, sort: input.sort }, input.durationMs)
}

export function recordMaterialized(
  observability: CtxPackObservability,
  input: { status: "ok" | "denied"; sensitivity: CtxPack.Sensitivity },
): void {
  observability.metrics.materializedTotal({ status: input.status, sensitivity: input.sensitivity })
}

export function recordAdmission(
  observability: CtxPackObservability,
  input: { status: "counted" | "duplicate" },
): void {
  observability.metrics.attachmentAdmissionTotal({ status: input.status })
}

export function recordSelected(
  observability: CtxPackObservability,
  input: { bytes: number; estimatedTokens: number },
): void {
  observability.metrics.selectedBytes(input.bytes)
  observability.metrics.estimatedTokens(input.estimatedTokens)
}

export function recordEventPublishFailure(observability: CtxPackObservability): void {
  observability.metrics.eventPublishFailuresTotal()
}
