You are worker 7 of 7 (Wave 1, CONTINUATION) in the block-runtime-v3 run at
D:\OpencodeDev (branch feature/CyberMaster). Your previous run hit a model
usage limit mid-edit. Finish ONLY the remaining harness work listed here.
Do not read files outside the owned list. Do not search. Write now.

## Current state (verified by the master)

- Your fixtures exist: `packages/app/src/test/{block-runtime-events.ts,
  browser-helpers.ts, fake-host-binding-port.ts, fake-server-event-bus.ts,
  fake-session-surface-state.ts, fake-workspace-api.ts, track-examples.test.ts}`.
- The central e2e file `packages/app/src/pages/canvas/master-agent.e2e.test.tsx`
  NOW LOADS and runs 16 tests (your repair worked): **3 pass / 13 fail**.
- The 13 failures: 9 are the pre-existing "real renderer" harness group
  (Language/provider crash — the group that also hosts 1 pre-existing
  regression test from the earlier block-runtime run), plus 4 others that must
  be either FIXED or cleanly diagnosed. Run the file yourself first and
  classify each failure into: (a) harness infrastructure (real renderer group
  mounting the full app — mark with `// KNOWN-HARNESS: reason` and SKIP via
  test.skip with an explanatory message), (b) fixable test bug (fix it),
  (c) real product regression (report it, do NOT hide it).

## HARD PROHIBITIONS

- Do NOT edit `packages/app/src/pages/canvas/master-agent.integration.test.tsx`
  — it is being edited by a concurrent workstream and is NOT yours. It
  currently has transient type errors; leave it exactly as it is.
- Do NOT edit workspace.tsx, manager.ts, blocks/chat-relay/**, runtime/*.ts
  (except files you created), master-agent/lifecycle-controller.ts (your
  9-line addition there must be REVERTED unless your e2e genuinely requires
  it — if it does, keep it and list it in the handoff).
- Do NOT touch packages/protocol, packages/server, packages/core, generated
  SDK files. Do NOT run `bun run generate`.

## Deliverables

1. **Complete `master-agent.e2e.test.tsx` repair**: every non-real-renderer
   test either passes or is `test.skip`ped with a one-line reason. The
   real-renderer group: keep its tests but make the harness failure EXPLICIT —
   wrap the group's mount helper so the Language/provider crash is reported as
   a skip reason ("real renderer harness unavailable under bun browser
   conditions: <actual error>") instead of a red failure.
2. **Finish fixture typing**: your `fake-*.ts` files must not introduce
   typecheck errors into packages/app. `bun run typecheck` from packages/app
   must show errors ONLY in `master-agent.integration.test.tsx` (not yours —
   leave it).
3. **`packages/app/src/test/HANDOFF-G.md`**: files changed, e2e classification
   table (test name → fixed/skipped/reported + reason), tests run + exact
   results, fixtures exported per fixture, integration actions for M.

## Validation (allowed)

- `cd packages/app && bun test --conditions=browser --preload ./happydom.ts src/pages/canvas/master-agent.e2e.test.tsx src/test/track-examples.test.ts`
- `bun run typecheck` from packages/app (report only; ignore the integration.test.tsx errors)

## Inlined context

The e2e file is long; you created most of its fixtures. Only these anchors are
inlined: the current failing-test output structure you'll classify. Re-read
ONLY your own files as needed (they are yours).
