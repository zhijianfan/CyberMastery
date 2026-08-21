# C2 — EventV2 Publisher, Usage Accounting, Audit, Metrics

Base commit: `2d913472a237523696e7f9105a4c08a90b50a843` (feature/CyberMaster)

## Files changed

- CREATE `packages/core/src/ctxpack/events.ts` — `CtxPackChanged` re-export (S1's
  `@opencode-ai/schema/ctxpack` definition), `CtxPackChangedEvent` wire type
  (`type` + `properties.{workspaceID, ctxPackID, revision, change}`),
  `CtxPackEventPublisher` port, `make(events)` (decode-validate →
  `InvalidCtxPackChangedEventError` → `Effect.orDie` → `events.publish`),
  `CtxPackEventPublisherService` Context.Service + `layer` + `node`
  (deps: `[EventV2.node]`). EventV2 is the ONLY transport; the event is a
  transient hint (live subscribers only).
- CREATE `packages/core/src/ctxpack/usage.ts` — `CtxPackUsagePort` with
  `recordAdmittedUse`, `make(deps)` (db + repository + publisher +
  observability), `Service` Context.Service (`@opencode/v2/CtxPackUsage`) +
  `layer` + `node` (deps: `[Database.node, repositoryNode (sql.ts),
  CtxPackEvents.node, observabilityNode]`). Durable ledger via
  `INSERT ... ON CONFLICT DO NOTHING RETURNING` (newly-inserted detection is
  atomic, no select-then-insert race); one transaction per call; `recordUse`
  only for newly counted packs (joins the tx connection); after commit: one
  `{ change: "used" }` event per newly counted pack + admission metric +
  `admitted-use` audit entry. Publish failures (typed OR defects, via
  `Effect.catchCause`, interruption preserved) never roll back the ledger —
  counted by `ctxpack_event_publish_failures_total`. Distinct-dedupes the
  input id list. Storage/domain failures surface as defects (`Effect.orDie`).
- CREATE `packages/core/src/ctxpack/observability.ts` — frozen `METRICS`
  manifest (names + label keys), `CtxPackMetricsRecorder`,
  `CtxPackAuditRecorder`, `CtxPackAuditEntry` (allowed field set only; content
  fields omitted when unknown), `CtxPackObservability` interface + `noop`
  default, `CtxPackObservabilityService` + `layer` + `node` (deps: `[]`), and
  record helpers (`recordOperation`, `recordDeniedMaterialize`, `recordSearch`,
  `recordMaterialized`, `recordAdmission`, `recordSelected`,
  `recordEventPublishFailure`) — safe by construction: they accept only
  identity/statistics fields, never title/keyword/fragment/source/capsule
  content. NOTE: no self-namespace `export * as` here — it would collide with
  the `CtxPackObservability` interface.
- CREATE `packages/core/src/database/migration/20260821_ctxpack_usage.ts` —
  `ctx_pack_usage_admission (ctx_pack_id, session_input_id, time_recorded,
  PRIMARY KEY(ctx_pack_id, session_input_id))`.
- EDIT `packages/core/src/database/migration.gen.ts` — exactly one import line
  appended: `import("./migration/20260821_ctxpack_usage"),` after
  `20260821_ctxpack`.
- CREATE `packages/core/test/ctxpack-events.test.ts` — 3 tests.
- CREATE `packages/core/test/ctxpack-usage.test.ts` — 4 tests (real in-memory
  DB + fake/throwing event publishers).
- CREATE `packages/core/test/ctxpack-observability.test.ts` — 4 tests
  (sentinel redaction via real usage flow + record helpers, frozen metric
  contract, denied-materialize audit shape, noop safety).
- CREATE `packages/core/src/ctxpack/HANDOFF-C2.md` — this file.

## Tests

- `cd packages/core && $BUN test --only-failures test/ctxpack-events.test.ts` → 3 pass / 0 fail
- `cd packages/core && $BUN test --only-failures test/ctxpack-usage.test.ts` → 4 pass / 0 fail
- `cd packages/core && $BUN test --only-failures test/ctxpack-observability.test.ts` → 4 pass / 0 fail
- Scoped `tsgo --noEmit` over all new files + `migration.gen.ts` (scratch
  tsconfig, since deleted) → clean.

## Public exports

- `@opencode-ai/core/ctxpack/events`: `CtxPackChanged` (re-export),
  `CtxPackChangedEvent`, `InvalidCtxPackChangedEventError`,
  `CtxPackEventPublisher`, `CtxPackEventPublisherService`, `make`, `layer`,
  `node`, self-namespace `CtxPackEvents`.
