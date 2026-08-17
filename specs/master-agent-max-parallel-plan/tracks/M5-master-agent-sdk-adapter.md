# Track M5 — Generated SDK Adapter

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `POST-GEN`  
**Merge lane:** Canvas manager

## Mission

Implement the M1 port using only the generated G1 client methods.

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

**May begin:** Must wait for G1; this is the only app track blocked by code generation.

**May merge/final-verify after:** G1 and M1.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/app/src/pages/canvas/master-agent/sdk-port.ts`
- `packages/app/src/pages/canvas/master-agent/sdk-port.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Map generated get/ensure/reset methods to the M1 port.
2. Map workspace patch/read methods for `coderModel` without widening the port.
3. Normalize generated transport errors into the client-domain error union.
4. Preserve abort signals/cancellation where the generated client supports them.
5. Add adapter tests with a fake generated client, including stale conflict, access denied, busy reset, and network failure.
6. Do not leak generated types past this file.

## Hard boundaries

- Do not edit generated files.
- Do not edit `manager.ts`; M6 owns composition.
- Do not add UI state.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent/sdk-port.test.ts
```

## Completion handoff

Export a single port factory for M6.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
