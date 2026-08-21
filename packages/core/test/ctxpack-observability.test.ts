import { describe, expect, test } from "bun:test"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import { CtxPackUsage } from "@opencode-ai/core/ctxpack/usage"
import {
  METRICS,
  noop,
  recordAdmission,
  recordDeniedMaterialize,
  recordEventPublishFailure,
  recordMaterialized,
  recordOperation,
  recordSearch,
  recordSelected,
  type CtxPackAuditEntry,
  type CtxPackMetricsRecorder,
  type CtxPackObservability,
} from "@opencode-ai/core/ctxpack/observability"
import { ensureCtxPackFts, make } from "@opencode-ai/core/ctxpack/sql"
import type { CtxPackRepository } from "@opencode-ai/core/ctxpack/sql"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import ctxPackMigration from "@opencode-ai/core/database/migration/20260821_ctxpack"
import usageMigration from "@opencode-ai/core/database/migration/20260821_ctxpack_usage"

const SENTINEL_TITLE = "sentinel-title-7f3a9c"
const SENTINEL_KEYWORD = "sentinel-keyword-9c2b4d"
const SENTINEL_FRAGMENT = "sentinel-fragment-5d1e8f"
const SENTINELS = [SENTINEL_TITLE, SENTINEL_KEYWORD, SENTINEL_FRAGMENT]

const ALLOWED_AUDIT_KEYS = [
  "correlationId",
  "workspaceID",
  "ctxPackID",
  "userID",
  "operation",
  "sensitivity",
  "byteLength",
  "estimatedTokens",
  "fragmentCount",
  "result",
  "errorCode",
]

const makeDb = EffectDrizzleSqlite.makeWithDefaults()

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped))

const setup = () =>
  Effect.gen(function* () {
    const db = yield* makeDb
    yield* DatabaseMigration.apply(db)
    const hasCtxPack = yield* db.get<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ctx_pack'`,
    )
    if (!hasCtxPack) yield* db.transaction((tx) => ctxPackMigration.up(tx))
    // M1: ensure the FTS virtual table (fresh DBs skip the handwritten migration).
    yield* ensureCtxPackFts(db)
    const hasAdmission = yield* db.get<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ctx_pack_usage_admission'`,
    )
    if (!hasAdmission) yield* db.transaction((tx) => usageMigration.up(tx))
    return { db, repository: make(db) }
  })

// Records every metric emission and audit entry exactly as delivered.
const recordingObservability = () => {
  const metricEvents: Array<{ name: string; attributes: Record<string, unknown>; value?: number }> = []
  const auditEntries: CtxPackAuditEntry[] = []
  const metrics: CtxPackMetricsRecorder = {
    operationsTotal: (attributes) => metricEvents.push({ name: METRICS.operationsTotal.name, attributes }),
    operationDurationMs: (attributes, value) =>
      metricEvents.push({ name: METRICS.operationDurationMs.name, attributes, value }),
    searchDurationMs: (attributes, value) => metricEvents.push({ name: METRICS.searchDurationMs.name, attributes, value }),
    materializedTotal: (attributes) => metricEvents.push({ name: METRICS.materializedTotal.name, attributes }),
    attachmentAdmissionTotal: (attributes) =>
      metricEvents.push({ name: METRICS.attachmentAdmissionTotal.name, attributes }),
    selectedBytes: (value) => metricEvents.push({ name: METRICS.selectedBytes.name, attributes: {}, value }),
    estimatedTokens: (value) => metricEvents.push({ name: METRICS.estimatedTokens.name, attributes: {}, value }),
    eventPublishFailuresTotal: () => metricEvents.push({ name: METRICS.eventPublishFailuresTotal.name, attributes: {} }),
  }
  const observability: CtxPackObservability = { metrics, audit: { record: (entry) => auditEntries.push(entry) } }
  return { metricEvents, auditEntries, observability }
}

const source = (overrides: Partial<CtxPack.Source> = {}): CtxPack.Source => ({
  workspaceID: "ws-1",
  blockID: "block-1",
  functionalityID: "builtin:chat",
  kind: "message",
  direction: "received",
  sourceTimestamp: 1787300000000,
  capturedAt: 1787300010000,
  entityRef: { type: "message", id: "msg-1" },
  label: "Assistant response",
  metadata: {},
  sensitivity: "workspace",
  ...overrides,
})

