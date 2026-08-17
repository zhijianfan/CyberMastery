# Track D2 — Workspace Coder Persistence Codec

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Core persistence

## Mission

Isolate the row/domain conversion and patch semantics for `coderModel` in a new helper so the shared workspace service needs only a small integration edit.

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

**May begin:** None. Code against the frozen C0 contract and the existing `model` codec.

**May merge/final-verify after:** C0 and D1 before D4 integrates it.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/core/src/workspace/coder-model-codec.ts`
- `packages/core/test/workspace/coder-model-codec.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Extract or wrap the existing model-selection serialization pattern without changing existing `model` behavior.
2. Provide small functions for SQL row → domain, domain → SQL, patch omission, explicit null clearing, and selected-model persistence.
3. Ensure malformed stored values follow the repository's existing error strategy rather than silently changing models.
4. Add focused tests for omitted patch, null, concrete selection, and round-trip fidelity.
5. Expose a narrow API that D4 can call from workspace create/read/patch paths.

## Hard boundaries

- Do not edit SQL schema/migrations or `workspace/service.ts`.
- Do not introduce a second model selection representation.
- Do not add business rules about whether one model is weaker than another.

## Verification

```bash
bun --cwd packages/core typecheck
bun test packages/core/test/workspace/coder-model-codec.test.ts
```

## Completion handoff

Document the helper functions and the one-line service call sites D4 must add.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
