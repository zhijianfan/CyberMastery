# MasterAgent Verification and Acceptance

Target branch: `feature/UnrealViewer`.

## 1. Package gates

Run the relevant typecheck in every track. The final V4 gate runs:

```bash
bun --cwd packages/schema typecheck
bun --cwd packages/core typecheck
bun --cwd packages/protocol typecheck
bun --cwd packages/server typecheck
bun --cwd packages/sdk/js typecheck
bun --cwd packages/opencode typecheck
bun --cwd packages/app typecheck
```

SDK idempotence:

```bash
node packages/sdk/js/script/build.ts
git status --short
node packages/sdk/js/script/build.ts
git diff --exit-code
```

App production build:

```bash
bun --cwd packages/app run build
```

## 2. Contract and persistence acceptance

- `Workspace.Info.coderModel` uses the same encoded model selection as `Workspace.Info.model`.
- Existing rows load with `coderModel: null`.
- Omitted patch leaves it unchanged; explicit null clears it.
- Migration file, `migration.gen.ts`, and `schema.gen.ts` agree.
- `builtin:master-agent` is present exactly once in the core built-ins registry.
- The client mapping uses the same literal.
- Session binding is not client-writable generic configuration and is absent from layout JSON.

## 3. Session lifecycle acceptance

- Two MasterAgent blocks in one workspace have distinct top-level session IDs.
- Repeated ensure for one block is idempotent.
- Simultaneous ensure leaves one active binding.
- A losing empty candidate is safely removed/archived when supported.
- Reload, reconnect, resize, move, hide, and remount preserve binding.
- Stale reset session/revision is rejected.
- Busy or pending-input reset is rejected.
- Reset changes only the selected block and preserves old Session history.
- Removal/tombstone preserves active work and admitted queue.
- Binding event is emitted only after persistence and only on a real change.
- Missed events recover through authoritative get/ensure.

## 4. Embedded Session surface acceptance

- The routed Session page still renders normally.
- MasterAgent renders messages, composer, terminal, file tree, and review panel.
- Two surfaces can mount simultaneously with no singleton-state collision.
- Keyboard commands affect only the focused surface.
- DOM IDs, portals, terminal mounts, composer focus, and review state are scoped.
- Unmount/remount does not create a new Session.
- `builtin:chat` remains functional.

## 5. Queue acceptance

- Busy embedded composer exposes the existing Queue action.
- Queue submission immediately sends `delivery: "queue"` to the host.
- Steer remains unchanged.
- Pending state comes from existing Session projection/events.
- Reload/remount restores host-admitted pending inputs.
- Promotion preserves order and occurs when the drain would otherwise idle.
- No block-local, manager-local, localStorage, or IndexedDB queue exists.
- Removing the visual block does not discard host-admitted inputs.

Negative searches:

```bash
! rg 'localStorage|indexedDB|followupQueue|clientQueue|holdingQueue' packages/app/src/pages/canvas/master-agent
! rg 'sessionBinding|sessionID.*layout|queue.*layout' packages/app/src/pages/canvas/workspace.tsx
git diff -- packages/app/src/components/prompt-input.tsx
git diff -- packages/session-ui/src/v2/components/prompt-input
```

The two prompt-input diffs should be empty for this feature.

## 6. Coder routing acceptance

- `coderModel = null` preserves current behavior.
- Enabled mode leaves the parent on `workspace.model`.
- Coding execution creates a child Session using the selected Coder model snapshot.
- Host resolves directory, parent, workspace, agent, model, and permissions.
- Model-visible tool arguments cannot supply provider/model/directory/permission/session/workspace overrides.
- Direct primary edit/write/patch/unrestricted coding shell tools are unavailable only in enabled MasterAgent sessions.
- Read/search/context remains available.
- User-operated terminal UI follows existing permissions.
- Changing the workspace Coder model does not alter an active child; the next child uses the new model.
- Unavailable/incompatible model fails visibly with no fallback.
- Denied `task` prevents delegation host-side and is reflected in UI.
- Ordinary sessions and disabled MasterAgent sessions are unchanged.

Suggested public-argument assertion:

```bash
rg -n 'providerID|modelID|directory|workspaceID|parentSessionID|permissionOverride' packages/opencode/src/tool/coder-task.ts
```

Any match must be internal trusted resolution, not part of the model-visible argument schema.

## 7. Access and isolation acceptance

- Workspace/block access is checked before lifecycle calls.
- Wrong functionality ID is rejected.
- Session-to-instance resolution rejects stale, deleted, tombstoned, and cross-workspace bindings.
- Events for another workspace/block are ignored by the manager.
- Workspace switch disposes subscriptions and suppresses stale responses.

## 8. Manual smoke test

1. Add two MasterAgent blocks.
2. Confirm distinct sessions and full Session UI in each.
3. Start a long prompt in block A and submit another with Queue.
4. Reload and confirm queued state remains.
5. Let the first run finish and confirm ordered promotion.
6. Select a Workspace Coder model.
7. Ask for a small code change plus focused test.
8. Confirm a child Coder Session uses the selected model while the parent remains primary.
9. Change Coder model during the child; confirm snapshot behavior.
10. Deny `task`; confirm selector/delegation rejection.
11. Reset block A; confirm block B is unchanged.
12. Remove/remount block A; confirm host Session history and queue were preserved.
13. Open the original routed Session page and legacy chat block to confirm regressions are absent.

## 9. Release blockers

Any of the following blocks merge:

```text
duplicate active binding
session ID persisted in layout
browser/client holding queue
silent Coder fallback
client/model-selected Coder directory/model/permission
cross-workspace access
ordinary Session behavior regression
non-idempotent SDK generation
failed production build
```
