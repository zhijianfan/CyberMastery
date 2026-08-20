You are worker 5 of 5 (Wave 2) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task L — Diagnostics and feature flag

### Required work

1. **Diagnostics**: update `packages/app/src/pages/canvas/diagnostics.ts` to
   report the NEW runtime state instead of the old: per-block
   { blockID, functionalityID, registrationMode: "native" | "local" | "none",
   hostStatus, localViewKeys }, plus workspace { id, epoch, connected, dirty }.
   Exported shape: `collectCanvasDiagnostics(services?)` returning a plain
   JSON-able object; keep a no-args fallback that reads the canvas globals
   (the `__CANVAS_INTEGRATION_STATE__` pattern) when services are unavailable.
2. **Feature flag**: find the flag module that holds canvas feature flags
   (`packages/app/src/pages/canvas/flag.ts` — if missing, create it) and add
   `BLOCK_RUNTIME_V3: false` with a comment: flipped by M at integration once
   all Wave-2 registrations are wired. The flag gates NOTHING yet (dead by
   default) — only the constant + its doc comment.
3. **HANDOFF-L.md**: exports, tests + results, integration actions.

### Tests

- `diagnostics.test.ts` (new, beside the file): with a fake services object,
  collectCanvasDiagnostics reports per-block registrationMode + workspace
  fields; no-args fallback returns a JSON-able object without throwing.

### Owned files (edit ONLY these)

- packages/app/src/pages/canvas/diagnostics.ts
- packages/app/src/pages/canvas/diagnostics.test.ts (NEW)
- packages/app/src/pages/canvas/flag.ts (create only if missing)
- packages/app/src/pages/canvas/HANDOFF-L.md

### Targeted validation (allowed)

- cd packages/app && bun test src/pages/canvas/diagnostics.test.ts
- bun run typecheck from packages/app

### HARD PROHIBITIONS

Do NOT edit workspace.tsx, manager.ts, chat-relay, master-agent, runtime/*
(existing files), server/protocol/core, generated files. Do NOT run generate.
