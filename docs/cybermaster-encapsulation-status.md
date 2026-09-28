# CyberMaster modularity review — Sol High reassessment

Reviewed 2026-09-21. This supersedes the initial review, including its incorrect footprint counts and MasterAgent lifecycle conclusion.

## Scope and evidence

- Four independent `gpt-5.6-sol` reviewers, reasoning effort `high`, provider `openai-codex`; batch `deleg_77931b62`.
- Repository: `D:/OpencodeDev`, branch `feature/CyberMaster`.
- HEAD: `b7c82166e3ed1c7c7cb64a1ac631f2a9e15404e0`.
- Comparison: locally fetched `anomalyco/dev` at `b02acc1e30ef55f7f181fec8d2f241d26f022683`. No fetch; this is not a claim about latest upstream.
- Divergence: 0 upstream-only / 146 fork-only commits.
- Full, untruncated rename-aware tree diff: **1,117 entries: 651 added, 457 modified, 5 deleted, 4 renamed**. Without rename detection: 1,121 entries (655 added, 457 modified, 9 deleted).
- Canvas contains 103 fork-added paths, including 38 test files. Totals include documentation, generated files, tests, and unrelated fixes; they are not a measure of feature-code size.
- Only `vendor/superpowers` is currently a submodule.
- Reviewers inspected code/tests without executing tests or editing files. The parent ran focused existing tests and two implementation probes, described below.
- No production source changes, dependency installs, generation, server restarts, migrations of user databases, commits, or submodule conversion were performed. Existing RepositoryCache changes are outside scope.
- Audit records: `.hermes/reviews/cybermaster-sol-high/baseline.json`, `test-evidence.json`, and `probe-evidence.json`.

## Verdict

**Useful internal module boundaries exist; independent package extraction and compatibility with unmodified upstream are not yet established.**

CyberMaster is still a cross-package fork, not a drop-in plugin. The hardest blockers are closed host composition, shared database/bootstrap ownership, private Session-context semantics, and frontend registration/rendering. Moving directories into a submodule would relocate this coupling rather than remove it.

Prefer a CyberMaster-owned composition layer consuming upstream packages, with explicit contracts and a measured residual patch inventory. An unmodified upstream checkout can eventually be the dependency only when required hooks exist or behavior is deliberately redesigned. A patched/fork-pinned submodule is a valid intermediate state, but is not vanilla OpenCode. The prior claim that the remaining patch queue would be “small” was not demonstrated.

## Boundary assessment

| Area | Internal separation | Independent extraction / vanilla compatibility |
|---|---|---|
| Block runtime and router | Useful resolve/refresh/dispatch/disposal abstraction | Contracts retain app-private types; views and metadata still hardcoded in host |
| Canvas layout | Separate presentation state and server persistence | Authority checks are not one atomic database operation; needs concurrency validation |
| MasterAgent binding | Runtime v3 is the active owner; legacy fallback remains | Confirmed producer/router mismatch prevents live binding invalidation |
| CtxPack CRUD/browser | Strongest candidate for a feature extraction | Still needs database, policy, event, API/client and host adapters |
| Session-backed bindings | Narrow Session ports exist | Direct SessionStore/table dependencies remain outside those ports |
| Public history/events | Substantial upstream-native infrastructure | CyberMaster changes hint privacy and atomic private replay integration |
| Private context/transfer | Some explicit profile/assembly/readiness ports | Ports and consuming admission/provider/compaction call sites are fork additions |
| API/client | Separate domain groups and handlers | Static API/handler assembly and codegen output remain upstream-owned |
| Storage | One database authority, which should be preserved | Fresh snapshot, upgrades, and lazy FTS bootstrap need one contribution contract |
| Host/build | Existing LayerNode/LocationServiceMap mechanisms are reusable | Server/CLI/legacy host/embedded SDK must consume consistent supplied composition |

## Findings

### F1 — Confirmed defect: MasterAgent binding events miss the live registration

**Priority: high; reproduced with actual registration, schema decoder, and event router.**

- `packages/app/src/pages/canvas/master-agent/runtime-registration.ts:61-68` subscribes using workspace, block, and `functionalityID: "builtin:master-agent"`.
- `packages/schema/src/master-agent.ts:83-92` defines the emitted binding event with workspaceID, blockID, sessionID, generation, and revision, but no functionalityID.
- `packages/core/src/workspace/master-agent-events.ts:44-53` validates this canonical payload before publishing it.
- `packages/app/src/pages/canvas/runtime/event-router.ts:95-107,151-171` requires every specified key field to match. Missing functionalityID cannot match the registered value.

