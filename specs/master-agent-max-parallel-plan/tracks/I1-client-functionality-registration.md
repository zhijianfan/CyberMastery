# Track I1 — Client Functionality Descriptor

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Canvas integration

## Mission

Create the client-side descriptor and mapping metadata for `builtin:master-agent` without editing the shared canvas renderer.

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

**May begin:** None. Use the literal C1 functionality ID.

**May merge/final-verify after:** C1 before typecheck; I2 registers the descriptor.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/canvas/master-agent/functionality.ts`
- `packages/app/src/pages/canvas/master-agent/functionality.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Define the client descriptor for `builtin:master-agent` using existing canvas functionality conventions.
2. Map the intended block type to the functionality ID without adding rendering logic.
3. Declare addable/default metadata consistent with the current registry.
4. Keep `builtin:chat` unchanged and do not auto-migrate existing layouts.
5. Add tests for literal ID, type mapping, and no collision with existing built-ins.

## Hard boundaries

- Do not edit `workspace.tsx`; I2 owns shared registration.
- Do not import backend services or generated SDK.
- Do not render the block.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent/functionality.test.ts
```

## Completion handoff

Export the descriptor/mapping entry for I2.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
