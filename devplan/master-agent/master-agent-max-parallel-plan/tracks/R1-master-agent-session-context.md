# Track R1 — MasterAgent Session Context Resolver

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Coder host

## Mission

Resolve a running Session to its owning MasterAgent instance, workspace policy, selected Coder model, and bound directory.

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

**May begin:** None. Code against the frozen workspace/lifecycle repository ports.

**May merge/final-verify after:** D4 and F4 before final integration; R5/R6 consume it.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/opencode/src/session/master-agent-context.ts`
- `packages/opencode/test/session/master-agent-context.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Given a session ID, determine whether it is a top-level session bound to `builtin:master-agent`.
2. Resolve workspace ID, block ID, functionality instance ID, bound directory, primary model, operating agent, and nullable `coderModel` from trusted host state.
3. Return `not-master-agent` for ordinary sessions rather than applying restrictions globally.
4. Reject mismatched/deleted/tombstoned bindings and cross-workspace references.
5. Do not accept model, provider, directory, or workspace overrides from tool arguments.
6. Add tests for ordinary session, valid binding, missing workspace, cleared Coder model, stale binding, and directory resolution.

## Hard boundaries

- No tool gating or child session creation.
- No app or generated SDK dependency.
- Do not cache policy across workspace revisions unless invalidation is explicit.

## Verification

```bash
bun --cwd packages/opencode typecheck
bun test packages/opencode/test/session/master-agent-context.test.ts
```

## Completion handoff

Export a resolver service/port and a typed `MasterAgentSessionContext` result.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
