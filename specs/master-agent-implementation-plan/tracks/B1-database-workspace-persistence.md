# Track B1 — Database, Workspace Persistence, and Built-in Registry

## Mission

Persist the workspace-wide Coder model, ensure durable functionality-instance storage is available, and register `builtin:master-agent` in the core built-in functionality list.

Target branch: `feature/UnrealViewer`.

## Dependencies

- A0 shared contracts.

B2 may develop against a repository interface in parallel, but B1 must merge before B2's final integration.

## Files

### Modify

```text
packages/core/src/workspace/sql.ts
packages/core/src/workspace/service.ts
packages/core/src/database/migration.gen.ts
packages/core/src/database/schema.gen.ts
```

### Create or modify, depending on existing infrastructure

```text
packages/core/src/functionality/persistence/sql.ts
```

### Create

```text
packages/core/src/database/migration/<next_timestamp>_master_agent.ts
packages/core/test/workspace/workspace-coder-model.test.ts
packages/core/test/database/master-agent-migration.test.ts
```

Use one timestamp selected from the current branch head immediately before creating the migration.

## Required implementation

1. Add a nullable workspace SQL column for `coderModel` using the same serialization strategy as `model`.
2. Include the field in all workspace row → domain and domain → row mappings.
3. Include it in workspace creation defaults, reads, and patch/update handling.
4. Confirm `null` round-trips as disabled and a selected provider/model round-trips exactly.
5. Register `builtin:master-agent` in the core `builtins` array in `packages/core/src/workspace/service.ts`.
6. Reuse existing durable functionality-instance persistence if it already supports configuration and revisions.
7. If the branch lacks the required generic instance persistence, add only the minimal generic storage needed by B2:
   - workspace ID
   - block ID
   - functionality ID
   - configuration payload or normalized binding fields
   - revision
   - tombstone/active state if consistent with the existing design
8. Update the hand-maintained migration module list and baseline schema in the same commit.

## Migration requirements

The migration must:

- Upgrade an existing database without dropping workspace data.
- Add `coderModel` as nullable.
- Add or update generic functionality-instance storage only when it is genuinely absent.
- Match the baseline in `schema.gen.ts`.
- Be represented in `migration.gen.ts` exactly once.

## Important boundaries

- This track does not implement MasterAgent `ensure`, `reset`, session creation, or EventV2 emission; B2 owns lifecycle logic.
- Do not store the session binding in canvas layout JSON.
- Do not add a separate MasterAgent-specific table when the generic functionality-instance service can represent the binding cleanly.
- Do not edit protocol or generated SDK files.

## Tests

### Workspace field test

Verify:

- Existing rows read as `coderModel: null` after migration.
- Patch from null to a model persists.
- Patch from a model back to null persists.
- Other workspace fields remain unchanged.

### Migration test

Start from the previous schema/baseline, migrate, and verify:

- Workspace rows survive.
- New column exists and is nullable.
- Functionality-instance schema matches the service expectation.
- Migration and baseline schema agree.

## Verification

```bash
bun --cwd packages/core typecheck
bun test packages/core/test/workspace/workspace-coder-model.test.ts   packages/core/test/database/master-agent-migration.test.ts
```

## Deliverable

A migration-safe persistence layer and built-in registry entry, with no MasterAgent session business logic.

## Merge notes

This track exclusively owns:

```text
packages/core/src/workspace/service.ts
packages/core/src/workspace/sql.ts
packages/core/src/database/migration.gen.ts
packages/core/src/database/schema.gen.ts
```

No other track should create a competing migration for `coderModel` or `builtin:master-agent`.
