# MasterAgent Parallel Orchestration

Status: implementation plan, 2026-08-21

## Outcome

`builtin:master-agent` becomes a fixed parallel coordinator. It plans work, creates a disjoint worker brief for each unit, dispatches all independent workers in one provider turn, waits for the child-session barrier, reviews the results, and delegates integration checks. The workspace top bar exposes the workspace-wide worker model using the same connected-provider catalog and refresh action as the primary model picker.

The primary and worker selections remain independent:

- `workspace.model` is the MasterAgent coordinator model.
- `workspace.coderModel` is the MasterAgent worker model and is labelled **Subagent** in the canvas UI.
- A child snapshots the worker selection when it is created. Later changes affect only later children.
- Missing or unavailable worker models fail visibly; there is no fallback to the primary model.

## Current gap

The legacy prompt loop already has a trusted `coder-task` path, but MasterAgent-owned canvas sessions are V2 Sessions. The V2 runner does not currently register `task`, and MasterAgent session creation does not apply either its coordinator agent or `workspace.model`. A prompt-only change would therefore advertise behavior the runtime cannot perform.

## Approaches considered

1. Reuse the legacy background-job implementation from V2. This preserves the old skill literally, but couples Core V2 to the legacy Session monolith and its process-local job notifications.
2. Add a browser-side parallel job manager. This would duplicate Session durability, cancellation, reconciliation, and permission authority in the client.
3. Use V2 child Sessions and eager tool settlement. This is the selected approach. The V2 runner already starts independent tool calls eagerly, and the Session coordinator already permits different Session IDs to run concurrently. One trusted child-run operation is sufficient; several `task` calls in one assistant turn form the fan-out and the runner's settlement join is the barrier.

## Runtime design

### Coordinator and worker agents

Core registers two hidden built-ins:

- `parallel-master`: primary coordinator used only by MasterAgent bindings. It can inspect the repository through glob and approval-aware reads, maintain `.opencode/parallel/**` manifests, and invoke `task`. Direct repository edits, shell execution, and broad content grep are denied because grep cannot enforce read policy on matched paths.
- `parallel-worker`: subagent used by MasterAgent tasks. It can implement its owned work, can run shell validation only with approval, cannot grep repository contents or spawn more subagents, and receives the workspace-selected worker model as an explicit Session snapshot.

The coordinator system instruction incorporates the useful contract of `.opencode/skills/parallel-master/SKILL.md`: self-contained briefs, disjoint ownership, one-turn fan-out, no implementation while workers run, exact-result aggregation, scope review, and final integration validation. It adapts the old process-local `background: true` mechanism to V2's eager concurrent settlement.

### Trusted task boundary

The model-visible `task` input contains only:

- a short description;
- the task brief;
- the worker's owned paths.

The host resolves and enforces parent Session, workspace, location, MasterAgent binding, agent ID, model, and permissions. A bound MasterAgent task always creates a `parallel-worker` child. Model, provider, directory, workspace, parent, permission overrides, and child Session IDs are not model-visible inputs.

The host escapes task text and owned paths before placing them in the worker envelope, rejects control characters in owned paths, and escapes worker-controlled result text before returning it to the coordinator. Model content therefore cannot manufacture host control or result boundaries.

The child runner:

1. creates a V2 child Session with `parentID`, title, location, `parallel-worker`, and the selected model snapshot;
2. admits the self-contained brief without waking execution;
3. calls the Session execution join point;
4. reads the final projected assistant text;
5. returns `{ sessionId, text }` in the task result.

Multiple calls emitted in one provider turn execute concurrently. The parent continues only after all tool settlements finish. Interrupting the parent interrupts its active tool fibers; durable cross-process recovery remains a separate V2 concern.

### MasterAgent session configuration

Every ensure and reset configures the owned Session with:

- agent `parallel-master`;
- the decoded `workspace.model`, when present;
- the existing authoritative workspace/location binding.

Ensure also upgrades an already-bound Session so existing blocks do not require a destructive reset.

### Top-bar model selection

