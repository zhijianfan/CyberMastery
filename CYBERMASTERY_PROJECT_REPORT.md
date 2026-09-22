# CyberMastery Project Report

**Custom layer built on top of the upstream `opencode` monorepo (anomalyco/opencode)**

| | |
| --- | --- |
| Audience | Lead Engineer, Product Manager, Lead Architect |
| Report date | 2026-09-22 |
| Branch / commit | `feature/CyberMaster` @ `b7c82166e` (2026-09-20) |
| Upstream base | `anomalyco/dev` @ `b02acc1e3` (2026-09-17), merged via `ead1a67bd` |
| Fork remote | `git@zhijianfan:zhijianfan/CyberMastery.git` |
| Custom scope | 146 commits on top of upstream; ~1,117 files, +215k / -12.7k lines (includes specs, devplan, generated clients) |
| Docs of record | `CYBERMASTERY_CONTEXT.md`, `specs/workspace-canvas/*`, `specs/relay/*`, `devplan/*` |

---

## 1. Executive summary

CyberMastery is a self-hosted fork of OpenCode whose primary interface is a
server-authoritative workspace canvas. It adds a spatial multi-block UI
(OperatingChat, MasterAgent, ChatRelay, CtxPack, Scratchpad) on top of the
stock OpenCode agent runtime without introducing a second data authority: one
`opencode` combined server still owns workspaces, layouts, SessionV2 history,
CtxPacks, permissions, events, and PTY.

All major custom features are implemented and were type-checked or tested on
2026-09-22 (section 5). Two recent upstream merges required reconciliation work
(dependency patches, test layers, CLI service wiring) that is now complete; one
browser test remains blocked by a Bun tooling bug that also reproduces on
pristine upstream. Remaining work is mostly hardening, deferred orchestration
features, and documentation cleanup.

---

## 2. What is built on top of upstream opencode

| Area | What it adds | Primary code surface | Status |
| --- | --- | --- | --- |
| Workspace canvas | Host-authoritative workspaces, layouts (keyed by user/style/device), functionality instances, revisioned persistence, realtime layout events; local pan/zoom transform with no server round-trip | `packages/schema/src/workspace.ts`, `packages/core/src/workspace/*`, `packages/app/src/pages/canvas/{workspace,manager}.tsx` | Implemented, verified |
| Block Runtime v3 | Block descriptor purity, 4 render modes (native/projected/local/static), single event transport per context with dedupe, authoritative resolve on reconnect, identity = workspaceEpoch+workspaceID+blockID+functionalityID | `packages/app/src/pages/canvas/runtime/*` | Implemented, verified |
| OperatingChat | Session-backed chat block over native SessionV2; host-side steer/queue delivery; immutable private input sidecars; explicit CtxPack attach plus bounded auto-recall (≤16 candidates, ≤4 packs) | `packages/core/src/session/input.ts`, `packages/core/src/ctxpack/recall.ts`, `packages/app/src/pages/canvas/runtime/registrations/operating-chat.ts` | Implemented |
| MasterAgent | Parallel coordinator block: `workspace.model` coordinator + `workspace.coderModel` worker, hidden `parallel-master`/`parallel-worker` agents, one-turn fan-out with settlement barrier, `ChildTaskRunner` extracted from `TaskTool` | `packages/core/src/workspace/master-agent.ts`, `packages/opencode/src/tool/task-runner.ts`, `packages/app/src/pages/canvas/master-agent/*` | Implemented (V2); hardening deferred |
| CtxPack | Reusable context packs: central limits (32 fragments, 16 KiB/fragment, 64 KiB/pack), pinning, pinned + search panels (newest first, 200 ms debounce, independent paging), server-side validation and usage recording | `packages/schema/src/ctxpack*.ts`, `packages/core/src/ctxpack/*`, `packages/app/src/pages/canvas/blocks/ctxpack-browser/*` | Implemented |
| Private context continuity | Projection-transfer bundles (public events + input/compaction sidecars + context epoch), bounded authenticated sync pages (512 KiB/256 events/64 chunks), atomic replay, transfer spool and readiness proofs | `packages/core/src/session/{input,context-epoch,projection-transfer}.ts`, `packages/opencode/src/control-plane/session-context-*.ts` | Implemented |
| ChatRelay | Backend-owned visible ChatGPT page via Playwright + persistent profile; one page per user/workspace/block; reset semantics; streamed responses; model/effort discovery only on manual Refresh; server-resolved CtxPack/skill references; file attachments | `packages/server/src/chat-proxy-worker.mjs`, `packages/server/src/handlers/chat-proxy.ts`, `packages/app/src/pages/canvas/blocks/chat-relay/*` | Implemented (latest commits add file attachments) |
| Superpowers + skills | Pinned `vendor/superpowers` v6.3.0 submodule; native skill integration; composer skill mentions; skills assigned per agent (OperatingAgent plans, MasterAgent dispatches) | `packages/core/src/plugin/superpowers.ts`, `packages/core/src/skill/*`, `packages/session-ui/src/v2/components/prompt-input/*` | Implemented |
| Scratchpad / dev UI | Monologue scratchpad (copy + save-as-CtxPack), FPS dev counter, glass-canvas design system, draft store | `packages/app/src/pages/canvas/scratchpad.tsx`, `fps.tsx`, `packages/app/src/utils/draft-store.ts` | Implemented |
| Platform plumbing | New protocol groups (ctxpack, chat-proxy, skill, master-agent, sync), regenerated Promise/Effect clients and legacy JS SDK, CLI server-app-layer fix, post-merge test-layer reconciliation | `packages/protocol/src/groups/*`, `packages/client/*`, `packages/sdk/js/*`, `packages/opencode/src/...` | Implemented |

