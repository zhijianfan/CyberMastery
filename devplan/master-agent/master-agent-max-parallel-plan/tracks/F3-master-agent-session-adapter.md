# Track F3 — MasterAgent Session Adapter

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Core lifecycle

## Mission

Wrap the existing Session domain operations needed by MasterAgent lifecycle without owning functionality-instance persistence.

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

**May begin:** None. Use the lifecycle adapter contract in `02-contracts-and-data-model.md`.

**May merge/final-verify after:** C1 before typecheck; F4 consumes it.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/core/src/workspace/master-agent-session-adapter.ts`
- `packages/core/test/workspace/master-agent-session-adapter.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Provide operations to create a top-level session in a resolved directory, verify an existing session, inspect idle/busy state, inspect pending-input count, and clean up an unbound empty candidate when safe.
2. Use the repository's normal Session service and identifiers; do not create a parallel session store.
3. Return explicit results for missing, deleted, busy, pending, and cleanup-not-supported states.
4. Preserve old bound sessions during reset.
5. Add tests using fake Session services for creation parameters, idle/pending checks, and losing-candidate cleanup.

## Hard boundaries

- Do not read/write functionality-instance configuration.
- Do not emit events or implement HTTP handlers.
- Do not move queued inputs between sessions.

## Verification

```bash
bun --cwd packages/core typecheck
bun test packages/core/test/workspace/master-agent-session-adapter.test.ts
```

## Completion handoff

Publish the adapter interface and error/result union consumed by F4.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
