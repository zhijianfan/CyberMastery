You are worker 4 of 8 (RETRY). Your previous run created files in this repo and then died on a provider error. Continue and finish; do not ask questions.

Owned files — complete or create ONLY these:
- packages/app/src/pages/canvas/runtime/controller.ts (NEW — the main deliverable)
- packages/app/src/state/block-runtime-store.test.ts (NEW)
- packages/app/src/pages/canvas/runtime/controller.test.ts (NEW)
- You may edit ONLY your existing files if they need fixes:
  packages/app/src/state/block-runtime-store.ts,
  packages/app/src/pages/canvas/runtime/types.ts, registry.ts, index.ts

Steps:
1. Read your existing files first: packages/app/src/pages/canvas/runtime/types.ts
   (pinned contracts), registry.ts (adapter registry), index.ts,
   packages/app/src/state/block-runtime-store.ts (store state machine).
2. Implement BlockRuntimeController in runtime/controller.ts:
   - mount(descriptor): resolve adapter by functionalityID from the registry,
     compute bindings via adapter.getBindings, hydrate via
     context.snapshot(bindings), applySnapshot atomically, then subscribe AFTER
     the snapshot cursor.
   - Multi-block subscription reference counting: one backend subscription per
     binding-set+cursor can serve several blocks; unmounting one block must not
     disconnect resources still used elsewhere; the last unmount cleans up the
     transport subscription.
   - Reconnect lifecycle: mark connection state (connecting/connected/
     disconnected), retain the last valid snapshot, try resume from cursor,
     fall back to full snapshot resync; NEVER clear the UI to an uninitialized
     state on temporary disconnect.
   - Dev diagnostics accessor: active block subscriptions, last cursor, resync
     count + reason, batch stats.
3. Write the two test files with local deterministic fakes (no network):
   snapshot followed by ordered events; duplicate cursor ignored; stale
   revision ignored; sequence gap triggers resync; disconnect preserves UI
   state; two blocks bound to one session share one subscription (ref
   counting); last subscriber unmount cleans up; applying a new canvas
   descriptor object does NOT clear runtime resources.
4. Update runtime/index.ts exports if your public API changed.
5. You may run ONLY: bun test on your two test files from packages/app
   (targeted). Do not run repo-wide checks. Do not touch any other files.

Report: files changed, implemented, uncertain.
