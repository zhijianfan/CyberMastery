# New Canvas Block — Compacted Context & Doc-Generation Prompt

**Purpose:** Feed this file to an LLM/agent session to generate **design**, **implementation**, and **plan** docs for creating a NEW canvas block in the opencode repo (`D:\OpencodeDev`). Self-contained; no other context needed.
**Generated:** 2026-08-18 · **Branch:** `feature/CyberMaster` (in-flight; master-agent work is the reference).
**HARD CONSTRAINT (do not violate):** Backend implementation must **reuse the opencode backend's existing features** (sessions, queue/steer delivery, layout store, EventV2, functionality instances, permissions, tools, MCP, plugin SDK). **Do not invent new backend endpoints/services/DB tables unless the reuse catalog (§3) genuinely cannot express the requirement** — and then say so explicitly with the exact gap. The master-agent block proves the entire pattern reuses existing machinery.

---

## 1. Mission (what the LLM must produce)

Produce exactly three docs for a new block `<name>` (parameterize; e.g. a research/web block, a relay-style block, a media block — whatever the caller specifies):

| Doc | Destination (per repo governance) | Contents |
|---|---|---|
| Design | `specs/block/<name>/design.md` | requirements-derived architecture: block identity, functionality id `builtin:<name>`, host-owned instance state vs client projection, wire contract (endpoints reused, NOT new), events consumed/published, invariants, permission model, failure behavior, file map |
| Implementation | `specs/block/<name>/implementation.md` | per-package file-by-file change list (create/edit, no-touch), hand-mirror SDK notes, tests to add, exact commands to verify |
| Plan | `devplan/block/<name>/plan.md` | track breakdown (schema→core→protocol→server→opencode→app), sequencing/dependencies, per-track acceptance criteria, verification checklist, risks |

