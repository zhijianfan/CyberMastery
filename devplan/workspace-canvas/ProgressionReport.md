# Progression Report — Agent Canvas (feature/UnrealViewer)

Status: in progress · last updated 2026-08-16

This report tracks what has been implemented, in what order, on the
`feature/UnrealViewer` branch. Design docs aligned with this state:
[UIDesign.md](./UIDesign.md) (§8–9), [workspace-canvas/architecture.md](./workspace-canvas/architecture.md)
(§5–§13).

## 1. Canvas workspace UI (frontend)

- **Agent Canvas shell** — `packages/app/src/pages/canvas/workspace.tsx`:
  infinite dotted canvas, pan/zoom camera, glass cards, pastel accents,
  floating toolbar, block bar (two-button palette + add), zoom/status pills,
  toasts, dark mode via app theme. Art style in `canvas.css` (backdrop-filter
  disabled mid-drag for paint cost on non-accelerated machines).
- **Legacy opencode UI as an unremovable block** — the routed session UI
  renders inside a pinned `builtin:chat` block: no close, no collapse, always
  created, auto-fits the panel until moved. The old v2 titlebar was removed;
  its portaled controls moved into the canvas toolbar.
- **Standalone UI + communication manager split** — `manager.ts` owns all
  backend communication (layout sync, revision/authority, OperatingAgent/
  model, permission config, server events); `workspace.tsx` is a pure
  renderer that receives server-authoritative state via callbacks/signals
  and reports local edits back.
- **Gestures** — click selects/raises; move/resize/collapse are editing-mode
  only; snap on release; left/right-button pan with cursor-locked camera;
  wheel zoom (native scroll preserved inside scrollable content); double-
  click/tap adds a scratchpad in editing mode.

## 2. Layout storage & sync (backend + frontend)

- **Server-authoritative at connect** — `workspace.layout.get(tuple, clientID)`
  hydrates the client; the pull also claims layout authority.
- **Client-authoritative after connect** — block edits update the client
  immediately; a debounced (160ms) `layout.save(expectedRevision)` pushes the
  settled state. Camera/editing never sync.
- **Authority handover** — `layout_authority` table; saves from a non-holder
  return `handed-over`; the client re-pulls (re-claiming), adopts, and
  re-pushes (last-write-wins). Conflicts = server wins via re-pull.
- **Realtime fan-out** — saves publish the transient `workspace.layout.updated`
  event (`EventV2` → SSE); other clients re-pull and adopt live, no refresh.
- **DEV-mode offline authority** — dev edits while disconnected make the
  client authoritative; reconnect pushes instead of pulling. Boot-time
  hydration never counts as an edit.
- **Storage tables** — `workspace_v2` (+`operating_agent`, `model`),
  `layout`, `layout_option`, `layout_authority`; migrations
  `20260814_workspace_canvas`, `20260815_layout_authority`,
  `20260816044418_add-workspace-operating-agent`,
  `20260816060000_add-workspace-model`.

## 3. OperatingAgent & models

- Workspace-scoped `operatingAgent` (OperatingAgent model) and `model`
  (frontend model) fields end-to-end: schema → SQL → service → protocol →
  regenerated SDK.
- OperatingChat block: OperatingContext stack (5 layers), indexed
  HistoricalContextStack with compaction, model picker (connected providers,
  searchable) writing through `workspace.update`. Submission to the model is
  still stubbed.
- Permission gating: ChatRelay gated on `webfetch`/`websearch`,
  OperatingChat on `task`, via a client mirror of the server's
  `PermissionConfig` normalization (`"deny"` ⇒ `{"*": "deny"}`).

## 4. Project config

- Canvas loads the project config via the directory-scoped SDK; when no
  permission config exists it creates one with ALL permissions denied.
- `config.updated` server events reload + re-gate blocks live.

## 5. Transform storage & rendering robustness

Timeline of fixes driven by live testing:

1. `<For>` (reference-keyed) recreated card DOM mid-gesture → switched to
   in-place rendering with stable nodes.
