# U4 — Selection overlay + create-CtxPack dialog

Wave 2 worker U4. Base commit: `2d913472a237523696e7f9105a4c08a90b50a843` (branch `feature/CyberMaster`).

## Files changed

All NEW, under `packages/app/src/context/ctxpack/`:

- `selection-overlay.tsx` — `CtxPackSelectionOverlay` (frozen props per plan) + toolbar
- `create-dialog.tsx` — `CtxPackCreateDialog` (frozen props per plan) + local
  `CtxPackCreateRequestLocal` / `CtxPackInfoLocal` types + budget constants
- `selection-overlay.test.tsx` — 7 tests (happy-dom + solid client runtime)
- `create-dialog.test.tsx` — 9 tests
- `HANDOFF-U4.md` — this file

No other files touched. No git writes. No installs.

## Tests

Both gate commands pass:

```
cd packages/app && $BUN test --conditions=solid --preload ./happydom.ts src/context/ctxpack/selection-overlay.test.tsx   # 7 pass / 0 fail
cd packages/app && $BUN test --conditions=solid --preload ./happydom.ts src/context/ctxpack/create-dialog.test.tsx      # 9 pass / 0 fail
```

Test harness pattern (both files): the repo's probe-mock recipe —
`mock.module("solid-js" / "solid-js/web")` redirecting to the client builds,
the React classic-JSX shim into `createComponent`/`h`, then dynamic imports.
The dialog context is a **fake `useDialog`** that mimics the repo's real
portal mount (Kobalte Root + Portal into `document.body`) with deterministic
`close()`; this is required because the real `DialogProvider` adds
transition/timer timing that is untestable under happy-dom, and the kobalte
Root is needed for the mandated dialog-v2 `Dialog` primitives (their
`Kobalte.Content` throws without a Root). The overlay tests render the REAL
U1 `CtxPackDraftProvider`; a `Probe` child grabs the controller. The
`@/utils/toast` module is mocked (records calls — used by the duplicate and
no-leak assertions).

## Public exports

`selection-overlay.tsx`: `CtxPackSelectionOverlayProps` (frozen),
`CtxPackSelectionOverlay(props)`.

`create-dialog.tsx`: `CtxPackCreateDialogProps` (frozen),
`CtxPackCreateDialog(props)`, `CtxPackCreateRequestLocal` (frozen),
`CtxPackInfoLocal` (U1/U2-frozen Info shape + `createdByUserID`),
`CtxPackInfoFragmentLocal`, and budget constants
(`MAX_CTXPACK_FRAGMENTS`, `MAX_CTXPACK_AGGREGATE_BYTES`,
`MAX_CTXPACK_AGGREGATE_TOKENS`, `MAX_CTXPACK_TITLE_CODEPOINTS`,
`DEFAULT_CTXPACK_TITLE_CODEPOINTS`, `MAX_CTXPACK_KEYWORDS`).

## Central integration actions (list only — NOT done by U4)

