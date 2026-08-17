# Track F1 — Functionality Instance Repository

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Core lifecycle

## Mission

Provide a narrow, revision-aware repository abstraction for resolving and updating a functionality instance keyed by workspace, block, and functionality ID.

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

**May begin:** None. Use the repository contract in `02-contracts-and-data-model.md`.

**May merge/final-verify after:** D1 if new SQL support is needed; F4 consumes the repository.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/core/src/functionality/instance-repository.ts`
- `packages/core/src/functionality/instance-repository-sql.ts`
- `packages/core/test/functionality/instance-repository.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. First inspect existing functionality-instance persistence and wrap it rather than duplicating it.
2. Expose get-or-create, read, compare-and-swap configuration update, tombstone/active lookup, and revision operations.
3. Key every operation by `(workspaceID, blockID, functionalityID)` and reject cross-workspace mismatches.
4. Make CAS failure distinguishable from not-found and validation errors.
5. Keep the repository generic; it must not know Session semantics.
6. Add tests for revision changes, stale CAS rejection, idempotent get/create, and tombstoned instances.

## Hard boundaries

- Do not edit migration files; D1 owns SQL changes.
- Do not create sessions or emit MasterAgent events.
- Do not store state in canvas layout JSON.

## Verification

```bash
bun --cwd packages/core typecheck
bun test packages/core/test/functionality/instance-repository.test.ts
```

## Completion handoff

Document the repository interface and concrete adapter constructor required by F4.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