- `@opencode-ai/core/ctxpack/usage`: `CtxPackUsagePort`, `CtxPackUsageDeps`,
  `make`, `Service`, `layer`, `node`, self-namespace `CtxPackUsage`.
- `@opencode-ai/core/ctxpack/observability`: `METRICS`, `CtxPackAuditOperation`,
  `CtxPackAuditResult`, `CtxPackAuditEntry`, `CtxPackMetricsRecorder`,
  `CtxPackAuditRecorder`, `CtxPackObservability`, `noop`,
  `CtxPackObservabilityService`, `layer`, `node`, record helpers.
- `@opencode-ai/core/database/migration/20260821_ctxpack_usage` default export.

## Central integration actions (list, do NOT do)

- M1: provide `CtxPackEventPublisher` (via `CtxPackEventPublisherService.node`
  or `make`) to C1's event port; have C1's service layer publish
  created/metadata-updated/deleted/restored events through it.
- M1: provide the real usage port (`CtxPackUsage.Service` / `make`) to Q1
  (query/materialize lane) so admitted context calls `recordAdmittedUse`.
- M1: register `CtxPackChanged` (`workspace.ctxpack.changed`) in the central
  event inventory (`@opencode-ai/schema/...` Definitions), alongside the other
  Wave 1/2/3 event definitions. Publishing a transient hint works before
  registration (EventV2 publish does not require inventory membership), but
  inventory registration is required for full discoverability.
- M1/coordinator: regenerate the database layer so `schema.gen.ts` /
  `packages/core/schema.json` include `ctx_pack_usage_admission` (drizzle
  migration will duplicate the handwritten one — same conflict as S1's
  `20260821_ctxpack`; suggested resolution in S1's handoff applies).

## Assumptions

- `Effect.catch` catches only typed (recoverable) errors in effect 4.0.0-beta.83;
  `Effect.catchCause` + `Cause.hasInterrupts` is used for publish-failure
  swallowing so a defect-throwing publisher still cannot roll back the ledger.
- `INSERT ... ON CONFLICT DO NOTHING RETURNING ctx_pack_id` is used to detect
  "newly inserted" atomically (the driver exposes no `changes` count through
  drizzle raw `run`). SQLite RETURNING is supported by bun:sqlite.
- `repository.recordUse` executed inside `db.transaction(...)` joins the
  transaction connection (effect SQL routes client queries to the tx
  connection via `transactionService`), so a recordUse failure rolls back the
  admission rows too.
- The `used` event's `revision` is read inside the transaction (pack row stable
  there); `recordUse` itself does not bump revision (per S1).
- Metric `operation` label values: `create|patch|remove|restore|materialize|
  denied-materialize|admitted-use` (audit operation names); denied
  materialization emits `ctxpack_operations_total{operation="materialize",
  status="denied"}` while its audit operation is `"denied-materialize"`.
  `ctxpack_attachment_admission_total{status}` values: `counted|duplicate`.
- The usage node's deps extend the brief's `[Database.node,
  CtxPackEventPublisherService.node]` with the repository node (needed for
  `recordUse`) and the observability node (admission metric + audit +
  publish-failure counter); the brief's snippet showed no `layer`, so the dep
  list is the implementing detail.
- Node references use module-level `node` exports (`CtxPackEvents.node`,
  `repositoryNode`, `observabilityNode`) — `X.node` only exists on namespace
  re-exports (`Database.node`, `EventV2.node`); service classes carry no static
  `node` in this repo.

## Known limitations

- `recordAdmittedUse` dies (defect) if a pack is missing/deleted at admission
  time — the ledger insert rolls back with it (invariant: ledger rows always
  reference live packs).
- No retention policy on `ctx_pack_usage_admission` (append-only); a pruning
  migration is a future concern if the table grows large.
- The observability recorders are minimal in-process interfaces with a no-op
  default; wiring to Effect Metrics/OTLP export is left to a future layer.
- `ctxpack_search_duration_ms{has_query,sort}` exists in the frozen metric
  list; recording it is the search lane's call via `recordSearch` (the helper
  is exported and tested).
- `correlationId` is `null` for `admitted-use` audit entries (the usage port
  carries no correlation id); extend the port if correlation is required.

## Prohibited-pattern scan

`rg -n "ctxPack|ctx_pack|text_content" packages/core/src/workspace
packages/app/src/pages/canvas` — matches only in sibling lanes'
`packages/app/src/pages/canvas/blocks/ctxpack-browser/`; none originate from
this diff. No edits outside the owned file list + the single
`migration.gen.ts` import line.
