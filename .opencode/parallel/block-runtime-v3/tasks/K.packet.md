You are worker 4 of 5 (Wave 2) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task K — Static/local block registrations (notes, voice, context, tools, files)

### Required work

Create `packages/app/src/pages/canvas/runtime/registrations/static-blocks.ts`:
- Descriptor types: NotesBlockDescriptor { id, functionalityID: "builtin:notes" },
  VoiceBlockDescriptor { id, functionalityID: "builtin:voice" }.
- `notesRuntimeRegistration`: mode "local"; resolve reads
  `services.localView.read(block.id)`; select → { text } (default ""); dispatch
  { type: "set-text", text } → localView.write.
- `voiceRuntimeRegistration`: mode "local"; resolve reads local view; select →
  { listening } (default false); dispatch { type: "toggle" } → flip.
- `builtinStaticRegistrations: Record<string, BlockRuntimeRegistration<...>>`
  exporting the notes + voice registrations under
  `"builtin:notes"` / `"builtin:voice"` keys.

Context/tools/files bodies remain pure presentational (no state) — they get NO
registration; the host renders them as plain children (no registration needed).
Note this in the handoff.

### Tests

- `static-blocks.test.ts`: notes set-text round-trips through the local-view
  store; voice toggle flips; unknown functionality has no registration.

### Owned files (edit ONLY these)

- packages/app/src/pages/canvas/runtime/registrations/static-blocks.ts (NEW)
- packages/app/src/pages/canvas/runtime/registrations/static-blocks.test.ts (NEW)
- packages/app/src/pages/canvas/runtime/registrations/HANDOFF-K.md

### Targeted validation (allowed)

- cd packages/app && bun test src/pages/canvas/runtime/registrations/static-blocks.test.ts
- bun run typecheck from packages/app

### HARD PROHIBITIONS

Do NOT edit workspace.tsx, manager.ts, chat-relay, master-agent, server/
protocol/core, generated files. Do NOT run generate.
