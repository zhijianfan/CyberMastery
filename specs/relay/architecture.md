# ChatRelay Block — Session Bridge Architecture

Status: adopted
Companion: [oauth.md](./oauth.md), [chat-relay-session-migration.md](./chat-relay-session-migration.md)

The former ChatProxy UI/API/worker transport is removed. The Core
`chat_relay_payload` table/service is dormant and has no active production
caller, but remains untouched for the first release containing that removal.
Existing `Global.Path.data/chat-proxy` browser-profile directories are also
untouched for that release. Any export or deletion is a separate explicit
change; neither surface is part of the active runtime below.

## 1. Objective

`builtin:chat-relay` is now a thin session-bridge block. Its role is to hold a
binding to an OpenCode Session and render that session through the shared session
surface.

## 2. Component and deployment view

```
Canvas page / block model
    builtin:chat-relay
      └── blockID
      └── sessionID binding
      └── UI preferences
            |
            v
    ChatRelay binding service (packages/core)
      └── get / ensure / reset routes
      └── group: server.workspace.chatRelay
            |
            v
    Session store and runtime (OpenCode SessionV2)
      └── auth: CodexAuthPlugin
      └── provider: openai
      └── endpoint: https://chatgpt.com/backend-api/codex/responses
            |
            v
    CanvasSessionSurface
      └── composer + streaming events + auth screens + messages
```

## 3. ChatRelay block contract

- `builtin:chat-relay` owns only:
  - `blockID`
  - UI prefs (for rendering and user overrides)
- The server-owned FunctionalityInstance owns the `sessionID` binding, resolved
  through `server.workspace.chatRelay`; layout/local browser state never does.
- No provider transport, OAuth state, or custom queue/payload/message state is stored in
  the block.
- Runtime capture and response handling are delegated to normal Session execution.

## 4. Binding service

`packages/core/src/workspace/chat-relay-session.ts` mirrors `master-agent` binding
behavior and exposes:

- `GET /api/workspace/:workspaceID/chat-relay/:blockID`
- `POST /api/workspace/:workspaceID/chat-relay/:blockID/ensure`
- `POST /api/workspace/:workspaceID/chat-relay/:blockID/reset`
- Protocol group: `server.workspace.chatRelay`

The service reads and writes the block↔session binding and validates workspace
scoping. `ensure` creates or reuses a session-bound binding; `reset` invalidates
the current binding for explicit user remount.

## 5. Session semantics

- The bound session is a normal OpenCode Session with the same auth pipeline used
  for Codex in Opencode.
- OAuth is provided by `CodexAuthPlugin` from
  `packages/opencode/src/plugin/openai/codex.ts` (client id
  `app_EMoamEEZ73f0CkXaXp7hrann`, issuer `https://auth.openai.com`).
- Inference is routed through the OpenCode openai provider to
  `https://chatgpt.com/backend-api/codex/responses`.
- Session message history, stream events, and auth screens are owned by
  `SessionV2` and surfaced through the UI surface.

## 6. Frontend composition

- `ChatRelayBody` no longer renders relay transport controls.
- It renders `CanvasSessionSurface` from the binding-provided `sessionID`.
- `CanvasSessionSurface` owns composer, live streaming event rendering, and
  auth prompt flow; block logic is limited to binding state coordination.

## 7. Migration rationale

- Previous implementation sent a Codex token to
  `https://chatgpt.com/backend-api/conversation`, which returns a 405 in this
  context.
- The session path resolves this by using the codex-validated route through the
  native auth/plugin/provider stack: `.../backend-api/codex/responses`.

## 8. Removed from current architecture

- `packages/relay/src/provider/{chat-relay.ts,chatgpt.ts,oauth.ts,sse.ts}`
- Credentials/session/thread files under relay storage (`credentials.json`,
  `session.json`, `operating-context.jsonl`)
- `/api/relay/*` endpoints and relay-local status polling/state transfer
- Block-local message queue, important payload storage, and disposable transport
  fields

“Removed” here means removed from active transport and callers. The dormant
Core payload table/service and existing ChatProxy profile directories are
retained for the compatibility window described above.
