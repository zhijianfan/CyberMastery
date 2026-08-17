# Track M2 — MasterAgent Lifecycle Controller

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Canvas manager

## Mission

Implement get/ensure/reset command orchestration against the M1 port without importing the generated SDK.

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

**May begin:** None. Use M1's frozen interface; duplicate only a temporary type-only stub if necessary.

**May merge/final-verify after:** M1 before final typecheck; M6 composes it.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/canvas/master-agent/lifecycle-controller.ts`
- `packages/app/src/pages/canvas/master-agent/lifecycle-controller.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Deduplicate simultaneous ensure calls per workspace/block.
2. Abort or ignore stale responses after workspace switch, block removal, or newer binding revision.
3. Dispatch reducer actions for loading, ready, errors, permission denied, and stale conflict.
4. Reset only when client projection says idle/no pending, while still relying on host enforcement.
5. Pass expected session ID and revision exactly.
6. Refetch authoritative binding after reconnect or conflict.
7. Add tests for ensure dedupe, stale response suppression, retry, reset conflict, and cancellation.

## Hard boundaries

- No generated SDK imports or `manager.ts` edits.
- No session-message or queue reducer.
- No Coder settings logic.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent/lifecycle-controller.test.ts
```

## Completion handoff

Expose controller methods and disposal hooks for M6/B3.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
