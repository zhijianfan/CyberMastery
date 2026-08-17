# Track S2 — Server and Event Bridge Composition

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `COMPOSITION`  
**Merge lane:** Server

## Mission

Mount the new protocol handlers, expose workspace Coder patches, and register the binding event with the existing EventV2 bridge.

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

**May begin:** Can inspect composition points immediately.

**May merge/final-verify after:** D4, E1, F4, P3, and S1.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/server/test/handlers/workspace-master-agent-composition.test.ts`

### Modify

- `packages/server/src/handlers/workspace.ts`
- `packages/opencode/src/server/event-v2.ts`

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Mount S1's handler group under the P3 Workspace API.
2. Confirm existing workspace patch handling forwards `coderModel` through D4 without a special side channel.
3. Register/bridge `workspace.master-agent.binding.updated` through the existing EventV2 path.
4. Preserve current EventV2 behavior for all existing event types.
5. Add composition tests for route availability, workspace patch propagation, and event bridge payload.
6. Keep the bridge transient: reconnect recovery must call get/ensure against persisted state.

## Hard boundaries

- This track owns only composition; do not duplicate S1/F4 business logic.
- Do not edit protocol or generated SDK.
- Do not add a client-side queue event.

## Verification

```bash
bun --cwd packages/server typecheck
bun --cwd packages/opencode typecheck
bun test packages/server/test/handlers/workspace-master-agent-composition.test.ts
```

## Completion handoff

Publish the server baseline used by M5, R1, and V1.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
