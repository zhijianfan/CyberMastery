# Handoff D — Generic BlockRuntimeHost + canvas state separation

Executor: integration master (two worker attempts drifted; master implemented).

## Files changed

- `packages/app/src/pages/canvas/runtime/local-view-store.ts` (NEW) — per-block
  device-local view state, key `opencode.canvas.local-view.v1`, generic
  read/write/delete/clearAll, debounced persistence, no sessionID ever written.
- `packages/app/src/pages/canvas/runtime/block-runtime-host.tsx` (NEW) —
  pass-through host; resolves `BlockRuntimeRegistration` when supplied (Wave 2
  adapters); provides `RuntimeBlockHandle` via
  `BlockRuntimeHandleContext`; identity key = workspaceEpoch + workspaceID +
  blockID + functionalityID (C8); aborts + disposes on unmount.
- `packages/app/src/pages/canvas/runtime/provider.tsx` (NEW) — canvas-root
  provider owning one event router + registry + local-view store; exposes
  `BlockRuntimeServices` via context. v1 seams: `serverSDK` passthrough absent
  and router listen is a no-op — M wires `serverSDK().event.listen` at
  integration (Wave 3).
- `packages/app/src/pages/canvas/workspace.tsx` —
  - `CanvasBlock` is now descriptor-only: removed `text`, `listening`,
    `messages`, `agentKey`, `layers`, `history`, `bindings` (C1).
  - `toPersistedBlock`/`persistedToBlock` serialize descriptor + collapsed only.
  - `applyServerLayout` replaces descriptor transforms + collapsed only;
    `mergeServerRuntime` and `applyPersistedChatRelayBinding` deleted.
  - Notes/Voice/OperatingChat bodies read/write the local-view store.
  - Removed the ChatRelay runtime bootstrap (`enableChatRelayBlockRuntime`,
    `VITE_CYBERMASTER_BLOCK_RUNTIME_V2`) and the canvas-level `useServerSDK`.
  - Every block body renders inside `<BlockRuntimeHost ...>` (registration
    undefined in v1).
  - Canvas root wrapped in `<BlockRuntimeProvider ...>` with
    `awaitDescriptorPersisted` v1 polling seam (250ms tick, 15s cap, AbortSignal).

## Deleted legacy surface (needs M/Task-O follow-up)

- `applyPersistedChatRelayBinding`, `mergeServerRuntime`,
  `onChatRelayBinding` wiring, E's `clearWorkspaceScopedBindings`/epoch effect.

## Tests

- Type-level verification via app typecheck (0 errors in owned files).
- Runtime unit tests for the new modules deferred to Wave 2 adapters (H/I)
  which exercise the host end-to-end; the host's registration path is
  exercised by G's track examples when a registration is available.
- LOCAL-VIEW/STORAGE assertions: grep `sessionID` over
  `toPersistedBlock`/`persist()` — none serialized.

## Integration actions for M

1. Wire `serverSDK().event.listen` into `BlockRuntimeProvider` (router).
2. Replace `awaitDescriptorPersisted` polling seam with manager push hook.
3. Register Wave-2 renderer modules in the host (replace undefined registration).
4. Regenerate SDK after E's protocol changes (`bun run generate`).
5. Rebuild embedded UI after frontend integration.

## Prohibited-pattern grep

Clean over owned files (no `/api/block-runtime/event` session use, no
`CHAT_RELAY_DEFAULT_SESSION_ID`, no `block.bindings` persistence).