The parent probe decoded a valid event, obtained the subscription key from the real registration, and emitted it through the real router. Result: **registered listener 0 deliveries; workspace/block-only control listener 1 delivery**. This is not a full browser/network reproduction, but confirms the contract mismatch directly.

Impact: cross-surface binding changes cannot invalidate through this registration; reconnect/manual refresh may still recover. Fix by removing the unnecessary functionality filter or changing the canonical producer contract. Add producer-schema → router → host-refresh coverage; the existing registration test merely asserts the problematic key (`runtime-registration.test.ts:94-101`). No fix was applied in this review.

### F2 — Layout revision/authority checks are not database-atomic

**Priority: high validation risk; structural evidence confirmed, lost update NOT reproduced.**

`packages/core/src/workspace/service.ts:729-766` reads a layout, separately checks authority/revision, then updates by layout ID alone. `requireAuthority` also reads separately (`:468-490`). There is no enclosing save transaction or `WHERE revision = expectedRevision` predicate in this path.

The backend reviewer predicted two overlapping saves could both succeed with revision N+1. The parent exercised the actual service using SQLite `:memory:` and 32 concurrent same-holder saves against revision 0: **1 success, 31 failures, final revision 1**. That probe did not reproduce the predicted race. It also does not prove safety for independently scheduled connections/processes or an authority handover between validation and write.

Do not call this a reproduced lost-update defect or treat the current check as proven atomic CAS. Next validation should exercise multiple database connections/processes and a controlled read/write interleaving. If strengthened, authority validation plus conditional revision update should share an immediate transaction, with conflict derived from the actual affected row. Keep post-commit transient notification semantics explicit. Client save serialization is not a global server lock.

### F3 — A block registration is not yet a complete extension

**Priority: high extraction blocker.**

`runtime/registrations/index.ts:9-24` registers lifecycle adapters, while `packages/app/src/pages/canvas/workspace.tsx:160-189,301-372,1562-1651` separately owns type maps, metadata, and concrete JSX branches. Unknown advertised functionality becomes an error block (`workspace.tsx:903-916`).

A new block cannot supply its implementation through registration alone. Introduce an injected descriptor owning functionality identity, palette/chrome metadata, constraints, runtime registration, and view factory. Keep backend manifest validation distinct from frontend rendering capability: a server-advertised plugin ID is not proof the client has its renderer.

### F4 — Frontend composition still relies on fork-modified app internals

**Priority: high extraction blocker.**

`packages/app/src/pages/layout-new.tsx:2-20` mounts Canvas directly; `packages/app/src/app.tsx:372-379,590-607` substitutes that layout for normal route content. The app exports no Canvas/shell contribution entrypoint (`packages/app/package.json:6-13`).

`runtime/contracts.ts:1-4` imports ServerSDK/DraftStore as **types only**: this is source/type coupling, not itself a runtime bundle edge. Stronger runtime coupling is in `block-chat.tsx:5-22`, `session-surface-providers.tsx:1-9`, and ChatRelay view imports. Session surfaces also use a Core encoding utility; an isolated browser package should obtain that from a browser-safe boundary instead of Core.

Use a host shell slot and injected SessionSurfaceFactory, transport, drafts, and local-view ports. The current app can implement the adapters. Do not assume vanilla session-ui contains the fork's queue/composer behavior (`packages/session-ui/src/v2/components/prompt-input/index.tsx:267-285`).

### F5 — Storage and Session coupling survive the existing narrow ports

**Priority: high extraction blocker.**

MasterAgent has a Session port (`packages/core/src/workspace/master-agent.ts:41-119`) but also reads SessionStore/input tables and joins Session/Functionality tables (`:15-20,154-201,508-522`). OperatingChat likewise depends on SessionStore/input tables. CtxPack wiring binds directly to Database, capability, EventV2 and SessionInput (`packages/core/src/ctxpack/wiring.ts:6-21,64-102`).

Move contracts outward, but retain implementation adapters that know native Session/SQL inside the OpenCode integration layer. Add narrow pending-input, binding-query, and resolve ports where needed. Preserve one Session/transcript authority and one database; introducing a second persistence service is a behavioral redesign, not a neutral extraction.

Fresh databases execute generated schema and mark migrations complete (`packages/core/src/database/migration.ts:18-40`); upgraded databases execute missing migrations (`:43-106`). CtxPack FTS is an additional lazy bootstrap path (`packages/core/src/ctxpack/sql.ts:134-150`). Extraction must preserve all three, not merely move the migration list. This is not evidence that existing fresh installs are broken—the lazy creation is deliberate.

Provide extension migration/bootstrap contributions through one host-owned Database service and journal. Avoid a reverse dependency `upstream Core → CyberMaster domain → upstream Core`, and verify fresh/upgrade schema equivalence including FTS.

### F6 — Host assembly, codegen and plugin APIs are not external feature boundaries

