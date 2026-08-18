# Track R1 — Host Coder Delegation and Tool Policy

## Mission

Implement enforceable host-side routing of coding work from a MasterAgent primary session to a reserved Coder child session using `workspace.coderModel`.

Target branch: `feature/UnrealViewer`.

## Dependencies

- A0 shared contracts.
- B2 final session-to-functionality-instance resolution before merge.

This track may begin against a `MasterAgentPolicyResolver` interface while B2 is in progress.

## Files

### Create

```text
packages/opencode/src/session/master-agent-policy.ts
packages/opencode/src/tool/coder-task.ts
packages/opencode/test/session/master-agent-policy.test.ts
packages/opencode/test/tool/coder-task.test.ts
```

### Modify

```text
packages/opencode/src/tool/task.ts
packages/opencode/src/session/prompt.ts
packages/opencode/src/agent/agent.ts
```

Adapt to actual upstream/fork paths, but keep all shared task/prompt/agent edits in this track.

## Required architecture

The primary MasterAgent session remains the coordinator on `workspace.model`. When `workspace.coderModel` is non-null, implementation work is delegated to a reserved Coder child session.

Recommended flow:

```text
MasterAgent primary session
  → reserved coder tool
  → host resolves workspace + functionality instance
  → host validates task permission and model availability
  → host creates child session
       parentID = primary MasterAgent session
       agent = reserved coder agent
       model = snapshot(workspace.coderModel)
       directory = MasterAgent directory binding
  → child performs coding work
  → result returns to primary
```

## Policy resolver

Create a host service that answers, for a given session:

```ts
interface MasterAgentPolicy {
  enabled: boolean
  workspaceID?: Workspace.ID
  blockID?: string
  coderModel?: ModelSelection
  directory?: string
  directMutationAllowed: boolean
}
```

Exact type names may differ. The resolver must derive policy from trusted host state and return disabled for ordinary sessions.

## Reserved Coder tool

The model-visible tool arguments may describe the task and bounded context, but must not accept:

```text
model/provider selection
permission override
directory override
parent session override
workspace/block override
```

The host resolves those values.

Reuse the existing TaskTool child-session machinery where possible rather than creating a separate orchestration stack.

## Tool enforcement

When Coder routing is enabled for a MasterAgent primary session:

### Primary may retain

```text
read
glob
grep
context/reference tools
planning and discussion
reserved coder delegation
non-mutating task operations allowed by existing policy
```

### Primary must not directly perform

```text
edit
write
apply patch
repository-mutating shell commands
build/test/format/migration/debug shell execution intended as coding work
```

The exact enforcement hook should use the repository's existing tool filtering/permission architecture. Do not rely only on a system prompt.

User-operated terminal UI remains governed by existing user permissions and is not automatically removed by autonomous-agent tool restrictions.

## Model behavior

- Snapshot `workspace.coderModel` when creating the child session.
- A later workspace change affects only future children.
- If the model/provider is unavailable, return a visible typed error.
- Do not silently fall back to `workspace.model`.
- Allow selecting the same model as primary, but the UI may warn.

## Permissions

Reuse the existing `task` permission as the delegation gate.

- Client denial is UX only.
- Host denial is authoritative.
- Project/workspace permissions still apply inside the Coder child.

## Tests

Cover at least:

1. Ordinary non-MasterAgent sessions retain current behavior.
2. MasterAgent with `coderModel: null` retains current behavior.
3. Enabled Coder mode creates a child with the selected model.
4. Primary session remains on the primary model.
5. Model/directory cannot be overridden by tool arguments.
6. Direct primary mutation tools are unavailable or rejected.
7. Read-only tools remain available.
8. `task` denial blocks Coder delegation.
9. Unavailable Coder model fails visibly without fallback.
10. Model change during a running child does not mutate that child.
11. The next child uses the updated model.
12. Child session is linked to the correct parent and workspace/block directory.

## Verification

```bash
bun --cwd packages/opencode typecheck
bun test packages/opencode/test/session/master-agent-policy.test.ts   packages/opencode/test/tool/coder-task.test.ts
```

## Deliverable

A host-enforced Coder delegation path with no client-side classification and no silent model substitution.

## Merge notes

R1 exclusively owns edits to `session/prompt.ts`, `tool/task.ts`, and `agent/agent.ts` for this feature.
