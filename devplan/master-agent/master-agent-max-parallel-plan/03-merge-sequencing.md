# MasterAgent Merge Sequencing for Maximum Parallelism

Target branch: `feature/UnrealViewer`.

## 1. Distinguish begin dependencies from merge dependencies

A **begin dependency** means an agent cannot sensibly write or test its code. This plan intentionally has almost none because `02-contracts-and-data-model.md` freezes the ports.

A **merge dependency** means the track must rebase onto named commits before its final package typecheck. Merge dependencies do not require the subagent to remain idle.

## 2. Peak dispatch: 28 agents

Dispatch all `START NOW` tracks from the same clean baseline:

```text
C0 C1
D1 D2 D3
F1 F2 F3 E1
P1 P2
S1
R1 R2 R3 R4 R5
U1 U2 U3
M1 M2 M3 M4
B1 B2 Q1
I1
```

Agents with planned upstream interfaces use local fakes or type-only ports and report the exact rebase needed.

## 3. Area merge trains

### Contracts

```text
C0 ─┐
    ├─> C2 schema baseline
C1 ─┘
```

### Workspace persistence

```text
D1 SQL/migration ─┐
D2 codec ─────────┼─> D4 workspace service integration
D3 descriptor ────┘
```

### MasterAgent lifecycle

```text
F1 instance repository ─┐
F2 binding state machine ├─> F4 lifecycle service
F3 Session adapter ──────┤
E1 event publisher ──────┘
                D4 ──────┘  authoritative workspace/functionality lookup
```

### Protocol and SDK

```text
P1 workspace Coder fragment ─┐
                             ├─> P3 protocol baseline ─> G1 generated SDK
P2 MasterAgent endpoints ────┘
```

`P3 → G1` is the only hard execution-serial pair. Freeze P3 endpoint names before starting G1.

### Server

```text
S1 handlers + D4 + F4 + E1 + P3 ─> S2 server/event composition
```

### Coder host

```text
R1 context ───────┐
R2 policy ────────┤
R3 child runner ──┼─> R6 host integration
R4 Coder agent ───┤
R5 Coder tool ────┘
D4 + F4 ──────────┘
```

### Session UI

```text
U1 target/scope ─┐
                 ├─> U3 canvas multi-instance surface
U2 base surface ─┘
```

U1, U2, and U3 can all start together because the target/base props are frozen.

### Canvas manager

```text
M1 domain/port ───────────┐
M2 lifecycle controller ──┤
M3 event reconciliation ──┼─> M6 manager integration
M4 Coder controller ──────┤
P3 ─> G1 ─> M5 SDK port ─┘
```

Only M5 waits for generated types.

### Block and renderer

```text
B1 shell ─────────────┐
B2 selector ──────────┤
Q1 queue options ─────┼─> B3 block composition
U3 session surface ───┤
M6 manager API ───────┘

I1 descriptor + B3 ─> I2 workspace renderer
```

### Verification

```text
D4 + F4 + P3 + S2 ─> V1
D4 + F4 + R6 ──────> V2
U3 + M6 + B3 + I2 ─> V3
V1 + V2 + V3 + all production tracks ─> V4
```

## 4. Recommended integration branches

Use one lane branch per area so the final branch does not cherry-pick 43 commits directly:

```text
ma/contracts      C0 C1 C2
ma/core           D1 D2 D3 D4 F1 F2 F3 E1 F4
ma/protocol       P1 P2 P3 G1
ma/server         S1 S2
ma/coder          R1 R2 R3 R4 R5 R6
ma/session-ui     U1 U2 U3
ma/manager        M1 M2 M3 M4 M5 M6
ma/block          B1 B2 Q1 B3 I1 I2
ma/verification   V1 V2 V3 V4
```

Suggested lane merge order into the feature branch:

```text
1. ma/contracts
2. ma/core
3. ma/protocol
4. ma/server
5. ma/coder
6. ma/session-ui
7. ma/manager
8. ma/block
9. ma/verification
```

Protocol may merge before core if desired; server final typecheck still waits for both.

## 5. Rebase protocol for leaf agents

1. Start from the announced common baseline.
2. Touch only owned files.
3. Commit passing local tests against fakes/ports.
4. Report `ready-after: <track IDs>`.
5. Lane integrator rebases/cherry-picks the required upstream commits.
6. Replace temporary aliases with public imports.
7. Run the track's final verification.
8. Do not resolve unrelated shared-file conflicts by broadening the leaf commit.

## 6. Failure routing

- Schema mismatch: return to C0/C1, not downstream adapters.
- SQL/baseline mismatch: D1.
- Workspace service mismatch: D4.
- Lifecycle race: F1/F2/F3/F4 according to failing layer.
- Generated type mismatch: P3 then regenerate G1; never patch G1 manually.
- Session UI regression: U2; multi-instance collision: U1/U3.
- Manager stale-state bug: M1/M2/M3; transport mapping: M5.
- Queue holding state: Q1/B3 must remove it; prompt-input files remain unchanged.
- Shared renderer conflict: I2 only.
