# ChatRelay Block — ChatGPT Browser Relay

Status: adopted, revised 2026-09-10.
Companion: [usage audit](./chatgpt-chat-usage-audit.md), [authentication](./oauth.md).

## Active pipeline

Settings opens an ordinary, uncontrolled browser for a dedicated, persistent
ChatGPT login. After signing in, the user closes that window so the profile can
be opened by the browser worker. The backend owns one separate page incarnation
for each authenticated user, workspace, and `builtin:chat-relay` block. Sending
from the block fills and submits the visible ChatGPT composer; the worker reads the
visible response and the block displays it as it arrives.

```text
Settings -> v2.chatProxy.connect/open -> ordinary browser -> webpage login
User closes login browser -> worker opens the saved profile for chat automation
ChatRelay block -> GET v2.chatProxy.relay -> acquire or join its backend-owned ChatGPT page
Block composer -> v2.chatProxy.prompt -> visible webpage composer and Send
CtxPack drop / Attach to focused input -> block attachment store -> validated context capsules
Capsule references + optional message -> server snapshot/render -> visible ChatGPT composer
Visible assistant response -> browser worker -> v2.chatProxy.relay -> block
Refresh options -> v2.chatProxy.options -> webpage model/effort menus -> block selectors
Block selection -> v2.chatProxy.configure -> owned webpage menu
New chat / Reinitialize -> v2.chatProxy.reset -> replace the owned page and transcript
Persisted block/workspace deletion -> backend cleanup -> close page and remove ownership
```

The server checks workspace membership and the block's functionality before
accessing any page. The first relay read acquires a page when that ownership key
has none. Canvas refreshes and additional clients only read the relay, so they
join the same incarnation instead of creating another page. If that page is
closed outside ChatRelay, its owned incarnation remains closed or errored and
does not respawn. Only an explicit New chat/Reinitialize reset closes the prior
page and rotates ownership to a fresh incarnation. Persisted block or workspace
deletion closes the page and removes its owner record.

A server-issued tab ID identifies each incarnation and acts as an optimistic
guard on mutations. Stale reset, open, configure, and send requests cannot
operate on a replacement created by another client. The tab ID does not assign
ownership to the frontend; ownership remains in the backend worker.

Prompt IDs reconcile exact retries without clicking Send twice. Conflicting ID
reuse and concurrent sends fail. Uncertain submission errors are displayed for
inspection instead of being automatically retried. The block keeps drafts
locally, scoped by workspace and block, until the server accepts them. The
browser transcript and ownership record live with the browser worker; browser
cookies persist, but the block transcript is not a new durable OpenCode session
history.

CtxPacks can be dropped into the composer or attached through Context Packs'
Attach to focused input action after focusing the ChatRelay message box. Attachments
belong to that block and tab, show preview/remove controls, and can be sent on
their own or with typed text. The existing attachment store enforces workspace,
count, and estimated-token limits. Pending attachments disable Send; failed
admission preserves the attachments and message ID for an exact retry.

The prompt carries capsule references rather than trusting drag payload text.
The authenticated server resolves them for the actual ChatRelay block, checks
permissions, source hashes, capsule targets, expiry, and budgets, then renders
the existing context sidecar for the webpage composer. The mirrored user message
contains typed text and canonical CtxPack labels, rather than raw fragment data.
Only acknowledged attachments clear from the composer.

Model and reasoning effort choices come from the backend-owned page's visible menus.
The block reads them only after the user selects **Refresh options**. That one
manual action runs the full automated discovery process and updates both
selectors; there is no timed discovery or retry. The button remains visible but
is disabled while the tab is not idle or another block action is active.
Ordinary transcript polling uses the cached controls. Open menus are dismissed
without selecting an option, and a blocking dialog produces an actionable error
until the user retries. The block displays the webpage labels and disabled
choices, and omits unsupported selectors. Configuration is limited to idle tabs
and revalidates the requested choice against the current menu. Selection
verification does not schedule option discovery or polling. Option reads and
changes cannot initiate sign-in.

## Browser boundary

In production, `packages/server/src/chat-proxy.ts` lazily starts a Node worker.
During development, `script/dev-backend.ts` owns one long-lived worker on a
private local socket. Backend processes reconnect to it, so ordinary backend
source reloads preserve browser contexts, page identities, and transcripts.
Stopping the full development process, editing the worker source, or a worker
crash restarts the worker and replaces those pages. The worker uses Playwright
and a visible persistent Edge browser context; the browser executable can be
overridden with `OPENCODE_CHAT_PROXY_EDGE`. Node must be installed, or selected
with `OPENCODE_CHAT_PROXY_NODE`. CLI and Node builds include the worker and its
Playwright dependencies. Desktop builds place them beside the bundled server
and unpack them outside Electron's archive so Node can execute them.

The browser runs on the server machine. Its local profile is stored under
`Global.Path.data/chat-relay-browser/<sha256(user)>`. Authentication stays in
that profile; no browser cookies or provider tokens are returned to the app.
The sign-in browser has no Playwright connection or remote-debugging flags.
Only subsequent chat tabs are controlled. A profile is never opened by the
ordinary login browser and the controlled chat browser simultaneously.
The worker uses the visible webpage, not an undocumented inference API or a
Codex OAuth token. It pauses for login, browser verification, and unrecognized
Chat UI. It checks regular Chat mode before submission and rejects Work mode.
Page changes can require updating this browser adapter.

Only an explicit Settings Connect/Open action starts a sign-in browser.
Connection intent and the dedicated browser profile persist. A canvas refresh,
an additional client, or an ordinary development backend reload reconnects to
the existing worker-owned page. After a full worker restart, the next relay read
can acquire a replacement page from the saved profile because the prior owner
record no longer exists. A page closed while its worker is still running remains
the same closed/error incarnation until an explicit reset. An expired login
waits for Settings without repeated attempts. Controlled contexts block
navigation to sign-in routes. Profiles created by earlier Settings logins are
recognized by their browser Preferences file. An unrelated empty directory does
not enable recovery.

The current composer intelligence picker exposes a model list and a Power
slider. Only a **Refresh options** click starts discovery. For that click, the
adapter automatically opens the model view, reads the list and the slider's
accessible range, current amount, description, and locked steps, then closes the
menus it opened. It adjusts Power through the webpage's declared arrow-key
controls. Discovery does not move the slider or change the selected model.

The block does not mount an OpenCode session surface, call SessionV2, select a
provider credential, or fall back to an API/Codex endpoint. Operating Chat and
MasterAgent retain their normal provider authentication. ChatGPT OAuth there
uses Codex/Work allowance; API keys use separate API billing.

## Existing conversations

The former session bridge used `workspace.chatRelay.ensure` and
`CanvasSessionSurface` to submit to SessionV2. OpenAI OAuth inference then used
`https://chatgpt.com/backend-api/codex/responses`. That was an OpenCode/Codex
conversation, not regular ChatGPT Chat. See the
[historical migration](./chat-relay-session-migration.md).

Existing FunctionalityInstance bindings, OpenCode sessions, and messages remain
intact. Their get/ensure/reset APIs remain for compatibility; the new browser
block does not call them. Sessions reopened elsewhere retain normal OpenCode
behavior. Already-running or previously admitted work is not cancelled.

Dormant `chat_relay_payload` data and old `Global.Path.data/chat-proxy` browser
profiles remain untouched. The new worker does not clear browser session files
or reuse the user's default personal browser profile.
