# block-runtime

Assignment: implement the ChatRelay → OpenCode-Native Block Runtime Layer per the
user-attached plan `chatrelay-block-runtime-parallel-implementation-plan-2.md`.

P0 (master-executed) is complete — see P0.md for extraction, injection-point
inventory, e2e baseline (3 pass / 9 fail), and bundle baseline (index-mjRXeggk.js).

Decisions (master):
- SINGLE TREE, not worktrees (established Hermes ParallelMaster variant; plan §8
  worktrees are optional). Disjoint file ownership below; no commits — committing
  is the user's call.
- Integration owner (master) registers: protocol api.ts exports, server
  routes.ts/handlers.ts, app adapter registry wiring, SDK regeneration/mirror.
- Workers carry LOCAL COPIES of the pinned contracts; canonical imports land at
  integration. Cross-track dependencies are forbidden; use the pinned shapes.
- Track J (legacy relay cleanup) was already executed by the earlier
  chat-relay-migration run (packages/relay/src/provider/* deleted). No track may
  resurrect legacy relay code.

| # | task | source | worker | files (owned) | acceptance |
|---|---|---|---|---|---|
| A | protocol contracts | tasks/A.md | 1 | packages/protocol/src/groups/block-runtime.ts + block-runtime.test.ts (new) | Effect-schema group compiles standalone; resource-oriented; snapshot + cursor/resync; no UI fields |
| B | backend gateway | tasks/B.md | 2 | packages/server/src/runtime/block-runtime-types.ts, resource-snapshot.ts, block-runtime-gateway.ts, block-runtime-gateway.test.ts, packages/server/src/handlers/block-runtime.ts (all new) | snapshot + envelope translation over EventV2; dedupe/batch; resync-required; sub release; no layout fields |
| C | opencode chat/auth adapter | tasks/C.md | 3 | packages/server/src/runtime/adapters/opencode-chat.ts + opencode-chat.test.ts (new) | typed service over native session/auth/permission APIs; no /backend-api/conversation; ChatRelayCommand mapping |
| D | frontend runtime store | tasks/D.md | 4 | packages/app/src/state/block-runtime-store.ts + test (new dir), packages/app/src/pages/canvas/runtime/{controller,registry,types,index}.ts, controller.test.ts | hydrate→subscribe-after-cursor; dup/stale/gap→resync; rAF batching; ref counting; layout replacement keeps runtime |
| E | chatrelay adapter+UI | tasks/E.md | 5 | packages/app/src/pages/canvas/blocks/chat-relay/** (all files), packages/app/src/pages/canvas/canvas.css | adapter+view model against mock context; index.ts keeps exporting ChatRelayBody + icons; incremental parts; composer local |
| F | canvas ownership | tasks/F.md | 6 | packages/app/src/pages/canvas/workspace.tsx, packages/app/src/pages/canvas/manager.ts | recordToBlock stops synthesizing relay state; applyServerLayout descriptor-only; sessionID binding persist; lazy migration |
| G | tests/harness | tasks/G.md | 7 | packages/app/src/pages/canvas/master-agent.e2e.test.tsx, packages/app/src/test/block-runtime-events.ts (new) | deterministic fake event source; new scenarios; regression tests for layout-runtime isolation; baseline comparison |
| H | observability/flag | tasks/H.md | 8 | packages/core/src/flag/flag.ts (single entry add), packages/app/src/pages/canvas/diagnostics.ts (new), specs/workspace-canvas/block-runtime-observability.md (new) | flag exists; hook-based diagnostics; redaction rules; active-path doc |

Worker spawn: `opencode run "$(cat .opencode/parallel/block-runtime/tasks/<N>.md)" --agent parallel-worker --model openai/gpt-5.3-codex-spark --title block-runtime-<N>`, background, workdir D:\OpencodeDev.
Gate verified: `opencode auth list` shows OpenAI oauth (worker model provider).

Shared-file rules:
- workspace.tsx + manager.ts → F ONLY (integration adds registration imports later).
- blocks/chat-relay/** + canvas.css → E ONLY.
- packages/app/src/pages/canvas/runtime/** → D ONLY (P0 placeholders are D's to replace).
- packages/app/src/state/** (new dir) → D ONLY.
- packages/protocol/src/groups/block-runtime.* → A ONLY.
- packages/server/src/runtime/** → B owns gateway files, C owns adapters/** (disjoint subpaths).
- Central files (protocol/src/api.ts, server/src/{routes,handlers}.ts, sdk generated/*,
  openapi.json, core session/oauth code) → integration owner ONLY; workers may read.
- master-agent.e2e.test.tsx + packages/app/src/test/block-runtime-events.ts → G ONLY.
- Integration invariants (§ of plan): no `block.relay = runtimeState`, no 5s
  setInterval syncStatus required for correctness, no chatgpt.com/backend-api fetch,
  no applyServerLayout({...block, messages}).
