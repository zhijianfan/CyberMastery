# Task A — Block Runtime protocol contracts (worker 1 of 8)

You are worker 1 of 8. Implement ONLY this task.
- Edit ONLY the files listed as your owned files. Never touch other files, shared configs, lockfiles, or generated code.
- Read any existing code you need first; follow the repo conventions (bun workspace, .js import suffixes, Effect v4 patterns, AGENTS.md style).
- Do not run repo-wide builds, typechecks, or tests — the master integrates and tests. A quick targeted check of your own code is allowed.
- Do not wait for, check on, or communicate with other workers.
- When done, reply with: files changed, what was implemented, what was left undone or uncertain.

## Owned files (create; touch nothing else)
- `packages/protocol/src/groups/block-runtime.ts` (new)
- `packages/protocol/src/groups/block-runtime.test.ts` (new)

## Context
The repo is a bun monorepo at D:\OpencodeDev. You define the transport-neutral
Block Runtime protocol: semantic resource events, snapshots, subscriptions,
reconnect/resync, and command envelopes. Everything is RESOURCE-oriented
(auth/session/message/message-part/permission), never block-oriented, and never
ChatRelay-UI-specific. Other workers (backend gateway, frontend store, ChatRelay
adapter) code against the shapes you canonize; they carry local copies until the
master integrates.

## Inspect first (read-only)
- `packages/protocol/src/groups/event.ts` — the `schema()`/`make()` pattern,
  `HttpApiGroup.make("server.event")`, `HttpApiEndpoint.get(...)`,
  `HttpApiSchema.StreamSse`, `OpenApi.annotations`.
- `packages/protocol/src/groups/chat-relay.ts` — recent example: error classes,
  `@opencode-ai/schema/*` imports, endpoint style.
- `packages/protocol/src/groups/workspace-master-agent.ts` and
  `packages/schema/src/chat-relay.ts` for schema conventions.
- `packages/schema/src/schema.ts` for shared primitives (IDs, NonNegativeInt).

## Pinned contracts (canonize THESE shapes as Effect schemas)

```ts
export interface RuntimeResourceBinding {
  type: "auth" | "session" | "message" | "message-part" | "permission" | "pty" | "file" | "review"
  id: string
  parentID?: string
}

export interface RuntimeEventEnvelope<T = unknown> {
  cursor: string            // stable position; e.g. "aggregateID:seq"
  revision?: number
  timestamp: number
  resource: RuntimeResourceBinding
  event: string             // discriminated event name, e.g. "session.status"
  data: T
}

export interface RuntimeSnapshot<T> {
  cursor: string
  state: T
}

export interface AuthRuntimeState {
  providerID: string
  status: "missing" | "awaiting-login" | "ready" | "error"
  loginURL?: string
  userCode?: string
  error?: string
}
export interface SessionRuntimeState {
  id: string
  status: "idle" | "busy"
  directory?: string
  modelID?: string
  agentID?: string
  error?: string
}
export interface MessageRuntimeState {
  id: string
  sessionID: string
  role: "user" | "assistant"
  timeCreated?: number
  important?: boolean
}
export interface MessagePartRuntimeState {
  id: string
  messageID: string
  kind: "text" | "tool" | "reasoning" | "permission"
  text?: string
  state?: unknown
  error?: string
}
export interface PermissionRuntimeState {
  id: string
  requestID: string
  sessionID: string
  status: "pending" | "resolved"
  response?: "allow-once" | "allow-always" | "deny"
}

export interface RuntimeResourceState {
  connection: { status: "connecting" | "connected" | "disconnected"; cursor?: string; lastError?: string }
  authByProvider: Record<string, AuthRuntimeState>
  sessionsByID: Record<string, SessionRuntimeState>
  messagesByID: Record<string, MessageRuntimeState>
  partsByID: Record<string, MessagePartRuntimeState>
  permissionsByID: Record<string, PermissionRuntimeState>
}

export type ChatRelayCommand =
  | { type: "auth.start"; providerID: string }
  | { type: "session.create"; modelID?: string; agentID?: string }
  | { type: "session.prompt"; text: string; delivery: "steer" | "queue" }
  | { type: "session.abort" }
  | { type: "permission.respond"; requestID: string; response: "allow-once" | "allow-always" | "deny" }
```

Keep those field names and union members EXACTLY as pinned — other tracks depend
on them. Field types may be tightened/loosened only if the repo's schema
conventions require it; note any deviation in your report.

## What to implement in block-runtime.ts

1. A group factory following event.ts's `make()` pattern, e.g.
   `makeBlockRuntimeGroup()` / `BlockRuntimeGroup`, with schemas for:
   - `RuntimeResourceBinding` (discriminated on `type`),
   - `RuntimeEventEnvelope` with a DISCRIMINATED event union — at minimum:
     `auth.updated`, `session.status`, `session.created`, `message.created`,
     `message-part.updated`, `permission.requested`, `permission.resolved`,
     `connection.error`, `resync.required`. Do not make `data` a bare
     `Record<string, unknown>` as the only contract — each event variant carries
     its typed payload (the state shapes above or deltas thereof).
   - `RuntimeSnapshot<RuntimeResourceState>`,
   - subscription request (bindings + optional resume cursor),
   - `resync-required` and stream-error response payloads.
2. Endpoints (mirroring the existing `/api/event` SSE route style):
   - `block-runtime.snapshot`: POST `/api/block-runtime/snapshot`, body
     `{ bindings: RuntimeResourceBinding[] }` → `RuntimeSnapshot`.
   - `block-runtime.subscribe`: GET `/api/block-runtime/event` SSE
     (`HttpApiSchema.StreamSse`), query params for bindings + optional cursor.
3. Include the `ChatRelayCommand` union as an exported schema (optional command
   dispatch envelope `{ command: ChatRelayCommand }` — backend/frontend map it
   to native calls; you do NOT implement transport for it).
4. Do NOT add ChatRelay UI fields (no showTools/composer/presentation state).

## What to implement in block-runtime.test.ts
- Valid envelopes of each event variant encode + decode round-trip.
- Invalid envelopes (unknown event name, missing resource parentID, bad cursor)
  are rejected.
- Snapshot schema accepts the full RuntimeResourceState; empty state is valid.
- Keep tests dependency-light (plain `bun:test`/`vitest` style used by
  neighboring protocol tests — check an existing `*.test.ts` in the groups dir
  for the pattern).

## Do not touch
- `packages/protocol/src/api.ts` and any central export/registration file
  (the master registers your group at integration — mention it in your report).
- Any package outside `packages/protocol`.
- Generated SDK files.

## Acceptance
- `bun test` inside `packages/protocol` runs your test file green (you may run
  this one targeted command yourself).
- The group file compiles standalone (schemas only reference `effect`,
  `@opencode-ai/schema/*`, and protocol-local code).
- A session event is consumable by more than one block (nothing block-specific).
- Snapshot + resume-or-resync is expressible.
- Report: files changed, implemented, uncertain + any schema-field deviations.
