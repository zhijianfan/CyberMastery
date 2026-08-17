# Track V2 — Coder Routing Integration Tests

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `VERIFY`  
**Merge lane:** Verification

## Mission

Verify host-enforced Coder delegation end to end without relying only on tool-level unit tests.

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

**May begin:** Test harness/fixtures can start immediately.

**May merge/final-verify after:** D4, F4, and R6.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/opencode/test/integration/master-agent-coder.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Verify null `coderModel` preserves ordinary behavior.
2. Verify enabled Coder keeps the parent on the primary model and creates a child on the selected Coder model.
3. Verify host-resolved directory, workspace, parent session, and permissions.
4. Verify direct primary edit/write/patch/unrestricted shell tools are unavailable only in strict Coder-enabled MasterAgent sessions.
5. Verify ordinary sessions and Coder-disabled MasterAgent sessions are unaffected.
6. Verify model snapshot across a mid-run workspace change.
7. Verify unavailable/incompatible model fails visibly with no primary fallback.
8. Verify denied `task` blocks delegation at the host.

## Hard boundaries

- Do not loosen policy to make tests pass.
- Do not use browser-side classification in fixtures.

## Verification

```bash
bun --cwd packages/opencode typecheck
bun test packages/opencode/test/integration/master-agent-coder.test.ts
```

## Completion handoff

Report policy regressions to R1–R6 ownership rather than editing their files.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