---

## 3. Architecture and boundaries

- **One deployable process.** A single `opencode` combined server serves UI,
  V1/V2 APIs, SSE events, and PTY on one origin. No second database, proxy,
  supervisor, transcript store, or context engine.
- **Dependency direction is enforced:** `Schema → Core & Protocol → Server`;
  client runtime may depend on Schema and Protocol only; `sdk-next` composes
  Client + Core + Server.
- **Canvas is presentation; the host is authority.** Layout JSON stores only
  block identity, functionality reference, and transform. Sessions,
  transcripts, queues, and execution state never live in layout.
- **Session invariants preserved:** durable prompt admission before wake, one
  `llm.stream(request)` per provider turn, clean public transcripts with private
  context in versioned sidecars, Location-scoped provider/tool/permission
  services, one browser event connection per connection context.
- **Server owns risky boundaries:** CtxPack content/skill bodies are validated
  server-side, never trusted from the client; ChatRelay page ownership and
  credentials stay in the backend worker.

---

## 4. Upstream integration status

- Branch just fast-forwarded to `b7c82166e`; the anomalyco/dev merge
  (`ead1a67bd`) was reconciled by custom commits
  (`a067d2a96`, `c02b5c116`, `9ce92133f`, `b7c82166e`).
- Required post-merge setup, now applied locally:
  - `bun install` (new `@ai-sdk/*` patches and catalog bumps, e.g.
    `@ai-sdk/amazon-bedrock@4.0.166`; this cleared the last type error).
  - `git submodule update --init vendor/superpowers` (v6.3.0; without it,
    server/core tests that load the skills plugin fail).
- Seven local test-stability files remain uncommitted (fake-timer and E2E
  spec fixes); they applied cleanly across the pull with one resolved conflict
  in `ctxpack-browser.test.tsx`.

---

## 5. Verification (2026-09-22)

