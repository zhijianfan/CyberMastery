# U5 — Message-Input Drop Zones, Attachment Chips, Submit Wiring

Base commit: `2d913472a237523696e7f9105a4c08a90b50a843` (branch `feature/CyberMaster`).

## Files changed

- MODIFY `packages/app/src/components/prompt-input/submit.ts` — `contextAttachments` rides the
  `sessions.prompt` request (ready-only, in order, field omitted when empty); optimistic
  snapshot/clear/restore of the attachment store; shell-command and custom slash-command paths
  reject with toast `"Context attachments are not supported for this command"` when ready
  attachments exist (no `sessions.prompt` call happens on those paths).
- MODIFY `packages/app/src/components/prompt-input.tsx` (v1 composer) — `CtxPackDropTarget`
  wrapper (canonical generic `chat-instance:<sessionID>` / `builtin:chat`, or the supplied
  functionality-instance target), `registry.markFocused` on editor focus/pointerdown,
  `<ContextAttachmentChips>` above the input, drop disabled offline or at the 8/6,000 budgets,
  store passed into `createPromptSubmit`.
- MODIFY `packages/app/src/components/prompt-input-v2.tsx` (v2 composer) — `CtxPackDropTarget`
  wrapper using the same canonical target, markFocused via focusin/pointerdown listeners on the
  editor element, view data `contextAttachments` + `onRemoveAttachment`/`onPreviewAttachment`
  + `onDrop` (CtxPack payload parse → store; returns true to skip the built-in file-drop
  handling), controller getters `ctxpackTarget` / `ctxpackWorkspaceID` /
  `ctxpackAddCtxPack` / `ctxpackDropDisabled`, store passed into `createPromptSubmit`.
- MODIFY `packages/session-ui/src/v2/components/prompt-input/interaction.ts` — optional view
  contract `contextAttachments` (value OR accessor), `onRemoveAttachment`,
  `onPreviewAttachment`; `onDrop` now returns `boolean | void` — the form-level drop handler
  checks it before the built-in file-attachment handling when attachments config exists
  (needed because the inner form always `stopPropagation`s, which would otherwise swallow
  CtxPack drops). Structurally identical local types only — session-ui imports no app files.
- MODIFY `packages/session-ui/src/v2/components/prompt-input/index.tsx` — renders the context
  attachment chips row (label + estimated tokens + CtxPack icon + remove/preview buttons,
  `aria-live="polite"` region, no fragment text) from the optional view data; absent → nothing
  rendered (existing behavior byte-identical).
- CREATE `packages/app/src/components/prompt-input/context-attachments.tsx` —
  `ContextAttachmentChips` (label + tokens + CtxPack icon, preview + remove buttons,
  keyboard-navigable, aria-live announcements) + `contextAttachmentLimitReached` helper.
  Plain DOM APIs + Solid reactive core (no JSX syntax) so it runs under both Vite and the
  repo's bun test setup (see U3 HANDOFF for the transform rationale).
- CREATE `packages/app/src/components/prompt-input/context-attachments.test.tsx` — 11 tests.
- MODIFY `packages/app/src/components/prompt-input/submit.test.ts` — 9 new tests (below) plus
  two test-infra fixes: `@opencode-ai/ui/toast` mock now also exports `toaster` (the suite was
  broken at base — `@/utils/toast` named-imports it), and `@/utils/toast` is mocked to capture
  toast calls.
- CREATE `packages/app/src/components/prompt-input/HANDOFF-U5.md` — this file.

No other files touched. No git writes. No installs.

## Tests

All from `packages/app` unless noted:

```
$BUN test --conditions=solid --preload ./happydom.ts src/components/prompt-input/context-attachments.test.tsx   # 11 pass
$BUN test --conditions=solid --preload ./happydom.ts src/components/prompt-input/submit.test.ts                # 17 pass (8 pre-existing + 9 new)
$BUN test --conditions=solid --preload ./happydom.ts src/components/prompt-input/                             # 71 pass / 0 fail (whole dir)
$BUN test --conditions=solid --preload ./happydom.ts src/context/ctxpack/drag.test.ts src/context/ctxpack/drop-target.test.tsx src/context/ctxpack/attachment-store.test.tsx  # 42 pass (U3 lane untouched)
cd packages/session-ui && $BUN test src --only-failures                                                       # 83 pass / 0 fail
```

New submit coverage: two ready attachments → request carries the exact mapped
`contextAttachments` array with no text concat and exactly one prompt call; queue and steer
carry the same array; empty attachments → field omitted; custom-command path with attachments
rejects (no command call, toast); shell path rejects (no shell call, toast); error-status
drafts are skipped; failure → `restoreAfterFailure(send-time snapshot)` and no clear; success
→ `clearAfterAdmission`. Chips coverage: label/tokens/icon render, remove/preview callbacks,
button focus order, aria-live present + add announcement, sentinel fragment text never
rendered, reactive re-render, budget helper.

Typecheck: `packages/session-ui` `tsgo --noEmit` — clean (0 errors). `packages/app` `tsgo
--noEmit` — 0 errors in any owned file; remaining errors are pre-existing in other workers'
in-flight ctxpack files (create-dialog.tsx, draft.tsx, selection-overlay.tsx, drop-target
.test.tsx, drag.test.ts — none owned by U5).

