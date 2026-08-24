# Handoff I — MasterAgent runtime registration (+ block test classification)

Status: archived/superseded 2026-08-24. The registration is wired into the
canonical runtime table and the shared session surface is live. Current active
browser/integration coverage replaces the historical skipped-harness status
and the integration actions below are no longer pending.

Executor: integration master. Two worker attempts (flash-free + spark) did not
complete the track: attempt 1 was killed by the Wave-2 restart; attempt 2 made
no source edits (it spent the run diagnosing pre-existing block.test.tsx
crashes). Master completed the track.

## Files

- `packages/app/src/pages/canvas/master-agent/runtime-registration.ts` (NEW) —
  `masterAgentRuntimeRegistration`: mode "native", resolves via
  `createMasterAgentSdkPort(...).ensure`, select → `MasterAgentView`
  { status, sessionID, directory, coder, queueEnabled }, dispatch routes
  ensure/retry → ensure, reset → reset (expectedSessionID + revision),
  coder.set/clear → workspace.update coderModel patch.
- `packages/app/src/pages/canvas/master-agent/runtime-registration.test.ts`
  (NEW) — 3 tests (mode/functionality, resolve+select projection, dispatch
  routing).
- `packages/app/src/pages/canvas/master-agent/block.test.tsx` — harness fix:
  mocked `../session-surface-providers` (pass-through, same pattern as the
  e2e) — the block's providers wrapper previously crashed all 11 tests with
  "Server context must be used within a context provider".

## block.test.tsx classification (11 tests)

| Verdict | Count |
|---|---|
| ✅ pass | 4 (mount-time behavior: ensure-once, loading status, busy queue, mount-with-ready) |
| ⏭️ skip | 7 transition tests — HARNESS ARTIFACT: the fake manager's `createSignal` transitions do not re-render the block inside the render-thunk harness (verified via render probe: `block-render` logged twice, never after `fake.setState`). The REAL app transitions re-render fine — e2e real-renderer trace shows `shell-render uninitialized → loading → ready`. Re-enable in Task N with a store-based fake. |

## Validation

- `bun test --conditions=browser --preload ./happydom.ts src/pages/canvas/master-agent/block.test.tsx` → 4 pass, 7 skip, 0 fail
- `bun test src/pages/canvas/master-agent/runtime-registration.test.ts` → 3 pass
- `bun run typecheck` (packages/app) → clean

## Integration actions for M

1. Wire `masterAgentRuntimeRegistration` into the host in workspace.tsx
   (registration map keyed by "builtin:master-agent").
2. Wire the host's sessionBusy/queue feed (registration view queueEnabled is
   currently static false — busy comes from the session execution feed).
3. Task N: re-enable the 7 skipped transition tests with a store-based fake.
