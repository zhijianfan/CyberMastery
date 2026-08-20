You are worker 3 of 5 (Wave 2) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task J — OperatingChat runtime registration

### Required work

Create `packages/app/src/pages/canvas/runtime/registrations/operating-chat.ts`:
- `OperatingChatBlockDescriptor` = { id, functionalityID: "builtin:operating-chat" }.
- `operatingChatRuntimeRegistration: BlockRuntimeRegistration<...>`:
  - `mode: "local"`,
  - `resolve(...)` → reads the block's LOCAL VIEW state via
    `services.localView.read(block.id)`; returns `{ state, dispose }`,
  - `select({ resolved, localView })` → `OperatingChatView` =
    { history: OperatingExchange[], layers: OperatingLayer[] } projected from
    local view with defaults (`defaultOperatingLayers()`, empty history),
  - `dispatch({ command, services })` → commands:
    { type: "append-exchange", role, text } → append to history + update
    operational layer tail (the existing `appendExchange`/`tail` behavior);
    { type: "set-custom-layer", text } → update the custom layer text;
    writes back via `services.localView.write(block.id, ...)`.
- Export the view + command types.

The inlined workspace.tsx OperatingChatBody shows the exact domain logic to
preserve (appendExchange, tail, defaultOperatingLayers from
`./editor/operating-context`).

### Tests

- `operating-chat.test.ts` (beside the registration): resolve reads defaults;
  dispatch append-exchange appends + updates operational tail; set-custom-layer
  writes; dispose is idempotent. Local-view store injected as a fresh in-memory
  store.

### Owned files (edit ONLY these)

- packages/app/src/pages/canvas/runtime/registrations/operating-chat.ts (NEW)
- packages/app/src/pages/canvas/runtime/registrations/operating-chat.test.ts (NEW)
- packages/app/src/pages/canvas/runtime/registrations/HANDOFF-J.md

### Targeted validation (allowed)

- cd packages/app && bun test src/pages/canvas/runtime/registrations/operating-chat.test.ts
- bun run typecheck from packages/app

### HARD PROHIBITIONS

Do NOT edit workspace.tsx (its OperatingChatBody stays as the fallback body —
M swaps the renderer to the registration at integration), manager.ts, chat-relay,
master-agent, server/protocol/core, generated files. Do NOT run generate.
