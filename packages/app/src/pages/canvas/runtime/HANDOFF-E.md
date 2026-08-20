# Hand-off E — Workspace Not-Found Recovery

- Files changed
  - `packages/core/src/workspace/service.ts`
    - Added `WorkspaceNotFoundError` (`_tag: "Workspace.NotFoundError"`) with `workspaceID`.
    - `Workspace.Service` methods now surface this error for get/update/remove/duplicate/layout operations.
    - `get` now validates existence via `requireWorkspace` instead of returning `undefined`.
    - `layout.get`/`layout.save` now check workspace existence before resolving layout.
  - `packages/protocol/src/groups/workspace.ts`
    - Added protocol error `WorkspaceNotFoundError` with `workspaceID`, `message`, and `httpApiStatus: 404`.
    - Added this error to workspace endpoint error unions for get/update/remove/duplicate/layout get/save.
  - `packages/server/src/handlers/workspace.ts`
    - Added `mapWorkspaceError` to convert service `_tag === "Workspace.NotFoundError"` to protocol `WorkspaceNotFoundError`.
    - Other workspace failures continue to map to `WorkspaceError`.
  - `packages/core/src/workspace/chat-relay-session.ts`
    - Wrapped workspace reads in local `catchTag("Workspace.NotFoundError")` mapping so this service keeps domain-local error tags.
  - `packages/core/src/workspace/master-agent.ts`
    - Same workspace-missing mapping strategy as chat-relay service.
  - `packages/app/src/pages/canvas/manager.ts`
    - Added workspace-id invalidation recovery for 404 via status-based checks (`error.status === 404` / `cause.status`).
    - Added single-flight recovery path that clears local workspace state, increments `workspaceEpoch`, repicks a workspace, re-syncs layout/bindings, and replays local dirty edits when possible.
    - Added optional `onWorkspaceInvalidated` and exposed `workspaceEpoch` for host coordination.
    - Wrapped core workspace write/read operations with `withWorkspaceRecovery`.
  - `packages/app/src/pages/canvas/workspace.tsx`
    - Wired `onWorkspaceInvalidated` to clear persisted block bindings.
    - Reacts to `workspaceEpoch` with a cleanup effect to clear any stale block bindings across a workspace switch.
  - `packages/core/test/workspace-handover.test.ts`
    - Narrowed union-typed error assertions after workspace not-found now being explicitly typed on service layout endpoints.

- Validation
  - `bun typecheck` (from `packages/core`): pass
  - `bun typecheck` (from `packages/server`): pass
  - `bun typecheck` (from `packages/protocol`): pass
  - `bun typecheck` (from `packages/app`): currently fails on pre-existing unrelated test/type issues (unrelated to this work; see listed diagnostics in run output).

- Runtime expectations
  - A deleted/stale workspace ID now returns `WorkspaceNotFoundError` from protocol with HTTP 404 when using `throwOnError: true`.
  - Recovery is triggered only for 404-like paths and remains a no-op for non-404 failures.
  - Host UI is notified and clears session-bound block bindings when workspace identity changes.
