You are worker 3 of 7 (Wave 1) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task C — Frontend event router, resource store, runtime controller

Goal: replace the current cursor-based, ChatRelay-oriented controller/store with
a generic controller over the EXISTING app event stream (`serverSDK().event`)
— no second SSE, no snapshot-per-event, no numeric cursor parsing.

## Required components (all new files under packages/app/src/pages/canvas/runtime/)

1. `event-router.ts` — `createBlockRuntimeEventRouter()`
   - ONE subscription to `serverSDK().event.listen` per router instance
     (the inlined manager.ts `makeEventListeners` shows the listen API).
   - Index listeners by `RuntimeEventKey` fields (type + optional
     workspaceID/blockID/functionalityID/resourceID) with exact match plus an
     optional adapter predicate `(event) => boolean`.
   - Ref-counted subscriptions; dispose removes listeners and unsubscribes the
     stream when the last listener leaves.
   - Emits a router-level reconnect notification (callback/stream) when the
     underlying event client reconnects (use the API in inlined server-sdk.tsx
     event-stream usage — `serverSDK().event.listen` + `start`).
   - Never stores full domain state.
2. `resource-store.ts` — `createRuntimeResourceStore()`
   - Keyed by explicit resource keys INDEPENDENT of block IDs.
   - State: resolving | ready | stale | error | unavailable | permission-denied.
   - Tracks projection revision when supplied; applies replace/merge/append/
     remove patches exactly per the frozen `RuntimeProjectionPatch`.
   - Coalesces invalidations in one microtask/queueMicrotask (one refresh per
     burst).
   - Ref-counted sharing: two blocks can share a resource projection; per-block
     descriptor/view handles stay separate.
   - No cursor parsing anywhere.
3. `controller.ts` — `createBlockRuntimeController()` (replaces the old
   `createBlockRuntimeController` in the inlined `controller.ts`)
   - One controller per mounted block handle; uses a shared resource bucket only
     when the adapter returns the same explicit resource key.
   - Keeps per-block descriptor, resolved instance, command state, local view
     separate.
   - Aborts resolve/refresh/dispatch on dispose or workspace epoch change
     (AbortController per operation).
   - Refreshes on matching invalidation and reconnect; preserves last good
     projection while stale; bounded retry with jitter; NO timer polling.
4. `registry.ts` — `createBlockRuntimeRegistry()`
   - Rejects duplicate functionality registrations in DEV.
   - Exposes mode and availability per registration.
   - Allows local/static adapters with no backend subscription.
5. `types.ts` — re-export/rewire the old local types to the canonical
   `contracts.ts` (created by worker A — use its exported shapes by name;
   if contracts.ts is not yet on disk when you validate, create a temporary
   local copy matching the inlined contract doc, clearly marked, and re-point
   in HANDOFF-C). Delete the old cursor/snapshot/resource-union code from
   types.ts; keep only narrow aliases needed by remaining imports, marked
   `// @deprecated remove in Task O`.
6. `index.ts` — export the new core API (router, store, controller, registry).
7. Replace `packages/app/src/state/block-runtime-store.ts` with a thin
   re-export of the new resource store or delete it and fix its importers
   WITHIN your owned files only (search importers: only runtime files may be
   edited; list any importer OUTSIDE your ownership in HANDOFF-C as an
   integration action for M).

## Required tests (new, under packages/app/src/pages/canvas/runtime/)

- two blocks sharing one resource share the projection but keep distinct
  descriptors/views;
- descriptor/config update does not overwrite the other block;
- block dispose decrements resource ref count and aborts outstanding work;
- out-of-order lower revision patch is ignored;
- invalidation burst results in exactly one refresh;
- reconnect refreshes every mounted host-backed adapter once;
- workspace epoch change disposes old handles;
- local/static adapter opens no event subscription;
- no mock fallback exists in production code (grep assert).

Use a fake event source with deferred promises (no setTimeout sleeps).

## Owned files (edit ONLY these)

- `packages/app/src/pages/canvas/runtime/event-router.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/resource-store.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/controller.ts` (rewrite)
- `packages/app/src/pages/canvas/runtime/registry.ts` (rewrite)
- `packages/app/src/pages/canvas/runtime/types.ts` (rewire to contracts)
- `packages/app/src/pages/canvas/runtime/index.ts` (rewrite)
- tests for the above (new files beside them)
- `packages/app/src/state/block-runtime-store.ts` (replace with re-export or delete)
- `packages/app/src/pages/canvas/runtime/HANDOFF-C.md`

Do NOT edit `workspace.tsx`, ChatRelay, MasterAgent, manager, diagnostics,
`runtime/contracts.ts` (A's), or any backend file.

## Targeted validation (allowed)

- `cd packages/app && bun test src/pages/canvas/runtime/`
- `bun run typecheck` from `packages/app`

## Handoff

`HANDOFF-C.md`: registry creation API · host mount API D must use · event
matcher shape F/H/I must use · diagnostics hooks L may consume · importers
outside your ownership that M must fix · tests + results · prohibited-pattern
grep result.
