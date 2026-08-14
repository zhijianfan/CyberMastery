# Workspace Canvas — Requirements & Design

Branch: `feature/UnrealViewer`
Status: draft for review

## 1. Overview

OpenCode's UI becomes a workspace-canvas application. The **Workspace** is the
outermost container in the product: it owns layouts, directories, plugins, skills,
and git repository tracking. The host server stores workspaces; any client viewer
loads them. The page consists of a single top bar plus one full-page **panel** in
which user-defined **blocks** (squares that render a functionality) are arranged on
a snapping canvas. A **layout** stores only block transforms and references to
functionalities — never block content.

## 2. Terminology

| Term            | Meaning                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| Workspace       | Outermost container: named entity owning layouts, directories, plugins, skills, git tracking |
| Host            | The OpenCode server instance that owns durable storage (sidecar or remote)     |
| Client viewer   | The web/desktop UI that loads and renders a workspace                          |
| Top bar         | Single horizontal bar at the top of the page                                   |
| Panel           | The remaining viewport area, entirely blank except for blocks                  |
| Block           | A square region inside the panel that renders one functionality's content      |
| Functionality   | A registered kind of content a block can render (chat, terminal, file tree, viewer, …) |
| Layout          | Ordered set of block records: `{ id, functionality ref, transform }`           |
| Editing mode    | Panel state in which blocks can be added, resized, moved, snapped              |
| Environment     | Workspace preset governing functionality availability (per `ImplementationPlan` ADR-2) |
| Style           | Visual/density/layout preference used in layout resolution (per ADR-2)         |
| Device          | A client device class or specific device used to key layout storage            |

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
  bar: workspace switcher, workspace name (editable), environment/style selector,
  and editing-mode toggle.
- **FR-10** All other OpenCode default interactable UI elements move to the right
  side of the top bar: server/connection status, model selector, agent selector,
  theme, notifications, settings, help.
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
- **FR-23** The default layout is a single block occupying the entire panel,
  rendering the default agentic chat window.
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
3. **"Style" vs "Environment"**: split per `ImplementationPlan` ADR-2 —
   `environment` is the workspace preset and functionality availability;
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
   v1 blocks? **Resolved**: v1 built-ins are `builtin:chat`,
   `builtin:online-search`, `builtin:screenshot-browser`,
   `builtin:application-window-stream`; legacy panels migrate incrementally
   (see §5.2).
3. **Skills as blocks vs enablements** — do skills appear as blocks, or only as
   workspace config consumed by agent/chat blocks? Proposal: config only.
   **Resolved**: config only (FR-14, §5.2).
4. **"Style" definition** — is style a theme, a density, the environment preset,
   or a combination? Needs product decision. **Resolved**: split into
   `environment` (preset + functionality availability) and `style`
   (visual/density/layout preference) per `ImplementationPlan` ADR-2.
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
