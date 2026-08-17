# UI Design — Chat Delivery: Steer & Queue

Status: implemented on `feature/UnrealViewer`
Related: [workspace-canvas/requirements.md](./workspace-canvas/requirements.md), [workspace-canvas/architecture.md](./workspace-canvas/architecture.md), [functionality-subsystem-management-architecture.md](./functionality-subsystem-management-architecture.md) (pending-input projection + cancellation extension)

## 1. Overview

The chat composer offers two explicit delivery actions while the session is busy:

| Action | Where | Behavior |
| ------ | ----- | -------- |
| **Steer** | Primary send button (Enter / click) | Prompt is admitted and steers the running agent at the next safe provider-turn boundary. |
| **Queue** | Secondary button next to send | Prompt is **sent immediately** to the host and queued host-side; the host promotes it when the current run finishes. |

The queue is no longer a client-side holding area. The message leaves the client
at the moment the user clicks Queue; durability and ordering live on the server.

## 2. Semantics (server contract)

Per the session runtime contract (`CONTEXT.md`):

- A prompt sent with `delivery: "steer"` is durably admitted and promoted at the
  next **Safe Provider-Turn Boundary**, resetting the agent's provider-turn
  allowance once per boundary.
- A prompt sent with `delivery: "queue"` is durably admitted but **not promoted**
  while the current **Session Drain** requires continuation. The runner promotes
  one queued prompt when the session would otherwise become idle, then
  re-evaluates continuation before promoting another.
- Both deliveries go through `sessions.prompt({ ..., delivery })`; the server
  already persists admitted inputs (`SessionInput.admit`), emits
  `session.input.admitted`, and later `session.input.promoted`.

## 3. Composer UI

### 3.1 Availability

The Queue button is visible when:

- a session exists,
- the session is busy (`session_working`),
- the composer is not blocked (permissions/question dock),
- the session is not a child/subagent session.

Otherwise only the normal send button is shown (delivery is irrelevant when idle).

### 3.2 v2 composer (new layout, default)

- Submit button: unchanged (send → steer; stop when input is blank).
- Queue button: `ButtonV2` ghost-muted, label `ui.promptInput.queue` ("Queue"),
  tooltip `ui.promptInput.queue.description`, rendered immediately left of the
  submit button, hidden in shell mode.
- Clicking Queue submits the current draft with `delivery: "queue"` and clears
  the composer, exactly like a normal send.

### 3.3 v1 composer (legacy layout)

Same behavior in the legacy `PromptInput`: a labeled Queue button (`Button`
ghost, reuse of the `settings.general.row.followup.option.queue` label and
description keys) appears next to the arrow submit button under the same
availability rule. Enter and the arrow always steer.

### 3.4 Feedback after queueing

- The message appears in the timeline immediately (optimistic add), as a sent
  user message.
- The host admits it durably; on promotion the reducer appends the authoritative
  message, deduplicated by message id against the optimistic copy.
- Queueing does **not** mark the session busy/idle optimistically — the session
  is already busy and stays busy until the agent run completes.

## 4. What was removed

- The client-side follow-up queue (the "queued prompts" dock with
  Send-now / Edit) is deleted. Queueing is host-side; editing a queued prompt is
  out of scope until the server exposes an input-edit operation.
- The `followup` general setting ("Steer vs Queue" default) is removed. Delivery
  is now an explicit per-message choice; Enter always steers.

## 5. Edge cases

| Case | Behavior |
| ---- | -------- |
| Queue clicked with empty input | No-op (same guard as send). |
| Queue clicked in shell mode | Button hidden; shell commands always steer. |
| Queue clicked for a slash-command | Button hidden where possible; commands use the command API and steer. |
| Queue while a new-session composer is shown | Button only renders for existing sessions. |
| Send fails after queueing | Same failure path as steer: optimistic message removed, input restored, toast shown. |
| Multiple queued prompts | Host promotes them one at a time as the drain idles; client timeline shows each when promoted (optimistic copies dedupe). |

## 6. Accessibility

- The Queue button is a real `<button>` with a text label, keyboard reachable.
- Tooltip and label are localized; Enter/Tab behavior unchanged.
- No new keyboard shortcuts in v1.

