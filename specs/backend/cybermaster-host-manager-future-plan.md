# CyberMaster OpenCode-Native Architecture — Verified Implementation Record

Status: implemented and verified on `feature/CyberMaster` on 2026-08-24, with
the Windows-only upstream/platform limitations recorded in Work Package 6

> This file began as the governing implementation plan and now records the
> verified result. Historical work-package instructions remain for audit and
> rollback context; they are not an unchecked future roadmap.

**Goal:** Complete CyberMaster as an OpenCode-native Web UI and workspace experience by converging its blocks on the existing OpenCode session, persistence, API, and event infrastructure.

**Architecture:** Keep one deployable OpenCode process. `opencode web` remains the production composition root and serves the SolidJS UI, V1/V2 HTTP APIs, server-sent events, and PTY WebSockets from one origin. CyberMaster is a product/UI capability inside that boundary, not a second host, proxy, supervisor, database, or executable.

**Tech stack:** Bun, TypeScript, Effect, Effect Schema/HttpApi, SQLite/Drizzle, SolidJS, Block Runtime v3, SessionV2, EventV2, and the generated OpenCode clients.

**Source baseline:** implementation started from `feature/CyberMaster` at
`5ffe6dcfa`; Task 6 started exactly at `677f146cf71f55e29bb42c61bb1297fff29967b8`.

**Related specifications:**

- `specs/workspace-canvas/block-runtime-v3-contract.md`
- `specs/workspace-canvas/architecture.md`
- `specs/architecture/Alignment1.md`
- `docs/superpowers/plans/2026-08-22-operating-agent-v1.md`
- `docs/superpowers/specs/2026-08-25-operating-chat-context-assembly-design.md`
- `docs/superpowers/plans/2026-08-25-operating-chat-context-assembly.md`

This revision replaces the earlier host-manager design. It deliberately removes the extra process, compatibility proxy, lifecycle supervisor, separate metadata database, runtime selector, and generic execution-engine contract.

## Verified implementation status

| Slice | Result | Commit/evidence |
| --- | --- | --- |
| OperatingChat reset | Complete | `3250a8d30`, `59df7751a`; typed revision-guarded reset and active browser error/success coverage |
| ChatRelay session surface | Complete | `3b9cbead2`; canonical `CanvasSessionSurface` path |
| Browser ChatProxy removal | Complete | `21d95eedd`; no App proxy surface/settings/polling/local transcript |
| Public ChatProxy removal and retention | Complete, intentional API break | `320eda110`; generated clients rebuilt; payload rows/profile directories retained |
| Runtime/manager pruning | Complete | `97650db9c`; registrations own binding resolution/invalidation |
| Generic workspace recovery | Complete | `677f146cf`; one retry after typed missing-workspace recovery |
| Authority/reconnect hardening | Complete | file-backed reload, independent-context reset, duplicate-ID, reason-aware reconnect, stale-layout, and real-process listener tests |

Architecture is OpenCode-only and single-process. `opencode web`/`opencode
serve` use the existing listener composition; there is no CyberMaster
executable, proxy, supervisor, database, event journal, or host queue. Canvas
uses `workspace_v2` services while the legacy `workspace` model and its
existing bridge remain outside this program's scope.

The public ChatProxy API removal is an intentional breaking change. The Core
`chat_relay_payload` table/service and `Global.Path.data/chat-proxy` profile
directories are dormant and untouched for the first release containing the
removal. Export or deletion requires a separate explicit change.

Browser layout storage is a disposable projection: it may cache block identity
and transforms, reconciles to a newer server revision, and can be deleted
without losing session/domain state. Session IDs, transcripts, queue state,
runtime status, and binding revisions remain server-owned.

## 1. Decision summary

The target is:

```text
Browser
  |
  | same-origin HTTP + one event stream + PTY WebSocket
  v
opencode web
  |
  +-- packages/opencode: production listener, existing V1 surfaces, UI assets
  +-- packages/server: V2 HttpApi handlers mounted by packages/opencode
  +-- packages/core: workspace, layout, FunctionalityInstance, SessionV2
  +-- existing OpenCode SQLite/storage
```

The target is not:

- a `packages/cybermaster` composition-root package;
- a `cybermaster` executable or alias;
- a child-process launcher, lock owner, readiness-file protocol, or restart loop;
- a second public listener or transparent API/WebSocket proxy;
- a CyberMaster-specific database or mirrored transcript index;
- an execution-engine adapter, selector, or capability-negotiation layer;
- a second browser event stream, transcript store, prompt queue, or session state machine;
- a universal operation, artifact, retrieval, or audit platform without a current consumer.

If distribution later needs a branded command, specify it separately as a thin alias only after a concrete packaging requirement exists. It must not introduce a new runtime boundary.

## 2. Architectural simplification recommendations

Each recommendation below is both a design rule and a review criterion.

### 2.1 Use the existing combined OpenCode server

`packages/opencode/src/cli/cmd/web.ts` already starts `packages/opencode/src/server/server.ts`. That listener already composes the browser assets, OpenCode APIs, SSE, and PTY WebSockets. Keep it as the production boundary.

**Why:** A second front door would add port coordination, authentication forwarding, streaming proxy behavior, WebSocket backpressure, restart reconciliation, health protocols, packaging, and a second failure domain without adding user-visible capability. Internal package modularity does not require another process.

