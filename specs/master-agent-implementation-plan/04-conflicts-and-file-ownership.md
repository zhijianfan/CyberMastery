# MasterAgent Conflict Management and File Ownership

Target branch: `feature/UnrealViewer`.

The feature is deliberately split so most tracks create new files. Shared files have one exclusive owner. Other tracks must consume the owner's exported interface rather than editing the same file.

## Exclusive ownership table

| Shared file or area | Owner | Rule |
|---|---|---|
| `packages/schema/src/workspace.ts` | A0 | No later track changes the `coderModel` field shape. |
| `packages/schema/src/master-agent.ts` | A0 | Public MasterAgent schemas are frozen before parallel work. |
| `packages/core/src/workspace/service.ts` | B1 | B1 owns workspace persistence changes and the built-in registry edit. |
| `packages/core/src/workspace/sql.ts` | B1 | No other track adds workspace columns. |
| Migration file, `migration.gen.ts`, `schema.gen.ts` | B1 | One track assigns the timestamp and updates all hand-maintained migration metadata. |
| Functionality-instance/session lifecycle modules | B2 | B2 owns binding, ensure, reset, and event-domain logic. |
| `packages/protocol/src/groups/workspace.ts` | P1 | All protocol composition edits land before SDK generation. |
| `packages/sdk/js/src/**` generated output | G1 | Generated files are never hand-edited. |
| `packages/server/src/handlers/workspace.ts` | S1 | New logic stays in `workspace-master-agent.ts`; the shared file only wires it in. |
| `packages/opencode/src/session/prompt.ts` | R1 | All Coder policy injection in this file is handled by one branch. |
| `packages/opencode/src/tool/task.ts` | R1 | Task/Coder delegation changes are not split across tracks. |
| `packages/app/src/pages/session.tsx` | U1 | U1 extracts the reusable surface; later tracks only consume it. |
| `packages/app/src/pages/canvas/manager.ts` | M2 | M1 works entirely in new controller/port files. |
| `packages/app/src/pages/canvas/workspace.tsx` | I1 | No other track registers or renders MasterAgent directly in this file. |
| `packages/app/src/pages/canvas/master-agent/index.ts` | I1 | Subtracks import their modules directly and avoid competing barrel edits. |
| Existing prompt-input implementations | No MasterAgent track | Reuse unchanged; a required edit is an architecture review stop. |

## Files that should remain untouched

The existing queue-capable composer paths should be reused without forking:

```text
packages/app/src/components/prompt-input.tsx
packages/session-ui/src/v2/components/prompt-input/**
```

If a subagent concludes that one of these files must change, it must first prove that the reusable session surface cannot supply the correct session target, busy state, and `queueEnabled` option. The default assumption is that no change is required.

## New-file boundaries

Use the following module boundaries to keep tracks independent:

```text
packages/app/src/pages/canvas/master-agent/
  types.ts                 M1
  port.ts                  M1
  reducer.ts               M1
  controller.ts            M1
  sdk-port.ts              M2
  session-options.ts       Q1
  coder-selector.tsx       C1
  block.tsx                U2
  loading.tsx              U2
  master-agent.css         U2
  index.ts                 I1
```

```text
packages/core/src/workspace/
  master-agent.ts          B2
```

```text
packages/server/src/handlers/
  workspace-master-agent.ts  S1
```

```text
packages/protocol/src/groups/
  workspace-master-agent.ts  P1
```

```text
packages/opencode/src/session/
  master-agent-policy.ts   R1
```

```text
packages/opencode/src/tool/
  coder-task.ts            R1
```

## Conflict-resolution rules

1. Rebase a track onto its declared dependency before merging.
2. Preserve the exclusive owner's implementation in shared files.
3. Move competing logic into a new module and compose it through the owner's integration point.
4. Do not regenerate the SDK outside G1.
5. Do not assign a second migration timestamp for the same field.
6. Do not move session state into `workspace.tsx`, layout JSON, or an app-local persistence store to avoid a backend dependency.
7. Do not duplicate queue logic in the MasterAgent directory.
8. Do not expose a model override in the Coder tool request merely to unblock R1; the host must resolve it.

## Expected small integration edits

The following shared-file edits should remain minimal:

- `workspace.tsx`: import the MasterAgent block and add one functionality/type rendering branch.
- `manager.ts`: instantiate the controller with the generated SDK adapter and expose a small `masterAgent` API.
- `workspace.ts` protocol group: import and register the dedicated MasterAgent group/endpoints.
- `workspace.ts` server handler composition: register the dedicated handler module.
- `session.tsx`: retain routed behavior while delegating rendering to the new explicit-target surface.

Large logic added directly to any of those shared files indicates the separation has failed and should be refactored before merge.
