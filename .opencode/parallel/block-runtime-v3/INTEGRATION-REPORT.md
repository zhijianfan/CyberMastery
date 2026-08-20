# INTEGRATION-REPORT — block-runtime-v3 Task M (Wave 3, 2026-08-20)

Master-run integration over the Wave-1/2 tracks committed at `c5335762e`.
Tree left uncommitted per user's "continue" directive; commit decision pending.

## Merged order (plan §8 Task M)

A contracts → B backend events → C runtime core → E workspace recovery →
F binding adapter → D host/canvas split → G fixtures → H ChatRelay →
I MasterAgent → J OperatingChat → K local/static → L diagnostics/flag.
(All tracks were already committed in c5335762e; M wired + verified them.)

## M integration work (this run)

| # | Change | Files |
|---|---|---|
| 1 | Event router now delivers the contract's ServerEvent shape `{type, properties}` to listeners (was `{details:{…}}` — C's implementation diverged from the contracts interface) | `runtime/event-router.ts`, `event-router.test.ts` |
| 2 | `BlockRuntimeEventRouter.onReconnect` added to the frozen contracts (router always had it) | `runtime/contracts.ts` |
| 3 | Provider wired: real `serverSDK` accessor (test seam), single `serverSDK().event.listen` subscription (C3), reconnect notifications via `connected()` transitions | `runtime/provider.tsx` |
| 4 | Host reworked: resolves registration, subscribes `eventKeys` → `onEvent` (invalidate → coalesced refresh), `onReconnect` → refresh, re-resolves + disposes on workspace-epoch/workspace/functionality identity change (C5/C8/C9) | `runtime/block-runtime-host.tsx` |
| 5 | OperatingChat registration typed against canonical contracts; mirror types deleted. `tail` canonicalized to the live UI semantics (whitespace-compact, 140-char preview — J's last-line stand-in was wrong) | `runtime/registrations/operating-chat.ts` |
| 6 | OperatingChat body: fake `setTimeout` assistant reply REMOVED (Wave-2 gate item), honest local-draft copy, dispatch through the host handle when the registration is mounted, store-direct fallback otherwise | `workspace.tsx` |
| 7 | ChatRelay gate unified under `BLOCK_RUNTIME_V3` (flag.ts) with env/global overrides retained for tests | `blocks/chat-relay/view.tsx` |
| 8 | Diagnostics: live `CanvasDiagnosticsSource` (manager + registration table + local-view keys) attached at `__CANVAS_DIAGNOSTICS_SOURCE__` in dev | `workspace.tsx` |
| 9 | SDK regenerated for real: `packages/client bun run generate` → **zero diff** vs hand-mirror ✅; `packages/sdk/js script/build.ts` → **hand-mirror had drifted** (block-runtime group call shapes + missing `WorkspaceNotFoundError`); generator output is now authoritative and call sites were corrected | `packages/sdk/js/**` |
| 10 | `server-transport.ts` call sites updated to true generated shapes (`snapshot({blockRuntimeSnapshotRequest})`, subscribe query-params) | `runtime/server-transport.ts` |
| 11 | Root typecheck fix: `master-agent-context.ts` workspace get now catches `Workspace.NotFoundError` → `undefined` (latent error E's typed 404 introduced; previously masked by a stale turbo cache) | `packages/opencode/src/session/master-agent-context.ts` |
| 12 | Test fakes updated for generated SDK shapes + new router contract | chat-relay runtime/view tests, operating-chat test |

## NOT done in M (deliberately — per run handoffs / plan)

- `ChatRelayCommandClient` cast kept: regenerated SDK has `session.abort`/`permission.respond`
  but NO `auth.start({providerID})` — the blanket cast cannot be removed without protocol work.
  Hand to Task O for per-method narrow types.
- MasterAgent `block.tsx` does not yet consume the host handle; the manager path stays live
  (HANDOFF-I narrowed M's action to host wiring + sessionBusy/queue feed — the manager has no
  busy feed yet; defer to N/O).
- Notes/Voice bodies still read/write the local-view store directly; the registrations resolve
  from the same store (consistent, redundant until O removes the dual path).
- `awaitDescriptorPersisted` polling seam kept (manager exposes no push hook yet).
- `BLOCK_RUNTIME_V3` default remains **false** (legacy path live) until Task O's default-on.

## Verification (this run)

| Check | Result |
|---|---|
| packages/app typecheck, flag OFF | ✅ clean |
| packages/app typecheck, flag ON | ✅ clean (temporary flip, reverted) |
| Root typecheck (31 packages) | ✅ 31/31 |
| Runtime/browser test batch (10 files) | ✅ 37 pass / 13 skip (classified harness skips) / 0 fail |
| client SDK generate diff | ✅ none (hand-mirror matched) |
| sdk/js build | ✅ regenerated, app call sites fixed |

## Remaining (Wave 3)

- **N** — E2E/reconnect/race/perf hardening; re-enable 13 skipped tests
  (6 chat-relay view host-mount, 7 master-agent block transitions) with a solid-native mount helper.
- **O** — legacy v2 removal (server block-runtime handlers/adapters, `server-transport.ts`/`bootstrap.ts`,
  cursor stores, `PersistedCanvasBlock.bindings` field, manager per-block MasterAgent APIs, v2 flags),
  flag default-on, ChatRelayCommandClient cast split, prohibited-pattern sweep.

## Prohibited-pattern grep over M's diff

`/api/block-runtime/event` session use · `chatgpt.com/backend-api/conversation` ·
`__CHAT_RELAY_RUNTIME_*` · `CHAT_RELAY_DEFAULT_SESSION_ID` · `block.bindings` persistence —
**clean** (server-transport.ts still references `/api/block-runtime/event` as legacy transition code, O-owned).
