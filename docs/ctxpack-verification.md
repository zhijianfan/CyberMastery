# CtxPack Verification — T1 lane report

Independent verification of the integrated CtxPack implementation
(13 lanes + M1 integration) on `feature/CyberMaster`.

- **Commit tested:** `2d913472a` (HEAD at verification time, working tree = base + 13 lanes + sibling work)
- **Date:** 2026-08-21
- **Verifier:** T1 (verification lane) — read-only over production code; evidence only.

## Runtime flags

| Flag | Location | Value at verification |
|---|---|---|
| `CYBERMASTER_BLOCK_RUNTIME_V2` | `packages/core/src/flag/flag.ts:31` | `truthy("CYBERMASTER_BLOCK_RUNTIME_V2")` (env-gated; off by default) |
| `BLOCK_RUNTIME_V3` | `packages/app/src/pages/canvas/flag.ts:1` | `true` (unified canvas runtime path; note: the T1 brief's path `packages/app/src/flag.ts` is stale — the real location is `src/pages/canvas/flag.ts`) |

## Migration result (fresh DB)

Verified in `packages/core/test/ctxpack-acceptance.test.ts` on fresh in-memory
databases (`DatabaseMigration.apply` + `ensureCtxPackFts`):

- `ctx_pack`, `ctx_pack_fragment`, `ctx_pack_keyword`, `ctx_pack_usage_admission`,
  `context_capsule`, `session_input.context_snapshot_json` all created by the
  regenerated `schema.gen.ts` (the handwritten `20260821_ctxpack` migration is
  SKIPPED on fresh DBs — M1 fix).
- The FTS5 virtual table (`ctx_pack_fts`) is created lazily by
  `ensureCtxPackFts(db)` (exported from `@opencode-ai/core/ctxpack/sql`);
  `EXPLAIN QUERY PLAN` confirms `VIRTUAL TABLE INDEX` usage (see 10k run below).

## Test commands + results

Bun binary (absolute, not on PATH):
`$HOME/.bun-npm/node_modules/@oven/bun-windows-x64/bin/bun.exe`

```bash
export PATH="$HOME/.bun-npm/node_modules/@oven/bun-windows-x64/bin:/d/OpencodeDev/node_modules/.bin:$PATH"
```

### Gate 1 — Core acceptance

```bash
cd packages/core && $BUN test --only-failures test/ctxpack-acceptance.test.ts
```

Result: **19 pass, 0 fail, 209 expect() calls** (exit 0).
Full run: `$BUN test test/ctxpack-acceptance.test.ts` — 19 pass / 0 fail.

Coverage (brief §1 items, all exercised on the real repository + capability
service + capsule store + event recorder):

1. create single + multi-block pack (ordinals preserved, one `created` event each) ✓
2. search by title / keyword / fragment text (FTS) ✓
3. metadata filters intersect (query ∩ sourceBlockID ∩ sourceKind ∩ keyword ∩
   created-range ∩ sensitivity) ✓
4. all seven sorts cursor-stable across three pages, no duplicates, walk ==
   single-pass order, sort-key monotonicity ✓
5. materialize returns a capsule ref (`ctxkpsl_`) with no fragment text ✓
6. snapshot admission atomicity — denied attachment → no input row, no event,
   no usage (real X1 materializer + C2 ledger on the full session stack) ✓
7. source independence after admission — deleting the pack leaves the admitted
   snapshot row byte-identical; new admissions then fail `CtxPackDeleted` ✓
8. usage increments exactly once per admission (idempotent ledger, attachedCount,
   `used` event) ✓
9. cross-workspace fragment denied before any repository write ✓
10. secret source sensitivity denied at runtime ✓
11. 9 attachments rejected (`too-many-attachments`, snapshot + admission) ✓
12. 6,001+ tokens rejected (create `CtxPackBudgetExceeded`; snapshot
    `CtxPackSnapshotOverBudget`) ✓
13. includeDeleted semantics ✓
14. restore after delete re-indexes FTS ✓
15. revision conflicts on patch/remove/restore ✓
16. list rejects `limit` > 50 ✓

### Gate 2 — App runtime observability

```bash
cd packages/app && $BUN test --conditions=solid --preload ./happydom.ts src/pages/canvas/ctxpack-runtime-observability.test.ts
```

Result: **7 pass, 0 fail, 59 expect() calls** (exit 0).

- stale projection preserved on transient failure; next success restores `ready` ✓
- reconnect forces immediate authoritative refetch (no debounce) ✓
- burst of 3 matching events coalesces into exactly ONE refetch ✓
- permission-denied → explicit `permission-denied` state (never an empty list) ✓
- layout purity: every local-view write is exactly `{ query }` — never
  items/selected/content/fragments ✓
- U2 view contract: `select()`/`initialCtxPackBrowserView()` emit exactly the
  frozen keys ✓
- no polling: adapter + view-model source contain no `setInterval` /
  `EventSource` / `WebSocket`; coalescing is a `setTimeout` trailing debounce ✓

### Typecheck (regression guard)

- `cd packages/core && bun run typecheck` (tsgo): **PASS** (exit 0)
- `cd packages/app && bun run typecheck` (tsgo -b): **PASS** (exit 0)

## E2E spec (`packages/app/e2e/ctxpack.spec.ts`)

Authored for `playwright test`; `test.describe("ctxpack")`; CI-runnable with
env-driven skips. Run:

```bash
cd packages/app
npx playwright test e2e/ctxpack.spec.ts --reporter=line   # mock-server scenarios (CI)
CTXPACK_E2E_HOST=1 npx playwright test e2e/ctxpack.spec.ts # + host journey
```

Scenarios:

| Scenario | Host needed? | CI behavior |
|---|---|---|
| select text in chat block → Save as new CtxPack → dialog defaults → save → open CtxPackBrowser → detail fragment order → drag MIME → drop on v2 composer → chip → send; EXACTLY ONE `session.prompt` carrying `contextAttachments` (capsule refs, no text) | yes (real ctxpack v2 API) | `test.skip(!HOSTED)` |
| drop frozen-MIME payload on v2 composer → materialize → chip → send → exactly ONE `POST /session/{id}/message` with `contextAttachments` (capsule refs, no text) | no (mock server + in-spec v2 route stubs) | runs |
| failed prompt → draft text + chip preserved (rollback) | no (mock server + failing prompt stub) | runs |

Selectors used: `[data-ctxpack-selection-toolbar]`, `[data-ctxpack-action="save"]`,
`[data-ctxpack-title-input]`, `[data-ctxpack-save]`,
`.canvas-block-palette`/`.canvas-palette-item`, `[data-ctxpack-id]`,
`.ctxpack-browser-detail`, `.ctxpack-browser-fragment[data-ordinal]`,
`[aria-label="Drag pack to attach"]`, `[data-component="prompt-input-v2"]`,
`[data-component="prompt-input"]`,
`[data-component="prompt-input-v2-context-attachments"] [data-attachment-id]`.

Not runnable locally in this environment (no Playwright browsers installed);
CI command above is the gate.

## Network transport count

- List/refetch: one `GET` per page via the generated SDK v2 client
  (`/api/workspace/{workspaceID}/ctxpack`), aborts superseded requests.
- Detail: one `GET` per open (reused when the revision is unchanged).
- Events: EventV2 `workspace.ctxpack.changed` only — transient, live-subscriber
  only, coalesced to one refetch per burst. No polling, no second stream.
- Prompt admission: one `POST /session/{id}/message` carrying
  `contextAttachments` (capsule refs, no fragment text).

## Redaction sweep

Sentinel `CTXPACK_SECRET_SENTINEL_7812` in titles/keywords/fragments; grepped
every log/event/drag/diagnostic path in the CtxPack diff
(`devplan/ctxpack packages/core/src/ctxpack packages/core/src/capability
packages/core/src/context-broker packages/app/src/context/ctxpack
packages/app/src/pages/canvas/blocks/ctxpack-browser
packages/app/src/components/prompt-input`):

- No `console.log/debug/info` in any production ctxpack file (only the
  lane-owned test spy in `selection-overlay.test.tsx`).
- Every `Error(...)`/`message:` hit is a fixed code/label (`stableError`,
  `NO_FOCUSED_TARGET_CODE`, `errorCode`-only `describeCreateError`,
  `CtxPackChanged` schema message) — no content interpolation.
- `service.ts` publish-failure log carries only `properties.change` (event type).
- Materialize/usage/observability diagnostics carry bytes/counts/ids only.

**Result: no content interpolation found.**

## Prohibited-pattern scan

```bash
rg -n "/api/block-runtime/event|chatgpt\.com/backend-api/conversation|setInterval.*(ctxpack|context)|createMockChatRelayContext" packages
```

**Result: zero code matches** (only a HANDOFF-R1.md doc reference to its own
no-polling scan). No diff-introduced prohibited patterns.

## 10k-pack behavior (core-level)

Seeded 10,000 packs × 2 fragments via direct repository inserts:

- **Seed time: ~5.4 s** (well under the 60 s bound; no skip needed)
- page limit ≤ 50 ✓ (limit-50 list returns exactly 50; `limit` 51 rejected)
- cursor pagination across 3 pages of 50: **no duplicates**, walk consistent ✓
- `totalEstimate` == seeded count ✓
- `EXPLAIN QUERY PLAN … ctx_pack_fts MATCH` → contains **`VIRTUAL TABLE INDEX`** ✓
- **repo.get not called during list** (spy counter == 0 over the whole run) ✓

## Known limitations (plan §10 + M1 handoff)

- Q1: snapshot lost if the process crashes between event publish and column
  update (event pipeline constraint).
- Deleted packs drop out of the FTS index until restored (`softDelete` removes
  the `ctx_pack_fts` row; `restore` re-inserts it) — `includeDeleted` lists
  them but search does not match them (asserted as observed behavior).
- hey-api drops `null` from `Schema.NullOr` fields in the generated SDK types
  (facade casts around it).
- App cross-suite test pollution: bun shares one process on Windows and U5's
  `submit.test.ts` `mock.module` calls leak — app suites must run per-file.
- Pre-existing opencode package typecheck failure
  (`EffectDrizzleQueryError` in the sibling workstream) blocks a full-repo
  green typecheck; every package CtxPack touches is green (core, app, schema,
  protocol, server, sdk, session-ui per M1).
- `CtxPackChanged` events are non-durable by design (EventV2 transient hint);
  the event table stores no ctxpack rows.

## Not verifiable locally (exact CI commands)

| Item | CI command |
|---|---|
| bun-gated SDK `generate` (server boot + node graph) | `cd packages/sdk/js && bun run generate` |
| Full browser E2E (Playwright + host) | `cd packages/app && npx playwright test e2e/ctxpack.spec.ts` (plus `CTXPACK_E2E_HOST=1` variant) |
