# CtxPack Browser verification

Verified on 2026-09-08. The focused suites and browser journeys were repeated against an isolated CtxPack commit candidate based on `48e377027`, excluding unrelated uncommitted work in `feature/CyberMaster`. This report supersedes the 2026-08-21 T1 report; its unexecuted browser scenarios and legacy prompt-route claims are not current acceptance evidence.

## Scope and evidence

| Boundary                                                                                                                                         | Verification                                                           | Result                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------- |
| Repository, privacy, search, revision concurrency, capsule materialization and admission                                                         | 12 Core suites using the real repository/services                      | 156 passed, 0 failed; 951 assertions      |
| Browser adapter, metadata editor, event/reconnect refresh, selection/create, composer stores, submission, preview and generated prompt transport | 14 focused App suites, isolated Solid runtime                          | 167 passed, 0 failed; 728 assertions      |
| Session surface attachment isolation                                                                                                             | Session surface browser-component suite                                | 11 passed, 0 failed; 34 assertions        |
| Runtime host refresh integration                                                                                                                 | Runtime host browser-component suite                                   | 17 passed, 0 failed; 75 assertions        |
| Existing block registration behavior                                                                                                             | Static block and operating-chat registration suites                    | 9 passed (6 + 3), 0 failed; 39 assertions |
| Chat relay runtime compatibility                                                                                                                 | Chat relay runtime suite                                               | 1 passed, 0 failed; 3 assertions          |
| Full canvas browser journey                                                                                                                      | Chromium acceptance spec                                               | 2 passed, 0 failed, 0 skipped; 24.2 s     |
| Package checks                                                                                                                                   | Core `bun typecheck`, App `bun typecheck`, App `bun run typecheck:e2e` | Passed                                    |

The App total is **205 unique focused tests**, all passing (167 + 11 + 17 + 6 + 3 + 1), in addition to the two Chromium acceptance tests.

The Core checks cover private visibility before pagination/counting, fail-closed ownership errors, punctuation-safe FTS search, atomic revision checks, source-independent snapshots, attachment limits and idempotent usage. The App checks cover authoritative refresh ownership, preservation of loaded pages and selected detail, permission-denied content clearing, real metadata edits, separate composer stores, pending-materialization send guards, draft changes during success/failure, authorized previews and the generated V2 prompt client.

## Reproduce the focused suites

From `packages/core`:

```powershell
bun test test/ctxpack-acceptance.test.ts test/ctxpack-service.test.ts test/ctxpack-materialize.test.ts test/ctxpack-capability.test.ts test/session-ctxpack-admission.test.ts test/session-ctxpack-promotion.test.ts test/ctxpack-usage.test.ts test/ctxpack-search.test.ts test/ctxpack-recall.test.ts test/ctxpack-sql.test.ts test/ctxpack-events.test.ts test/ctxpack-observability.test.ts
bun typecheck
```

From `packages/app`:

```powershell
bun test --conditions=solid --isolate --only-failures --preload ./happydom.ts ./src/context/ctxpack/attachment-store.test.tsx ./src/context/ctxpack/attachment-preview.test.tsx ./src/context/ctxpack/drop-target.test.tsx ./src/components/prompt-input-ctxpack-target.test.tsx ./src/components/prompt-input-v2.test.tsx ./src/components/prompt-input/submit.test.ts ./src/utils/server.test.ts ./src/utils/server-compat.test.ts ./src/pages/canvas/blocks/ctxpack-browser/adapter.test.ts ./src/pages/canvas/blocks/ctxpack-browser/ctxpack-browser.test.tsx ./src/pages/canvas/ctxpack-runtime-observability.test.ts ./src/context/ctxpack/draft.test.tsx ./src/context/ctxpack/selection-overlay.test.tsx ./src/context/ctxpack/create-dialog.test.tsx
bun test --conditions=browser --isolate --preload ./happydom.ts ./src/pages/session-surface-base.browser.test.tsx
bun test --conditions=browser --isolate --only-failures --preload ./happydom.ts src/pages/canvas/runtime/block-runtime-host.browser.test.tsx
bun test --conditions=solid --isolate --only-failures --preload ./happydom.ts src/pages/canvas/runtime/registrations/static-blocks.test.ts src/pages/canvas/runtime/registrations/operating-chat.test.ts
bun test --conditions=solid --isolate --only-failures --preload ./happydom.ts src/pages/canvas/blocks/chat-relay/runtime.test.ts
bun typecheck
bun run typecheck:e2e
```

