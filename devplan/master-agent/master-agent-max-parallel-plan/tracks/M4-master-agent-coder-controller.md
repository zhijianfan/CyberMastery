# Track M4 — Workspace Coder Settings Controller

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Canvas manager

## Mission

Implement workspace-wide Coder read/update state against the M1 port, independent of presentation and generated clients.

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

**May begin:** None. Use the C0 workspace field contract.

**May merge/final-verify after:** M1 before final typecheck; M6/B2 consume it.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/canvas/master-agent/coder-controller.ts`
- `packages/app/src/pages/canvas/master-agent/coder-controller.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Expose current workspace `coderModel`, enabled state, pending update, error, and retry.
2. Patch the workspace through the manager-owned port; never call SDK methods from UI.
3. Preserve omitted/null semantics and avoid overwriting unrelated workspace fields.
4. Handle multiple MasterAgent blocks observing the same workspace field.
5. Reconcile server-authoritative updates and reject stale optimistic results.
6. Expose permission/model-availability state as inputs rather than duplicating global config/model stores.
7. Add tests for set, clear, concurrent selectors, failure rollback/refetch, and workspace switch.

## Hard boundaries

- No UI components, model ranking, or per-block override.
- No direct generated SDK import.
- Do not mutate layout tuples.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent/coder-controller.test.ts
```

## Completion handoff

Publish a view-model/action interface for B2 and M6.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
