# CyberMaster OpenCode-Native Implementation Plan

Status: executed on `feature/CyberMaster` from `5ffe6dcfa`; Task 6 completed
from `677f146cf71f55e29bb42c61bb1297fff29967b8` and its reconnect follow-up was
verified from `391ef5a36`. This is an execution record,
not a future-work checklist. The unchecked step syntax under Tasks 1-5 is the
original test-first script retained for audit; completion is recorded by the
task headings and execution table, not by those historical boxes.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converge CyberMaster's conversational canvas blocks on the existing OpenCode SessionV2/runtime path and remove the duplicate ChatProxy stack without deleting legacy user data.

**Architecture:** `opencode web` remains the single production listener and OpenCode remains the only product-owned persistence boundary. OperatingChat and ChatRelay resolve server-owned bindings through generated APIs and render `CanvasSessionSurface`; obsolete browser polling, browser automation routes, and ChatRelay-specific runtime synchronization are deleted after parity.

**Tech Stack:** Bun, TypeScript, Effect Schema/HttpApi, SolidJS, SessionV2, Block Runtime v3, SQLite/Drizzle, generated Promise/Effect/JavaScript clients.

**Spec:** `specs/backend/cybermaster-host-manager-future-plan.md`

## Execution results

| Task | Result | Commit |
| --- | --- | --- |
| 1. OperatingChat reset | Complete | `3250a8d30`, `59df7751a` |
| 2. ChatRelay session surface | Complete | `3b9cbead2` |
| 3. Browser ChatProxy removal | Complete | `21d95eedd` |
| 4. Public transport removal/data retention | Complete | `320eda110` |
| 5. Runtime/manager pruning and recovery | Complete | `97650db9c`, `677f146cf` |
| 6. Authority/reconnect verification and docs | Complete, including `fix(canvas): preserve reconnect convergence` | active behavioral, file-backed persistence, independent-context, and real-process coverage recorded below |

Task 6 coverage decisions: existing Core exact-retry and CtxPack admission
tests already strongly cover one durable `session_input`, so no redundant test
was added. Active remount/reuse, fresh file-backed Core binding reuse, two
independently mounted OperatingChat provider contexts, and stale local layout
reconciliation passed immediately as characterization. Duplicate event IDs
exposed the initial RED gap. Follow-up review then exposed two additional REDs:
a reconnect was lost during a non-reconnect refresh, and post-initial
ServerSDK `server.connected` events never reached the runtime reconnect path.
Both were corrected at the existing provider/router/host boundaries. The
next scoped rereview found that Provider-local “first observed” state could
drop a real reconnect when the Provider mounted after initial stream setup.
ServerSDK now marks initial versus later connection events from the lifecycle
it owns, and late-mounted Provider coverage proves convergence without a false
initial refresh. The real-process combined-listener test passed as
characterization.

The package matrix passed for Schema, Core, Protocol, Server, Client, SDK, and
App. OpenCode typecheck and all three 233-route HTTP exercise modes passed. Its
monolithic Windows test run completed 3,402 pass/58 skip/1 todo/14 fail: seven
failures require unavailable symlink privilege, three were load-sensitive
five-second timeouts that passed focused, one ACP subprocess timeout passed
focused, two pre-existing path-normalization tests assume the temporary drive
matches the checkout drive, and one stale ChatRelay test was corrected to the
intentional access-first 403 contract and passed focused. OpenCode's original
build attempts reproducibly reached the binary build after producing
`packages/app/dist`, then Bun rejected the generated relative embedded-asset
imports despite those files existing. A separate follow-up corrected the
virtual-module import base: on Windows,
`bun run build --single --skip-install` and its binary smoke passed, as did
OpenCode typecheck and all 14 focused UI tests. Two all-target
`bun run build --skip-install` attempts passed the former asset-resolution
point and built `opencode-linux-arm64`, then reproducibly failed while Bun
extracted its external `bun-linux-x64-v1.3.14` runtime as a possibly incomplete
download. The all-target release matrix therefore remains limited by that
external artifact/environment failure rather than being recorded as green.

