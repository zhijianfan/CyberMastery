# Track C0 — Workspace Coder Schema

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Contracts

## Mission

Add the workspace-wide nullable Coder model field to the Effect Schema layer without touching protocol, persistence, or generated clients.

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

**May begin:** None. Use the frozen contract in `02-contracts-and-data-model.md`.

**May merge/final-verify after:** None; C2 later publishes the combined schema exports.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/schema/test/workspace-coder-model.test.ts`

### Modify

- `packages/schema/src/workspace.ts`

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Locate the exact Effect Schema and encoded type used by the existing `Workspace.Info.model` field.
2. Add `coderModel` to `Workspace.Info` with the same model-selection representation and `null` semantics.
3. Add `coderModel?: ModelSelection | null` to the existing workspace patch/update schema.
4. Preserve backward decoding for data that predates the field, following the package's existing defaults/nullable conventions.
5. Add encode/decode tests for `null`, a concrete provider/model selection, omitted patch fields, and explicit clearing.
6. Do not export a new model-selection type; reuse the existing one verbatim.

## Hard boundaries

- Do not edit `packages/schema/src/index.ts`; C2 owns public export composition.
- Do not create SQL columns, migrations, protocol routes, SDK output, or UI.
- Do not add a per-block Coder override or tuple-scoped model field.

## Verification

```bash
bun --cwd packages/schema typecheck
bun test packages/schema/test/workspace-coder-model.test.ts
```

## Completion handoff

Report the exact exported `Workspace.Info` and patch property names and the reused model schema symbol.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
