# Track Q1 — Composer and Host Queue Wiring

## Mission

Connect the MasterAgent's explicit session target to the existing queue-capable composer and prove that `delivery: "queue"` is admitted host-side. Do not create new queue behavior.

Target branch: `feature/UnrealViewer`.

## Dependencies

- U1 reusable SessionSurface contract.

## Files

### Create

```text
packages/app/src/pages/canvas/master-agent/session-options.ts
packages/app/src/pages/canvas/master-agent/queue.test.tsx
```

Do not edit the existing v1 or v2 prompt-input implementations unless an architecture review proves reuse impossible.

## Required implementation

1. Define the MasterAgent-specific session-surface/composer options needed to reuse the existing Queue action.
2. Supply the bound top-level session ID from the block/controller to SessionSurface.
3. Ensure the embedded composer receives `queueEnabled` under the same conditions as the existing session application.
4. Ensure Queue submission reaches the existing path equivalent to:

```ts
handleSubmit(event, "queue")
```

5. Verify the resulting Session admission request includes:

```json
{ "delivery": "queue" }
```

6. Continue projecting pending/promoted state from the existing Session subsystem and host events.

## Prohibited implementation

Do not add any of the following:

```text
block-local pending prompt array
browser-local queue database
setTimeout-based delayed submission
queue promotion logic in the app
a second composer implementation
MasterAgent-specific prompt endpoint
```

Queue ownership remains entirely host-side through `SessionInput.admit` and existing session events.

## Busy-state behavior

The Queue action should be available according to the existing composer semantics when the targeted session is busy. Q1 may adapt surface options but must not define a second independent notion of session idleness.

## Tests

Cover:

1. Idle composer preserves normal send/steer behavior.
2. Busy targeted session renders Queue.
3. Clicking Queue invokes the existing submit path with `"queue"`.
4. Admission request is sent immediately to the host.
5. Pending display is driven by Session state/events.
6. Remount does not resubmit or lose admitted inputs.
7. No local queue state exists in the MasterAgent module.
8. Two blocks target their own sessions and do not cross-submit.

## Verification

```bash
bun test packages/app/src/pages/canvas/master-agent/queue.test.tsx
rg 'followup|client.*queue|local.*queue' packages/app/src/pages/canvas/master-agent
```

Review search results manually. Test names or comments may contain these words, but implementation must not contain a client holding queue.

Also run:

```bash
bun --cwd packages/app typecheck
```

## Deliverable

A small adapter/options module and tests proving reuse of the existing host queue path.

## Merge notes

The following files should normally remain unchanged:

```text
packages/app/src/components/prompt-input.tsx
packages/session-ui/src/v2/components/prompt-input/**
```
