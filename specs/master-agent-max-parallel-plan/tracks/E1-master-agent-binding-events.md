# Track E1 — MasterAgent Binding Events

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Core lifecycle

## Mission

Implement the EventV2 publisher/registration adapter for MasterAgent binding changes, keeping persistence authoritative.

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

**May begin:** None. Use the C1 event payload.

**May merge/final-verify after:** C1 before typecheck; F4 emits through it and S2 bridges it.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/core/src/workspace/master-agent-events.ts`
- `packages/core/test/workspace/master-agent-events.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Create a typed publisher for `workspace.master-agent.binding.updated` using the existing core EventV2 facility.
2. Validate that every event carries workspace ID, block ID, session ID, generation, and revision.
3. Document that the event is transient and that clients must refetch persisted binding after reconnect.
4. Add tests for payload validation, exactly-once publish per successful transition, and no publish on idempotent ensure/stale CAS.
5. Expose a small publisher port so F4 can be tested without a global event bus.

## Hard boundaries

- Do not implement lifecycle transitions or client reducers.
- Do not make the event the source of truth.
- Do not edit the opencode/server bridge shared files; S2 owns bridge composition.

## Verification

```bash
bun --cwd packages/core typecheck
bun test packages/core/test/workspace/master-agent-events.test.ts
```

## Completion handoff

Report the event publisher symbol and bridge registration requirement.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
