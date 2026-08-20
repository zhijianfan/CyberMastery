# Task O — Legacy v2 removal, dead adapters, default-on rollout (block-runtime-v3)

**Wave:** 3 final · **Serial** · **Depends on:** N acceptance (HANDOFF-N.md +
TEST-REPORT.md exist and pass).

**Owned files:** dead v2 files, manager cleanup, flag, docs — see candidate
removals. Run `rg` reference search before every deletion.

## Candidate removals (verify zero references first)

- `packages/server/src/handlers/block-runtime.ts`
- `packages/server/src/runtime/resource-snapshot.ts`
- `packages/server/src/runtime/block-runtime-gateway.ts`
- `packages/server/src/runtime/adapters/opencode-chat.ts`
- `packages/server/src/runtime/adapters/native-runtime-services.ts`
- `packages/app/src/pages/canvas/runtime/server-transport.ts`
- `packages/app/src/pages/canvas/runtime/bootstrap.ts`
- old cursor/resource store + controller code replaced by the v3 host
- ChatRelay mock/global/runtime custom renderer (`createMockChatRelayContext`
  production exports, `__CHAT_RELAY_RUNTIME_*`)
- `PersistedCanvasBlock.bindings` field (workspace.tsx) — layout carries no
  bindings (C1)
- canvas-local ChatRelay binding persistence/sync leftovers
- manager per-block MasterAgent lifecycle APIs made unused by the runtime host
- mismatched v2 flags/docs (`VITE_CYBERMASTER_BLOCK_RUNTIME_V2`,
  `__CYBERMASTER_BLOCK_RUNTIME_V2__`, old block-runtime protocol group unless a
  future projected source uses it)

## Required work

1. Reference search before each deletion (`rg -n "<symbol>" packages apps specs`
   — note `rg` available; adapt paths).
2. Split the `ChatRelayCommandClient` blanket cast into per-method narrow
   types (auth.start has no SDK equivalent — keep only that narrow cast).
3. Keep `BLOCK_RUNTIME_V3` default ON if the integration workstream hasn't
   already; otherwise ensure one rollout flag remains.
4. Update architecture docs + implementation status honestly.
5. Re-run SDK regen ONLY if protocol groups were deleted
   (`cd packages/client && bun run generate`; `packages/sdk/js script/build.ts`).
6. Full verification: root typecheck, app browser test batch, prohibited-pattern
   sweep (below).

## Acceptance

`rg -n '__CHAT_RELAY_RUNTIME_CONTEXT__|__CHAT_RELAY_RUNTIME_V2__|CHAT_RELAY_DEFAULT_SESSION_ID|createMockChatRelayContext|/api/block-runtime/event|backend-api/conversation' packages specs`
returns no matches (test-only mocks excluded). One generic block host, one
native app event stream, no hidden fallback chat implementation.

## Handoff

`HANDOFF-O.md`: deletions with pre-deletion reference evidence, flag state,
docs updated, verification results, prohibited-pattern grep output.
