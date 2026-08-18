# Track I1 — Canvas Registration and Final UI Integration

## Mission

Register `builtin:master-agent` in the client canvas and compose the completed block shell, session surface, manager controller, queue options, and Coder selector. This is the only UI track that edits `workspace.tsx`.

Target branch: `feature/UnrealViewer`.

## Dependencies

- B1 built-in server/core registration.
- U1 reusable session surface.
- U2 block shell.
- M2 manager integration.
- Q1 queue wiring.
- C1 Coder selector.

## Files

### Create

```text
packages/app/src/pages/canvas/master-agent/index.ts
packages/app/src/pages/canvas/master-agent.integration.test.tsx
```

### Modify

```text
packages/app/src/pages/canvas/workspace.tsx
```

Only add other files when strictly required for final composition; do not absorb logic owned by earlier tracks.

## Required integration

1. Add the MasterAgent block type/functionality mapping using `builtin:master-agent`.
2. Import and render the MasterAgent component for matching blocks.
3. Read binding/status/actions from `manager.masterAgent`.
4. Trigger idempotent ensure through the manager when a valid MasterAgent block mounts and lacks a binding.
5. Pass the explicit bound session target to the U1 surface.
6. Pass Q1's queue-enabled options.
7. Insert C1's Workspace Coder selector in the block UI.
8. Pass task-permission state derived by the manager.
9. Wire reset using expected session ID and revision from the current binding.
10. Scope focus so only the active block handles session shortcuts.
11. Preserve the existing `builtin:chat` behavior. Reuse the shared U1 surface where safe, but do not force a risky migration merely for symmetry.

## Rendering state

The integrated block should clearly handle:

```text
initial load
ensure in progress
ready
retryable backend error
permission denial
stale/reset conflict
busy reset restriction
missing/deleted session
```

## Important boundaries

- Do not put lifecycle or SDK logic directly in `workspace.tsx`.
- Do not store session IDs in layout state.
- Do not implement queue promotion.
- Do not directly patch workspace Coder fields.
- Do not duplicate Coder selector or session surface internals.
- Do not edit generated SDK files.

## Integration tests

Cover:

1. MasterAgent functionality maps to the new block.
2. Mount triggers one manager ensure, even through reactive rerenders.
3. Ready state targets the returned session.
4. Two blocks use distinct manager state and session targets.
5. Binding-update event/reducer result changes only the intended block.
6. Queue action targets the correct session.
7. Coder selector changes workspace state through the controller.
8. Reset changes only one block.
9. Focused block receives keyboard commands.
10. Existing `builtin:chat` still renders.
11. Layout movement/remount does not change binding.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent.integration.test.tsx
bun --cwd packages/app run build
```

Also run U1, U2, M1, M2, Q1, and C1 focused tests together.

## Deliverable

A fully registered and composed MasterAgent canvas block with minimal shared-file changes.

## Merge notes

I1 exclusively owns `packages/app/src/pages/canvas/workspace.tsx` and `master-agent/index.ts` for the feature.
