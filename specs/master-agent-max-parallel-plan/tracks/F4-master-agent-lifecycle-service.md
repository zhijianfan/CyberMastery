# Track F4 — MasterAgent Lifecycle Service

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `COMPOSITION`  
**Merge lane:** Core lifecycle

## Mission

Compose F1, F2, F3, and E1 into the host-domain get/ensure/reset service.

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

**May begin:** Can scaffold immediately against the frozen ports; final verification requires F1, F2, F3, and E1.

**May merge/final-verify after:** C1, D3, F1, F2, F3, and E1; D4 for authoritative workspace/functionality lookup.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/core/src/workspace/master-agent.ts`
- `packages/core/test/workspace/master-agent.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Implement `get`, `ensure`, and `reset` with workspace/block/functionality validation.
2. Resolve the directory binding before session creation.
3. Make ensure idempotent and use repository CAS to prevent duplicate active bindings.
4. On a concurrent losing candidate, return the winning binding and safely clean up only an unbound empty session.
5. Permit reset only when the current session is idle with zero pending inputs.
6. Require expected session ID and expected revision for reset.
7. Persist the new binding before publishing the transient binding-updated event.
8. Preserve old sessions and queued inputs on reset/removal.
9. Add deterministic concurrency tests using barriers/fakes rather than timing sleeps.

## Hard boundaries

- No HTTP, generated SDK, app manager, or Coder routing.
- No prompt submission API.
- Do not write layout JSON.

## Verification

```bash
bun --cwd packages/core typecheck
bun test packages/core/test/workspace/master-agent.test.ts
```

## Completion handoff

Provide the service constructor/layer and operation signatures to S1, R1, and V1.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
