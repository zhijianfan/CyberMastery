# ChatRelay — Pseudo Block

> Historical document (obsolete runtime): this file describes the removed
> account relay/ChatProxy implementation and its browser-local OperatingContext
> behavior. Current ChatRelay uses a server-owned SessionV2 binding and
> `CanvasSessionSurface`; see
> [`specs/relay/chat-relay-session-migration.md`](../../specs/relay/chat-relay-session-migration.md).
> Do not use this file as current architecture.

Functionality id: `builtin:chat-relay`
Status: historical; superseded
Referenced from: `specs/workspace-canvas/architecture.md` §11 (Pseudo blocks)

Implementation:

- Host account-auth subsystem: `packages/relay/src/provider/chat-relay.ts`
  (generic `ChatRelay`), exported from `@opencode-ai/relay`. The relay
  authenticates the platform account and exchanges messages through the
  provider API — there is no browser crawler. The session context persists to
  disk (`loadStoredSession`/`saveStoredSession`) and is re-adopted on re-init,
  including the provider-side conversation threading
  (`conversationId`/`parentMessageId`).
- **Switchable provider**: `provider/provider.ts` defines the `ChatProvider`
  interface (id, homeUrl, OAuth credentials store, login flow, API chat
  session). The first provider is ChatGPT
  (`provider/chatgpt.ts` → `createChatGPTProvider`), authenticated with
  opencode's built-in ChatGPT/Codex OAuth app (`provider/oauth.ts` mirrors
  `packages/opencode/src/plugin/openai/codex.ts`: issuer
  `https://auth.openai.com`, device-authorization flow) and capturing replies
  from the ChatGPT backend-api conversation SSE stream. The server picks the
  provider via `OPENCODE_CHAT_RELAY_PROVIDER` (default `chatgpt`), with
  provider-namespaced storage under `<data>/chat-relay/<provider>/`
  (`credentials.json`, `session.json`, `operating-context.jsonl`). Adding a
  provider = one new `ChatProvider` implementation.
- Host API: `packages/protocol/src/groups/relay.ts` (initialize/status/
  submit/dispose) served by `packages/server/src/handlers/relay.ts` — a
  singleton relay with serialized submissions and an OperatingAgent relay:
  every relayed message is appended to the session's OperatingContext stack.
  `relay.status` reports the active `provider` and, while the account
  authorization is pending, the `authUrl` + `userCode` for the device login.
- Registry: `builtin:chat-relay` is registered in
  `packages/core/src/workspace/service.ts` builtins.
- Viewer: the canvas block type `chat-relay` in
  `packages/app/src/pages/canvas/workspace.tsx` renders the
  unavailable/needs-login/error states per `requirements.md` §8.20, the
  awaiting-login state (verification link + device code) while the account is
  being authorized, and the ready chat surface once authenticated. It polls
  the relay status while ready or awaiting-login, and disposes the backend
  relay when the block is removed.

## 1. What it is

ChatRelay is a pseudo block: its functionality relays the block to the chat
account instead of executing locally. The block is essentially a relay for
the chat service.

## 2. Initialization (account authentication)

- The block must authenticate a chat account before routing.
- Without a valid login the block renders an unavailable/needs-login state
  (per `requirements.md` §8.20 error-block conventions).
- Initialization loads stored OAuth credentials (refreshing expired access
  tokens); when none exist it starts opencode's ChatGPT device-authorization
  flow and the block shows the verification link and code
  (`awaiting-login`) until the user completes it.

## 3. Account-auth subsystem

Simple data processing is handled by the account-authenticated provider:

1. authorize the account (OAuth device flow)
2. send the message through the platform API
3. capture the assistant reply from the stream

The subsystem drives the provider API through these three steps for every
relayed submission.

## 4. Session context storage

- Each chat session has its own context storage.
- The stored context is relayed to the workspace's agent API (the
  OperatingAgent, per `architecture.md` §10).
- Each relayed message becomes part of the session's OperatingContext stack:
  WorkspaceContext → BlockContext → OperationalContext → CustomContext →
  HistoricalContextStack.

## 5. Current storage behavior

- The subsystem stores **all** relayed messages for now.
- Processing of the stored text is **not implemented** — see TODO.md.
