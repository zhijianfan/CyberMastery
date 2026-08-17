# ChatRelay — Pseudo Block

Functionality id: `builtin:chat-relay`
Status: implemented (see TODO.md for the two deferred items)
Referenced from: `specs/workspace-canvas/architecture.md` §11 (Pseudo blocks)

Implementation:

- Host crawler-like subsystem: `packages/relay/src/crawler/chat-relay.ts`
  (generic `ChatRelay`), exported from `@opencode-ai/relay`. The four pipeline
  steps reuse the existing relay crawler: page/profile download
  (`launchProfile` + `warmUp`), message typing (`typeLikeHuman`), submission,
  and response extraction (`captureTurn`). The session context persists to
  disk (`loadStoredSession`/`saveStoredSession`) and is re-adopted on re-init.
- **Switchable crawler**: `crawler/chat-crawler.ts` defines the `ChatCrawler`
  interface (id, homeUrl, login detection, conversation-id extraction,
  submit). `ChatGPTCrawler` (`crawler/chatgpt.ts`) and `ClaudeCrawler`
  (`crawler/claude.ts`) are built in; the server picks one via
  `OPENCODE_CHAT_RELAY_PROVIDER` (default `chatgpt`), with
  provider-namespaced storage under `<data>/chat-relay/<provider>/`. Adding a
  provider = one new `ChatCrawler` implementation.
- Host API: `packages/protocol/src/groups/relay.ts` (initialize/status/
  submit/dispose) served by `packages/server/src/handlers/relay.ts` — a
  singleton relay with serialized submissions and an OperatingAgent relay:
  every relayed message is appended to the session's OperatingContext stack
  (`<data>/chat-relay/<provider>/operating-context.jsonl`). `relay.status`
  reports the active `provider`.
- Registry: `builtin:chat-relay` is registered in
  `packages/core/src/workspace/service.ts` builtins.
- Viewer: the canvas block type `chat-relay` in
  `packages/app/src/pages/canvas/workspace.tsx` renders the
  unavailable/needs-login/error states per `requirements.md` §8.20 and the
  ready chat surface once initialized, polls the relay status while ready,
  and disposes the backend relay when the block is removed.

## 1. What it is

ChatRelay is a pseudo block: its functionality relays the block to the chat
webpage instead of executing locally. The block is essentially a relay for
the chat service.

## 2. Initialization

- The block must be initialized with a chat login before routing.
- Without a valid login the block renders an unavailable/needs-login state
  (per `requirements.md` §8.20 error-block conventions).

## 3. Crawler-like subsystem

Simple data processing is handled by a crawler-like subsystem:

1. download files
2. extract response
3. type in message
4. submit

The subsystem drives the chat webpage through these four steps for every
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
