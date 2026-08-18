# Workspace Canvas — Implementation Status (Repository Verification)

Branch: `feature/UnrealViewer`
Date: 2026-08-14
Purpose: mandatory repository verification per `../ImplementationPlan.md` §2.3. Every claimed
status was checked against the working tree of the current branch (read-only inspection; no
code was modified). This file must be refreshed at every release checkpoint.

## 1. Status table

| # | Item | Status | Verified finding |
|---|------|--------|------------------|
| 1 | Workspace schema leaf | **partially implemented** | `packages/schema/src/workspace.ts` is a 9-line re-export of `ID` + `Event`. `workspace-id.ts` defines the branded `wrk_` `WorkspaceID` with `ascending`/`create` statics. `workspace-event.ts` defines `ConnectionStatus` and events `workspace.ready` / `workspace.failed` / `workspace.status`, registered in `EventManifest.ServerDefinitions` (`schema/src/event-manifest.ts`). Missing: `Workspace.Info`, `Block.Record`/`Transform`, `Layout.Info`/`Tuple`, `LayoutOption`, `Functionality.ID`/`Info` (architecture §3.1, ImplementationPlan §1.1). |
| 2 | Workspace core service | **proposed only** | `packages/core/src/workspace.ts` is a 6-line stub exporting only `ID` (`Workspace.ID` re-export). No `Workspace.Service`, no CRUD, no `layout.get/save`, no default-layout factory. A **legacy git-worktree `workspace` domain** exists separately: drizzle table `packages/core/src/control-plane/workspace.sql.ts` (`workspace`: id, type, name, branch, directory, extra, project_id FK, time_used) with migrations `20260225215848_workspace`, `20260303231226_add_workspace_fields`, `20260410174513_workspace-name`, `20260507164347_add_workspace_time`, and `session.workspace_id` column (`session/sql.ts`). This is the UI "workspaces" (git worktree) concept — a real naming collision with the new Workspace container (requirements §8.12, ImplementationPlan ADR-10). |
| 3 | Workspace protocol/server group | **proposed only** | `packages/protocol/src/groups/` contains 18 groups (agent, command, credential, event, fs, health, integration, location, message, model, permission, project-copy, provider, pty, question, reference, session, skill) — **no `workspace.ts`**. `packages/server/src/handlers/` mirrors the same 18 — **no `workspace.ts`**. No `workspace.*` endpoints exist in the v2 `HttpApi`; only a legacy `GET /experimental/workspace/status` (worktree git status) in the old control-plane server (`packages/opencode`). |
| 4 | Workspace client store | **implemented** (client-authoritative) | `packages/app/src/context/workspace/` exists: `model.ts` (pure model: `Workspace`, `Environment`, builtin environments `code` + `unreal-viewer`, factories, `environmentSettings`), `index.tsx` (SolidJS context persisting via `Persist.global("workspaces.v1")` → browser localStorage; owns workspaces, environments, active id; syncs environment flags into general settings), `model.test.ts` (11 passing-style bun tests). It is **client-authoritative** today; host hydration/write-through (`workspace.list/get/update`) is not started (architecture §5.1, ImplementationPlan §1.5/§1.6). Claimed-landed UI verified present: `components/workspace-switcher.tsx`, `components/dialog-workspace-v2.tsx`, `pages/home/home-workspaces.tsx`, `components/directory-picker-domain.ts` (cross-drive search). |
| 5 | Chat steer/queue delivery | **implemented** | Full chain verified. Schema: `schema/src/session-delivery.ts` `Delivery = Literals(["steer","queue"])`; `SessionInput.Admitted` carries `delivery` (`schema/src/session-input.ts`). Protocol: `session.prompt` payload accepts optional `delivery: SessionInput.Delivery` (`protocol/src/groups/session.ts` line ~210). Core: `session/input.ts` `SessionInput.admit` durably inserts the row with `delivery`; `session/sql.ts` `session_input` table has `delivery` column + pending indexes; `promoteSteers`/`promoteNextQueued` + `runner/llm.ts` promotion at safe boundary / session drain; projector emits `session.input.admitted`/`promoted`. Client: `components/prompt-input/submit.ts` `sendFollowupDraft({ delivery })`, `handleSubmit(event, "steer"|"queue")`, `queueSubmit`, queue skips optimistic busy-flip; queue button in `components/prompt-input.tsx` (line ~1585) and v2 `components/prompt-input-v2.tsx` (`onQueue` → `submission.queueSubmit`); `pages/session.tsx` `queueEnabled` memo; `packages/session-ui/src/v2/components/prompt-input/index.tsx` renders `view.submit.queue`. Removed: `session-followup-dock.tsx` no longer exists anywhere in `packages/app/src` (verified by glob). **Still proposed:** `session.input.listPending`, `session.input.cancel`, `session.run.cancel` (ImplementationPlan Phase 5). |
| 6 | TUI package | **implemented** | `packages/tui` exists as `@opencode-ai/tui` (private). Exports `./src/index.tsx` + subpath exports (config, contexts, editor, runtime, terminal-win32, plugin runtime/slots, prompt/display, ui). Backend boundary is the SDK client: depends on `@opencode-ai/sdk` (`src/context/sdk.tsx`, `src/context/event.ts` consumes `sdk.event.on("event", …)`), plus `@opencode-ai/core`, `@opencode-ai/plugin`, `@opencode-ai/ui`, opentui libs. Has its own `test/` tree and `bun test` script. `devplan/tui/tui-package.md` documents the extraction. |
| 7 | Event transport (Track D reuse assessment) | **partially implemented** | Existing transport: v2 `GET /api/event` (`server.event` group in `protocol/src/groups/event.ts`, SSE handler `server/src/handlers/event.ts` `EventV2.allBounded` with 256 capacity + 15 s heartbeat) — **live-only, no cursor, not workspace-scoped**. Legacy control-plane server (`packages/opencode`) exposes `GET /event` and `GET /global/event` SSE via `GlobalBus`, with `event-v2-bridge.ts` bridging v2 events. **Reusable core machinery:** `packages/core/src/event.ts` `EventV2` — durable events keyed by `aggregateID` + monotonic `seq` (`event_sequence`, `event` tables in `core/src/event/sql.ts`), atomic commit with projectors, `readAfter(aggregateID, after)`, resumable `durable({ aggregateID, after })` stream, replay/claim/remove. **Cursor-resume pattern already proven over HTTP:** `session.events` = `GET /api/session/:sessionID/event?after=<seq>` → `StreamSse(SessionEvent.Durable)` (`protocol/src/groups/session.ts`, handler `server/src/handlers/session.ts` line ~358). Track D (workspace event hub) can reuse `EventV2.durable` with `aggregateID = workspaceID` + the `session.events` endpoint pattern. Missing: workspace-scoped SSE endpoint, resnapshot on cursor expiry, 16 KiB event-size enforcement, progress coalescing (all proposed in subsystem architecture §17 / ImplementationPlan Phase 5). |
| 8 | Artifact / file storage | **partially implemented** | No `artifact` service, no `artifact`/`artifact_link` tables, no screenshot domain (proposed only). Existing reusable building blocks: `core/src/tool-output-store.ts` (file-based bounded tool output store: 2 000 lines / 50 KB, 7-day retention, `cleanupNode` wired in `server/src/routes.ts`); `core/src/snapshot.ts` (content-addressed file-tree snapshots for revert/diff); `core/src/image.ts` (base64 image normalization/resize via photon adapter); `core/src/share/sql.ts` (`session_share` table for share URLs). None is a general addressable payload store keyed by workspace. |
| 9 | Auth identity | **implemented** (self-host single user) | `packages/server/src/auth.ts` `ServerAuth`: single basic-auth credential — `Config` service with `username` (default `"opencode"`, env `OPENCODE_SERVER_USERNAME`) and optional `password` (env `OPENCODE_SERVER_PASSWORD`); `required()`/`authorized()` helpers. Enforced by `server/src/middleware/authorization.ts` (Basic header or `?auth_token=` query, skipped entirely when no password is configured → anonymous mode). `routes.ts` builds the layer with username `"opencode"`. `ServerAuth.Config.username` is the only per-user key available in the v2 Effect server today; OpenAuth account identity exists in `packages/enterprise`/`packages/identity` but is **not threaded into v2 server handlers**, so account deployments and the reserved `"default"` identity (ADR-4) are unverified for the layout tuple. |
| 10 | Layout tables (`layout`, `layout_option`, `workspace_git`) | **proposed only** | Grep for `layout_option`, `workspace_git`, `sqliteTable("workspace")` across `packages/core/src` found **no** `layout`, `layout_option`, or `workspace_git` tables/columns. The only `workspace` table is the legacy worktree entity (see row 2) — the new canvas `workspace`/`workspace_git` schema must avoid or rename around this collision. |

