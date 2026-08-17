# Track S1 — Server Handlers

## Mission

Implement thin Effect HttpApi handlers that connect the P1 protocol to B1 workspace persistence and B2 MasterAgent lifecycle services.

Target branch: `feature/UnrealViewer`.

## Dependencies

- B1 database/workspace persistence.
- B2 MasterAgent lifecycle.
- P1 protocol contracts.

This track does not depend on generated SDK output.

## Files

### Create

```text
packages/server/src/handlers/workspace-master-agent.ts
packages/server/test/handlers/workspace-master-agent.test.ts
```

### Modify

```text
packages/server/src/handlers/workspace.ts
```

The shared workspace handler file should receive only small registration/composition edits.

## Required implementation

1. Wire workspace `coderModel` patch handling through the existing workspace service update path.
2. Implement handlers for:

```text
workspace.masterAgent.get
workspace.masterAgent.ensure
workspace.masterAgent.reset
```

3. Authenticate and authorize using existing workspace conventions.
4. Validate workspace and block ownership before invoking lifecycle operations.
5. Map domain errors to P1's typed protocol errors.
6. Return B2's binding projection without reconstructing it in the handler.
7. Ensure EventV2 emission remains in the domain/service transaction boundary, not duplicated in the handler.

## Handler principles

Handlers should perform only:

```text
request decode
identity/context lookup
permission/ownership validation
service invocation
domain-error mapping
response encode
```

They must not create sessions directly, write functionality-instance configuration directly, classify Coder tasks, or implement queue behavior.

## Security checks

- A client cannot bind a session belonging to another workspace.
- A block that is not `builtin:master-agent` cannot call MasterAgent lifecycle operations successfully.
- Reset optimistic-concurrency fields are required and forwarded unchanged.
- Generic workspace patch supports `coderModel`, but no endpoint permits client-authored `sessionBinding`.

## Tests

Cover:

1. Authorized get/ensure/reset success.
2. Workspace not found.
3. Block not found or wrong functionality ID.
4. Stale reset request.
5. Busy/pending-input reset rejection.
6. `coderModel` patch to a model and back to null.
7. Unauthorized/cross-workspace access rejection.
8. Handler calls the lifecycle service once and does not duplicate session creation.

## Verification

```bash
bun --cwd packages/server typecheck
bun test packages/server/test/handlers/workspace-master-agent.test.ts
```

## Deliverable

Thin handlers and tests, with all lifecycle business logic remaining in B2.

## Merge notes

S1 owns `packages/server/src/handlers/workspace.ts`. Keep MasterAgent logic in the new dedicated module to minimize conflict and review surface.
