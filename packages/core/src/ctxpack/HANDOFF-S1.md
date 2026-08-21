# S1 — CtxPack schema and durable storage

Base commit: `2d913472a237523696e7f9105a4c08a90b50a843` (feature/CyberMaster)

## Files changed

- CREATE `packages/schema/src/ctxpack.ts` — CtxPack namespace (frozen public types), `CtxPackChanged` event, normalization/hash/token helpers, top-level request/result/error types.
- CREATE `packages/schema/test/ctxpack.test.ts` — 19 tests.
- CREATE `packages/core/src/ctxpack/sql.ts` — Drizzle tables (`CtxPackTable`, `CtxPackFragmentTable`, `CtxPackKeywordTable`), FTS5 maintenance, `make(db)` repository, `CtxPackRepositoryService` Context.Service + `layer` + `node`.
- CREATE `packages/core/src/database/migration/20260821_ctxpack.ts` — migration `{ id: "20260821_ctxpack", up }` with raw SQL for all four objects (ctx_pack, ctx_pack_fragment, ctx_pack_keyword, ctx_pack_fts FTS5 virtual table).
- EDIT `packages/core/src/database/migration.gen.ts` — appended exactly one import line: `import("./migration/20260821_ctxpack"),` after the last existing import (which is sibling S2's `20260821_capsule`).
- CREATE `packages/core/test/ctxpack-sql.test.ts` — 10 tests.

## Tests

- `cd packages/schema && $BUN test --only-failures test/ctxpack.test.ts` → 19 pass / 0 fail
- `cd packages/core && $BUN test --only-failures test/ctxpack-sql.test.ts` → 10 pass / 0 fail
- Scoped `tsgo --noEmit` on the new files in both packages → clean (scratch tsconfigs used and deleted).
- Prohibited-pattern scan `rg -n "ctxPack|ctx_pack|text_content" packages/core/src/workspace packages/app/src/pages/canvas` — matches exist only in other lanes' files (`packages/app/src/pages/canvas/blocks/ctxpack-browser/`), none from this diff.

## Public exports

- `@opencode-ai/schema/ctxpack` (also self-exported as namespace `CtxPack`):
  - Schemas + types: `ID`, `FragmentID`, `SourceKind`, `Direction`, `Sensitivity`, `Source`, `FragmentInput`, `Fragment`, `Usage`, `Info`, `Summary`, `CtxPackChanged` (event), `Sort`, `CreateRequest`, `PatchRequest`, `ListRequest`, `ListResult`, `MetadataValue`
  - Top-level types: `CtxPackSort`, `CtxPackCreateRequest`, `CtxPackPatchRequest`, `CtxPackListRequest`, `CtxPackListResult`, `CtxPackError`
  - Helpers: `normalizeSelectedText`, `normalizeKeyword`, `contentHash`, `estimateTokens`, `utf8ByteLength`
- `@opencode-ai/core/ctxpack/sql`: `CtxPackTable`, `CtxPackFragmentTable`, `CtxPackKeywordTable`, `interface CtxPackRepository` (+ `namespace CtxPackRepository` with `Create`/`Patch`), `make(db)`, `CtxPackRepositoryService`, `layer`, `node`.
- `@opencode-ai/core/database/migration/20260821_ctxpack` default export.

## Central integration actions (list, do NOT do)

- M1: add `export * as CtxPack from "./ctxpack"` to `packages/schema/src/index.ts`.
- M1: register `CtxPackChanged` (`workspace.ctxpack.changed`) in the event inventory.
- M1/coordinator: regenerate the database layer — `node script/migration.ts` from `packages/core` — so `schema.gen.ts`, `packages/core/schema.json` snapshot, and `migration.gen.ts` include the ctxpack tables. **Conflict to resolve there**: the drizzle-generated migration will also emit `CREATE TABLE ctx_pack*` (duplicating this handwritten migration) — decide which one ships (suggest: keep the handwritten one for the FTS virtual table, drop the drizzle-generated duplicate, or fold both into one migration).

## Assumptions

- Effect 4.0.0-beta.83 / drizzle-orm 1.0.0-rc.2 API shapes were verified against the installed packages (e.g. `Schema.makeFilter` + `.check`, `Schema.NullOr`, `Schema.Union([...])`, `Effect.catch`, no `Either` module).
- Frozen nullable fields (`sourceTimestamp`, `entityRef`, `label`, `lastAttachedAt`, `deletedAt`) are `Schema.NullOr(...)` so the exported types are exactly `T | null` per the frozen spec (the repo's `optional()` helper would have produced `T | undefined`).
- `softDelete`/`restore`/`recordUse` do NOT bump `revision` (the brief only mandates revision increments for `patchMetadata`); `softDelete` on an already-deleted pack fails with `CtxPackDeleted` (consistent with `patchMetadata`).
- `recently-attached` sorts never-attached packs (`last_attached_at IS NULL`) last; cursor predicates handle the null group.
- `clientFragmentID` is a create-time input and is NOT persisted (the frozen SQL schema has no column for it); read results echo the server-assigned fragment `id` as `clientFragmentID`. If consumers need the original client IDs echoed, the schema needs a `client_fragment_id` column (coordinate with M1/M3).
- Fresh databases bootstrap from `schema.gen.ts` (migrations are recorded as complete without running). My core test therefore applies the migration manually when `ctx_pack` is absent — robust before AND after schema regeneration.
- SQL storage errors are erased to defects (`Effect.die`) via `toDomainError`; only `CtxPackError` variants fail the effect (the frozen error union has no storage-error variant).
- `create` idempotency is select-then-insert within the transaction; a concurrent duplicate-key insert would surface as a defect (acceptable for a single-user local DB; the UNIQUE constraint backs it).

## Known limitations

- `list` binds the FTS `MATCH` query as a parameter (per brief, injection-safe) but does not sanitize FTS5 syntax — a malformed query (e.g. unbalanced `"`) would raise a SQL error/defect. A search lane should sanitize before calling.
- `title-asc` orders by SQLite byte-wise collation; differs from JS UTF-16 ordering for non-ASCII titles (irrelevant for ASCII).
- Fresh DBs created from the REGENERATED `schema.gen.ts` will still lack `ctx_pack_fts` (drizzle-kit cannot emit `CREATE VIRTUAL TABLE`). The FTS table only exists via this migration, which fresh DBs skip. Fixes: hand-add the FTS DDL to `schema.gen.ts`, or change `DatabaseMigration.apply` to run this migration on fresh DBs (M1 decision).
- `ctx_pack_fragment` has both a UNIQUE index and a duplicate non-unique index on `(ctx_pack_id, ordinal)` per the frozen spec (redundant but exact).
- `totalEstimate` is an exact `COUNT(*)` on every list call (fine per brief).

## Prohibited-pattern scan

`rg -n "ctxPack|ctx_pack|text_content" packages/core/src/workspace packages/app/src/pages/canvas || true` — no matches originate from this diff (hits are sibling lanes' `ctxpack-browser` files under `packages/app/src/pages/canvas`).
