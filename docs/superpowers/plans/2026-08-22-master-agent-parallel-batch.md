# MasterAgent Parallel Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MasterAgent parallel delegation server-authoritative and preserve terminal worker sessions as per-worker and batch CtxPacks before guarded archival.

**Architecture:** A strict LLM tool-input boundary fails closed on malformed streamed JSON. A new `task_batch` built-in owns fan-out and fan-in, uses existing SubagentRunner and CtxPack persistence, then performs one idempotent worker-only archive update after all packs exist.

**Tech Stack:** TypeScript, Bun tests, Effect, Drizzle SQLite, existing CtxPack schema and repository.

**Spec:** `docs/superpowers/specs/2026-08-22-master-agent-parallel-batch.md`

## Global Constraints

- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server.
- Do not change generated clients or public Protocol/HttpApi surfaces.
- Keep one local-user assumption; do not add identity fields or authorization flows.
- Use existing `CtxPack.Source.metadata` scalar values for tags.
- Support 1-32 tasks because a combined CtxPack supports at most 32 fragments.
- Preserve success, error, and interruption outcomes.
- Archive only matching `parallel-worker` child sessions after all CtxPacks are durable.
- Never archive the reusable MasterAgent parent.
- Use stable idempotency keys derived from parent session, assistant message, tool call, and task identity.
- Follow repository style: no `any`, no import aliases or star imports, prefer `const`, early returns, and functional array methods.
- Run tests and typechecks only from their package directories.
- Do not commit or push unless the user explicitly requests it after implementation.

---

### Task 1: Strict streamed tool-input integrity

**Files:**
- Modify: `packages/llm/test/tool-stream.test.ts`
- Modify: `packages/llm/test/provider/openai-chat.test.ts`
- Modify: `packages/llm/src/protocols/shared.ts`
- Modify: `packages/llm/src/protocols/utils/tool-stream.ts`
- Modify: `packages/llm/package.json`

**Interfaces:**
- Produces: strict `parseToolInput(adapter, input)` behavior that rejects duplicate keys before JSON materialization.
- Produces: `ToolStream.appendOrStart(...)` failure when a live stream key changes call ID or tool name.

- [ ] **Step 1: Write duplicate-key and stream-identity tests**

Add table-driven ToolStream cases for top-level, nested, escaped-equivalent, and cross-fragment duplicates, plus valid repeated keys in sibling objects. Add call-ID and tool-name mismatch cases. Add one OpenAI Chat SSE case with duplicate task keys split across chunks and assert no tool call is materialized.

- [ ] **Step 2: Run tests and verify RED**

Run from `packages/llm`:

```powershell
bun test test/tool-stream.test.ts test/provider/openai-chat.test.ts
```

Expected: duplicate-key cases currently materialize last-key-wins objects, and stream identity mismatch is currently accepted.

- [ ] **Step 3: Implement strict parsing and identity guards**

Use `jsonc-parser` to retain all object properties while inspecting the complete raw JSON. Walk each object node with a fresh key set, compare decoded key values, and return an `LLMError` with a structural path when a duplicate is found. Keep normal JSON decoding as the final materialization step. In `appendOrStart`, reject conflicting non-empty IDs or names for an existing key.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same package-local command and require all focused tests to pass without warnings.

### Task 2: Preserve terminal worker identity

**Files:**
- Modify: `packages/core/test/session-subagent-runner.test.ts`
- Modify: `packages/core/src/session/subagent-runner.ts`

**Interfaces:**
- Produces: `SubagentRunner.RunError` with optional `sessionID` and terminal `outcome` for failures occurring after child creation.
- Preserves: existing `SubagentRunner.run(input)` success result and pre-creation error behavior.

- [ ] **Step 1: Write failed and interrupted child identity tests**

Extend the real SubagentRunner test layer so a post-creation provider error and an interruption both assert a child session ID is present, the child belongs to the parent, and the outcome is `error` or `interrupted` respectively. Keep missing-parent failures without a child ID.

