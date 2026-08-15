# Workspace Canvas — Architecture

Branch: `feature/UnrealViewer`
Status: draft for review
Companion: [requirements.md](./requirements.md), [../UIDesign.md](../UIDesign.md), [../functionality-subsystem-management-architecture.md](../functionality-subsystem-management-architecture.md) (functionality runtime platform), [../ImplementationPlan.md](../ImplementationPlan.md) (phased delivery plan)

## 1. Goals

Meet the requirements in `requirements.md` while reusing the OpenCode monorepo's
existing layering:

- **Server (host)** owns durable workspace/layout storage and exposes it over the
  existing Effect HTTP API stack.
- **Client (viewer)** is a thin projection: it loads a workspace + resolved layout
  and renders blocks in a full-page panel under a restructured top bar.
- **Layouts are data**: block records contain only transforms and functionality
  references. All block content state stays in existing domains (sessions,
  terminals, files) and is resolved at render time.

## 2. System context

```
┌─────────────────────────────── Client viewer (web/desktop) ───────────────────────────────┐
│  ┌────────────────────────────── Top bar ──────────────────────────────────────────────┐  │
│  │ [Workspace config: switcher │ name │ style │ edit toggle]      (all other controls)│  │
│  └─────────────────────────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────── Panel (canvas) ────────────────────────────────────────┐  │
│  │  ┌────────────┐  ┌────────────────────┐  ┌─────────┐                                │  │
│  │  │ chat block │  │ terminal block     │  │ viewer  │        blank otherwise        │  │
│  │  └────────────┘  └────────────────────┘  └─────────┘                                │  │
│  └─────────────────────────────────────────────────────────────────────────────────────┘  │
│        workspace store / layout sync (revision-checked)                                   │
└───────────────────────────────────────────────────────────────────────────────────────────┘
                                      │ HTTP (v2 API)
┌────────────────────────────── Host: OpenCode server ──────────────────────────────────────┐
│  server/handlers/workspace.ts ── protocol/groups/workspace.ts ── core/workspace/service   │
│  Drizzle SQLite (opencode.db): workspace, layout, layout_option tables                    │
│  identity: ServerAuth.username (self-host) / account (cloud)                              │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

## 3. Server-side architecture

Follows the existing contract architecture from `CONTEXT.md`: **Schema** (leaf
types) → **Core** (domain service) → **Protocol** (routes/middleware) →
**Server** (handlers), with the SDK Contract IR emitting client bindings.

### 3.1 Schema — `packages/schema/src/workspace.ts` (new leaf)

```ts
Workspace.ID          = branded string
Workspace.Info        = { id, name, style, directories[], pluginIDs[], skillIDs[],
                          git: { directory, branch, remote, dirty }[] }
Block.Record          = { id, functionality: Functionality.ID, transform: Block.Transform }
Block.Transform       = { x, y, w, h, z }            // grid units, integers
Layout.Info           = { id, revision, workspaceID, blocks: Block.Record[] }
Layout.Tuple          = { user, style, deviceClass, deviceID? }
LayoutOption          = { tuple: Layout.Tuple, layoutID }
Functionality.ID/Info = { id, kind: "builtin" | "plugin", label, icon, min/max size }
```

`Functionality.Info` is the minimal registry projection; the full manifest
model (constraints, lifecycle, concurrency, rights, context kinds, and port
schemas) is defined in the functionality subsystem architecture.

Rules enforced by Schema (and re-checked in Core):

- Layouts contain only `Block.Record` — no content, session ids, or view state
  (FR-20/FR-21).
- `Functionality.ID` values are validated against the registry on write (NFR-7).
- Transforms are non-negative integers; `w,h ≥ min`, `≤ max` per functionality.

### 3.2 Core service — `packages/core/src/workspace/`

- `Workspace.Service` (Effect context service) with CRUD:
  - `list`, `get`, `create`, `rename`, `remove`, `update` (directories, plugins,
    skills, git entries)
  - `layout.get(tuple)` → resolves LayoutOption → Layout, else creates the
    default layout (single full-panel chat block) and stores the option
  - `layout.save(tuple, blocks)` → optimistic revision bump, returns new revision
  - `functionality.list(workspace)` → builtin + plugin-contributed for that
    workspace's enabled plugins
- Persistence via the existing Drizzle stack (`core/src/database`, global
  `opencode.db`, migrations through `core/src/database/migration.ts`).

New tables (draft):

```
workspace          id TEXT PK, user TEXT, name TEXT, style TEXT,
                   directories TEXT (JSON), plugins TEXT (JSON), skills TEXT (JSON),
                   time_created INTEGER, time_updated INTEGER
