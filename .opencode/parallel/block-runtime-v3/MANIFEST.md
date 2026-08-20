# block-runtime-v3 — MANIFEST & Ownership

Single-tree execution (plan §7.1 permits it when ownership is enforced mechanically).
Every worker edits ONLY its owned files. Central files are reserved for M.

## Waves

| Wave | Tasks | Workers |
|---|---|---|
| 1 | A contracts · B backend events · C router/controller/store · D host/canvas split · E workspace recovery · F session-binding factory · G harness | 7 parallel |
| 2 | H ChatRelay · I MasterAgent · J OperatingChat · K static/local · L diagnostics/flag | 5 parallel |
| 3 | M integration (master) · N e2e/hardening · O cleanup | serial-ish |

## Ownership matrix (wave 1)

| Owner | Paths | Edits |
|---|---|---|
| A | `packages/app/src/pages/canvas/runtime/contracts.ts` (+ `contracts.test.ts`) | NEW files only. No edits to existing files. |
| B | `packages/core/src/workspace/functionality-instance.ts`, `packages/core/src/workspace/functionality-instance-events.ts` (new) + tests | event schema + publication |
| C | `packages/app/src/pages/canvas/runtime/{event-router,controller,registry,resource-store,types,index}*` + their tests; `packages/app/src/state/block-runtime-store.ts` | replacement of old store/controller/types |
| D | `packages/app/src/pages/canvas/workspace.tsx`; `packages/app/src/pages/canvas/runtime/{provider,block-runtime-host,local-view-store}*` + tests | canvas state split, host |
| E | `packages/protocol/src/groups/workspace.ts`, `packages/server/src/handlers/workspace.ts`, `packages/core/src/workspace/service.ts` (not-found handling only), `packages/app/src/pages/canvas/manager.ts` + tests | typed 404 + recovery |
| F | `packages/app/src/pages/canvas/runtime/adapters/session-binding*` + tests | NEW files only |
| G | `packages/app/src/test/**` (fixtures), `packages/app/src/pages/canvas/master-agent.e2e.test.tsx` (harness repair only) | fixtures + harness |

## Resolution of overlaps (master decisions)

- **A vs C types overlap**: A creates ONLY new `runtime/contracts.ts` and does NOT touch
  existing `runtime/types.ts` or `blocks/chat-relay/types.ts`. C (which owns the old files)
  rewires them to the canonical contracts where Wave-1 compilation requires, marking
  deprecations for O. H/I delete the ChatRelay-local duplicates in Wave 2.
- **E owns `service.ts` not-found handling; B owns `functionality-instance.ts`**: disjoint.
- **D owns `workspace.tsx` entirely**; H–K must NOT edit it in Wave 2 — they deliver
  renderer modules and M wires them (per plan: M wires the renderer registration).
- **F adapters dir**: F creates `runtime/adapters/session-binding*`; the existing
  `runtime/server-transport.ts`/`bootstrap.ts` stay untouched until O deletes them.

## Reserved for M (workers must NOT edit)

`packages/protocol/src/api.ts`, `packages/server/src/api.ts`/`handlers.ts`/`routes.ts`,
`packages/opencode/src/server/routes/instance/httpapi/server.ts`, generated SDK files,
`openapi.json`, embedded web UI map (`opencode-web-ui.gen.ts`), lockfiles.

## Worker invocation

`opencode run "$(cat .opencode/parallel/block-runtime-v3/tasks/<X>.md)" --agent parallel-worker
--model openai/gpt-5.3-codex-spark --title block-runtime-v3-<X>`
Fallback on usage-limit error: `--model inferai/deepseek-v4-flash --variant ultra`.
Spawn stagger 12–20s to avoid `database is locked` boots.
