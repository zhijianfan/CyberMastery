# U2 — CtxPackBrowser view components

Status: archived handoff; integration completed. The manifest/view and R1
registration are wired into the live canvas. The “Central integration
actions” below are historical, not pending work.

Base commit: `2d913472a237523696e7f9105a4c08a90b50a843`

## Files changed

All NEW, under `packages/app/src/pages/canvas/blocks/ctxpack-browser/`:

- `types.ts` — frozen local type surface (exact field names from the brief) + `CTXPACK_DRAG_MIME`
- `view-model.ts` — `CtxPackBrowserView`, `CtxPackBrowserCommand`, `CtxPackBrowserProps`, `initialCtxPackBrowserView()`
- `index.tsx` — default-export `CtxPackBrowser` (status machine: loading skeleton / permission-denied / unavailable / error / stale+ready; search w/ 200 ms debounce, sort selector, filters, card grid, distinct empty-vs-no-results copy, load-more w/ spinner, detail panel when `selected`)
- `filters.tsx` — source kind, sensitivity, keyword, created after/before, include-deleted toggle; every change dispatches `set-query` with `cursor: null`
- `ctxpack-card.tsx` — title, ≤4 keyword chips + "+N", fragment count, "N blocks · funcIDs" summary, created date, tokens, attached count / last attached; click → `open`; Patch/Delete/Restore with local pending state; `aria-live` region announcing `errorCode`
- `ctxpack-detail.tsx` — fragments in ordinal order w/ source metadata (workspace/block/functionality/timestamp, as text + `data-source-*` attrs), `<pre>` text rendering (selectable, `user-select: text`), drag icon (`draggable`, aria-label "Drag pack to attach", seeds `CTXPACK_DRAG_MIME` + `text/plain`, `effectAllowed: "copy"`), "Attach to focused input" button, Close
- `manifest.ts` — frozen `CtxPackBrowserManifest` (registers nothing)
- `ctxpack-browser.css` — plain CSS (`ctxpack-browser-card`, `ctxpack-browser-chip`, `ctxpack-browser-stale`, `ctxpack-drag-icon`, …)
- `ctxpack-browser.test.tsx` — 13 tests, all passing
- `HANDOFF-U2.md` — this file

No other files touched. No git writes, no installs, no central registries.

## Tests

Command (from `packages/app`):

```
$HOME/.bun-npm/node_modules/@oven/bun-windows-x64/bin/bun.exe test --conditions=solid \
  --preload ./happydom.ts src/pages/canvas/blocks/ctxpack-browser/ctxpack-browser.test.tsx
```

Result: **13 pass / 0 fail** (77 expect assertions), covering every required assertion:
1. loading skeleton only, no stale list controls; 2. permission-denied (+ errorCode) and unavailable messages; 3. stale keeps items + badge (`aria-label="stale data"`); 4. ready renders search/filters/sort/cards/load-more; 5. "No context packs yet." vs "No context packs match your filters."; 6. deleted items only with `includeDeleted`; 7. fragments in ordinal order with source metadata; 8. no markup-injection APIs in component sources (file scan); 9. drag icon draggable + label + frozen MIME payload + `text/plain` + `effectAllowed: "copy"`; 10. Attach button calls `attachToFocusedInput` with derived summary; 11. debounced search (single dispatch after 210 ms) and `cursor: null` on every `set-query`; 12. Patch button dispatches `patch-metadata` with `expectedRevision` (plus Delete → `remove`, card click → `open`).

## Public exports

- `types.ts`: all frozen types + `CTXPACK_DRAG_MIME`
- `view-model.ts`: `CtxPackBrowserView`, `CtxPackBrowserCommand`, `CtxPackBrowserProps`, `initialCtxPackBrowserView`
- `manifest.ts`: `CtxPackBrowserManifest`
- `index.tsx`: `CtxPackBrowser` (named + default)
- `filters.tsx`: `CtxPackFilters`; `ctxpack-card.tsx`: `CtxPackCard`; `ctxpack-detail.tsx`: `CtxPackDetail` (internal building blocks)

## Central integration actions

Listed for M1 — NOT performed here:
- M1 registers `CtxPackBrowserManifest` in the builtin registry.
- M1 registers R1's adapter (which consumes `CtxPackBrowserView` + `CtxPackBrowserCommand` + `CtxPackBrowserProps` exactly) in the runtime registrations.
- M1 aligns these local types to S1's canonical schema types.

## Assumptions

- Patch button dispatches `patch-metadata` with an empty `patch: {}` — v1 has no metadata editor; the command carries `expectedRevision` from the summary.
- Detail shows all fragments inline ("authorized by get") — no lazy fragment loading.
- `createDragPayload`/`attachToFocusedInput` receive a `CtxPackSummary` derived from `CtxPackInfo` (unique block/functionality/kinds from fragments).
- Deleted items are additionally filtered client-side (`includeDeleted || deletedAt == null`) as defense in depth.

## Known limitations

- The repo's committed solid-DOM tests are currently red under bun 1.3.14 (`solid-js` resolves to its server build; the static-import `mock.module` pattern in `probe-mock.test.tsx`/`drop-target.test.tsx`/`chat-relay/view.test.tsx` doesn't intercept in time). This suite works around it with mocks registered before DYNAMIC imports of solid modules, plus the classic-JSX React shim (chat-relay convention) since bun compiles JSX to `React.createElement`. If bun/tsconfig JSX handling changes, the shim may become unnecessary.
- Classic JSX evaluation freezes initial props, so state-swap assertions are done by re-mounting rather than mutating the view signal mid-test; the runtime adapter's re-projection makes this equivalent in practice.
- Date filter inputs convert "YYYY-MM-DD" via `new Date(value).getTime()` (local-timezone dependent, acceptable for v1).

## Prohibited-pattern scan

`rg` scan across `packages/app/src/pages/canvas/blocks/ctxpack-browser` for markup-injection API tokens (`inner*HTML`, `unsafe*HTML`) and `textContent` → hits only `textContent` inside `ctxpack-browser.test.tsx` (permitted in tests). No markup-injection APIs anywhere in component sources (the in-suite scan test builds its needles by concatenation so the literals never appear in the tree).
