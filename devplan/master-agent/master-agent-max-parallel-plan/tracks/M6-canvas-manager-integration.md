# Track M6 — Canvas Manager Integration

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `COMPOSITION`  
**Merge lane:** Canvas manager

## Mission

Expose MasterAgent lifecycle, event, and Coder settings through `manager.ts` while preserving the manager/UI boundary.

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

**May begin:** Can identify manager extension points immediately.

**May merge/final-verify after:** M1, M2, M3, M4, and M5.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/canvas/master-agent/manager-integration.test.ts`

### Modify

- `packages/app/src/pages/canvas/manager.ts`

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Instantiate the M5 port and M1 state per manager/workspace.
2. Mount M2 lifecycle commands, M3 EventV2 reconciliation, and M4 Coder settings.
3. Expose a narrow `manager.masterAgent` API consumed by B3.
4. Tie controller disposal to existing manager/workspace lifecycle.
5. Keep Session messages, queue state, terminal state, files, and review state in existing Session subsystems.
6. Add integration tests for two blocks, reconnect, workspace switch, shared Coder field, and disposal.

## Hard boundaries

- This is the only feature track allowed to edit `packages/app/src/pages/canvas/manager.ts`.
- No JSX rendering.
- No direct prompt submission or client-side queue.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent/manager-integration.test.ts
```

## Completion handoff

Publish the final manager API signature for B3.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
