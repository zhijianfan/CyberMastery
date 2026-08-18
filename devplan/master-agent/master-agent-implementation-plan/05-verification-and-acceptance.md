# MasterAgent Verification and Acceptance Gate

Target branch: `feature/UnrealViewer`.

## 1. Per-package verification

Run the repository's exact package scripts where they differ from the examples below. The minimum gate is:

```bash
bun --cwd packages/schema typecheck
bun --cwd packages/core typecheck
bun --cwd packages/protocol typecheck
bun --cwd packages/server typecheck
bun --cwd packages/sdk/js typecheck
bun --cwd packages/opencode typecheck
bun --cwd packages/app typecheck
bun --cwd packages/app run build
```

SDK generation:

```bash
node packages/sdk/js/script/build.ts
node packages/sdk/js/script/build.ts
```

The second generation run must produce no additional diff.

## 2. Required focused tests

At minimum, the implementation should add and pass tests covering:

```text
packages/core/test/workspace/workspace-coder-model.test.ts
packages/core/test/database/master-agent-migration.test.ts
packages/core/test/workspace/master-agent.test.ts
packages/protocol/test/workspace-master-agent.test.ts
packages/server/test/handlers/workspace-master-agent.test.ts
packages/opencode/test/session/master-agent-policy.test.ts
packages/opencode/test/tool/coder-task.test.ts
packages/app/src/pages/canvas/session-surface.test.tsx
packages/app/src/pages/canvas/master-agent/block.test.tsx
packages/app/src/pages/canvas/master-agent/controller.test.ts
packages/app/src/pages/canvas/master-agent/sdk-port.test.ts
packages/app/src/pages/canvas/master-agent/queue.test.tsx
packages/app/src/pages/canvas/master-agent/coder-selector.test.tsx
packages/app/src/pages/canvas/master-agent.integration.test.tsx
packages/core/test/integration/master-agent-session.test.ts
packages/opencode/test/integration/master-agent-coder.test.ts
packages/app/src/pages/canvas/master-agent.e2e.test.tsx
```

Names may be adapted to repository conventions, but equivalent coverage is mandatory.

## 3. Functional acceptance criteria

The feature is accepted only when all of these statements are true.

### Registration and rendering

1. `builtin:master-agent` appears in the server/core built-in functionality registry.
2. The client maps the block type/functionality ID and renders the MasterAgent block.
3. The block displays the original session surface: messages, composer, terminal, file tree, and review panel.
4. Existing routed session pages still behave correctly after the shared-surface extraction.

### Session ownership

5. Two MasterAgent blocks in the same workspace resolve different top-level session IDs.
6. Reloading the application preserves each block's original binding.
7. Moving, resizing, hiding, or remounting a block does not change its session.
8. Concurrent `ensure` requests result in exactly one active binding.
9. A stale reset request is rejected by expected-session or revision checks.
10. Resetting one MasterAgent changes only that block's binding.
11. Removing a block does not delete its host session or queued inputs.
12. Layout-authority handover does not duplicate the session.

### Queue delivery

13. A busy MasterAgent exposes the existing Queue action.
14. Queue submission immediately reaches the host with `delivery: "queue"`.
15. No app-local or block-local queue store exists.
16. Reloading while an input is queued restores the pending state from host projection.
17. Queued inputs preserve admission order.
18. A queued input promotes only when the session drain would otherwise become idle.
19. Block removal/remount does not discard admitted queue entries.

### Coder selection and routing

20. `coderModel` persists through create/read/patch/reload and generated SDK types.
21. `coderModel = null` preserves existing primary-agent behavior.
22. Enabling Coder leaves the main session on `workspace.model`.
23. Repository-mutating work creates a child session using the selected `workspace.coderModel`.
24. The host, not the client/model, selects the Coder model and directory.
25. Direct primary-agent repository mutation is unavailable while strict Coder routing is enabled.
26. Read-only planning and context gathering remain possible in the primary session.
27. Changing `coderModel` does not alter a running child; the next child uses the new selection.
28. An unavailable Coder model produces a visible error and does not fall back silently.
29. Denying `task` prevents delegation in both the UI and host.
30. User-operated terminal UI remains available according to its existing permissions.

### Build and generation

31. All touched packages pass typecheck.
32. Targeted unit/integration tests pass.
33. SDK regeneration is idempotent.
34. The app production build succeeds.

## 4. Negative assertions

Use repository search or tests to confirm the implementation did not introduce prohibited behavior:

```bash
rg 'delivery:\s*"queue"|handleSubmit.*"queue"' packages/app packages/session-ui
rg 'followup|client.*queue|local.*queue' packages/app/src/pages/canvas/master-agent
rg 'sessionID' packages/app/src/pages/canvas/workspace.tsx
rg 'coderModel|providerID|modelID' packages/opencode/src/tool/coder-task.ts
```

Interpretation:

- Queue delivery should be delegated to existing composer/session APIs.
- The MasterAgent directory should not contain a browser holding queue.
- `workspace.tsx` should not persist or own session IDs.
- The Coder tool may reference trusted resolved model data internally, but its public/model-visible arguments must not accept arbitrary model/provider overrides.

## 5. Manual smoke test

1. Open a workspace and add two MasterAgent blocks.
2. Confirm each shows a distinct session.
3. Start a long-running prompt in block A.
4. Submit a second prompt with Queue.
5. Reload the page and verify the queued prompt remains visible.
6. Confirm it promotes when the first run finishes.
7. Select a Coder model.
8. Ask the primary agent to make a small code change and run a focused test.
9. Confirm a child Coder session is created using the selected model.
10. Change the Coder model during a running child task.
11. Confirm the running child remains on its snapshot and the next child uses the new model.
12. Deny `task` permission and confirm delegation is rejected.
13. Reset block A and confirm block B is unchanged.
14. Remove and restore/remount block A and confirm its historical session remains host-side.
