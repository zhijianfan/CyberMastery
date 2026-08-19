# Task G — Tests, Harness Repair, Regression Matrix (worker 7 of 8)

You are worker 7 of 8. Implement ONLY this task.
- Edit ONLY the files listed as your owned files. Never touch other files, shared configs, lockfiles, or generated code.
- Read any existing code you need first; follow the repo conventions (bun workspace, .js import suffixes, AGENTS.md style).
- Do not run repo-wide builds, typechecks, or tests — the master integrates and tests. A quick targeted check of your own code is allowed.
- Do not wait for, check on, or communicate with other workers.
- When done, reply with: files changed, what was implemented, what was left undone or uncertain.

## Owned files (create/edit; touch nothing else)
- `packages/app/src/pages/canvas/master-agent.e2e.test.tsx`
- `packages/app/src/test/block-runtime-events.ts` (new; create the dir)

## Context
The canvas e2e file currently runs 12 tests: **3 pass / 9 fail** (baseline log:
`D:\OpencodeDev\.opencode\parallel\block-runtime\baseline-e2e.log`). The 9
failures are the pre-existing stale-harness "real renderer" group; the 3 passing
tests are the "real block renderer, local fake manager" group. Your job: build
deterministic Block Runtime test fixtures and regression tests, and repair ONLY
the minimum stale mock/serverSDK mismatch needed to exercise the new runtime
contracts. Never "fix" production code to make tests easier — production
behavior changes belong to their owning tracks.

## Inspect first (read-only)
- `packages/app/src/pages/canvas/master-agent.e2e.test.tsx` — harness patterns,
  the fake manager, serverSDK mocks, `buttonByText` helper.
- `packages/app/src/pages/canvas/master-agent/*` — what the tests fake.
- The baseline log above to know exactly which tests fail today.
- Track D/E contracts (pinned shapes): BlockDescriptor, RuntimeResourceBinding,
  RuntimeEventEnvelope (cursor, revision?, timestamp, resource {type,id,parentID?},
  event, data), RuntimeSnapshot, RuntimeResourceState (connection,
  authByProvider, sessionsByID, messagesByID, partsByID, permissionsByID),
  ChatRelayCommand. Full field list is pinned in tasks/A.md — mirror the fields
  you script.

## What to implement

1. `packages/app/src/test/block-runtime-events.ts` — a deterministic fake event
   source (pure functions, scripted sequences, NO network): can emit
   - auth transitions (missing → awaiting-login with loginURL/userCode → ready),
   - session busy/idle,
   - message creation (user + assistant shells),
   - incremental text parts (streaming deltas),
   - permission request + resolve,
   - disconnect/resume,
   - duplicate, stale, and SKIPPED cursors.
   Export small builders so test files compose scenarios.
2. In `master-agent.e2e.test.tsx`:
   - Repair only the minimum stale mock/serverSDK mismatch needed so new
     runtime-contract scenarios can run. Document each repair in a comment;
     do NOT silently rewrite unrelated pre-existing failures. If the 9
     "real renderer" failures are harness-level and unrelated to your work,
     leave them and note it — the master compares against the baseline.
   - Add e2e scenarios (where the harness allows; use your fake source):
     block mounts before login → device login completes while mounted →
     session created and bound → prompt streams a response → layout refresh
     occurs mid-stream (runtime state survives) → two blocks observe one
     session → one block unmounts while the other continues → connection drops
     and recovers → page refresh rehydrates session → permission request
     answered → backend error renders WITHOUT wiping history.
   - Add regression tests proving: (a) `applyServerLayout()` does not alter
     runtime resources; (b) `recordToBlock()` no longer writes
     `relay: "uninitialized"`. Import the real functions if exported; if not,
     test through the public manager/render path.
   - Add a serialization assertion so tests FAIL if runtime state is
     reintroduced into canvas descriptors (descriptor JSON must not contain
     auth/session/message fields).
   - Where a scenario depends on Tracks D/E files that may not exist yet
     (runtime store, chat-relay adapter), write the test to import them lazily
     and skip-with-reason if absent — the master runs the full matrix after
     integration. Do NOT import non-existent modules at file top level.

## Do not touch
- ALL production files (`workspace.tsx`, `manager.ts`, `blocks/chat-relay/**`,
  `canvas/runtime/**`, `app/src/state/**`, `canvas.css`, server/protocol/core
  packages). You may only read them.

## Acceptance
- `bun test --conditions=browser src/pages/canvas/master-agent.e2e.test.tsx`
  from `packages/app` (you may run this) shows: the 3 baseline-passing tests
  still pass, your new scenarios pass or skip-with-reason, and any remaining
  failures are explicitly identified as pre-existing in your report.
- `packages/app/src/test/block-runtime-events.ts` is pure and deterministic.
- Report: files changed, implemented, pre-existing failures left alone, uncertain.
