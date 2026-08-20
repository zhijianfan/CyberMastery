You are worker 7 of 7 (Wave 1) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task G — Deterministic test harness and fixtures

Goal: replace stale/timing-dependent canvas tests with deterministic fixtures
every product track (C/D/E/F/H/I) reuses. Repair the stale central E2E harness
enough that failures reflect production behavior, not mock-shape drift.

## Current baseline facts

- `bun test --conditions=browser src/pages/canvas/master-agent.e2e.test.tsx`
  currently fails AT MODULE LOAD (0 pass / 1 fail): the import graph resolves
  `solid-js/web` to the server build (`Export named 'use' not found in
  solid-js/web/dist/server.js`) when `src/context/server-sdk.tsx` is loaded.
  Earlier in the day the same file ran 16 tests (3 pass / 13 fail — 9 stale
  real-renderer failures). Your job: make the harness load and the runtime
  scenarios deterministic; real-renderer failures may be honestly recorded as
  pre-existing/outside-plan, but the harness must LOAD and new runtime tests
  must run deterministically.

## Required fixtures (NEW, under packages/app/src/test/)

1. `fake-server-event-bus.ts` — `createFakeServerEventBus()`:
   synchronous emit; pause/resume/disconnect/reconnect; event IDs/revisions;
   listener-count assertions; `listen`/`start` surface matching the real
   `serverSDK().event` API shape (see inlined usage).
2. `fake-workspace-api.ts` — list/get/create + layout get/save; delete/reset
   current workspace; conflict/handover/not-found injection.
3. `fake-host-binding-port.ts` — get/ensure/reset; CAS revision; busy/stale.
4. `fake-session-surface-state.ts` — messages/tool/permission/status signals
   with no network calls.
5. `browser-helpers.ts` — mount canvas with explicit block descriptors; inspect
   localStorage descriptor vs view-state keys; flush microtasks/RAF without
   sleeps (queueMicrotask + animation-frame flushing helper); count prompt
   requests.

## Required work

- Repair the central E2E harness (`packages/app/src/pages/canvas/master-agent.e2e.test.tsx`):
  first make the module LOAD under bun (fix the solid-js/web server-build
  resolution — e.g. preload `./happydom.ts` plus any import re-ordering needed;
  do not weaken assertions). Keep the existing passing scenario tests; convert
  timing-based waits to deterministic fixtures.
- Add ONE example deterministic test per production track, importing the
  fixture layer: event-router invalidation (C shape), host mount/dispose
  (D shape), workspace recovery (E shape), session-binding ensure (F shape).
  These example tests live under `packages/app/src/test/` and only consume the
  public APIs those tracks will ship; if a track's API is not yet on disk, write
  the test against the FROZEN interface names from the contract doc and mark it
  `// @skip pending-<track>`.
- Do NOT edit production code outside the e2e file. Record pre-existing
  failures that are outside this plan in HANDOFF-G.

## Owned files (edit ONLY these)

- `packages/app/src/test/fake-server-event-bus.ts` (NEW)
- `packages/app/src/test/fake-workspace-api.ts` (NEW)
- `packages/app/src/test/fake-host-binding-port.ts` (NEW)
- `packages/app/src/test/fake-session-surface-state.ts` (NEW)
- `packages/app/src/test/browser-helpers.ts` (NEW)
- `packages/app/src/test/track-examples.test.ts` (NEW)
- `packages/app/src/pages/canvas/master-agent.e2e.test.tsx` (harness repair only)
- `packages/app/src/test/HANDOFF-G.md`

Do NOT edit any other production file.

## Targeted validation (allowed)

- `cd packages/app && bun test --conditions=browser --preload ./happydom.ts src/test/track-examples.test.ts`
- `cd packages/app && bun test --conditions=browser src/pages/canvas/master-agent.e2e.test.tsx`

## Handoff

`HANDOFF-G.md`: fixture import paths + one usage example each · the exact
harness repair applied · updated e2e baseline (pass/fail counts with honest
pre-existing list) · integration actions M must take · prohibited-pattern grep
result.
