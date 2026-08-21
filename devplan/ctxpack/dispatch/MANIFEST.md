# CtxPack — MANIFEST & Ownership (Hermes parallel run)

Run id: `ctxpack`. Master: Cybermaster (Hermes). Workers: Hermes `delegate_task` leaf
children on `deepseek-v4-flash`/`deepseek`/`ultra` (delegation pin already set; unchanged
by this run). Base commit `2d913472a` on `feature/CyberMaster`. Single shared working
tree; ownership is disjoint and mechanically enforced by the briefs. Workers do NOT
commit and do NOT touch the existing dirty tree's files (master-agent work).

## Waves

| Wave | Tasks | Fan-out |
|---|---|---|
| 1 | S1 · X0 · U1 · U2 · U3 (5 parallel) | batch A |
| 2 | C1 · X1 · P1 · U4 · R1 · U5 (6 parallel) | batch B |
| 3 | Q1 · C2 (2 parallel) | batch C |
| M1 | master integration + SDK mirror | master only |
| 4 | T1 (verification) | batch D |
| M2 | master final gate | master only |

## Ownership matrix

| Owner | Owned paths (see `*-owned-paths.txt`) | Edits |
|---|---|---|
| S1 | `packages/schema/src/ctxpack.ts` (NEW), `packages/core/src/ctxpack/sql.ts` (NEW), `packages/core/src/database/migration/20260821_ctxpack.ts` (NEW), `packages/schema/test/ctxpack.test.ts` (NEW), `packages/core/test/ctxpack-sql.test.ts` (NEW), `packages/core/src/ctxpack/HANDOFF-S1.md` | +1 import line in `migration.gen.ts` |
| X0 | `packages/core/src/capability/*` (NEW), `packages/core/src/context-broker/*` (NEW), `packages/core/src/database/migration/20260821_capsule.ts` (NEW), `packages/core/test/capability-service.test.ts` + `packages/core/test/context-broker-capsule.test.ts` (NEW), `packages/core/src/context-broker/HANDOFF-X0.md` | +1 import line in `migration.gen.ts` |
| U1 | `packages/app/src/context/ctxpack/{selection.ts,draft.tsx,keyword-suggest.ts}` + their tests + `HANDOFF-U1.md` (all NEW) | none |
| U2 | `packages/app/src/pages/canvas/blocks/ctxpack-browser/*` except `adapter.ts` (NEW) | none |
| U3 | `packages/app/src/context/ctxpack/{drag.ts,attachment-store.tsx,drop-target.tsx}` + tests + `HANDOFF-U3.md` (NEW) | none |
| C1 | `packages/core/src/ctxpack/{service.ts,validation.ts,hash.ts,search.ts}` + `packages/core/test/ctxpack-{service,search}.test.ts` + `HANDOFF-C1.md` (NEW) | none |
| X1 | `packages/core/src/ctxpack/{materialize.ts,access.ts}` + `packages/core/test/ctxpack-{materialize,capability}.test.ts` + `HANDOFF-X1.md` (NEW) | none |
| P1 | `packages/protocol/src/groups/ctxpack.ts` (NEW), `packages/server/src/handlers/ctxpack.ts` (NEW), `packages/protocol/test/ctxpack-group.test.ts` + `packages/server/test/ctxpack-handler.test.ts` (NEW), `packages/server/src/handlers/HANDOFF-P1.md` | none |
| U4 | `packages/app/src/context/ctxpack/{selection-overlay.tsx,create-dialog.tsx}` + tests + `HANDOFF-U4.md` (NEW) | none |
| R1 | `packages/app/src/pages/canvas/blocks/ctxpack-browser/{adapter.ts,adapter.test.ts,HANDOFF-R1.md}` (NEW) | none |
| U5 | `packages/app/src/components/prompt-input/submit.ts`, `packages/app/src/components/prompt-input.tsx`, `packages/app/src/components/prompt-input-v2.tsx`, `packages/session-ui/src/v2/components/prompt-input/{interaction.ts,index.tsx}`, NEW `packages/app/src/components/prompt-input/context-attachments.tsx` + tests + `HANDOFF-U5.md` | only listed files |
| Q1 | `packages/schema/src/session-input.ts`, `packages/protocol/src/groups/session.ts`, `packages/server/src/handlers/session.ts`, `packages/core/src/session/{input.ts,sql.ts}`, `packages/core/src/session/runner/llm.ts`, `packages/core/src/database/migration/20260821_session_ctx_snapshot.ts` (NEW), `packages/core/test/session-ctxpack-*.test.ts` (NEW), `packages/core/src/session/HANDOFF-Q1.md` | +1 import line in `migration.gen.ts` |
| C2 | `packages/core/src/ctxpack/{events.ts,usage.ts,observability.ts}` + `packages/core/test/ctxpack-{events,usage,observability}.test.ts` + `HANDOFF-C2.md` (NEW), `packages/core/src/database/migration/20260821_ctxpack_usage.ts` (NEW) | +1 import line in `migration.gen.ts` |
| T1 | `packages/app/e2e/ctxpack.spec.ts` (NEW), `packages/core/test/ctxpack-acceptance.test.ts` (NEW), `packages/app/src/pages/canvas/ctxpack-runtime-observability.test.ts` (NEW), `docs/ctxpack-verification.md` (NEW), `devplan/ctxpack/HANDOFF-T1.md` | none |
| M | central composition files + SDK mirror + `embed-web-ui.ts` rebuild | master only |

## Cross-lane frozen contracts (verbatim in every consuming brief)

- CtxPack types + `CtxPackRepository` (S1 → C1, X1, C2, P1, Q1)
- `CapabilityService` + `ContextCapsuleStore` (X0 → C1, X1, Q1)
- `CtxPackBrowserView`/`CtxPackBrowserCommand` (U2 → R1)
- `ContextAttachmentDraft`/`SessionContextAttachmentInput`/`CtxPackDragPayloadV1`/`CTXPACK_DRAG_MIME` (U3 → U5, Q1)
- `SessionContextSnapshot` (X1 → Q1)
- Endpoint names/methods §2.7 (P1 → U3/U4/R1 facades)

## Worker rules (in every brief)

Edit ONLY owned files. No git writes. No installs/generate/lockfiles. No repo-root
tests. One `HANDOFF-*.md` in the exact §7.3 format. Report: files changed, what was
implemented, what was left undone or uncertain.
