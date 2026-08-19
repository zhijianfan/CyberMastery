# Task B — Backend Block Runtime Gateway (worker 2 of 8)

You are worker 2 of 8. Implement ONLY this task.
- Edit ONLY the files listed as your owned files. Never touch other files, shared configs, lockfiles, or generated code.
- Read any existing code you need first; follow the repo conventions (bun workspace, .js import suffixes, Effect v4 patterns, AGENTS.md style).
- Do not run repo-wide builds, typechecks, or tests — the master integrates and tests. A quick targeted check of your own code is allowed.
- Do not wait for, check on, or communicate with other workers.
- When done, reply with: files changed, what was implemented, what was left undone or uncertain.

## Owned files (create; touch nothing else)
- `packages/server/src/runtime/block-runtime-types.ts` (new — your LOCAL copy of
  the pinned contracts; Track A's canonical protocol group is not merged yet)
- `packages/server/src/runtime/resource-snapshot.ts` (new)
- `packages/server/src/runtime/block-runtime-gateway.ts` (new)
- `packages/server/src/runtime/block-runtime-gateway.test.ts` (new)
- `packages/server/src/handlers/block-runtime.ts` (new — handler + LOCAL
  HttpApiGroup mirroring the pinned endpoints; the master swaps in the canonical
  Track A group at integration)

## Context
The repo has an existing event infrastructure you must ADAPT, not duplicate:
- `packages/core/src/event.ts` — `EventV2`: a PubSub-based event bus with durable
  events. Events carry `durable: { aggregateID, seq, version }` and
  `EventV2.latestSequence(db, aggregateID)` gives the current sequence. There is
  also `packages/core/src/event/sql.ts` (EventTable/EventSequenceTable).
- `packages/protocol/src/groups/event.ts` — existing `/api/event` SSE
  (`v2.event.subscribe`) streaming `OpenCodeEvent` payloads.
- `packages/server/src/handlers/chat-relay-session.ts` — recent handler style
  for this repo (Effect handlers, Layer, schema decode).
- `packages/server/src/routes.ts` — READ ONLY. Do NOT register anything; the
  master wires your handler at integration.

## Pinned contracts (local copy in block-runtime-types.ts; keep EXACT)

```ts
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
Plus the five state shapes (`AuthRuntimeState`, `SessionRuntimeState`,
`MessageRuntimeState`, `MessagePartRuntimeState`, `PermissionRuntimeState`) with
the exact fields pinned in tasks/A.md (status unions, IDs, optional fields).

## What to implement

1. `resource-snapshot.ts` — build a `RuntimeSnapshot<RuntimeResourceState>` for a
   set of bindings. Include ONLY resources requested by the active bindings (a
   session binding pulls that session + its messages/parts/permissions; an auth
   binding pulls provider auth state). Cursor format: use the durable event
   infrastructure — pick the max `(aggregateID, seq)` included, encoded as
   `"aggregateID:seq"`, or a documented monotonic server-instance fallback.
   Reuse existing services (session store, message store, provider/auth state)
   — inspect `packages/core/src/session/*`, `packages/core/src/permission/*`,
   `packages/core/src/credential/*`, and the handlers dir to see how the server
   already resolves these.
2. `block-runtime-gateway.ts` — a gateway service that:
   - subscribes to the EXISTING event bus (EventV2 pubsub or the same source the
     `/api/event` SSE route uses — do not create a second event transport),
   - translates native events into `RuntimeEventEnvelope`s with the right
     resource binding and cursor,
   - deduplicates repeated native events and REJECTS out-of-order/duplicate
     (aggregateID, seq) pairs deterministically,
   - batches high-frequency message-part events (e.g. coalesce per tick —
     document your policy in a comment),
   - emits `resync.required` when replay of a requested cursor is unavailable,
   - releases subscriptions when the client disconnects (`Scope`/`ensuring`),
   - exposes diagnostics counters (active subscriptions, last cursor,
     dropped/merged events, resync causes, snapshot failures) as plain fields —
     Track H surfaces them.
3. `handlers/block-runtime.ts` — an Effect handler implementing the LOCAL group
   (snapshot endpoint + SSE subscribe endpoint). SSE must follow the existing
   `/api/event` handler pattern (find and read it). Stream errors and
   `resync-required` are sent as typed envelope payloads, not bare strings.
4. `block-runtime-gateway.test.ts` — with fakes: snapshot returns only bound
   resources; event translation sets correct cursors; duplicate seq ignored;
   gap → resync-required; subscription cleanup on disconnect; batch policy
   merges high-frequency parts. No real network/socket.

## Constraints
- The gateway must know NOTHING about canvas coordinates, block dimensions, or
  presentation state. No imports from `packages/app`.
- Expose auth state through OpenCode-native provider/auth state; add a bridge
  only if the native event surface lacks the transition (document it).
- No fetch to `chatgpt.com/backend-api/*` anywhere.

## Do not touch
- `packages/server/src/routes.ts`, `packages/server/src/handlers.ts` (central).
- `packages/protocol/**`, `packages/core/**`, `packages/app/**`, generated SDK.

## Acceptance
- Snapshot + subscribe compile in `packages/server` (you may run a targeted
  `tsgo --noEmit`-style check of your own files only).
- Two subscribers on the same session receive the same resource updates.
- Report: files changed, implemented, uncertain (esp. which native services you
  reused and any cursor-format decision).