### 2.2 Make OpenCode the only durable authority

Use the existing Core/Server persistence for workspaces, layouts, FunctionalityInstance configuration, SessionV2 inputs/messages, context, and event replay. CyberMaster Canvas uses the V2 workspace/layout services. OpenCode's legacy workspace table and the existing legacy/V2 projection remain internal compatibility state during this program; do not try to reconcile or remove them here. Do not mirror either model into a CyberMaster database.

**Why:** OpenCode currently contains legacy and V2 persistence, but that is still one product-owned data boundary. Adding a third store would create another dual-write and reconciliation problem. The clean modular boundary is the existing service API, not a second physical store.

### 2.3 Converge every conversational block on SessionV2

OperatingChat, MasterAgent, and ChatRelay should resolve a server-owned session binding and render the shared `CanvasSessionSurface`. The surface owns presentation; SessionV2 owns durable admission and execution.

**Why:** This removes three classes of duplication at once: custom transcript state, custom prompt submission, and custom reconnect behavior. It also preserves the repository rule that durable prompt admission stays separate from provider execution.

### 2.4 Keep Block Runtime v3 as a thin UI plug-in boundary

A runtime registration may resolve host state, select a view model, subscribe/invalidate on semantic events, dispatch typed commands, and dispose resources. Preserve the existing native, projected, local, and static modes because CtxPack and static blocks use them. It must not become another session repository or orchestration layer.

**Why:** Functionality-specific registrations remain modular while shared session behavior stays centralized. This is enough extensibility for current blocks without a universal runtime schema.

### 2.5 Keep browser storage non-authoritative

Browser persistence may hold drafts, camera position, thumbnails, display preferences, the last selected OpenCode server, and disposable read caches. The existing cached layout descriptors may remain as an offline/optimistic projection when they are reconciled to the server revision and can be discarded. Browser persistence must not own session IDs, binding revisions, transcripts, durable queues, execution status, or workspace truth.

**Why:** Reconnect and multi-tab behavior become deterministic when the server can rebuild the view. Local preferences still work offline without creating competing domain state.

### 2.6 Remove ChatProxy end to end, after the UI cutover

First render ChatRelay through its existing SessionV2 binding. Then remove its polling surface, settings, Protocol group, Server handler, worker, and dependencies in one reviewable follow-up.

**Why:** Removing the old transport only after parity preserves a safe rollback point. Removing it across all layers prevents a dead API from lingering as accidental architecture.

### 2.7 Leave legacy ChatRelay storage dormant for one compatibility window

After proving there are no current production callers, leave the ChatRelay payload table and its existing `list`, `append`, and `markImportant` service contract unchanged for one released compatibility window. Add no new callers. Also leave the existing ChatProxy browser-profile directories untouched and document their data path for manual backup. Remove either storage surface only in a later migration with an explicit retention/export decision.

**Why:** Code rollback remains possible and user data or authenticated browser profiles are not destroyed as part of an architectural cleanup. A dormant table and directory are cheaper than a risky same-release destructive migration.

### 2.8 Add new data services only for proven use cases

Use existing SessionV2 history, CtxPack, System Context, workspace services, and feature-specific records. Introduce a shared artifact, search, or operation service only when at least two real consumers need the same lifecycle and its acceptance behavior is specified.

**Why:** A generic platform designed ahead of consumers tends to duplicate current services and widen every migration. Concrete consumers reveal the correct schema and ownership boundary.

The approved OperatingChat context extension follows this rule: it versions the
existing Session input sidecar, adds one internal CtxPack recall query, and
derives session identity from the existing FunctionalityInstance binding. It
uses a non-persisting authorized read for at most 16 automatic candidates,
budgets the final rendered envelope, and revalidates the full Session placement
plus binding generation/revision proof during admission. One nullable private
Session-message sidecar column keeps enriched
compaction out of public EventV2 payloads; it is not a new host repository. The
App's explicit-materialization target is only a projection of that authority. It
must not be generalized into a host-manager prompt repository, mirrored
transcript index, memory database, or second context engine.

Private Session continuity also stays out of the manager. A Core-owned,
versioned Session projection-transfer bundle carries input/compaction sidecars
and the same-workspace Context Epoch through the existing host sync routes only
with a configured valid host credential over HTTPS, literal
`127.0.0.0/8`/`::1`, or an equivalent confidential transport; private requests
never follow redirects, including proof-bearing routed prompts. Repair snapshots
at most 128 aggregates; every serialized page is at most 512 KiB and carries at
most 256 complete public events or 64 chunks for one oversized public/private
record. Both forms spool and apply atomically. Global events are only wake hints, and V2 private
admission remains gated until every managed peer negotiates the transfer
version. Intentional projection deletion is represented only by a content-free
record validated against a later authoritative revert in the same frozen
snapshot; other missing targets fail closed, and a retained revert with a still-
present target is also a projection defect. Peer attachment unions transfer-required state reported by self and
every drained worker, including retained durable V2 marker/private-sentinel
events whose projections were later reverted. Phase 1 rejects every Session workspace/location warp
unconditionally before final sync, prompt cancellation, replay, claim, or
filesystem mutation. This is a narrow repair of
current Session sync, not a generic host data platform.