Known pre-existing failures NOT caused by U5 (verified at base via `git stash`):
- `src/components/prompt-input/submit.test.ts` failed to load at base (mock missing `toaster`
  export) — fixed in this lane.
- `src/pages/session-surface-base.test.tsx` fails on `solid-js/web` server-build `mount`
  ("Client-only API") — documented in HANDOFF-U3.md as a repo-wide test-setup issue.

## Public exports

- `context-attachments.tsx`: `ContextAttachmentChips`, `ContextAttachmentChipsProps`,
  `contextAttachmentLimitReached(attachments, totalEstimatedTokens)`.
- `submit.ts`: unchanged exports; `PromptSubmitInput` gains optional
  `contextAttachmentStore?: ContextAttachmentStore`; `FollowupSendInput` gains optional
  `contextAttachments?: SessionContextAttachmentInput[]` (both additive).
- session-ui `interaction.ts`: additive types `SessionUiContextAttachmentDraft`,
  `PromptInputV2ContextAttachmentView`; `PromptInputV2ViewConfig` gains optional
  `contextAttachments` (value or accessor), `onRemoveAttachment`, `onPreviewAttachment`;
  `onDrop` return widened to `boolean | void`.
- `PromptInputV2ComposerController` gains `ctxpackTarget`, `ctxpackWorkspaceID`,
  `ctxpackAddCtxPack`, `ctxpackDropDisabled` (getters, additive).

## Central integration actions (listed, NOT done)

- **M1**: mount `ContextAttachmentStoreProvider` + the target-registry provider at the host
  shell (both composers call `useContextAttachmentStore()` / `useMessageContextTargetRegistry()`
  and will throw if absent); wire the real `ctxpack.materialize` facade; hand-mirror the SDK so
  `contextAttachments` reaches the wire (today the generated `OpenCodeClient` serializes only
  declared keys `{id, text, files, agents, metadata, delivery, resume}` — the field is present
  on the request object passed to `api.prompt` but would be stripped at the client layer until
  the SDK mirror lands; the legacy v1 compat shim in `utils/server-compat.ts` also selects
  fields explicitly, so legacy-protocol servers receive nothing); wire real preview actions
  (currently a toast per brief).
- **Q1**: server-side `contextAttachments` schema on the prompt request + snapshot admission.
- **U4/M1**: workspace identity for drop targets: composers pass the focused session's
  `workspaceID` (falls back to `""` when the session isn't loaded yet); the store's own
  `workspaceID` accessor remains authoritative.

## Assumptions

- `contextAttachments` is attached to the request object at the single `api.prompt` admission
  call site shared by steer/queue/idle; the extra field is typed via
  `Parameters<...>[0] & { contextAttachments?: ... }` (no SDK edits, no server-compat edits).
- Snapshot is taken at send time (after worktree/session creation awaits); on failure the
  store's `restoreAfterFailure` returns exactly the send-time set (per the frozen store
  contract). Removals made BEFORE send are excluded from the snapshot; removals made WHILE the
  request is pending are re-added by the restore (frozen store semantics — the brief's "stay
  removed" clause holds for pre-send removals).
- Offline detection uses `navigator.onLine` (no shared connectivity accessor exists in the
  app contexts read for this lane); the store's `offline` rejection remains authoritative.
- v2 chips render inside session-ui from view data (its own minimal markup — session-ui cannot
  import the app's `ContextAttachmentChips`); the app component serves the v1 composer. Both
  satisfy "chips above the input".
- The v2 form always `stopPropagation`s drops when its attachments config exists, so the v2
  drop path goes through `view.onDrop` (returns true for CtxPack payloads) instead of the
  wrapper's own drop listener; the wrapper still registers the target, shows the ring, and
  handles drops landing outside the form.
- Toast copy is literal English (no new i18n keys could be added in this lane): rejection
  toasts surface the stable error code as the description; command rejection uses the brief's
  exact string.

## Known limitations

- Sending still requires text, an image, or a comment — context attachments alone do not
  enable the submit button / Enter (blank computation intentionally untouched per "Enter/
  Queue/Stop keyboard behavior unchanged").
- Preview for v1 and v2 is a toast ("Preview is not available in this view") until M1 wires
  the authorized detail dialog.
- `workspaceID` on the drop target is session-derived and may be `""` while the session record
  loads. Materialization is disabled until a canonical Session target exists.
- When both the v2 file-drop overlay and the CtxPack ring show during a CtxPack drag (the
  global dragover listener keys on `text/plain`, which CtxPack payloads also carry), both
  visual affordances appear; behavior is correct (store dedupes).
- The v1 composer's chips and drop ring rely on the M1-mounted provider; before M1 lands,
  composers throw on mount if the store provider is absent (by design — brief's hook
  consumption rule).

## Prohibited-pattern scan

`rg -n "fragment|selectedText|text_content" packages/app/src/components/prompt-input packages/session-ui/src/v2/components/prompt-input`
→ hits are pre-existing DOM-fragment code (`editor-dom.ts`), pre-existing test names
(`placeholder.test.ts`), and U5 doc comments/tests that explicitly state fragment text is
NEVER rendered. No content-bearing or credential fields were added to any transport: the
request carries only `SessionContextAttachmentInput` (contextCapsuleID, label, contentHash,
source{kind,ctxPackID}); the chips render only `label` + `estimatedTokens` + icon and forward
ids through callbacks.
