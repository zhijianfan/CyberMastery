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

## 8. Extension (design, not yet implemented)

The functionality subsystem architecture extends this design with a
server-projected pending-input list: a Pending Inputs button with count, per-item
status badges (`steer`, `queued`, `cancel-requested`, `cancelled`), a cancel
action per pending input (`session.input.cancel`), and Stop Current Run
(`session.run.cancel`). The pending list is a projection returned by
`session.input.listPending` and updated by server events — it is **not** a
client-side queue. Race handling (cancel vs promotion) is deterministic and
host-serialized. This section is authoritative for the implemented composer;
the subsystem architecture is authoritative for the pending-input extension.