### 2.9 Preserve package dependency direction

Schema defines shared data contracts. Core owns domain behavior. Protocol defines HTTP contracts. Server wires handlers. App uses Schema, Protocol, and generated clients; it must not import Core or Server runtime modules for new work.

**Why:** This keeps browser bundles independent from server implementation and lets domain behavior be tested without the UI. It also matches the repository's enforced architecture.

### 2.10 Roll out by removable slices

Land session parity before deletions, and land deletions before optional cleanup. Each phase must compile and remain independently revertible.

**Why:** Architectural simplification is safest when every step reduces the number of active paths and rollback never requires a database restore.

## 3. Final project classification

| Area | Verified status | Final treatment |
| --- | --- | --- |
| `opencode web` listener and UI serving | Implemented | Keep unchanged as the deployment boundary |
| V1 API, V2 HttpApi, SSE, and PTY on one origin | Implemented | Reuse; do not proxy |
| Legacy and V2 workspace persistence | Implemented | Use V2 for CyberMaster Canvas; retain the existing internal legacy bridge |
| Layout and FunctionalityInstance persistence | Implemented | Keep V2 services server-authoritative |
| SessionV2 durable prompt admission and execution | Implemented | Use as the only conversational runtime |
| `CanvasSessionSurface` and providers | Implemented | Reuse for all session-backed canvas blocks |
| Block Runtime v3 host, registrations, and event router | Implemented | Keep, then prune functionality-specific branches |
| One app-level event connection and reconnect fan-out | Implemented | Keep; registrations invalidate and refetch |
| OperatingChat get/ensure/reset API and Core service | Implemented | Preserve |
| OperatingChat App runtime/view | Implemented | Native session rendering plus typed reset dispatch/UI |
| OperatingChat exact sidecar replay and automatic CtxPack recall | Approved future work | Extend SessionV2/CtxPack in place; do not create a host context repository |
| ChatRelay durable SessionV2 binding | Implemented | Visible canonical session path |
| ChatRelay visible UI | Implemented | `CanvasSessionSurface`; no proxy surface |
| ChatProxy polling/localStorage/worker path | Removed | No active App, Protocol, or Server path |
| Generic session-binding adapter | Removed | Direct registrations resolve authority |
| Manager-level ChatRelay synchronization | Removed | Runtime event router and registration refetch own convergence |
| ChatRelay payload service/table | Dormant retained data | Leave contract and rows unchanged for one compatibility window |
| ChatProxy browser-profile directories | Dormant retained data | Leave untouched for that release; export/deletion is separate |
| Generic host data platform | Unproven | Do not build in this program |

This table reflects the post-implementation source audit.

## 4. Ownership model

| Concern | Authority | Browser responsibility |
| --- | --- | --- |
| CyberMaster workspace identity and directory membership | V2 Core workspace service; legacy table remains internal compatibility state | Render and request mutations |
| Layout block identity and transforms | Core layout service | Optimistic interaction only; reconcile to server revision |
| Functionality configuration and session binding | FunctionalityInstance/Core feature service | Resolve through generated APIs; never persist binding IDs locally |
| Prompt admission and queue/steer semantics | SessionV2 | Submit once with existing message identity |
| Transcript and tool lifecycle | SessionV2/OpenCode session services | Render authoritative history plus transient stream updates |
| Reconnect and replay | Existing event services plus authoritative refetch | Hold cursor/cache only; tolerate duplicates |
| CtxPack, System Context, and exact input sidecars | Existing Core CtxPack + SessionV2 services | Display clean projections; do not copy source records or private model-facing content |
| UI draft, camera, and display preferences | Browser | May persist locally because they are not shared authority |

Authoritative layout JSON remains limited to block identity, functionality identity, and visual transform. A browser copy of those descriptors is allowed only as a disposable offline/optimistic projection; it must reconcile against the server revision. Session IDs, transcript data, queue state, and runtime status belong outside layout and its cache.

## 5. Global implementation constraints

- Preserve dependency direction: Schema to Core and Protocol, then Core and Protocol to Server. New App runtime code may use Schema, Protocol types, and generated clients but never Core or Server modules.
- Preserve SessionV2 invariants in `AGENTS.md`, including durable admission before wake, explicit queue/steer vocabulary, one `llm.stream(request)` call per provider turn, and process-local Session coordination.
- Keep `opencode serve` and `opencode web` behavior compatible. This plan adds no second launch mode.
- Keep one browser event connection per active OpenCode connection context. The existing client may select its V1 or V2 event endpoint for compatibility, but it must never open both for the same context. Block registrations subscribe through the existing event router.
- Treat transient token/tool progress as transient. On reconnect or missed events, refetch the authoritative session or binding.
- Do not put full payloads into semantic events. Events invalidate projections; APIs return current state.
- Do not drop or rewrite legacy persisted data during the same release that stops using it.
- Do not delete or migrate existing ChatProxy browser-profile directories as part of code removal.
- After a public Protocol or Server `HttpApi` change, run `bun run generate` from `packages/client`; never edit generated directories directly.
- After public API removal, rebuild the legacy JavaScript SDK with `bun ./script/build.ts` from `packages/sdk/js`, which invokes the repository-mandated `packages/sdk/js/script/build.ts` generator.
- Run tests and `bun typecheck` only from package directories.

