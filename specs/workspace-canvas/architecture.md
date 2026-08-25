# Workspace Canvas — Architecture

Branch: `feature/CyberMaster`
Status: implemented canvas/session architecture verified 2026-08-24; approved
OperatingChat context extension is future work dated 2026-08-25
Companion: [requirements.md](./requirements.md), [UIDesign.md](./UIDesign.md), [functionality-subsystem-management-architecture.md](./functionality-subsystem-management-architecture.md) (functionality runtime platform), [OperatingChat context design](../../docs/superpowers/specs/2026-08-25-operating-chat-context-assembly-design.md), [ImplementationPlan.md](../../devplan/workspace-canvas/ImplementationPlan.md) (phased delivery plan)

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

### 5.2 Canvas panel (implemented)

Actual module tree (the earlier draft tree was replaced during implementation):

```
pages/canvas/
  workspace.tsx        Standalone canvas renderer: camera, blocks, chrome,
                       interactions. Pure UI — no backend communication.
  manager.ts           Workspace/layout/config communication: revision/authority,
                       OperatingAgent model, permission config, recovery, and
                       layout events. Runtime registrations own block binding
                       resolution and semantic-event invalidation.
  canvas.css           Agent Canvas art style (glass cards, dotted grid, pastel).
  editor/
    grid.ts            Pure grid math: snap, packedPanel, clampBlock, resolveOverlap
    camera.ts          Camera math: pan/zoom, clamping, frozen pan base
```

The repository still contains a test-only legacy
`editor/operating-context.ts` utility with no production importer. It is not a
runtime architecture component and the approved context implementation plan
removes it together with its isolated test after a zero-reference check.

- **UI is standalone.** `workspace.tsx` renders local state and reports edits.
  `manager.ts` owns workspace/layout/config communication; the generic runtime
  host calls generated APIs through functionality registrations. ChatRelay
  binding sync, polling, and transcript ownership do not live in the manager.
- **Transforms are owned by the store, applied by effect.** The render loop
  never sets card rects (it only sets the accent); a `createEffect` on the
  block store re-applies each block's rect to its DOM node after every store
  mutation. This was introduced after the render loop proved unreliable for
  mid-gesture updates in some environments, and it prevents any render/stores
  drift.
- **Gestures** are native pointer events bound as Solid JSX props on the
  viewport element (one listener per node — HMR/remount can never stack
  them). Move/resize/collapse are editing-mode-only (FR-26/FR-28); block
  clicks select and raise in any mode. **Pan** (left or right button) is a
  frozen camera snapshot + screen-space delta so the grabbed point stays
  locked at any zoom; **wheel** zooms towards the cursor (native scroll
  remains inside scrollable card content). Position snapping to the 16px
  grid happens once on release.
- **Frozen snapshots are mandatory**: `state.camera` is a live Solid store
  proxy (`setState` shallow-merges into the same object), so gesture bases
  use `snapshotCamera()` (frozen plain copy). Capturing the proxy directly
  turns `Cᵢ = C₀ + Dᵢ` into the integrating `Cᵢ = Cᵢ₋₁ + Dᵢ` — the cause of
  the pan-amplification bug that pan diagnostics (`/__canvas-pan-debug`,
  `.test-data/canvas-pan-debug.jsonl`) were built to hunt down.
- The panel is **not scrollable**; blocks are constrained to the visible
  world with 5% packing strips (legacy block) per `grid.ts`.

### 5.3 Block rendering (implemented)

