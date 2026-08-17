# Complete Workspace — MasterAgent Maximum-Parallel Implementation Plan

Target repository: opencode fork, branch `feature/UnrealViewer`.

## Goal

Implement `builtin:master-agent` as a canvas block that embeds the original opencode Session surface, owns a durable host-side top-level Session, reuses the existing host queue delivery path, and optionally delegates coding execution to a workspace-selected Coder model.

## Design decisions

### Coder routing

Use host-side child-session delegation. The primary remains on the workspace model and coordinates. With Coder enabled, repository mutation and coding shell execution are removed from the primary's effective agent tools and routed through a reserved Coder tool. The host resolves the child model, directory, workspace, parent, agent, and permissions. No browser classification or silent fallback.

### Coder persistence

Add nullable `Workspace.Info.coderModel` beside `model` and `operatingAgent`, following schema → SQL → service → protocol → generated SDK. It is workspace-wide in v1, not per-block and not tuple-scoped. `null` disables Coder mode.

### Session ownership

A host functionality instance keyed by `(workspaceID, blockID, "builtin:master-agent")` owns one active top-level Session binding. Layout stores presentation only. Ensure is idempotent; reset uses expected session/revision and is allowed only when idle with no pending inputs.

### Queue integration

The embedded explicit-target Session surface reuses the current composer. Queue sends `delivery: "queue"` directly to host admission; existing Session events/projected state show admission and promotion. No block/manager/browser queue is introduced.

## Parallelization result

This plan contains **43 standalone tracks**:

```text
28 START NOW
 9 COMPOSITION
 1 SERIAL generated-SDK track
 1 POST-GEN SDK adapter
 4 VERIFY/release tracks
```

The 28 leaf agents can begin from one baseline because the handwritten interfaces are frozen in `02-contracts-and-data-model.md`. Shared existing files are reserved for composition tracks, eliminating cross-agent edit collisions.

## All tracks

