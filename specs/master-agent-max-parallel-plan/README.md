# MasterAgent Maximum-Parallel Implementation Package

Target repository: opencode fork, branch `feature/UnrealViewer`.

This revision is optimized for the largest practical number of independent coding subagents without allowing shared-file races.

## Parallelism profile

- **43 standalone tracks**
- **28 leaf tracks can start immediately**
- **9 composition tracks** own shared integration files
- **1 hard serial track:** `P3 → G1` protocol composition followed by SDK regeneration
- **1 post-generation app adapter:** `M5`
- **4 independent verification/release tracks**

The key optimization is interface-first development: leaf agents code against the frozen contracts in `02-contracts-and-data-model.md`, use local fakes when an implementation has not merged, and never wait merely for another package's concrete implementation. Shared existing files are edited only by named composition tracks.

## Package map

| File | Purpose |
| --- | --- |
| `00-complete-plan.md` | Full design, all 43 tracks, dependency graph, merge order, and hotspots. |
| `01-architecture-decisions.md` | Frozen product and architecture decisions. |
| `02-contracts-and-data-model.md` | Normative cross-track schemas and handwritten port interfaces. |
| `03-merge-sequencing.md` | Start-now dispatch, lane merge trains, and final integration order. |
| `04-conflicts-and-file-ownership.md` | Exclusive shared-file ownership and conflict rules. |
| `05-verification-and-acceptance.md` | Package checks, acceptance tests, negative assertions, and smoke test. |
| `06-risks-and-open-questions.md` | Risks, defaults, and decisions that may be revisited. |
| `07-dispatch-manifest.md` | One-row dispatch manifest for every subagent. |
| `tracks/*.md` | Complete standalone assignment for one coding subagent. |

## Dispatch immediately

The following **28 tracks may begin from the same repository baseline**. They must obey their merge prerequisites, but they do not need to wait to write code:

- **Contracts:** C0, C1
- **Core persistence:** D1, D2, D3
- **Core lifecycle:** F1, F2, F3, E1
- **Protocol:** P1, P2
- **Server:** S1
- **Coder host:** R1, R2, R3, R4, R5
- **Session UI:** U1, U2, U3
- **Canvas manager:** M1, M2, M3, M4
- **Block UI:** B1, B2, Q1
- **Canvas integration:** I1

The composition agents may inspect and scaffold early, but they merge only after their leaf inputs are available.

## Only hard execution sequence

```text
P1 workspace Coder protocol ─┐
                             ├─> P3 protocol composition ─> G1 SDK regeneration ─> M5 SDK adapter
P2 MasterAgent protocol ─────┘
```

`G1` must start from the exact frozen `P3` commit. No other track may edit generated SDK output.

## Track index

