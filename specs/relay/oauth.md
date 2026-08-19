# ChatRelay OAuth — Delegation to CodexAuthPlugin

Status: canonical
Companion: [architecture.md](./architecture.md),
[`codex.ts`](../packages/opencode/src/plugin/openai/codex.ts)

## 1. Auth ownership

ChatRelay no longer implements device-flow OAuth or credential management. OAuth is
provided entirely by `CodexAuthPlugin` in
`packages/opencode/src/plugin/openai/codex.ts`.

- Plugin client id: `app_EMoamEEZ73f0CkXaXp7hrann`
- Plugin issuer: `https://auth.openai.com`
- Auth endpoint family: OpenAI device authorization and token endpoints as
  implemented in `codex.ts`.

All auth, refresh, and account binding behavior for ChatRelay follows that plugin
exactly.

## 2. Why this changed

The relay previously duplicated device-flow and token handling in its own provider
stack. That duplication is removed to avoid divergence and to prevent invalid
provider calls to incorrect routes.

## 3. Required call path

- Session execution invokes provider logic through the OpenCode plugin stack.
- Codex auth headers are applied by `CodexAuthPlugin` before calls to the
  OpenCode openai provider.
- Inference requests are sent to
  `https://chatgpt.com/backend-api/codex/responses` (via `codex.ts`).

## 4. Endpoint references that remain true

Any concrete endpoint details (device authorization / token exchange) are
implemented by, and should be traced to, `packages/opencode/src/plugin/openai/codex.ts`.
ChatRelay spec updates must not redefine these payload shapes or URL paths.

## 5. Non-goals for this spec

- No relay-specific provider loop, poller, or credential store.
- No `/api/relay/*` auth-status transport.
- No transport-level OAuth error handling in ChatRelay docs; these flow rules are
  session/plugin concerns now.
