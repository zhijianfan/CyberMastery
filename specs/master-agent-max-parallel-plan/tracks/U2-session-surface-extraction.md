# Track U2 — Route-independent Session Surface Extraction

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Session UI

## Mission

Extract the original session page body into a reusable explicit-target base surface while keeping the routed page as a thin adapter.

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

**May begin:** None. Code against the frozen U1 target API; use a temporary local type if U1 has not merged.

**May merge/final-verify after:** U1 before final typecheck; U3 wraps the base surface.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/session-surface-base.tsx`
- `packages/app/src/pages/session-surface-base.test.tsx`

### Modify

- `packages/app/src/pages/session.tsx`

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Move the existing session page surface—messages, composer, terminal, file tree, review/diff panel, and required providers—into `SessionSurfaceBase`.
2. Make the base receive an explicit session target rather than reading the route ID deep in the tree.
3. Turn the routed page into a thin adapter that derives the target from route state and renders the same base.
4. Preserve existing route behavior, loading, navigation, providers, and command semantics.
5. Expose explicit props/slots for queue capability and surface scope without implementing MasterAgent backend logic.
6. Add routed-session regression tests and explicit-target rendering tests.

## Hard boundaries

- This is the only track allowed to edit `packages/app/src/pages/session.tsx`.
- Do not edit prompt-input components.
- Do not register a canvas functionality or call MasterAgent APIs.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/session-surface-base.test.tsx
```

## Completion handoff

Document the final base-surface props consumed by U3.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