- [ ] **Step 2: Run tests and verify RED**

Run from `packages/core`:

```powershell
bun test test/session-subagent-runner.test.ts
```

Expected: current RunError does not preserve terminal child identity or interruption outcome.

- [ ] **Step 3: Implement terminal identity propagation**

Extend RunError with optional session identity and outcome fields. After child creation, map provider, assistant, empty-output, and interruption failures to RunError values carrying the child ID. Do not convert pre-creation validation failures into terminal workers.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same package-local command and require all focused tests to pass.

### Task 3: Server-authoritative task batch lifecycle

**Files:**
- Create: `packages/core/src/tool/task-batch.ts`
- Create: `packages/core/test/tool-task-batch.test.ts`
- Modify: `packages/core/src/tool/builtins.ts`
- Modify: `packages/core/src/plugin/agent.ts`

**Interfaces:**
- Consumes: `SubagentRunner.run(input)` success and RunError terminal identity from Task 2.
- Consumes: `CtxPackRepository.create(...)`, `CtxPackValidation.validateCreate(...)`, `Database.Service`, and `SessionTable`.
- Produces: built-in tool `task_batch` with structured batch and worker results.

- [ ] **Step 1: Write task-batch behavior tests**

Test input shape and visibility, validation before worker creation, immutable model resolution, a Deferred barrier proving real overlap, mixed success/error/interruption outcomes, per-worker and combined CtxPack metadata, deterministic ordering, worker-only archival, parent preservation, stable idempotency on exact retry, and no archival when capture fails.

- [ ] **Step 2: Run tests and verify RED**

Run from `packages/core`:

```powershell
bun test test/tool-task-batch.test.ts
```

Expected: the `task_batch` module and registration do not yet exist.

- [ ] **Step 3: Implement validation and concurrent execution**

Resolve the live binding, workspace coder model, and permission once. Validate 1-32 unique task IDs and safe owned paths. Construct immutable worker prompts and run all workers concurrently. Convert RunError values with child IDs into terminal outcomes while treating pre-creation errors as batch failures.

- [ ] **Step 4: Implement CtxPack fan-in**

Create one bounded workspace-sensitive pack per outcome, then one batch pack with one ordered fragment per worker. Apply metadata keys from the design spec and stable idempotency keys. Use the fixed local creator string only inside this trusted core path.

- [ ] **Step 5: Implement guarded archival and model output**

After batch-pack creation, archive all child IDs in one database transaction/update guarded by parent ID, `parallel-worker` agent, and null archive time. Return escaped model output plus structured batch, worker, and CtxPack identities. Surface persistence or archive failures as tool errors.

- [ ] **Step 6: Register and direct parallel-master**

Add `TaskBatchTool.node` to built-ins and update the parallel-master system prompt to emit exactly one `task_batch` call containing every manifest task. Keep the legacy single task module out of the default built-in registration.

- [ ] **Step 7: Run tests and verify GREEN**

Run from `packages/core`:

```powershell
bun test test/tool-task-batch.test.ts test/session-subagent-runner.test.ts test/tool-task.test.ts
```

Expected: all focused lifecycle and compatibility tests pass.

### Task 4: Package validation and regression repair

**Files:**
- Modify only files already listed when a failing test proves a defect.

**Interfaces:**
- Validates all interfaces produced by Tasks 1-3 together.

- [ ] **Step 1: Run package typechecks**

Run:

```powershell
Set-Location packages/llm; bun typecheck
Set-Location ../core; bun typecheck
```

- [ ] **Step 2: Run focused package suites**

Run:

```powershell
Set-Location packages/llm; bun test test/tool-stream.test.ts test/provider/openai-chat.test.ts
Set-Location ../core; bun test test/tool-task-batch.test.ts test/session-subagent-runner.test.ts test/tool-task.test.ts
```

- [ ] **Step 3: Repair only reproduced regressions using TDD**

For each failure, preserve the failing case, identify its root cause, make the smallest source correction, and rerun only the covering package-local command until green.
