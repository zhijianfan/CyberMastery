# Track R5 — Coder Delegation Tool

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Coder host

## Mission

Implement the reserved Coder tool in a new file against frozen resolver, policy, runner, and agent interfaces.

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

**May begin:** None. Use local interface imports/fakes matching R1–R4; final typecheck follows their merge.

**May merge/final-verify after:** R1, R2, R3, and R4 before final integration; R6 registers the tool.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/opencode/src/tool/coder-task.ts`
- `packages/opencode/test/tool/coder-task.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Expose only task description/context inputs needed for delegation.
2. Resolve MasterAgent context through R1 and reject ordinary/unbound sessions.
3. Require non-null `coderModel` and allowed `task` permission.
4. Snapshot the selected Coder model, directory, workspace, parent session, and reserved agent on child creation.
5. Invoke R3's trusted child runner and return the child result/metadata to the primary session.
6. Fail visibly when the model is unavailable or incompatible; never fall back to the primary model.
7. Add tests proving model/provider/directory cannot be supplied by tool arguments and that model changes affect only later children.

## Hard boundaries

- Do not edit prompt/agent registries; R6 owns integration.
- Do not perform browser-side classification.
- Do not expose permission overrides or arbitrary parent/session IDs.

## Verification

```bash
bun --cwd packages/opencode typecheck
bun test packages/opencode/test/tool/coder-task.test.ts
```

## Completion handoff

Export the tool definition and exact tool ID for R6.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