## 6. Work package 0: freeze the OpenCode-native boundary — complete

**Purpose:** Prevent later work from recreating the removed architecture under different names.

**Files to review:**

- `packages/opencode/src/cli/cmd/web.ts`
- `packages/opencode/src/server/server.ts`
- `packages/opencode/src/server/routes/instance/httpapi/server.ts`
- `packages/opencode/src/server/shared/ui.ts`
- `packages/opencode/test/cli/serve/serve-process.test.ts`
- `packages/opencode/test/lib/cli-process.ts`
- `packages/opencode/test/server/httpapi-ui.test.ts`
- `packages/app/src/entry.tsx`
- `packages/app/src/context/server-sdk.tsx`
- `specs/workspace-canvas/block-runtime-v3-contract.md`

**Steps:**

- [x] Extend the existing real-process server harness so the combined listener proves `/global/health`, one V2 endpoint, and a fixture UI from `OPENCODE_WEB_UI_DIR` are served on the same origin.
- [x] Record the existing SSE and PTY integration tests that cover the same listener; add focused coverage only for a demonstrated gap.
- [ ] Keep launching `opencode web` as a manual smoke because that command opens a browser; do not create a fragile browser-launch assertion.
- [x] Confirm the production app defaults to `location.origin` and that any selectable remote target is another OpenCode server, not a runtime abstraction.
- [x] Confirm the V2 Server routes used by CyberMaster are mounted by the combined listener.
- [x] Use the existing package typechecks to enforce dependency direction; no custom dependency analyzer was added.
- [x] Update `specs/workspace-canvas/block-runtime-v3-contract.md` where its authority rules disagreed with the verified implementation.

**Exit gate:** The team can point to one listener, one OpenCode-owned persistence boundary, one event connection per active context, and one session runtime for the target design.

## 7. Work package 1: complete OperatingChat reset — complete

**Purpose:** Finish the partially implemented native path before using it as the reference pattern.

**Modify:**

- `packages/app/src/pages/canvas/runtime/registrations/operating-chat.ts`
- `packages/app/src/pages/canvas/runtime/registrations/operating-chat.test.ts`
- `packages/app/src/pages/canvas/workspace.tsx`
- `packages/app/src/pages/canvas/master-agent.integration.browser.test.tsx` only if its shared OperatingChat fixture requires adjustment
- `packages/app/src/pages/canvas/canvas.css` only if the existing action styles cannot be reused

**Create:**

- `packages/app/src/pages/canvas/operating-chat.browser.test.tsx`

Keep reset behavior in a dedicated test so its failures are not coupled to MasterAgent coverage.

**Behavior:**

- Add `revision` to `OperatingChatView`; it already exists in the server binding and is required by reset.
- Define the narrow command `{ type: "reset" }` and make it the registration's `TCommand`.
- In `dispatch`, call the generated `v2.workspace.operatingChat.reset` endpoint with `{ workspaceID, blockID, expectedSessionID, expectedRevision }` and the runtime abort signal.
- Let the existing `BlockRuntimeHost.dispatch` refresh after success; do not add another invalidation mechanism.
- Surface stale-revision and busy responses as explicit UI feedback. Do not predict server liveness from local transcript state.
- Add a reset action near the existing retry/session controls. Disable duplicate clicks while dispatch is pending.

**Test-first steps:**

- [x] Extend `operating-chat.test.ts` with a failing test that asserts the exact reset request and abort signal.
- [x] Add a failing test for stale/busy propagation; cover the host's post-dispatch refresh in the browser test.
- [x] Implement the typed command and view fields with the smallest change to the registration.
- [x] Add a browser test that confirms reset replaces the rendered session and that a failed reset leaves the existing session mounted.
- [x] Reuse existing button/status styles where possible.

**Verification from `packages/app`:**

```powershell
bun test --conditions=solid --isolate --preload ./happydom.ts src/pages/canvas/runtime/registrations/operating-chat.test.ts
bun test --conditions=browser --isolate --preload ./happydom.ts src/pages/canvas/operating-chat.browser.test.tsx
bun typecheck
```

**Exit gate:** Ensure remains idempotent, reset is revision-guarded, busy/stale errors remain server-authoritative, and the canonical session surface renders the replacement binding.

## 8. Work package 2: cut ChatRelay over to the canonical session surface — complete

**Purpose:** Remove the last visible conversational path that bypasses its existing SessionV2 binding.

**Modify:**

- `packages/app/src/pages/canvas/blocks/chat-relay/view.tsx`
- `packages/app/src/pages/canvas/blocks/chat-relay/view.browser.test.tsx`
- `packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts`
- `packages/app/src/pages/canvas/blocks/chat-relay/runtime.test.ts`
- `packages/app/src/pages/canvas/blocks/chat-relay/types.ts`
- `packages/app/src/pages/canvas/canvas.css` only for styles still needed after cutover

**Reuse:**

- `packages/app/src/pages/canvas/session-surface.tsx`
- `packages/app/src/pages/canvas/session-surface-providers.tsx`
- `packages/app/src/pages/canvas/master-agent/session-options.ts`

