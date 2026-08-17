# Track B2 — MasterAgent Functionality Instance and Session Lifecycle

## Mission

Implement the host-domain service that binds each `builtin:master-agent` block to one durable top-level session and provides idempotent get/ensure/reset behavior.

Target branch: `feature/UnrealViewer`.

## Dependencies

- A0 shared contracts.
- B1 persistence before final merge.

This track may begin against a small repository interface while B1 is in progress.

## Files

### Create

```text
packages/core/src/workspace/master-agent.ts
packages/core/test/workspace/master-agent.test.ts
```

### Create or modify only if this generic service already exists or is the intended abstraction

```text
packages/core/src/functionality/instance-service.ts
```

Do not edit workspace SQL, migrations, protocol groups, or server handlers.

## Required service API

Implement domain operations equivalent to:

```text
get(workspaceID, blockID)
ensure(workspaceID, blockID)
reset(workspaceID, blockID, expectedSessionID, expectedRevision)
```

Return the shared MasterAgent binding projection.

## Required behavior

### Resolve and validate

- Verify the workspace exists.
- Verify the block is associated with `builtin:master-agent` according to the authoritative workspace/functionality state.
- Resolve the functionality instance by `(workspaceID, blockID, functionalityID)`.
- Resolve the block's directory binding.

### Ensure

- If a valid active binding exists, return it unchanged.
- Otherwise create a top-level Session using the normal Session domain service.
- Persist the binding with a generation and revision.
- Emit `workspace.master-agent.binding.updated` after a successful change.
- Repeated calls must be idempotent.

### Concurrent ensure

Two clients may call ensure simultaneously. Use a transaction or revision compare-and-swap so exactly one binding wins.

If two candidate sessions are created and one loses the CAS:

- Reload and return the winning binding.
- Archive/remove the losing session if the Session service supports safe cleanup of an unbound empty candidate.
- Never leave two active bindings.

### Reset

- Require the current session to be idle with no pending inputs for v1.
- Validate `expectedSessionID` and `expectedRevision`.
- Create a new top-level session.
- Atomically replace the binding and increment generation/revision.
- Preserve the old session in history.
- Do not move queued inputs to the new session.
- Emit the binding-updated event.

### Removal/tombstone

When the block/instance is removed:

- Preserve the Session record.
- Preserve running work and admitted queue entries.
- Remove or tombstone only the visible functionality instance according to existing workspace semantics.

## Important boundaries

- Do not expose direct prompt submission. The bound session uses ordinary Session APIs.
- Do not persist the binding in layout JSON.
- Do not accept a client-authored session ID through generic functionality config.
- Do not implement HTTP handlers in this track.
- Do not implement Coder routing; R1 owns it.

## Event behavior

The transient event should contain enough information for another client to rebind immediately, but persisted instance state remains authoritative. Duplicate or out-of-order events must not corrupt state when the client later refetches.

## Tests

Cover at least:

1. First ensure creates and binds one session.
2. Second ensure returns the same binding.
3. Two blocks receive distinct sessions.
4. Concurrent ensures leave one active binding.
5. Reset changes only the target block.
6. Stale expected session/revision rejects reset.
7. Busy or queued sessions reject reset.
8. Old session remains queryable after reset.
9. Removal does not delete session or pending input.
10. Binding update event is emitted only after successful persistence.

## Verification

```bash
bun --cwd packages/core typecheck
bun test packages/core/test/workspace/master-agent.test.ts
```

## Deliverable

A host-domain lifecycle service with no HTTP or UI dependencies.

## Merge notes

B2 owns binding semantics. Server handlers must remain thin wrappers and may not recreate ensure/reset logic.
