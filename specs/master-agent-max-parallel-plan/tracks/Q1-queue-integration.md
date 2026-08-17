# Track Q1 — Queue Integration Adapter and Tests

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Block UI

## Mission

Wire the embedded Session surface to the existing host-side queue semantics without changing either composer implementation.

## Feature invariants

- `builtin:master-agent` embeds the existing Session surface; it does not create a second chat implementation.
- The host functionality instance owns the authoritative Session binding. Canvas layout owns presentation only.
- Queue delivery uses the existing host admission path with `delivery: "queue"`; no client holding queue is allowed.
- `workspace.coderModel` is nullable and workspace-wide in v1.
- Enabled Coder mode delegates coding execution to a host-created child Session; the primary remains on the workspace model.
- The host—not the browser or model—chooses child model, directory, parent, workspace, agent, and permissions.
- No silent fallback to the primary model is permitted.
- Existing routed Session pages, ordinary Sessions, and `builtin:chat` must remain compatible.

## Start and merge dependencies

**May begin:** None. Use the U3 surface option contract and existing composer APIs.

**May merge/final-verify after:** U3 before final typecheck; B3 consumes the options.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/canvas/master-agent/session-options.ts`
- `packages/app/src/pages/canvas/master-agent/queue.test.tsx`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Define the canvas/MasterAgent session-surface options that enable the existing Queue action.
2. Verify a busy embedded session invokes the existing `handleSubmit(event, "queue")` path and sends `delivery: "queue"` immediately to the host.
3. Verify steer behavior remains unchanged.
4. Verify admitted/promoted projection comes from existing Session events/state.
5. Add a static/test assertion that no block-local/browser holding queue is created.
6. Test remount with a pre-existing host-projected queued input.

## Hard boundaries

- Do not edit `packages/app/src/components/prompt-input.tsx`.
- Do not edit `packages/session-ui/src/v2/components/prompt-input/**`.
- Do not add timers, IndexedDB/localStorage queue state, or delayed submission.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent/queue.test.tsx
! rg 'localStorage|indexedDB|setTimeout|followupQueue|clientQueue' packages/app/src/pages/canvas/master-agent
```

## Completion handoff

Export one options factory/object for B3.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