## Global Constraints

- Preserve dependency direction: Schema to Core and Protocol, then Core and Protocol to Server. Changed App runtime surfaces add no imports forbidden by the repository dependency rules.
- Preserve SessionV2 durable admission, queue/steer, process-local coordination, and one-`llm.stream(request)` invariants from `AGENTS.md`.
- Keep `opencode web` and `opencode serve` behavior compatible and add no listener, proxy, supervisor, executable, or database.
- Keep one V1-or-V2 browser event connection per active OpenCode context; registrations subscribe through the existing router and refetch authority after reconnect.
- Keep session IDs, transcripts, queues, and runtime status out of authoritative layout and browser persistence. Cached layout descriptors remain disposable projections reconciled to server revision.
- Leave the ChatRelay payload service/table and ChatProxy browser-profile directories untouched for one compatibility window; add no new production callers.
- Treat public ChatProxy API removal as an intentional breaking change; stop before Task 4 if release policy rejects it.
- After Protocol or Server `HttpApi` changes, run `bun run generate` from `packages/client`; never edit generated clients directly.
- Regenerate the legacy JavaScript SDK with `bun ./script/build.ts` from `packages/sdk/js`.
- Run tests and `bun typecheck` only from package directories.

---

### Task 1: Complete OperatingChat reset

**Files:**

- Modify: `packages/app/src/pages/canvas/runtime/registrations/operating-chat.ts`
- Modify: `packages/app/src/pages/canvas/runtime/registrations/operating-chat.test.ts`
- Modify: `packages/app/src/pages/canvas/workspace.tsx`
- Create: `packages/app/src/pages/canvas/operating-chat.browser.test.tsx`
- Modify: `packages/app/src/pages/canvas/canvas.css` only if existing controls cannot be reused

**Interfaces:**

- Consumes: generated `client.v2.workspace.operatingChat.reset(input, options)` where `input` has `workspaceID`, `blockID`, `expectedSessionID`, and `expectedRevision`.
- Produces: `OperatingChatView` with `revision`, and `OperatingChatCommand = { type: "reset" }` handled by the existing `RuntimeBlockHandle.dispatch` refresh lifecycle.

- [ ] **Step 1: Add a failing registration test**

  Extend the real registration test double with `reset`, dispatch `{ type: "reset" }`, and assert the literal request `{ workspaceID: "wrk_test", blockID: "block-1", expectedSessionID: "ses_operating", expectedRevision: 1 }` plus the supplied abort signal. The production change that makes it pass is a typed registration `dispatch` implementation.

- [ ] **Step 2: Verify RED**

  From `packages/app`, run:

  ```powershell
  bun test --conditions=solid --isolate --preload ./happydom.ts src/pages/canvas/runtime/registrations/operating-chat.test.ts
  ```

  Expected: failure because the registration has `TCommand = never` and no `dispatch`.

- [ ] **Step 3: Implement the smallest registration change**

  Add `revision` to the resolved/view value, export the command type, and call:

  ```ts
  await input.services.serverSDK().client.v2.workspace.operatingChat.reset(
    {
      workspaceID: input.resolved.workspaceID,
      blockID: input.resolved.blockID,
      expectedSessionID: input.resolved.sessionID,
      expectedRevision: input.resolved.revision,
    },
    { throwOnError: true, signal: input.signal },
  )
  ```

  Do not refresh inside the registration; `BlockRuntimeHost.dispatch` already refreshes after success.

- [ ] **Step 4: Verify registration GREEN**

  Re-run the focused registration test and require zero failures.

- [ ] **Step 5: Add the failing browser behavior test**

  Mount the real OperatingChat body/host boundary, trigger Reset, and assert that a successful dispatch renders the replacement session while a 409 failure leaves the original surface mounted and displays an actionable error. The production change that makes it pass is the reset control and local pending/error presentation.

- [ ] **Step 6: Verify browser RED**

  From `packages/app`, run:

  ```powershell
  bun test --conditions=browser --isolate --preload ./happydom.ts src/pages/canvas/operating-chat.browser.test.tsx
  ```