**Behavior:**

- Keep the current `ChatRelayRuntimeAdapter.resolve` call to `v2.workspace.chatRelay.ensure`.
- When the runtime is ready or stale and has a session binding, render `CanvasSessionSurfaceProviders` and `CanvasSessionSurface` with that binding.
- Preserve the existing permission-denied, resolving, unavailable, and retry states.
- Preserve queue behavior through the shared surface rather than custom polling/composer code.
- Remove diagnostic text that points users at global trace state once the dedicated trace branch is removed.
- Do not copy MasterAgent's controller; reuse only its pure session-target option builder if it remains necessary.

**Test-first steps:**

- [x] Change `view.browser.test.tsx` to expect the bound SessionV2 target and verify the old relay surface is not mounted.
- [x] Add coverage for resolving, permission-denied, error, and ready states.
- [x] Implement the surface swap without changing the binding service or Protocol.
- [x] Run the existing runtime tests to prove binding invalidation still refetches after `workspace.chatRelay.binding.updated`.
- [ ] Manually verify one prompt, streamed text, a tool event, queue/steer behavior, cancellation, and reconnect.

**Verification from `packages/app`:**

```powershell
bun test --conditions=solid --isolate --preload ./happydom.ts src/pages/canvas/blocks/chat-relay/runtime.test.ts
bun test --conditions=browser --isolate --preload ./happydom.ts src/pages/canvas/blocks/chat-relay/view.browser.test.tsx
bun typecheck
```

**Exit gate:** ChatRelay uses one server-owned binding, one transcript authority, one composer, and the same reconnect behavior as the other session-backed blocks.

## 9. Work package 3: remove the ChatProxy stack — complete

**Purpose:** Delete the duplicated transport and browser-owned session behavior after ChatRelay parity is proven.

**Delete from App:**

- `packages/app/src/pages/canvas/blocks/chat-relay/proxy-surface.tsx`
- `packages/app/src/pages/canvas/blocks/chat-relay/proxy-surface.css`
- `packages/app/src/components/settings-v2/chat-proxy.tsx`
- `packages/app/src/components/settings-v2/chat-proxy.css`
- `packages/app/src/components/settings-v2/chat-proxy.browser.test.tsx`

**Modify in App:**

- `packages/app/src/components/settings-v2/providers.tsx`
- `packages/app/src/pages/canvas/master-agent.e2e.browser.test.tsx`
- `packages/app/src/pages/canvas/master-agent.integration.browser.test.tsx`
- `packages/app/src/test/track-examples.test.ts`

Remove obsolete imports, navigation entries, fixtures, request mocks, and tracked examples. Do not replace the setting with a disabled placeholder.

**Modify API inventory and exercise tests:**

- `packages/client/test/promise.test.ts`
- `packages/opencode/test/server/httpapi-exercise/index.ts`

**Delete from Protocol and Server:**

- `packages/protocol/src/groups/chat-proxy.ts`
- `packages/server/src/handlers/chat-proxy.ts`
- `packages/server/src/chat-proxy.ts`
- `packages/server/src/chat-proxy-worker.mjs`

**Modify:**

- `packages/protocol/src/api.ts`
- `packages/server/src/handlers.ts`
- `packages/server/package.json`

Remove the ChatProxy group and handler from composition. Remove `@opencode-ai/relay` and `playwright` from `packages/server/package.json` only after `rg` proves no remaining Server source imports them.

**Retain:**

- `packages/core/src/workspace/chat-relay-payload.ts`
- `ChatRelayPayloadTable` in `packages/core/src/workspace/sql.ts`
- existing migration history and payload tests
- existing `Global.Path.data/chat-proxy` browser-profile directories on disk

Treat the retained payload service as a dormant compatibility contract: keep `list`, `append`, and `markImportant` intact for rollback, prove no production caller remains, and add no new call sites. Do not drop the table or delete browser profiles in this work package.

This plan chooses an intentional breaking removal of the public ChatProxy API and its generated client members. Before Work Package 3 merges, inventory downstream consumers and record the removal in release notes. If the target release cannot accept a breaking API change, stop after the App cutover and move Protocol/Server deletion to the next breaking release rather than shipping an undocumented break.

**Test-first and generation steps:**

- [x] Add or update App tests so the canonical session path is the only expected ChatRelay transport.
- [x] Confirm the release may remove the public ChatProxy API and update the client group inventory plus HTTP exercise coverage.
- [x] Remove App surfaces and settings.
- [x] Remove the Protocol group and Server implementation.
- [x] Run `rg -n "ChatProxy|chatProxy|chat-proxy" . --glob "!node_modules/**" --glob "!.git/**"` and classify every remaining match; generated output may remain only until regeneration.
- [x] Run `bun run generate` from `packages/client`.
- [x] Run `bun ./script/build.ts` from `packages/sdk/js`.
- [x] Run generation a second time and require a clean generated diff.
- [x] Extend `packages/core/test/workspace/chat-relay-payload.test.ts` or add a focused database compatibility test that creates an on-disk pre-cutover payload row, reopens the database through normal migrations, and verifies the row remains readable.
- [x] Document that browser profiles remain under `Global.Path.data/chat-proxy`; do not copy, inspect, or delete their sensitive contents.

