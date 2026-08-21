# Block Composition of Plugins, Skills, and Tools

Status: architecture plan, 2026-08-21

## Decision

A Block is an authoring composition keyed by `Functionality.ID`, not a new executable runtime that owns plugins, skills, tools, permissions, or Sessions.

```ts
interface BlockDefinition {
  readonly manifest: Functionality.Manifest
  readonly host?: Plugin.Plugin
  readonly skills?: readonly Skill.Source[]
  readonly tools?: Readonly<Record<string, Tool.AnyTool>>
}
```

Activation hands each facet to its existing owner:

- manifest: functionality registry;
- plugin: one Location-scoped plugin scope;
- skills: `SkillV2` replayable source transforms;
- tools: scoped canonical `Tools.Service` registrations;
- durable block configuration: `FunctionalityInstance.Service`;
- client rendering: `BlockRuntimeRegistration` and `BlockRuntimeHost`;
- layout: only `{ id, functionality, transform }`.

Mounting or unmounting a visual Block never loads or unloads its plugin, skills, or tools. Closing/replacing the owning plugin removes its active contributions while preserving layout references and instance data for recovery.

## Why this shape

The repository already has the correct lifecycle owners. A unified Block runtime would duplicate `PluginV2`, `SkillV2`, `ToolRegistry`, `PermissionV2`, Functionality instance persistence, and client runtime disposal. Treating every mounted Block as a plugin would also couple shared Location capabilities to view count.

The current gaps are registration and identity gaps instead:

- server functionality definitions are a static array;
- `workspace.pluginIDs` are incorrectly projected one-for-one as functionality IDs;
- client presentation/runtime registrations are duplicated across tables;
- V2 plugin context exposes skills but not canonical tools or functionality contributions;
- workspace plugin/skill arrays are persisted selectors but do not activate those lifecycles;
- the rich `Functionality.Manifest` and live `FunctionalityInstance` shapes are not yet reconciled.

## Lifecycle matrix

| Facet | Owner and lifetime | Removal effect |
| --- | --- | --- |
| Layout block | Workspace layout | Removes presentation reference only |
| Functionality instance | Durable workspace/block/functionality row | Tombstones configuration; backing domain data survives |
| Renderer handle | Mounted client block | Disposes only subscriptions and view resources |
| Plugin | Location plugin scope | Removes that plugin's active registrations |
| Skills | Replayable `SkillV2` transforms | Rebuilds effective skill sources |
| Tools | Scoped canonical registry | Reveals the previous overlay; stale advertised calls fail |
| Agent permissions | Selected Location agent and Session | Re-evaluated at execution |

## Phased delivery plan

### Phase 0 — Align identity and persistence contracts

- Add a branded, namespaced `Functionality.ID` and serializable owner (`builtin` or `pluginID`) in `packages/schema/src/functionality.ts`.
- Reuse the ID in `Workspace.Block.Record.functionality` and `Workspace.Functionality.Info.id` while keeping the existing minimal wire projection.
- Reconcile schema `Functionality.Instance` with the live Core instance fields before exposing a generic instance API.
- Freeze workspace capability placement: the workspace primary directory supplies the Location for plugin, skill, tool, and agent resolution.
- Add schema tests for namespacing, owner association, and layout purity.

### Phase 1 — Real Core functionality registry

- Extract the built-in array from `packages/core/src/workspace/service.ts` into a registry that stores `{ manifest, owner }` contributions.
- Make functionality listing and layout validation query that registry.
- Stop treating each `workspace.pluginIDs` entry as a fake functionality.
- Permit one plugin to contribute zero, one, or many functionality IDs.
- Preserve stale saved layouts as unavailable instead of deleting layout or instance data.
- Test duplicate IDs, disabled owners, multi-functionality plugins, and stale layout hydration.

### Phase 2 — Consolidate trusted client modules

- Replace `FUNCTIONALITY_BY_TYPE`, `MODULES`, and `BLOCK_REGISTRATIONS` with one app-local module table containing ID, presentation metadata, renderer, and optional runtime registration.
- Keep client modules compile-time and trusted; do not implement dynamic remote renderers yet.
- Keep `BlockRuntimeHost` unchanged.
- Test one client module per server built-in, unavailable rendering, multi-instance isolation, and view unmount independence from host capabilities.

### Phase 3 — Plugin-owned functionality and skill contributions

- Add `ctx.functionality.register(contribution)` to Effect and Promise plugin contexts with plugin-scope cleanup.
- Continue using the existing `ctx.skill.transform`; do not invent another skill lifecycle.
- Add `defineBlock()` only as a thin authoring helper that expands into the independent registrations.
- Route activation through `LocationServiceMap`; do not make global `WorkspaceService` own Location services.
- Test plugin add/replace/remove, catalog invalidation, preserved instance data, and scoped skill cleanup.

### Phase 4 — Canonical plugin tools

- Keep one opaque canonical Tool representation; do not adapt legacy Zod tools into a second executable type.
- Move the canonical opaque carrier to a lower-level package if necessary to avoid a `plugin -> core -> plugin` dependency cycle.
- Add `ctx.tool.register(tools)` and forward directly to Location `Tools.Service.register`.
- Keep leaf `PermissionV2.assert` as execution authority; palette visibility is only an affordance.
- Test scoped registration, overlay restoration, stale calls, permission enforcement, and independence from Block mount/unmount.

### Phase 5 — Workspace activation selectors

- Define exact identities before wiring `Workspace.pluginIDs` and `Workspace.skillIDs`; skills currently use name-based last-wins identity.
- Activate selected plugin/skill contributions in the workspace primary Location.
- Publish semantic invalidation events so the palette and unavailable Blocks re-resolve.
- Regenerate clients from `packages/client` after any public Protocol or HttpApi change; never hand-edit generated output.

## Explicit non-goals

- Dynamic or untrusted renderer loading.
- A second Block-owned authorization system.
- Block-mount-driven plugin/tool/skill activation.
- Storing plugin modules, skill contents, tool definitions, grants, Session IDs, or renderer state in layout or Functionality instance configuration.
- The generic operation scheduler, context broker, artifact service, and supervisor described by the full future Functionality architecture; those remain separate increments.

## Acceptance criteria

- Layout purity remains mechanically enforced.
- One plugin can contribute multiple Blocks and shared skills/tools exactly once per Location.
- Two mounted instances share host contributions but own independent renderer handles and durable instance rows.
- Plugin replacement/removal changes availability without erasing layout or instance data.
- Skill availability continues to follow agent permissions.
- Tool visibility never bypasses leaf authorization.
- Server and client functionality catalogs have deterministic mismatch behavior.
- No dependency edge violates Schema -> Core/Protocol -> Server or Client -> Schema/Protocol.
