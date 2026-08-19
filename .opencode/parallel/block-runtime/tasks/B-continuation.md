You are worker 2 of 8 (RETRY). Previous runs failed at startup or stalled. This time: WRITE THE FILES FIRST, validate after. Implement NOW, no questions, no long exploration.

Owned files — create ONLY these five:
- packages/server/src/runtime/block-runtime-types.ts  (local copy of pinned contracts)
- packages/server/src/runtime/resource-snapshot.ts
- packages/server/src/runtime/block-runtime-gateway.ts
- packages/server/src/runtime/block-runtime-gateway.test.ts
- packages/server/src/handlers/block-runtime.ts  (handler + LOCAL HttpApiGroup)

Key pointers (read only these):
- packages/core/src/event.ts — EventV2: PubSub event bus, durable events with { aggregateID, seq, version }, EventV2.latestSequence(db, aggregateID). ADAPT this, do not build a second transport.
- packages/protocol/src/groups/event.ts — existing /api/event SSE route (StreamSse pattern).
- packages/protocol/src/groups/block-runtime.ts — Track A's canonical group (use its SHAPES as your reference for field names; you still ship a local copy of types).
- packages/server/src/handlers/chat-relay-session.ts — handler style.
- packages/core/src/session/, packages/core/src/permission/, packages/core/src/credential/ — services the snapshot resolves.

Pinned contracts (local copy in block-runtime-types.ts — keep EXACT):

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
export interface AuthRuntimeState { providerID: string; status: "missing"|"awaiting-login"|"ready"|"error"; loginURL?: string; userCode?: string; error?: string }
export interface SessionRuntimeState { id: string; status: "idle"|"busy"; directory?: string; modelID?: string; agentID?: string; error?: string }
export interface MessageRuntimeState { id: string; sessionID: string; role: "user"|"assistant"; timeCreated?: number; important?: boolean }
export interface MessagePartRuntimeState { id: string; messageID: string; kind: "text"|"tool"|"reasoning"|"permission"; text?: string; state?: unknown; error?: string }
export interface PermissionRuntimeState { id: string; requestID: string; sessionID: string; status: "pending"|"resolved"; response?: "allow-once"|"allow-always"|"deny" }
```

Implement:
1. resource-snapshot.ts: build RuntimeSnapshot<RuntimeResourceState> for a set of bindings — include ONLY resources requested by active bindings. Cursor = max (aggregateID, seq) included, encoded "aggregateID:seq" (fallback: document a monotonic server counter).
2. block-runtime-gateway.ts: subscribe to the EXISTING event bus (the source the /api/event SSE uses); translate native events → RuntimeEventEnvelope with correct binding + cursor; dedupe (aggregateID, seq); emit resync.required when replay unavailable; release subscriptions on disconnect (Scoped/ensuring); diagnostics counters as plain fields (activeSubscriptions, lastCursor, droppedEvents, mergedEvents, resyncCauses, snapshotFailures).
3. handlers/block-runtime.ts: Effect handler + LOCAL HttpApiGroup mirroring the pinned endpoints: POST /api/block-runtime/snapshot {bindings} → RuntimeSnapshot; GET /api/block-runtime/event SSE (StreamSse) with bindings+cursor query params.
4. block-runtime-gateway.test.ts: fakes only (no network): snapshot returns only bound resources; cursor correctness; duplicate seq ignored; gap → resync-required; cleanup on disconnect; batching merges high-frequency part events.

Rules: no imports from packages/app; no knowledge of canvas layout; no chatgpt.com fetch. Do NOT touch packages/server/src/routes.ts or handlers.ts (central — master registers). You may run only targeted checks of your own files.

Report: files changed, implemented, uncertain.