### 1.1 Additional claimed items from ImplementationPlan §2.1

| Item | Status | Verified finding |
|------|--------|------------------|
| Cross-drive directory selection | **implemented** | `packages/app/src/components/directory-picker-domain.ts` exists (pure domain module). |
| Workspace switcher (top-left) | **implemented** | `components/workspace-switcher.tsx`, `components/dialog-workspace-v2.tsx`, `pages/home/home-workspaces.tsx` exist. |
| Host-owned workspace persistence | **proposed only** | No host CRUD, no `workspace.*` API (rows 2, 3, 10). |
| Functionality Runtime Platform / instances / rights / operations / context / MCP / artifacts / IndexedDB cache / streaming backend | **proposed only** | None found in code; all live only in `functionality-subsystem-management-architecture.md` and ImplementationPlan Phases 3–10. |

## 2. Wiring guide (exact paths and steps)

Layering to follow: Schema → Core → Protocol → Server → generated SDK (CONTEXT.md). Reference trio to copy:
`packages/protocol/src/groups/project-copy.ts` + `packages/server/src/handlers/project-copy.ts`
(thin-handler pattern), and `protocol/src/groups/session.ts` (query/payload/cursor + SSE patterns).

### 2.1 Schema leaf exports

- **Extend** `D:\OpencodeDev\packages\schema\src\workspace.ts` (keep the existing `ID`/`Event`
  re-export for the legacy worktree domain; add `Workspace.Info`, `Layout.*`, `Block.*`,
  `Functionality.ID/Info`, `LayoutOption`, `Layout.Tuple` per architecture §3.1).