- A block resolves its functionality id → renderer. The registered mappings
  (`FUNCTIONALITY_BY_TYPE` in `workspace.tsx`): legacy block = `builtin:chat`
  (the spec's default agentic chat window), demo modules = `builtin:context`,
  `builtin:tools`, `builtin:files`, `builtin:notes`, `builtin:voice`,
  `builtin:chat-relay` (pseudo block, §11), `builtin:operating-chat-session`
  (§10). The server registry (`packages/core/src/workspace/service.ts`
  `builtins`) lists every client type, so functionality refs validate
  (NFR-7).
- Unknown/missing functionality refs are skipped on hydration (error-block
  affordance is the open follow-up, §12).
- Non-visible-block suspension (§8.15) is not yet implemented.

### 5.4 Layout sync (implemented)

- Load: `workspace.layout.get(tuple, clientID)` → render; the server is
  authoritative at connect only. The client then owns the layout; block edits
  mark it dirty and a debounced (160ms) `workspace.layout.save(expectedRevision)`
  pushes the settled state. Camera/editing never sync.
- Save results: `saved` (adopt new revision), `handed-over` (§5.4.1),
  `conflict` (server is the tie-breaker: re-pull and adopt). Transient
  failures re-raise dirty and retry after 3s.
- **Realtime fan-out (implemented)**: a successful save publishes the transient
  `workspace.layout.updated` event (`{workspaceID, revision}`) through the
  core `EventV2` bus; connected clients re-pull and adopt live (no refresh
  needed). Pending local edits are adopted-over then re-pushed (last-write-wins,
  mirroring handover). Self-echoes are ignored by revision.
- **DEV-mode offline authority**: in `import.meta.env.DEV`, edits made while
  the backend is unreachable mark the client authoritative; on reconnect the
  client keeps its blocks and pushes instead of pulling (boot-time hydration
  never counts as an edit). Non-DEV keeps server authority on reconnect,
  except for the pristine-default layout (single unit `builtin:chat`), which
  the client's blocks replace and push.
- Window focus re-claims authority (push dirty, else re-pull); `online`
  reconnects; `pagehide` flushes the local cache.
- The local workspace context (`context/workspace/`) remains a client
  projection with `Persist` as an offline cache, never authoritative.

### 5.4.1 Layout authority handover (implemented)

The host hands layout authority to the last client that pulls a layout tuple:

- `layout.get` accepts a `clientID` and claims authority for it (upserted per
  `(workspace, user, style, deviceClass)` in `layout_authority`).
- `layout.save` accepts the same `clientID`; a save from a client that no
  longer holds authority is rejected with `{ status: "handed-over",
currentRevision }` (`LayoutHandedOverError` in core).
- The handed-over client re-pulls (re-claiming authority), adopts the latest
  layout, surfaces a notice, and re-pushes its settled state (explicit retry,
  last-write-wins). Same-holder revision mismatches still report
  `{ status: "conflict", currentRevision }`.
- Migration: `20260815_layout_authority`; core tests in
  `packages/core/test/workspace-handover.test.ts`.

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

| Dimension | Values          | Source                          |
| --------- | --------------- | ------------------------------- | ---------------------------- | --------------- |
| user      | server identity | ServerAuth / account            |
| style     | named style id  | workspace.style (user-editable) |
| device    | class: `desktop | mobile                          | tablet`, optional `deviceID` | client-reported |

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

## 10. OperatingAgent and Session context assembly

The **OperatingAgent** is the model configured by `workspace.operatingAgent`.
Each `builtin:operating-chat-session` block has one host-owned
FunctionalityInstance and one durable SessionV2 binding configured to use that
model. Session IDs, transcript state, prompt queues, context sidecars, and
binding revisions never enter layout or browser local-view state.

The earlier five-layer browser `OperatingContext` stack is retired as an
architecture. A block subsystem does not build or own a second prompt history.
SessionV2 is the only provider-context assembler and combines four existing
OpenCode channels:

| Channel | Authority | Model behavior |
| --- | --- | --- |
| Stable system baseline | `session_context_epoch` and System Context sources | Reused byte-for-byte until epoch replacement |
| Active conversation | SessionV2 messages/events | Replayed in chronological order with tool calls/results |
| Turn-specific context | Versioned `session_input.context_snapshot_json` sidecar | Explicit and bounded automatic CtxPack material attached to the admitted user turn |
| Older work | Existing SessionV2 compaction plus private message sidecar | Model-facing enriched summary/recent; public event stays clean |

This is an approved future extension of the implemented OperatingChat binding.
Its detailed contract and implementation sequence are:

- [OperatingChat Session Context Assembly Design](../../docs/superpowers/specs/2026-08-25-operating-chat-context-assembly-design.md)
- [OperatingChat Context Assembly Parallel Implementation Plan](../../docs/superpowers/plans/2026-08-25-operating-chat-context-assembly.md)

### 10.1 Implemented binding and model behavior

- `packages/core/src/workspace/operating-chat-session.ts` owns idempotent
  ensure and revision-guarded reset, configures the Session from
  `workspace.operatingAgent`, and never falls back to `workspace.model`.
- The public schema, protocol group, server handlers, and generated clients
  expose get/ensure/reset under the workspace-scoped OperatingChat routes.
- `packages/app/src/pages/canvas/runtime/registrations/operating-chat.ts`
  resolves the durable binding. `OperatingChatBody` renders the reusable
  `CanvasSessionSurface`, so prompting, steering, queueing, interruption,
  durable history, reconnect, and compaction use ordinary Session V2 behavior.
- Two OperatingChat blocks own distinct Sessions while sharing the workspace's
  selected OperatingAgent model policy.

Model selection is wired UI → backend (see `manager.ts`):

- Schema: `Workspace.Info.operatingAgent` (the OperatingAgent model key) and
  `Workspace.Info.model` (the frontend model) — both optional strings.
- Storage: `operating_agent` and `model` columns on `workspace_v2`
  (migrations `20260816044418_add-workspace-operating-agent`,
  `20260816060000_add-workspace-model`); protocol patch fields; JS SDK
  regenerated (Node-based `packages/sdk/js/script/build.ts`).
- Client: on connect the manager loads both keys. The top-bar Model picker
  writes `workspace.model` for MasterAgent coordination; the OperatingChat
  block has a separate searchable OperatingAgent picker that writes
  `workspace.operatingAgent`. Mutations adopt authoritative responses, ignore
  stale completions, and roll back the latest rejected request.

### 10.2 Approved context target

The Session runner will derive a session-aware OperatingChat profile from the
existing live FunctionalityInstance binding. No target table or layout field is
added. The App carries only an internal context-target projection so the
existing explicit CtxPack endpoint creates a capsule for the real instance;
Core reruns the authoritative lookup and revalidates the complete Session
workspace/location/directory plus binding generation/revision proof
independently.
The profile contributes workspace/block/instance
identity and OperatingAgent policy to the Session's System Context; the
Location-scoped registry remains argument-free so identity cannot leak between
two Sessions in one Location.

On first prompt admission, explicit CtxPack attachments materialize first.
Non-trivial OperatingChat turns also run a deterministic, workspace-scoped FTS
recall. Automatic results fill only the remaining attachment and token budget,
are capability/sensitivity filtered by a non-persisting recall reader, and are
selected once from a fixed scan of at most 16 candidates. They do not create
automatic ContextCapsule rows. The final
rendered wrapper and provenance count against the byte/token budget; explicit
overflow rejects and automatic overflow trims the ranked tail. Exact retries
reuse the stored result and never search again.

The clean user message stays in `session_message`. A backward-compatible V2
sidecar stores the exact canonical model-facing user text, a hash and renderer
version, explicit/automatic provenance, and sanitized recall metadata. Later
turns replay those exact stored bytes while the browser continues to render
only what the user typed.

System identity, environment, instructions, agent prompt, skill guidance, and
references are folded into the existing Context Epoch. Selected-agent and
OperatingChat-profile sources are replacement-only: their private snapshot
remains frozen within an epoch, emits no public chronological update, and a
change installs a fresh private epoch at the next safe provider-turn boundary.
Compaction may also replace the epoch. Other existing context
sources retain their chronological behavior. The existing compactor receives enriched user text for a private
`session_message.model_context_json` summary/recent sidecar before older turns
leave active history. The public compaction event keeps a fixed sentinel and
clean recent serialization, while the complete transcript and sidecars remain
durable.

Required V2 input is marked in the content-free admission event, while exact
input/compaction bytes and the active Context Epoch remain private SQLite
state. A versioned `SessionProjectionTransfer` bundle preserves that state for
empty-destination import and same-workspace host sync. An existing EventV2 row
with a missing projected target remains a typed defect unless the same frozen
snapshot contains a later authoritative revert that deterministically deletes
that exact target; a missing row alone is not proof. A retained revert with a
still-present target is the inverse projection defect and is never silently
replayed. Network transfer requires a
configured valid host credential over HTTPS, literal `127.0.0.0/8`/`::1`, or an
equivalent confidential transport; private requests never follow redirects.
Repair discovers at most 128 Session aggregates per batch. Every serialized
page is at most 512 KiB and carries at most 256 complete public events or 64
chunks for one oversized public/private record; both forms spool and apply atomically.
`/global/event` carries only an authenticated, version-negotiated wake hint for
the history pull. V2 private admission is not activated until every managed
peer has negotiated transfer v1. Peer attachment unions the content-free
transfer-required result—any V1/V2 input sidecar, pending marker, private
checkpoint, Context Epoch, or retained durable V2 marker/private-sentinel event,
including one later reverted—from self and every drained worker. Managed
mixed-version placement rejects explicit attachments; only local/no-sync keeps
V1 explicit compatibility. Phase 1 rejects every Session workspace/location
warp unconditionally before final sync, prompt cancellation, replay, claim, or
filesystem mutation. The
existing experimental sync HttpApi and legacy SDK carry this administrator
transport; the Promise/Effect clients reflect only the content-free public
marker, and no browser Session/composer contract gains private content.

There is no new memory-file format, vector index, context database, browser
store, public prompt API, or OperatingChat-specific compressor.

## 11. ChatRelay session bridge

**ChatRelay** (`builtin:chat-relay`) is a native runtime registration, not a
browser-owned pseudo transport. It resolves one server-owned SessionV2 binding
through `workspace.chatRelay.ensure`, invalidates/refetches that binding from
the shared context event router, and renders `CanvasSessionSurface`.

SessionV2 owns prompts, queue/steer, transcript, tools, permissions,
interruption, and recovery. The canvas manager performs no ChatRelay-specific
binding synchronization, polling, or local transcript work. The removed
ChatProxy UI/API/worker path is historical; dormant payload rows and browser
profiles follow the one-release retention rule in
`../relay/chat-relay-session-migration.md`.

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

## 13. Runtime: Node.js

The backend and project tooling are Node.js-first (revised from Bun):

- **Runtime is Bun-API-free.** `Bun.stringWidth` replaced by
  `@opencode-ai/core/util/string-width` (wcwidth table, parity-tested against
  Bun), `Bun.stdin.text()` by `@opencode-ai/core/util/stdin`, `Bun.hash` by
  `node:crypto`, tui persistence/stats by `node:fs`/global `fetch`. The
  `#sqlite`/`#db` conditional imports resolve `node:sqlite` under Node.
- **Scripts run under Node**: `packages/script` (fs helpers + `FileRef`
  polyfill for the old `Bun.file` object surface), core migration generator
  (also fixes the Windows path bug), SDK regeneration
  (`packages/sdk/js/script/build.ts`, verified end-to-end via
  `node script/build.ts`), ui/plugin/cli/console/desktop/containers/llm/
  http-recorder scripts. `bin/opencode` is a Node shim.
- Remaining bun-scoped pieces (intentional): `bun:test` test suites,
  `Bun.build` release/binary-compile pipelines, bun test-orchestration
  scripts, and the CLI's TS entrypoint (tsconfig path aliases).
- Dev defaults: UI dev on port 3000, backend dev on port 3001 (configurable
  via `VITE_OPENCODE_SERVER_HOST`/`VITE_OPENCODE_SERVER_PORT`).
