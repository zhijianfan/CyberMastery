# Track I2 — Canvas Renderer Integration

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `COMPOSITION`  
**Merge lane:** Canvas integration

## Mission

Perform the only shared canvas-renderer edit that registers and renders the completed MasterAgent block.

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

**May begin:** Can inspect mapping/render switch immediately.

**May merge/final-verify after:** D3, B3, and I1.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/canvas/master-agent.integration.test.tsx`

### Modify

- `packages/app/src/pages/canvas/workspace.tsx`

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Add the I1 descriptor/mapping entry to `FUNCTIONALITY_BY_TYPE` or its current equivalent.
2. Render B3 for `builtin:master-agent` while keeping existing `builtin:chat` behavior intact.
3. Pass block identity, focus state, manager, and existing canvas chrome inputs only.
4. Do not place session IDs or authoritative binding state in layout data.
5. Add integration tests for registration, two blocks, focus handover, legacy chat regression, and no session binding in serialized layout.

## Hard boundaries

- This is the only feature track allowed to edit `packages/app/src/pages/canvas/workspace.tsx`.
- Do not call generated SDK methods directly.
- Do not fork the session page.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent.integration.test.tsx
bun --cwd packages/app run build
```

## Completion handoff

Publish the complete app implementation baseline consumed by V3.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
