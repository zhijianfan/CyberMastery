You are worker 3 of 7 (Wave 1, CONTINUATION) in the block-runtime-v3 run at
D:\OpencodeDev (branch feature/CyberMaster). A previous attempt completed
`controller.ts` (6 tests pass) but MISSED two required files. Implement ONLY
the two files below. Do not read any other file. Do not search anything.
Write the files now.

## What to implement

### 1. `packages/app/src/pages/canvas/runtime/event-router.ts` (NEW)

Export `createBlockRuntimeEventRouter()` returning a `BlockRuntimeEventRouter`
compatible with the contract in `packages/app/src/pages/canvas/runtime/contracts.ts`
(interface `BlockRuntimeEventRouter` — narrow `on`/`off` by RuntimeEventKey;
keep exactly that surface plus a `dispose()`).

Behavior:
- ONE subscription to the injected server event client. The router takes an
  input: `{ listen: (handler: (event: { details: { type: string; properties: unknown } }) => void) => () => void }`
  (shape matches `serverSDK().event.listen`; the real client is injected by
  the provider in Wave-2 integration — your unit tests inject a fake).
- Index listeners by `RuntimeEventKey` fields: exact `type` match plus optional
  exact workspaceID/blockID/functionalityID/resourceID. A listener may also
  pass a predicate `(event) => boolean` for non-indexed matching.
- Ref-counted: `on(key, handler)` returns an unsubscribe; the underlying
  subscription is torn down when the last listener leaves.
- `dispose()` removes every listener and unsubscribes.
- Emits reconnect notifications: `onReconnect(handler)` — call handlers when
  the owner calls `router.notifyReconnect()` (the provider calls this from the
  app event client's reconnect path; you do not need to detect it yourself).
- Never stores domain state. No cursor parsing. No timers.

### 2. `packages/app/src/pages/canvas/runtime/resource-store.ts` (NEW)

Export `createRuntimeResourceStore()`:
- `upsert(key: string, value: unknown, revision?: number)`,
- `patch(key: string, patch: RuntimeProjectionPatch)` — apply
  replace/merge/append/remove exactly per the frozen contract; IGNORE a patch
  whose `revision` is <= the stored revision,
- `get(key)` returns `{ status, value, revision }` where status is one of
  `resolving | ready | stale | error | unavailable | permission-denied`,
- `setStatus(key, status)`, `markStale(key)`, `invalidate(key)` — coalesces a
  burst of invalidations per key into ONE queued invalidation callback
  (queueMicrotask; exactly one callback per burst),
- `onInvalidate(key, handler)` — the callback the controller uses to trigger
  ONE refresh per burst,
- `retain(key)` / `release(key)` — reference counting; when the count hits
  zero the entry is dropped and callbacks removed,
- `dispose()` clears everything.
- Values are keyed independently of block IDs. No cursor parsing.

### 3. `packages/app/src/pages/canvas/runtime/HANDOFF-C.md`

Write the handoff with: files changed (list ONLY the three files you wrote:
event-router.ts, resource-store.ts, HANDOFF-C.md — plus note controller.ts and
its test were completed in the earlier attempt), tests run + exact result,
public exports, integration actions M must take (importers of the OLD
`createBlockRuntimeController` that live OUTSIDE the runtime dir still point at
controller.ts — M rewires them), prohibited-pattern grep result over your diff.

## Required tests (same dir)

`event-router.test.ts` and `resource-store.test.ts`:
- two listeners same key both fire; unsubscribe one; last unsubscribe tears
  down the underlying subscription;
- predicate listener fires only on match;
- reconnect notification reaches all listeners;
- patch replace/merge/append/remove applied; lower/equal revision ignored;
- invalidate burst → exactly one onInvalidate callback;
- release to zero drops the entry; dispose clears everything.
Use a fake bus with synchronous emit. No timers.

## Owned files (edit ONLY these)

- `packages/app/src/pages/canvas/runtime/event-router.ts`
- `packages/app/src/pages/canvas/runtime/resource-store.ts`
- `packages/app/src/pages/canvas/runtime/event-router.test.ts`
- `packages/app/src/pages/canvas/runtime/resource-store.test.ts`
- `packages/app/src/pages/canvas/runtime/HANDOFF-C.md`

## Targeted validation (allowed)

- `cd packages/app && bun test src/pages/canvas/runtime/event-router.test.ts src/pages/canvas/runtime/resource-store.test.ts`
- `bun run typecheck` from `packages/app`

Do NOT edit controller.ts, types.ts, registry.ts, index.ts (already done),
workspace.tsx, ChatRelay, MasterAgent, manager, or backend files. Do NOT read
any file. Implement from this brief and the contract interfaces referenced
above.
