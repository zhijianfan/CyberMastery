# Track P2 — MasterAgent Protocol Group

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Protocol

## Mission

Define typed get/ensure/reset HttpApi endpoints in a standalone protocol group.

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

**May begin:** None. Use the C1 request/result contract.

**May merge/final-verify after:** C1 before typecheck; P3 mounts the group.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/protocol/src/groups/workspace-master-agent.ts`
- `packages/protocol/test/workspace-master-agent.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Define get, ensure, and reset endpoints using repository HttpApi conventions.
2. Use workspace and block identifiers in the request path/body consistently with existing Workspace routes.
3. Return the shared MasterAgent binding projection.
4. Define typed errors for not found, wrong functionality, stale revision/session, busy/pending reset, permission/access failure, and internal conflict as appropriate to existing conventions.
5. Do not define a prompt endpoint.
6. Add protocol tests for success and every request validation/error schema.

## Hard boundaries

- Do not edit shared protocol group/index files; P3 owns composition.
- Do not implement handlers or SDK output.
- Do not allow a client-authored session binding.

## Verification

```bash
bun --cwd packages/protocol typecheck
bun test packages/protocol/test/workspace-master-agent.test.ts
```

## Completion handoff

Publish endpoint names and generated-client method expectations for G1/M5.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
