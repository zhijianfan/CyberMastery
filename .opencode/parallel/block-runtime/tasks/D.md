# Task D — Frontend Runtime Resource Store + Controller (worker 4 of 8)

You are worker 4 of 8. Implement ONLY this task.
- Edit ONLY the files listed as your owned files. Never touch other files, shared configs, lockfiles, or generated code.
- Read any existing code you need first; follow the repo conventions (bun workspace, .js import suffixes, solid-js stores, AGENTS.md style).
- Do not run repo-wide builds, typechecks, or tests — the master integrates and tests. A quick targeted check of your own code is allowed.
- Do not wait for, check on, or communicate with other workers.
- When done, reply with: files changed, what was implemented, what was left undone or uncertain.

## Owned files (create/replace; touch nothing else)
- `packages/app/src/state/block-runtime-store.ts` (new; dir `packages/app/src/state` does not exist yet)
- `packages/app/src/state/block-runtime-store.test.ts` (new)
- `packages/app/src/pages/canvas/runtime/types.ts` (REPLACE the P0 placeholder content — nothing imports it yet)
- `packages/app/src/pages/canvas/runtime/registry.ts` (REPLACE placeholder)
- `packages/app/src/pages/canvas/runtime/controller.ts` (new)
- `packages/app/src/pages/canvas/runtime/controller.test.ts` (new)
- `packages/app/src/pages/canvas/runtime/index.ts` (REPLACE placeholder re-exports with yours)

## Context
Generic frontend layer for the Block Runtime: hydrates snapshots, consumes live
events, normalizes resources by identity, handles reconnects, and exposes typed
block adapter selectors. The ChatRelay block (Track E) and any future block use
it; nothing canvas-layout-specific may live here.

## Inspect first (read-only)
- `packages/app/src/pages/canvas/master-agent/block.tsx` and the master-agent
  files — existing solid-js projection/store patterns to imitate.
- `packages/app/src/pages/canvas/manager.ts` and `workspace.tsx` — READ ONLY:
  understand what descriptors look like, but import nothing from workspace.tsx
  (it must not import you either at this stage).
- `packages/app/src/context/server-sdk.ts` — SDK access pattern.
- Check how the app polls/subscribes to server events today (search
  `packages/app/src` for existing SSE/event usage) so your subscribe API shape
  matches reality; if no client transport exists yet, define a minimal
  `subscribe(bindings, cursor, onEvent)` seam and mark `TODO(integration)`.

## Pinned contracts (implement in runtime/types.ts — keep EXACT)

```ts
export interface BlockDescriptor {
  id: string
  functionalityID: string
  layout: { x: number; y: number; width: number; height: number }
  bindings: Record<string, string | undefined>
  config?: unknown
}
export interface RuntimeResourceBinding {
  type: "auth" | "session" | "message" | "message-part" | "permission" | "pty" | "file" | "review"
  id: string
  parentID?: string
}
export interface RuntimeEventEnvelope<T = unknown> {
  cursor: string
  revision?: number
  timestamp: number
  resource: RuntimeResourceBinding
  event: string
  data: T
}
export interface RuntimeSnapshot<T> { cursor: string; state: T }
export interface RuntimeResourceState {
  connection: { status: "connecting" | "connected" | "disconnected"; cursor?: string; lastError?: string }
  authByProvider: Record<string, AuthRuntimeState>
  sessionsByID: Record<string, SessionRuntimeState>
  messagesByID: Record<string, MessageRuntimeState>
  partsByID: Record<string, MessagePartRuntimeState>
  permissionsByID: Record<string, PermissionRuntimeState>
}
```
Plus the five state shapes exactly as pinned in tasks/A.md.

```ts
export interface BlockRuntimeContext {
  snapshot(bindings: RuntimeResourceBinding[]): Promise<RuntimeSnapshot<RuntimeResourceState>>
  subscribe(bindings: RuntimeResourceBinding[], cursor: string, onEvent: (e: RuntimeEventEnvelope) => void): () => void
}
export interface BlockRuntimeAdapter<TDescriptor extends BlockDescriptor, TView, TCommand> {
  getBindings(descriptor: TDescriptor): RuntimeResourceBinding[]
  hydrate(descriptor: TDescriptor, context: BlockRuntimeContext): Promise<RuntimeSnapshot<unknown>>
  select(descriptor: TDescriptor, resources: RuntimeResourceState): TView
  dispatch(descriptor: TDescriptor, command: TCommand, context: BlockRuntimeContext): Promise<void>
}
```

## What to implement

1. `block-runtime-store.ts` — normalized stores keyed by provider/session/
   message/part/permission ID plus connection state (solid-js `createStore`
   with `{ connection, authByProvider, sessionsByID, messagesByID, partsByID,
   permissionsByID }`). Expose atomic `applySnapshot(snapshot)` (replace only
   affected resource sets), `applyEvent(envelope)`, and selectors. Reject stale
   revisions; dedupe repeated cursors; detect sequence gaps (cursor ordering per
   resource) and signal `needsResync`; batch high-frequency text/part events to
   one UI flush per animation frame (requestAnimationFrame, with a fallback for
   non-browser tests).
2. `runtime/controller.ts` — `BlockRuntimeController`:
   - mount(descriptor): resolve adapter from registry → compute bindings →
     hydrate snapshot → apply atomically → subscribe AFTER the snapshot cursor.
   - multi-block subscription reference counting: one backend subscription per
     (binding set, cursor) may serve several blocks; unmounting one block must
     not disconnect resources still used elsewhere; last unmount cleans up.
   - reconnect lifecycle: mark connection state, retain last valid rendered
     snapshot, attempt resume from cursor, fall back to full snapshot resync;
     NEVER clear the UI to an "uninitialized" state during a temporary
     disconnect.
   - dev diagnostics accessor: active block subscriptions, last cursor,
     resync count + reason, batch stats.
3. `runtime/registry.ts` — adapter registry keyed by `functionalityID`
   (`register(descriptor, adapter)`, `resolve(functionalityID)`). One-way reads:
   the controller may read descriptors/bindings but must never store runtime
   entities inside a canvas block.
4. `runtime/index.ts` — re-export the public API (types, store, controller,
   registry).
5. Tests (`block-runtime-store.test.ts`, `controller.test.ts`) — use local
   deterministic fakes (no network):
   - snapshot followed by ordered events;
   - duplicate cursor ignored; stale revision ignored;
   - sequence gap triggers resync request;
   - disconnect preserves existing UI state;
   - two blocks bound to one session share one subscription (ref counting);
   - last subscriber unmount cleans up the transport subscription;
   - applying a NEW canvas layout/descriptor object does not clear runtime
     resources (snapshot state survives an unrelated descriptor change).

## Do not touch
- `workspace.tsx`, `manager.ts`, `blocks/chat-relay/**`, `canvas.css`,
  `master-agent.e2e.test.tsx`, any `packages/*` outside `packages/app/src`
  (and inside app: only your owned files).

## Acceptance
- Focused tests above pass (`bun test` from `packages/app` on your files — you
  may run this targeted command).
- No five-second poll anywhere in your code.
- Report: files changed, implemented, uncertain.
