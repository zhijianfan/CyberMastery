# Track R6 — Coder Host Integration

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `COMPOSITION`  
**Merge lane:** Coder host

## Mission

Apply the R1–R5 modules to the existing prompt/tool/agent pipeline while preserving non-MasterAgent behavior.

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

**May begin:** Can locate integration points immediately.

**May merge/final-verify after:** D4, F4, R1, R2, R3, R4, and R5.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/opencode/test/session/master-agent-coder-integration.test.ts`

### Modify

- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/agent/agent.ts`

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Register the reserved Coder agent without exposing it as an ordinary user agent unless repository conventions require visibility.
2. Register/inject the Coder tool for eligible MasterAgent primary sessions.
3. Apply R2's effective tool policy only when R1 resolves a MasterAgent with non-null `coderModel`.
4. Keep Coder-disabled MasterAgent and every ordinary session unchanged.
5. Ensure the primary stays on `workspace.model`; only the child receives the Coder snapshot.
6. Add integration tests for direct mutation removal, task permission denial, ordinary session regression, disabled mode, child model selection, and unavailable-model failure.

## Hard boundaries

- This is the only feature track allowed to edit `session/prompt.ts` or `agent/agent.ts`.
- Do not alter app UI or workspace persistence.
- Do not silently fall back.

## Verification

```bash
bun --cwd packages/opencode typecheck
bun test packages/opencode/test/session/master-agent-coder-integration.test.ts
```

## Completion handoff

Publish the Coder-host baseline used by V2.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