**Package verification:**

```powershell
# packages/core
bun test test/workspace/chat-relay-payload.test.ts
bun typecheck

# packages/protocol
bun test
bun typecheck

# packages/server
bun test test
bun typecheck

# packages/client
bun run generate
bun run check:generated
bun test
bun typecheck

# packages/sdk/js
bun ./script/build.ts
bun test
bun typecheck
```

**Exit gate:** No App code calls `/api/chat-proxy`; no browser polling or relay localStorage remains; the approved breaking removal is absent from Protocol, HTTP exercise coverage, and generated clients; the on-disk payload fixture still reads; browser-profile directories remain untouched.

## 10. Work package 4: prune runtime and canvas duplication — complete

**Purpose:** Make Block Runtime v3 a generic UI boundary after functionality-specific migration scaffolding is no longer needed.

**Delete:**

- `packages/app/src/pages/canvas/runtime/adapters/session-binding.ts`
- `packages/app/src/pages/canvas/runtime/adapters/session-binding.test.ts`

Delete only after `rg` confirms no production registration imports the adapter.

**Modify:**

- `packages/app/src/pages/canvas/runtime/block-runtime-host.tsx`
- `packages/app/src/pages/canvas/manager.ts`
- `packages/app/src/pages/canvas/blocks/chat-relay/types.ts`
- affected runtime, manager, and browser tests

**Simplifications:**

- Remove the ChatRelay-only global trace branch from `BlockRuntimeHost`.
- Remove `chatRelayRevisions`, `syncChatRelayBindings`, and manager listeners that duplicate the registration's ensure/event invalidation path.
- Prune obsolete Runtime v2 and proxy fields from ChatRelay types; keep only live component props and runtime views.
- Remove renderer fallbacks that bypass a registered native block view.
- Keep the generic host lifecycle: resolve, subscribe, invalidate/refetch, select, dispatch, dispose.
- Keep local view storage available only for presentation state. Do not add session-specific keys.

**Test-first steps:**

- [x] Add a failing integration test proving ChatRelay binds correctly without manager pre-synchronization.
- [x] Add a reconnect test proving the registration refetches through the existing event router.
- [x] Remove one legacy path at a time and run its closest tests after each deletion.
- [x] Search for the removed symbols and require zero production matches.

**Verification from `packages/app`:**

```powershell
bun run test:unit
bun typecheck
```

Run the focused canvas browser suite as well; use the full browser suite before merging.

**Exit gate:** Each session-backed block reaches SessionV2 through its registration, and neither the manager nor the generic host contains ChatRelay-specific session orchestration.

## 11. Work package 5: authority, reconnect, and data-boundary hardening — complete

**Purpose:** Prove the simplified ownership model under reloads, reconnects, and concurrent UI activity.

**Likely files:**

- `packages/app/src/context/server-sdk.tsx`
- `packages/app/src/pages/canvas/runtime/event-router.ts`
- `packages/app/src/pages/canvas/runtime/provider.tsx`
- `packages/app/src/pages/canvas/manager.ts`
- `packages/core/src/workspace/service.ts`
- `packages/core/src/workspace/functionality-instance.ts`
- corresponding tests

Only modify these files when a failing acceptance test demonstrates a gap.

**Scenarios:**

- [x] Fresh service stacks over the same file-backed database reuse OperatingChat and ChatRelay bindings and their durable SessionV2 rows; browser remount also reselects those host bindings.
- [x] Two independently mounted `BlockRuntimeProvider` contexts use distinct fake ServerSDK context objects and routers, sharing only backend state/event broadcast, and converge after one OperatingChat reset.
- [x] A replayed event ID is ignored after the first post-refresh delivery; no-ID events remain at-least-once.
- [x] A missed transient token delta recovers from authoritative history.
- [x] Each active runtime registration coalesces duplicate reconnects while reconnect refresh is active/pending, queues one trailing reconnect after a non-reconnect refresh, and retains semantic invalidation during reconnect.
- [x] ServerSDK classifies initial versus later stream establishment for its context, so a late-mounted Provider handles its first observed real reconnect while a true initial connection causes no false refresh.
- [x] Layout serialization contains no session ID, transcript, queue, or runtime status.
- [x] Browser storage contains only presentation preferences, drafts, cursors, and disposable caches; a cached layout descriptor reconciles to the server revision and can be deleted without domain data loss.
- [x] A prompt action creates exactly one durable `session_input` admission.
- [x] OperatingChat reset and ChatRelay binding replacement reject stale revisions.
- [x] Active or pending sessions cannot be reset through a stale browser view.

Do not add a new event journal, outbox, cache database, or operation queue to make these tests pass. Fix the existing authority or reducer boundary.

**Exit gate:** Browser, server, and event reconnects converge by refetching existing OpenCode authority without duplicate execution or local domain ownership.

## 12. Work package 6: full verification and documentation — complete with recorded platform limitations

**Documentation updates:**

- Update `specs/workspace-canvas/block-runtime-v3-contract.md` with the final registration responsibilities.
- Update any ChatRelay/OperatingChat handoff documents that still describe polling, local transcript ownership, or manager synchronization.
- Archive obsolete handoff documents if they are no longer useful; do not leave them as apparent current design.
- Record the legacy payload retention window and the separate decision required before deletion.

