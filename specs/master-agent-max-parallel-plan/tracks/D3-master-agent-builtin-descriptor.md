# Track D3 — MasterAgent Built-in Descriptor

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Core persistence

## Mission

Create the server/core descriptor for `builtin:master-agent` without editing the shared built-ins array.

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

**May begin:** None. Use the C1 functionality literal.

**May merge/final-verify after:** C1 before typecheck; D4 registers the descriptor.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/core/src/workspace/builtins/master-agent.ts`
- `packages/core/test/workspace/master-agent-builtin.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Define a built-in functionality descriptor using repository conventions and the literal `builtin:master-agent`.
2. Declare the supported/default instance configuration version and workspace-primary directory binding.
3. Ensure server-managed session-binding fields are not exposed as generic client-writable configuration.
4. Add a test for stable ID, default configuration, and configuration validation.
5. Export a single descriptor symbol for D4 to append to the built-ins list.

## Hard boundaries

- Do not edit `workspace/service.ts`; D4 owns the array change.
- Do not create sessions or access the Session service.
- Do not implement client rendering metadata.

## Verification

```bash
bun --cwd packages/core typecheck
bun test packages/core/test/workspace/master-agent-builtin.test.ts
```

## Completion handoff

Report the descriptor symbol and any required registry import.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
