# Track P1 — Protocol Contracts

## Mission

Expose the workspace Coder field and MasterAgent lifecycle operations through the Effect HttpApi protocol layer. This track defines contracts only; it does not implement handlers or regenerate the SDK.

Target branch: `feature/UnrealViewer`.

## Dependencies

- A0 shared contracts.

## Files

### Create

```text
packages/protocol/src/groups/workspace-master-agent.ts
packages/protocol/test/workspace-master-agent.test.ts
```

### Modify

```text
packages/protocol/src/groups/workspace.ts
```

Adapt filenames to the existing protocol group structure if necessary, but keep MasterAgent definitions in a dedicated module and limit the shared workspace file to composition/import wiring.

## Required implementation

1. Ensure workspace response/patch contracts expose `coderModel` through the A0 schema.
2. Define authenticated operations equivalent to:

```text
workspace.masterAgent.get
workspace.masterAgent.ensure
workspace.masterAgent.reset
```

3. Use A0 request/result schemas rather than duplicating shapes.
4. Define documented error variants consistent with existing workspace handlers:
   - workspace not found
   - block/functionality instance not found
   - wrong functionality ID
   - stale binding revision/session
   - reset blocked because session is busy or has pending input
   - permission/auth errors where applicable
5. Register the MasterAgent protocol module in the workspace API group.

## Endpoint semantics

### Get

Returns the current binding or a typed not-bound/not-found result according to repository conventions. It must not create a session.

### Ensure

Idempotently returns an existing binding or creates one through the host service.

### Reset

Requires expected session ID and expected revision. It creates a new binding only when the current session is eligible.

## Important boundaries

- Do not add a prompt endpoint.
- Do not add a Coder-model argument to MasterAgent lifecycle operations.
- Do not implement handler/service logic.
- Do not manually modify generated SDK output.
- Do not rename operations after this track is handed to G1 without restarting SDK generation.

## Tests

Protocol tests should verify:

- Request and response schemas encode/decode.
- `coderModel` accepts null and the existing model selection representation.
- Reset requires both optimistic-concurrency fields.
- Event and binding schemas are exported through the expected protocol path if events are protocol-visible.

## Verification

```bash
bun --cwd packages/protocol typecheck
bun test packages/protocol/test/workspace-master-agent.test.ts
```

## Deliverable

A complete, frozen protocol commit ready for G1 SDK generation and S1 handler implementation.

## Handoff to G1

Provide the exact P1 merge commit hash. G1 must generate from that commit and should contain no handwritten protocol edits.