- [ ] **Step 7: Implement reset UI**

  Reuse existing canvas action styles. Disable duplicate clicks while the dispatch promise is pending, display the server error without unmounting the current session, and clear it on the next attempt/success.

- [ ] **Step 8: Verify Task 1**

  Run both focused tests and `bun typecheck` from `packages/app`.

- [ ] **Step 9: Commit**

  ```powershell
  git add packages/app/src/pages/canvas/runtime/registrations/operating-chat.ts packages/app/src/pages/canvas/runtime/registrations/operating-chat.test.ts packages/app/src/pages/canvas/workspace.tsx packages/app/src/pages/canvas/operating-chat.browser.test.tsx packages/app/src/pages/canvas/canvas.css
  git commit -m "feat(app): complete operating chat reset"
  ```

### Task 2: Render ChatRelay through the canonical session surface

**Files:**

- Modify: `packages/app/src/pages/canvas/blocks/chat-relay/view.tsx`
- Modify: `packages/app/src/pages/canvas/blocks/chat-relay/view.browser.test.tsx`
- Modify: `packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts`
- Modify: `packages/app/src/pages/canvas/blocks/chat-relay/runtime.test.ts`
- Modify: `packages/app/src/pages/canvas/blocks/chat-relay/types.ts` only for fields proven obsolete by the cutover

**Interfaces:**

- Consumes: `ChatRelayView { workspaceID, sessionID, directory, queueEnabled: true }` from `v2.workspace.chatRelay.ensure`.
- Produces: `CanvasSessionSurfaceProviders` and `CanvasSessionSurface` mounted with that session target; no ChatProxy request is made by the visible block.

- [ ] **Step 1: Change the browser test first**

  Assert the ready block passes the literal bound session/directory/workspace target to the canonical session surface and does not mount the proxy surface. Keep coverage for resolving, unavailable, permission-denied, and error states.

- [ ] **Step 2: Verify RED**

  From `packages/app`, run the ChatRelay view browser test. Expected: the ready-state assertion fails because `ChatProxyRelaySurface` is still mounted.

- [ ] **Step 3: Implement the surface swap**

  Reuse `createMasterAgentSessionOptions`, `CanvasSessionSurfaceProviders`, and `CanvasSessionSurface`. Preserve existing status/permission shells and queue behavior. Do not add a ChatRelay composer, transcript store, or controller.

- [ ] **Step 4: Verify GREEN and runtime invalidation**

  From `packages/app`, run the ChatRelay view and runtime tests, then `bun typecheck`.

- [ ] **Step 5: Commit**

  ```powershell
  git add packages/app/src/pages/canvas/blocks/chat-relay
  git commit -m "refactor(app): render chat relay session"
  ```

### Task 3: Remove browser ChatProxy ownership

**Files:**

- Delete: `packages/app/src/pages/canvas/blocks/chat-relay/proxy-surface.tsx`
- Delete: `packages/app/src/pages/canvas/blocks/chat-relay/proxy-surface.css`
- Delete: `packages/app/src/components/settings-v2/chat-proxy.tsx`
- Delete: `packages/app/src/components/settings-v2/chat-proxy.css`
- Delete: `packages/app/src/components/settings-v2/chat-proxy.browser.test.tsx`
- Modify: `packages/app/src/components/settings-v2/providers.tsx`
- Modify: `packages/app/src/pages/canvas/master-agent.e2e.browser.test.tsx`
- Modify: `packages/app/src/pages/canvas/master-agent.integration.browser.test.tsx`
- Modify: `packages/app/src/test/track-examples.test.ts`

**Interfaces:**

- Consumes: Task 2's canonical ChatRelay surface.
- Produces: no App import, raw fetch, localStorage key, polling loop, provider-setting entry, or tracked example for ChatProxy.

- [ ] **Step 1: Update consumer-visible tests first**

  Change the settings/provider and tracked-example expectations so ChatProxy is absent. The production change that makes them pass is removal of the settings entry and obsolete surface imports.