workspace_git      workspace_id TEXT, directory TEXT, remote TEXT, branch TEXT,
                   PRIMARY KEY (workspace_id, directory)          -- snapshot, refreshed by watcher
layout             id TEXT PK, workspace_id TEXT, revision INTEGER,
                   blocks TEXT (JSON), time_updated INTEGER
layout_option      workspace_id TEXT, user TEXT, style TEXT, device_class TEXT,
                   device_id TEXT NULL, layout_id TEXT,
                   PRIMARY KEY (workspace_id, user, style, device_class, device_id)
```

- Git tracking (FR-2) is a **snapshot** in `workspace_git`, refreshed by the
  existing `vcs`/watcher machinery; it is read-only UI data, not source of truth.

The functionality runtime platform adds further tables (`functionality_instance`,
`functionality_operation`, `artifact`, `context_capsule`, `mcp_server_profile`,
`workspace_permission_rule`, and session-input pending-state columns); those are
specified in the functionality subsystem architecture, not duplicated here.

### 3.3 Identity

- Self-host: `ServerAuth.username` (existing `server/src/auth.ts`) keys `user`.
- Cloud/account deployments: the account identity from OpenAuth (already used in
  `packages/enterprise`) keys `user`.
- Anonymous/local single-user instances fall back to a reserved `"default"` user.
  (Resolved in `requirements.md` §8.6.)

### 3.4 Protocol + handlers

- `packages/protocol/src/groups/workspace.ts`: endpoints
  `workspace.list`, `workspace.get`, `workspace.create`, `workspace.update`,
  `workspace.remove`, `workspace.layout.get`, `workspace.layout.save`,
  `workspace.functionality.list`.
- Layout endpoints accept the tuple in the query/body and return
  `Layout.Info`; `save` returns `{ revision }` for staleness checks (FR-22).
- `packages/server/src/handlers/workspace.ts`: thin Effect handlers like the
  existing 18 groups; no business logic in handlers.
- The public `HttpApi` includes the group, so the SDK Contract IR automatically
  produces Promise and Effect clients (per `CONTEXT.md`) for both the networked
  viewer and embedded use.

### 3.5 Default layout factory

`core/workspace/default-layout.ts`: pure `createDefaultLayout(workspace)` returns
one block `{ functionality: "builtin:chat", transform: { x:0, y:0, w:panel, h:panel, z:0 } }`
where `panel` is the device-class default grid size. Created lazily on first
`layout.get` per tuple (FR-23/FR-24).

## 4. Functionality registry

- **Builtin** (`core/workspace/functionality/builtin.ts`): the v1 set is
  `builtin:chat` (default agentic chat), `builtin:online-search`,
  `builtin:screenshot-browser`, and `builtin:application-window-stream`
  (placeholder contract). Existing panels — `terminal`, `file-tree`, `diff`,
  `todos`, `viewer` (UnrealViewer) — migrate to the same manifest interface
  incrementally.
- **Plugin-contributed**: extend the existing plugin SDK
  (`packages/plugin`) with a `functionality` export
  `{ id, label, render, constraints }`; the host registry merges builtins with
  the active workspace's enabled plugins (FR-14, FR-2).
- Each functionality's manifest declares block `constraints` (min/max sizes,
  initial aspect) and lifecycle policy (resolves `requirements.md` §8.1/§8.15
  per functionality); see the functionality subsystem architecture for the
  full manifest contract.
- Functionality ids are namespaced (`builtin:chat`, `plugin:name:id`) to prevent
  collisions and to validate references on write (NFR-7).

## 5. Client-side architecture (`packages/app`)

### 5.1 Top bar restructure

- `pages/layout-new.tsx` currently hosts `Titlebar`. The new shell renders:
  - left region: `WorkspaceSwitcher` (existing, evolves), inline name editor,
    style selector, editing-mode toggle (FR-9)
  - right region: server status, model selector, agent selector, theme,
    notifications, settings, help — ported from their current surfaces (FR-10)
- The existing workspace context (`context/workspace/`) becomes a **client
  projection of host state**: hydration from `workspace.get`, mutations
  write-through to `workspace.update`. Client-side persistence (`Persist`)
  remains only as an offline cache, never authoritative (FR-7, NFR-4).

### 5.2 Canvas panel

New module tree:

```
pages/canvas/
  canvas-panel.tsx        Panel surface: blank, renders blocks + editing overlays
  block.tsx               One block: loads functionality renderer, draws content
  block-frame.tsx         Editing chrome: outline, handles, remove
  palette.tsx             Functionality palette (builtin + plugin)
  editor/
    grid.ts               Pure grid math: cell size, snap, collision, bounds
    drag.ts               Pointer-based move/resize state machine
    layout-store.ts       Client layout store: revision, optimistic apply, save
    grid.test.ts / drag.test.ts
