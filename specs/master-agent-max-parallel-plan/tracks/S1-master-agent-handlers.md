# Track S1 — MasterAgent Handler Module

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Server

## Mission

Implement thin get/ensure/reset handlers and access validation in new files, against frozen protocol and service ports.

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

**May begin:** None. Use P2/F4 signatures from `02-contracts-and-data-model.md`; local fakes are allowed.

**May merge/final-verify after:** P2 and F4 before final typecheck; S2 mounts the handlers.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/server/src/handlers/workspace-master-agent-access.ts`
- `packages/server/src/handlers/workspace-master-agent.ts`
- `packages/server/test/handlers/workspace-master-agent.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Validate caller access to the workspace and block before invoking lifecycle operations.
2. Validate that the target instance is `builtin:master-agent`.
3. Translate protocol requests into F4 service calls without embedding business logic.
4. Map typed domain errors to the P2 HttpApi error schemas.
5. Ensure reset passes expected session ID and expected revision unchanged.
6. Add tests for access denial, wrong block type, get, idempotent ensure, stale reset, busy/pending reset, and successful reset.

## Hard boundaries

- Do not edit shared server handler composition; S2 owns it.
- Do not create sessions directly or publish events directly.
- Do not import generated SDK code.

## Verification

```bash
bun --cwd packages/server typecheck
bun test packages/server/test/handlers/workspace-master-agent.test.ts
```

## Completion handoff

Export one handler group/layer symbol for S2.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
