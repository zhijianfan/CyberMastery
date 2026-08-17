# Track V3 — App Canvas Integration Tests

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `VERIFY`  
**Merge lane:** Verification

## Mission

Verify the full embedded session surface, manager state, queue behavior, Coder selector, multiple blocks, and legacy UI regression.

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

**May begin:** Test fixtures can start immediately against planned component contracts.

**May merge/final-verify after:** U3, M6, B3, and I2.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/canvas/master-agent.e2e.test.tsx`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Mount two MasterAgent blocks with distinct bindings and confirm isolated session surfaces.
2. Verify messages, composer, terminal, file tree, and review panel render.
3. Verify focus-scoped keyboard/portal/DOM behavior.
4. Verify Queue submits host-side, survives remount/reload projection, and promotes in order.
5. Verify workspace-wide Coder selection updates all block views through the manager.
6. Verify reset affects one block, stale event/response handling, reconnect refetch, and block removal preservation.
7. Verify existing routed Session page and `builtin:chat` block regressions.
8. Run the production app build.

## Hard boundaries

- Do not add local queue state to simplify tests.
- Do not bypass manager/controller interfaces.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent.e2e.test.tsx
bun --cwd packages/app run build
```

## Completion handoff

Produce screenshots/logs only if the test framework already supports them; keep the merge commit test-only.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
