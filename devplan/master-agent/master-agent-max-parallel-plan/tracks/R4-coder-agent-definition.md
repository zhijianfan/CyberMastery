# Track R4 — Reserved Coder Agent Definition

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Coder host

## Mission

Define the reserved Coder child agent independently of agent registry integration.

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

**May merge/final-verify after:** R6 registers it; R5 uses its identifier.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/opencode/src/agent/coder.ts`
- `packages/opencode/test/agent/coder.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Create a reserved internal agent ID/name for coding execution.
2. Define a concise system role focused on implementation, build, test, migration, debugging, and reporting results to the parent.
3. Use existing coding-agent tool/permission conventions; do not bypass workspace permissions.
4. Do not expose user-selectable model fields in the agent definition—the host supplies the workspace Coder model at child creation.
5. Add tests for stable ID, internal/reserved visibility, expected tool profile, and no embedded model override.

## Hard boundaries

- Do not edit the shared agent registry; R6 owns it.
- Do not create child sessions or resolve workspace state.
- Do not hardcode a provider or model.

## Verification

```bash
bun --cwd packages/opencode typecheck
bun test packages/opencode/test/agent/coder.test.ts
```

## Completion handoff

Report the reserved agent symbol and identifier.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
