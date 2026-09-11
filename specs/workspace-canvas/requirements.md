# Workspace Canvas — Requirements & Design

Branch: `feature/UnrealViewer`
Status: historical canvas draft with implemented resolutions; OperatingChat
context requirements §3.7 approved for future implementation on 2026-08-25

## 1. Overview

OpenCode's UI becomes a workspace-canvas application. The **Workspace** is the
outermost container in the product: it owns layouts, directories, plugins, skills,
and git repository tracking. The host server stores workspaces; any client viewer
loads them. The page consists of a single top bar plus one full-page **panel** in
which user-defined **blocks** (squares that render a functionality) are arranged on
a snapping canvas. A **layout** stores only block transforms and references to
functionalities — never block content.

## 2. Terminology

| Term             | Meaning                                                                                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace        | Outermost container: named entity owning layouts, directories, plugins, skills, git tracking                                                                                                                                      |
| Host             | The OpenCode server instance that owns durable storage (sidecar or remote)                                                                                                                                                        |
| Client viewer    | The web/desktop UI that loads and renders a workspace                                                                                                                                                                             |
| Top bar          | Single horizontal bar at the top of the page                                                                                                                                                                                      |
| Panel            | The remaining viewport area, entirely blank except for blocks                                                                                                                                                                     |
| Block            | A square region inside the panel that renders one functionality's content                                                                                                                                                         |
| Functionality    | A registered kind of content a block can render (chat, terminal, file tree, viewer, …)                                                                                                                                            |
| Layout           | Ordered set of block records: `{ id, functionality ref, transform }`; the workspace's block arrangement, which also governs functionality availability (replaces the former _Environment_ preset, per `ImplementationPlan` ADR-2) |
| Editing mode     | Panel state in which blocks can be added, resized, moved, snapped                                                                                                                                                                 |
| Style            | Visual/density/layout preference used in layout resolution (per ADR-2)                                                                                                                                                            |
| Device           | A client device class or specific device used to key layout storage                                                                                                                                                               |
| OperatingAgent   | The model configured per workspace for its OperatingChat SessionV2 bindings                                                                                                                                                       |
| OperatingContext | The model-visible request assembled by SessionV2 from a Context Epoch baseline, active history, admitted turn sidecars, compaction, and tools                                                                                         |
| BlockSubsystem   | The functionality/domain behind a block; contributes typed identity, data, or context references but does not own a second transcript or prompt assembler                                                                            |
| Pseudo block     | A block whose functionality reroutes to an external service (e.g. ChatRelay)                                                                                                                                                      |

## 3. Functional requirements

### 3.1 Workspace as outermost container

- **FR-1** A workspace is a named entity with a stable id.
- **FR-2** A workspace contains, in this nesting order:
  - layouts (one or more; see §3.5)
  - directories (one or more project directories)
  - plugins (a selection of enabled plugins)
  - skills (a selection of enabled skills)
  - git repository tracking (per directory or workspace-wide; see §8.7)
- **FR-3** Workspaces support create, rename, delete, duplicate, and activate.
- **FR-4** The workspace supersedes the current project concept: project selection
  UI is disabled; all navigation starts from the workspace.

### 3.2 Host storage & client loading

- **FR-5** The workspace record, its layouts, and all layout options are stored on
  the host server, not in client local storage.
- **FR-6** A client viewer can list workspaces and load a workspace by id; the load
  response contains the workspace record plus the layout resolved for this
  (user, style, device) tuple.
- **FR-7** Layout mutations are write-through to the host. Clients hold a
  lightweight cache for offline rendering, but the host is authoritative.
- **FR-8** Workspace data is scoped per user (see §8.2 for identity).

### 3.3 Top bar arrangement

- **FR-9** Workspace configuration is arranged horizontally at the left of the top
  bar: workspace switcher, workspace name (editable), layout/style selector,
  and editing-mode toggle.
- **FR-10** All other OpenCode default interactable UI elements move to the right
  side of the top bar: server/connection status, model selector, agent selector,
  theme, notifications, settings, help. The model selector configures the
  workspace's OperatingAgent model.
- **FR-11** The top bar is a single row on desktop; it must degrade gracefully on
  narrow screens (overflow menu) — behavior per device class TBD (§8.6).

### 3.4 Panel and blocks

- **FR-12** Everything below the top bar is one blank panel. No home screen, no
  sidebar, no dock by default; all content lives inside blocks.
- **FR-13** A block is initially square (width = height). It renders exactly one
  functionality's content inside its bounds.
