# Track F2 — MasterAgent Binding State Machine

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Core lifecycle

## Mission

Implement pure binding validation and transition logic independently of databases, sessions, events, and HTTP.

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

**May begin:** None. Use the C1 binding/configuration contract.

**May merge/final-verify after:** C1 before typecheck; F4 consumes it.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/core/src/workspace/master-agent-binding.ts`
- `packages/core/test/workspace/master-agent-binding.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Implement pure parsing/validation of MasterAgent instance configuration.
2. Implement transition functions for initial bind, idempotent ensure, reset, generation increment, revision expectation, and stale request rejection.
3. Represent invalid/missing session references as explicit transition outcomes rather than side effects.
4. Keep directory binding resolution input explicit so this module remains deterministic.
5. Add table-driven tests for every transition, including stale expected session, stale revision, wrong functionality ID, and reset while not allowed.

## Hard boundaries

- No Effect services, database calls, Session creation, EventV2 emission, or protocol types beyond shared schemas.
- Do not decide whether a session is idle; accept that as an input from F3/F4.
- Do not mutate configuration objects in place.

## Verification

```bash
bun --cwd packages/core typecheck
bun test packages/core/test/workspace/master-agent-binding.test.ts
```

## Completion handoff

Export a small reducer/transition API and enumerate all possible outcomes for F4.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
