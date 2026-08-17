# Track M3 — MasterAgent Event Reconciliation

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Canvas manager

## Mission

Implement binding-update EventV2 subscription and reconnect reconciliation against M1 state.

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

**May begin:** None. Use the C1 event contract and M1 reducer API.

**May merge/final-verify after:** M1 before final typecheck; M6 mounts it.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/canvas/master-agent/event-reconciliation.ts`
- `packages/app/src/pages/canvas/master-agent/event-reconciliation.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Filter `workspace.master-agent.binding.updated` by active workspace and known block.
2. Dispatch only newer binding revisions.
3. On reconnect, call the provided refetch/ensure hook because events may have been missed.
4. Handle event-before-block-mount and block-before-event order without creating sessions client-side.
5. Dispose subscriptions on workspace change and manager destruction.
6. Add tests for duplicate, out-of-order, wrong-workspace, removed-block, reconnect, and delayed-mount cases.

## Hard boundaries

- Do not edit the global manager/event subsystem.
- Do not persist events or bindings locally.
- Do not subscribe to session queue events; the Session UI already owns them.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent/event-reconciliation.test.ts
```

## Completion handoff

Export a small attach/detach function for M6.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
