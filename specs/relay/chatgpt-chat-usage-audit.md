# ChatRelay: regular ChatGPT browser relay and usage audit

Documentation checked: 2026-09-10. Decision: the user requested one Settings
webpage login, one backend-owned page per block, and automated submission and
reply display. This supersedes both the session bridge and the interim
manual-handoff design.

## Finding

The previous ChatRelay was an OpenCode conversation. Restoring its composer did
not make it a regular ChatGPT Chat conversation. Its submission path was:

```text
ChatRelayRuntimeAdapter -> workspace.chatRelay.ensure -> OpenCode session binding
ChatRelayBody -> CanvasSessionSurface -> BlockChat -> prompt-input submit
v2.session.prompt -> SessionV2 admission -> SessionExecution -> SessionRunner
OpenAI OAuth -> https://chatgpt.com/backend-api/codex/responses
```

`packages/core/src/session/runner/model.ts` selects the Codex base URL when the
OpenAI credential is OAuth. `chatOnly: true` changes composer controls, not the
endpoint or billing. Disabling tools, changing the system prompt, or selecting
a model without “Codex” in its name does not make this regular ChatGPT Chat.
Local session IDs and history are not ChatGPT conversation IDs and history.

## Supported choices

| Route                   | Authentication            | Usage                                                   | Integration                                                                   |
| ----------------------- | ------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Regular Chat in ChatGPT | ChatGPT's browser session | Chat/model limits under the selected plan and workspace | Browser automation; no documented third-party Chat OAuth endpoint found       |
| OpenCode OpenAI OAuth   | ChatGPT/Codex OAuth       | Shared Codex/Work allowance                             | Embedded session; does not meet the requested regular Chat route              |
| OpenAI API              | Platform API key          | Separate API billing                                    | Embedded API chat is possible, but is not a ChatGPT subscription conversation |