- **FR-14** Blocks can be added from a functionality palette; the palette lists
  built-in functionalities plus workspace-enabled plugin functionalities
  (skills are enablements, not blocks — see §5.2).
- **FR-15** Blocks are resizable, movable, and snap to a grid when edited
  (FR-16). Snap behavior: cells, min/max sizes, collision rules (§8.7).
  The panel is **not scrollable** — the canvas always fits the viewport —
  and empty packing strips of 5% of the panel are reserved on the left and
  right sides; blocks cannot be placed or resized into the packing.
- **FR-17** Blocks have a z-order; overlapping is only allowed in editing mode and
  resolves to a deterministic order on exit (§8.7).
- **FR-18** Block content is live: each block renders its functionality against
  the active workspace scope (directories, plugins, skills).
- **FR-19** A block carries no content state of its own. All state lives in the
  functionality's backing data (sessions, terminals, files, …) which survives
  layout changes.

### 3.5 Layouts

- **FR-20** A layout stores only block records: `{ id, functionality, transform }`
  where transform = `{ x, y, w, h, z }` in panel grid units.
- **FR-21** The layout contains no block content, no sessions, no view state.
- **FR-22** Layouts are versioned (revision number) so clients can detect staleness.
- **FR-23** The default layout is empty. Users add registered blocks from the
  palette; the canvas does not create a pinned OpenCode fallback block.
- **FR-24** The host stores layout options **per user, per style, per device**
  (§8.4 for the precise tuple).

### 3.6 Editing mode

- **FR-25** Editing mode is toggled from the top bar. In editing mode the panel
  shows the grid, block outlines, and handles.
- **FR-26** In editing mode blocks can be: added (palette), resized (corner/edge
  handles), moved (drag), snapped (to grid cells), and removed.
- **FR-27** Leaving editing mode persists the resulting layout to the host for the
  current (user, style, device) tuple.
- **FR-28** Outside editing mode, blocks render content and ignore transform
  gestures.

### 3.7 OperatingAgent context assembly

- **FR-29** Each `builtin:operating-chat-session` block owns one durable
  SessionV2 binding through its host FunctionalityInstance. The block and
  browser do not own a parallel transcript or context stack.
- **FR-30** SessionV2 derives OperatingChat workspace, block, functionality,
  instance, generation, revision, directory, and model-policy identity from the
  existing live server binding. The browser may project that target only to
  materialize an explicit capsule; it cannot nominate admission authority.
- **FR-31** The selected agent instruction, OperatingChat host identity,
  environment, project instructions, skills, and references participate in the
  existing Context Epoch. Its cached baseline remains byte-stable until a
  defined epoch replacement.
- **FR-32** The visible Session transcript stores the user's original text. Any
  host-injected context is stored in a private, immutable, versioned input
  sidecar rather than rewriting that message.
- **FR-33** The model-facing sidecar records the exact canonical user text sent
  to the provider layer, its hash and renderer version, CtxPack provenance, and
  sanitized recall metadata.
- **FR-34** The OperatingChat composer retains explicit CtxPack attachments.
  Non-trivial OperatingChat turns also receive automatic workspace-scoped
  CtxPack recall. Generic SessionV2 turns do not receive automatic recall.
- **FR-35** Explicit attachments have priority and fail admission when invalid.
  Automatic candidates fill only the remaining count/byte/token budget and may
  be omitted on recall failure. The final rendered envelope, including wrapper
  and provenance, is the budget authority; auto overflow drops ranked tail
  candidates while explicit overflow rejects.
- **FR-36** Automatic recall is deterministic, permission-filtered, sensitivity-
  aware, deletion-aware, content-hash checked, scans at most 16 fixed-policy
  candidates, and selects at most four packs/eight combined attachments. It
  reads immutable fragments without creating a durable ContextCapsule row.
- **FR-37** Recall runs only on first durable admission. An exact same-message-ID
  retry reuses its stored sidecar without search or materialization; changed
  explicit capsule/pack identity, content hash, or label conflicts. Concurrent
  contenders reload/validate the winner, and only the invocation that committed
  the event records CtxPack usage.
- **FR-38** Every later active provider turn replays the exact stored model-facing
  content for enriched historical user messages while public projections remain
  clean.
- **FR-39** Tool calls and tool results remain ordinary SessionV2 history and are
  included in the same provider-context loop. No second operation queue or tool
  loop is introduced.
- **FR-40** Existing SessionV2 compaction consumes enriched historical user
  content in a private message sidecar, keeps its public durable event free of
  recalled fragments, and never deletes the underlying messages, inputs,
  sidecars, or events.
