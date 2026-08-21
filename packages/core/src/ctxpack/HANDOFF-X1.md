# X1 — Capability enforcement + Context Capsule materialization + admission snapshot

Base commit: `2d913472a237523696e7f9105a4c08a90b50a843` (feature/CyberMaster)

## Files changed

- CREATE `packages/core/src/ctxpack/materialize.ts` — `CtxPackMaterializer`
  (`@opencode/v2/CtxPackMaterializer`): `materialize` (pack → immutable
  `ctxpack-attachment` capsule via `ContextCapsuleStore`) and
  `snapshotForSessionInput` (capsule-backed, deep-frozen `SessionContextSnapshot`,
  no session/usage/event writes), plus `make(...)` factory, `layer`, `node`,
  frozen request/result/actor/attachment/snapshot types, local `MaterializeError`
  union, `MAX_SNAPSHOT_ATTACHMENTS` (8), and an optional diagnostics service
  (`@opencode/v2/CtxPackMaterializeDiagnostics` — bytes/counts only, default no-op,
  read via `Context.getOption` so the frozen `node` deps stay exactly the three
  briefed nodes).
- CREATE `packages/core/src/ctxpack/access.ts` — `requirePackOperation` /
  `requireWorkspaceOperation` (frozen signatures): thin wrappers over X0's
  `CapabilityService.require` with frozen subjects, mapping denials to the S1
  `CtxPackPermissionDenied` error. Effects require the capability tag (hosts
  provide it).
- CREATE `packages/core/test/ctxpack-capability.test.ts` — 7 tests (X0 real
  services + fake membership/rights, real S1 repo rows).
- CREATE `packages/core/test/ctxpack-materialize.test.ts` — 20 tests (real repo +
  capsule store + capability service, fake membership/rights).
- CREATE `packages/core/src/ctxpack/HANDOFF-X1.md` — this file.

## Tests

- `cd packages/core && $BUN test --only-failures test/ctxpack-materialize.test.ts` → 20 pass / 0 fail
- `cd packages/core && $BUN test --only-failures test/ctxpack-capability.test.ts` → 7 pass / 0 fail
- Full run of both files plus the S1/X0 dependency suites (`ctxpack-sql`,
  `context-broker-capsule`, `capability-service`) → 54 pass / 0 fail.
- `tsgo --noEmit` on `packages/core`: zero errors in `materialize.ts`, `access.ts`,
  `ctxpack-materialize.test.ts`, `ctxpack-capability.test.ts`. (Remaining package
  errors are other lanes' in-flight files: `src/ctxpack/search.ts`,
  `src/ctxpack/service.ts`, `src/ctxpack/validation.ts`,
  `test/ctxpack-service.test.ts`, `test/ctxpack-search.test.ts`.)

## Public exports

From `@opencode-ai/core/ctxpack/materialize`:
- Types: `CtxPackMaterializeRequest`, `CtxPackMaterializeResult`, `CtxPackActor`,
  `SessionContextAttachmentInput`, `SessionContextSnapshot`, `MaterializeError`,
  `CtxPackMaterializer`, `MaterializeDiagnosticsEntry`, `MaterializeDiagnostics`.
- Values: `Service` (tag), `layer`, `node`, `make(input)`, `MAX_SNAPSHOT_ATTACHMENTS`,
  `DiagnosticsService` (optional, no-op default).
- `node = makeGlobalNode({ service: Service, layer, deps: [CtxPackRepository.node,
  CapabilityService.node, ContextCapsuleStore.node] })` — exactly the frozen
  dependency triple (imported under local aliases because each module exports its
  node as `node`).

From `@opencode-ai/core/ctxpack/access`:
- `requirePackOperation({ userID, workspaceID, operation, pack })` →
  `Effect<void, CtxPackError, CapabilityService>`; deny → `{ _tag:
  "CtxPackPermissionDenied", operation }`.
- `requireWorkspaceOperation({ userID, workspaceID, operation })` → same.

## Central integration actions (list, do NOT do)

- M1: compose `CtxPackMaterializer.node` into the core Layer group and into the
  P1 materialize handler; wire a real `WorkspaceMembership` (replace
  `workspaceMembershipLive`) and optionally a real `UserWorkspaceRights`
  provider.
- Q1: import `snapshotForSessionInput` and `SessionContextSnapshot` exactly from
  `@opencode-ai/core/ctxpack/materialize`; call it BEFORE durable admission.
