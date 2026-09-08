# Agent chat repair

**Goal:** Restore MasterAgent responses and OperatingAgent model selection without mixing legacy and V2 session histories.

**Design:** Route session operations using persisted runtime metadata. Adapt the bundled client's prompt, message, and event formats at the application boundary. Preserve server-owned model/agent selection. Publish process-local busy/idle status around the complete V2 drain. Keep ordinary legacy sessions on their existing APIs.

**Constraints:** Follow AGENTS.md; no app/server restarts, no generated-file hand edits, package-local tests/typechecks, no new runtime dependency. Preserve concurrent workspace edits.

- [x] Record production timeline benchmark before session edits (`.test-data/agent-chat-benchmark-before.log`: 72 historical turns, 40 deltas, CPU throttle 1).
- [x] Exclude portaled controls from canvas panning; regress real portal pointer events and ordinary background panning.
- [x] Route V2 prompt/interrupt/history through current APIs and keep legacy routing intact; reject mixed-runtime writes, including approval replies.
- [x] Adapt current prompt payload, admitted result, message history, and streaming events to the existing app presentation; keep history page sizes within the host contract.
- [x] Publish busy/idle status around complete local drains; verify success, failure, interruption, and concurrent sessions.
- [x] Resolve composer Stop, selected agent/model, queue, and reset against each bound session.
- [x] Bridge existing host sign-ins into native model resolution without copying credentials into a second persistent store; preserve system guidance in ChatGPT OAuth requests.
- [x] Surface known model/setup errors so accepted prompts cannot fail silently.
- [x] Reflect server-owned model changes in the bound composer immediately.
- [x] Run package checks, focused integration tests, the same production benchmark, and browser verification.

Each implementation starts with a failing regression, then the smallest corresponding fix. Completion requires actual prompt admission, visible streamed output/history, correct model selection, and terminal idle status; a successful binding or HTTP response alone is insufficient.

Live verification: OperatingAgent selection closes its menu and initializes its surface. The repaired MasterAgent returned `CHAT_OK` in the running application; its saved reply survived a page reload. An isolated native OpenAI request also returned `CHAT_OK`. A full runtime integration test produces streamed and persisted assistant output using a controlled model transport. The final production benchmark delivered 40/40 deltas with no row/markdown replacement or long tasks; completion 448 ms versus 513 ms before. These single-run timings are diagnostic, not performance thresholds.

OperatingAgent's configured GPT-5.4 was explicitly rejected by the connected ChatGPT account. Its workspace selection was changed to the working GPT-5.6 Terra model; native session metadata and the bound composer confirm the change. Its live request returned `OPERATING_OK` in three seconds and the surface returned to idle.

Validation: the full application unit/browser suite passed (1,284 tests, 22 existing skips), followed by focused coverage for notification delivery and session model refresh. Core execution/model/integration checks passed (42 tests), as did host credential/auth checks (10 tests). Application, Core, OpenCode, and Session UI package typechecks passed; `git diff --check` passed.
