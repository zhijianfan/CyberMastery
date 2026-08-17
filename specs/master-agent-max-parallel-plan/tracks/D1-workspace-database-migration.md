# Track D1 — Workspace Database Migration

**Target:** opencode fork, branch `feature/UnrealViewer`  
**Dispatch class:** `START NOW`  
**Merge lane:** Core persistence

## Mission

Add durable SQL storage for `coderModel` and keep the hand-maintained migration list and baseline schema synchronized.

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

**May begin:** None. Implement against the frozen C0 field contract.

**May merge/final-verify after:** C0 before final typecheck; D4 consumes the result.

## Parallel-execution rules

- Work only in the files listed under **Exclusive file ownership**.
- Do not edit a shared file owned by another track, even to fix a temporary type error.
- When an upstream implementation is not merged yet, code against the frozen interface in `../02-contracts-and-data-model.md` and use a local test fake. Rebase and replace temporary type-only aliases before final verification.
- Do not wait for generated SDK types unless this file explicitly says **POST-GEN** or **SERIAL**.
- Do not add compatibility shims outside this track's files.
- Deliver one focused commit plus a completion note containing changed files, commands run, assumptions, and any blocked integration symbol.

## Exclusive file ownership

### Create

- `packages/core/src/database/migration/<next_timestamp>_master_agent.ts`
- `packages/core/test/database/master-agent-migration.test.ts`

### Modify

- `packages/core/src/workspace/sql.ts`
- `packages/core/src/database/migration.gen.ts`
- `packages/core/src/database/schema.gen.ts`

No other production files are in scope. If the repository uses an equivalent test directory, move only the test file and record the substitution; do not broaden production-file ownership.

## Required implementation

1. Select one migration timestamp from the current branch head immediately before creating the migration.
2. Add a nullable workspace column for `coderModel` using the same SQL representation/serialization strategy as `model`.
3. Make the migration non-destructive for existing workspace rows.
4. Update `migration.gen.ts` exactly once and update the baseline `schema.gen.ts` in the same commit.
5. If the branch lacks generic functionality-instance persistence, add only the minimal generic table required by the frozen instance-repository contract; do not create a MasterAgent-specific table.
6. Add a migration test from the previous baseline that verifies row preservation, null default, and schema/baseline agreement.

## Hard boundaries

- Do not edit `workspace/service.ts`; D4 owns service wiring.
- Do not implement row codecs, lifecycle logic, registry entries, protocol, or handlers.
- Do not store the authoritative session binding in layout JSON.

## Verification

```bash
bun --cwd packages/core typecheck
bun test packages/core/test/database/master-agent-migration.test.ts
```

## Completion handoff

Report the migration timestamp, SQL column name, storage encoding, and whether generic functionality-instance storage already existed.

The completion note must also state whether the track is ready to merge, ready only after a named upstream rebase, or blocked by a contract mismatch.
