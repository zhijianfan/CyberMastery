You are worker 1 of 5 (Wave 2) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task H — ChatRelay runtime migration onto the generic host

The generic host boundary exists (Wave 1: `BlockRuntimeHost`,
`BlockRuntimeProvider`, `createHostSessionBindingRegistration`, local-view
store). Your job: make the ChatRelay block a REAL runtime registration and
migrate the legacy path OFF the old surface.

### Required work

1. **Adapter**: in `packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts`,
   keep `ChatRelayRuntimeAdapter` but re-implement it as a
   `BlockRuntimeRegistration<ChatRelayBlockDescriptor, ChatRelayView, ChatRelayCommand>`:
   - `mode: "native"`,
   - `getBindings(descriptor)` → session/auth/message/permission bindings from
     `descriptor.bindings.sessionID` (as today),
   - `resolve(...)` → snapshot through `services.serverSDK` (the
     `BlockRuntimeServices.serverSDK` accessor, wired by M at integration)
     using the CURRENT `createServerBlockRuntimeContext` snapshot path for
     ChatRelay (see inlined server-transport.ts / runtime.ts), returns
     `{ snapshot, dispose }`,
   - `select({ resolved, projection, localView })` → `ChatRelayView`
     (sessionID, status from auth/session resources, message list),
   - `dispatch({ resolved, command, services, signal })` → session.prompt /
     session.abort / permission.respond / auth.start via the SDK session
     endpoints (v2.session.prompt etc.) — typed against the SDK surface in
     `@opencode-ai/sdk/v2/client`; if a required SDK method is absent from the
     pinned SDK type, declare a narrow local command method adapter type and
     cast (M re-generates the SDK after this run),
   - per-adapter command type narrowing (C5): the registration's command type
     IS `ChatRelayCommand`.
2. **View**: `view.tsx` keeps BOTH branches (legacy + runtime, flag-gated as
   today) but the RUNTIME branch must now render through the generic host
   contract (`BlockRuntimeHost` + registration) instead of the old
   `RuntimeChatRelayBody`'s own snapshot/subscribe loop. The legacy branch
   stays UNCHANGED (it is the user's live path).
3. **Migration shims (C6)**: the legacy branch's `bindings` usage moves to
   `descriptor.bindings` (block prop already carries `{ id, bindings? }`).
   No CanvasBlock field changes — workspace.tsx already dropped them.
4. **HANDOFF-H.md**: files changed, exports, how M registers the adapter
   (registry name `"builtin:chat-relay"`), tests + results, integration
   actions.

### Tests (new files beside the sources)

- runtime.test.ts (update the existing one): adapter mode is "native";
  dispatch routes prompt/abort/permission/auth commands to the fake SDK;
  select projects the view from the snapshot state; getBindings maps sessionID.
- view.test.tsx (update the existing browser-mode test): runtime branch mounts
  inside BlockRuntimeHost and shows messages from the seeded snapshot.

### Owned files (edit ONLY these)

- packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts
- packages/app/src/pages/canvas/blocks/chat-relay/view.tsx
- packages/app/src/pages/canvas/blocks/chat-relay/types.ts
- packages/app/src/pages/canvas/blocks/chat-relay/index.ts
- packages/app/src/pages/canvas/blocks/chat-relay/runtime.test.ts
- packages/app/src/pages/canvas/blocks/chat-relay/view.test.tsx
- packages/app/src/pages/canvas/blocks/chat-relay/HANDOFF-H.md

### Targeted validation (allowed)

- cd packages/app && bun test --conditions=browser --preload ./happydom.ts src/pages/canvas/blocks/chat-relay/runtime.test.ts src/pages/canvas/blocks/chat-relay/view.test.tsx
- bun run typecheck from packages/app (report errors in files you do not own as "pre-existing/in-flight"; do not fix them)

### HARD PROHIBITIONS

Do NOT edit workspace.tsx, manager.ts, master-agent/**, runtime/* (except
nothing outside your owned list), packages/server, packages/protocol,
packages/core, generated SDK files. Do NOT run `bun run generate`.