## Browser acceptance boundary

`packages/app/e2e/ctxpack.spec.ts` uses the actual canvas, selection overlay, create dialog, browser block, composer and generated API clients with deterministic per-test network fixtures. It is not a browser-to-database or hosted authorization test. Workspace/session identities belong to the fixture, and pack identities come from the actual create response; tests never derive a pack ID from a URL or manufacture a drag payload.

The successful journey selects a rendered Markdown paragraph with native mouse clicks, checks dialog defaults, saves a named pack, adds Context Packs from the palette, opens the returned card in canvas editing mode, checks fragment text/order, dispatches `dragstart` to the real handler, and sends the resulting DataTransfer through scripted `dragover`/`drop` events to the composer. It then removes the browser block, previews the retained chip through an authenticated detail request, and sends one authenticated prompt. The rejection journey waits for an actual failed prompt response, checks restored text/chip, explicitly retries, and checks successful clearing.

The prompt boundary is `POST /api/session/{sessionID}/prompt` with nested `prompt` text and `contextAttachments` containing capsule references. Tests assert one request for one successful submission, absence of legacy `/message` or `/prompt_async` requests, and no fragment text in the attachment payload. Browser fixtures assert authentication transport; Core tests establish authorization behavior.

From `packages/app`, with port 4461 unused:

```powershell
$env:PLAYWRIGHT_PORT = "4461"
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:4461"
$env:PLAYWRIGHT_SERVER_PORT = "4461"
$env:PLAYWRIGHT_WORKERS = "1"
bun run test:e2e e2e/ctxpack.spec.ts --reporter=line
```

Drag transport and drop handlers are covered; continuous mouse-drag geometry is outside these scenarios. No hosted flag or environment-dependent skip remains. The E2E typecheck explicitly includes this spec and its fixture helper.

## Production navigation diagnostic

The existing first-navigation benchmark was run before and after the Session surface/composer changes in the original working tree, including unrelated uncommitted work. These measurements are historical diagnostics, not measurements of the isolated commit candidate. It builds and serves the production app, runs serially and asserts zero blank/unknown samples. It measures renderer observations, not compositor frames.

| Metric                      |   Before |    After |
| --------------------------- | -------: | -------: |
| First destination observed  |  50.9 ms |  46.1 ms |
| Stable destination observed | 112.1 ms | 101.9 ms |
| Blank / unknown samples     |    0 / 0 |    0 / 0 |
| Total samples               |        5 |        5 |

Before run ID: `2026-09-08T07-58-28-949Z-19452`; result: 1 passed. After run ID: `2026-09-08T08-37-48-039Z-12776`; result: 1 passed. These are single-run diagnostics and do not establish a statistically meaningful speed change.

From `packages/app`, with port 4460 unused:

```powershell
$env:PLAYWRIGHT_PORT = "4460"
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:4460"
$env:PLAYWRIGHT_WORKERS = "1"
bun run test:e2e --config e2e/performance/playwright.config.ts first-navigation-benchmark.spec.ts --reporter=line
```

Both browser configurations own their isolated test server. Existing application/server processes were not restarted.

## Limits retained from version one

- Rich domain-specific selection source descriptors remain deferred; generic block-text selection is exercised here.
- The browser's `canCreate`/`canPatch`/`canDelete`/`canMaterialize` flags remain permissive UI hints. Server capability checks are authoritative.
- Removed target registry invalidation is an existing materialization deferral, separate from clearing local drafts when their surface/workspace changes.
- CtxPack change events are transient refresh hints; reconnect performs an authoritative reload. This report does not establish clustered execution or crash-recovery semantics.
- The browser scenarios cover a one-fragment pack and admission transport. They do not claim real provider execution, host provisioning, a production database browser journey, or a full repository test run.