- [ ] **Step 2: Verify RED**

  From `packages/app`, run the affected settings test and `src/test/track-examples.test.ts`; require failures that name the still-present entry/example.

- [ ] **Step 3: Delete the obsolete App path**

  Remove the five files and all imports, fixtures, fetch mocks, and navigation entries that exist only for them. Do not add a disabled placeholder.

- [ ] **Step 4: Verify GREEN**

  From `packages/app`, run `bun run test:unit`, the focused canvas browser tests, and `bun typecheck`.

- [ ] **Step 5: Commit**

  ```powershell
  git add -A packages/app/src
  git commit -m "refactor(app): remove chat proxy surfaces"
  ```

### Task 4: Remove the public ChatProxy transport and preserve legacy data

**Files:**

- Delete: `packages/protocol/src/groups/chat-proxy.ts`
- Delete: `packages/server/src/handlers/chat-proxy.ts`
- Delete: `packages/server/src/chat-proxy.ts`
- Delete: `packages/server/src/chat-proxy-worker.mjs`
- Modify: `packages/protocol/src/api.ts`
- Modify: `packages/server/src/handlers.ts`
- Modify: `packages/server/package.json`
- Modify: `packages/client/test/promise.test.ts`
- Modify: `packages/opencode/test/server/httpapi-exercise/index.ts`
- Modify: `packages/core/test/workspace/chat-relay-payload.test.ts`
- Generated: `packages/client/src/generated/**`
- Generated: `packages/client/src/generated-effect/**`
- Generated: `packages/sdk/js/src/v2/gen/**`

**Interfaces:**

- Consumes: release approval for the intentional public API break.
- Produces: no `server.chatProxy` API group or generated client members; unchanged `ChatRelayPayload` service/table and untouched `Global.Path.data/chat-proxy` directories.

- [ ] **Step 1: Establish data compatibility**

  Extend the payload test with an on-disk temporary database opened through normal migrations, insert a literal pre-cutover payload row, close/reopen it, and assert `list` returns the row. Do not add a migration or production method. This is a characterization/data-safety test; record its baseline result before deletions.

- [ ] **Step 2: Write the failing public-surface test**

  Remove `server.chatProxy` from the literal group list in `packages/client/test/promise.test.ts` and remove ChatProxy cases from the HTTP exercise inventory. Run the client test before changing Protocol; expected: failure because the generated client still exposes the group.

- [ ] **Step 3: Remove Protocol and Server composition**

  Delete the group, handler, service, and worker; remove their composition imports. Remove `playwright` and `@opencode-ai/relay` from `packages/server/package.json` only after repository search confirms no remaining Server import.

- [ ] **Step 4: Regenerate clients**

  Run `bun run generate` from `packages/client`, then `bun ./script/build.ts` from `packages/sdk/js`. Never hand-edit generated files.

- [ ] **Step 5: Verify the full removal**

  Run the Core payload test/typecheck, Protocol tests/typecheck, Server `bun test test`/typecheck, Client tests/typecheck/check-generated, SDK tests/typecheck, and OpenCode HTTP API exercise. Search the repository for `ChatProxy|chatProxy|chat-proxy`; only the compatibility plan/docs and intentionally retained on-disk path documentation may remain.

- [ ] **Step 6: Commit**

  ```powershell
  git add -A packages/core/test/workspace/chat-relay-payload.test.ts packages/protocol packages/server packages/client packages/sdk/js packages/opencode/test/server/httpapi-exercise/index.ts
  git commit -m "refactor(api): remove chat proxy transport"
  ```

### Task 5: Prune ChatRelay runtime and manager duplication

**Files:**

- Delete: `packages/app/src/pages/canvas/runtime/adapters/session-binding.ts`
- Delete: `packages/app/src/pages/canvas/runtime/adapters/session-binding.test.ts`
- Modify: `packages/app/src/pages/canvas/runtime/block-runtime-host.tsx`
- Modify: `packages/app/src/pages/canvas/manager.ts`
- Modify: `packages/app/src/pages/canvas/blocks/chat-relay/types.ts`
- Modify: affected runtime/manager/browser tests

