# Track U1 — Route-Independent Session Surface

## Mission

Extract the existing opencode session-page UI into a reusable component that can render an explicitly targeted session inside a canvas block while preserving routed session behavior.

Target branch: `feature/UnrealViewer`.

## Dependencies

None. This track can begin immediately and should not depend on backend or generated SDK changes.

## Files

### Modify

```text
packages/app/src/pages/session.tsx
```

### Create

```text
packages/app/src/pages/canvas/session-target.tsx
packages/app/src/pages/canvas/session-surface.tsx
packages/app/src/pages/canvas/session-surface.test.tsx
```

Paths may be adjusted to existing app organization, but `session.tsx` remains exclusively owned by this track.

## Required result

Create a route-independent surface capable of rendering the original session page functionality for an explicit session target:

```text
messages
composer
terminal
file tree
review/diff panel
session-level providers and actions
```

The routed page should become a thin adapter that derives its target from route state and renders the same surface.

## Suggested interface

Conceptually:

```tsx
<SessionSurface
  target={{ sessionID, directory?, workspaceID? }}
  mode="canvas" | "route"
  queueEnabled={true}
  focused={boolean}
  onRequestOpenFullPage={...}
/>
```

Use existing application types and context providers rather than introducing duplicate session stores.

## Required behavior

1. Explicitly target the supplied session instead of reading an implicit route ID deep in the component tree.
2. Preserve the existing routed session page behavior.
3. Permit two SessionSurface instances with different session IDs on one canvas.
4. Keep per-surface UI state isolated where necessary.
5. Scope keyboard commands and global actions to the focused surface/block.
6. Ensure portals, DOM IDs, terminal mounts, review panels, and composer focus do not collide between instances.
7. Expose the existing composer option needed by Q1 to enable queue delivery.
8. Do not make SDK calls for MasterAgent binding; M1/M2 own backend communication.

## Important boundaries

- Do not register `builtin:master-agent` in `workspace.tsx`.
- Do not create or ensure a MasterAgent session.
- Do not fork or copy the prompt-input component.
- Do not add queue storage.
- Do not add the Coder selector.
- Do not require a fake nested router.

## Tests

Cover:

1. Routed session page still renders through the extracted surface.
2. Explicit session target renders the correct messages/state.
3. Two surfaces can mount simultaneously with different sessions.
4. Keyboard command applies only to the focused surface.
5. Composer receives the target session and queue option.
6. Terminal/file/review providers are present and do not share unintended mutable state.
7. Unmount/remount does not mutate the host binding or create a session.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/session-surface.test.tsx
```

Run any existing routed-session tests affected by the extraction.

## Deliverable

A reusable, explicit-target session surface with no MasterAgent-specific backend logic.

## Handoff

Document the component props and focus contract for U2, Q1, and I1.