| Track | Class | Lane | Assignment | Download |
| --- | --- | --- | --- | --- |
| C0 | START NOW | Contracts | Workspace Coder Schema | [tracks/C0-workspace-coder-schema.md](tracks/C0-workspace-coder-schema.md) |
| C1 | START NOW | Contracts | MasterAgent Domain Schema | [tracks/C1-master-agent-schema.md](tracks/C1-master-agent-schema.md) |
| C2 | COMPOSITION | Contracts | Schema Export Integration | [tracks/C2-schema-export-integration.md](tracks/C2-schema-export-integration.md) |
| D1 | START NOW | Core persistence | Workspace Database Migration | [tracks/D1-workspace-database-migration.md](tracks/D1-workspace-database-migration.md) |
| D2 | START NOW | Core persistence | Workspace Coder Persistence Codec | [tracks/D2-workspace-coder-persistence-codec.md](tracks/D2-workspace-coder-persistence-codec.md) |
| D3 | START NOW | Core persistence | MasterAgent Built-in Descriptor | [tracks/D3-master-agent-builtin-descriptor.md](tracks/D3-master-agent-builtin-descriptor.md) |
| D4 | COMPOSITION | Core persistence | Workspace Service Integration | [tracks/D4-workspace-service-integration.md](tracks/D4-workspace-service-integration.md) |
| F1 | START NOW | Core lifecycle | Functionality Instance Repository | [tracks/F1-functionality-instance-repository.md](tracks/F1-functionality-instance-repository.md) |
| F2 | START NOW | Core lifecycle | MasterAgent Binding State Machine | [tracks/F2-master-agent-binding-state-machine.md](tracks/F2-master-agent-binding-state-machine.md) |
| F3 | START NOW | Core lifecycle | MasterAgent Session Adapter | [tracks/F3-master-agent-session-adapter.md](tracks/F3-master-agent-session-adapter.md) |
| E1 | START NOW | Core lifecycle | MasterAgent Binding Events | [tracks/E1-master-agent-binding-events.md](tracks/E1-master-agent-binding-events.md) |
| F4 | COMPOSITION | Core lifecycle | MasterAgent Lifecycle Service | [tracks/F4-master-agent-lifecycle-service.md](tracks/F4-master-agent-lifecycle-service.md) |
| P1 | START NOW | Protocol | Workspace Coder Protocol Fragment | [tracks/P1-workspace-coder-protocol.md](tracks/P1-workspace-coder-protocol.md) |
| P2 | START NOW | Protocol | MasterAgent Protocol Group | [tracks/P2-master-agent-protocol.md](tracks/P2-master-agent-protocol.md) |
| P3 | COMPOSITION | Protocol | Protocol Composition | [tracks/P3-protocol-composition.md](tracks/P3-protocol-composition.md) |
| G1 | SERIAL | Generated SDK | SDK Regeneration | [tracks/G1-sdk-regeneration.md](tracks/G1-sdk-regeneration.md) |
| S1 | START NOW | Server | MasterAgent Handler Module | [tracks/S1-master-agent-handlers.md](tracks/S1-master-agent-handlers.md) |
| S2 | COMPOSITION | Server | Server and Event Bridge Composition | [tracks/S2-server-composition.md](tracks/S2-server-composition.md) |
| R1 | START NOW | Coder host | MasterAgent Session Context Resolver | [tracks/R1-master-agent-session-context.md](tracks/R1-master-agent-session-context.md) |
| R2 | START NOW | Coder host | Coder Routing Policy | [tracks/R2-coder-routing-policy.md](tracks/R2-coder-routing-policy.md) |
| R3 | START NOW | Coder host | Reusable Child Task Runner | [tracks/R3-child-task-runner.md](tracks/R3-child-task-runner.md) |
| R4 | START NOW | Coder host | Reserved Coder Agent Definition | [tracks/R4-coder-agent-definition.md](tracks/R4-coder-agent-definition.md) |
| R5 | START NOW | Coder host | Coder Delegation Tool | [tracks/R5-coder-task-tool.md](tracks/R5-coder-task-tool.md) |
| R6 | COMPOSITION | Coder host | Coder Host Integration | [tracks/R6-coder-host-integration.md](tracks/R6-coder-host-integration.md) |
| U1 | START NOW | Session UI | Session Target and Scope Primitives | [tracks/U1-session-target-and-scope.md](tracks/U1-session-target-and-scope.md) |
| U2 | START NOW | Session UI | Route-independent Session Surface Extraction | [tracks/U2-session-surface-extraction.md](tracks/U2-session-surface-extraction.md) |
| U3 | START NOW | Session UI | Canvas Session Multi-instance Adapter | [tracks/U3-session-multi-instance-adapters.md](tracks/U3-session-multi-instance-adapters.md) |
| M1 | START NOW | Canvas manager | MasterAgent Client Domain and Reducer | [tracks/M1-master-agent-client-domain.md](tracks/M1-master-agent-client-domain.md) |
| M2 | START NOW | Canvas manager | MasterAgent Lifecycle Controller | [tracks/M2-master-agent-lifecycle-controller.md](tracks/M2-master-agent-lifecycle-controller.md) |
| M3 | START NOW | Canvas manager | MasterAgent Event Reconciliation | [tracks/M3-master-agent-event-reconciliation.md](tracks/M3-master-agent-event-reconciliation.md) |
| M4 | START NOW | Canvas manager | Workspace Coder Settings Controller | [tracks/M4-master-agent-coder-controller.md](tracks/M4-master-agent-coder-controller.md) |
| M5 | POST-GEN | Canvas manager | Generated SDK Adapter | [tracks/M5-master-agent-sdk-adapter.md](tracks/M5-master-agent-sdk-adapter.md) |
| M6 | COMPOSITION | Canvas manager | Canvas Manager Integration | [tracks/M6-canvas-manager-integration.md](tracks/M6-canvas-manager-integration.md) |
| B1 | START NOW | Block UI | MasterAgent Presentational Shell | [tracks/B1-master-agent-presentational-ui.md](tracks/B1-master-agent-presentational-ui.md) |
| B2 | START NOW | Block UI | Workspace Coder Selector UI | [tracks/B2-coder-selector-ui.md](tracks/B2-coder-selector-ui.md) |
| Q1 | START NOW | Block UI | Queue Integration Adapter and Tests | [tracks/Q1-queue-integration.md](tracks/Q1-queue-integration.md) |
| B3 | COMPOSITION | Block UI | MasterAgent Block Composition | [tracks/B3-master-agent-block-composition.md](tracks/B3-master-agent-block-composition.md) |
| I1 | START NOW | Canvas integration | Client Functionality Descriptor | [tracks/I1-client-functionality-registration.md](tracks/I1-client-functionality-registration.md) |
| I2 | COMPOSITION | Canvas integration | Canvas Renderer Integration | [tracks/I2-canvas-renderer-integration.md](tracks/I2-canvas-renderer-integration.md) |
| V1 | VERIFY | Verification | Core and Server Integration Tests | [tracks/V1-core-server-integration-tests.md](tracks/V1-core-server-integration-tests.md) |
| V2 | VERIFY | Verification | Coder Routing Integration Tests | [tracks/V2-coder-routing-integration-tests.md](tracks/V2-coder-routing-integration-tests.md) |
| V3 | VERIFY | Verification | App Canvas Integration Tests | [tracks/V3-app-canvas-integration-tests.md](tracks/V3-app-canvas-integration-tests.md) |
| V4 | VERIFY | Release | Full Regression Gate and Documentation | [tracks/V4-full-regression-and-docs.md](tracks/V4-full-regression-and-docs.md) |

## Recommended dispatch payload

For a leaf subagent, provide:

```text
1. Its track file
2. 01-architecture-decisions.md
3. 02-contracts-and-data-model.md
4. The exact common baseline commit
```

For a composition subagent, also provide:

```text
5. 03-merge-sequencing.md
6. 04-conflicts-and-file-ownership.md
7. The named leaf commit hashes
```

Every subagent should return one focused commit and a completion note containing changed files, commands run, assumptions, contract deviations, and readiness state.
