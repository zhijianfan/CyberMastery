# M1 Integration Handoff — CtxPack (run `ctxpack`)

Master integration of the 13 worker lanes + M1-owned foundation work. All lanes
are CLOSED; every fix below is recorded here per the dispatch protocol
(behavioral fixes to closed lanes are made by M1 and listed).

## Composition state

- All 13 lanes landed and reviewed. Central files composed (schema index,
  event-manifest, protocol Api, server handlers/routes, opencode httpapi
  server, app canvas host, SDK). SDK regenerated with the REAL generators:
  - `packages/client`: `bun run generate` (generated client + types).
  - `packages/sdk/js`: `bun ./script/build.ts` (openapi.json + sdk.gen.ts +
    types.gen.ts via hey-api). The opencode CLI boot for `generate` also
    proves the full node graph builds at runtime.
- Typecheck (tsgo, now available at `node_modules/.bin/tsgo`): schema, core,
  protocol, server, app, sdk, session-ui all PASS.
- opencode package typecheck FAILS with `EffectDrizzleQueryError` in
  `createRoutes` (server.ts:320) — PRE-EXISTING (reproduced with all CtxPack
  server.ts edits stashed): it comes from the sibling in-flight work on
  `core/src/workspace/master-agent.ts` / `session/runner`. NOT touched.

## Gate totals (per-suite, final)

| Suite | Result |
|---|---|
| schema (all) | 45 pass, 2 fail (pre-existing Windows NUL-path Glob bugs in contract-hygiene/v1-isolation tests) |
| core ctxpack sql/search/service/usage/observability/materialize/capability + capsule | 0 fail each |
| core session-ctxpack-admission / promotion | 6+0 / 6+0 |
| core FULL suite (1291 tests) | 10 fail, ALL pre-existing: 7 Git/RepositoryCache (network env), 1 DatabaseMigration legacy-ownership (sibling migration work — reproduced with all ctxpack files stashed), 1 layout-authority (sibling canvas work), 0 CtxPack |
| protocol ctxpack-group | 16 pass |
| server ctxpack-handler | 12 pass |
| app ctxpack suites (7 files) + browser adapter + registrations + submit | 0 fail each (per-suite) |

Known infra limitation: running app suites in ONE bun invocation with
`submit.test.ts` (U5) fails 15 ctxpack tests — bun shares a process on Windows
and U5's `mock.module` calls leak. Run suites per-file; document rather than
touch U5's file.

## M1 fixes to closed lanes (recorded)

1. **DB layer (S1/C2/Q1 migrations):** regenerated `schema.gen.ts` (fresh-DB
   path now creates ctx_pack*, context_capsule, ctx_pack_usage_admission,
   session_input.context_snapshot_json). Deleted the two drizzle-generated
   drift migrations (duplicated handwritten ones incl. FTS). Hand-removed
   their `migration.gen.ts` registry lines — CAUTION: after deleting a drift
   migration the generator can't re-run cleanly ("Expected one full schema
   migration, found 0") until the registry import is removed.
2. **FTS on fresh DBs:** `ensureCtxPackFts` (lazy `CREATE VIRTUAL TABLE IF
   NOT EXISTS`) added to `ctxpack/sql.ts`; invoked by the repository layer.
   Test harnesses updated to call it when the handwritten migration is
   skipped (fresh path).
3. **Drizzle glob gap:** table defs must live in `sql.ts`-named files.
   `ContextCapsuleTable` moved to `context-broker/sql.ts` (re-exported from
   capsule.ts); `CtxPackUsageAdmissionTable` added to `ctxpack/sql.ts`.
4. **Wire portability (httpapi-codegen):** stripped ALL `Schema.check`/
   `makeFilter` refinements from transport schemas (CtxPack.CreateRequest
   filters, fragmentText check, SessionInput.ContextAttachments max-8 +
   dup-capsule). Limits now enforced in core (C1 validation.ts, SessionInput
   admission: codes `too-many-attachments` / `duplicate-capsule`). Create/
   patch payloads dropped workspaceID/ctxPackID (params carry them — codegen
   rejects the field collision): `CtxPackCreatePayload` / `CtxPackPatchPayload`
   in groups/ctxpack.ts. List query is plain optional strings;
   `normalizeListQuery` in handlers/ctxpack.ts maps wire → domain
   (defaults, int parsing, literal validation, cursor base64url check) and
   fails with DOMAIN tags (`CtxPackInvalidSelection`, `CtxPackSearchCursorInvalid`)
   that `toHttpError` maps. Materialize payload = frozen non-URL fields
   `{expectedContentHash, targetInstanceID, targetFunctionalityID}`.
5. **Barrel/exports:** lane files export single names; `ctxpack/index.ts`
   barrel provides the `CtxPackSQL/CtxPackService/CtxPackMaterializer/
   CtxPackEvents/CtxPackUsage/CtxPackObservability` namespaces + wiring nodes.
   NOTE: `@opencode-ai/core/*` wildcard maps to FILES (`src/*.ts`), so import
   `@opencode-ai/core/ctxpack/index` (not `/ctxpack`).
6. **M1-owned `ctxpack/wiring.ts`:** real `workspaceMembershipLive`
   (workspace.get-based, LayerNode @opencode/v2/WorkspaceMembership — node
   form avoids error-channel leakage), `ctxPackEventPortLayer` (C1 port ← C2
   EventV2 publisher), `sessionCtxSnapshotPortLayer` (Q1 port ← X1
   materializer), `ctxPackUsagePortLayer` (Q1 port ← C2 usage). Provided in
   both composition roots (server routes.ts + opencode httpapi server.ts).
7. **App host:** registrations/index.ts registers `builtin:ctxpack-browser`;
   workspace.tsx adds CanvasBlockType entry, FUNCTIONALITY_BY_TYPE mapping,
   MODULES palette entry (ctxpack-browser appears in the + palette), block
   body case (gated on BLOCK_RUNTIME_V3), source-root data attributes
   (`data-ctxpack-source-root`, workspace-id/block-id/functionality-id on
   `canvas-card-body`), ONE CtxPackDraftProvider + ONE
   ContextAttachmentStoreProvider at canvas scope, ONE CtxPackSelectionOverlay
   with the SDK create facade (M1-owned `block-body.tsx`, `sdk-facade.ts`).
8. **App worker-suite type fixes (lanes closed):** solid deep-path imports
   kept (`solid-js/dist/solid.js` — required so `bun test --conditions=solid`
   keeps the client runtime) with `// @ts-ignore` (tsgo ignores the ambient
   decl) + explicit callback annotations; overlay returns a two-node array
   cast to Element; Kobalte children casts in tests; adapter.test generic
   read cast; drop-target test element type.
9. **Event manifest:** CtxPackChanged added to ServerDefinitions +
   Definitions; counts updated (66 / 93 / 93 / 35).

## Known limitations (documented, not fixed)

- Q1: snapshot lost if the process crashes between event publish and column
  update (event pipeline constraint).
- hey-api drops `null` from `Schema.NullOr` fields in generated SDK types
  (CtxPackSource.sourceTimestamp/entityRef/label typed non-null); the facade
  casts around it (sdk-facade.ts).
- The pre-existing opencode typecheck failure (EffectDrizzleQueryError leak
  in the sibling workstream) blocks a full-repo green typecheck; every
  package CtxPack touches is green.
- App cross-suite test pollution (see above).

## Follow-ups (not done)

- T1 final gate run + M2 closeout (per dispatch: Wave 4).
- P1's group errors: the full frozen error union is declared on every
  endpoint (fine for v1); per-endpoint refinement optional later.
