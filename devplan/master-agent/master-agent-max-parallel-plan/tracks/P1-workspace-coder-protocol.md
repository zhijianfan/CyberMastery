# Track P1 — Workspace Coder Protocol Fragment

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Protocol

## Mission

Define the protocol-facing workspace Coder patch/read fragment without editing the shared Workspace HttpApi group.

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

**May begin:** None. Use the C0 schema contract.

**May merge/final-verify after:** C0 before typecheck; P3 composes it.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/protocol/src/groups/workspace-coder.ts`
- `packages/protocol/test/workspace-coder.test.ts`

### Modify

- None.

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Expose `coderModel` through the same workspace patch semantics as `model` and `operatingAgent`.
2. Reuse the schema package's workspace model type; do not duplicate the Effect Schema.
3. Preserve omitted-versus-null semantics.
4. Define any request/response helpers needed by the existing Workspace group without registering routes here.
5. Add protocol encode/decode tests for read, set, clear, and omit.

## Hard boundaries

- Do not edit `packages/protocol/src/groups/workspace.ts`; P3 owns composition.
- Do not generate the SDK.
- Do not add MasterAgent lifecycle endpoints.

## Verification

```bash
bun --cwd packages/protocol typecheck
bun test packages/protocol/test/workspace-coder.test.ts
```

## Completion handoff

Report the exported fragment/helper symbol for P3.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