| Check | Result |
| --- | --- |
| `packages/app` typecheck (`tsgo -b`) | Pass |
| `packages/core` typecheck | Pass |
| `packages/cli` typecheck | Pass (previously failing `packages/cli/src/index.ts` mismatch is fixed) |
| `packages/opencode` typecheck | Pass (after `bun install`) |
| Core CtxPack tests (`ctxpack-service`, `ctxpack-validation`) | 27 pass / 0 fail |
| Server ChatRelay handler tests | 19 pass / 0 fail (after submodule init) |
| App MasterAgent integration tests (browser) | 63 pass / 0 fail |
| App CtxPack Browser test | File-load failure: Bun 1.3.14 `mock.module` + `solid-js/h` linker bug (`dynamicProperty`). Reproduced on the pristine upstream test file, so it is tooling/environmental, not product logic. |
| Runtime | Bun 1.3.14 required; Windows-only limitations remain (symlink EPERM, path assumptions, some build artifacts). |

---

## 6. Risks and open items

1. **Upstream merge debt.** This fork carries 146 custom commits; the last
   merge needed dependency-patch, test-layer, and CLI-wiring fixes. Each merge
   must repeat: `bun install`, submodule init, generated-client regeneration,
   and test-layer reconciliation.
2. **One blocked verification path.** `ctxpack-browser.test.tsx` cannot load
   under Bun 1.3.14 on Windows (upstream test harness uses `solid-js/h` under a
   mocked `solid-js/web`). Needs a Bun fix/upgrade, a Linux CI run, or a harness
   change.
3. **Deferred MasterAgent work.** Worker owned-path enforcement, durable
   manifests, per-task cancellation, and progress cards are explicitly
   deferred; workers are not sandboxed to their owned paths yet.
4. **Spec inconsistency.** Superseded documents remain in `specs/`
   (workspace-environments, host-manager future plan, requirements §7
   acceptance vs FR-23; relay migration task T5 planned; Functionality Runtime
   Platform still a draft). Readers can be misled without a status header.
5. **ChatRelay policy exposure.** It automates a visible ChatGPT page with a
   dedicated sign-in profile; no OAuth inference endpoint exists for regular
   Chat. Usage still counts against the workspace plan, and live
   production-account verification is reported separately.
6. **Uncommitted stabilization work.** Seven files (timeline-stability E2E,
   composer focus, browser tests, merged test edits) are not yet committed.

---

## 7. Recommendations

1. Commit the seven local test-stability files after one green CI pass.
2. Add post-merge setup steps (`bun install`, submodule init, client generate,
   test-layer reconciliation) to the onboarding docs and CI cache keys.
3. Triage the `ctxpack-browser` harness failure (upgrade Bun or refactor the
   `solid-js/h` Tabs mock) so the CtxPack surface has an executable browser
   suite again.
4. Decide the next milestone explicitly: MasterAgent hardening (path
   enforcement, durable manifests) vs. Functionality Runtime Platform
   (registry, supervisor, capability service, event hub — currently draft).
5. Reconcile `specs/`: mark superseded documents, fix the requirements §7
   acceptance contradiction, and close or re-scope relay migration T5.
6. Keep the upstream merge cadence regular; smaller, more frequent merges
   reduce the reconciliation debt seen this cycle.

---

## 8. Role takeaways

- **Lead Engineer:** runtime invariants hold; typechecks pass across
  app/core/cli/opencode and focused suites are green. The critical engineering
  gap is the Bun browser-test harness failure and deferred MasterAgent
  sandboxing.
- **Product Manager:** the canvas feature set (OperatingChat, MasterAgent,
  ChatRelay, CtxPack, Scratchpad) is present and usable; next scoping decision
  is hardening vs. the Functionality Runtime Platform. ChatRelay usage/policy
  needs explicit expectations.
- **Lead Architect:** the one-authority design and Schema→Core→Protocol→Server
  direction are intact; private sidecar/projection transfer is the mechanism
  that keeps public history replayable. Watch spec drift and upstream merge
  surface area.

---

*Generated from repository state, specs, commit history, and verification runs
on 2026-09-22. Companion document: `CYBERMASTERY_CONTEXT.md`.*
