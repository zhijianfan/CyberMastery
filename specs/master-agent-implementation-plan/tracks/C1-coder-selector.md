# Track C1 — Workspace Coder Selector UI

## Mission

Create the MasterAgent block control that enables/disables Coder routing and selects the workspace-wide Coder model through the M1 controller API.

Target branch: `feature/UnrealViewer`.

## Dependencies

- A0 shared workspace `coderModel` type.
- M1 controller interface.

Generated SDK types are not required.

## Files

### Create

```text
packages/app/src/pages/canvas/master-agent/coder-selector.tsx
packages/app/src/pages/canvas/master-agent/coder-selector.test.tsx
```

Do not edit `manager.ts`, `workspace.tsx`, or generated SDK files.

## Required UI behavior

1. Show an option named **Coder**.
2. Make workspace scope explicit with text such as **Workspace Coder**.
3. Support disabled state represented by `coderModel: null`.
4. Support selecting a provider/model using the app's existing model picker or model-selection components.
5. Persist changes through the manager/controller action, never through a direct SDK call.
6. Show saving, saved, and error states consistent with existing workspace settings.
7. Show a warning when the selected Coder model equals the primary model, but allow it.
8. Show a clear unavailable/incompatible model state when known.
9. Show a permission warning and disable delegation controls when `permissionDenied(config, "task")` is true.
10. Explain briefly that coding work is delegated while the primary model remains the coordinator.

## Suggested interaction model

```text
Coder toggle off
  → patch coderModel = null

Coder toggle on with no previous selection
  → open model picker or choose an existing sensible selection only if the app already has a defined default

Model selected
  → patch coderModel = selected model
```

Do not invent a universal “less capable” model ranking. The user chooses the model.

## Important boundaries

- No client-side task classification.
- No per-block model override.
- No prompt/session mutation.
- No direct generated SDK import.
- No host permission assumptions; R1 independently enforces `task`.
- No silent automatic fallback to the primary model.

## Tests

Cover:

1. Null field renders Coder disabled.
2. Enabling/selecting invokes the controller with the correct model.
3. Disabling invokes the controller with null.
4. Loading and error states.
5. Same-as-primary warning.
6. Task-permission denial.
7. Known unavailable/incompatible model state.
8. UI labels the setting as workspace-wide.
9. Component does not import or call the SDK directly.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent/coder-selector.test.tsx
```

## Deliverable

A reusable Workspace Coder selector component ready to be inserted into U2/I1.
