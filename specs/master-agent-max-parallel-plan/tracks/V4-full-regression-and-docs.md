# Track V4 — Full Regression Gate and Documentation

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `VERIFY`  
**Merge lane:** Release

## Mission

Run the final cross-package gate, verify SDK idempotence, and update user/developer documentation to match the implemented behavior.

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

**May begin:** Documentation outline can start immediately.

**May merge/final-verify after:** All production and V1–V3 tracks.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `docs/master-agent.md`
- `docs/master-agent-verification.md`

### Modify

- `UIDesign.md`

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Document session ownership, queue durability, workspace-wide Coder selection, host routing, permissions, reset, removal, and limitations.
2. Update UIDesign without duplicating low-level implementation details.
3. Run every touched package typecheck.
4. Run all new unit/integration tests and relevant existing session/canvas tests.
5. Run SDK generation twice and require idempotence.
6. Run the app production build.
7. Record exact commands, commit hashes/baselines, failures, deferred limitations, and manual smoke results in the verification document.
8. Reject release on silent model fallback, client queue, duplicate session binding, cross-workspace access, or ordinary-session regression.

## Hard boundaries

- Do not make unreviewed production-code fixes in this track; route failures to the owning track.
- Do not change frozen product defaults while documenting.

## Verification

```bash
bun --cwd packages/schema typecheck
bun --cwd packages/core typecheck
bun --cwd packages/protocol typecheck
bun --cwd packages/server typecheck
bun --cwd packages/sdk/js typecheck
bun --cwd packages/opencode typecheck
bun --cwd packages/app typecheck
node packages/sdk/js/script/build.ts
node packages/sdk/js/script/build.ts
git diff --exit-code
bun --cwd packages/app run build
```

## Completion handoff

Deliver the final verification report and list any deliberately deferred product decisions.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
