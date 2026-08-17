# MasterAgent Subagent Dispatch Manifest

Target branch: `feature/UnrealViewer`.

## Dispatch classes

- **START NOW:** assign immediately from the common baseline. Upstream concrete code is replaced by local ports/fakes until rebase.
- **COMPOSITION:** may inspect/scaffold now; merges named leaf commits and owns a shared integration file.
- **SERIAL:** must start only after its predecessor is frozen.
- **POST-GEN:** waits specifically for generated SDK output.
- **VERIFY:** creates independent integration tests/docs and must not opportunistically patch production owners' files.

## Common dispatch instruction

Prepend this to each subagent assignment:

```text
Use only the files owned by your track. Do not edit another track's shared file.
Implement against the frozen interfaces in 02-contracts-and-data-model.md.
When an upstream commit is missing, use a local fake/type-only port and continue.
Return one focused commit plus: files changed, commands run, assumptions,
ready-after track IDs, and any contract mismatch.
```

## Manifest

| Track | Class | Lane | Assignment | Final merge prerequisites | File |
| --- | --- | --- | --- | --- | --- |
| C0 | START NOW | Contracts | Workspace Coder Schema | None; C2 later publishes the combined schema exports. | [Open](tracks/C0-workspace-coder-schema.md) |
| C1 | START NOW | Contracts | MasterAgent Domain Schema | None; C2 later adds the package-level exports. | [Open](tracks/C1-master-agent-schema.md) |
| C2 | COMPOSITION | Contracts | Schema Export Integration | C0 and C1. | [Open](tracks/C2-schema-export-integration.md) |
| D1 | START NOW | Core persistence | Workspace Database Migration | C0 before final typecheck; D4 consumes the result. | [Open](tracks/D1-workspace-database-migration.md) |
| D2 | START NOW | Core persistence | Workspace Coder Persistence Codec | C0 and D1 before D4 integrates it. | [Open](tracks/D2-workspace-coder-persistence-codec.md) |
| D3 | START NOW | Core persistence | MasterAgent Built-in Descriptor | C1 before typecheck; D4 registers the descriptor. | [Open](tracks/D3-master-agent-builtin-descriptor.md) |
| D4 | COMPOSITION | Core persistence | Workspace Service Integration | C0, D1, D2, and D3. | [Open](tracks/D4-workspace-service-integration.md) |
| F1 | START NOW | Core lifecycle | Functionality Instance Repository | D1 if new SQL support is needed; F4 consumes the repository. | [Open](tracks/F1-functionality-instance-repository.md) |
| F2 | START NOW | Core lifecycle | MasterAgent Binding State Machine | C1 before typecheck; F4 consumes it. | [Open](tracks/F2-master-agent-binding-state-machine.md) |
| F3 | START NOW | Core lifecycle | MasterAgent Session Adapter | C1 before typecheck; F4 consumes it. | [Open](tracks/F3-master-agent-session-adapter.md) |
| E1 | START NOW | Core lifecycle | MasterAgent Binding Events | C1 before typecheck; F4 emits through it and S2 bridges it. | [Open](tracks/E1-master-agent-binding-events.md) |
| F4 | COMPOSITION | Core lifecycle | MasterAgent Lifecycle Service | C1, D3, F1, F2, F3, and E1; D4 for authoritative workspace/functionality lookup. | [Open](tracks/F4-master-agent-lifecycle-service.md) |
| P1 | START NOW | Protocol | Workspace Coder Protocol Fragment | C0 before typecheck; P3 composes it. | [Open](tracks/P1-workspace-coder-protocol.md) |
| P2 | START NOW | Protocol | MasterAgent Protocol Group | C1 before typecheck; P3 mounts the group. | [Open](tracks/P2-master-agent-protocol.md) |
| P3 | COMPOSITION | Protocol | Protocol Composition | C2, P1, and P2. | [Open](tracks/P3-protocol-composition.md) |
| G1 | SERIAL | Generated SDK | SDK Regeneration | P3. | [Open](tracks/G1-sdk-regeneration.md) |
| S1 | START NOW | Server | MasterAgent Handler Module | P2 and F4 before final typecheck; S2 mounts the handlers. | [Open](tracks/S1-master-agent-handlers.md) |
| S2 | COMPOSITION | Server | Server and Event Bridge Composition | D4, E1, F4, P3, and S1. | [Open](tracks/S2-server-composition.md) |
| R1 | START NOW | Coder host | MasterAgent Session Context Resolver | D4 and F4 before final integration; R5/R6 consume it. | [Open](tracks/R1-master-agent-session-context.md) |
| R2 | START NOW | Coder host | Coder Routing Policy | R6 consumes it. | [Open](tracks/R2-coder-routing-policy.md) |
| R3 | START NOW | Coder host | Reusable Child Task Runner | R5 consumes the runner. | [Open](tracks/R3-child-task-runner.md) |
| R4 | START NOW | Coder host | Reserved Coder Agent Definition | R6 registers it; R5 uses its identifier. | [Open](tracks/R4-coder-agent-definition.md) |
| R5 | START NOW | Coder host | Coder Delegation Tool | R1, R2, R3, and R4 before final integration; R6 registers the tool. | [Open](tracks/R5-coder-task-tool.md) |
| R6 | COMPOSITION | Coder host | Coder Host Integration | D4, F4, R1, R2, R3, R4, and R5. | [Open](tracks/R6-coder-host-integration.md) |
| U1 | START NOW | Session UI | Session Target and Scope Primitives | U2/U3 consume the primitives. | [Open](tracks/U1-session-target-and-scope.md) |
| U2 | START NOW | Session UI | Route-independent Session Surface Extraction | U1 before final typecheck; U3 wraps the base surface. | [Open](tracks/U2-session-surface-extraction.md) |
| U3 | START NOW | Session UI | Canvas Session Multi-instance Adapter | U1 and U2 before final typecheck; B3 consumes it. | [Open](tracks/U3-session-multi-instance-adapters.md) |
| M1 | START NOW | Canvas manager | MasterAgent Client Domain and Reducer | C2 before replacing any local aliases; M2–M5 consume this module. | [Open](tracks/M1-master-agent-client-domain.md) |
| M2 | START NOW | Canvas manager | MasterAgent Lifecycle Controller | M1 before final typecheck; M6 composes it. | [Open](tracks/M2-master-agent-lifecycle-controller.md) |
| M3 | START NOW | Canvas manager | MasterAgent Event Reconciliation | M1 before final typecheck; M6 mounts it. | [Open](tracks/M3-master-agent-event-reconciliation.md) |
| M4 | START NOW | Canvas manager | Workspace Coder Settings Controller | M1 before final typecheck; M6/B2 consume it. | [Open](tracks/M4-master-agent-coder-controller.md) |
| M5 | POST-GEN | Canvas manager | Generated SDK Adapter | G1 and M1. | [Open](tracks/M5-master-agent-sdk-adapter.md) |
| M6 | COMPOSITION | Canvas manager | Canvas Manager Integration | M1, M2, M3, M4, and M5. | [Open](tracks/M6-canvas-manager-integration.md) |
| B1 | START NOW | Block UI | MasterAgent Presentational Shell | B3 composes it. | [Open](tracks/B1-master-agent-presentational-ui.md) |
| B2 | START NOW | Block UI | Workspace Coder Selector UI | M4 before final composition; B3 mounts it. | [Open](tracks/B2-coder-selector-ui.md) |
| Q1 | START NOW | Block UI | Queue Integration Adapter and Tests | U3 before final typecheck; B3 consumes the options. | [Open](tracks/Q1-queue-integration.md) |
| B3 | COMPOSITION | Block UI | MasterAgent Block Composition | U3, M6, B1, B2, and Q1. | [Open](tracks/B3-master-agent-block-composition.md) |
| I1 | START NOW | Canvas integration | Client Functionality Descriptor | C1 before typecheck; I2 registers the descriptor. | [Open](tracks/I1-client-functionality-registration.md) |
| I2 | COMPOSITION | Canvas integration | Canvas Renderer Integration | D3, B3, and I1. | [Open](tracks/I2-canvas-renderer-integration.md) |
| V1 | VERIFY | Verification | Core and Server Integration Tests | D4, F4, P3, and S2. | [Open](tracks/V1-core-server-integration-tests.md) |
| V2 | VERIFY | Verification | Coder Routing Integration Tests | D4, F4, and R6. | [Open](tracks/V2-coder-routing-integration-tests.md) |
| V3 | VERIFY | Verification | App Canvas Integration Tests | U3, M6, B3, and I2. | [Open](tracks/V3-app-canvas-integration-tests.md) |
| V4 | VERIFY | Release | Full Regression Gate and Documentation | All production and V1–V3 tracks. | [Open](tracks/V4-full-regression-and-docs.md) |

## Peak launch group

Launch these 28 agents together:

```text
C0 C1 D1 D2 D3 F1 F2 F3 E1 P1 P2 S1 R1 R2 R3 R4 R5 U1 U2 U3 M1 M2 M3 M4 B1 B2 Q1 I1
```

## Composition launch group

These 9 agents can inspect/scaffold concurrently but should receive their leaf commits before final verification:

```text
C2 D4 F4 P3 S2 R6 M6 B3 I2
```

## Generated and final groups

```text
P3 -> G1 -> M5

V1  V2  V3   may run independently after their area baselines
V1 + V2 + V3 + all production tracks -> V4
```

## Completion-state vocabulary

Every agent ends with exactly one state:

```text
READY
READY_AFTER: <track IDs>
BLOCKED_CONTRACT: <mismatch>
FAILED_TEST: <command and failure>
```

This prevents a leaf agent from waiting silently or broadening file ownership to hide an integration issue.
