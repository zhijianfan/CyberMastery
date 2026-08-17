# Track B1 — MasterAgent Presentational Shell

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Block UI

## Mission

Build the backend-independent MasterAgent block shell, status panels, chrome actions, and styles.

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

**May begin:** None. Use the prop contract in this file.

**May merge/final-verify after:** B3 composes it.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/canvas/master-agent/block-shell.tsx`
- `packages/app/src/pages/canvas/master-agent/status-view.tsx`
- `packages/app/src/pages/canvas/master-agent/master-agent.css`
- `packages/app/src/pages/canvas/master-agent/block-shell.test.tsx`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Provide slots for the session surface and Workspace Coder selector.
2. Render loading, ready, recoverable error, permission denied, missing/unavailable session, and reset-disabled states.
3. Expose callbacks for focus, retry, reset, and open-full-page without owning behavior.
4. Fit existing canvas card chrome and preserve the full session surface area.
5. Show reset disabled reason for busy/pending state.
6. Add tests for every state, slot, callback, focus styling, and absence of backend calls.

## Hard boundaries

- No manager, SDK, Session API, queue, or workspace patch calls.
- Do not edit `workspace.tsx`.
- Do not implement the Coder selector itself.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent/block-shell.test.tsx
```

## Completion handoff

Export presentational components and prop types for B3.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