- **FR-41** OperatingChat admission reruns the authoritative lookup and
  revalidates the full Session workspace/location/directory plus binding
  instance/generation/revision proof inside the admission event transaction. A
  concurrent reset/reconfiguration, move/warp, or binding acquired after generic
  resolution cannot commit a sidecar under stale authority.
- **FR-42** Missing actor identity disables automatic recall with sanitized
  unavailable state and never synthesizes a user; explicit selection still
  fails closed. An established generic composer uses
  `chat-instance:<sessionID>`/`builtin:chat`, and a no-Session composer disables
  CtxPack drop.
- **FR-43** Every V2 admission publishes only a content-free requiredness marker
  and atomically replaces its projected pending slot with the private sidecar.
  Pending inputs and private compaction sentinels fail closed when their payload
  is missing or corrupt.
- **FR-44** Empty-destination import and same-workspace host sync use one typed,
  versioned private-transfer bundle for input/compaction sidecars and the active
  Context Epoch. Network transfer requires a configured valid host credential;
  private repair discovers at most 128 aggregates per batch. Every serialized
  source-high-water page is at most 512 KiB and carries at most 256 complete
  public events or 64 chunks for one oversized public/private record; both forms
  spool and apply atomically. Public global events contain no
  bundle and expose coalesced sync hints only after authenticated
  transfer-version negotiation. V2 private admission is disabled until all
  managed peers negotiate v1; topology/capability changes
  invalidate the revisioned readiness proof before admission commit. A
  non-v1 peer cannot join after self or any drained worker reports a non-null
  V1/V2 input sidecar, pending marker, private checkpoint, Context Epoch, or
  retained durable V2 marker/private-sentinel event, including one later reverted.
  Managed mixed-version placement rejects explicit attachments; only strictly
  local/no-sync placement may retain a V1 explicit snapshot. Phase 1 rejects
  every Session workspace/location warp unconditionally before final sync,
  prompt cancellation, replay, claim, or filesystem change.
  An existing EventV2 row with a missing projected target returns a typed
  projection defect unless the same frozen snapshot proves a later
  authoritative revert intentionally deleted that exact target; this feature
  does not provide arbitrary re-projection. A retained revert with a still-
  present target is also a defect and cannot authorize implicit projector replay.

## 4. Non-functional requirements

- **NFR-1** Layout load for the default tuple must be fast (< 300 ms p95 over local
  host); layout save is best-effort within 1 s.
- **NFR-2** Host storage survives server restarts; SQLite is acceptable for a
  single-tenant host (see architecture doc).
- **NFR-3** The panel must render ≥ 12 blocks at 60 fps on a mid-range device.
- **NFR-4** Offline: viewer may render the last cached layout read-only; edits made
  offline fail explicitly (no silent divergence).
- **NFR-5** Layout payloads are small (< 10 KB for 100 blocks) and versioned for
  cheap cache validation.
- **NFR-6** Accessibility: blocks are keyboard focusable and navigable; editing
  gestures have keyboard equivalents (arrow nudge, shift-resize).
- **NFR-7** Security: functionality references in layouts are validated against
  the workspace's enabled functionalities; unknown refs render an error block.
- **NFR-8** Recalled text, raw recall queries, model-facing sidecar content,
  selected-agent instructions, and OperatingChat binding/path policy
  never appear in layout JSON, browser persistence, events, ordinary logs, or
  error payloads. Admitted/compacted bytes cross hosts only through the existing
  versioned administrator sync transport with a configured valid host
  credential over HTTPS, literal `127.0.0.0/8`/`::1`, or an equivalent
  confidential channel; redirects and an otherwise-open or non-loopback plain-
  HTTP listener cannot negotiate it, and
  raw queries never cross it.
- **NFR-9** The same admitted Session input produces byte-identical canonical
  model-facing user text after a server restart.
- **NFR-10** Automatic recall adds no network round trip from the browser and no
  auxiliary model call; it uses the host's existing SQLite FTS index.
- **NFR-11** One strict decoder recomputes each input/compaction sidecar's
  canonical hashes, UTF-8 byte length, and token estimate at every authority
  read. Malformed or valid-shape tampered state fails the provider turn,
  compactor, export, and restore explicitly rather than silently dropping or
  recomputing context.
- **NFR-12** Failed or unavailable automatic recall leaves no orphan
  ContextCapsule rows.
- **NFR-13** A stale browser context-target projection cannot override the
  server-resolved OperatingChat profile.
