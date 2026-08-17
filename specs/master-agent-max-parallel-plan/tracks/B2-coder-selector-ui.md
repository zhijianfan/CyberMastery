# Track B2 — Workspace Coder Selector UI

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Block UI

## Mission

Create the Coder selector as a controlled presentational component with permission and model-availability states.

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

**May begin:** None. Use the M4 view-model contract from `02-contracts-and-data-model.md`.

**May merge/final-verify after:** M4 before final composition; B3 mounts it.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/canvas/master-agent/coder-selector.tsx`
- `packages/app/src/pages/canvas/master-agent/coder-selector.test.tsx`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Label the control `Workspace Coder` and make workspace-wide scope explicit.
2. Support disabled (`coderModel = null`), selected model, pending save, load error, unavailable model, known tool-incompatible model warning, and `task` permission denied.
3. Allow selecting the same model as primary but show a soft warning.
4. Emit controlled callbacks for set, clear, retry, and model-picker open.
5. Do not rank models or decide routing.
6. Add tests for all states and accessibility/keyboard behavior.

## Hard boundaries

- No SDK or manager import; accept a controlled view model.
- No per-block override.
- Do not change global model-picker implementation unless a reusable hook already exists.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent/coder-selector.test.tsx
```

## Completion handoff

Export the component and exact controlled props for B3.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
