# Q1 — Session admission context snapshot + provider-turn context

Base commit: `2d913472a` (feature/CyberMaster). Working tree at completion
also contains other lanes' uncommitted changes (X0/X1/C2/S1 + app lanes); this
handoff lists ONLY Q1's changes.

## Files changed

- MODIFY `packages/schema/src/session-input.ts` — added the frozen wire
  schemas: `SessionContextAttachmentInput`, `ContextAttachments` (max 8 via
  `Schema.isMaxLength` + duplicate-`contextCapsuleID` filter — the brief's
  `Schema.maxItems(8)` does not exist in effect 4.0.0-beta.83; `isMaxLength`
  is the documented array-length equivalent), and the local
  `SessionContextSnapshot` payload schema (fragment `source: Schema.Unknown`
  per the freeze — the schema layer stays decoupled from the CtxPack schema).
- MODIFY `packages/protocol/src/groups/session.ts` — `contextAttachments`
  (optional, validated) on the `session.prompt` payload; new
  `SessionContextAttachmentError` (httpApiStatus 400, fields `message` +
  `code`), added to the endpoint's error union.
- MODIFY `packages/server/src/handlers/session.ts` — pass-through: forwards
  `userID` (from `requestUser`) + `contextAttachments` to `session.prompt`;
  maps `SessionInput.ContextAttachmentError` → `SessionContextAttachmentError`
  (400). No materialization in the handler.
- MODIFY `packages/core/src/session/input.ts` — snapshot-aware admission:
  - Ports (injected, context-optional via `Context.getOption` so no static
    requirement leaks into layers): `SessionCtxSnapshotPort`
    (`@opencode/v2/SessionCtxSnapshotPort`, structurally identical to X1's
    `CtxPackMaterializer["snapshotForSessionInput"]`, error union
    `SessionSnapshotError = CtxPackError | MaterializeError`) and
    `CtxPackUsagePort` (`@opencode/v2/CtxPackUsagePort`, best-effort
    `recordAdmittedUse`, error channel `unknown`).
  - `admit` gains optional `contextAttachments` + `actor { userID,
    workspaceID? }`. When attachments are present: validates actor
    (`missing-actor` / `missing-workspace`), port presence
    (`snapshot-port-unavailable`), calls
    `snapshotForSessionInput({ actor, targetInstanceID: "chat-instance:" +
    sessionID, targetFunctionalityID: "builtin:chat", attachments, budget:
    DefaultInteractiveContextBudget })` BEFORE the durable admission event,
    validates the result against the local schema copy
    (`invalid-snapshot`), then AFTER publish persists
    `context_snapshot_json` on the input row in the same scope (the projector
    inserts the row during publish; the snapshot UPDATE is the "insert
    immediately after" path the brief sanctions), then records usage once per
    distinct `sourceCtxPackID` (failures are caught and logged with counts
    only).
  - New errors: `SessionInput.ContextAttachmentError` (`code` only — never
    fragment text) and `SessionInput.CorruptContextSnapshot` (typed
    durable-data error on read; never silently ignored, never rematerialized).
  - `promoteSteers` now returns the promoted rows (`ReadonlyArray<Row>`),
    `promoteNextQueued` returns `Row | undefined` (previously count/boolean;
    only in-repo callers are `runner/llm.ts`, updated; existing tests discard
    the value). New `contextSnapshotsOf(db, rows)` decodes durable snapshots
    in admitted order.
- MODIFY `packages/core/src/session/sql.ts` — `context_snapshot_json:
  text({ mode: "json" })` nullable column on `session_input`.
- MODIFY `packages/core/src/session/runner/llm.ts` — promotion block captures
  the promoted rows; the snapshots of the inputs promoted for THIS turn are
  rendered (`renderSessionContextSnapshot`) as distinct system parts after
  agent system + baseline; corrupt snapshot decode is caught and re-raised as
  a defect (typed, never silent; `SessionInput.CorruptContextSnapshot` is not
  in `RunError` and `runner/index.ts` is not editable). Pending (never
  promoted) inputs never render. Count semantics (`promoted > 0` → step 1)
  unchanged.
- CREATE `packages/core/src/session/runner/ctxpack-context.ts` —
  `renderSessionContextSnapshot` (frozen template; source provenance lines;
  fragment numbering restarts per attachment).
- CREATE `packages/core/src/database/migration/20260821_session_ctx_snapshot.ts`
  — `ALTER TABLE session_input ADD COLUMN context_snapshot_json TEXT`.
- MODIFY `packages/core/src/database/migration.gen.ts` — exactly one import
  line added.
- MODIFY `packages/core/src/database/schema.gen.ts` — ONE generated-table
  line added (`context_snapshot_json text` in `session_input`). This is a
  deliberate deviation: core tests run against in-memory DBs created from
  `schema.gen.ts` (raw migrations are journaled, not run, on fresh DBs), so
  without this line EVERY existing `session-*.test.ts` breaks with "no such
  column". The edit mirrors exactly what drizzle-kit regeneration would emit;
  M1 should still regenerate.
- MODIFY `packages/core/src/session.ts` — minimal required threading (see
  Assumptions): `prompt` input gains optional `userID` + `contextAttachments`,
  error union gains `SessionInput.ContextAttachmentError`, implementation
  passes `actor: { userID, workspaceID: session.location.workspaceID }` to
  `SessionInput.admit`.
- CREATE `packages/core/test/session-ctxpack-admission.test.ts` — 8 tests.
- CREATE `packages/core/test/session-ctxpack-promotion.test.ts` — 6 tests.
- CREATE `packages/core/src/session/HANDOFF-Q1.md` — this file.

## Tests

- `cd packages/core && $BUN test --only-failures test/session-ctxpack-admission.test.ts`
  → 8 pass / 0 fail.
- `cd packages/core && $BUN test --only-failures test/session-ctxpack-promotion.test.ts`
  → 6 pass / 0 fail.
- `cd packages/core && $BUN test --only-failures test/session-*.test.ts`
  → 227 pass / 0 fail across 17 files (existing queue/steer/promotion/
  dedupe/optimistic-reconciliation/cancellation suites all green).
- `cd packages/schema && $BUN test` → 45 pass / 2 fail. The 2 failures
  (`contract-hygiene`, `v1-isolation`) are PRE-EXISTING on this Windows host:
  `Bun.Glob.scanSync(new URL("../src", import.meta.url).pathname)` receives a
  NUL-terminated Windows path (`...src\u0000`) and ENOENTs before reading any
  file; unrelated to Q1 (reproduced independently of any Q1 file).
- `tsgo --noEmit`: packages/schema, packages/protocol, packages/server,
  packages/core all exit 0.

## Public exports

From `@opencode-ai/schema/session-input`: `SessionContextAttachmentInput`,
`ContextAttachments`, `SessionContextSnapshot` (schemas + types).
From `@opencode-ai/core/session/input`: `SessionCtxSnapshotPort` (interface +
`SessionCtxSnapshotPortService` tag), `CtxPackUsagePort` (interface +
`CtxPackUsagePortService` tag), `SessionSnapshotError` type,
`ContextAttachmentError`, `CorruptContextSnapshot`, `SessionInputRow` type,
`contextSnapshotsOf`.
From `@opencode-ai/core/session/runner/ctxpack-context`:
`renderSessionContextSnapshot`.
From `@opencode-ai/protocol/groups/session`: `SessionContextAttachmentError`.

## Central integration actions (list, do NOT do)

- M1: wire the real X1 `CtxPackMaterializer` into `SessionCtxSnapshotPort`
  (`Layer.succeed(SessionCtxSnapshotPortService, materializer)` — the method
  signature is structurally identical, including the `SessionSnapshotError`
  union) at the server/core composition root.
- M1: wire the real C2 usage recorder into `CtxPackUsagePort`.
- M1: align the schema-layer `SessionContextSnapshot` type with X1's runtime
  type if desired (currently `source: Schema.Unknown` per the freeze; the
  renderer casts to the provenance shape).
- M1: hand-mirror the SDK for the new `contextAttachments` field.
- M1: regenerate `schema.gen.ts` (Q1 hand-added one column line so in-memory
  test DBs carry `context_snapshot_json`).

## Assumptions

- `core/src/session.ts` is NOT in the brief's owned-files list, but the frozen
  flow (handler → admission path) cannot reach `SessionInput.admit` without
  threading `userID` + `contextAttachments` through `SessionV2.prompt`. Q1
  made the minimal surgical edit (input type + one pass-through) and flags it
  here for M1 reconciliation (another lane also edits this file — SessionCreate
  extraction).
- `targetInstanceID` freeze: no SessionSchema-derived instance-id helper
  exists; used `"chat-instance:" + sessionID` (documented in input.ts).
- Actor workspace = the session's `location.workspaceID` (may be undefined →
  `missing-workspace` admission failure when attachments are present).
