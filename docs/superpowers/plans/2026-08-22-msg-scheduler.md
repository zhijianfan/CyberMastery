# MsgScheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract queue, steer, and interrupt dispatch into a reusable, headless, server-authoritative MsgScheduler and migrate all live PromptInput-based session surfaces.

**Architecture:** A transport-agnostic app utility maps the three actions to injected async functions, reports untouched server errors through an injected callback, and holds no scheduling state. `createPromptSubmit` remains responsible for draft construction and optimistic rollback, while its public submission methods become MsgScheduler methods; shared session surfaces automatically carry the behavior to routed sessions, MasterAgent, and ChatRelay.

**Tech Stack:** TypeScript, Bun, SolidJS application adapters, Session V2 SDK

**Spec:** `docs/superpowers/specs/2026-08-22-msg-scheduler-design.md`

## Global Constraints

- Implement production code before beginning the test iteration, as explicitly requested.
- The server remains authoritative for action validity and message ordering.
- Do not add client queue state, retries, coalescing, busy gating, or new protocol endpoints.
- Preserve the current `PromptInputSubmission` public contract.
- Preserve the original server error object through the reporting callback.
- Leave OperatingAgent unchanged.
- Do not edit generated SDK files.
- Do not use git or create commits unless explicitly requested.

---

### Task 1: Add MsgScheduler and migrate PromptInput submission

**Files:**
- Create: `packages/app/src/utils/msg-scheduler.ts`
- Modify: `packages/app/src/components/prompt-input/submit.ts`

**Interfaces:**
- Consumes: injected `send(message, delivery)`, `interrupt()`, and `onRejected(action, error)` functions.
- Produces: `MsgScheduler<Message>`, `MsgSchedulerAction`, and `createMsgScheduler<Message>()`.

- [ ] **Step 1: Create the state-free scheduler**

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
}): MsgScheduler<Message> {
  const run = async (action: MsgSchedulerAction, request: () => Promise<boolean>) => {
    try {
      return await request()
    } catch (error) {
      input.onRejected(action, error)
      return false
    }
  }

  return {
    steer: (message) => run("steer", () => input.send(message, "steer")),
    queue: (message) => run("queue", () => input.send(message, "queue")),
    interrupt: () =>
      run("interrupt", async () => {
        await input.interrupt()
        return true
      }),
  }
}
```

- [ ] **Step 2: Make the existing submission path a scheduler transport**

In `createPromptSubmit`, keep all draft capture, validation, session creation, command/shell handling, optimistic state, and rollback logic in the existing submission function. Make every branch return a boolean:

```ts
const submit = async (event: Event, delivery: "steer" | "queue") => {
  event.preventDefault()
  // Existing validation and draft logic.
  // Return false for local no-op/rejection branches.
  // Return true after shell/custom command dispatch or prompt admission.
}
```

Await normal prompt admission instead of detaching it. Preserve cleanup before rethrowing so MsgScheduler reports only after optimistic state and attachments are restored:

```ts
try {
  const admitted = await sendFollowupDraft({ ...existingInput, delivery })
  if (!admitted) return false
  contextAttachmentStore?.clearAfterAdmission()
  return true
} catch (error) {
  // Existing pending/status/optimistic/draft/attachment rollback.
  throw error
}
```

- [ ] **Step 3: Move interrupt error ownership to MsgScheduler**

Keep local pending cancellation in the interrupt transport, but remove the remote `.catch(() => {})`:

```ts
const interrupt = async () => {
  const sessionID = params.id
  if (!sessionID) return
  // Existing local pending cancellation.
  await sdk().api.session.interrupt({ sessionID })
}
```

- [ ] **Step 4: Construct and return MsgScheduler**

```ts
const scheduler = createMsgScheduler<Event>({
  send: submit,
  interrupt,
  onRejected: (action, error) =>
    showToast({
      title:
        action === "interrupt"
          ? language.t("common.requestFailed")
          : language.t("prompt.toast.promptSendFailed.title"),
      description: formatServerError(error, language.t, language.t("common.requestFailed")),
    }),
})

