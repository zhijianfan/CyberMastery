# Track M1 — SDK-Independent Manager Controller

## Mission

Implement the manager-side state machine for MasterAgent binding, EventV2 reconciliation, ensure deduplication, reset, and workspace Coder updates behind a handwritten backend port. This allows UI work to proceed before SDK generation.

Target branch: `feature/UnrealViewer`.

## Dependencies

- A0 shared contracts.

## Files

### Create

```text
packages/app/src/pages/canvas/master-agent/types.ts
packages/app/src/pages/canvas/master-agent/port.ts
packages/app/src/pages/canvas/master-agent/reducer.ts
packages/app/src/pages/canvas/master-agent/controller.ts
packages/app/src/pages/canvas/master-agent/controller.test.ts
```

Do not edit `packages/app/src/pages/canvas/manager.ts`; M2 owns composition into the real manager.

## Required responsibilities

The controller is part of the manager/backend-communication layer. It must own:

- Binding load/get state.
- Idempotent `ensure` coordination.
- Per-block loading/error/ready status.
- Reset command state.
- EventV2 binding-update reconciliation.
- Reconnect/refetch behavior.
- Workspace `coderModel` update commands.
- Deduplication of concurrent ensure calls from remounts or multiple effects.

The UI reads controller state and invokes controller actions. UI components must not call the SDK directly.

## Backend port

Define a narrow handwritten interface, conceptually:

```ts
interface MasterAgentPort {
  getBinding(input): Promise<Binding | null>
  ensureBinding(input): Promise<Binding>
  resetBinding(input): Promise<Binding>
  patchWorkspaceCoderModel(input): Promise<WorkspaceInfo>
}
```

Use the app's preferred async/effect/result style. The point is to isolate generated method names in M2.

## Reducer/state requirements

State should be keyed by block ID and include at least:

```text
binding
status
error
in-flight ensure token/promise identity
last observed revision
generation
reset status
```

Event reconciliation rules:

- Ignore an event older than the current revision.
- Treat duplicate events as no-ops.
- Accept a newer binding event and update the target block only.
- On reconnect, refetch persisted binding because transient events may have been missed.
- Never create a session locally.
- Never infer binding from layout state.

## Ensure deduplication

Multiple reactive mounts may request ensure for one block. The controller should share one in-flight request per `(workspaceID, blockID)` and fan out the result rather than issuing duplicate calls.

The host remains responsible for correctness under true multi-client races.

## Workspace Coder mutation

Expose a controller command that patches `coderModel` through the port and updates manager-owned workspace state. The C1 UI must call this command, not the SDK.

## Important boundaries

- No generated SDK imports.
- No edits to `manager.ts`.
- No session message/queue state; the existing Session subsystem owns it.
- No UI rendering.
- No browser persistence of bindings.
- No optimistic creation of a fake session ID.

## Tests

Cover:

1. First load/get.
2. Missing binding triggers ensure according to controller policy.
3. Repeated ensure requests share one in-flight call.
4. Success populates ready state.
5. Error and retry.
6. Newer binding event updates one block.
7. Duplicate/older event ignored.
8. Reconnect refetches persisted binding.
9. Reset forwards expected session/revision and replaces binding.
10. Coder-model patch updates workspace state.
11. One block's actions do not mutate another block's state.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent/controller.test.ts
```

## Deliverable

A generated-SDK-independent controller and port contract ready for M2 and UI consumers.

## Handoff

Document the exact port methods and controller API so M2 and C1 can integrate without editing M1 files.