- **NFR-14** Private-state history export is workspace-scoped and snapshot-
  consistent. Restore validates complete event identity/data hash, target,
  schema, and payload hash; duplicates are idempotent and conflicts fail closed.

## 5. Proposed design resolutions (draft defaults)

These are working assumptions — each maps to an ambiguity in §8.

1. **Block shape**: square by default (1:1 at creation), free rectangle after
   resize; "square block" is interpreted as the initial shape, not a hard
   constraint.
2. **Functionality registry**: namespaced IDs (`builtin:*`, `plugin:*`). The v1
   built-in set is `builtin:chat`, `builtin:online-search`,
   `builtin:screenshot-browser`, `builtin:application-window-stream` (see the
   functionality subsystem architecture); existing panels (terminal, file tree,
   diff, todos, viewer) migrate to the same interface incrementally. Skills are
   not blocks — they are workspace-scoped enablements consumed by blocks.
3. **"Style" vs "Layout"**: per `ImplementationPlan` ADR-2 —
   `layout` is the workspace's block arrangement, which governs its
   functionality availability (replaces the former `environment` preset);
   `style` is the visual/density/layout preference used in layout resolution.
   The storage tuple is (user, style, deviceClass); `deviceID` is deferred
   unless a per-machine restore requirement is approved (ADR-3).
4. **Default layout**: created lazily on first load of any tuple; chat block
   binds to the workspace's primary directory (first directory listed).
5. **Sessions**: remain directory-scoped; a chat block without a chosen session
   renders the most recent session of its bound directory (see §8.8).

## 6. Out of scope (v1)

- Multi-user collaborative editing of one layout.
- Remote/streamed rendering of exotic functionalities (e.g. full Unreal editor).
- Block-level theming beyond the style dimension.
- Migration of legacy project UI state into workspaces.
- Hermes memory/profile files, a second session database, or another execution
  backend.
- Vector/embedding retrieval and model-based recall reranking.
- A browser-owned OperatingContext or HistoricalContextStack.
- ChatRelay-to-OperatingAgent event forwarding.

## 7. Acceptance criteria (summary)

1. A workspace can be created, named, stored on the host, reloaded in a fresh
   client, and shows its directories/plugins/skills/git state.
2. The top bar matches §3.3: workspace config left, all other controls right.
3. Below the bar is a blank panel; the default layout shows one full-panel chat
   block.
4. In editing mode, blocks add/resize/move/snap; exiting persists a layout
   containing only transforms and functionality refs.
5. Layout options resolve per (user, style, device); changing device or style
   yields that tuple's layout, defaulting to the full-panel chat when absent.
6. OperatingChat keeps one clean SessionV2 transcript while an enriched turn
   replays exact canonical model-facing content after reload.
7. Explicit and automatic CtxPack context is bounded, authorized, immutable at
   admission, and absent from browser/layout/event storage.
8. Same-ID exact retry performs no second recall; changed explicit context
   conflicts.
9. Generic Sessions do not gain automatic recall.
10. Compaction preserves enriched facts in its checkpoint without deleting the
    complete durable Session history.
11. Empty-destination import and same-workspace host sync preserve sidecars plus
    the active epoch without exposing them in public events, including atomic
    import of intentionally reverted targets through validated content-free
    deletion proofs; every Session
    workspace/location warp fails before side effects in phase 1.

## 8. Ambiguities & missing items

This list is the requested deliverable for review. Items marked **Resolved**
track decisions in the functionality subsystem architecture
(`../functionality-subsystem-management-architecture.md`) or
`architecture.md`.

1. **Square vs rectangle** — is a block permanently square (aspect locked) or
   only square at creation? Proposal: square at creation, free resize after.
   **Resolved**: each functionality manifest declares
   `constraints.initialAspect` and `min/max` sizes; blocks are square at
   creation, free-resize after.
2. **Functionality inventory** — the exact built-in list is undefined. Which
   existing panels (terminal, file tree, diff, todos, images, viewer) are
   v1 blocks? **Resolved**: the Canvas starts empty and exposes registered,
   renderer-backed blocks from the palette. The retired `builtin:chat` remains
   a compatibility registry entry but is ignored during Canvas hydration;
   legacy panels migrate incrementally (see §5.2).
3. **Skills as blocks vs enablements** — do skills appear as blocks, or only as
   workspace config consumed by agent/chat blocks? Proposal: config only.
   **Resolved**: config only (FR-14, §5.2).