## 7. Implementation map

| Concern | File | Notes |
| ------- | ---- | ----- |
| Availability accessor | `packages/app/src/pages/session.tsx` | `queueEnabled` = session exists ∧ busy ∧ composer not blocked ∧ not a child session |
| Delivery on the wire | `packages/app/src/components/prompt-input/submit.ts` | `sendFollowupDraft({ delivery })` → `sessions.prompt({ ..., delivery })`; `queueSubmit` = `handleSubmit(event, "queue")`; queue skips optimistic busy/idle flipping |
| v1 Queue button | `packages/app/src/components/prompt-input.tsx` | `data-action="prompt-queue"`, hidden when blank/shell |
| v2 Queue button | `packages/session-ui/src/v2/components/prompt-input/index.tsx` | rendered from `view.submit.queue` |
| v2 view contract | `packages/session-ui/src/v2/components/prompt-input/interaction.ts` | optional `submit.queue: { available, onQueue }` |
| v2 view wiring | `packages/app/src/components/prompt-input-v2.tsx` | builds `submit.queue` from the `queue` prop |
| Removed setting | `packages/app/src/context/settings.tsx` | `followup` setting + forced-steer migration deleted |
| Removed client queue | `packages/app/src/pages/session.tsx`, `session-followup-dock.tsx` (deleted), `session-composer-region*` | persisted followup store, dock, auto-send effect, edit flow removed |
| Host queue | `packages/core/src/session/input.ts`, `runner/llm.ts`, `projector.ts` | pre-existing: durable admission, queue promotion when the drain idles |
| Client event projection | `packages/app/src/context/server-session-v2-reducer.ts` | `session.input.admitted` held as pending; `session.input.promoted` appends the message, deduped by id against the optimistic copy |

## 8. Agent Canvas — Visual Design

Status: implemented on `feature/UnrealViewer` (prototype pass)
Related: [workspace-canvas/requirements.md](./workspace-canvas/requirements.md), [workspace-canvas/architecture.md](./workspace-canvas/architecture.md)

The product UI adopts a canvas-workspace visual language: an infinite dotted
canvas, draggable glass cards, soft glassmorphism, rounded corners, calm pastel
accents, **no wires** — a floating toolbar and smooth animations, responsive,
minimal JavaScript. It should feel more like a freeform desktop app than a node
editor or a web page.

### 8.1 Art style

- **Infinite dotted canvas.** The panel renders a dotted grid that follows the
  camera (pan/zoom). Two soft ambient pastel blobs (purple, mint) sit in the
  background; the app background is a radial pastel gradient over a calm base
  color.
- **Glassmorphism cards.** Every block is a rounded card (24px radius) with a
  translucent surface, `backdrop-filter: blur(18px) saturate(1.12)`, a 1px hairline
  border, and a soft drop shadow. Selected cards get an accent ring.
- **Pastel accent palette.** Per-module accents: purple (chat), blue (context),
  mint (tools), yellow (files), peach (scratchpad), pink (voice). Gradients pair
  purple → blue for primary actions.
- **Floating chrome.** Toolbar (top center), module dock (left edge), status pill
  and hint pill (bottom left), zoom control (bottom right) — all glass pills with
  hairline borders and soft shadows, floating above the canvas.
- **Motion stays quiet.** Transitions are short (120–180ms); animate state
  changes (selection, collapse, toast, typing dots, voice pulse), not decoration.
  `prefers-reduced-motion` collapses all animation.
- **Light and dark.** The theme is a `data-theme`/`data-color-scheme` switch;
  every surface, line, and accent re-resolves via CSS variables.

### 8.2 Interaction

- **Pan**: drag empty canvas (or hold Space and drag). **Zoom**: wheel (zoom
  towards the cursor), zoom buttons, `+`/`-`/`0`.
- **Blocks**: drag by header, resize from the corner handle, collapse via header
  action, bring-to-front on pointerdown, remove via header action or
  `Delete`/`Backspace` when selected.