The second picker is rendered beside the primary model picker and consumes the same `modelCatalog` memo and the same `providers.refresh()` action. It uses the existing `manager.masterAgent.coder` controller for optimistic persistence, rollback, retry, and workspace-switch safety. New changes are gated until workspace hydration completes, while in-flight requests retain stable workspace identity across disconnects. The picker has an explicit **Disabled** option that clears `workspace.coderModel`; disabled MasterAgents cannot delegate and explain how to select a worker model.

The existing per-block Coder selector remains a synchronized view of the same workspace setting for compatibility. It does not own another catalog or another model value.

## Safety and invariants

- Layout remains presentation-only; no Session, task, model, plugin, skill, or tool state enters `Workspace.Block.Record`.
- Only a live `builtin:master-agent` binding can use the trusted task path.
- Worker model selection is snapshotted and never silently falls back.
- `parallel-master` cannot mutate repository files outside `.opencode/parallel/**`.
- `parallel-master` cannot grep file contents, and reads of `.env` variants still require approval.
- `parallel-worker` cannot recursively dispatch tasks.
- `parallel-worker` cannot silently extract secret files through read, edit, grep, or shell paths; secret reads and edits require approval, grep is denied, and shell use requires approval.
- Worker path ownership is carried in the brief and result metadata. Filesystem enforcement is deferred because shell commands currently have no owned-path sandbox; the coordinator must reject out-of-scope diffs.
- No new browser queue, job manager, or background polling loop is introduced.

## Implementation tasks

### Task 1 — Top-bar Subagent picker

Files:

- Modify `packages/app/src/pages/canvas/workspace.tsx`.
- Extend `packages/app/src/pages/canvas/master-agent.integration.test.tsx`.

Work:

- Add nullable clear support to the existing local `ModelPicker`.
- Render a `Subagent` picker bound to `manager.masterAgent.coder`.
- Reuse the exact catalog accessor and refresh function used by `Model`.
- Verify primary and worker selection remain independent and refresh remains shared.

### Task 2 — V2 child Session runner and task tool

Files:

- Modify `packages/core/src/session.ts` to support internal `parentID` and `title` creation fields.
- Add `packages/core/src/session/subagent-runner.ts`.
- Add `packages/core/src/tool/task.ts`.
- Modify `packages/core/src/tool/builtins.ts`.
- Add focused Core tests beside the existing Session/tool tests.

Work:

- Implement one trusted child run; do not add `runMany` or a second scheduler.
- Return stable `sessionId` metadata compatible with the existing task renderer.
- Register the tool with a dedicated permission action so it is materialized only for `parallel-master`.
- Prove two task settlements overlap and child Sessions preserve parent, agent, location, and model.

### Task 3 — Built-in agents and MasterAgent binding configuration

Files:

- Modify `packages/core/src/plugin/agent.ts`.
- Modify `packages/core/src/workspace/master-agent.ts`.
- Add a small workspace model-key decoder if sharing it avoids duplicated parsing.
- Extend `packages/core/test/workspace/master-agent.test.ts` and agent tests.

Work:

- Register hidden `parallel-master` and `parallel-worker` agents with the policies above.
- Configure new, reset, and already-bound MasterAgent Sessions.
- Resolve the trusted binding and workspace worker model for the task tool.
- Preserve ordinary Sessions and non-MasterAgent agents unchanged.

### Task 4 — Integration and compatibility verification

Run from package directories:

```text
packages/core: bun test <focused files>; bun typecheck
packages/app: bun test <focused files>; bun typecheck
```

Also verify:

- primary model changes do not change the worker picker;
- worker changes do not change the primary picker;
- two MasterAgent blocks observe the same workspace worker setting but keep distinct parent Sessions;
- a missing worker model is a visible task failure;
- changing the worker model during a child run does not mutate that child;
- ordinary Sessions do not advertise the trusted MasterAgent task tool;
- generated clients remain untouched because no public Protocol contract changes.

## Deferred follow-ups

- A durable typed parallel-run/manifest table, bounded fan-out, per-task cancellation, and restart recovery.
- Host-enforced owned-path mutation boundaries for worker shell/edit tools.
- Rich web progress cards driven by child Session status.
- General-purpose subagent model policy outside MasterAgent. `workspace.coderModel` remains the reserved MasterAgent worker selection in this slice.