4. **"Style" definition** — is style a theme, a density, the layout preset,
   or a combination? Needs product decision. **Resolved**: split into
   `layout` (block arrangement → functionality availability; replaces the
   former `environment` preset) and `style` (visual/density/layout
   preference) per `ImplementationPlan` ADR-2.
5. **Device granularity** — class only (desktop/mobile/tablet), or also specific
   device ids (to restore per-machine layouts)? Class-only loses per-machine
   arrangements; device-id keying complicates the tuple and precedence.
   **Resolved for v1**: required tuple is
   `(workspace, user, style, deviceClass)`; `deviceID` deferred per ADR-3.
6. **User identity** — self-hosted OpenCode currently uses a single basic-auth
   username; cloud uses accounts. What identifies "user" for per-user storage?
   What happens for anonymous/local instances? **Resolved**: authenticated
   username (self-host), account user ID (account deployments), reserved
   `default` identity for local anonymous mode per ADR-4.
7. **Git tracking scope** — per directory or workspace-level? What is tracked
   (branches, status, remotes, dirty set) and how is it rendered (which block)?
8. **Chat block session binding** — does a block instance reference a session
   (conflicts with FR-19/FR-20) or does the chat block choose a session at
   runtime (directory + most-recent)? Proposal: runtime resolution, session id
   never stored in layout. **Resolved**: runtime resolution per the chat
   instance configuration (`sessionBinding` / `directoryBinding`); the session
   ID is never stored in layout data.
9. **Multiple directories & sessions** — how does a workspace with N directories
   map to chat blocks (one chat per directory, or a directory switch inside one
   block)? Block-per-directory needs a directory binding, which is content state.
   **Resolved**: directory binding lives in the functionality instance
   (`workspace-primary` or `fixed` directory), not in the layout.
10. **Editing rights** — which users may edit layouts (owner only vs any
    workspace member)? What is "member" for self-hosted? **Resolved**: the
    capability model (`read` / `write` / `execute`) governs layout and
    instance mutations; the host enforces it.
11. **Concurrent edits** — last-write-wins per layout, or per-block merge? Is
    multi-device live sync (SSE) needed in v1 or is load-on-navigation enough?
    **Resolved**: revision-checked last-write-wins on explicit retry (layouts)
    and revision-conflict errors for instance configuration; live SSE push is
    designed but deferred.
12. **Legacy surfaces** — are `/` (home) and `/:dir/session/:id` routes removed,
    redirected, or reachable via blocks only? What happens to the existing
    workspace sidebar (git worktrees) — naming collision with "Workspace".
13. **Snap details** — grid cell size, min/max block sizes, whether overlap is
    allowed, z-order persistence, resize snapping to multiples.
14. **Panel scale** — do blocks scale with viewport (percentage) or stay in
    fixed grid units with scroll? Per-device layouts partially answer this but
    the unit system is undefined.
15. **Block content lifecycle** — are non-visible blocks kept mounted (live),
    suspended, or recreated on view? Memory bound for 12+ blocks (terminals,
    viewers) is undefined. **Resolved**: per-manifest lifecycle policy
    (`clientWhenHidden`, `hostWhenNoViewers`) with a keep-alive matrix; host
    work survives block unmount unless cancelled explicitly.
16. **Offline semantics** — read-only cache vs queued edits; NFR-4 assumes
    read-only — confirm. **Resolved**: read-only cached layout; host-backed
    writes fail explicitly offline; no generic offline command queue in v1.
17. **Top bar overflow** — behavior on narrow/mobile widths for FR-10 controls.
18. **Functionality parameters** — blocks reference a functionality by id; do
    block instances carry parameters (e.g. "terminal:dir=…")? If yes, that must
    be part of the layout record and included in FR-20's "reference".
    **Resolved**: parameters live in a separate revisioned
    **functionality instance** keyed by `(workspace, block, functionality)`;
    layouts still contain only IDs and transforms (FR-20 unchanged).
19. **UnrealViewer specifics** — what does the viewer block render in a web
    client (native content, streamed viewport, static preview)? This is the
    namesake feature and currently undefined. **Partially resolved**: the
    `builtin:application-window-stream` block and backend interface are
    stabilized as an honest placeholder; the capture/transport backend remains
    undefined.
20. **Deleted entities** — what renders when a block's functionality, plugin,
    or directory is removed (error block, auto-remove on next edit)?
    **Resolved**: blocks render missing/disabled/unavailable/permission-denied
    states with a replace affordance; removed plugins invalidate their
    functionality refs and grants without destroying user data.