- C1/P1: reuse `requirePackOperation` / `requireWorkspaceOperation` from
  `@opencode-ai/core/ctxpack/access` for read/patch/remove/restore handlers.
- Note for M1: the brief's "frozen request/result (schema side already exists —
  import)" — no schema-side `CtxPackMaterializeRequest/Result` export exists in
  `@opencode-ai/schema/ctxpack` (checked); they are declared here as frozen
  interfaces and only `CtxPack.ID` / `CtxPackError` are imported from schema.

## Assumptions

- Actor workspace is authoritative: `materialize` and `snapshotForSessionInput`
  scope repo/capsule lookups and every capability subject by `actor.workspaceID`.
  `request.workspaceID` is caller metadata only (a mismatch with the actor's
  workspace fails with `CtxPackNotFound`, before any capability check).
- Capability check order in `materialize` follows the brief: pack fetched first
  (for the frozen subject), then `ctxpack.materialize` on the CtxPack subject,
  then `chat.context.attach` on the FunctionalityInstance subject, then
  deleted/contentHash checks. In `snapshotForSessionInput`: `chat.context.attach`
  first (even for zero attachments), then per attachment: capsule get
  (missing/expired) → pack row (deleted → `CtxPackDeleted`) → `ctxpack.read` →
  contentHash check → fragment resolution.
- Snapshot budget: `byteLength` = `TextEncoder(JSON.stringify({version,
  attachments, createdAt})).length`; `estimatedTokens` = `Math.ceil(byteLength/4)`
  (same formula as S1's `estimateTokens` and X0's capsule `materialize`).
  Both compared against `input.budget`; the first exceeded limit fails with
  `CtxPackSnapshotOverBudget { current, maximum }`. Empty snapshots return
  `byteLength: 0, estimatedTokens: 0` exactly as frozen.
- Capsule-store errors outside the frozen union (`ContextCapsule.Conflict`,
  `ContextCapsule.Corrupt`) surface as defects (`Effect.orDie`), mirroring the S1
  repository's `toDomainError` policy (storage failures are defects).
- `expiresAt` is `undefined` in the built capsule (the brief's `null` is not
  assignable to `Functionality.Capsule`'s `number | undefined`; X0's store maps
  `undefined` ↔ `NULL` on write/read).
- Diagnostics entry shape is additive (not frozen): `{ operation, workspaceID,
  attachmentCount, byteLength, estimatedTokens }` — recorded for successful
  materialize and snapshot calls only (including the empty snapshot).
- Tests build `:memory:` DBs with `DatabaseMigration.applyOnly([ctxPackMigration,
  capsuleMigration])` (same as X0; `apply` would record migrations without
  creating tables until M1 regenerates `schema.gen.ts`).

## Known limitations

- v1 has NO registry-gated audience invalidation: `materialize` accepts any
  `targetFunctionalityID` when the capability provider allows
  (`chat.context.attach` is a pure capability check; unknown/removed
  functionality ids still pass — asserted by test "removed functionality ... still
  passes if the capability provider allows"). Hardening hook: X0's `denyRules`.
- List gating reuses the `ctxpack.read` operation on the `Workspace` subject
  (the frozen operations table has no `ctxpack.list` entry) — documented wiring
  choice for C1.
- The capability tests model "writer without attach right" via X0's `denyRules`
  (the rights provider is per (user, workspace), so attach-vs-read cannot diverge
  by operation for one user).
- Snapshot fragment texts are read from the CURRENT pack row (immutable by
  contract — no API mutates fragment text); if pack content could ever change,
  the capsule contentHash comparison would need to include pack rows.
- `snapshotForSessionInput` rejects the whole snapshot on the first failure; no
  partial snapshots are produced (asserted).
- No usage-counter change on materialize (recordUse is Q1/C2's post-admission
  concern; asserted via spy).

## Prohibited-pattern scan

- `rg -n "console\.(log|debug)" packages/core/src/ctxpack/materialize.ts packages/core/src/ctxpack/access.ts` → no matches.
- Fragment text appears only in the stored capsule reference `summary`
  (materialize) and in the returned snapshot (snapshot, by design); errors carry
  ids/hashes/operation names only — sentinel test (`CTXPACK_SECRET_SENTINEL_7812`)
  asserts result objects, error objects, and diagnostics never contain fragment
  text.
- No new npm dependencies, no git writes, no generate, no repo-root tests.
