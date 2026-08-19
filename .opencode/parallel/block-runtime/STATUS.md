# block-runtime — run status (final)

Date: 2026-08-19. Master: deepseek-v4-pro (Hermes). Workers: openai/gpt-5.3-codex-spark.
Tree left UNCOMMITTED (committing is the user's call).

## Worker outcomes

| Track | Worker | Outcome |
|---|---|---|
| P0 | master | ✅ extraction + baselines (P0.md) |
| A protocol | worker | ✅ then master-reconciled to pinned contracts |
| B backend gateway | workers ×3 ❌ | ✅ implemented by master (workers died: DB lock, stall, analysis-only) |
| C opencode chat adapter | workers ×3 ❌ | ✅ file by worker (skeleton prompt) + master wiring (native-runtime-services.ts) |
| D frontend store/controller | worker (retry) | ✅ (+ minor out-of-ownership type fixes, audited) |
| E chatrelay UI | worker | ✅ complete (flag default corrected to legacy by master) |
| F canvas ownership | worker | ✅ (edited G's e2e file once — audited) |
| G tests | worker (retry) | ✅ fixtures + 3 new e2e scenarios |
| H flag/diagnostics | worker | ✅ (flag.ts one-liner + diagnostics.ts + spec) |

## Verification (master)

- `bun run typecheck` root: **31/31 packages** ✅
- protocol block-runtime.test.ts: 25 pass ✅
- server gateway + opencode-chat tests: 13 pass ✅
- app store/controller/chat-relay runtime tests: 14 pass ✅
- app chat-relay view tests (browser mode, `--preload ./happydom.ts`): 10 pass ✅
  (the earlier "Solid transform error" was a missing happydom preload, not an env issue)
- e2e master-agent: 6 pass / 10 fail — 9 are the pre-existing real-renderer
  harness failures (baseline log), 1 new regression test also fails only inside
  that broken harness; the 3 NEW block-runtime e2e scenarios pass.
- lint: only pre-existing warnings/error (no new errors).
- Total green tests: 62.

## Integration (master-owned wiring)

- BlockRuntimeGroup registered in protocol api.ts with locationMiddleware.
- BlockRuntimeHandler registered in server handlers.ts (global services captured
  at group-build; permission via location scope).
- SDK regenerated (client) + hand-mirrored sdk.gen.ts/types.gen.ts
  (`v2.blockRuntime.snapshot` / `subscribe`).
- App transport `canvas/runtime/server-transport.ts` (snapshot + SSE subscribe)
  + `bootstrap.ts` (registry + global-context injection).
- workspace.tsx onMount: opt-in via `VITE_CYBERMASTER_BLOCK_RUNTIME_V2=true`;
  default = legacy path (plan §H fallback).
- Feature flag `CYBERMASTER_BLOCK_RUNTIME_V2` in core Flag (H).

## Post-run fix (2026-08-19, user-reported)

- User's dev server (`bun run --watch ... serve --port 4096`) crashed at boot:
  `Service not found: opencode/v2/Credential` — BlockRuntimeHandler is the first
  httpapi consumer of Credential.Service; the opencode app group in
  `packages/opencode/src/server/routes/instance/httpapi/server.ts` lacked
  `Credential.node` (the cli serve path provides it). Fixed by adding
  `Credential.node` to the app group. Verified by real boot on port 4099
  ("opencode server listening") + packages/opencode typecheck 0 errors.
  The user's `--watch` task auto-restarts on the file change.

## Known follow-ups (documented, not done)

- sendCommand (auth.start / session.create / prompt / abort / permission.respond)
  routes through Track C OpencodeChat adapter server-side — the frontend context
  currently throws for commands; the legacy path remains the send path.
- session.create model/agent forwarding (needs brand-safe refs + provider ctx).
- E2E "real renderer" harness repair (9 baseline failures) — Track G deferred.
- Embedded UI rebuild (`bun run --cwd packages/opencode script/embed-web-ui.ts`)
  + bundle-hash check vs baseline `index-mjRXeggk.js` — run when the user wants
  the new UI served by the dev backend.
- Old-format ChatRelay records migrate lazily on next save (F) — runtime
  verification pending real browser pass.
