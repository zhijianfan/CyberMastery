# Track R2 — Coder Routing Policy

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Coder host

## Mission

Implement pure host policy that determines the primary session's effective tools and when coding work must be delegated.

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

**May begin:** None. Use the architecture decisions in `01-architecture-decisions.md`.

**May merge/final-verify after:** R6 consumes it.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/opencode/src/session/master-agent-policy.ts`
- `packages/opencode/test/session/master-agent-policy.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Define policy inputs: whether the session is MasterAgent, whether `coderModel` is configured, and existing project permissions.
2. Define the strict Coder-enabled tool set: read/search/context plus reserved Coder delegation; remove direct repository mutation and unrestricted agent shell tools.
3. Keep user-operated terminal UI outside this agent-tool policy.
4. Preserve ordinary-session behavior and Coder-disabled MasterAgent behavior exactly.
5. Reuse the existing `task` permission key for delegation authority.
6. Add exhaustive table tests for enable/disable, allow/deny/default permission, ordinary sessions, and mutation/shell categories.

## Hard boundaries

- No prompt classification, model ranking, Session creation, or UI logic.
- Do not alter global tool definitions.
- Do not silently permit primary mutation when Coder is enabled.

## Verification

```bash
bun --cwd packages/opencode typecheck
bun test packages/opencode/test/session/master-agent-policy.test.ts
```

## Completion handoff

Export a deterministic effective-tool/policy result used by R6 and test fixtures.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