**Interfaces:**

- Consumes: Task 2 registration-owned `ensure` and event invalidation.
- Produces: generic runtime lifecycle only—resolve, subscribe, invalidate/refetch, select, dispatch, dispose—with no ChatRelay global trace or manager synchronization.

- [ ] **Step 1: Add a failing integration assertion**

  In the closest existing canvas integration test, assert one ChatRelay binding ensure per runtime resolution and successful binding without manager pre-synchronization. The production change that makes it pass is removal of `syncChatRelayBindings` and its listeners.

- [ ] **Step 2: Verify RED**

  Run the focused integration test from `packages/app`; require the expected duplicate-call or manager-ownership failure.

- [ ] **Step 3: Remove the duplication**

  Delete the unused adapter after `rg` proves no production import. Remove `chatRelayRevisions`, `syncChatRelayBindings`, related manager listeners, the ChatRelay-only trace effect, diagnostic UI text tied to it, and obsolete Runtime v2/proxy fields. Preserve native/projected/local/static runtime modes and CtxPack behavior.

- [ ] **Step 4: Verify GREEN**

  Run the focused integration/runtime tests, `bun run test:unit`, and `bun typecheck` from `packages/app`.

- [ ] **Step 5: Commit**

  ```powershell
  git add -A packages/app/src/pages/canvas
  git commit -m "refactor(app): prune canvas runtime duplication"
  ```

### Task 6: Harden reconnect/authority boundaries and document the result

**Files:**

- Modify only on failing evidence: `packages/app/src/context/server-sdk.tsx`
- Modify only on failing evidence: `packages/app/src/pages/canvas/runtime/event-router.ts`
- Modify only on failing evidence: `packages/app/src/pages/canvas/runtime/provider.tsx`
- Modify: existing canvas browser/integration tests
- Modify: `packages/opencode/test/cli/serve/serve-process.test.ts`
- Modify: `packages/opencode/test/server/httpapi-ui.test.ts` only for a demonstrated composition gap
- Modify: `specs/workspace-canvas/block-runtime-v3-contract.md`
- Modify: obsolete ChatRelay/OperatingChat handoff documents
- Modify: `specs/backend/cybermaster-host-manager-future-plan.md` status/checklist after verified completion

**Interfaces:**

- Consumes: Tasks 1-5 final runtime and API surface.
- Produces: automated evidence for one combined listener, one event connection per context, per-registration reconnect coalescing, server-authoritative bindings/layout, and restart-safe refetch.

- [x] **Step 1: Add failing acceptance tests only where coverage is absent**

  Cover file-backed reload binding reuse, two independently mounted context reset convergence, duplicate event idempotence, reason-aware reconnect refresh per registration, stale layout-cache reconciliation, and exactly one durable `session_input` admission. Name the concrete behavior each test protects; do not assert source text.

- [x] **Step 2: Implement only demonstrated gaps**

  Fix the existing authority/reducer boundary. Do not add an event journal, outbox, cache database, operation queue, or new runtime abstraction.

- [x] **Step 3: Prove combined-server composition**

  Extend the real-process server harness so `/global/health`, one V2 endpoint, and a fixture UI from `OPENCODE_WEB_UI_DIR` respond from one listener. Reuse existing SSE/PTY tests; do not automate browser launching.

- [x] **Step 4: Update architecture documentation**

  Record final registration responsibilities, remove claims about polling/local transcript/manager synchronization, and document the one-release retention window for payload rows and browser profiles.

- [x] **Step 5: Run complete verification**

  Run the package-scoped verification matrix in the governing spec for Schema, Core, Protocol, Server, Client, SDK, App, and OpenCode. Regenerate twice and require a clean second generation. Manually smoke `opencode web` and `opencode serve` if executable launching is available.

- [x] **Step 6: Commit**

  ```powershell
  git add packages/app packages/opencode/test specs docs/superpowers/plans/2026-08-24-cybermaster-opencode-native.md
  git commit -m "test(canvas): verify opencode native architecture"
  ```
