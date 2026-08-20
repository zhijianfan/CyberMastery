# Task N — E2E, reconnect/race, and performance hardening (block-runtime-v3)

**Wave:** 3 · **Depends on:** M (committed `50c17407f` + any later commits by the
integration workstream) · **Owned files:** central E2E/performance tests and
test-only instrumentation under `packages/app/src/pages/canvas/` (test files),
`packages/app/src/test/**`. You may edit PRODUCTION code ONLY for a narrowly
reviewed fix when a test exposes a real defect; otherwise route production
fixes to the owning task in your handoff.

**Do NOT edit:** `workspace.tsx`, `manager.ts`, `runtime/*` (except test
files), `blocks/*` production files, `master-agent/*` production files,
backend packages, generated SDK. Do NOT run `bun run generate`. Do NOT run git
commits.

## Context

The generic BlockRuntimeHost is integrated (Task M, `INTEGRATION-REPORT.md` in
`.opencode/parallel/block-runtime-v3/`). `BLOCK_RUNTIME_V3` gates the unified
runtime; the concurrent integration workstream may have flipped it on. Fixtures
from Task G live in `packages/app/src/test/**` (fake-server-event-bus,
fake-workspace-api, fake-host-binding-port, fake-session-surface-state,
browser-helpers). The current skipped tests are HARNESS-ARTIFACT skips that
must be re-enabled with a solid-native mount helper:
- `blocks/chat-relay/view.test.tsx` — 6 runtime-v2-via-BlockRuntimeHost tests
  skipped (bun test JSX-transform chain cannot bridge solid-transformed host
  JSX to the shim-rendered child).
- `master-agent/block.test.tsx` — 7 transition tests skipped (fake manager's
  `createSignal` transitions don't re-render inside the render-thunk harness;
  real app re-renders fine per e2e trace).

## Required work

1. Re-enable the 13 skipped tests with a store-based fake / solid-native mount
   helper (G's `browser-helpers.ts` may need a mount helper addition). Do NOT
   loosen assertions to make old tests pass; if a test fails for a REAL product
   reason, fix the narrowest production defect and record it.
2. Scenario matrix (use G's fixtures; deterministic — no `setTimeout` sleeps):
   - Workspace lifecycle: missing persisted workspace at startup; workspace
     deleted after connect; dev DB reset while page open; dirty local layout
     during deletion; simultaneous not-found failures; runtime handles remount
     under new workspace epoch.
   - Layout/runtime isolation: apply server layout while ChatRelay assistant
     text streams; move/resize blocks during native session activity; another
     client saves layout; handover/conflict; functionality replacement;
     remove/re-add block.
   - ChatRelay: first add before layout save; existing binding hydration;
     multiple blocks; queue and steer; permission prompt; reconnect during run;
     no duplicate request/event transport; no local session binding.
   - MasterAgent: multiple isolated blocks; Coder shared state; reset
     idle/busy/stale; pending queue survives unmount; full-page target.
   - Event routing: generic `workspace.functionality.instance.changed` event
     invalidates only the matching block; unrelated workspace/block ignored;
     event burst coalescing; reconnect refresh; lower revision ignored;
     listener cleanup after unmount.
   - Local/static blocks: static blocks open no listeners; Notes local view
     persists independently; Voice remains ephemeral; OperatingChat shows no
     fake model response.
   - Network assertions: exactly one app `/api/event` stream; no
     `/api/block-runtime/event` session traffic; no
     `chatgpt.com/backend-api/conversation`; one prompt request per action.
   - Performance: at least 12 mixed blocks; no more than one global event
     listener plus required native stores; no per-block polling; no per-event
     full snapshot; interaction responsive while one session streams; collect
     mount/refresh/render counts.
3. Outputs: machine-readable test report (`TEST-REPORT.md`), network trace
   summary, localStorage schema snapshot, listener/ref-count leak report,
   performance measurements, list of known non-blocking limitations.
4. Create `tasks/N.md`-adjacent `HANDOFF-N.md` with: files changed, tests run +
   exact results, production fixes made (if any), integration actions for O,
   prohibited-pattern grep result.

## Verification

- `cd D:/OpencodeDev/packages/app` then (bun is at
  `~/.bun-npm/node_modules/@oven/bun-windows-x64/bin/bun.exe`):
  `bun.exe test --conditions=browser --preload ./happydom.ts <test files>`
- `bun.exe run typecheck` from `packages/app` (report errors in files you do
  not own as pre-existing/in-flight; do not fix them).

## Exit gate

All critical scenarios pass; the 13 previously-skipped tests are re-enabled
and green (or each failure is classified product-vs-harness with evidence).
