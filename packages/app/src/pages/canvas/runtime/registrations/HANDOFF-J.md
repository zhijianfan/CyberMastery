# HANDOFF — Task J (Worker 3, Wave 2) — OperatingChat runtime registration

## Files changed
- `packages/app/src/pages/canvas/runtime/registrations/operating-chat.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/registrations/operating-chat.test.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/registrations/HANDOFF-J.md` (NEW)

## Tests run + result
- `cd packages/app && bun test src/pages/canvas/runtime/registrations/operating-chat.test.ts` → **PASS** (4 pass, 0 fail, 16 expect calls)
- `cd packages/app && bun run typecheck` → **PASS**

## Public exports added
- `OperatingChatBlockDescriptor` — `{ id: string; functionalityID: "builtin:operating-chat" }` (literal type).
- `OperatingChatView` — `{ history: OperatingExchange[]; layers: OperatingLayer[] }`.
- `OperatingChatCommand` — `{ type: "append-exchange"; role: "user" | "assistant"; text: string } | { type: "set-custom-layer"; text: string }`.
- `operatingChatRuntimeRegistration` — `mode: "local"`, `resolve`/`select`/`dispatch` per the packet.
- `tail` (extra, not in the packet's required export list) — local stand-in, see assumptions.

## Public exports removed
- None.

## Assumptions / uncertain
- **`tail` is NOT exported by `./editor/operating-context`** (verified by running the targeted test: `Export named 'tail' not found`). The packet inlined it as domain logic but it does not exist in the canonical file. Implemented a local `tail(text)` = last line after `/\r?\n/` split (fallback: the text itself) and exported it. **Uncertain** — M should confirm the intended `tail` semantics (last-line vs truncated-end) and swap for the canonical helper if one exists elsewhere.
- **Local mirror types.** The packet names the S0 frozen contract types (`BlockRuntimeRegistration`, `BlockRuntimeServices`, `BlockLocalViewStore`, `BlockRuntimeMode`) but not their canonical module, and workers must not read other files. These are declared as module-private mirrors in `operating-chat.ts` matching the frozen contract shapes. They are structurally compatible with the canonical versions (canonical services/descriptor are supersets), so M can type the registration against the real runtime types without changes.
- `resolve` returns `{ blockID, state, dispose }`. `blockID` is carried on the resolved object because the frozen `dispatch` input has no `block`, yet write-back needs `block.id`.
- `resolve` applies defaults (`defaultOperatingLayers()`, empty history) when the store has no record, so both `resolve` and `select` project defaults.
- `dispatch` writes the local-view store **and** mutates `resolved.state` in place so subsequent `select` calls are fresh without a re-resolve. If the runtime re-resolves after dispatch, the mutation is redundant but harmless.
- `dispose` is a guarded no-op (local-mode state lives in the store); calling it twice is a no-op (test asserts no throw).
- `localView.write` is treated as a partial merge per block (sub-keyed), matching workspace.tsx's separate `write(block.id, { layers })` / `write(block.id, { history })` calls.
- No `eventKeys`/`onEvent` — local mode needs no event transport (C3).

## Known limitations
- No event/refresh wiring; this registration is stateful only against the injected `localView` store.
- State is never written to the layout descriptor (C1/C2 local mode).

## Integration actions required by M
- Type `operatingChatRuntimeRegistration` against the canonical `BlockRuntimeRegistration<OperatingChatResolved, OperatingChatView, OperatingChatCommand>` and replace the local mirror types (`BlockRuntimeServices`, `BlockLocalViewStore`) with the canonical ones from the runtime module.
- Swap the OperatingChat renderer from the inline `OperatingChatBody` in `workspace.tsx` to this registration's `select` output; keep `OperatingChatBody` as the fallback.
- `resolve` depends on `services.localView.read<T>(blockID)` and `services.localView.write(blockID, partial)` (merge semantics).
- Reconcile `tail`: replace the local stand-in with the canonical implementation if it exists elsewhere.

## Prohibited-pattern search (grep over owned diff)
Run with `grep -rnE "api/block-runtime/event|chatgpt\\.com/backend-api/conversation|__CHAT_RELAY_RUNTIME_|CHAT_RELAY_DEFAULT_SESSION_ID|block\\.bindings|snapshot on every event|setInterval status polling|createMockChatRelayContext"` over the owned files:
- `/api/block-runtime/event` → no matches
- `chatgpt.com/backend-api/conversation` → no matches
- `__CHAT_RELAY_RUNTIME_` → no matches
- `CHAT_RELAY_DEFAULT_SESSION_ID` → no matches
- `block.bindings` → no matches
- `snapshot on every event` → no matches
- `setInterval status polling` → no matches
- `createMockChatRelayContext` → no matches