**Priority: high extraction blocker.**

`packages/server/src/routes.ts:81-117` closes over a configured application layer, handlers, access layers, and middleware. The main OpenCode host separately composes routes/replacements (`packages/opencode/src/server/routes/instance/httpapi/server.ts:220-232,336-385`). CLI provides the same application layer around its routes; redundant provision alone does not establish duplicate service instances. Embedded SDK hardcodes its route factory but correctly shares one memo map (`packages/sdk-next/src/opencode.ts:10-30`).

Expose explicit route/application composition inputs and thread one coherent graph through all supported hosts. Reuse existing LayerNode/LocationServiceMap behavior rather than creating another coordinator. Validate one physical Core/Effect/Database module resolution; source exports, workspace catalogs and nested installs can otherwise introduce duplicate runtime copies. This is a migration risk, not a diagnosed current duplication bug.

Protocol/handler groups are statically composed, and `packages/client/script/build.ts:7-25` generates into the current Client package. An extension contract/client needs independent output ownership so generation does not dirty a future upstream submodule. The V2 plugin context (`packages/plugin/src/v2/effect/context.ts:12-21`) has no general HTTP/migration/UI/durable-admission contribution API. Tool/provider hooks are insufficient.

### F7 — Private context continuity requires native durability hooks

**Priority: high semantic blocker.**

Upstream already owns durable admission, history, events, execution coordination, and remote SSE infrastructure. CyberMaster extends these with private context assembly/readiness (`packages/core/src/session.ts:143-154,310-343`), provider reconstruction (`session/runner/llm.ts:293-376`), compaction sidecars (`session/compaction.ts:214-280`), and transactional projection export/restore (`session/projection-transfer.ts:157-292`). Sync handlers directly use Core tables and transfer services (`packages/opencode/src/server/routes/instance/httpapi/handlers/sync.ts:18-37,76-91`).

A public-events-only bridge loses private context semantics. Keep export/restore and commit atomicity inside native Core behind an opaque private-projection port. Define policy contributions for both legacy SessionPrompt and native runner while both are supported. Host adapters may live outside Core; the missing hooks and their call sites still need accepted upstream changes or explicitly maintained patches.

### F8 — Preserve operation-level access checks when adding transports

**Priority: medium boundary hardening; not a demonstrated HTTP exploit.**

Binding HTTP access layers check workspace ownership, but underlying lifecycle services can resolve a workspace without an actor (`packages/core/src/workspace/chat-relay-session.ts:142-145`). CtxPack instead enforces membership/rights inside its domain service. New embedded or non-HTTP compositions must not accidentally bypass the binding access layer.

Expose an access-checked application service or require actor/capability inputs at public binding boundaries. Keep trusted internal service calls distinct from externally accessible operations. Do not infer an exposed authorization vulnerability merely from an internal port lacking a user argument.

## Corrections to the first review

1. **No two active MasterAgent binding owners were established.** `flag.ts:1-2` enables runtime v3; `workspace.tsx:583` disables manager reconciliation through `manager.ts:940-967`; `master-agent/block.tsx:62-92,146-153` uses legacy lifecycle only without a runtime handle. Workspace Coder configuration remains a separate responsibility. Legacy fallback is cleanup debt, not proof of duplicate live authority.
2. **EventV2 and durable inbox admission are upstream-native**, not wholly CyberMaster additions. Private sidecars/readiness/replay changes are the relevant fork delta.
3. **Two workspace concepts do not imply competing layout authorities.** Execution-target control plane and Canvas metadata serve different roles. Explicit mapping is needed for future remote placement, but shared DB/Session/composition dependencies are the stronger present blockers.
4. **One browser SSE per server context**, not one globally. Canvas routers multiplex the emitter; remote workspace loops are a different transport scope.
5. **Typed groups/ports are internal separation, not proof of package independence.** No external package or unmodified-upstream integration was built in this review.
6. **Footprint corrected:** 1,117 rename-aware entries and 103 Canvas paths, not 1,036 and 66. Prior totals were incorrectly computed from truncated tool output.
7. **“Small patch queue” is a target to measure, not an established property.**

## Sync contracts to retain

| State | Authority / concurrency | Notification and recovery |
|---|---|---|
| Layout descriptors/transforms | Server layout row; tuple-scoped holder; current revision check needs atomicity validation | Transient layout invalidation → authoritative read; client dirty-edit/reconnect recovery |
| Camera, selection, local view, drafts | Browser-local stores; draft revision guards | Local persistence; submission clears only acknowledged draft revision |
| Session-backed block binding | Functionality-instance/session services | Binding event → refetch; fix MasterAgent key mismatch |
| Public session projection | EventV2 aggregate sequence/projectors | Content-free sync hint → ordered paged history/replay |
| Private provider context | Native sidecars/epochs and transactional replay | Authenticated frozen-snapshot transfer, digests, repair, readiness fencing |
| Execution | Durable input before advisory wake; process-local Session coordinator | Promote at safe boundaries; exact retry and provider reconstruction |