return {
  abort: scheduler.interrupt,
  handleSubmit: scheduler.steer,
  queueSubmit: scheduler.queue,
}
```

Do not change PromptInput V1/V2, SessionSurfaceBase, MasterAgent, or ChatRelay props. Their existing composition already consumes `PromptInputSubmission`.

---

### Task 2: Add scheduler and integration coverage

**Files:**
- Create: `packages/app/src/utils/msg-scheduler.test.ts`
- Modify: `packages/app/src/components/prompt-input/submit.test.ts`

**Interfaces:**
- Consumes: `createMsgScheduler` from Task 1 and the unchanged `PromptInputSubmission` methods.
- Produces: behavioral coverage for direct delegation, rejection reporting, PromptInput delivery, rollback, and interrupt behavior.

- [ ] **Step 1: Add standalone scheduler tests**

Use real async functions and recorded calls, not module mocks or timers:

```ts
test("delegates steer and queue without local scheduling", async () => {
  const calls: Array<{ message: string; delivery: "steer" | "queue" }> = []
  const scheduler = createMsgScheduler<string>({
    send: async (message, delivery) => {
      calls.push({ message, delivery })
      return true
    },
    interrupt: async () => undefined,
    onRejected: () => undefined,
  })

  expect(await scheduler.steer("first")).toBe(true)
  expect(await scheduler.queue("second")).toBe(true)
  expect(calls).toEqual([
    { message: "first", delivery: "steer" },
    { message: "second", delivery: "queue" },
  ])
})
```

Add direct cases for interrupt delegation, preserving a resolved `false` send result, and each action rejecting. Rejection assertions must verify `{ action, error }` identity and `false` return values.

- [ ] **Step 2: Extend the PromptInput test transport**

Add `interruptCalls` and `failInterrupt` to the existing SDK fake. Its interrupt method records the session ID and throws `new Error("interrupt-invalid")` when requested. Reset both values in `beforeEach`.

- [ ] **Step 3: Cover server-authoritative interrupt reporting**

```ts
test("reports the server response when interrupt is rejected", async () => {
  params = { id: "session-1" }
  failInterrupt = true
  const submit = createPromptSubmit(makeSubmitInput())

  expect(await submit.abort()).toBe(false)
  expect(interruptCalls).toEqual(["session-1"])
  expect(toastCalls.at(-1)?.description).toBe("interrupt-invalid")
})
```

Retain the existing steer and queue payload assertions. Update prompt-failure coverage so awaiting `handleSubmit` directly observes completed rollback and the server error toast without `Bun.sleep(0)`.

---

### Task 3: Validate and iterate until clean

**Files:**
- Modify only files from Tasks 1 and 2 when a focused failure demonstrates a defect.

**Interfaces:**
- Consumes: completed production and test implementation.
- Produces: passing focused behavior and package type safety.

- [ ] **Step 1: Run standalone scheduler tests**

Run from `packages/app`:

```powershell
bun test src/utils/msg-scheduler.test.ts
```

Expected: all MsgScheduler delegation and rejection cases pass.

- [ ] **Step 2: Run PromptInput submission tests separately**

```powershell
bun test --conditions=solid --preload ./happydom.ts src/components/prompt-input/submit.test.ts
```

Expected: existing payload/rollback coverage plus interrupt rejection coverage passes.

- [ ] **Step 3: Run component integration tests separately**

```powershell
bun test --conditions=solid --preload ./happydom.ts src/components/prompt-input-v2.test.tsx
bun test --conditions=browser --preload ./happydom.ts src/pages/canvas/session-surface.browser.test.tsx
bun test --conditions=solid --preload ./happydom.ts src/pages/canvas/master-agent/queue.test.tsx
bun test --conditions=browser --preload ./happydom.ts src/pages/canvas/blocks/chat-relay/view.browser.test.tsx
```

Expected: unchanged component contracts remain green.

- [ ] **Step 4: Run app typecheck**

```powershell
bun typecheck
```

Expected: `tsgo -b` exits with no diagnostics.

- [ ] **Step 5: Iterate only on demonstrated failures**

For each failure, identify the root cause, make the smallest correction in the Task 1 or Task 2 files, and rerun only the failed command. When focused commands pass, rerun all commands from Steps 1 through 4 once as the final validity gate.