```

- **Grid math is pure and unit-tested** (`grid.ts`), following the
  `directory-picker-domain` pattern: `snap(value, cell)`,
  `clampBlock(rect, panel, constraints)`, `resolveOverlap(blocks)`.
- The panel is **not scrollable** — the canvas always fits the viewport, so
  blocks are constrained to the visible area. Empty packing strips of 5% of
  the panel width are reserved on the left and right sides; blocks never
  enter the packing (`packedPanel` in `grid.ts`).
- Drag/resize uses native pointer events with grid snapping (no heavy DnD
  dependency needed for fixed-grid transforms; `@thisbeyond/solid-dnd` remains
  available if palette drag-and-drop is preferred).
- Editing mode toggles `data-editing` on the panel; outside it, frames and
  gestures are removed entirely (FR-26/FR-28).

### 5.3 Block rendering

- A block resolves its functionality id → renderer (builtin component or
  plugin-registered renderer) and renders content bound to the workspace scope:
  chat blocks bind to a directory (primary by default) and show the most recent
  session; terminal/file-tree/diff blocks bind to directories the same way
  (requirements §8.8/§8.9 — directory binding is runtime state, not layout data).
- Non-visible blocks suspend their content (requirements §8.15) unless the
  functionality declares keep-alive (terminal).
- Unknown/missing functionality refs render an error block with a replace
  affordance (NFR-7, §8.20).

### 5.4 Layout sync

- Load: `workspace.layout.get(tuple)` → render. Cache key = `(workspaceID,
  revision)`; ETag-style revision check avoids re-rendering unchanged layouts.
- Save: editing-exit applies the new block set to the client store, calls
  `workspace.layout.save`, and stores the returned revision. A conflicting
  revision (another device) surfaces a "layout changed elsewhere" notice and
  re-loads — v1 uses last-write-wins only on explicit retry (§8.11).
- Live cross-device push (durable events/SSE like `sessions.events`) is designed
  but deferred; the LayoutOption keying makes it a pure additive change.

## 6. Chat delivery: steer & queue

The chat block's composer offers two delivery modes for prompts sent while the
session is busy. Full UI design: `UIDesign.md`. Architecture below spans host
and viewer.

### 6.1 Wire contract

`session.prompt` already accepts `delivery: "steer" | "queue"` (optional,
`packages/protocol/src/groups/session.ts`, schema `SessionDelivery`), passed
through by `packages/server/src/handlers/session.ts` to Core.

### 6.2 Host-side queue

Pre-existing Core machinery (`packages/core/src/session/`):

- `SessionInput.admit` durably persists the input row with its `delivery`
  (`input.ts`, `sql.ts` `session_input` table).
- The projector emits `session.input.admitted` (and `session.input.promoted`
  when it promotes), so clients see both durable states.
- The runner (`runner/llm.ts`) promotes steer inputs at the next safe boundary;
  queue inputs stay pending while the current **Session Drain** requires
  continuation and promote one at a time once the session would otherwise become
  idle.

The client sends queue prompts immediately with `delivery: "queue"`; nothing is
held client-side.

### 6.3 Viewer flow

- `packages/app/src/components/prompt-input/submit.ts`:
  `sendFollowupDraft({ delivery })` forwards it to `sessions.prompt`;
  `createPromptSubmit.queueSubmit(event)` = `handleSubmit(event, "queue")`.
  Queue sends skip optimistic busy/idle flipping (the session is already busy).
- Composers render a Queue button when `queueEnabled` (session exists ∧ busy ∧
  composer not blocked ∧ not a child session): v1 in
  `packages/app/src/components/prompt-input.tsx`, v2 via
  `submit.queue` in `packages/session-ui/.../prompt-input/index.tsx`
  (view contract in `interaction.ts`, wired in
  `packages/app/src/components/prompt-input-v2.tsx`).
- The message is added optimistically; `server-session-v2-reducer.ts` holds
  `session.input.admitted` as pending and appends the user message on
  `session.input.promoted`, deduplicated by message id against the optimistic
  copy.

### 6.4 Removed

- Client-side follow-up queue: persisted `followup` store, followup dock
  (`session-followup-dock.tsx` deleted), auto-send effect, edit flow.
- The `followup` general setting and its forced-steer migration
  (`packages/app/src/context/settings.tsx`). Delivery is an explicit per-message
  choice; Enter always steers.

## 7. Storage keying matrix

| Dimension  | Values                     | Source                          |
| ---------- | -------------------------- | ------------------------------- |
| user       | server identity            | ServerAuth / account            |
| style      | named style id             | workspace.style (user-editable) |
| device     | class: `desktop|mobile|tablet`, optional `deviceID` | client-reported |

Resolution precedence in `layout.get`: exact tuple → (user, style, class) →
(user, style) → (user) → default factory (FR-24, §8.4/§8.5). The required
tuple is `(workspace, user, style, deviceClass)`; `deviceID` is deferred unless
a per-machine restore requirement is approved (`ImplementationPlan` ADR-3).
`layout` (the workspace's block arrangement, which governs its functionality
availability — replaces the former `environment` preset) and `style`
(visual/density preference) are distinct dimensions per ADR-2.

## 8. Security & validation

- Layout writes re-validate every functionality ref against the workspace's
  enabled set (NFR-7); refs to plugin functionalities require the plugin enabled.
- Directory/skill/plugin mutations go through the same permission gates as the
  existing server handlers (location-scoped where applicable).
- Layout JSON is size-capped (NFR-5) and parsed via Effect Schema (3.1), which
  bounds hostile inputs before persistence.

## 9. Migration & rollout

1. Ship the workspace server group + tables behind no flag (additive schema).
2. Client: top bar restructure and canvas panel behind the existing
   `newLayoutDesigns` pathway; legacy home/session routes remain until the
   canvas reaches parity (requirements §8.12).
3. Migrate the current client-side workspace store (directories/plugins/
   layout) to host hydration; keep `Persist` as cache.
4. Introduce editing mode + layout persistence last, on the stable shell.

Landed on the branch so far: the client-side workspace/layout store
(`packages/app/src/context/workspace/`), top-left workspace switcher
(`components/workspace-switcher.tsx`, `dialog-workspace-v2.tsx`,
`pages/home/home-workspaces.tsx` replacing the project column), the
cross-drive directory search (`directory-picker-domain.ts`), and the
steer/queue chat delivery (§6).

## 10. OperatingAgent & OperatingContext

The **OperatingAgent** model is configured per workspace: each workspace
configures exactly one model API that answers its blocks. That configured
model API is called the **OperatingAgent**.

Each block's **BlockSubsystem** may handle multiple contexts to submit to the
OperatingAgent. The contexts form a stack, ordered from top to bottom; the
whole stack is called the **OperatingContext**:

| Order | Layer                  | Source                                                                 |
| ----- | ---------------------- | ---------------------------------------------------------------------- |
| 1     | WorkspaceContext       | generated by the workspace configuration                               |
| 2     | BlockContext           | hardcoded context defined when the block is designed                   |
| 3     | OperationalContext     | decided by the BlockSubsystem's output                                 |
| 4     | CustomContext          | fixed text provided by the user                                        |
| 5     | HistoricalContextStack | timestamped and indexed compacted record of every ask-response and execution of the OperatingAgent |

- The **HistoricalContextStack** records every ask, response, and execution of
  the OperatingAgent in compacted, timestamped, indexed form. It may expand
  until the OperatingAgent's context limit is reached.
- The BlockSubsystem owns assembling its OperatingContext layers
  (OperationalContext from its own output, HistoricalContextStack bookkeeping)
  and submits the completed stack to the workspace's OperatingAgent.

The **OperatingChatSession** block (`builtin:operating-chat-session`) is the
modded opencode session that hosts the workspace's OperatingAgent as a canvas
block. Landed on the branch:

- Viewer: block type `operating-chat` in
  `packages/app/src/pages/canvas/workspace.tsx` (`OperatingChatBody`), showing
  the OperatingAgent model key (FR-10), the editable OperatingContext stack,
  and the indexed HistoricalContextStack.
- Pure stack logic: `packages/app/src/pages/canvas/editor/operating-context.ts`
  (`defaultOperatingLayers`, `appendExchange`, `compactSummary`,
  `OPERATING_CONTEXT_LIMIT`) with unit tests; exchanges beyond the limit are
  compacted into a summary record.
- Registry: `builtin:operating-chat-session` in
  `packages/core/src/workspace/service.ts`.

## 11. Pseudo blocks

A **pseudo block** is a block whose functionality reroutes to an external
service instead of executing locally, backed by a crawler-like subsystem.

The first pseudo block is **ChatGPTRouter** (`builtin:chatgpt-router`),
specified in `../../PseudoBlock/ChatGPTRouter/README.md`:

- Reroutes the block to the ChatGPT webpage; the block must be initialized
  with a ChatGPT login.
- A crawler-like subsystem performs the simple data processing: download
  files, extract the response, type in the message, and submit.
- Each chat session keeps its own context storage, relayed to the workspace's
  OperatingAgent. For now the subsystem stores all relayed messages;
  processing stored text is not implemented (see its TODO.md).

## 12. Open risks

- **UnrealViewer content model** (requirements §8.19) — the viewer block's
  rendering pipeline (native window embedding vs streamed viewport) determines
  whether the panel is pure web or hybrid; architecture above assumes web-native
  renderers with plugin escape hatches.
- **Block lifecycle memory** (§8.15) — many live terminals/viewers; the
  keep-alive/suspend policy is defined per functionality manifest in the
  subsystem architecture (lifecycle + keep-alive matrix); it needs validation
  against the 12-block/60-fps target before v1 ship.
- **Identity for self-host** (§8.6) — single basic-auth username makes
  "per user" storage collapse to one user locally; cloud is multi-tenant by
  design. Confirm the intended deployment target.
- **Naming collision** — existing sidebar "workspaces" (git worktrees) and the
  new workspace container must be renamed/disambiguated in UI copy.