| ID | Class | Scope | Final merge prerequisites | Primary verification |
| --- | --- | --- | --- | --- |
| C0 | START NOW | Workspace Coder Schema | None; C2 later publishes the combined schema exports. | bun --cwd packages/schema typecheck<br>bun test packages/schema/test/workspace-coder-model.test.ts |
| C1 | START NOW | MasterAgent Domain Schema | None; C2 later adds the package-level exports. | bun --cwd packages/schema typecheck<br>bun test packages/schema/test/master-agent.test.ts |
| C2 | COMPOSITION | Schema Export Integration | C0 and C1. | bun --cwd packages/schema typecheck<br>bun test packages/schema/test/master-agent-public-exports.test.ts |
| D1 | START NOW | Workspace Database Migration | C0 before final typecheck; D4 consumes the result. | bun --cwd packages/core typecheck<br>bun test packages/core/test/database/master-agent-migration.test.ts |
| D2 | START NOW | Workspace Coder Persistence Codec | C0 and D1 before D4 integrates it. | bun --cwd packages/core typecheck<br>bun test packages/core/test/workspace/coder-model-codec.test.ts |
| D3 | START NOW | MasterAgent Built-in Descriptor | C1 before typecheck; D4 registers the descriptor. | bun --cwd packages/core typecheck<br>bun test packages/core/test/workspace/master-agent-builtin.test.ts |
| D4 | COMPOSITION | Workspace Service Integration | C0, D1, D2, and D3. | bun --cwd packages/core typecheck<br>bun test packages/core/test/workspace/workspace-coder-model.integration.test.ts |
| F1 | START NOW | Functionality Instance Repository | D1 if new SQL support is needed; F4 consumes the repository. | bun --cwd packages/core typecheck<br>bun test packages/core/test/functionality/instance-repository.test.ts |
| F2 | START NOW | MasterAgent Binding State Machine | C1 before typecheck; F4 consumes it. | bun --cwd packages/core typecheck<br>bun test packages/core/test/workspace/master-agent-binding.test.ts |
| F3 | START NOW | MasterAgent Session Adapter | C1 before typecheck; F4 consumes it. | bun --cwd packages/core typecheck<br>bun test packages/core/test/workspace/master-agent-session-adapter.test.ts |
| E1 | START NOW | MasterAgent Binding Events | C1 before typecheck; F4 emits through it and S2 bridges it. | bun --cwd packages/core typecheck<br>bun test packages/core/test/workspace/master-agent-events.test.ts |
| F4 | COMPOSITION | MasterAgent Lifecycle Service | C1, D3, F1, F2, F3, and E1; D4 for authoritative workspace/functionality lookup. | bun --cwd packages/core typecheck<br>bun test packages/core/test/workspace/master-agent.test.ts |
| P1 | START NOW | Workspace Coder Protocol Fragment | C0 before typecheck; P3 composes it. | bun --cwd packages/protocol typecheck<br>bun test packages/protocol/test/workspace-coder.test.ts |
| P2 | START NOW | MasterAgent Protocol Group | C1 before typecheck; P3 mounts the group. | bun --cwd packages/protocol typecheck<br>bun test packages/protocol/test/workspace-master-agent.test.ts |
| P3 | COMPOSITION | Protocol Composition | C2, P1, and P2. | bun --cwd packages/protocol typecheck<br>bun test packages/protocol/test/workspace-master-agent-composition.test.ts |
| G1 | SERIAL | SDK Regeneration | P3. | node packages/sdk/js/script/build.ts<br>node packages/sdk/js/script/build.ts |
| S1 | START NOW | MasterAgent Handler Module | P2 and F4 before final typecheck; S2 mounts the handlers. | bun --cwd packages/server typecheck<br>bun test packages/server/test/handlers/workspace-master-agent.test.ts |
| S2 | COMPOSITION | Server and Event Bridge Composition | D4, E1, F4, P3, and S1. | bun --cwd packages/server typecheck<br>bun --cwd packages/opencode typecheck |
| R1 | START NOW | MasterAgent Session Context Resolver | D4 and F4 before final integration; R5/R6 consume it. | bun --cwd packages/opencode typecheck<br>bun test packages/opencode/test/session/master-agent-context.test.ts |
| R2 | START NOW | Coder Routing Policy | R6 consumes it. | bun --cwd packages/opencode typecheck<br>bun test packages/opencode/test/session/master-agent-policy.test.ts |
| R3 | START NOW | Reusable Child Task Runner | R5 consumes the runner. | bun --cwd packages/opencode typecheck<br>bun test packages/opencode/test/tool/task-runner.test.ts |
| R4 | START NOW | Reserved Coder Agent Definition | R6 registers it; R5 uses its identifier. | bun --cwd packages/opencode typecheck<br>bun test packages/opencode/test/agent/coder.test.ts |
| R5 | START NOW | Coder Delegation Tool | R1, R2, R3, and R4 before final integration; R6 registers the tool. | bun --cwd packages/opencode typecheck<br>bun test packages/opencode/test/tool/coder-task.test.ts |
| R6 | COMPOSITION | Coder Host Integration | D4, F4, R1, R2, R3, R4, and R5. | bun --cwd packages/opencode typecheck<br>bun test packages/opencode/test/session/master-agent-coder-integration.test.ts |
| U1 | START NOW | Session Target and Scope Primitives | U2/U3 consume the primitives. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/canvas/session-target.test.tsx |
| U2 | START NOW | Route-independent Session Surface Extraction | U1 before final typecheck; U3 wraps the base surface. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/session-surface-base.test.tsx |
| U3 | START NOW | Canvas Session Multi-instance Adapter | U1 and U2 before final typecheck; B3 consumes it. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/canvas/session-surface.test.tsx |
| M1 | START NOW | MasterAgent Client Domain and Reducer | C2 before replacing any local aliases; M2–M5 consume this module. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/canvas/master-agent/reducer.test.ts |
| M2 | START NOW | MasterAgent Lifecycle Controller | M1 before final typecheck; M6 composes it. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/canvas/master-agent/lifecycle-controller.test.ts |
| M3 | START NOW | MasterAgent Event Reconciliation | M1 before final typecheck; M6 mounts it. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/canvas/master-agent/event-reconciliation.test.ts |
| M4 | START NOW | Workspace Coder Settings Controller | M1 before final typecheck; M6/B2 consume it. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/canvas/master-agent/coder-controller.test.ts |
| M5 | POST-GEN | Generated SDK Adapter | G1 and M1. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/canvas/master-agent/sdk-port.test.ts |
| M6 | COMPOSITION | Canvas Manager Integration | M1, M2, M3, M4, and M5. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/canvas/master-agent/manager-integration.test.ts |
| B1 | START NOW | MasterAgent Presentational Shell | B3 composes it. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/canvas/master-agent/block-shell.test.tsx |
| B2 | START NOW | Workspace Coder Selector UI | M4 before final composition; B3 mounts it. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/canvas/master-agent/coder-selector.test.tsx |
| Q1 | START NOW | Queue Integration Adapter and Tests | U3 before final typecheck; B3 consumes the options. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/canvas/master-agent/queue.test.tsx |
| B3 | COMPOSITION | MasterAgent Block Composition | U3, M6, B1, B2, and Q1. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/canvas/master-agent/block.test.tsx |
| I1 | START NOW | Client Functionality Descriptor | C1 before typecheck; I2 registers the descriptor. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/canvas/master-agent/functionality.test.ts |
| I2 | COMPOSITION | Canvas Renderer Integration | D3, B3, and I1. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/canvas/master-agent.integration.test.tsx |
| V1 | VERIFY | Core and Server Integration Tests | D4, F4, P3, and S2. | bun --cwd packages/core typecheck<br>bun --cwd packages/server typecheck |
| V2 | VERIFY | Coder Routing Integration Tests | D4, F4, and R6. | bun --cwd packages/opencode typecheck<br>bun test packages/opencode/test/integration/master-agent-coder.test.ts |
| V3 | VERIFY | App Canvas Integration Tests | U3, M6, B3, and I2. | bun --cwd packages/app typecheck<br>bun test packages/app/src/pages/canvas/master-agent.e2e.test.tsx |
| V4 | VERIFY | Full Regression Gate and Documentation | All production and V1–V3 tracks. | bun --cwd packages/schema typecheck<br>bun --cwd packages/core typecheck |

