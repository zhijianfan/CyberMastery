# Handoff K — Static/local block registrations (notes, voice)

Executor: Worker 4, Wave 2 (block-runtime-v3).

## Files changed

- `packages/app/src/pages/canvas/runtime/registrations/static-blocks.ts` (NEW) —
  descriptor types, `notesRuntimeRegistration`, `voiceRuntimeRegistration`,
  `builtinStaticRegistrations`.
- `packages/app/src/pages/canvas/runtime/registrations/static-blocks.test.ts`
  (NEW) — unit tests.
- `packages/app/src/pages/canvas/runtime/registrations/HANDOFF-K.md` (NEW).

## What was implemented

- `NotesBlockDescriptor { id, functionalityID: "builtin:notes" }` and
  `VoiceBlockDescriptor { id, functionalityID: "builtin:voice" }` exported
  descriptor types (C1: descriptor-shaped, no view state in layout).
- `notesRuntimeRegistration`: mode `"local"` (C2). `resolve` reads
  `services.localView.read(block.id)` and returns
  `NotesBlockDescriptor & { text?: string }`. `select` → `{ text }` defaulting to
  `""`. `dispatch { type: "set-text"; text }` → `services.localView.write(id,
  { text })`.
- `voiceRuntimeRegistration`: mode `"local"`. `resolve` reads
  `services.localView.read(block.id)` and returns
  `VoiceBlockDescriptor & { listening?: boolean }`. `select` → `{ listening }`
  defaulting to `false`. `dispatch { type: "toggle" }` reads current listening
  flag from the store and flips it via `write`.
- `builtinStaticRegistrations: Record<string,
  BlockRuntimeRegistration<unknown, unknown, unknown>>` exporting the notes and
  voice registrations under the `"builtin:notes"` / `"builtin:voice"` keys.
  Unknown functionality IDs have no registration (tested).
- Local state goes through the frozen `opencode.canvas.local-view.v1` store only;
  nothing is written to the layout descriptor cache (C1). No event transport
  used (C3); no session ID, binding, or host-owned identity (C6/C8).
- Context / tools / files bodies remain pure presentational (no state) — they get
  NO registration; the host renders them as plain children (no registration
  needed). `builtinStaticRegistrations` deliberately omits
  `builtin:context`, `builtin:tools`, and `builtin:files`.

## Tests

- `bun test src/pages/canvas/runtime/registrations/static-blocks.test.ts`
  (from `packages/app`): 4 pass / 0 fail. Also ran with the repo's unit-test
  invocation (`bun test --conditions=solid --preload ./happydom.ts ...`): 4 pass.
- Coverage: notes set-text round-trips through the real
  `createBlockLocalViewStore`; text is block-scoped per block id; voice toggle
  flips `listening` true → false; unknown functionality has no registration.
- `bun run typecheck` (from `packages/app`): my owned files report 0 errors. The
  build currently reports 4 pre-existing errors in
  `registrations/operating-chat.test.ts` (Task I's owned file, not edited here).

## Public exports added

- `NotesBlockDescriptor`, `VoiceBlockDescriptor` (types)
- `NotesView`, `VoiceView` (types)
- `NotesCommand`, `VoiceCommand` (types)
- `notesRuntimeRegistration`, `voiceRuntimeRegistration`
- `builtinStaticRegistrations`

Removed: none.

## Assumptions

- `resolve` reads the local-view store so the host's v1 `select` call (which
  passes `localView: undefined`, see `block-runtime-host.tsx`) still projects the
  correct view; `select` therefore reads from `resolved`, not from the
  `localView` input.
- `dispatch` writes by `resolved.id`; commands carry no block ID, matching the
  packet's command shapes `{ type: "set-text"; text }` / `{ type: "toggle" }`.
- TResolved is the descriptor extended with the optional local field so dispatch
  and select always have both identity and state.

## Known limitations

- `builtinStaticRegistrations` is not yet wired into `runtime/index.ts` or the
  `BlockRuntimeHost` — registration lookup and rendering remain integration work
  for M (see below).
- No `eventKeys`/`onEvent`/`dispose` (local blocks have no external event source
  or resources to release; `dispose` is trivially unnecessary).

## Integration actions required by M

1. Import `builtinStaticRegistrations` from
   `registrations/static-blocks` and, if desired, re-export it from
   `runtime/index.ts` (not edited here — out of owned scope).
2. Use it to resolve a registration for `builtin:notes` / `builtin:voice`
   blocks in the `BlockRuntimeHost`, replacing the v1 undefined-registration
   pass-through for those blocks.
3. Keep context/tools/files renderers as plain children with no registration.

## Prohibited-pattern search

Grep of my diff for `/api/block-runtime/event`, `backend-api`, `__CHAT_RELAY`,
`CHAT_RELAY_DEFAULT_SESSION_ID`, `bindings`, `snapshot on every event`,
`setInterval`, `createMockChatRelayContext`: **CLEAN**.