- **Editing mode** (toolbar toggle): grid + outlines + resize handles + the add
  palette are visible; block transforms are live. Outside editing mode blocks
  render content and ignore transform gestures (content keeps full interactivity).
- **Double-click** empty canvas adds a scratchpad block; `N` adds one centered.
- **Tidy** reflows visible blocks into rows; **Reset view** restores the camera.
- **Persistence**: camera + block transforms persist to local storage
  (prototype pass; host-authoritative layout storage is the target per FR-7).

### 8.3 Legacy opencode UI block

The legacy opencode UI (session view: messages, composer, terminal, file tree,
review panel, routed page content) is reworked into a **legacy block** that is:

- **Unremovable** — no close action; `Delete` is a no-op for it.
- **Always on the panel** — created on init, cannot be removed, sits at the
  bottom of the z-stack, and is re-fitted to the packed panel rect on window
  resize until the user manually moves/resizes it in editing mode.
- **Interactive** — its content (the routed opencode UI) stays fully usable;
  canvas gestures never steal its pointer events outside editing mode.

Every other surface below the top bar is also rendered inside the canvas shell,
so the whole app reads as one workspace: routed pages (home, draft, session)
render inside the legacy block, and auxiliary blocks (scratchpad, context,
tool activity, files, chat, voice) float alongside it.

### 8.4 Implementation map

| Concern | File | Notes |
| ------- | ---- | ----- |
| Standalone renderer | `packages/app/src/pages/canvas/workspace.tsx` | camera, blocks, chrome, gestures; pure UI, no backend calls |
| Communication subsystem | `packages/app/src/pages/canvas/manager.ts` | layout sync, revision/authority, OperatingAgent/model selection, permission config, server events; hands server-authoritative state to the UI via callbacks/signals |
| Camera math | `packages/app/src/pages/canvas/editor/camera.ts` | pan/zoom/clamp; frozen `snapshotCamera` bases for gestures (live Solid store proxies must never be captured as gesture bases) |
| Snapping grid | `packages/app/src/pages/canvas/editor/grid.ts` | snap, packed panel, overlap, fit (pre-existing, tested) |
| Art style | `packages/app/src/pages/canvas/canvas.css` | dotted grid, glass cards, pastel tokens, dark scheme; drag disables backdrop-filter for paint cost |
| Layout authority | `packages/core/src/workspace/service.ts`, `layout_authority` table | `clientID` claim on pull; `handed-over`/`conflict` results; transient `workspace.layout.updated` event published on save (realtime fan-out) |
| Functionality mapping | `FUNCTIONALITY_BY_TYPE` in workspace.tsx; `builtins` in core service | legacy block = `builtin:chat`; demo modules and router/operating-chat have registered `builtin:*` ids |
| Permission config | `manager.loadConfig()` | project config via directory-scoped SDK; deny-all created when missing; live reload on `config.updated` |
| Pan diagnostics | `vite.config.ts` `/__canvas-pan-debug` → `.test-data/canvas-pan-debug.jsonl` | dev-only gesture sampling used to diagnose the pan-amplification bug |

**Interactions (final)**: blocks select/raise on click in any mode; move/
resize/collapse and the block bar are editing-mode-only; position snaps to the
16px grid once on release; pan works with left or right button (context menu
suppressed during right-pan) and keeps the grabbed point locked under the
cursor at any zoom; wheel zooms towards the cursor except over scrollable card
content. Transform ownership lives in a `createEffect` (DOM-sync) — the render
never writes rects, which made rendered and stored positions diverge during
mid-gesture updates.

## 9. Extension (design, not yet implemented)

The functionality subsystem architecture extends this design with a
server-projected pending-input list: a Pending Inputs button with count, per-item
status badges (`steer`, `queued`, `cancel-requested`, `cancelled`), a cancel
action per pending input (`session.input.cancel`), and Stop Current Run
(`session.run.cancel`). The pending list is a projection returned by
`session.input.listPending` and updated by server events — it is **not** a
client-side queue. Race handling (cancel vs promotion) is deterministic and
host-serialized. This section is authoritative for the implemented composer;
the subsystem architecture is authoritative for the pending-input extension.