- M1: mount ONE `CtxPackSelectionOverlay` (inside the single
  `CtxPackDraftProvider`) at workspace-shell scope; pass real accessors for
  `workspaceID`/`workspaceEpoch`; wire the real SDK facade as `create` (align
  `CtxPackCreateRequestLocal`/`CtxPackInfoLocal` field names to S1's schema);
  decide the dialog portal layer (component self-portals via `useDialog()` —
  it must be rendered inside `DialogProvider`; M1 may alternatively wrap it).
- M1: confirm the `@/utils/toast` "Already in draft" notice renders in the
  host's toast region (fixed string, no fragment text).
- M1: when S1's canonical schema lands, mechanically align the local frozen
  types (`CtxPackCreateRequestLocal`, `CtxPackInfoLocal`) to the SDK types;
  all field names match the plan's frozen spec 1:1.

## Assumptions

1. **Components are written with `h` (solid-js/h hyperscript), not JSX.**
   Under the repo's bun test setup, JSX is compiled by bun to eager
   `React.createElement(...)` calls (verified in the bundle output) that
   evaluate every prop and child ONCE at element creation — post-mount
   updates (toolbar appearing, save-button disabling, error text, chip
   edits, title truncation) would be silently frozen, making the mandated
   behavior tests impossible. `h` is Solid's official hyperscript: dynamic
   values are passed as zero-arg accessors (`value: () => title()`,
   `disabled: () => !canSave()`, `each: () => fragments()`), which `h`
   converts into reactive `dynamicProperty`/`spread` bindings; children can
   be functions for dynamic text/lists. Production (vite/esbuild) treats
   `h(...)` as plain function calls — no solid-plugin JSX transform
   involved, so the components behave identically in production.
2. **The overlay's toolbar is always mounted and toggled via
   `display:none`** (imperative `createRenderEffect` + ref) instead of
   `<Show>`. Empirically, accessor/getter-valued props passed into
   components inside a provider's children cause Solid's `children` memo to
   re-resolve the whole subtree on signal writes, re-creating the overlay
   (and re-attaching document listeners) — the toolbar then never appears.
   Static props + imperative style avoids that while staying reactive.
   Tests assert `style.display`, not element absence.
3. **Fake dialog context** (assumption 2 of tests above): the repo's real
   `useDialog().show()` mounts via `startTransition` + a 100 ms dispose
   timer; the fake keeps the same Kobalte Root+Portal rendering path with
   synchronous close, so all dialog content (including kobalte) is exercised
   as in production.
4. Duplicate notice uses `showToast` from `@/utils/toast` with the fixed
   string `"Already in draft"` (repo toast idiom; the brief's
   "toast/text" allows either). No selected text is ever interpolated.
5. Sensitivity floor: weaker options are disabled (rank public<workspace<
   private); the minimum is selected at open. If the floor rises while the
   dialog is open, save is disabled until the user re-picks — never a
   silent upgrade (no auto-bump).
6. `idempotencyKey = crypto.randomUUID()` per save attempt (fresh after a
   failure so retries are not server-deduped); `pending()` blocks a second
   request.
7. Save is additionally disabled when `workspaceID()` is undefined (the
   request requires a string; not in the brief's list but a facade
   invariant).
8. The dialog's title/keyword fields reset on every open transition
   (close-without-save preserves the DRAFT, per brief — fields are dialog
   state and re-default from the draft).
9. `crypto.randomUUID()` is available (happy-dom + Bun) as in U1.
10. "Stable error message" = fixed text built only from the facade's
    `errorCode`; the rejection's `message` is never rendered (it could echo
    fragment text).

## Known limitations

- The toolbar's DOM contains only fixed labels; there is no preview of the
  captured text (by design — the no-leak rule).
- Toolbar position clamps with fallback dimensions (260×44) when the element
  isn't measured yet; in production the ref's `offsetWidth/Height` is used.
- The create dialog deliberately uses native inputs/buttons rather than
  ButtonV2/TextInputV2 for every reactive control: those components
  `splitProps` their props, which snapshots accessor values at creation and
  would freeze updates under this test setup. The mandated dialog-v2
  primitives (Dialog/DialogHeader/DialogBody/DialogFooter/DialogTitle) and
  `useDialog` are used.
- The dialog's open effect guards with an internal `mounted` flag; if the
  host unmounts the overlay while the dialog is open, the portal's lifecycle
  is owned by the dialog context (M1's portal wiring decides teardown).
- Not covered by tests: real `DialogProvider` timing (Escape/overlay-click
  dismiss paths are exercised through the fake's `onOpenChange`), real
  `@opencode-ai/ui` styling, and toast rendering (mocked).

## Prohibited-pattern scan

```
rg -n "localStorage|IndexedDB|innerHTML|unsafeHTML|console\.(log|debug)" packages/app/src/context/ctxpack/selection-overlay.tsx packages/app/src/context/ctxpack/create-dialog.tsx
```

Clean — zero hits (implementation files only; doc comments avoid naming the
patterns).