**Full package verification:**

Run from each package directory, never from the repository root.

```powershell
# packages/schema
bun test
bun typecheck

# packages/core
bun test
bun typecheck

# packages/protocol
bun test
bun typecheck

# packages/server
bun test test
bun typecheck

# packages/client
bun run generate
bun run check:generated
bun test
bun typecheck

# packages/sdk/js
bun ./script/build.ts
bun test
bun typecheck

# packages/app
bun run test:unit
bun run test:browser
bun typecheck
bun run build

# packages/opencode
bun test
bun run test:httpapi
bun typecheck
bun run build
```

**Recorded results (2026-08-24):**

| Package | Command | Result |
| --- | --- | --- |
| Schema | `bun test`; `bun typecheck` | 50 pass, 0 fail; typecheck clean |
| Core | `bun test`; `bun typecheck` | 1,342 pass, 7 Windows skips, 0 fail; typecheck clean |
| Protocol | `bun test`; `bun typecheck` | 74 pass, 0 fail; typecheck clean |
| Server | `bun test test`; `bun typecheck` | 36 pass, 0 fail; typecheck clean |
| Client | generate twice, `check:generated`, test, typecheck | both generations reproducible; 16 pass, 0 fail; typecheck clean |
| SDK JS | build twice, test, typecheck | both generations reproducible; 1 pass, 0 fail; typecheck clean |
| App | unit, browser, typecheck, build | 1,233 pass/22 skip unit; 43 pass browser; typecheck and build clean |
| OpenCode | focused Task 6 tests | runtime host 11 pass; router 3 pass; real-process listener 2 pass; access-first ChatRelay 1 pass |
| OpenCode | `bun run test:httpapi`; `bun typecheck` | coverage/auth/effect each 233 pass with 0 fail/skip/missing/extra; typecheck clean |
| OpenCode | `bun test` | 3,402 pass/58 skip/1 todo/14 fail before focused triage; see limitations below |
| OpenCode | embedded packaging follow-up | `bun run build --single --skip-install` and binary smoke passed; both all-target `bun run build --skip-install` attempts later stopped on external Bun runtime extraction; see limitations below |

The reconnect follow-up reran the affected boundaries after correcting the
original overly broad in-flight reconnect suppression: App runtime/router unit
tests passed 14/0, focused browser host/manager coverage passed 85/0, the full
App unit suite passed 1,239 with 22 skips and 0 failures, and App typecheck was
clean. The real file-backed Core integration file passed 8/0 and Core typecheck
was clean. These results supplement, rather than rewrite, the original full
matrix above.

The OpenCode monolithic test failures were triaged without unrelated production
changes. Seven tests consistently failed because this Windows account cannot
create symlinks (`EPERM`). Two existing Windows path-normalization tests
consistently assumed the temporary directory and checkout use the same drive
(`C:` versus `D:` here). Three five-second timeouts and one ACP subprocess
timeout passed in focused reruns (103 pass/0 fail across the timeout files).
The remaining ChatRelay test was a stale expectation: the live access port has
required workspace membership since `132035f33`, so access is intentionally
checked before existence and returns 403 without revealing the workspace. The
test now asserts `ChatRelayAccessDeniedError` and passes focused.

Both original OpenCode build attempts first completed the embedded App Vite
build, then rejected all generated `../../../../app/dist/...` file-loader
imports while building the first cross-target binary despite the referenced
files existing. The separate packaging follow-up corrected that virtual-module
import base. On Windows, `bun run build --single --skip-install` completed and
its built binary passed the version smoke; `bun typecheck` and all 14 focused
`test/server/httpapi-ui.test.ts` tests also passed. Two all-target
`bun run build --skip-install` attempts passed the former asset-resolution
point and built `opencode-linux-arm64`, then reproducibly failed while Bun
extracted its external `bun-linux-x64-v1.3.14` runtime with “download may be
incomplete.” The all-target release matrix is not green; this remaining result
is classified as an external artifact/environment limitation. The skip-install
runs left `bun.lock`, the root manifest, and the OpenCode manifest unchanged.
App's own production build remains clean.

**Manual smoke verification:**

- [ ] Start `opencode web` with the built UI.
- [ ] Open an existing workspace and canvas.
- [ ] Exercise MasterAgent, OperatingChat, and ChatRelay.
- [ ] Verify prompt streaming, tools, approval, cancellation, queue/steer, and reset behavior.
- [ ] Open and close a PTY.
- [ ] Reload during a run and confirm authoritative recovery.
- [x] Start `opencode serve` and verify its existing API-only behavior remains intact through the real-process listener test.

The interactive `opencode web` browser smoke and hands-on canvas/PTY checks were
not run in this non-interactive verification session. Combined-listener API/UI
behavior was exercised by the real-process `serve` test; existing SSE coverage
passed and Windows PTY tests remained skipped as expected.

The one-connection gate is automated rather than a manual-smoke checkbox:
ServerSDK compatibility coverage proves selection of one V1-or-V2 endpoint,
its context-local marker distinguishes initial establishment from retries and
page resumes, and the independent-provider test proves distinct SDK accessors
with one router/emitter subscription per mounted context. Optional DevTools
network inspection remains release smoke,
not missing Task 6 acceptance evidence.

