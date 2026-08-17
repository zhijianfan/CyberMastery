# Track C1 — MasterAgent Domain Schema

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Contracts

## Mission

Create the standalone MasterAgent schema module containing the functionality ID, instance configuration, binding projection, lifecycle requests/results, and binding-update event.

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

**May begin:** None. The complete semantic contract is frozen in `02-contracts-and-data-model.md`.

**May merge/final-verify after:** None; C2 later adds the package-level exports.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/schema/src/master-agent.ts`
- `packages/schema/test/master-agent.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Define the literal functionality ID `builtin:master-agent`.
2. Define versioned instance configuration with directory binding and server-managed optional session binding.
3. Define the client-visible binding projection: workspace, block, functionality instance, session, directory, generation, and revision.
4. Define get, ensure, and reset request/result schemas. Reset must carry expected session ID and expected revision.
5. Define the transient `workspace.master-agent.binding.updated` event payload.
6. Keep session binding out of any generic client-writable configuration patch.
7. Add schema tests for all discriminated unions, optional values, and invalid reset/event payloads.

## Hard boundaries

- Do not edit the workspace schema; C0 owns it.
- Do not edit schema barrels or EventV2 registries; C2/E1 own integration.
- Do not add a MasterAgent-specific prompt endpoint.

## Verification

```bash
bun --cwd packages/schema typecheck
bun test packages/schema/test/master-agent.test.ts
```

## Completion handoff

Publish the exact symbol names in the commit message so every package can replace its local port types during rebase.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