OpenAI documents Chat and Work as different modes, and Quick chat as another
entry to Chat when available. Work and Codex share limits. Authentication docs
describe Codex subscription sign-in, separately billed API-key access, and
ChatGPT web keeping its login in the browser. These sources do not document a
third-party OAuth scope or supported inference endpoint for regular ChatGPT
Chat. This is a documentation finding, not a claim about inaccessible internal
interfaces. [Use ChatGPT](https://learn.chatgpt.com/docs/use-chatgpt),
[Pricing](https://learn.chatgpt.com/docs/pricing),
[Authentication](https://learn.chatgpt.com/docs/auth).

Choosing Chat avoids deliberately starting a Work/Codex task. It is not a
universal promise of unlimited or unmetered usage: eligible Chat features can
share workspace credits under enterprise agreements. The selected workspace's
plan and usage rules still apply. [Work usage and cost](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-usage-and-cost).

## Revised pipeline

```text
Settings -> ordinary browser with dedicated profile -> webpage sign-in once
User closes login browser -> controlled chat tabs reuse its saved profile
ChatRelay -> GET relay -> acquire or join its backend-owned page -> browser Send
ChatGPT visible assistant reply -> worker observation -> block transcript
New chat / Reinitialize -> explicit reset -> replacement page
Persisted block/workspace deletion -> close page and remove ownership
```

The block uses no provider login, session binding, session prompt, model runner,
or automatic fallback. A dedicated persistent browser profile retains webpage
login. Sign-in happens in an ordinary browser with no automation connection;
only later chat tabs are controlled. Google may reject automated sign-in,
which is why the login window must be closed before the profile is handed to
the chat worker. [Google sign-in browser requirements](https://support.google.com/accounts/answer/7675428?co=GENIE.Platform%3DDesktop&hl=en-GB).

Sign-in is initiated only by explicit Settings actions. Polling or
reinitializing a disconnected block cannot launch a sign-in window. Canvas
refreshes and additional clients issue the same relay read and join the existing
backend-owned page. In development, ordinary backend source reloads reconnect to
a long-lived worker through a private local socket, preserving the page. A full
development stop, a worker-source restart, or a worker crash replaces the worker
and its pages; the saved profile still preserves login. The adapter blocks
controlled navigation to sign-in routes. An expired or cancelled login waits
for Settings.

The backend owns one page incarnation per authenticated user, workspace, and
block. The first relay read acquires it when absent; later reads return it. A page
closed outside ChatRelay stays closed or errored and does not respawn. Only an
explicit New chat/Reinitialize reset rotates to a new incarnation. Persisted
block or workspace deletion closes the page and removes its owner record. The
server-issued tab ID is an optimistic incarnation guard, so stale clients cannot
mutate a replacement; it does not make the frontend the owner.

The worker submits through visible controls and mirrors visible assistant text.
It verifies regular Chat before sending and pauses for login, browser
verification, Work mode, or unsupported page controls. This is webpage
automation, not an official stable Chat API, and site changes may break it.

The Settings ChatRelay action opens the shared browser login instead of Codex OAuth.
Provider authentication remains available to Operating Chat and MasterAgent,
with its usage semantics stated in settings.

## Compatibility and verification

Existing OpenCode bindings and sessions remain stored. The revised block does
not ensure, reset, resume, or delete them. They remain normal OpenCode sessions
if deliberately reopened elsewhere. This change does not cancel an already
running provider turn or discard previously admitted work.

No server prohibition is inferred from a historical ChatRelay binding: it would
also disable preserved OpenCode conversations. The production audit found no
other automatic ChatRelay submission path after removing the block's session
runtime and surface.

Dormant `chat_relay_payload` data and existing `Global.Path.data/chat-proxy`
browser profiles remain untouched. Reusing Codex OAuth credentials against the
undocumented browser `/backend-api/conversation` route is not an implemented or
supported alternative.

Regression checks exercise the typed HTTP boundary, workspace/block validation,
tab ownership and reset, duplicate-send prevention, browser DOM interaction,
the Settings connection, and block transcript rendering. MasterAgent and
Operating Chat retain their session behavior. Local fixtures do not establish
that a signed-in production ChatGPT account works; live authentication and
production-page verification must be reported separately.

Earlier relay-pipeline verification (2026-09-10):

- Schema, Protocol, Server, both generated SDK clients, app, and E2E typechecks passed.
- Protocol contract: 4 tests passed; Server handler/worker: 9 tests passed.
- Real Edge DOM fixtures and worker subprocess lifecycle: 2 tests passed.
- Plain Node transport checks passed for disconnected operations without worker
  launch, Settings connection, missing Node, and unexpected worker exit/reconnect.
- Final Node and Electron builds passed. The unpacked Windows package contains
  the Node-compatible transport, worker, and resolvable Playwright dependencies.
- ChatRelay runtime/view/Settings: 19 tests passed. Coupled canvas tests: 64
  passed, with 13 existing intentional skips.
- Browser E2E: 4 tests passed, covering both server protocol modes, prompt/reply
  display, owned-tab reset/open, and disconnected polling with no sign-in action.
- Live Settings opened an ordinary Edge window without automation/debugging flags.
  The disconnected block remained idle; repeated login-window spawning stopped.
- After the user signed in and closed the ordinary login window, the block's
  first relay read acquired its ready page. A live test submitted through the block
  returned the exact expected `CHATRELAY_OK` response in the block. The user's
  preceding message and ChatGPT reply were also visible in that transcript.

Saved-login and webpage-control verification (2026-09-10):

- Refreshes and ordinary backend source reloads rejoined the worker-owned page
  without another sign-in or page replacement. A manual **Refresh options** click
  ran the automated discovery and displayed the actual account's model list and
  Power range.
- Live selection changed the model to GPT-5.6 Sol and Power to 2; the webpage
  reported “High, 3 of 5.” The original Latest model and Power 0 were restored.
  These checks sent no messages.
- Server handler, service, and worker: 13 tests passed. Real Edge DOM fixtures
  and worker subprocess lifecycle: 3 tests passed, including delayed controls,
  expired-login handling, and model/Power selection.
- ChatRelay runtime and view: 24 tests passed. Four browser E2E tests passed
  across both protocol modes, including rejected choices and preserved drafts.
- Server typecheck passed. At that checkpoint, the app-wide typecheck reported an unrelated
  generic-inference error in the Notes-block test at
  `packages/app/src/pages/canvas/runtime/registrations/static-blocks.test.ts:150`.

Manual refresh follow-up (2026-09-10): **Refresh options** is the only trigger
for webpage model and Power discovery. Each click starts the complete automated
read and updates both selectors, but blocks do not poll or retry discovery on a
timer. This avoids periodically opening and closing visible ChatGPT menus or
dismissing a menu the user opened. A blocking dialog is reported so the user can
close it and retry. A model or effort change still verifies the requested
webpage selection without starting a background discovery or retry cycle.
