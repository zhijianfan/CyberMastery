# Track U3 — Canvas Session Multi-instance Adapter

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Session UI

## Mission

Compose U1 and U2 into the canvas-specific session surface that safely supports multiple mounted sessions.

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

**May begin:** None. Implement against frozen U1/U2 interfaces with test doubles.

**May merge/final-verify after:** U1 and U2 before final typecheck; B3 consumes it.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/canvas/session-surface.tsx`
- `packages/app/src/pages/canvas/session-surface.test.tsx`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Wrap `SessionSurfaceBase` with a U1 target/scope provider.
2. Scope keyboard commands to the focused block and prevent simultaneous command handling.
3. Provide unique DOM/portal/terminal/review/composer identities per surface.
4. Support two different session IDs and two instances of the same session without singleton collisions.
5. Expose `queueEnabled`, focused state, and optional open-full-page callback.
6. Add tests mounting two surfaces and exercising focus, composer target, terminal mount, review panel, and unmount/remount behavior.

## Hard boundaries

- No MasterAgent ensure/reset calls.
- No local Session or queue persistence.
- Do not edit routed session files.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/session-surface.test.tsx
```

## Completion handoff

Publish the final `<CanvasSessionSurface>` props for Q1 and B3.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
