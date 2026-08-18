# Track V1 — Core and Server Integration Tests

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `VERIFY`  
**Merge lane:** Verification

## Mission

Verify workspace persistence, functionality binding, lifecycle concurrency, protocol handlers, and event bridging against real package layers.

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

**May begin:** Test design can start immediately with fixtures.

**May merge/final-verify after:** D4, F4, P3, and S2.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/core/test/integration/master-agent-session.test.ts`
- `packages/server/test/integration/master-agent-api.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Test two blocks produce distinct durable top-level sessions.
2. Test reload/reconnect preserves binding.
3. Test simultaneous ensure results in one active binding and cleans up any losing empty candidate.
4. Test stale expected session/revision reset rejection and busy/pending reset rejection.
5. Test reset affects only one block and preserves old session history.
6. Test block tombstone/removal preserves session and admitted queue.
7. Test `coderModel` set/clear/reload through the real API.
8. Test binding event bridge and authoritative refetch after a missed event.

## Hard boundaries

- Do not change production implementation except test-only fixture hooks approved by the owning track.
- Do not duplicate unit tests already owned by leaf tracks.

## Verification

```bash
bun --cwd packages/core typecheck
bun --cwd packages/server typecheck
bun test packages/core/test/integration/master-agent-session.test.ts packages/server/test/integration/master-agent-api.test.ts
```

## Completion handoff

Produce a concise failure report tied to owning tracks; do not patch shared files opportunistically.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
