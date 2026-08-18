# MasterAgent Merge Sequencing and Dependency Plan

Target branch: `feature/UnrealViewer`.

## 1. Dependency graph

```text
A0 Shared contracts
 ├─ B1 Database/workspace persistence
 ├─ B2 MasterAgent session lifecycle
 ├─ P1 Protocol contracts ──→ G1 SDK regeneration ──→ M2 SDK adapter
 ├─ R1 Coder delegation
 ├─ M1 Manager controller ───────────────────────────→ M2 SDK adapter
 └─ C1 Coder selector

U1 Session surface ──→ U2 Block shell
       └─────────────→ Q1 Queue wiring

B1 + B2 + P1 ──→ S1 Server handlers

U1 + U2 + M2 + Q1 + C1 ──→ I1 Canvas integration

B1 + B2 + S1 + R1 + I1 ──→ V1 Integration verification
```

## 2. Merge waves

### Wave 0 — contract seed

Merge A0 first. Every later branch should rebase onto or cherry-pick the exact A0 commit.

```text
A0
```

### Wave 1 — maximum parallel implementation

Run these tracks concurrently:

```text
B1  Database/workspace persistence
B2  Session lifecycle against repository interfaces
P1  Protocol contracts
R1  Coder delegation against a policy-resolver interface
U1  Route-independent session surface
U2  Block shell against mock props
M1  SDK-independent manager controller
Q1  Queue integration tests against the U1 contract
C1  Coder selector against the M1 controller interface
```

B2 and R1 may be implemented before B1 is merged, but their final integration must use the real persistence and session-to-instance resolution supplied by B1/B2.

### Wave 2 — generated and host adapters

```text
P1 → G1

B1 + B2 + P1 → S1

B2 → R1 final integration

G1 + M1 → M2
```

S1 and G1 can run concurrently after P1 because server handlers depend on protocol schemas, not the generated client.

### Wave 3 — client integration

```text
U1 + U2 + M2 + Q1 + C1 → I1
```

I1 is the only track allowed to edit `packages/app/src/pages/canvas/workspace.tsx`.

### Wave 4 — end-to-end gate

```text
B1 + B2 + S1 + R1 + I1 → V1
```

V1 must pass before the feature is considered merge-ready.

## 3. Mandatory protocol-to-SDK handoff

P1 and G1 are the only two tracks that must be strictly sequential.

Procedure:

1. A0 lands.
2. P1 branches from the exact A0 commit.
3. P1 lands the complete protocol shape, including `coderModel` exposure and MasterAgent lifecycle endpoints.
4. Endpoint names and response shapes are frozen at the P1 merge commit.
5. G1 branches from that exact P1 commit.
6. G1 runs `node packages/sdk/js/script/build.ts` and commits generated output only.
7. G1 runs the generator a second time. The second run must create no new diff.
8. M2 waits for G1 and implements the narrow handwritten SDK adapter.
9. U1, U2, M1, Q1, and C1 continue without generated types by depending on handwritten interfaces.

This staging confines code-generation delay to M2 instead of blocking all frontend tracks.

## 4. Integration branch policy

Use one integration branch based on the latest `feature/UnrealViewer` head plus A0.

Recommended merge order into the integration branch:

```text
1. A0
2. B1
3. B2
4. P1
5. G1
6. S1
7. R1
8. U1
9. U2
10. M1
11. M2
12. Q1
13. C1
14. I1
15. V1
```

Tracks that were developed in parallel should rebase before merge. Do not resolve shared-file conflicts by combining two implementations; follow the exclusive ownership table in `04-conflicts-and-file-ownership.md`.

## 5. Staging rules for temporarily incomplete shared types

- A track must keep its own package typecheck green whenever practical.
- When an implementation depends on a later adapter, introduce a narrow local interface and a mock implementation rather than importing nonexistent generated types.
- Do not put temporary `any` types into shared schemas or generated SDK layers.
- Do not modify shared files simply to make a parallel track compile. Place incomplete integration behind new-file boundaries.
- Final package-wide typechecks happen in I1/V1 after adapters are merged.
