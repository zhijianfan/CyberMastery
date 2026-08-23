# MasterAgent Parallel Batch Design

## Purpose

Make MasterAgent parallel delegation server-authoritative, prevent malformed streamed tool input from silently dropping workers, preserve every worker outcome as CtxPack data, and archive terminal worker sessions without closing the reusable MasterAgent parent.

## Decisions

- Replace prompt-driven fan-out across multiple `task` calls with one `task_batch` call containing the complete worker manifest.
- Keep the existing single-task implementation available for compatibility, but advertise `task_batch` to the built-in parallel-master workflow.
- Reject duplicate JSON object keys before normal tool-input decoding. Never apply first-key-wins, last-key-wins, or task-specific reconstruction.
- Reject a streamed tool slot that changes its call ID or tool name while active.
- Execute all validated batch entries concurrently on the server and settle each independently as `success`, `error`, or `interrupted`.
- Preserve every terminal outcome, including failure and interruption.
- Create one CtxPack per worker and one combined CtxPack per batch.
- Distinguish packs through scalar fragment source metadata, without changing the public CtxPack schema.
- Assume one local user. Do not expand user/session identity in this change.
- Archive only child sessions whose agent is `parallel-worker` and whose parent matches the active MasterAgent session.
- Never archive the MasterAgent parent.

## Batch Contract

`task_batch` accepts between 1 and 32 tasks. Each task contains:

```ts
{
  id: string
  description: string
  prompt: string
  owned_files: string[]
}
```

Task IDs must be non-empty and unique within the batch. Owned paths must not contain control characters. The workspace coder model is resolved once before fan-out and remains immutable for all workers.

The stable batch identity is derived from the parent session ID, assistant message ID, and tool call ID. CtxPack idempotency keys are derived from that batch identity plus the task ID for worker packs.

## Execution and Failure Semantics

1. Validate the caller, live MasterAgent binding, coder model, permission, batch size, task IDs, and owned paths before creating workers.
2. Start every worker concurrently through `SubagentRunner`.
3. Settle each worker independently so one worker error does not cancel successful siblings.
4. Preserve the child session ID on post-creation errors and interruptions.
5. Create every per-worker CtxPack using stable idempotency keys.
6. Create the combined batch CtxPack with one ordered fragment per worker.
7. Archive all terminal worker sessions in one guarded database update.
8. Return structured batch results and pack IDs to MasterAgent.

Validation or setup failures create no workers. If CtxPack persistence fails, no worker session is archived. A retry may encounter already-created packs, but idempotency returns those packs instead of duplicating them. If archival fails after capture, all CtxPacks remain durable and the tool reports the server failure.

## CtxPack Shape

Each worker pack contains assignment details and the terminal result. Its fragment source metadata contains:

```text
ctxpack.kind = parallel-worker
parallel.batch_id = <stable batch identity>
parallel.task_id = <task id>
parallel.parent_session_id = <master session id>
parallel.worker_session_id = <child session id>
parallel.outcome = success | error | interrupted
```

The combined pack contains one fragment per worker. Each fragment includes the worker pack reference and contains:

```text
ctxpack.kind = parallel-batch
parallel.batch_id = <stable batch identity>
parallel.task_id = <task id>
parallel.parent_session_id = <master session id>
parallel.worker_session_id = <child session id>
parallel.worker_ctxpack_id = <worker CtxPack id>
parallel.outcome = success | error | interrupted
```

All generated packs use `workspace` sensitivity. Fragment text is deterministically bounded to existing CtxPack byte and token limits, with terminal status and provenance retained.

## Parser Safety

The strict tool-input parser inspects complete reassembled JSON before materialization. It rejects duplicate keys at every object scope, including escaped-equivalent names, while allowing the same key in different objects and key-like text inside strings. Errors identify the structural location without echoing raw tool arguments.

The stream accumulator also rejects a provider slot that changes a previously established call ID or tool name. This guards a separate index-reuse hazard and does not claim to reconstruct malformed calls.

## Validation

- LLM unit tests cover top-level, nested, escaped, and cross-fragment duplicate keys plus valid sibling objects.
- OpenAI Chat coverage proves duplicate keys split across SSE chunks fail before a tool call is emitted.
- SubagentRunner tests prove failed and interrupted post-creation workers retain their child IDs.
- Task batch tests prove real overlap, mixed outcomes, stable pack metadata, one combined pack, retry idempotency, capture-before-archive ordering, guarded worker-only archival, and parent preservation.
