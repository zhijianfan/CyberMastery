# Track A0 — Shared Contracts

## Mission

Freeze all cross-package schemas and public types required by the MasterAgent feature so the remaining subagents can work independently against stable contracts.

Target branch: `feature/UnrealViewer`.

## Dependencies

None. This track must merge first.

## Files

### Modify

```text
packages/schema/src/workspace.ts
packages/schema/src/index.ts
```

### Create

```text
packages/schema/src/master-agent.ts
```

Adapt export paths to the package's existing barrel structure if needed, but do not spread the new schemas across unrelated files.

## Required implementation

1. Add nullable `coderModel` to `Workspace.Info` using exactly the same Effect Schema and encoded model-selection type as the existing `model` field.
2. Add optional nullable `coderModel` to the workspace patch/update schema.
3. Add the `builtin:master-agent` functionality ID constant.
4. Define MasterAgent functionality-instance configuration:
   - `version: 1`
   - directory binding
   - server-managed optional session binding
5. Define the binding projection returned to clients.
6. Define get/ensure/reset request and response schemas.
7. Define the transient `workspace.master-agent.binding.updated` EventV2 payload.
8. Export all types through the schema package's normal public entry point.

Use `02-contracts-and-data-model.md` as the authoritative semantic contract.

## Important boundaries

- Do not implement SQL, migrations, services, protocol routes, handlers, or UI.
- Do not invent a new provider/model encoding for `coderModel`.
- Do not make `sessionBinding` publicly writable through a generic configuration patch schema.
- Do not include a MasterAgent-specific prompt API. Prompts use the existing Session API.
- Do not add a per-block Coder-model override.

## Suggested schema concepts

```ts
Workspace.Info.coderModel: ModelSelection | null
Workspace.Patch.coderModel?: ModelSelection | null

MasterAgent.FunctionalityID = "builtin:master-agent"
MasterAgent.InstanceConfiguration
MasterAgent.Binding
MasterAgent.GetRequest
MasterAgent.EnsureRequest
MasterAgent.ResetRequest
MasterAgent.BindingUpdatedEvent
```

Names should follow repository conventions, but the semantics must match.

## Verification

```bash
bun --cwd packages/schema typecheck
```

Add focused schema encode/decode tests if the package already has a test convention for new fields or discriminated events.

## Deliverable

One mergeable commit that establishes stable public contracts. Include a concise commit note listing the exact exported names so dependent tracks can import them without reading the implementation.

## Merge notes

This track owns `packages/schema/src/workspace.ts`. No later track may change the `coderModel` type or MasterAgent public contract without a coordinated contract revision and SDK regeneration.
