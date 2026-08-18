# MasterAgent Implementation Plan — File Index

Target repository: the opencode fork on branch `feature/UnrealViewer`.

This package decomposes the **Complete Workspace: MasterAgent Block** feature into independently executable coding-agent workstreams. Each track file is intended to be handed directly to one subagent. The supporting documents freeze the cross-track architecture, contracts, merge sequence, acceptance criteria, and unresolved product decisions.

## Package contents

### Shared planning documents

| File | Purpose |
|---|---|
| `00-complete-plan.md` | Full implementation plan in one document. |
| `01-architecture-decisions.md` | Coder routing, persistence, session ownership, and queue integration decisions. |
| `02-contracts-and-data-model.md` | Shared schemas, lifecycle contracts, and ownership model that all tracks must follow. |
| `03-merge-sequencing.md` | Dependency graph, merge waves, protocol-to-SDK handoff, and integration order. |
| `04-conflicts-and-file-ownership.md` | Exclusive ownership of shared files and conflict-avoidance rules. |
| `05-verification-and-acceptance.md` | Cross-package commands and end-to-end acceptance gate. |
| `06-risks-and-open-questions.md` | Risks, defaults, and decisions that may require product confirmation. |

### Coding-subagent tracks

| Track | File | Responsibility |
|---|---|---|
| A0 | `tracks/A0-shared-contracts.md` | Freeze shared schemas and public types. |
| B1 | `tracks/B1-database-workspace-persistence.md` | Database migration, workspace persistence, and built-in registry. |
| B2 | `tracks/B2-master-agent-session-lifecycle.md` | Functionality-instance binding and host-owned session lifecycle. |
| P1 | `tracks/P1-protocol-contracts.md` | HTTP protocol definitions and workspace patch exposure. |
| G1 | `tracks/G1-sdk-regeneration.md` | Generated JavaScript SDK update. |
| S1 | `tracks/S1-server-handlers.md` | Thin server handlers for workspace and MasterAgent operations. |
| R1 | `tracks/R1-coder-delegation.md` | Host-enforced Coder subagent routing and tool policy. |
| U1 | `tracks/U1-session-surface.md` | Route-independent reusable session-page surface. |
| U2 | `tracks/U2-master-agent-block-shell.md` | Canvas block shell and visual states. |
| M1 | `tracks/M1-manager-controller.md` | SDK-independent manager-side controller and reducer. |
| M2 | `tracks/M2-sdk-adapter-manager-integration.md` | Generated-SDK adapter and manager composition. |
| Q1 | `tracks/Q1-queue-wiring.md` | Existing host queue integration in the embedded composer. |
| C1 | `tracks/C1-coder-selector.md` | Workspace Coder model selector UI. |
| I1 | `tracks/I1-canvas-integration.md` | Final client registration and canvas composition. |
| V1 | `tracks/V1-integration-verification-docs.md` | Cross-layer tests, regression gate, and final documentation. |

## Required execution order

The only hard, intentionally sequential pair is:

```text
P1 Protocol contracts
        ↓
G1 SDK regeneration
```

All other work should be parallelized around stable handwritten interfaces.

Recommended waves:

```text
Wave 0: A0

Wave 1, parallel:
B1  B2  P1  R1  U1  U2  M1  Q1  C1

Wave 2:
P1 → G1
B1 + B2 + P1 → S1
B2 → R1 final integration
G1 + M1 → M2

Wave 3:
U1 + U2 + M2 + Q1 + C1 → I1

Wave 4:
B1 + B2 + S1 + R1 + I1 → V1
```

## Non-negotiable architectural constraints

- The manager owns backend communication and server-authoritative workspace state; UI components only render and invoke manager/controller actions.
- Queue delivery remains host-side through the existing `SessionInput.admit` path. No block-local or browser-local holding queue may be added.
- `builtin:master-agent` must be present in the server built-in registry and the client functionality mapping.
- The MasterAgent session binding belongs to a host-owned functionality instance, not layout JSON.
- `coderModel` is a nullable workspace field and follows the same end-to-end persistence pattern as `model` and `operatingAgent`.
- Coder routing is host-enforced subagent delegation. It is not browser-side prompt classification and not a silent model substitution inside the main session.
- Generated SDK files are owned only by G1 and must not be hand-edited.

## How to dispatch a track

Give the subagent the relevant track file plus `01-architecture-decisions.md` and `02-contracts-and-data-model.md`. For integration tracks, also provide `03-merge-sequencing.md` and `04-conflicts-and-file-ownership.md`.
