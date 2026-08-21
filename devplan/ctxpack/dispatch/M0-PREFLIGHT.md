# CtxPack — M0 Preflight & Frozen Dispatch (2026-08-21)

**Base commit:** `2d913472a237523696e7f9105a4c08a90b50a843` on `feature/CyberMaster`.
**Plan:** `ctxpack-parallel-implementation-plan.md` (attached). Spec docs: `specs/workspace-canvas/`.

## Branch decision

Plan's target `feature/UnrealViewer` is a direct ancestor of `feature/CyberMaster`
(merge-base = UnrealViewer HEAD `95bdd3488`). Block Runtime v3 runtime
(`packages/app/src/pages/canvas/runtime/`) + `FunctionalityInstance` core service
are present. All work happens on `feature/CyberMaster`; the dirty working tree
(master-agent parallel work, 19M/13U) is untouched by CtxPack lanes (disjoint
ownership, verified below). Workers do NOT commit; master integrates.

## M0 findings

| # | Finding | Decision |
|---|---|---|
| F1 | `packages/app/src/functionalities/` does not exist | RENAMED-EQUIVALENT → `packages/app/src/pages/canvas/blocks/ctxpack-browser/` (matches `chat-relay` block layout) |
| F2 | Context Broker / Context Capsule store / Capability service do NOT exist in code (only `Functionality.Capsule` etc. schema types in `packages/schema/src/functionality.ts`) | NEW lane **X0** added (Wave 1): capability service + capsule store slice per `functionality-subsystem-management-architecture.md` §14/§15 — exactly what X1/Q1 consume. No CASL dep (lockfile untouched); host-authoritative explicit policy. |
| F3 | `packages/core/src/functionality/` does not exist | X0 owns `packages/core/src/capability/` + `packages/core/src/context-broker/` (CREATE) |
| F4 | REST convention: groups mount under `/api/workspace/:workspaceID/...` (see `workspace-master-agent.ts`) | P1 group id `server.workspace.ctxpack`, root `/api/workspace/:workspaceID/ctxpack`; SDK surface `client.v2.workspace.ctxpack.<method>` |
| F5 | SDK is generated/hand-mirrored (`packages/client/src/generated`, `packages/sdk/js/src/v2/gen/`) | Workers use LOCAL typed facades; M1 hand-mirrors generated files + swaps facades (per repo skill: `bun run generate` must match on CI) |
| F6 | `migration.gen.ts` is an explicit import list | Each DB-owning lane adds EXACTLY ONE import line for its own migration file; no other edits there |
| F7 | Test dirs: `packages/{schema,core,protocol}/test/`, `packages/server/test/`; app tests in `src/` next to code | Test commands frozen below |
| F8 | Event definitions live in schema leaves (`Event.define` + `Event.inventory`), publisher ports follow `workspace/functionality-instance-events.ts` | S1 creates `CtxPackChanged` (`workspace.ctxpack.changed`) inside `packages/schema/src/ctxpack.ts`; C2 makes the publisher port; M1 registers the inventory |
| F9 | tsgo unavailable on this machine | Workers run targeted `bun test` only; master typechecks at M1 via `scripts/typecheck-package.sh` |

## Frozen test commands (bun absolute path)

```bash
BUN="$HOME/.bun-npm/node_modules/@oven/bun-windows-x64/bin/bun.exe"
# schema:        cd packages/schema    && $BUN test --only-failures test/ctxpack.test.ts
# core:          cd packages/core      && $BUN test --only-failures test/<file>.test.ts
# protocol:      cd packages/protocol  && $BUN test --only-failures test/<file>.test.ts
# app:           cd packages/app       && $BUN test --conditions=solid --preload ./happydom.ts src/context/ctxpack/<file>.test.tsx
# session-ui:    cd packages/session-ui && $BUN test src --only-failures
# NEVER run tests from the repo root (AGENTS.md guard).
```

## Reserved for M (workers must NOT edit)

`packages/schema/src/index.ts`, `packages/protocol/src/api.ts`,
`packages/server/src/api.ts` / `handlers.ts` / `routes.ts`,
`packages/opencode/src/server/routes/instance/httpapi/server.ts`,
`packages/app/src/pages/canvas/workspace.tsx`, `packages/app/src/app.tsx`,
`packages/app/src/pages/canvas/runtime/registrations/index.ts`,
`packages/app/src/context/server-sdk.tsx`, `packages/core/src/workspace/service.ts`,
all `**/generated/**` and `**/gen/**` files, lockfiles, `migration.gen.ts` (one-line-per-lane exception).

## Lane list

| Lane | Waves | Scope |
|---|---|---|
| S1 | 1 | schema + SQL repo + migration (ctxpack.ts / sql.ts) |
| X0 | 1 | capability service + capsule store (NEW foundation lane) |
| U1 | 1 | selection capture + draft + keyword suggestions |
| U2 | 1 | ctxpack-browser pure view components |
| U3 | 1 | drag payload + drop targets + attachment store |
| C1 | 2 | core service/validation/hash/search (dep S1, X0) |
| X1 | 2 | materialization + admission snapshot (dep S1, X0) |
| P1 | 2 | protocol group + thin handlers (dep S1 contract) |
| U4 | 2 | selection overlay + create dialog (dep U1) |
| R1 | 2 | projected runtime adapter (dep U2 contract, P1 SDK surface) |
| U5 | 2 | composer wiring v1/v2 + session-ui (dep U3) |
| Q1 | 3 | Session admission snapshot + provider context (dep X1, P1, U3/U5 contracts) |
| C2 | 3 | EventV2 publisher + usage accounting + observability (dep C1, X1, S1) |
| T1 | 4 | e2e/acceptance/verification evidence (dep M1) |
| M1/M2 | master | central composition, SDK mirror, gates |
