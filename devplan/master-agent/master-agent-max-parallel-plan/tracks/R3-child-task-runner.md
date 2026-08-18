# Track R3 — Reusable Child Task Runner

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Coder host

## Mission

Extract the existing TaskTool child-session execution path into a reusable host-internal runner without changing ordinary TaskTool behavior.

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

**May begin:** None.

**May merge/final-verify after:** R5 consumes the runner.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/opencode/src/tool/task-runner.ts`
- `packages/opencode/test/tool/task-runner.test.ts`

### Modify

- `packages/opencode/src/tool/task.ts`

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Identify the existing TaskTool code that creates a child session, applies agent/model/directory context, executes the task, and returns the result.
2. Move that logic into a host-internal `ChildTaskRunner` API.
3. Keep the public TaskTool argument schema and behavior unchanged.
4. Allow trusted callers to provide a host-resolved model/agent/directory context without exposing those fields to model-authored arguments.
5. Add regression tests proving ordinary TaskTool requests create equivalent children and results before/after extraction.
6. Add tests for cancellation/error propagation and parent-child linkage.

## Hard boundaries

- This is the only track allowed to edit `packages/opencode/src/tool/task.ts`.
- Do not add Coder policy or workspace lookup.
- Do not change the public TaskTool schema.

## Verification

```bash
bun --cwd packages/opencode typecheck
bun test packages/opencode/test/tool/task-runner.test.ts
```

## Completion handoff

Publish the trusted runner interface used by R5.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
