# Track M2 — Generated SDK Adapter and Manager Integration

## Mission

Implement the M1 backend port using G1's generated SDK methods and compose the MasterAgent controller into the existing canvas manager.

Target branch: `feature/UnrealViewer`.

## Dependencies

- M1 manager controller and port.
- G1 generated SDK.

This is the only frontend implementation track that must wait for SDK generation.

## Files

### Create

```text
packages/app/src/pages/canvas/master-agent/sdk-port.ts
packages/app/src/pages/canvas/master-agent/sdk-port.test.ts
```

### Modify

```text
packages/app/src/pages/canvas/manager.ts
```

Do not edit `workspace.tsx`.

## Required implementation

1. Map G1 generated operations to the M1 handwritten `MasterAgentPort`:
   - get binding
   - ensure binding
   - reset binding
   - workspace `coderModel` patch
2. Normalize generated SDK success/error types into the controller's expected result/error types.
3. Instantiate one MasterAgent controller within the existing canvas manager lifecycle.
4. Feed the controller:
   - current workspace ID/state
   - EventV2 stream
   - reconnect lifecycle
   - project configuration/permissions where the manager already owns them
5. Expose a narrow manager API, conceptually:

```ts
manager.masterAgent.state(blockID)
manager.masterAgent.ensure(blockID)
manager.masterAgent.retry(blockID)
manager.masterAgent.reset(blockID)
manager.masterAgent.setCoderModel(modelOrNull)
```

Use SolidJS signals/stores consistent with the existing manager.

## Event integration

Listen for `workspace.master-agent.binding.updated` in the manager's existing server-event path and forward it to the M1 controller. Do not create a second global event connection.

On reconnect or workspace switch, trigger the controller's persisted-state reconciliation rather than trusting missed transient events.

## Permissions

The manager already loads project config. Expose derived flags needed by UI, such as whether `task` is denied, but keep host enforcement in R1.

## Important boundaries

- Do not put MasterAgent business logic directly in `manager.ts`; instantiate and delegate to M1.
- Do not render UI.
- Do not own Session messages or queue state.
- Do not hand-edit generated SDK files.
- Do not add a local persistence layer for bindings.

## Tests

Cover:

1. Generated method arguments match protocol expectations.
2. Generated success values normalize to M1 binding types.
3. Typed errors normalize predictably.
4. Workspace patch sends `coderModel` including null.
5. Manager forwards binding-update events to the controller.
6. Reconnect calls controller reconciliation.
7. Manager exposes only the intended narrow MasterAgent API.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent/sdk-port.test.ts
```

## Deliverable

A thin generated-SDK adapter and manager composition layer, leaving rendering to U2/I1.

## Merge notes

This track exclusively owns `packages/app/src/pages/canvas/manager.ts` for the feature.