const createPack = (repository: CtxPackRepository, overrides: Partial<CtxPackRepository.Create> = {}) =>
  repository.create({
    workspaceID: "ws-1",
    createdByUserID: "user-1",
    title: `Niagara pump ${SENTINEL_TITLE}`,
    keywords: ["Niagara", SENTINEL_KEYWORD],
    sensitivity: "workspace",
    fragments: [
      {
        clientFragmentID: "frag-0",
        text: `Fragment 0 findings ${SENTINEL_FRAGMENT} about the post-pressure stage.`,
        source: source(),
      },
    ],
    idempotencyKey: "create-1",
    now: 1787300020000,
    ...overrides,
  })

const exerciseAllOperations = (
  observability: CtxPackObservability,
  pack: CtxPack.Info,
) => {
  const base = {
    workspaceID: pack.workspaceID,
    ctxPackID: pack.id,
    userID: "user-1",
    sensitivity: pack.sensitivity,
    byteLength: pack.byteLength,
    estimatedTokens: pack.estimatedTokens,
    fragmentCount: pack.fragments.length,
  } as const
  recordOperation(observability, { correlationId: "corr-create", ...base, operation: "create", status: "ok", durationMs: 5 })
  recordOperation(observability, { correlationId: "corr-patch", ...base, operation: "patch", status: "ok", durationMs: 6 })
  recordOperation(observability, { correlationId: "corr-remove", ...base, operation: "remove", status: "ok", durationMs: 7 })
  recordOperation(observability, { correlationId: "corr-restore", ...base, operation: "restore", status: "ok", durationMs: 8 })
  recordOperation(observability, { correlationId: "corr-materialize", ...base, operation: "materialize", status: "ok", durationMs: 9 })
  recordMaterialized(observability, { status: "ok", sensitivity: pack.sensitivity })
  recordSelected(observability, { bytes: pack.byteLength, estimatedTokens: pack.estimatedTokens })
  recordSearch(observability, { hasQuery: false, sort: "created-desc", durationMs: 3 })
  recordAdmission(observability, { status: "counted" })
  recordDeniedMaterialize(observability, {
    correlationId: "corr-denied",
    workspaceID: pack.workspaceID,
    ctxPackID: pack.id,
    userID: "user-1",
    errorCode: "CtxPackSecretSourceDenied",
    durationMs: 4,
  })
}

