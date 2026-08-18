# Track B3 — MasterAgent Block Composition

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `COMPOSITION`  
**Merge lane:** Block UI

## Mission

Compose the manager API, block shell, Coder selector, queue options, and canvas session surface into one ready-to-register block component.

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

**May begin:** Can scaffold against frozen props immediately.

**May merge/final-verify after:** U3, M6, B1, B2, and Q1.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/canvas/master-agent/block.tsx`
- `packages/app/src/pages/canvas/master-agent/block.test.tsx`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Read binding and actions only through `manager.masterAgent`.
2. Call ensure on mount through the lifecycle controller and render B1 states.
3. Pass the bound session ID into U3's canvas session surface.
4. Pass Q1 queue options; do not submit prompts through the manager.
5. Bind B2 to M4's workspace-wide Coder view model/actions.
6. Scope reset to the current block and forward expected binding values through M2.
7. Handle removal/unmount without deleting or cancelling the host session.
8. Add component tests for loading→ready, retry, event rebinding, Coder update, reset disabled, and two-block isolation.

## Hard boundaries

- No direct SDK imports.
- No edits to `manager.ts`, `workspace.tsx`, prompt input, or Session stores.
- No client-side session creation or queue.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent/block.test.tsx
```

## Completion handoff

Export a single MasterAgent block renderer consumed by I2.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