## 13. Acceptance gates

| Gate | Required result |
| --- | --- |
| One deployment boundary | `opencode web` serves UI, APIs, SSE, and PTY; no CyberMaster listener or child process exists |
| No third data authority | CyberMaster uses V2 OpenCode services; the existing legacy/V2 bridge remains internal and no CyberMaster store is added |
| One session runtime | MasterAgent, OperatingChat, and ChatRelay use SessionV2 and `CanvasSessionSurface` |
| One prompt path | A user action creates exactly one durable admission and no duplicate provider call |
| One event connection | One V1-or-V2 browser event connection feeds the runtime router for each active context; reconnect refetches authority |
| No layout leakage | Layout has block/functionality identity and transforms, not session or runtime state |
| No obsolete relay stack | No ChatProxy UI, route, worker, polling loop, local transcript, or Server-only dependencies remain |
| Capability honesty | Unsupported controls are absent; no fake success or simulated execution |
| Data safety | An on-disk legacy ChatRelay payload fixture remains readable and ChatProxy browser-profile directories remain untouched during the compatibility window |
| Dependency integrity | Changed App runtime surfaces add no imports forbidden by the repository dependency rules; generated clients are reproducible |
| Command compatibility | Existing `opencode web` and `opencode serve` workflows still pass smoke tests |

Automated acceptance is complete. The unchecked interactive browser/PTY items
above remain recommended release smoke; they are recorded honestly and do not
stand in for the automated authority, connection, or persistence evidence.

## 14. Rollout and rollback

Recommended commit sequence:

1. `feat(app): complete operating chat reset`
2. `refactor(app): render chat relay session`
3. `refactor(server): remove chat proxy transport`
4. `refactor(app): prune canvas runtime duplication`
5. `test(canvas): verify session authority recovery`
6. `docs(canvas): record opencode native architecture`

Do not combine the ChatRelay UI cutover and ChatProxy deletion in the same commit. The intermediate state is the rollback point: the canonical UI is active while the old endpoint still exists but is unused.

Rollback requires no schema or data restoration:

- revert the most recent work package;
- restart the unchanged OpenCode process;
- do not restore or rewrite the database;
- keep legacy payload rows until the retention decision is made in a later release.

Rollback does not undo legitimate user mutations made while the new code was active, including an OperatingChat reset that replaced a durable FunctionalityInstance session binding.

Rollback is code-scoped, not time travel. Reverting the Task 6 hardening commit
does not require a database restore. Reintroducing the removed ChatProxy API
would require reverting its Protocol, Server, App, dependency, and generated
client changes together. Retained payload rows and browser profiles make that
possible without destructive recovery, but rollback does not replay requests,
reverse SessionV2 admissions, or undo layout/session mutations created while
the new code was active.

## 15. Historical estimate

For one engineer familiar with the repository:

| Workstream | Estimate |
| --- | --- |
| Boundary freeze and baseline | 1-2 days |
| OperatingChat reset completion | 1-3 days |
| ChatRelay session-surface cutover | 2-4 days |
| ChatProxy removal and regeneration | 2-4 days |
| Runtime/canvas pruning | 2-4 days |
| Reconnect, authority, and regression hardening | 3-5 days |
| Documentation and final smoke pass | 1-2 days |

This was the pre-execution estimate and is retained only for planning-history
comparison; it is not remaining work.

## 16. Residual risks and mitigations

| Risk | Mitigation |
| --- | --- |
| ChatRelay relied on hidden behavior in its polling surface | Test parity on prompt, stream, tools, queue/steer, cancellation, and reconnect before deletion |
| Removing a public group leaves stale generated clients | Regenerate both client families and require a second clean generation |
| Registration ensure races descriptor persistence | Preserve `awaitDescriptorPersisted` in each registration and test create/reload ordering |
| Reset races active SessionV2 work | Keep server-side revision and busy guards authoritative |
| Old payload or browser-profile data becomes unreachable | Retain the table/service and profile directory for one compatibility window; document backup and decide export/deletion separately |
| Broad cleanup expands beyond the proven target | Require a failing test or zero-reference search before modifying adjacent infrastructure |
| Combined server behavior regresses | Smoke both `opencode web` and `opencode serve`, including SSE and PTY |

## 17. Explicitly deferred

This plan does not include:

- a new executable, supervisor, proxy, or metadata database;
- a generic execution-engine contract or runtime capability matrix;
- session migration or transcript conversion;
- a second event journal or browser connection;
- a universal operation, artifact, search, audit, scheduling, or execution-target platform;
- multi-user tenancy, distributed Session execution, or clustered ownership;
- deletion of legacy ChatRelay payload data;
- replacement of the existing OpenCode server composition.

Any deferred item requires a concrete consumer, ownership analysis, independent acceptance criteria, and a separate plan.

## 18. Assumptions

- CyberMaster runs entirely on OpenCode and does not need runtime interchangeability.
- The existing combined OpenCode listener remains the supported Web deployment path.
- Existing OpenCode storage remains authoritative and is not split or dual-written.
- The deployment is single-user/self-hosted for this program.
- Current SessionV2 and EventV2 invariants remain in force.
- The current source classification is revalidated before implementation begins.
