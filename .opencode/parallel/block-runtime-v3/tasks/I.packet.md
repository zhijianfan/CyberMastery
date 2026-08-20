You are worker 2 of 5 (Wave 2) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task I — MasterAgent runtime migration onto the generic host

### Required work

1. **Fix the double surface mount** (Wave-1 finding): `block.tsx` currently
   mounts the `CanvasSessionSurface` such that the surface base disposes TWICE
   across a block lifetime (baseDisposals===2 in the e2e). Root-cause it in
   block.tsx/block-shell.tsx (the surface must mount EXACTLY once per binding
   generation and dispose exactly once on unmount).
2. **Registration**: create
   `packages/app/src/pages/canvas/master-agent/runtime-registration.ts`
   exporting `masterAgentRuntimeRegistration:
   BlockRuntimeRegistration<MasterAgentBlockDescriptor, MasterAgentView, MasterAgentCommand>`:
   - `mode: "native"`,
   - `getBindings(descriptor)` → [{ type: "session", id: descriptor.bindings.sessionID }]
     (+ permission bindings for the session as today's lifecycle does),
   - `resolve(...)` → snapshot the session via `services.serverSDK`
     (v2.session.get + v2.event subscribe for that session) with the same
     revision/cursor discipline the current lifecycle-controller uses (inline
     below); returns `{ snapshot, dispose }`,
   - `select(...)` → `MasterAgentView` = the binding state (status, sessionID,
     coder, queue) the shell consumes,
   - `dispatch(...)` → reset → v2.workspace.masterAgent.reset; coder set/clear
     → v2.workspace.update; ensure/retry → v2.workspace.masterAgent.ensure.
3. **Shell**: `block.tsx` renders `MasterAgentBlock` through the registration
   when the workspace provides it (via `BlockRuntimeHost` services), keeping
   the existing manager-backed path as the fallback until M wires the
   registration in workspace.tsx (M owns that wiring — you only EXPORT the
   registration + keep both paths type-clean).
4. **HANDOFF-I.md**: exports, tests + results, integration actions.

### Tests

- `master-agent/runtime-registration.test.ts`: bindings mapping, dispatch
  routes (reset/ensure/coder), select projection, abort/dispose idempotent.
- Update `master-agent/block.test.tsx` if needed for the double-mount fix —
  assert exactly one surface base per binding generation and one dispose on
  unmount (use the existing fake manager + recorded bases pattern).

### Owned files (edit ONLY these)

- packages/app/src/pages/canvas/master-agent/block.tsx
- packages/app/src/pages/canvas/master-agent/block-shell.tsx
- packages/app/src/pages/canvas/master-agent/runtime-registration.ts (NEW)
- packages/app/src/pages/canvas/master-agent/runtime-registration.test.ts (NEW)
- packages/app/src/pages/canvas/master-agent/block.test.tsx
- packages/app/src/pages/canvas/master-agent/HANDOFF-I.md

### Targeted validation (allowed)

- cd packages/app && bun test --conditions=browser --preload ./happydom.ts src/pages/canvas/master-agent/runtime-registration.test.ts src/pages/canvas/master-agent/block.test.tsx
- bun run typecheck from packages/app

### HARD PROHIBITIONS

Do NOT edit workspace.tsx, manager.ts, blocks/chat-relay/**, e2e/integration
test files (they are skipped pending your fix — re-enabling them is M's job),
packages/server/protocol/core, generated SDK files. Do NOT run generate.
