# ChatRelay Authentication — ChatGPT Browser Sign-in

Status: canonical, revised 2026-09-10.
Companion: [architecture](./architecture.md), [usage audit](./chatgpt-chat-usage-audit.md).

## Regular ChatGPT browser connection

Settings opens an ordinary browser window with a dedicated profile and no
automation connection. The user signs in and closes that window. Only afterward
does the worker open the saved profile for controlled chat tabs. New
ChatRelay tabs share that browser login, and each block owns its conversation
tab. Login expiry and browser verification require attention in the visible
browser; the block pauses instead of switching to a provider credential.

Browser state stays locally under the server's data directory. It must not be
exported in API responses, logs, layout state, or source control. The worker
uses a separate profile rather than automating a personal default profile.
Settings manages the ordinary login window; block controls open only their owned
chat tab. Authentication pages are never driven by the worker. If login expires,
the worker pauses and Settings reopens the ordinary browser for sign-in.
The user must explicitly choose the Settings action. Block creation, reset,
and connection polling never open sign-in windows. After a refresh or worker
restart, the server checks the saved Settings connection and reuses its browser
profile. The check opens a minimized regular-chat browser and blocks navigation
to sign-in pages. An expired login pauses the relay until the user reconnects
through Settings.

Google documents that it may reject sign-in from software-controlled or embedded
browsers. Separating the ordinary sign-in window from subsequent controlled chat
tabs addresses this boundary without disguising automation or bypassing a
challenge. [Google Account Help](https://support.google.com/accounts/answer/7675428?co=GENIE.Platform%3DDesktop&hl=en-GB).

No third-party OAuth inference endpoint for regular ChatGPT Chat was found in
OpenAI's documentation checked on 2026-09-10. This implementation therefore
automates the webpage. It does not reuse a Codex OAuth token with a private
ChatGPT endpoint. The [audit](./chatgpt-chat-usage-audit.md) records the sources
and usage qualifications.

## OpenCode provider authentication

Other OpenCode sessions continue supporting provider authentication. The combined
host's `AuthCredential.node` reconciles the saved OpenAI API-key or OAuth login
with V2 credentials. `packages/core/src/session/runner/model.ts` routes OpenAI
OAuth to `https://chatgpt.com/backend-api/codex/responses`. The legacy integration
remains in [`CodexAuthPlugin`](../../packages/opencode/src/plugin/openai/codex.ts).

That OAuth route uses shared Codex/Work allowance. API-key access uses separate
Platform API billing. Neither route relays into regular ChatGPT Chat. Settings
labels provider authentication separately from the ChatRelay browser login.

Existing credentials and historical ChatRelay OpenCode sessions are preserved.
No relay-specific OAuth token store or refresh loop is added.