- Optionally split new leaves into `packages/schema/src/layout.ts`, `.../block.ts`,
  `.../functionality.ts` following the existing one-leaf-per-file convention.
- No change needed to `D:\OpencodeDev\packages\schema\src\index.ts` — line 25 already
  exports the `Workspace` namespace.
- If new event types are needed, follow `packages/schema/src/workspace-event.ts` +
  register in `D:\OpencodeDev\packages\schema\src\event-manifest.ts` (line ~79 includes
  `WorkspaceEvent.Definitions` in `ServerDefinitions`).

### 2.2 Core service + Drizzle tables + migration

1. Create `D:\OpencodeDev\packages\core\src\workspace\` directory module
   (`index.ts`, `service.ts`, `sql.ts`, `default-layout.ts`) modeled on
   `packages/core/src/session/` (`session.ts` re-export pattern, `session/sql.ts` table
   definitions). Note: `packages/core/src/workspace.ts` is currently a 6-line stub that
   must become the namespace re-export (`export * as Workspace from "./workspace"`) so
   existing imports (`core/src/session/sql.ts`, `core/src/pty/ticket.ts`,
   `core/src/control-plane/workspace.sql.ts`) keep resolving.
2. **Tables** in `D:\OpencodeDev\packages\core\src\workspace\sql.ts` using
   `sqliteTable` from `drizzle-orm/sqlite-core` + `Timestamps` from
   `packages/core/src/database/schema.sql.ts` (pattern: `session/sql.ts` lines 22–66,
   `event/sql.ts`, `share/sql.ts`). Draft names: `workspace`, `workspace_git`, `layout`,
   `layout_option` — **resolve the name collision first**: a `workspace` table already
   exists for git worktrees (`control-plane/workspace.sql.ts`) with `session.workspace_id`
   referencing it, so either reuse/rename the legacy table (ImplementationPlan ADR-10) or
   pick a distinct canvas table name before writing the migration.
3. **Migration** — add `D:\OpencodeDev\packages\core\src\database\migration\<timestamp>_workspace_canvas.ts`
   exporting `default` = `{ id, up(tx) } satisfies DatabaseMigration.Migration`
   (pattern: `migration/20260225215848_workspace.ts`, `migration/20260303231226_add_workspace_fields.ts`).
4. **Register** the new migration in the hand-maintained import list
   `D:\OpencodeDev\packages\core\src\database\migration.gen.ts` (append to the
   `await Promise.all([...])` array).
5. No runner changes needed: `D:\OpencodeDev\packages\core\src\database\migration.ts`
   (`DatabaseMigration.apply`/`applyOnly`) runs on startup via
   `D:\OpencodeDev\packages\core\src\database\database.ts` (line 33, `DatabaseMigration.apply(db)`)
   against `opencode.db` (WAL).

### 2.3 Protocol group

- Create `D:\OpencodeDev\packages\protocol\src\groups\workspace.ts`:
  `export const WorkspaceGroup = HttpApiGroup.make("server.workspace").add(HttpApiEndpoint.get("workspace.list", "/api/workspace", {...}) …)`
  with endpoints `workspace.list | get | create | update | remove | layout.get | layout.save | functionality.list`
  and OpenAPI `identifier: "v2.workspace.*"` annotations (architecture §3.4). Copy the
  shape of `protocol/src/groups/project-copy.ts` (params/query/payload/success/error,
  typed `Schema.ErrorClass` for conflicts, e.g. a layout revision-conflict error) and
  `session.ts` for query-field patterns.

### 2.4 Server handler

- Create `D:\OpencodeDev\packages\server\src\handlers\workspace.ts`:
  `export const WorkspaceHandler = HttpApiBuilder.group(Api, "server.workspace", (handlers) => Effect.succeed(handlers.handle("workspace.list", …) …))`,
  resolving `Workspace.Service` and mapping domain errors to protocol errors — thin, no
  business logic (pattern: `server/src/handlers/project-copy.ts`; SSE pattern if a
  `workspace.events` endpoint is added: `server/src/handlers/event.ts` `handleRaw` +
  `server/src/handlers/session.ts` lines 357–364).

### 2.5 HttpApi + layer registration (the two wiring points)

1. **Protocol assembly** — `D:\OpencodeDev\packages\protocol\src\api.ts`:
   import `WorkspaceGroup` and add `.add(WorkspaceGroup.middleware(locationMiddleware))`
   (or plain `.add(WorkspaceGroup)` if global) inside `makeApiFromGroup`, after
   `.add(ProjectCopyGroup.middleware(locationMiddleware))` (line ~55).
2. **Server assembly** — `D:\OpencodeDev\packages\server\src\handlers.ts`:
   import `WorkspaceHandler` and add it to the `Layer.mergeAll(...)` list (pattern lines 21–40).
3. **Application services** — if the service uses global nodes, add its node layer to the
   `applicationServices` group in `D:\OpencodeDev\packages\server\src\routes.ts`
   (lines 26–37, alongside `SessionV2.node`, `EventV2.node`).

### 2.6 Generated SDK clients

- Regenerate after the group lands: `./script/generate.ts` (runs
  `packages/sdk/js/script/build.ts`, dumps `sdk/openapi.json`, formats), plus
  `bun run generate` from `packages/client` for the legacy Promise/Effect clients
  (AGENTS.md / CONTRIBUTING.md). Generated output lands in
  `packages/sdk/js/src/v2/gen/{sdk.gen.ts,types.gen.ts}` and `packages/client/src/generated*`;
  `packages/app` consumes `@opencode-ai/sdk/v2/client`.

### 2.7 Test conventions

- App unit tests: **bun test** — `import { expect, test } from "bun:test"`; run via
  `bun test --conditions=solid --only-failures --preload ./happydom.ts ./src`
  (`packages/app/package.json` `test:unit`). Mirror
  `D:\OpencodeDev\packages\app\src\context\workspace\model.test.ts` for pure-model tests
  (grid math in `pages/canvas/editor/grid.ts` should follow this pattern).
- Server/core integration tests: Effect + `bun test` under `packages/opencode/test/server`
  (e.g. `httpapi-workspace.test.ts`, `httpapi-exercise/index.ts` route fixtures).
