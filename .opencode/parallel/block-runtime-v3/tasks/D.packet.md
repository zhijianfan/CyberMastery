You are worker 4 of 7 (Wave 1) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task D — Generic BlockRuntimeHost and canvas state separation

Goal: every canvas block renders through ONE generic host; layout application
can never overwrite runtime or local view state; the descriptor cache carries
identity/functionality/transform ONLY.

## Target state

```ts
interface CanvasBlockDescriptor {
  id: string
  functionalityID: string
  transform: { x: number; y: number; w: number; h: number; z: number }
}
interface CanvasViewState {
  collapsed?: boolean
  defaultRect?: boolean
  selectedTab?: string
  // no domain data or host binding
}
```

A separate `BlockLocalViewStore` holds functionality-specific device-local data,
keyed by workspace-local key + block ID, persisted under
`opencode.canvas.local-view.v1` (NOT the layout cache).

## Required work

1. `packages/app/src/pages/canvas/runtime/local-view-store.ts` (NEW):
   `createBlockLocalViewStore()` — per-block read/write/delete, persisted to
   localStorage key `opencode.canvas.local-view.v1`, debounced writes, JSON.
2. `packages/app/src/pages/canvas/runtime/block-runtime-host.tsx` (NEW):
   `<BlockRuntimeHost block={descriptor} registration={...} children/services ...>`
   — resolves the registration's `resolve()`, drives handle lifecycle
   (status/view/error/refresh/dispatch/dispose), keys by
   `workspaceEpoch + workspaceID + blockID + functionalityID`; on block removal
   dispose the runtime handle ONLY (never cancel host work); wraps its children
   with the handle context (Solid createSimpleContext from
   `@opencode-ai/ui/context`, pattern shown in inlined `server-sdk.tsx`).
3. `packages/app/src/pages/canvas/runtime/provider.tsx` (NEW):
   `<BlockRuntimeProvider>` — owns ONE event router (C's createBlockRuntimeEventRouter)
   + the registry (C's) + the local view store + workspace services (id/epoch/
   connected/awaitDescriptorPersisted wired from manager + canvas), provided via
   context; lifetime follows canvas mount; dispose cleans router/registry.
4. Rewrite `packages/app/src/pages/canvas/workspace.tsx` (you own the whole
   file; its FULL current content is inlined below):
   - Split `CanvasBlock` into `CanvasBlockDescriptor` + view-state maps; remove
     `bindings`, `messages`, `history`, `layers`, `text`, `listening`,
     `agentKey` from the descriptor record. Compatibility accessors may
     temporarily read Wave-2 stores (read the local-view store), but layout
     functions may not see them.
   - `toRecords()` continues to send functionality + transform only (unchanged).
   - `toPersistedBlock()` persists descriptor + allowed view state ONLY — no
     `bindings`; the serialized JSON must contain no `sessionID` substring
     (assert in tests).
   - `applyServerLayout()` replaces descriptor transforms only; REMOVE
     `mergeServerRuntime()` and any runtime-state merge.
   - `load()` migrates legacy persisted blocks: descriptor fields → descriptor
     cache; `text`/`listening`/`layers`/`history` → local-view store (one-time
     migration); `bindings` dropped.
   - Replace the block render switch: every block (including legacy operating-chat)
     renders through `<BlockRuntimeHost>` with a per-functionality renderer module
     map. Keep a COMPATIBILITY map so Wave-2 modules (H–K) can land independently:
     for chat-relay/master-agent keep rendering the existing `ChatRelayBody`/
     `MasterAgentBlock` components inside the host wrapper for now; for
     operating-chat/context/tools/files/notes/voice keep the existing in-file
     body components in the map, marked as compatibility entries that H–K will
     replace. The compatibility map must live in a NEW file
     `packages/app/src/pages/canvas/runtime/compat-renderers.tsx` exporting
     `compatRendererFor(functionalityID)`.
   - REMOVE the ChatRelay-specific global bootstrap call
     (`enableChatRelayBlockRuntime` import + `VITE_CYBERMASTER_BLOCK_RUNTIME_V2`
     gate + the onMount block referencing them) from the canvas.
   - `BlockRuntimeHost` key includes the workspace epoch (manager.workspaceEpoch()).
   - On block removal, dispose the runtime handle only.
   - Keep `CanvasSessionSurfaceProviders` usage for the chat-relay/master-agent
     compatibility bodies exactly as it is today.
   - `awaitDescriptorPersisted(blockID, signal)`: expose from the canvas/managers
     boundary — resolves after the current layout revision on the server includes
     the block (manager has `revision()` + `dirty()`; implement as: if the block
     is in the server-adopted layout records already, resolve; else wait for the
     next successful sync/push via a one-shot promise the canvas resolves on
     layout save success; AbortSignal-aware; never resolve from localStorage
     alone).
5. Do NOT edit `manager.ts` (E owns it). Read the workspace hooks the manager
   exposes from the inlined excerpt and wire via props/context only. If a
   needed manager field is missing, implement `awaitDescriptorPersisted` in the
   canvas using existing manager fields and document the seam in HANDOFF-D.

## Acceptance criteria

- Replacing a server layout while a native session is streaming does NOT remount
  or reset its session store unless block identity/functionality changes.
- Layout/local cache contains no binding or session ID (localStorage assertions).
- All block types render through `BlockRuntimeHost`, including local/static.
- A block can move/resize without any runtime refresh.
- A block functionality replacement disposes the old adapter and resolves the new one.
- HMR/unmount cleans provider/router subscriptions.

## Owned files (edit ONLY these)

- `packages/app/src/pages/canvas/workspace.tsx`
- `packages/app/src/pages/canvas/runtime/local-view-store.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/block-runtime-host.tsx` (NEW)
- `packages/app/src/pages/canvas/runtime/provider.tsx` (NEW)
- `packages/app/src/pages/canvas/runtime/compat-renderers.tsx` (NEW)
- tests for the above (new files beside them)
- `packages/app/src/pages/canvas/runtime/HANDOFF-D.md`

Do NOT edit `manager.ts`, ChatRelay dir, MasterAgent dir, runtime core files
owned by A/C, or backend.

## Targeted validation (allowed)

- `cd packages/app && bun test --conditions=browser --preload ./happydom.ts <your new test files>`
- `bun run typecheck` from `packages/app`

## Handoff

`HANDOFF-D.md`: exact props contract H–K must export for their registered
renderer modules · the compat-renderers map API · where awaitDescriptorPersisted
lives and its contract · manager fields you consumed · tests + results ·
integration actions M must take · prohibited-pattern grep result.
