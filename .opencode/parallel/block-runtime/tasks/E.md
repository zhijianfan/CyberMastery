# Task E — ChatRelay Adapter + UI Migration (worker 5 of 8)

You are worker 5 of 8. Implement ONLY this task.
- Edit ONLY the files listed as your owned files. Never touch other files, shared configs, lockfiles, or generated code.
- Read any existing code you need first; follow the repo conventions (bun workspace, .js import suffixes, solid-js, AGENTS.md style).
- Do not run repo-wide builds, typechecks, or tests — the master integrates and tests. A quick targeted check of your own code is allowed.
- Do not wait for, check on, or communicate with other workers.
- When done, reply with: files changed, what was implemented, what was left undone or uncertain.

## Owned files (create/edit; touch nothing else)
- `packages/app/src/pages/canvas/blocks/chat-relay/view.tsx`
- `packages/app/src/pages/canvas/blocks/chat-relay/types.ts`
- `packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts` (new — adapter + view model + MOCK context)
- `packages/app/src/pages/canvas/blocks/chat-relay/index.ts`
- `packages/app/src/pages/canvas/blocks/chat-relay/runtime.test.ts` (new)
- `packages/app/src/pages/canvas/blocks/chat-relay/view.test.tsx` (new)
- `packages/app/src/pages/canvas/canvas.css`

## HARD CONSTRAINT (do not break the canvas)
`packages/app/src/pages/canvas/workspace.tsx` imports from your `index.ts`:
`import { ChatRelayBody, iconClose, iconRelay, iconSpin } from "./blocks/chat-relay"`.
Your `index.ts` MUST keep exporting those four names. Do NOT edit workspace.tsx.

## Context
Current state (P0 extraction): `view.tsx` renders a slim binding-driven block —
`onMount` calls `serverSDK().client.v2.workspace.chatRelay.ensure` (native
binding bootstrap from a previous migration), then renders `CanvasSessionSurface`
bound to the session. Tracks B/C/D (backend gateway, native chat adapter,
frontend runtime store) are being built in PARALLEL and are NOT available to
import. You develop against the PINNED contracts with a local MOCK context;
the master wires the real context at integration.

## Pinned contracts (implement in your files; keep EXACT)

```ts
export interface BlockDescriptor {
  id: string
  functionalityID: string
  layout: { x: number; y: number; width: number; height: number }
  bindings: Record<string, string | undefined>
  config?: unknown
}
export interface ChatRelayBlockDescriptor extends BlockDescriptor {
  functionalityID: "builtin:chat-relay"
  bindings: { sessionID?: string }
  config?: { showTools?: boolean; showPermissions?: boolean; showTerminal?: boolean }
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
// Auth/Session/Message/MessagePart/Permission state shapes: exactly as pinned in tasks/A.md.
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
export type ChatRelayCommand =
  | { type: "auth.start"; providerID: string }
  | { type: "session.create"; modelID?: string; agentID?: string }
  | { type: "session.prompt"; text: string; delivery: "steer" | "queue" }
  | { type: "session.abort" }
  | { type: "permission.respond"; requestID: string; response: "allow-once" | "allow-always" | "deny" }
```

## What to implement

1. `types.ts` — the pinned types above (replacing the current minimal
   ChatRelayBodyProps; keep a compatible props type for view.tsx).
2. `runtime.ts`:
   - `ChatRelayRuntimeView` — selected from `RuntimeResourceState` + descriptor:
     connection status, auth status + device-flow details (loginURL/userCode),
     session identity/status, ordered messages and parts, pending permissions,
     model/agent details where available, recoverable errors.
   - `ChatRelayRuntimeAdapter` implementing `BlockRuntimeAdapter<ChatRelayBlockDescriptor,
     ChatRelayRuntimeView, ChatRelayCommand>`:
     `getBindings` from `descriptor.bindings.sessionID` (+ auth binding);
     `hydrate` through the context; `select` builds the view model;
     `dispatch` maps `ChatRelayCommand` → context/native calls (session.prompt
     with steer/queue, session.abort, permission.respond, auth.start,
     session.create).
   - `createMockChatRelayContext()` — deterministic in-memory BlockRuntimeContext
     that scripts a realistic sequence (auth missing → auth.start → awaiting-login
     → ready → session created → user message → assistant message with streaming
     text parts → permission request → resolve → idle) and supports duplicate/
     stale events. Mark it clearly as the integration placeholder.
3. `view.tsx` — restructure `ChatRelayBody` to:
   - derive state from `adapter.select(...)` over the runtime resources (mock
     context by default),
   - keep the `networkDenied()` permission gate EXACTLY as-is,
   - render auth panel (awaiting-login with URL/code), session timeline with
     INCREMENTAL streaming text parts, tool/permission states, busy/idle
     indicators, disconnected banner that keeps history, error banner that does
     NOT wipe history,
   - keep composer text and submit errors as component-local state
     (`createSignal`),
   - disable/label the composer from authoritative auth/session status,
   - keep rendering `CanvasSessionSurface` for the live session timeline when a
     real binding exists — the adapter adds the runtime layer around it,
   - `important` toggle stays a CyberMaster action referencing OpenCode message
     IDs (UI-only for now, marked TODO),
   - feature-flag seam: `const BLOCK_RUNTIME_V2 = false // TODO(integration):
     Track H flag` — when false the block falls back to the current
     ensure-binding + session-surface path (behavior unchanged from today);
     when true it runs the adapter/runtime path. Both paths must compile.
4. `index.ts` — keep the four existing exports; add your new public exports.
5. Tests: `runtime.test.ts` (binding derivation, view selection from resources,
   command dispatch mapping, mock context scripting) and `view.test.tsx`
   (auth panel appears for awaiting-login; streaming text updates incrementally;
   permission prompt renders; submit failure does NOT overwrite snapshot state;
   disconnected banner preserves history). Use solid-testing-lite or the same
   test tooling neighboring canvas tests use — inspect an existing `*.test.tsx`
   for the pattern.

## Do not touch
- `workspace.tsx`, `manager.ts`, `canvas/runtime/**`, `app/src/state/**`,
  `master-agent/**`, `master-agent.e2e.test.tsx`, `session-surface.tsx`.

## Acceptance
- `bun test` on your two test files from `packages/app` passes (you may run this
  targeted command).
- No `v2.relay.*` calls; no 5-second poll; no chatgpt.com fetch.
- index.ts still exports ChatRelayBody + the three icons.
- Report: files changed, implemented, uncertain.
