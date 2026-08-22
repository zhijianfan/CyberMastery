# MsgScheduler Design

## Purpose

Extract steer, queue, and interrupt dispatch into a reusable headless application module. Any message-sending block can adopt the same server-authoritative behavior without depending on PromptInput, Solid components, or Session V2 SDK details.

## Constraints

- The server remains authoritative for action validity and message ordering.
- MsgScheduler holds no browser queue, execution state, retry policy, or optimistic transcript state.
- A requested queue, steer, or interrupt action is sent immediately through the supplied transport.
- Server rejections are reported to the UI with the original error intact.
- Existing Session V2 durable queue, steer, and interrupt semantics do not change.
- OperatingAgent remains a local-draft prototype until it has a real server execution API.

## Module

Create `packages/app/src/utils/msg-scheduler.ts`.

The module exports:

```ts
export type MsgSchedulerAction = "steer" | "queue" | "interrupt"

export type MsgScheduler<Message> = {
  steer(message: Message): Promise<boolean>
  queue(message: Message): Promise<boolean>
  interrupt(): Promise<boolean>
}

export function createMsgScheduler<Message>(input: {
  send(message: Message, delivery: "steer" | "queue"): Promise<boolean>
  interrupt(): Promise<void>
  onRejected(action: MsgSchedulerAction, error: unknown): void
}): MsgScheduler<Message>
```

`steer` and `queue` delegate to `send` with the requested delivery. `interrupt` delegates to the interrupt transport. A successful transport result is returned unchanged for sends and as `true` for interrupt. A thrown or rejected transport error is passed to `onRejected` and resolves as `false`.

The scheduler does not accept a busy accessor and does not suppress an action based on client state. Busy state may remain a presentation hint for showing a queue control, but the server decides whether any request is valid.

## PromptInput Integration

`createPromptSubmit` retains responsibility for draft capture, client-only validation, new-session creation, worktree preparation, optimistic transcript state, attachment rollback, and history updates.

Its internal submission function becomes the scheduler's `send` transport:

- `steer(event)` calls the existing submission path with delivery `steer`.
- `queue(event)` calls the same path with delivery `queue`.
- The submission path awaits admission so server rejection reaches MsgScheduler after restoring optimistic state and the draft.
- A local no-op, such as an empty draft or cancelled worktree wait, returns `false` without presenting a server error.

Its internal abort function becomes the scheduler's `interrupt` transport:

- A locally pending new-session/worktree operation is cancelled locally and succeeds.
- Otherwise it calls the server interrupt endpoint.
- Server interrupt errors are no longer silently swallowed.

`PromptInputSubmission` keeps its current public shape for compatibility:

- `handleSubmit` maps to `scheduler.steer`.
- `queueSubmit` maps to `scheduler.queue`.
- `abort` maps to `scheduler.interrupt`.

PromptInput V1 and V2 therefore migrate without changing their rendering contracts. MasterAgent and ChatRelay inherit MsgScheduler through `SessionSurfaceBase`, their existing shared live-session composition point.

## Error Presentation

MsgScheduler is UI-independent. `createPromptSubmit` supplies `onRejected`, formats the untouched server error with `formatServerError`, and shows an action-appropriate toast.

Steer and queue retain the existing prompt-send failure title. Interrupt uses an interrupt failure title or the existing generic request-failed title if no dedicated translation exists. The description must prefer the server response and fall back to the translated generic failure text.

No scheduler action silently catches a server rejection.

## Tests

Add a focused unit test for MsgScheduler covering:

- steer delegates once with delivery `steer`;
- queue delegates once with delivery `queue`;
- interrupt delegates once;
- each server rejection reaches `onRejected` with the original error and action;
- rejected actions resolve `false`;
- resolved send results are preserved;
- no local state, coalescing, retry, or busy gating exists.

Update PromptInput submission tests to cover:

- the existing steer and queue request payloads remain unchanged;
- server rejection restores optimistic input state before UI reporting;
- interrupt server rejection is reported instead of swallowed;
- local pending cancellation does not call the server interrupt endpoint.

Existing MasterAgent, ChatRelay, PromptInput V1, and PromptInput V2 integration tests should remain compatible because their public component contracts do not change.

## Non-Goals

- Moving Session V2 scheduling semantics out of Core.
- Adding a browser-held queue.
- Adding retries or deduplication.
- Adding new server endpoints or protocol schemas.
- Enabling OperatingAgent server execution.
- Providing reusable scheduler UI.
