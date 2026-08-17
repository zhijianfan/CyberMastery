# Track U1 — Session Target and Scope Primitives

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Session UI

## Mission

Create explicit session-target and per-surface scope primitives without editing the routed session page.

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

**May begin:** None.

**May merge/final-verify after:** U2/U3 consume the primitives.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/canvas/session-target.tsx`
- `packages/app/src/pages/canvas/session-scope.tsx`
- `packages/app/src/pages/canvas/session-target.test.tsx`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Define an explicit target containing session ID plus the minimum directory/workspace context required by existing providers.
2. Define a stable per-surface instance/scope ID and focused-state contract.
3. Provide helpers for scoped DOM IDs, portals, keyboard ownership, composer focus, terminal mounts, and review panel identity.
4. Avoid creating duplicate Session stores; these primitives identify an existing host session.
5. Add tests for two distinct targets/scopes, focus handover, stable IDs across rerender, and no route dependency.

## Hard boundaries

- Do not edit `pages/session.tsx`; U2 owns it.
- Do not make SDK calls or ensure sessions.
- Do not implement queue or Coder UI.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/session-target.test.tsx
```

## Completion handoff

Publish the target/scope component APIs for U2, U3, Q1, and B3.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
