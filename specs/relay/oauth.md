# ChatRelay Account Auth — Capture Stage

Status: executing
Companion: [architecture.md](./architecture.md) (file-only block this feeds)
Scope: execute-capable upstream capture. Everything here runs **outside** the
ChatRelay block. The block only ever consumes transcript files from the inbox.

The capture stage authenticates an AI chat platform **account** through
opencode's built-in ChatGPT/Codex OAuth app and drives the platform API
directly. There is no browser crawler: no page automation, no anti-detection
hygiene, no login-page scraping.

## 1. Portion map

| Pipeline portion | Implemented here | Notes |
|---|---|---|
| Account authorization (OAuth device flow) | Yes | §3 |
| Send prompt, capture streaming reply | Yes | §4, ChatGPT backend-api SSE |
| Multi-turn continuation prompts | Yes | `runPlan` drives the doc-per-turn sequence |
| Conversation metadata (id, parent message, URL) | Yes | §4.3 |
| Write transcript into `specs/relay/inbox/` | Yes | The capture stage's only file write |
| Doc extraction / classification / organizing | No | ChatRelay block (`architecture.md`) |
| Coherence pass / plan execution | No | Downstream execute-capable passes |

Degradation ladder: **OAuth API adapter → manual paste import**. The account
auth path is always the primary; manual import stays available for accounts
whose requests are challenged (CAPTCHA / Arkose) by the platform.

## 2. Provider contract

```ts
interface ChatProvider {
  readonly id: string
  readonly homeUrl: string

  restoreCredentials(): Promise<ChatCredentials | undefined>
  saveCredentials(credentials: ChatCredentials): Promise<void>
  clearCredentials(): Promise<void>
  refreshCredentials(credentials: ChatCredentials): Promise<ChatCredentials>

  startLogin(): Promise<DeviceLogin>          // verificationUrl + userCode + poll()
  openChat(options: {
    credentials: ChatCredentials
    onRefresh(credentials): Promise<ChatCredentials>
    context?: { conversationId?: string; parentMessageId?: string }
  }): Promise<ChatSession>                    // send(): AsyncIterable<string>, turn(), dispose()
}
```

The first provider is **ChatGPT** (`createChatGPTProvider`). Adding a provider
= one new `ChatProvider` implementation registered in the server's provider
picker (`OPENCODE_CHAT_RELAY_PROVIDER`, default `chatgpt`).

## 3. Account authorization (ChatGPT)

Uses the same OAuth app opencode ships for ChatGPT/Codex
(`packages/opencode/src/plugin/openai/codex.ts`): issuer
`https://auth.openai.com`, client id `app_EMoamEEZ73f0CkXaXp7hrann`, device
authorization endpoints. Keep the endpoint and payload shapes in sync with
that plugin.

1. `POST {issuer}/api/accounts/deviceauth/usercode { client_id }`
   → `{ device_auth_id, user_code, interval }`.
2. The relay enters `awaiting-login` and reports `authUrl` +
   `userCode` through `relay.status`; the canvas block renders the link and
   code.
3. Poll `POST {issuer}/api/accounts/deviceauth/token
   { device_auth_id, user_code }` every `interval + 3s` (floor 5s + 3s) until
   the 15-minute deadline. `403/404` = still pending; `200` carries
   `{ authorization_code, code_verifier }`; any other status = denied.
4. Exchange at `{issuer}/oauth/token`
   (grant `authorization_code`, redirect `{issuer}/deviceauth/callback`,
   PKCE verifier) → access + refresh tokens. The account id is read from the
   id-token JWT claims (`chatgpt_account_id` → `organizations[0].id`).
5. Credentials are stored at `<data>/chat-relay/<provider>/credentials.json`
   and re-adopted on the next initialize. Expired access tokens are refreshed
   (`grant_type=refresh_token`) before use; a rejected refresh clears the
   stored credentials and falls back to a fresh login.

The relay owns the poll loop (scheduled timer, cancelled on dispose); login
surfaces only as state transitions: `awaiting-login → ready | missing-login`.

## 4. Message exchange (ChatGPT backend API)

### 4.1 Send

`POST https://chatgpt.com/backend-api/conversation` (or
`…/conversation/{id}` once a conversation exists) with:

```json
{
  "action": "next",
  "messages": [{
    "id": "<uuid>",
    "author": { "role": "user" },
    "content": { "content_type": "text", "parts": ["<prompt>"] }
  }],
  "model": "auto",
  "conversation_id": "<id?>",
  "parent_message_id": "<id?>"
}
```

Headers: `Authorization: Bearer <access>`, `ChatGPT-Account-Id: <id>`,
`Content-Type: application/json`, `Origin: https://chatgpt.com`. On `401/403`
the relay refreshes once and retries.

### 4.2 Capture

The response is `text/event-stream`. Each `data:` JSON event with
`message.author.role === "assistant"` contributes its `content.parts` strings
as deltas; `[DONE]` ends the turn; an `error` field aborts it. Completion =
stream end. A stalled stream past the 10-minute timeout yields a partial turn
with `finishedAt: null`, never a retry.

### 4.3 Conversation threading

`conversation_id` and the assistant `message_id` are captured from the stream
and persisted with the session store (`<data>/chat-relay/<provider>/
session.json`), so a re-initialized relay continues the same provider-side
conversation via `parent_message_id`.

## 5. Failure & ops rules

- Never auto-retry a denied/expired login: surface `missing-login` and let the
  user re-initialize.
- A hard send failure with no captured content fails the submit; partial
  content degrades to an incomplete turn and is stored, never discarded.
- Credentials are written only by the relay to the provider-namespaced data
  directory; the inbox remains the capture stage's only content write.
- Operate within provider ToS; prefer the OAuth adapter. Accounts that the
  platform challenges (CAPTCHA/Arkose) fall back to manual paste import.

## 6. What the capture stage must never do

- Run inside the ChatRelay block (file-only constraint from
  `architecture.md`).
- Drive a browser, scrape a login page, or impersonate human typing.
- Touch files outside the inbox and its provider-namespaced data directory.
- Store or transmit the user's ChatGPT password — authorization is OAuth only.
