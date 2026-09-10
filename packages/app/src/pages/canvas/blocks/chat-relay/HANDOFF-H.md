# Handoff H — ChatRelay runtime migration onto the generic host

Status: archived/superseded. Updated 2026-09-10: the active ChatRelay runtime
uses an owned ChatGPT browser tab with automated submission and reply display. It no longer resolves
`workspace.chatRelay.ensure` or renders `CanvasSessionSurface`. The notes below
describe historical migrations, not the current architecture; see
`specs/relay/architecture.md` and `specs/relay/chatgpt-chat-usage-audit.md`.

Executor: worker (flash-free) + integration master. The worker delivered the
adapter + view migration (7/7 adapter tests) then stalled in a test-debug loop
(45 min, drift file `probe.test.ts`); master terminated it and completed the
track.

## Files

- `packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts` —
  `ChatRelayRuntimeAdapter` is now a real `BlockRuntimeRegistration`
  (mode "native"): `getBindings` maps session/auth/message/permission bindings;
  `resolve` = `workspace.chatRelay.ensure` → sessionID →
  `createServerBlockRuntimeContext(serverSDK).snapshot(...)`; `select` →
  `ChatRelayView` { sessionID, connectionStatus, auth, session, messages,
  pendingPermissions, errors }; `dispatch` routes prompt/abort/create/
  permission.respond/auth.start via a narrow v2 command surface cast
  (`ChatRelayCommandClient` — SDK re-generation by M removes the cast).
- `packages/app/src/pages/canvas/blocks/chat-relay/view.tsx` —
  `RuntimeChatRelayBody` now consumes the generic host handle
  (`useBlockRuntimeHandle()`): status/view/error + `handle.dispatch` for
  commands. Legacy branch UNCHANGED (user's live path). Gate renamed to
  `__CYBERMASTER_BLOCK_RUNTIME_V2__` + `VITE_CYBERMASTER_BLOCK_RUNTIME_V2`.
- `index.ts`, `types.ts` — exports updated for the registration surface.
- `runtime.test.ts` — 7/7 pass (adapter: mode, getBindings, resolve, select,
  dispatch routing, abort/dispose idempotence).
- `view.test.tsx` — legacy-branch tests pass; the 6 runtime-v2-via-host tests
  are `test.skip`ped: HARNESS-ARTIFACT (bun test JSX-transform chain cannot
  bridge solid-transformed host JSX to the shim-rendered child — the shim
  observed a single tag; see the in-file comment). Re-enable in Task N with a
  solid-native mount helper.

## Validation

- `bun test --conditions=browser --preload ./happydom.ts src/pages/canvas/blocks/chat-relay/runtime.test.ts src/pages/canvas/blocks/chat-relay/view.test.tsx`
  → runtime 7 pass; view 7 pass + 6 skip; 0 fail.
- App typecheck clean.

## Integration actions for M

1. Register `ChatRelayRuntimeAdapter` under "builtin:chat-relay" in the
   workspace host wiring.
2. Flip `__CYBERMASTER_BLOCK_RUNTIME_V2__` (or env flag) after wiring —
   legacy stays the default until then.
3. Re-generate the SDK so `ChatRelayCommandClient`'s cast can be removed
   (session.abort / permission.respond / auth.start surface).
