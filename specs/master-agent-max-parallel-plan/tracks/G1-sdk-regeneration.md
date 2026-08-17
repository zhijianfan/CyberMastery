# Track G1 — SDK Regeneration

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `SERIAL`  
**Merge lane:** Generated SDK

## Mission

Regenerate the JavaScript SDK from the merged P3 protocol baseline and commit generated output only.

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

**May begin:** Must wait for P3. This is the only hard execution-serial track.

**May merge/final-verify after:** P3.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- None.

### Modify

- `packages/sdk/js/src/** (generated output only)`

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Start from the exact P3 commit with a clean worktree.
2. Run `node packages/sdk/js/script/build.ts` once and inspect the diff for the workspace Coder field and MasterAgent lifecycle methods.
3. Run the generator a second time without changing input.
4. Require the second run to produce no new diff.
5. Run SDK typecheck and any generated-client tests.
6. Commit only generated output and the generator's normal metadata.

## Hard boundaries

- Never hand-edit generated files.
- Do not modify protocol, server, app, or core code.
- If generation produces unrelated broad churn, report it rather than manually pruning generated output.

## Verification

```bash
node packages/sdk/js/script/build.ts
git diff --binary -- packages/sdk/js > /tmp/master-agent-sdk-pass-1.diff
node packages/sdk/js/script/build.ts
git diff --binary -- packages/sdk/js > /tmp/master-agent-sdk-pass-2.diff
cmp /tmp/master-agent-sdk-pass-1.diff /tmp/master-agent-sdk-pass-2.diff
bun --cwd packages/sdk/js typecheck
```

## Completion handoff

Report the exact generated client methods and request/result type names to M5.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