- Snapshot persistence follows the brief's sanctioned second path: the
  projector inserts the row during the durable publish; the snapshot is
  updated onto the row immediately after, in the same admission scope, before
  any ack returns. A crash between publish and update leaves a snapshot-less
  row (documented limitation of the event pipeline; no event-schema change
  was allowed).
- Ports are read via `Context.getOption` so `admit`/`SessionV2` carry no new
  static layer requirements (existing tests and layers compile unchanged);
  attachments without a wired port fail admission with
  `snapshot-port-unavailable` rather than silently dropping attachments.
- Usage recording is best-effort: `Effect.catch` (beta.83 name; `catchAll`
  does not exist) logs a counts-only line; absent port = silent skip.
- `promoteSteers`/`promoteNextQueued` return values changed (rows instead of
  count/boolean) — no external consumers exist; behavior (count semantics,
  cutoff, idempotency) is unchanged.
- The runner dies (typed defect) on corrupt stored snapshots: `RunError` is
  not editable and the brief forbids silent ignoring/rematerialization.

## Known limitations

- Event replay (projector re-run) after deleting the input row cannot restore
  the snapshot column (it lives on the row, not the event); normal replay
  with an existing row keeps the snapshot (`onConflictDoNothing`).
- Fresh-DB production installs get the column only via the raw migration;
  `schema.gen.ts` regeneration (M1) keeps in-memory test DBs in sync.
- Schema-package tests: 2 pre-existing Windows `Bun.Glob` path failures (see
  Tests) — not Q1 regressions.
- The protocol error's `code` values are the materializer/S1 `_tag` strings
  plus `missing-actor` / `missing-workspace` / `snapshot-port-unavailable` /
  `invalid-snapshot`.

## Prohibited-pattern scan

- Fragment text appears only in the stored `context_snapshot_json` column and
  in the rendered provider context (`renderSessionContextSnapshot`) — never
  in events, errors, logs, or the admitted protocol result (sentinel test
  asserts errors + captured logs + `JSON.stringify(admitted)`).
- No new npm dependencies, no git writes, no generates (one generated-file
  column hand-mirrored, flagged above), no repo-root tests.
- No edits to CtxPack repository internals, app components, workspace
  registry, or SDK.
