# Track D4 — Workspace Service Integration

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `COMPOSITION`  
**Merge lane:** Core persistence

## Mission

Perform the single shared-file integration that exposes `coderModel` through workspace persistence and registers the MasterAgent built-in.

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

**May begin:** Can inspect immediately; final implementation requires D1, D2, and D3.

**May merge/final-verify after:** C0, D1, D2, and D3.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/core/test/workspace/workspace-coder-model.integration.test.ts`

### Modify

- `packages/core/src/workspace/service.ts`

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Wire the D2 codec into workspace creation, row reads, full info projection, and patch/update handling.
2. Preserve omission semantics: an omitted patch leaves the field unchanged; explicit null clears it.
3. Add the D3 descriptor to the existing `builtins` array exactly once.
4. Do not inline lifecycle or Coder-routing logic into the workspace service.
5. Add an integration test that creates, reads, updates, clears, and reloads the workspace field while preserving unrelated fields.

## Hard boundaries

- This is the only track allowed to edit `packages/core/src/workspace/service.ts`.
- Do not edit migrations, schema contracts, protocol, or generated SDK.
- Do not add MasterAgent session lifecycle methods here; F4 owns them.

## Verification

```bash
bun --cwd packages/core typecheck
bun test packages/core/test/workspace/workspace-coder-model.integration.test.ts
```

## Completion handoff

Publish a commit that F4, S2, R1, and V1 can consume without further workspace-service edits.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