describe("CtxPack observability", () => {
  test("sentinel redaction: recorders never see content, only the allowed field set", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const { metricEvents, auditEntries, observability } = recordingObservability()
        const created = yield* createPack(repository)

        // Direct record-helper exercise for every audited operation.
        exerciseAllOperations(observability, created)

        // Admitted-use through the real usage flow with the recording recorder.
        const usage = CtxPackUsage.make({
          db,
          repository,
          publisher: { publish: () => Effect.void },
          observability,
        })
        yield* usage.recordAdmittedUse({
          workspaceID: "ws-1",
          userID: "user-1",
          ctxPackIDs: [created.id],
          sessionInputID: "input-1",
          admittedAt: 1787300100000,
        })

        // The sentinels DO live in the durable pack rows (fixture sanity).
        const packRow = yield* db.get<{ title: string }>(sql`SELECT title FROM ctx_pack WHERE id = ${created.id}`)
        expect(packRow!.title).toContain(SENTINEL_TITLE)
        const keywordRows = yield* db.all<{ keyword_display: string }>(
          sql`SELECT keyword_display FROM ctx_pack_keyword WHERE ctx_pack_id = ${created.id}`,
        )
        expect(keywordRows.some((row) => row.keyword_display.includes(SENTINEL_KEYWORD))).toBe(true)
        const fragmentRow = yield* db.get<{ text_content: string }>(
          sql`SELECT text_content FROM ctx_pack_fragment WHERE ctx_pack_id = ${created.id}`,
        )
        expect(fragmentRow!.text_content).toContain(SENTINEL_FRAGMENT)

        // Recorders see NO sentinel anywhere.
        const serialized = JSON.stringify({ metricEvents, auditEntries })
        for (const sentinel of SENTINELS) expect(serialized).not.toContain(sentinel)

        // Recorders only see the allowed field set — assert key sets, not just absence.
        for (const entry of auditEntries) {
          for (const key of Object.keys(entry)) expect(ALLOWED_AUDIT_KEYS).toContain(key)
        }
        for (const event of metricEvents) {
          const frozenNames: string[] = Object.values(METRICS).map((metric) => metric.name)
          expect(frozenNames).toContain(event.name)
          const allowedLabels = Object.values(METRICS).find((metric) => metric.name === event.name)!
            .labels as readonly string[]
          for (const key of Object.keys(event.attributes)) expect(allowedLabels).toContain(key)
        }

        // The admitted-use audit entry is present and carries no content fields.
        const admitted = auditEntries.find((entry) => entry.operation === "admitted-use")
        expect(admitted).toBeDefined()
        expect(admitted!.result).toBe("ok")
        expect(admitted!.sensitivity).toBeUndefined()
        expect(admitted!.byteLength).toBeUndefined()
        expect(admitted!.estimatedTokens).toBeUndefined()
        expect(admitted!.fragmentCount).toBeUndefined()
        // And the admission metric fired.
        expect(metricEvents).toContainEqual({ name: "ctxpack_attachment_admission_total", attributes: { status: "counted" } })
      }),
    )
  })

  test("metric names and allowed label sets match the frozen list", () => {
    expect(METRICS).toEqual({
      operationsTotal: { name: "ctxpack_operations_total", labels: ["operation", "status"] },
      operationDurationMs: { name: "ctxpack_operation_duration_ms", labels: ["operation"] },
      searchDurationMs: { name: "ctxpack_search_duration_ms", labels: ["has_query", "sort"] },
      materializedTotal: { name: "ctxpack_materialized_total", labels: ["status", "sensitivity"] },
      attachmentAdmissionTotal: { name: "ctxpack_attachment_admission_total", labels: ["status"] },
      selectedBytes: { name: "ctxpack_selected_bytes", labels: [] },
      estimatedTokens: { name: "ctxpack_estimated_tokens", labels: [] },
      eventPublishFailuresTotal: { name: "ctxpack_event_publish_failures_total", labels: [] },
    })
  })

  test("denied materialize audit record carries result/errorCode only", () => {
    const { metricEvents, auditEntries, observability } = recordingObservability()
    recordDeniedMaterialize(observability, {
      correlationId: "corr-denied",
      workspaceID: "ws-1",
      ctxPackID: "ctxpk_1",
      userID: "user-1",
      errorCode: "CtxPackSecretSourceDenied",
      durationMs: 4,
    })

    expect(auditEntries).toHaveLength(1)
    expect(Object.keys(auditEntries[0]!).sort()).toEqual([
      "correlationId",
      "ctxPackID",
      "errorCode",
      "operation",
      "result",
      "userID",
      "workspaceID",
    ])
    expect(auditEntries[0]!.operation).toBe("denied-materialize")
    expect(auditEntries[0]!.result).toBe("denied")
    expect(auditEntries[0]!.errorCode).toBe("CtxPackSecretSourceDenied")
    // No content statistics on a denied materialize.
    expect(auditEntries[0]!.sensitivity).toBeUndefined()
    expect(auditEntries[0]!.byteLength).toBeUndefined()
    expect(auditEntries[0]!.estimatedTokens).toBeUndefined()
    expect(auditEntries[0]!.fragmentCount).toBeUndefined()

    expect(metricEvents).toContainEqual({
      name: "ctxpack_operations_total",
      attributes: { operation: "materialize", status: "denied" },
    })
  })

  test("noop default recorder is safe to call", () => {
    expect(() => {
      recordOperation(noop, {
        correlationId: null,
        workspaceID: "ws-1",
        ctxPackID: "ctxpk_1",
        userID: "user-1",
        operation: "create",
        status: "ok",
        durationMs: 1,
      })
      recordSearch(noop, { hasQuery: true, sort: "most-attached", durationMs: 2 })
      recordMaterialized(noop, { status: "ok", sensitivity: "private" })
      recordAdmission(noop, { status: "duplicate" })
      recordSelected(noop, { bytes: 10, estimatedTokens: 3 })
      recordEventPublishFailure(noop)
      recordDeniedMaterialize(noop, {
        correlationId: null,
        workspaceID: "ws-1",
        ctxPackID: "ctxpk_1",
        userID: "user-1",
        errorCode: "CtxPackPermissionDenied",
      })
    }).not.toThrow()
  })
})
