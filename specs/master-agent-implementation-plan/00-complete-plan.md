# Complete Workspace — MasterAgent Block Implementation Plan

Target repository: opencode fork, branch `feature/UnrealViewer`.

## Purpose

Implement a new canvas functionality, `builtin:master-agent`, that embeds the original opencode session surface inside a workspace block, owns a durable top-level session, reuses the existing host-side queued-prompt delivery path, and optionally delegates coding work to a workspace-selected Coder model.

## Core design

- Each MasterAgent block resolves a host-owned functionality instance keyed by workspace, block, and functionality ID.
- That instance owns one active top-level Session binding; layout JSON contains presentation only.
- The existing session page is extracted into a reusable explicit-target SessionSurface.
- Queue delivery uses the existing composer and `SessionInput.admit` with `delivery: "queue"`; no client queue is introduced.
- `Workspace.Info.coderModel` stores the optional workspace-wide Coder model.
- Coder routing is host-enforced child-session delegation. The primary remains coordinator on the main model and cannot directly mutate the repository while strict Coder routing is enabled.
- The only hard sequential workstream pair is protocol definition followed by SDK regeneration.

## Track summary

| Track | Scope | Dependencies |
|---|---|---|
| A0 | Shared schemas/contracts | None |
| B1 | Database, workspace persistence, built-in registry | A0 |
| B2 | MasterAgent session lifecycle | A0; B1 before final merge |
| P1 | Protocol contracts | A0 |
| G1 | SDK regeneration | P1 |
| S1 | Server handlers | B1, B2, P1 |
| R1 | Host Coder delegation | A0; B2 before final merge |
| U1 | Route-independent session surface | None |
| U2 | Block shell | U1 contract |
| M1 | SDK-independent manager controller | A0 |
| M2 | SDK adapter and manager composition | M1, G1 |
| Q1 | Queue wiring | U1 |
| C1 | Coder selector | A0, M1 |
| I1 | Final canvas integration | B1, U1, U2, M2, Q1, C1 |
| V1 | Cross-layer verification/docs | All implementation tracks |

## Merge waves

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

## Shared contract

### Workspace

```ts
Workspace.Info.coderModel: ModelSelection | null
Workspace.Patch.coderModel?: ModelSelection | null
```

Use the exact schema/encoding already used by `Workspace.Info.model`.

### Functionality

```text
builtin:master-agent
```

Register it in the core/server built-in registry and the app canvas mapping.

### Lifecycle operations

```text
workspace.masterAgent.get
workspace.masterAgent.ensure
workspace.masterAgent.reset
```

Reset requires expected session ID and expected revision. There is no MasterAgent-specific prompt endpoint.

### Event

```text
workspace.master-agent.binding.updated
```

Persisted instance state is authoritative; the event is a transient synchronization hint.

## Coder routing

```text
User prompt
  → primary MasterAgent/OperatingAgent on workspace.model
  → reserved coder delegation for implementation work
  → host resolves workspace.coderModel and bound directory
  → child Session created with parentID = MasterAgent session
  → Coder edits/builds/tests
  → result returns to primary for synthesis
```

The model/client cannot choose the child model, provider, directory, permissions, parent session, or workspace. The host snapshots the selected Coder model at child creation. No silent fallback is permitted.

## Session lifecycle

### Ensure

- Validate workspace/block/functionality.
- Return existing valid binding when present.
- Otherwise create and bind one top-level Session.
- Use transaction or revision compare-and-swap for concurrent clients.
- Emit the binding-updated event after persistence.

### Reset

- Allowed only when idle with zero pending inputs in v1.
- Requires expected session and revision.
- Creates a new Session and atomically changes the binding.
- Preserves the old Session in history.
- Does not transfer queued inputs.

### Removal

Removing a block preserves the Session, running work, and admitted queue. It only removes/tombstones visible functionality-instance state.

## Queue integration

The embedded SessionSurface supplies the target session and enables the existing composer Queue action. Queue submission is immediately admitted host-side with `delivery: "queue"`. Existing `session.input.admitted` and `session.input.promoted` events drive UI projection and promotion. No browser holding queue is allowed.

## Shared-file ownership

| Area | Owner |
|---|---|
| Schema workspace/MasterAgent contracts | A0 |
| Workspace SQL/service/migrations/built-in registry | B1 |
| MasterAgent lifecycle service | B2 |
| Workspace protocol group | P1 |
| Generated SDK | G1 |
| Server workspace handler composition | S1 |
| opencode prompt/task/agent routing files | R1 |
| Routed session page extraction | U1 |
| Canvas manager composition | M2 |
| Canvas workspace renderer | I1 |

Existing prompt-input implementations should remain unchanged.

## Acceptance highlights

- Two blocks have distinct durable sessions.
- Reload and layout handover do not duplicate or change bindings.
- Embedded UI includes messages, composer, terminal, file tree, and review panel.
- Queue is host-admitted, durable across reload/remount, ordered, and promoted on idle.
- `coderModel` persists end-to-end.
- Primary remains on its model; coding work runs in a child using the selected Coder model.
- Direct primary mutation is blocked while Coder routing is enabled.
- Task permission is enforced client-side for UX and host-side for authority.
- Unavailable Coder model fails visibly without fallback.
- SDK generation is idempotent and the app production build succeeds.

## Detailed documents

See:

```text
01-architecture-decisions.md
02-contracts-and-data-model.md
03-merge-sequencing.md
04-conflicts-and-file-ownership.md
05-verification-and-acceptance.md
06-risks-and-open-questions.md
tracks/*.md
```
