# Track M1 — MasterAgent Client Domain and Reducer

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Canvas manager

## Mission

Create SDK-independent client types, backend port, and pure binding reducer.

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

**May begin:** None. Use C1/P2 contracts from `02-contracts-and-data-model.md`.

**May merge/final-verify after:** C2 before replacing any local aliases; M2–M5 consume this module.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/canvas/master-agent/types.ts`
- `packages/app/src/pages/canvas/master-agent/port.ts`
- `packages/app/src/pages/canvas/master-agent/reducer.ts`
- `packages/app/src/pages/canvas/master-agent/reducer.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Define the narrow `MasterAgentPort`: get, ensure, reset, and workspace Coder patch/read methods.
2. Define per-block client state: uninitialized, loading, ready, recoverable error, permission denied, stale, and unavailable.
3. Implement a pure reducer for persisted binding snapshots and transient binding-update events.
4. Ignore duplicate/older revisions and accept newer revisions deterministically.
5. Treat events as hints; include a reconnect/refetch action.
6. Add reducer tests for out-of-order events, duplicate events, block removal/remount, stale reset response, and workspace switch.

## Hard boundaries

- No generated SDK imports.
- No edits to `manager.ts`.
- No UI rendering or host queue state.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent/reducer.test.ts
```

## Completion handoff

Publish the port and reducer API used by M2–M6 and B3.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
