# U3 — Drag payload, drop targets, attachment store

Base commit: `2d913472a237523696e7f9105a4c08a90b50a843`

## Files changed
All new, under `packages/app/src/context/ctxpack/`:
- `drag.ts` — frozen drag payload contract + transport helpers
- `drop-target.tsx` — message-context target registry (app-memory singleton + Solid context) + `CtxPackDropTarget` wrapper component
- `attachment-store.tsx` — context attachment store (Solid context provider + factory) + `toSessionContextAttachmentInput`
- `drag.test.ts` — 12 tests
- `attachment-store.test.tsx` — 14 tests
- `drop-target.test.tsx` — 16 tests
- `HANDOFF-U3.md` — this file

No other files touched (no git writes, no installs, no central files).

## Tests
All three gates pass from `packages/app` with `$BUN test --conditions=solid --preload ./happydom.ts`:
- `src/context/ctxpack/drag.test.ts` — **12 pass / 0 fail**
- `src/context/ctxpack/attachment-store.test.tsx` — **14 pass / 0 fail**
- `src/context/ctxpack/drop-target.test.tsx` — **16 pass / 0 fail**

Coverage: round trip / unknown version / malformed JSON / missing field / extra key / empty transfer / exact six-key serialization; registry register–unregister lifecycle, markFocused/focused (incl. disabled + ghost ids), attachToFocused forwarding and `no-focused-target` rejection; wrapper dragover accept (preventDefault + `dropEffect: "copy"` + ring), garbage/other-MIME no-op, dragleave/drop ring clearing, drop calls addCtxPack; store semantics 1–9 from the brief (workspace gate with zero materialize calls, duplicate no-op, 9th attachment → `attachment-limit`, token aggregate → `token-limit` with store intact, materialize failure → `materialize-failed` no fake chip, pending internal + `pendingCount`, exact draft keys with no text field, clear/restore round trip, exact `toSessionContextAttachmentInput` mapping) plus: `offline` pass-through, pending-hiding while materializing, `remove`, and a provider-through-context smoke test.

## Public exports
- `drag.ts`: `CTXPACK_DRAG_MIME`, `CtxPackDragPayloadV1`, `serializeCtxPackDragPayload`, `parseCtxPackDragPayload`, `applyCtxPackDrag` (frozen contract, exact).
- `drop-target.tsx`: `MessageContextTargetRegistration`, `MessageContextTargetRegistry`, `MessageContextTargetRegistryContext`, `useMessageContextTargetRegistry`, `CtxPackDropTarget`, `CtxPackDropTargetProps` (frozen contract, exact). Additive: `CTXPACK_DROP_RING_CLASS` (exported ring class name, `"ctxpack-drop-ring"`), `createMessageContextTargetRegistry()` (factory), `messageContextTargetRegistry` (the app-memory singleton; also the context's default value, so `useMessageContextTargetRegistry()` returns it without a provider).
- `attachment-store.tsx`: `ContextAttachmentDraft`, `SessionContextAttachmentInput`, `toSessionContextAttachmentInput`, `ContextAttachmentStore`, `ContextAttachmentStoreContext`, `useContextAttachmentStore`, `MAX_CONTEXT_ATTACHMENTS` (8), `MAX_CONTEXT_ATTACHMENT_TOKENS` (6_000) (frozen contract, exact). Additive: `ContextAttachmentStoreProvider` (the provider component — name not frozen; M1 must import this), `createContextAttachmentStore(workspaceID, materialize)` (factory for direct use/tests), `ContextCapsuleMaterializeInput` / `ContextCapsuleMaterializeResult` / `ContextCapsuleMaterialize` (typed facade of the injected materialize).

## Central integration actions
Listed only — NOT performed:
- **M1**: wire the real `ctxpack.materialize` SDK call into `ContextAttachmentStoreProvider`'s `materialize` prop (typed as `ContextCapsuleMaterialize`; rejection with `Error("offline")` passes through as the `offline` stable code, any other rejection maps to `materialize-failed`).
- **U5**: wrap composers with `CtxPackDropTarget`; call `registry.markFocused(targetID)` from the composer input's `focusin`/`pointerdown`; consume `attachments()` / `pendingCount()` / `totalEstimatedTokens()` for chips and limits.
- **Q1**: consume `SessionContextAttachmentInput` via `toSessionContextAttachmentInput`.

## Assumptions
- Stable error codes are carried as BOTH `Error.message` and `Error.code` (`"cross-workspace" | "attachment-limit" | "token-limit" | "materialize-failed" | "offline"`).
- Check order in `addCtxPack`: workspace → duplicate → count → tokens (count fires before tokens; pinned by a test).
- Pending entries count toward the 8-attachment and 6,000-token limits; duplicate detection considers only committed attachments.
- `clearAfterAdmission` / `restoreAfterFailure` also drop in-flight pending work via an internal epoch (a materialize resolving after clear/restore is discarded).
- The drop-target wrapper does NOT call `markFocused` itself — the composer/input owner does (per brief).
- The wrapper does not validate workspace/limits — the store does; `attachToFocused` does not route by workspace.

## Known limitations
- App-memory only; nothing persists (by design).
- `remove()` affects committed attachments only.
- `ContextAttachmentStoreProvider` and `CtxPackDropTarget` are implemented WITHOUT JSX syntax (see below) — behavior and props are identical, but consumers should treat them as black-box components.
- The repo's test setup under `--conditions=solid` resolves `solid-js` and `solid-js/web` to their **server builds** and compiles JSX with the **React classic transform** (tsconfig `"jsx": "preserve"`), which breaks any component rendering in bun tests — the repo's own `probe-mock.test.tsx`, `coder-selector.test.tsx`, `session-surface-base.test.tsx` fail the same way (verified). Workaround used here, validated empirically:
  1. Components build DOM with plain DOM APIs + the reactive core (`createRenderEffect`, `createComponent`, `createRoot` — all exported by `solid-js/dist/solid.js`), no JSX syntax. This keeps them compileable and runnable under bun AND under the app's Vite build.
  2. Tests redirect `solid-js` to the client build via `mock.module("solid-js", () => require(import.meta.resolve("solid-js").replace("dist/server.js", "dist/solid.js")))` and import solid-js + the ctxpack modules **dynamically** after registration. `mock.module` cannot intercept static imports in bun 1.3.14 (the repo's own probe-mock proves it), so static imports of solid-tainted modules are avoided in the test files; type-only static imports are fine (erased).
  3. Mounting in tests uses `createRoot((disposeRoot) => { …; return () => { …; disposeRoot() } })` — note `createRoot` only wires cleanups when the callback takes the `dispose` argument.

## Prohibited-pattern scan
`rg -n "fragment|selectedText|text_content|authorization|token" packages/app/src/context/ctxpack/drag.ts packages/app/src/context/ctxpack/drop-target.tsx`
→ **no matches** (exit 1). The drag/drop transport carries no content-bearing or credential fields; the DataTransfer only ever receives the six payload fields plus the plain-text label.
