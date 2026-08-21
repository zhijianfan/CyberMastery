# U1 — Selection capture, draft, keyword suggestions

Wave 1 worker U1. Base commit: `2d913472a237523696e7f9105a4c08a90b50a843` (branch `feature/CyberMaster`).

## Files changed

All NEW, under `packages/app/src/context/ctxpack/`:

- `selection.ts` — frozen local types + `captureCtxPackSelection` + `normalizeSelectedText`
- `draft.tsx` — `CtxPackDraftController`, `createCtxPackDraftController`, `CtxPackDraftProvider`, `useCtxPackDraft`
- `keyword-suggest.ts` — `suggestCtxPackKeywords`
- `selection.test.ts` — 12 tests (happy-dom)
- `draft.test.tsx` — 8 tests (Solid reactive root; no DOM rendering — see Assumptions)
- `keyword-suggest.test.ts` — 9 tests
- `HANDOFF-U1.md` — this file

No other files touched. No git writes. No installs.

## Tests

All pass under the prescribed gate command:

```
cd packages/app && $BUN test --conditions=solid --preload ./happydom.ts src/context/ctxpack/selection.test.ts        # 12 pass
cd packages/app && $BUN test --conditions=solid --preload ./happydom.ts src/context/ctxpack/draft.test.tsx           # 8 pass
cd packages/app && $BUN test --conditions=solid --preload ./happydom.ts src/context/ctxpack/keyword-suggest.test.ts  # 9 pass
```

`bun test src/context/ctxpack/` (whole dir) also runs other Wave-1 workers' in-flight files
(`drop-target.*`, `attachment-store.*`, `drag.*`) — 8 failures there are NOT mine (drop-target
suite) and were present when I ran; my 3 files pass in isolation and in the combined run (29 pass).

## Public exports

`selection.ts`: `CtxPackSourceRootDataset`, `CtxPackSourceKind`, `CtxPackDirection`,
`CtxPackSensitivity`, `CapturedSource`, `CapturedCtxPackFragment`,
`MAX_CTXPACK_FRAGMENT_BYTES`, `normalizeSelectedText(value)`,
`captureCtxPackSelection({ selection, now })`.

`draft.tsx`: `CtxPackDraftController` (interface per plan), `CtxPackDraftProviderProps`,
`createCtxPackDraftController(workspaceID, workspaceEpoch)` (extra export — see Assumptions),
`CtxPackDraftProvider(props)`, `useCtxPackDraft()` (throws outside provider).

`keyword-suggest.ts`: `suggestCtxPackKeywords({ title, fragments })`.

## Central integration actions (list only — NOT done by U1)

- M1: mount ONE `CtxPackDraftProvider` at workspace-shell scope with
  `workspaceID` / `workspaceEpoch` accessors; blocks never mount their own.
- M1: mount ONE selection overlay at workspace-shell scope; on user selection
  call `captureCtxPackSelection({ selection, now: Date.now() })` and feed the
  result into `useCtxPackDraft().add(...)`.
- M1: when S1's canonical schema lands, mechanically align the local frozen
  types (`CapturedCtxPackFragment` etc.) to `CtxPack.FragmentInput`; all
  field names match the plan's frozen spec 1:1.

## Assumptions

1. **Solid import in `draft.tsx` uses `solid-js/dist/solid.js` (client build), not bare `solid-js`.**
   Under the gate command (`--conditions=solid`), bun's default `node` export condition makes the
   bare `solid-js` specifier resolve to the SSR entry (`dist/server.js`), where `createEffect` is a
   hard no-op stub — auto-clear-on-epoch would be silently dead in tests. `solid-js/dist/solid.js`
   is a public subpath (`"./dist/*"` wildcard in the pinned 1.9.10 exports map) and is the exact
   runtime the app bundles in production; behavior is identical outside this test setup. If the
   central toolchain prefers the bare specifier, swapping back is one line — but then the two
   auto-clear tests can never pass under this command.
2. `draft.test.tsx` does not DOM-render the provider: `solid-js/web` under the same conditions
   resolves to its server entry, where `render()` throws ("Client-only API"). The repo's own
   `context/*` tests are all logic-level `.ts` tests, so this matches house style. Coverage is
   equivalent: the provider is a 4-line context wrapper over `createCtxPackDraftController`, which
   is what the tests exercise (including both auto-clear behaviors via real `createEffect` on
   controllable accessors). The `useCtxPackDraft` throw-path is not covered (needs rendering).
3. `captureCtxPackSelection` reads only `selection.toString()` and the two range boundary roots —
   no innerHTML, no whole-root textContent, no clipboard, no offscreen siblings (also enforced by
   the scan below). Dedupe in `add()` compares normalized text, per "same normalized text".
4. `move()` clamps `targetOrdinal` to `[0, len-1]` and no-ops on unknown id / non-finite ordinal.
5. Source defaults frozen for v1: `kind:"block-text"`, `direction:"unknown"`,
   `sourceTimestamp:null`, `entityRef:null`, `label:null`, `metadata:{}`,
   `sensitivity:"workspace"`, `capturedAt: input.now`; root attrs read via `dataset`.
6. Suggest: token regex `/[\p{L}\p{N}][\p{L}\p{N}._:\-]*/gu`; short-token rule via code-point
   count; stop-word set = exactly the plan's list; dedupe key = `toLowerCase()`; title tokens
   first (first-seen), then fragments by frequency (count desc, first-seen asc); cap 8.

## Known limitations

- Editable check uses `isContentEditable` + explicit `contenteditable="true"` attribute check
  (covers inheritance and the empty-attribute case per spec).
- `clientFragmentID` via `crypto.randomUUID()` (available in happy-dom + Bun).
- Auto-clear effect fires once on mount (no-op on an empty draft) and on every change of either
  accessor, per plan.
- The controller does NOT enforce the 1–32 fragment budget (create dialog's job) nor the 32 KiB
  cap (capture's job), per plan.
- `workspaceID`/`blockID`/`functionalityID` fall back to `""` if a root attribute is missing.

## Prohibited-pattern scan

```
rg -n "localStorage|IndexedDB|Persist|console\.(log|debug)|innerHTML|textContent" packages/app/src/context/ctxpack
```

Hits are limited to (a) doc comments in `selection.ts`/`draft.tsx` that name the patterns to say
they are NOT used, and (b) test-fixture DOM setup (`selection.test.ts` uses `innerHTML` exactly
once, per the brief's own fixture, and `textContent` to build fixtures). Implementation files have
ZERO actual uses: no persistence imports, no content logs, no whole-root textContent/innerHTML
captures.