2. Grid snapping applied per pointermove made drags feel frozen → continuous
   tracking, snap once on release.
3. The render loop proved unreliable for mid-gesture updates → transforms
   owned by a `createEffect` that re-applies store rects to the DOM; the
   render never writes rects. All mutation paths (drag/resize/snap/z/tidy/
   reset/server-pull/add/remove) reconcile through one DOM-sync helper, and
   rect-only store updates mutate in place so card bodies (incl. the routed
   session UI) never re-render during drags — this removed the memory/
   crash-level churn.
4. Drag-start rects read from the live store (`liveRect`), not render
   closures, killing stale-position jumps.
5. **Pan amplification bug (root-caused)** — `panSession.camera = state.camera`
   captured a live Solid store proxy; `setState` shallow-merges into the same
   object, so each move computed `Cᵢ = Cᵢ₋₁ + Dᵢ` (integrating displacement,
   ~(n+1)/2× amplification with direction inversions). Fixed with frozen
   `snapshotCamera()` bases for every gesture. Diagnosed via the dev pan
   pipeline (`/__canvas-pan-debug` → `.test-data/canvas-pan-debug.jsonl`,
   diagnosis in `pan-diagnosis-prompt.md`).
6. Listener stacking across HMR eliminated structurally: pointer handlers are
   Solid JSX props on the viewport element (one listener per node), plus
   module-level `import.meta.hot.dispose` cleanup for window listeners.
7. Camera persistence debounced separately (800ms) to keep localStorage out
   of the pan hot path.

## 6. Functionality alignment

- Client block types map to registered `builtin:*` functionality ids; the
  server registry lists every client type (NFR-7-ready). Legacy block owns
  `builtin:chat`; the demo chat card was removed to avoid the collision.

## 7. Runtime & tooling: Node.js

- Runtime Bun APIs removed (`stringWidth`, `stdin.text`, `Bun.hash`,
  tui/stats fs+fetch); `node:sqlite` path already existed via conditional
  imports.
- Tooling scripts converted to Node (`node:fs`, `child_process`,
  `import.meta.dirname`); SDK regeneration verified via
  `node packages/sdk/js/script/build.ts`; core migration generator fixed on
  Windows. Remaining bun-scoped pieces: `bun:test`, `Bun.build` release
  pipelines, bun test orchestration, CLI TS entrypoint.
- Dev defaults: UI dev port 3000, backend dev port 3001 (configurable via
  `VITE_OPENCODE_SERVER_HOST`/`VITE_OPENCODE_SERVER_PORT`); dev servers run
  as PowerShell Start-Job windows.

## 8. Verification status

| Surface                                           | Status                                                         |
| ------------------------------------------------- | -------------------------------------------------------------- |
| app/core/server/sdk/script typecheck              | clean                                                          |
| app vite build                                    | passes                                                         |
| canvas unit tests (grid/camera/operating-context) | 26/27 (1 pre-existing grid failure)                            |
| SDK regeneration under Node                       | passes                                                         |
| CLI `--help` smoke                                | passes                                                         |
| Realtime layout fan-out                           | implemented; requires backend restart to serve                 |
| Pan lock invariant                                | fixed via frozen camera snapshots; re-verified via diagnostics |

## 9. Remaining gaps

- OperatingAgent submission (BlockSubsystem, OperationalContext assembly,
  WorkspaceContext generation, durable history) — stubbed.
- Functionality-instance storage (spec §8.18) — unimplemented; layout stores
  only transforms + refs.
- Block-content state (notes/chat messages/router state) is client-only
  (localStorage).
- Error-block affordance for unknown functionality refs (NFR-7 follow-up).
- Non-visible block suspension (§8.15).
- Drizzle snapshot regeneration on CI/Linux (Windows generator limitation;
  migrations hand-maintained meanwhile).
- UnrealViewer content model, identity scope, workspace/sidebar naming
  collision (architecture.md §12).
