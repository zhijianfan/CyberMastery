# Task F — Canvas Descriptor Ownership + Migration (worker 6 of 8)

You are worker 6 of 8. Implement ONLY this task.
- Edit ONLY the files listed as your owned files. Never touch other files, shared configs, lockfiles, or generated code.
- Read any existing code you need first; follow the repo conventions (bun workspace, .js import suffixes, solid-js stores, AGENTS.md style).
- Do not run repo-wide builds, typechecks, or tests — the master integrates and tests. A quick targeted check of your own code is allowed.
- Do not wait for, check on, or communicate with other workers.
- When done, reply with: files changed, what was implemented, what was left undone or uncertain.

## Owned files (you are the ONLY track allowed to broadly edit these)
- `packages/app/src/pages/canvas/workspace.tsx`
- `packages/app/src/pages/canvas/manager.ts`

## Context
You fix the state-ownership defect: canvas blocks must persist ONLY layout,
durable config, and resource bindings (e.g. `sessionID`) — never runtime auth/
session/message state. Today `relay: "uninitialized"` is synthesized when
`recordToBlock()` rebuilds blocks from server records during
`applyServerLayout()`, which wipes live runtime state mid-stream.

Find the sites with `grep -n relay packages/app/src/pages/canvas/workspace.tsx`:
- `CanvasBlock` interface field `relay: RelayBlockState` (+ the
  `RelayBlockState` type).
- `legacyBlock()` — `relay: "uninitialized"`.
- `blockOf()` — `relay: "uninitialized"`.
- localStorage hydration — `relay: block.relay ?? "uninitialized"`.
- **`recordToBlock()` — `relay: "uninitialized"`** (the culprit; called from
  `applyServerLayout()`).
- `manager.disposeRelay()` call on chat-relay block removal.

## Inspect first (read-only)
- `packages/app/src/pages/canvas/manager.ts` — layout sync, `applyServerLayout`,
  conflict resolution, `noteLocalEdit`, persistence.
- Server layout APIs: `packages/protocol/src/groups/workspace.ts`,
  `packages/server/src/handlers/workspace.ts` (or wherever v2.workspace layout
  endpoints live) — READ ONLY, to learn how layout records and bindings persist.
- `packages/server/src/handlers/chat-relay-session.ts` — how blockID→sessionID
  bindings persist server-side today (ensure/get/reset).
- `packages/app/src/pages/canvas/master-agent/block.tsx` — how the master-agent
  block persists its sessionID binding; reuse the SAME mechanism for ChatRelay.

## What to implement

1. Remove `relay: "uninitialized"` synthesis from `recordToBlock()` and stop
   storing relay runtime state on the block. Decide the fate of the
   `CanvasBlock.relay` field: remove it (preferred — check every reader first;
   `manager.ts` may read it, `canvas.css` may style it) or keep it only if the
   operating-chat/legacy path genuinely needs it. `RelayBlockState` type: delete
   if unreferenced after your change.
2. Make `applyServerLayout()` update ONLY descriptor-owned fields: identity,
   functionality, transform (x/y/w/h/z), config, and bindings. It must not
   reset `messages`/`relay`/runtime-ish fields; verify the hydration path in
   `manager.ts` does the same.
3. Add a descriptor binding-update operation that persists a NEW `sessionID`
   (and later other bindings) WITHOUT replacing runtime resources — follow the
   master-agent binding persistence pattern (see inspect list). This is how
   Track C's "created session" result reaches the canvas layer.
4. Lazy migration for existing/old-format records: on load, ignore copied
   runtime state (old `relay` fields), preserve durable config, bind an
   OpenCode session when the user next initializes or submits, and write only
   the new descriptor form on next save. Old blocks must NOT crash.
5. Ensure the layout sync/conflict path cannot delete or recreate a live block
   because a runtime event arrived (the MasterAgent disappearing-block
   regression must not come back — read the master-agent block's binding
   handling to see how it survives `applyServerLayout`).
6. Block removal semantics: removing a ChatRelay block releases its UI
   subscription but must NOT delete the underlying session (unless existing
   master-agent semantics already differ — mirror them).
7. Do NOT add a compatibility `block.relay` accessor unless old code still
   reads it — and if you must, mark it for deletion at integration.

## Do not touch
- `blocks/chat-relay/**` (Track E owns), `canvas/runtime/**` and
  `app/src/state/**` (Track D), `canvas.css` (Track E), `master-agent/**`,
  `master-agent.e2e.test.tsx` (Track G), `session-surface.tsx`, server/protocol
  packages.

## Acceptance
- Layout sync during active streaming changes only layout fields.
- `recordToBlock()` cannot synthesize auth/session runtime state (no
  `relay: "uninitialized"` anywhere it is not a legitimately local default).
- A persisted `sessionID` survives save/load and reconnects the block to the
  correct session.
- Existing old-format blocks migrate lazily without crashing.
- `packages/app` still typechecks as far as your files are concerned (you may
  run a targeted check of the app package — it has other in-flight tracks, so
  ignore errors in files you do not own).
- Report: files changed, implemented, uncertain.