## Start-now set

```text
C0 C1 D1 D2 D3 F1 F2 F3 E1 P1 P2 S1 R1 R2 R3 R4 R5 U1 U2 U3 M1 M2 M3 M4 B1 B2 Q1 I1
```

These agents may use local fakes/ports and must not wait for concrete upstream code.

## Dependency graph

```text
C0 + C1 -> C2

D1 + D2 + D3 -> D4
F1 + F2 + F3 + E1 + D4 -> F4

P1 + P2 -> P3 -> G1 -> M5

S1 + D4 + F4 + E1 + P3 -> S2

R1 + R2 + R3 + R4 + R5 + D4 + F4 -> R6

U1 + U2 -> U3

M1 + M2 + M3 + M4 + M5 -> M6

B1 + B2 + Q1 + U3 + M6 -> B3
I1 + B3 + D3 -> I2

D4 + F4 + P3 + S2 -> V1
D4 + F4 + R6 -> V2
U3 + M6 + B3 + I2 -> V3
V1 + V2 + V3 + all production tracks -> V4
```

Only `P3 → G1` is a hard no-start sequence. M5 waits for G1; every other dependent implementation can be written against frozen ports before its merge prerequisites arrive.

## Merge order

1. Merge `C0`, `C1`, then `C2`.
2. Build the core lane: merge D/F/E leaves, then `D4`, then `F4`.
3. Merge `P1`, `P2`, `P3`; freeze protocol; run `G1`.
4. Merge `S1`, then `S2`.
5. Merge R leaves, then `R6`.
6. Merge `U1`, `U2`, then `U3`.
7. Merge M leaves; after G1 merge `M5`; then `M6`.
8. Merge B/Q/I leaves, then `B3`, then `I2`.
9. Run `V1`, `V2`, and `V3` independently.
10. Run `V4` as the final release gate.

## Shared-file hotspots

| Shared file | Only owner | Purpose |
| --- | --- | --- |
| `packages/schema/src/workspace.ts` | C0 | Workspace `coderModel` schema only |
| `packages/schema/src/index.ts` | C2 | Schema public exports |
| `packages/core/src/workspace/sql.ts` | D1 | SQL column definition |
| `packages/core/src/database/migration.gen.ts` | D1 | Migration registration |
| `packages/core/src/database/schema.gen.ts` | D1 | Baseline schema |
| `packages/core/src/workspace/service.ts` | D4 | Coder field wiring and built-in array |
| `packages/protocol/src/groups/workspace.ts` | P3 | Protocol composition |
| `packages/protocol/src/index.ts` | P3 | Protocol export composition |
| `packages/sdk/js/src/**` | G1 | Generated output only |
| `packages/server/src/handlers/workspace.ts` | S2 | Handler composition |
| `packages/opencode/src/server/event-v2.ts` | S2 | Binding event bridge |
| `packages/opencode/src/tool/task.ts` | R3 | Child runner extraction |
| `packages/opencode/src/session/prompt.ts` | R6 | Tool policy/injection |
| `packages/opencode/src/agent/agent.ts` | R6 | Reserved agent registration |
| `packages/app/src/pages/session.tsx` | U2 | Routed Session extraction |
| `packages/app/src/pages/canvas/manager.ts` | M6 | Manager composition |
| `packages/app/src/pages/canvas/workspace.tsx` | I2 | Client registration/rendering |
| `UIDesign.md` | V4 | Final documented behavior |

The existing queue-capable prompt-input implementations are deliberately not modified.

## Acceptance summary

- New functionality is registered server-side and client-side.
- Two blocks own distinct durable Sessions and reconnect without duplication.
- Original Session messages/composer/terminal/files/review surface works inside each block.
- Queue is host-admitted, durable, ordered, and never browser-held.
- `coderModel` persists end to end.
- Parent remains on primary; coding execution runs in a Coder child with a host-resolved model snapshot.
- Direct primary mutation is unavailable only while Coder mode is enabled.
- `task` permission and workspace isolation are enforced on host and reflected in UI.
- Unavailable model fails visibly without fallback.
- Existing Session page and `builtin:chat` remain functional.
- All typechecks/tests pass, SDK generation is idempotent, and app build succeeds.

## Files in this package

Use `README.md` for navigation, `07-dispatch-manifest.md` for assignment, and a track file under `tracks/` as the complete prompt for each subagent.
