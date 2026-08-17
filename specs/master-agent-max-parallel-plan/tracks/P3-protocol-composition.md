# Track P3 — Protocol Composition

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `COMPOSITION`  
**Merge lane:** Protocol

## Mission

Perform the one shared protocol edit that combines P1 and P2 into the public Workspace API.

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

**May begin:** Can prepare imports immediately; final verification requires P1 and P2.

**May merge/final-verify after:** C2, P1, and P2.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/protocol/test/workspace-master-agent-composition.test.ts`

### Modify

- `packages/protocol/src/groups/workspace.ts`
- `packages/protocol/src/index.ts`

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Compose the workspace Coder patch fragment into the existing Workspace info/patch endpoints.
2. Mount the MasterAgent get/ensure/reset endpoints in the Workspace HttpApi group.
3. Export the group through the existing protocol entry point.
4. Preserve all current endpoint identifiers to avoid unrelated SDK churn.
5. Run a composition test using only public imports.
6. Freeze endpoint and schema names after merge; changes after G1 require a full regeneration restart.

## Hard boundaries

- This is the only track allowed to edit the shared Workspace protocol group for this feature.
- Do not hand-edit generated clients.
- Do not implement handlers.

## Verification

```bash
bun --cwd packages/protocol typecheck
bun test packages/protocol/test/workspace-master-agent-composition.test.ts
```

## Completion handoff

Create the immutable protocol baseline commit consumed by G1 and S2.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
