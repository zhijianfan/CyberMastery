# Backend-Owned Chat Proxy Design

## Goal

Replace ChatRelay's model API transport with a local backend-owned browser session. The first supported proxy is ChatGPT. A user signs in directly inside a visible Chromium window, the backend keeps that profile and tab alive, and ChatRelay sends prompts and reads responses through the page.

## Scope

- Add a global Chat Proxy section to Settings.
- Offer ChatGPT as the first and only proxy provider.
- Launch a visible persistent Chromium context on demand.
- Keep browser state under the OpenCode data directory, separated by authenticated user.
- Keep cookies, passwords, and page storage entirely in Chromium.
- Give each ChatRelay block its own ChatGPT tab and in-memory transcript.
- Show sent messages, a thinking state, streamed response text, and browser errors.
- Keep API-key and OAuth provider settings independent from Chat Proxy.

## Non-goals

- Do not reverse-proxy ChatGPT HTML through the application origin.
- Do not stream screenshots or capture login input.
- Do not accept arbitrary proxy URLs.
- Do not bypass provider limits, access controls, bot protection, or login challenges.
- Do not persist ChatRelay transcripts across backend restarts in this first slice.

## Architecture

The Schema package owns serializable provider, connection, message, and relay state. Protocol exposes authenticated global endpoints for listing providers, connecting, opening, disconnecting, reading a relay, and submitting a prompt. Server owns a scoped ChatProxyService containing one persistent Playwright context per user and one page per relay ID.

The browser profile path is derived from a SHA-256 digest of the authenticated user ID and stored below `<opencode-data>/chat-proxy/chatgpt/<digest>`. The frontend never receives storage state or cookies. Connecting opens or focuses the visible browser. Settings polls provider state while the user completes login directly on ChatGPT.

ChatRelay polls relay state. Prompt admission adds the user message synchronously, marks the relay as thinking, and starts one background browser operation. The operation fills ChatGPT's composer, sends the message, polls the newest assistant turn, updates its local message while text streams, and records a visible error if any page operation fails.

## API

- `GET /api/chat-proxy`: list Chat Proxy providers and statuses.
- `POST /api/chat-proxy/:providerID/connect`: launch or focus the provider browser.
- `POST /api/chat-proxy/:providerID/open`: focus the current provider page.
- `DELETE /api/chat-proxy/:providerID`: close the browser context without deleting its profile.
- `GET /api/chat-proxy/:providerID/relay/:relayID`: get messages and activity.
- `POST /api/chat-proxy/:providerID/relay/:relayID/prompt`: admit one prompt and start extraction.

## Security

- Every route uses the existing server authorization middleware.
- Service state and profile paths are keyed by authenticated user ID.
- Provider URLs are hardcoded in the backend registry.
- Login happens only in the visible provider page.
- API responses expose status, text messages, and sanitized error strings only.
- Disconnect closes Chromium but preserves the profile so the user does not need to log in on every backend restart.

## Failure behavior

- Missing Playwright browser binaries produce a visible Settings error with the Chromium installation command.
- Signed-out pages report `login-required`.
- Closed or crashed contexts report `disconnected`.
- A second prompt while a relay is active returns a conflict-style error.
- Selector changes, provider errors, and response timeouts preserve the sent message and append an error message.

## Constraints

- Browser automation is local-machine functionality. A remote backend opens Chromium on the remote host.
- ChatGPT DOM selectors can change and may require adapter maintenance.
- Browser use remains subject to ChatGPT limits and terms.
