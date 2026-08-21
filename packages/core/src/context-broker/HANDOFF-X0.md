# X0 — Capability service and context capsule store

Base commit: `2d913472a237523696e7f9105a4c08a90b50a843`

## Files changed

Created:
- `packages/core/src/capability/subjects.ts` — frozen `Right` / `CapabilitySubject` model.
- `packages/core/src/capability/operations.ts` — frozen `CtxPackOperations` + `requiredRights` table.
- `packages/core/src/capability/service.ts` — `CapabilityService` (`@opencode/v2/Capability`), deny-first policy (membership → unknown-op → private-pack → rights → explicit deny list), `CtxPackPermissionDeniedError` (`_tag: "CtxPackPermissionDenied"`), `denyRules` hook, workspace-membership port.
- `packages/core/src/context-broker/capsule.ts` — `ContextCapsuleStore` (`@opencode/v2/ContextCapsuleStore`): store/get/materialize, Drizzle `context_capsule` table, typed `ContextCapsule.Corrupt` / `ContextCapsule.Conflict` errors, out-of-schema `createdBy`/`budget` JSON columns.
- `packages/core/src/database/migration/20260821_capsule.ts` — raw SQL migration (id `20260821_capsule`), identical to the Drizzle definition (including `created_at DESC` index via drizzle `desc()`).
- `packages/core/test/capability-service.test.ts` — 8 tests.
- `packages/core/test/context-broker-capsule.test.ts` — 9 tests (fresh `:memory:` DB + `DatabaseMigration.applyOnly([capsuleMigration])`).
- `packages/core/src/context-broker/HANDOFF-X0.md` — this file.

Edited (exactly one line):
- `packages/core/src/database/migration.gen.ts` — appended `import("./migration/20260821_capsule"),` after the last existing import, matching its format.

## Tests

- `cd packages/core && bun test --only-failures test/capability-service.test.ts` → 8 pass, 0 fail (all 8 brief scenarios).
- `cd packages/core && bun test --only-failures test/context-broker-capsule.test.ts` → 9 pass, 0 fail (all 9 brief scenarios incl. sentinel redaction).
- `bun test test/database-migration.test.ts` → 17 pass, 0 fail (migration journal edit is safe).
- `tsgo --noEmit` on `packages/core` → 0 errors (whole package, not just this lane).

## Public exports

From `capability/service.ts`: `WorkspaceMembership` (interface), `WorkspaceMembershipService` (tag), `workspaceMembershipPort` (unbound `LayerNode` — replacement source for hosts/tests), `workspaceMembershipLive` (deny-by-default stand-in node), `UserWorkspaceRights` (interface), `UserWorkspaceRightsService` (tag), `DefaultUserWorkspaceRights`, `denyRules` (mutable, frozen shape `{ operation, subjectType }[]`, empty in v1), `CapabilityCheckInput`, `CapabilityResult`, `CtxPackPermissionDeniedError` / `CtxPackPermissionDeniedLike`, `Interface`, `Service`, `layer`, `node`.

From `context-broker/capsule.ts`: `ContextBudget`, `DefaultInteractiveContextBudget`, `StoredCapsule`, `ContextCapsuleTable` (Drizzle), `CapsuleCorruptError` (`ContextCapsule.Corrupt`), `CapsuleConflictError` (`ContextCapsule.Conflict`), `ContextCapsuleStore` (interface — exactly the frozen shape X1/Q1 consume), `Service`, `layer`, `node`.

Policy reasons (frozen): `not-workspace-member`, `unknown-operation`, `private-pack-not-owned`, `insufficient-rights:<right>`, plus `explicit-deny` (rule 5 — my choice, not pre-frozen).

## Central integration actions (M1 — do NOT do here)

1. Wire a real `WorkspaceMembership` implementation. Replace `workspaceMembershipLive` via AppNodeBuilder replacements (`[[workspaceMembershipPort, <realLayer>]]` or `[[workspaceMembershipLive, <realLayer>]]`, both match by node name `@opencode/v2/WorkspaceMembership`) or swap the layer inside `workspaceMembershipLive`.
2. Swap the real role provider for `UserWorkspaceRightsService` (currently optional; absent ⇒ v1 default `["read","write","execute"]`).
3. Add `Capability.node` and `ContextCapsule.node` to the core `LayerNode.group` composition.
4. Regenerate `schema.gen.ts` (`bun run generate` in packages/core). The `context_capsule` Drizzle table is declared but NOT in schema.gen (I am forbidden from regenerating). Until then, fresh-DB `DatabaseMigration.apply` records migration `20260821_capsule` without creating the table (schema.up path) — the raw-SQL migration path (`applyOnly`/existing installs) is correct. After regeneration the linux-only "no ungenerated migrations" gate passes.
5. Align `CtxPackPermissionDeniedError` import with the S1 schema union if needed (structurally identical today).

## Assumptions

- Membership is the outer gate: every subject carries `workspaceID`; non-members are denied before anything else.
- `UserWorkspaceRights` is evaluated at layer build time via `Context.getOption` with the v1 all-rights default (pure provider; M1 swaps it).
- `denyRules` is a module-level mutable array (frozen shape only); rule 5 runs after rights.
- `materialize` filters `references` and `artifactRefs` by `ref.id` when present (entries without `ref.id` always kept); `facts` are never filtered; token estimate = `Math.ceil(byteLength / 4)`; only byte/token limits are enforced by the store (count limits are the caller's/X1's concern).
- Capsule ids: `ctxkpsl_` + ascending identifier (repo `id.create("ctxkpsl", "ascending")`); conflict on re-store (immutable).
- `get`/`materialize` read via raw SQL so corrupt JSON deterministically surfaces `ContextCapsule.Corrupt` instead of a driver parse throw.
- Store errors carry ids/workspaces only; nothing logs content.

## Known limitations

- `node` for the capability service uses `deps: [workspaceMembershipLive]` instead of the briefed `deps: []` — `LayerNode` typechecks deps against the layer's requirements (it requires `WorkspaceMembershipService`), so `[]` does not compile. The port/live pattern is the repo's established idiom for host-provided services (`chat-relay-session.ts`). The live stand-in denies by default until M1 wires the real source.
- `context_capsule` is absent from `schema.gen.ts` until M1 regenerates (see integration action 4).
- Capsule test DB setup uses `DatabaseMigration.applyOnly(db, [capsuleMigration])` rather than `apply` for the same reason (fresh-DB `apply` would mark the migration complete without running it while schema.gen lacks the table).
- `chat.context.attach` on `builtin:chat` instances is allowed whenever rule 4 passes (v1 semantics — no functionality-specific deny entries; `denyRules` exists for future hardening).

## Prohibited-pattern scan

- `rg "console\.(log|debug)|summary|references" packages/core/src/capability packages/core/src/context-broker` → no logging; hits are comments and data-flow lines only. No secret material in subjects, results, errors; errors carry IDs/hashes/counts/sizes only.
- No new npm dependencies (policy implemented explicitly, no @casl). No git writes, no generate, no root tests.
