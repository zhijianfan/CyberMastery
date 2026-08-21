# R1 — Projected Block Runtime Adapter for `builtin:ctxpack-browser`

Base commit: `2d913472a237523696e7f9105a4c08a90b50a843` (feature/CyberMaster)

## Files changed

All NEW, under `packages/app/src/pages/canvas/blocks/ctxpack-browser/`:

- `adapter.ts` — `ctxPackBrowserRegistration` (`BlockRuntimeRegistration<CtxPackBrowserResolved, CtxPackBrowserView, CtxPackBrowserCommand>`, `mode: "projected"`), the local typed SDK facade `CtxPackBrowserSdk` (list/get/patch/remove/restore), and the extended frozen `CtxPackBrowserResolved` (frozen fields + `status` + `errorCode`). Framework-free: **zero runtime imports** (all imports are `import type`), so the adapter has no solid-js/server-sdk runtime dependency.
- `adapter.test.ts` — 15 tests, fake services + deferred fake SDK (tests control response delivery to prove abort/generation/epoch guards).
- `HANDOFF-R1.md` — this file.

No other files touched. No git writes, no installs, no central registries.

## Tests

Command (from `packages/app`):

```
$HOME/.bun-npm/node_modules/@oven/bun-windows-x64/bin/bun.exe test --conditions=solid \
  --preload ./happydom.ts src/pages/canvas/blocks/ctxpack-browser/adapter.test.ts
```

Result: **15 pass / 0 fail** (108 expect assertions), covering every brief item:
1. resolve awaits descriptor persistence then issues ONE initial list with the default query (plus: restored query is used when one is persisted, cursor nulled, workspaceID pinned);
2. permission-denied SDK error → `status: "permission-denied"` with `errorCode` (no fake empty list); `TypeError`/unavailable host → `"unavailable"`;
3. aborting the resolve signal stops state mutation (late response dropped; resolve settles with an inert `"loading"` stub);
4. workspace epoch change: a late response from the old epoch cannot overwrite the new state;
5. matching event → `"invalidate"`; burst of 3 events coalesces into exactly ONE refetch (150 ms trailing debounce); other-type / other-workspace events → `"ignore"`; `eventKeys` contract;
6. reconnect forces an immediate authoritative refetch;
7. transient refetch failure keeps last valid items + `"stale"` + `errorCode`; next success restores `"ready"`;
8. set-query resets cursor + generation, aborts the prior in-flight request, replaces (not appends) the list, persists `{ query }` to local view under `opencode.canvas.local-view.v1:ctxpack-browser:<blockID>`;
9. load-more fetches with the current cursor and appends unique IDs only (dedupe verified; no-op when cursor is null);
10. open stores detail; re-opening with an unchanged revision reuses it (no redundant get); patch-metadata/remove/restore each trigger exactly ONE authoritative list refetch (+ detail refetch when the selected pack is still listed; close-detail when it was removed); mutation payloads carry `expectedRevision`;
11. open on a deleted/missing pack (404 / not-found) closes the detail and refetches the list;
12. select maps resolved → exact U2 view shape (loading and ready; capability flags all `true`);
13. dispose unsubscribes the router listener + reconnect handler, aborts the in-flight request, and drops late responses (events/reconnects after dispose are no-ops).

## Public exports

- `ctxPackBrowserRegistration` — the runtime registration (M1 registers it).
- `CtxPackBrowserResolved` — extended frozen resolved shape (status/errorCode added per brief §4.3).
- `CtxPackBrowserStatus` — the status union.
- `CtxPackBrowserSdk` — the local typed facade; M1 swaps its backing implementation for the generated client.

## Central integration actions

Listed for M1 — NOT performed here:
- M1 registers `ctxPackBrowserRegistration` in `packages/app/src/pages/canvas/runtime/registrations/index.ts` + the builtin registry.
- M1 swaps the SDK facade: `resolve`/`dispatch` obtain it via `services.serverSDK().client.v2.workspace.ctxpack` (structural cast in `getCtxPackSdk`); the generated client lands with create/get/list/patch/remove/restore/materialize.
- M1 wires capability projections (v1 flags `canCreate/canPatch/canDelete/canMaterialize` are hard-coded `true`).
- M1 decides whether `"invalidate"` triggers a re-resolve; the adapter's own coalesced refetch (via its router subscription + onEvent) is the authoritative one, and both paths are debounce-idempotent.

## Assumptions

- **Aborted resolve settles with an inert `"loading"` stub** (never rejects, never mutates). M1's runtime should discard results of aborted resolves (it must check `signal.aborted` before adopting a resolve result). Test 3 asserts the stub is unmutated.
- `onEvent` both returns `"invalidate"` AND schedules the coalesced refetch; the 150 ms debounce makes double-scheduling (router listener + runtime onEvent) idempotent — one refetch either way.
- Error classification is heuristic (no typed SDK errors yet): 401/403 or `code`/`name` matching permission/forbidden/denied → `"permission-denied"`; 502/503/504, `code`/`name` matching unavailable/offline/host, or `TypeError` (fetch network failure) → `"unavailable"`; 404/410 or code matching not-found/deleted/gone/missing → deleted/missing for `open`. `errorCode` prefers `error.code`, then `error.name`, else `"error"`.
- Every state mutation is guarded by request generation + workspaceID + workspace epoch + abort state (`canMutate`), so late responses from old generations/epochs are dropped. Epoch is read from `services.workspace.epoch()` at request start.
- Transient refetch failure uniformly sets `"stale"` (keeps last valid items) — including a failed load-more, per the brief's blanket rule.
- `loadingMore` is always `false` in select (per brief §7); load-more is still awaited by the view's dispatch, so UX is unaffected in practice.
- Persisted local view contains ONLY `{ query }` — never items/selected/contents. Restored queries are sanitized (well-typed fields only, `cursor: null`, `workspaceID` pinned).
- The stale `revisionByPackID` map is rebuilt from every fresh list response (append mode updates per item), so removed packs are dropped and the open-reuse guard cannot serve a stale revision.
- EventV2 only: `workspace.ctxpack.changed` scoped by `workspaceID`; no polling, no second stream.

## Known limitations

- The typed SDK client doesn't exist yet; `getCtxPackSdk` casts `client.v2.workspace` structurally. If the generated client's error shapes differ from the heuristics above, `classifySdkError`/`extractErrorCode`/`isDeletedOrMissing` need a one-line alignment at M1.
- `totalEstimate` from list responses is ignored (view contract has no field for it).
- Happy-dom/bun quirk hit during testing: an `async` helper that `return promise` adopts the promise, so awaiting it before responding to the initial list deadlocks. The test helper `startResolve` is deliberately NOT async (documented in-file).
- The repo's pre-existing solid-DOM test failures under bun 1.3.14 (documented in HANDOFF-U2.md) are unrelated to this adapter; this suite is framework-free and green.

## Prohibited-pattern scan

`rg -n "setInterval|EventSource|WebSocket|localStorage" packages/app/src/pages/canvas/blocks/ctxpack-browser/adapter.ts` → **no matches** (timeout-based coalescing only; persistence goes through `services.localView`).
