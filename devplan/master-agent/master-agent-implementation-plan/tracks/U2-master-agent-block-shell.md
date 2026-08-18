# Track U2 — MasterAgent Block Shell

## Mission

Create the standalone canvas block UI for `builtin:master-agent`, using mock/controller props and the reusable U1 session surface. This track builds presentation states only and performs no direct backend communication.

Target branch: `feature/UnrealViewer`.

## Dependencies

- U1 component contract, or a temporary local mock matching the agreed interface.

## Files

### Create

```text
packages/app/src/pages/canvas/master-agent/block.tsx
packages/app/src/pages/canvas/master-agent/loading.tsx
packages/app/src/pages/canvas/master-agent/master-agent.css
packages/app/src/pages/canvas/master-agent/block.test.tsx
```

Do not edit `workspace.tsx` or `manager.ts`.

## Required component states

The block should render explicit states for:

```text
loading/ensuring binding
ready with bound session
binding missing and recoverable
backend error with retry
permission denied
session reset unavailable because busy/pending
session unavailable or deleted
```

The ready state renders the U1 SessionSurface using a supplied binding/session ID.

## Suggested props

Conceptually:

```ts
interface MasterAgentBlockProps {
  blockID: string
  binding: MasterAgentBinding | null
  status: "loading" | "ready" | "error" | "permission-denied"
  error?: unknown
  focused: boolean
  queueEnabled: boolean
  canReset: boolean
  onRetry(): void
  onReset(): void
  onFocus(): void
  coderSelector?: JSX.Element
}
```

Use actual SolidJS conventions and repository types.

## UI requirements

- Fit within the existing canvas card/block chrome.
- Show a clear MasterAgent identity without duplicating the entire workspace toolbar.
- Provide a small session/reset action in the block chrome or session header.
- Reserve a location for the C1 Workspace Coder selector.
- Do not hide the original session page's terminal, file tree, or review panel.
- Keep focus/keyboard behavior compatible with multiple blocks.
- Avoid route navigation as an implementation dependency; an optional “Open full page” action may be exposed through a callback.

## Important boundaries

- No SDK imports.
- No manager imports other than types/interfaces if already stable.
- No direct session ensure/reset calls.
- No `coderModel` persistence.
- No queue implementation or local pending-input state.
- No `workspace.tsx` registration.

## Tests

Cover:

1. Loading state.
2. Ready state passes the correct explicit session target to SessionSurface.
3. Retry action from error state.
4. Permission-denied state.
5. Reset disabled while busy/pending.
6. Coder-selector slot renders without owning its behavior.
7. Focus callback and focused styling.
8. No backend calls occur from the presentational component.

## Verification

```bash
bun --cwd packages/app typecheck
bun test packages/app/src/pages/canvas/master-agent/block.test.tsx
```

## Deliverable

A mock-driven, backend-independent block component ready for I1 composition.