Layout revisions and invalidation scopes must not be conflated. Replay ownership, layout authority, Session execution ownership, and workspace transport-loop ownership protect different invariants.

## Recommended migration order

### 0. Repair contract gaps before relocating code

Address F1 with a canonical event integration regression. Investigate F2 under controlled multi-connection concurrency. Cover active runtime behavior rather than relying on skipped legacy block tests. Leave unrelated RepositoryCache work isolated.

### 1. Prove host composition and dependency resolution

Define explicit application-layer/replacement and route inputs, extension migration/bootstrap ownership, and independent extension client generation. Preserve current single DB and memo-map/lifetime rules. Gate: all hosts resolve the same physical Core/Effect/Database modules; no reverse feature imports; codegen leaves pinned upstream untouched. Keep this as a reversible composition change, not a data migration.

### 2. Prove one minimal end-to-end slice

Use a **layout-persisted static Canvas card** as the first infrastructure proof: external descriptor/view → generated extension client → layout service/storage → invalidation/reconnect. It avoids Session/LLM/recall complexity while exercising the real boundary. Gate: register/render/create/save/reconnect/remove without editing upstream host switches; fresh and upgraded stores agree. Rollback by switching composition back, with unchanged tables/wire format.

### 3. Extract one representative feature

Follow with **CtxPack CRUD/browser**, excluding admission/recall/materialization initially. This validates permissions, FTS bootstrap, commands, selected-detail preservation, debounced events, and disposal. Frontend/backend reviewers preferred this slice because it is representative; the static card is recommended first because it isolates infrastructure failures. Keep both milestones bounded, not parallel rewrites of every block.

### 4. Move remaining features behind proven contracts

Extract ChatRelay ownership and native-session view adapters; keep workspace Coder configuration distinct from per-block bindings. Remove dormant legacy binding paths only after parity evidence. OpenCode-specific control-plane adapters belong in the integration package, not in a supposedly neutral sync package.

### 5. Resolve intrinsic Session/context hooks

Preserve exact prompt retry, admission-before-wake, resume:false, private/public separation, compaction reconstruction, authenticated transfer/repair, and one explicit model stream call per provider turn. Account for both legacy and native policies or explicitly retire one. Quantify remaining patches and seek upstream acceptance where appropriate.

### 6. Convert topology after an upstream-update drill

Only then pin upstream as a submodule. Run upstream tests/build unchanged, feature contract tests against the composed host, fresh/upgrade database checks, and network/embedded startup checks. Update the pin in a throwaway integration branch and measure patch conflicts. No unexplained vendor modifications or generation drift may remain.

## Alternatives

| Approach | Advantage | Limitation |
|---|---|---|
| Host-owned overlay with explicit upstream hooks | Best path to preserving current semantics and eventual vanilla dependency | Required hooks are not all available; patch size remains unmeasured |
| Separate frontend/service over public API | Strongest process isolation; upstream truly unchanged | Shared transactions/private native context require redesign; not behavior-equivalent today |
| Fork-pinned submodule | Fast repository ownership split, preserves current implementation | Still a fork; does not remove merge maintenance |

Do not create a broad plugin framework merely to solve closed composition. Prefer the smallest explicit host inputs and domain ports proven by a vertical slice.

## Validation performed and limits

- Existing app runtime/router/registration tests: 11 passed.
- Existing browser-conditioned runtime host and MasterAgent block tests: 23 passed, 5 skipped.
- Existing schema/contract/layout/input tests: 28 passed.
- **Combined: 62 passed, 5 skipped, 0 failed across 9 files.** Browser-conditioned tests ran under Bun/Happy DOM, not a live browser/server.
- Real MasterAgent schema/registration/router probe reproduced missing delivery (0 versus control 1).
- Actual WorkspaceService probe on SQLite :memory: ran 32 concurrent same-revision saves: 1 success, 31 failures, revision 0→1. No lost update reproduced in this scenario.
- Full suites, typechecks, live networking, multi-process layout contention, package extraction, and unmodified-upstream compatibility were not executed during this review.
- The passing existing tests do not negate F1: they do not cover the canonical producer payload through its live subscription key.

**Bottom line:** fix the proven event contract defect, validate layout atomicity, then establish host/storage/codegen ownership and demonstrate a vertical slice. Do not prioritize “choosing a MasterAgent owner”—the live path already has one—and do not make the submodule conversion the first refactor.