Rules: each doc must cite real file:line anchors from the repo (verify, don't guess). Docs go to `specs/` (design evidence) and `devplan/` (implementation planning) — never implementation plans inside `specs/`. Target output style: dense tables, ✅/❌ verdicts, <60-line summaries per section.

## 2. Reference template: `builtin:master-agent` (canonical block)

The master-agent block is the proven template for "new block" work — it embeds the **existing Session surface**, reuses the **existing host session machinery**, and adds **no second chat implementation**. Pattern:

- **Client renderer**: `packages/app/src/pages/canvas/master-agent/block.tsx` (+ `block-shell.tsx`, `types.ts`, `port.ts`, `sdk-port.ts`, `reducer.ts`, `lifecycle-controller.ts`, `event-reconciliation.ts`, `functionality.ts`, `session-options.ts`, `coder-*.ts`). Block consumes a narrow typed view of the manager API (`MasterAgentManagerApi` = `Pick<manager, state|ensure|retry|reset|removeLocalProjection> & {coder}` — `block.tsx:36-39`); never imports the manager module at runtime.
- **Registration**: `MASTER_AGENT_FUNCTIONALITY_ID = "builtin:master-agent"` (`functionality.ts:7`); merged into `FUNCTIONALITY_BY_TYPE` in `packages/app/src/pages/canvas/workspace.tsx:104-113`; server registry lists every client type (`packages/core/src/workspace/service.ts` `builtins`) so refs validate (NFR-7).
- **Layout is data only**: layout JSON stores `{id, functionality, transform}` — no session ids, revisions, or queue state ever reach layout serialization/localStorage/IndexedDB (`docs/master-agent.md:14`; `specs/workspace-canvas/architecture.md:66-69`).
- **Host-owned state**: one functionality-instance row keyed `(workspaceID, blockID, "builtin:master-agent")` owns the authoritative Session binding; `ensure` idempotent (insert-or-revision-CAS, loser cleanup best-effort), `reset` revision+session-guarded, `tombstone` hides row only — host Session/queue preserved (`docs/master-agent.md:26-47`).
- **Client projection states**: `uninitialized → loading → ready | permission-denied | unavailable | error`; in-flight dedup, stale-response drop, reconnect refetch (`docs/master-agent.md:47`).
- **Events are transient hints**: `workspace.master-agent.binding.updated` via core EventV2 → opencode `event-v2-bridge.ts` → GlobalBus as plain event, never replayed; clients refetch (`docs/master-agent.md:45`).
- **Full architecture evidence**: `docs/master-agent.md` (implemented behavior), `specs/workspace-canvas/architecture.md`, `specs/workspace-canvas/functionality-subsystem-management-architecture.md`, `devplan/master-agent/master-agent-max-parallel-plan/` (01 decisions / 02 contracts / 05 verification).

## 3. Backend reuse catalog (reuse these; do NOT rebuild)

| Need | Existing feature to reuse | Anchor |
|---|---|---|
| Chat/composer/session UI | `CanvasSessionSurface` / `SessionSurfaceBase` (reusable explicit-target surface: messages, composer, terminal, file tree, review panel; multi-instance isolated DOM/portals) | `packages/app/src/pages/canvas/session-surface.tsx`; `docs/master-agent.md:13,36` |
| Create/run sessions | Session runtime via narrow `SessionPort` (`create`/`active`/`cleanupLosingCandidate`; live adapter wraps `SessionV2`); `session.prompt` already accepts `delivery: "steer"\|"queue"` (`packages/protocol/src/groups/session.ts` `SessionDelivery`) | `docs/master-agent.md:41,52-57`; `specs/workspace-canvas/architecture.md:278-300` |
| Queue/steer prompt admission | `SessionInput.admit` durably persists input row w/ delivery; events `session.input.admitted`/`session.input.promoted`; runner promotes steer at next safe boundary, queue one-at-a-time at idle. **No browser-side queue.** | `specs/workspace-canvas/architecture.md:284-298`; `docs/master-agent.md:53-57` |
| Workspace/layout storage | `workspace` CRUD + `layout.get/save` (revision-checked, clientID authority + handover, `layout.updated` fan-out); Drizzle SQLite `opencode.db`; migrations `core/src/database/migration.ts` | `specs/workspace-canvas/architecture.md:73-107,231-271` |
| Per-block durable config | `functionality_instance` store keyed `(workspace_id, block_id, functionality_id)`; instance config server-managed, client-writable only via allowed passthrough | `docs/master-agent.md:26-36`; `specs/workspace-canvas/functionality-subsystem-management-architecture.md:118-120` |
| Events | Core `EventV2` bus + opencode `event-v2-bridge.ts` → GlobalBus; workspace-scoped filters; never replayed | `docs/master-agent.md:45`; `specs/workspace-canvas/architecture.md:240-244` |
| Permissions/access | Session ruleset wildcards (`task`/`coder`), `findLast`; existing ask flow; `ServerAuth.username` identity; server handlers gate routes (401). Access ports exist for per-workspace policy injection | `docs/master-agent.md:86-89`; `specs/workspace-canvas/architecture.md:109-115` |
| Tools | V2 tool API: `Tool.make({description,input,output,execute,toModelOutput})` + `tools.register({name: tool})`; `Tool.Context` (sessionID, agent, assistantMessageID, toolCallID); `PermissionV2.assert`; scoped registration/overlay semantics | `specs/v2/tools.md:8-31,54-77,131` |
| Plugin contribution | Extend `packages/plugin` with `functionality` export `{id,label,render,constraints}`; host merges builtins + enabled plugin contributions | `specs/workspace-canvas/architecture.md:146-155` |
| MCP | Host-managed MCP clients + `mcp_server_profile` (for e.g. online-search/browser blocks) | `specs/workspace-canvas/architecture.md:104-107`; `specs/backend/opencode-backend-features.md:20` |
| Model selection | `Workspace.Info.model`/`coderModel` (provider/model strings, patch semantics); `Provider.getModel` validation; Catalog/variant machinery | `docs/master-agent.md:61-70` |
| Client API | Generated SDK client (`packages/client`, `packages/sdk/js/src/v2/gen/*`) from protocol `HttpApi`; app uses `serverSDK().client.v2.<group>.<method>`; Effect/Promise clients auto-emitted | skill `opencode-repo-development` "SDK regeneration workflow"; `specs/workspace-canvas/architecture.md:127-129` |
| Functionality registry | Register new `builtin:<name>` in core `builtins` + client `FUNCTIONALITY_BY_TYPE`/`TYPE_BY_FUNCTIONALITY`; ids namespaced to prevent collisions | `specs/workspace-canvas/architecture.md:138-155`; `workspace.tsx:104-117` |

## 4. Repo map & conventions

- Layering (strict): **Schema** (`packages/schema`, Effect schemas, leaf types) → **Core** (`packages/core`, domain services, Drizzle) → **Protocol** (`packages/protocol`, `HttpApiGroup` + `@description` → SDK JSDoc) → **Server** (`packages/server`, thin handlers, no business logic). **Client may depend on Schema/Protocol only — never Core/Server.** relay must NOT import packages/opencode.
- `packages/opencode` = CLI/host: server routes compose instance HttpApi in `packages/opencode/src/server/routes/instance/httpapi/server.ts` — a new core workspace service must be added to BOTH its `app` LayerNode.group AND `packages/server/src/routes.ts` `applicationServices`, or serve fails at boot with `Service not found` (hit by ChatRelayPayload 2026-08-18).
- SDK regen: after changing `packages/protocol/src/groups/<x>.ts`, hand-mirror `packages/client/src/generated/types.ts`, `packages/sdk/js/src/v2/gen/types.gen.ts` + `sdk.gen.ts`; adapters need no change; `sdk/openapi.json` may be stale — verify before editing. First CI must run `bun run generate`.
- Environment: repo uses **bun**; absolute path `~/.bun-npm/node_modules/@oven/bun-windows-x64/bin/bun.exe` (not on PATH; `~/.bun/bin` is a flaky MSYS symlink). Typecheck without bun: `scripts/typecheck-package.sh <src-dir>` (strict tsc + @types/node + @types/bun, `noUnusedLocals: true`). Never claim "cannot typecheck".
- Bun fetch typing pitfall: injected fetches must use `type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>` — plain `typeof fetch` fails (bun's has `preconnect`).
- Docs governance: `specs/<feature>/` = requirements/design/architecture; `devplan/<feature>/` = implementation plans/status/verification. Move stale implementation docs out of `specs/`; patch all cross-references; verify with `rg` (see skill `repository-documentation-governance`).

## 5. What "new backend" means here (and the bar to clear)

Allowed new backend code ONLY when the reuse catalog cannot express the requirement. For each proposed addition, the implementation doc must state: (a) the exact requirement, (b) why §3 entries fail (anchor each), (c) the minimal addition (schema type / protocol group / handler / service / table / event) and how it follows existing patterns. Otherwise: **zero new endpoints, zero new tables, zero new events** — new blocks are thin registrations + client renderers over existing machinery.

## 6. Verification commands (document in plan; run before claiming done)

```bash
cd /d/OpencodeDev
~/.bun-npm/node_modules/@oven/bun-windows-x64/bin/bun.exe test <new-test-files>   # or the repo test script
bash scripts/typecheck-package.sh packages/app/src/pages/canvas/<block-dir>       # strict tsc
# full typecheck + SDK regen on CI: bun run generate && bun test
```

## 7. LLM working instructions

1. Read `docs/master-agent.md` fully first — it is the implemented-behavior truth for the template.
2. Read the §3 anchors you intend to reuse; cite file:line in every doc claim.
3. Do not invent APIs, event names, or DB columns. If unsure a feature exists, search the repo (`rg`) — don't assume.
4. Deliver the three docs as files in the destinations above (single context file consumed; docs written separately).
5. Final response: compacted state table — docs produced, key reuse decisions w/ anchors, any backend additions + justification, verification results ✅/❌, what couldn't be verified locally.
