# Track C2 — Schema Export Integration

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `COMPOSITION`  
**Merge lane:** Contracts

## Mission

Publish the C0 and C1 contracts through the schema package's public entry points with no semantic changes.

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

**May begin:** Can prepare immediately, but final verification requires C0 and C1.

**May merge/final-verify after:** C0 and C1.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/schema/test/master-agent-public-exports.test.ts`

### Modify

- `packages/schema/src/index.ts`

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Export the MasterAgent module through the existing schema barrel convention.
2. Confirm the workspace schema already exposes `coderModel` through its existing public namespace.
3. Add a public-import test that imports all symbols through the package entry point rather than a deep source path.
4. Resolve naming collisions only by aliases that preserve the contract names documented in C0/C1.
5. Run the schema package typecheck after rebasing both leaf commits.

## Hard boundaries

- Do not modify the field types or request/event semantics.
- Do not add protocol or SDK code.
- Keep this commit restricted to export composition and its test.

## Verification

```bash
bun --cwd packages/schema typecheck
bun test packages/schema/test/master-agent-public-exports.test.ts
```

## Completion handoff

Tag the resulting commit as the schema contract baseline used by all later integration branches.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
