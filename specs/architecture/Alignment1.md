# Alignment1 — Design Doc Coherence Pass

Date: 2026-08-14
Scope: `specs/` design documents
Result: docs revised for cross-document coherence; residual open items listed in §5.

## 1. Documents reviewed

| Doc | Path | Status |
|---|---|---|
| Workspace Canvas — Requirements | `workspace-canvas/requirements.md` | draft for review |
| Workspace Canvas — Architecture | `workspace-canvas/architecture.md` | draft for review |
| UI Design — Chat Delivery: Steer & Queue | `workspace-canvas/UIDesign.md` | implemented on `feature/UnrealViewer` |
| Functionality Subsystem Management Architecture | `workspace-canvas/functionality-subsystem-management-architecture.md` | draft for review |
| Implementation Plan | `../devplan/workspace-canvas/ImplementationPlan.md` | proposed, reviewed (see Alignment2) |
| IndexedDB Organizer Backend Architecture (full spec) | `organizer/IndexedDB Organizer Backend Architecture.md` | proposed |
| IndexedDB Organizer — Architecture (concise) | `organizer/architecture.md` | proposed |

Two doc families exist and were aligned separately:

- **Workspace canvas family** (requirements, architecture, UIDesign, subsystem
  architecture) — the OpenCode UI redesign.
- **IndexedDB organizer family** (full spec + concise architecture) — an
  independent browser product; no shared domain with the canvas family.

## 2. Incoherences found and fixed

### 2.1 Functionality inventory and ID scheme disagreed

- `workspace-canvas/architecture.md` §4 listed builtins as `chat`, `terminal`,
  `file-tree`, `diff`, `todos`, `viewer`, and the default layout factory used
  the un-namespaced `functionality: "chat"` (§3.5).
- The subsystem architecture defines v1 builtins as `builtin:chat`,
  `builtin:online-search`, `builtin:screenshot-browser`,
  `builtin:application-window-stream`, with legacy panels migrating
  incrementally, and always uses namespaced IDs.

**Fix**: architecture §4 and §3.5 now use the v1 builtin set and `builtin:chat`
in the default layout; the full manifest model (constraints, lifecycle,
concurrency, rights, schemas) is delegated to the subsystem doc. Requirements
§5.2 (resolution 2) updated to the same inventory.

### 2.2 Requirements ambiguities that later docs already resolved

`workspace-canvas/requirements.md` §8 listed 20 open items; the subsystem
architecture and canvas architecture had already answered 13 of them without
the requirements doc reflecting it.

**Fix**: §8 items 1, 2, 3, 8, 9, 10, 11, 15, 16, 18, 20 are now marked
**Resolved** with the governing doc and decision noted; item 19 (UnrealViewer)
marked **Partially resolved** (contract stabilized as an honest placeholder;
capture/transport backend still undefined). Still open: 4, 5, 6, 7, 12, 13, 14,
17 (see §5).

### 2.3 Skills as blocks contradicted within requirements

FR-14 said the palette lists "plugin/skill functionalities" while resolution 2
said skills are enablements, not blocks.

**Fix**: FR-14 now lists built-in + plugin functionalities only and points to
§5.2 for the skills-as-enablements rule.

### 2.4 Host-authority incoherence in the IndexedDB organizer spec

The full spec still said "IndexedDB is the authoritative local catalog",
invariant 9 kept IndexedDB authoritative over OPFS/SQLite, the separation table
marked the server store "Yes for shared state", and the boundary summary said
"IndexedDB stores truth and coordination" — contradicting the server-authority
model already applied to `organizer/architecture.md` and to the workspace
family's host-authority rule.

**Fix**: spec §1 executive decision, invariants 8–10, §3.2 profile tree, §4
responsibility table, §16 server-authority rules, §28 Phase 5 exit criteria,
§29 acceptance checklist, and §30 boundary summary now state the single rule:
**the host server DB is authoritative for all shared entities; IndexedDB is the
local replica and offline buffer; clients never assign `serverVersion` and
converge to server state on pull.** Both organizer docs now agree verbatim on
the authority model.

### 2.5 Broken / bare cross-document references

- The subsystem doc's header and §38 referenced `workspace-canvas/UIDesign.md`,
  `requirements.md`, `architecture.md` by bare name with no path, although the
  referenced files live in `specs/` and `specs/workspace-canvas/`.
- `workspace-canvas/architecture.md` and `workspace-canvas/UIDesign.md` did not reference the
  subsystem doc at all, so the pending-input/cancellation extension and the
  extended persistence tables were invisible from the docs they extend.

**Fix**: subsystem doc header + §38 now use real relative links and state that
§8 **Resolved** markers in requirements track it. Canvas architecture lists the
subsystem doc as a companion, notes the additional tables
(`functionality_instance`, `functionality_operation`, `artifact`,
`context_capsule`, `mcp_server_profile`, `workspace_permission_rule`) are
specified there, and §10 risk notes the lifecycle policy is now defined there.
`workspace-canvas/UIDesign.md` gained a §8 "Extension" section pointing to the subsystem doc as
authoritative for the pending-input projection (not yet implemented), while
remaining authoritative for the implemented composer.

## 3. Changes per document

| Doc | Changes |
|---|---|
| `workspace-canvas/requirements.md` | FR-14 skills wording; §5.2 registry inventory aligned to namespaced v1 builtins; §8 items marked Resolved/Partially resolved with pointers |
| `workspace-canvas/architecture.md` | Companion links; §3.1 manifest-model pointer; §3.2 note on subsystem tables; §3.5 default layout uses `builtin:chat`; §4 registry rewritten to v1 builtins + incremental migration; §10 lifecycle risk updated |
| `workspace-canvas/UIDesign.md` | Related link to subsystem doc; new §8 Extension (pending inputs + cancellation, design only) |
| `functionality-subsystem-management-architecture.md` | Status aligned to "draft for review"; header and §38 source links fixed to real relative paths |
| `organizer/IndexedDB Organizer Backend Architecture.md` | §1, invariants 8–10, §3.2, §4 table, §16 authority rules, §28, §29 checklist, §30 boundary — all updated to host-server-authoritative model, matching `organizer/architecture.md` |
| `organizer/architecture.md` | No further changes (already authoritative-aligned in the prior pass) |

## 4. Governing rules after alignment

- **Layout purity**: layout JSON contains only `{ id, functionality, transform }`;
  per-block configuration lives in a revisioned `functionality_instance` keyed
  by `(workspace, block, functionality)`. All five canvas-family docs agree.
- **Host authority**: the host owns workspace/layout storage, capability
  enforcement, chat queue admission/promotion, and (organizer family) all shared
  entity versions. Client caches are never authoritative.
- **Chat delivery**: steer/queue semantics are identical in UIDesign,
  canvas architecture §6, and subsystem doc §20; pending-input cancellation is
  a documented extension owned by the subsystem doc.
- **Organizer authority**: host server DB is the single authority for shared
  state; IndexedDB is the local replica/offline buffer; search indexes and
  thumbnails are disposable derivatives. Consistent across both organizer docs.

## 5. Remaining open items (unresolved, by design)

From `workspace-canvas/requirements.md` §8:

- **7 — Git tracking scope** (per directory vs workspace-wide; which block
  renders it).
- **12 — Legacy surfaces** (`/` home and `/:dir/session/:id` routes; naming
  collision between git-worktree "workspaces" and the new Workspace — UI-copy
  disambiguation is planned per ImplementationPlan ADR-10, but route handling
  is open).
- **13 — Snap details** (cell size, overlap policy, resize multiples).
- **14 — Panel scale** (percentage vs fixed grid units with scroll).
- **17 — Top bar overflow** behavior on narrow screens.

Items 4 (style), 5 (device granularity), and 6 (identity) were resolved after
the initial pass by `ImplementationPlan` ADRs 2–4 (see Alignment2).

From `functionality-subsystem-management-architecture.md` §35: items 1
(instance retention) and 2 (search provider precedence) resolved by
`ImplementationPlan` ADR-5/ADR-9 (see Alignment2). Still open there: MCP
profile configuration rights; search result retention; screenshot payload
store choice; sensitive-screenshot default; cancelled-input presentation;
plugin sandboxing timeline; context token estimation; application streaming
backend.

## Alignment2 — Implementation Plan Validity Review

Date: 2026-08-14
`ImplementationPlan.md` was added to the doc set and reviewed against the design
docs for validity, coverage, and internal consistency.

### 2.1 Plan → doc resolutions folded back

The plan's Phase 0 ADRs resolve open items that the alignment pass had left
open; the design docs were updated to absorb them:

| Plan ADR | Decision | Docs updated |
|---|---|---|
| ADR-2 Environment vs Style | `environment` = preset + functionality availability; `style` = visual/density preference | requirements §2 terminology, §5.3, §8.4; canvas architecture §7 |
| ADR-3 Layout tuple | required `(workspace, user, style, deviceClass)`; `deviceID` deferred | requirements §8.5; canvas architecture §7 |
| ADR-4 Identity | self-host username / account user ID / reserved `default` for anonymous | requirements §8.6 |
| ADR-5 Instance retention | soft-archive 30 days unless durable domain refs; new block = new instance | subsystem doc §35.1 |
| ADR-9 Search precedence | block instance → explicit workspace default → no implicit fallback | subsystem doc §35.2 |

### 2.2 Validity findings

**Confirmed consistent (no change needed):**

- Phase ordering matches both architecture docs' phase orders (canvas →
  runtime → rights → operations → artifacts → context → MCP).
- R1–R4 scope boundaries map cleanly to the subsystem doc's 8 implementation
  phases and the acceptance criteria in §34.
- IndexedDB is correctly demoted to cache profile (Phase 9A) with the full
  organizer as an optional post-R4 program (9B); consistent with the
  server-authoritative organizer docs.
- All numeric budgets (16 KiB events, 32 KiB capsules, 320/1600 px
  derivatives, 12-block/60-fps, <10 KB/100 blocks, <300 ms p95) match the
  design docs verbatim.
- Chat steer/queue/cancellation (Phase 5.5) extends the session domain and
  forbids duplicating inputs in the generic operation table — matches
  subsystem doc §25.6 and UIDesign §8.
- Scope-control rules (§20) mirror the non-goals in both architecture docs.

**Gaps fixed in the plan during review:**

1. **Audit persistence missing** — Phase 4 required audit events but no table
   existed in the §17 store checklist. Added `audit_event` and Phase 4.6.
2. **Plugin SDK registration missing** — the subsystem doc's plugin
   functionality export had no implementation home. Added to Phase 3.2
   (trusted-plugin class only).
3. **Artifact payload GC missing** — screenshot lifecycle (§28.4 of the
   subsystem doc) implies policy-aware GC. Added Phase 6.5 mark-and-sweep
   roots/sweep policy before R3.
4. **Workspace naming collision** (git-worktree "workspaces") was an open risk
   in canvas architecture §10 but absent from the plan. Added ADR-10
   (UI-copy disambiguation before rollout; no internal API rename).
5. **Rights gate before exposure** — R1 ships the generic gateway (Phase 3)
   one release before CASL enforcement (Phase 4). Added a Phase 3.4 rule:
   minimum mount-time rights checks and per-operation declarations are
   enforced in Phase 3, and the gateway is never flag-off before Phase 4
   exits.
6. **Status file path** — the plan wrote the verification output to
   `docs/workspace-canvas/implementation-status.md`; corrected to
   `devplan/workspace-canvas/implementation-status.md` to match the spec
   tree.

### 2.3 Residual risks (accepted, to be watched)

- **R1 ships a functionality gateway without full CASL** — mitigated by the
  Phase 3.4 gate, but the feature flag must stay on through Phase 4.
- **R3 effort estimate (16–25 engineer-weeks)** for artifact service +
  screenshot browser + context broker + MCP search is the most uncertain
  estimate in §19; MCP protocol churn and streaming correctness are the main
  variance drivers.
- **Phase 1.5 client migration** assumes the local store key (`workspaces.v1`)
  and shape; §2.3 verification must confirm the actual key before migration
  work starts (the plan already requires this).
- **Event transport choice (ADR-7)** depends on whether the existing durable
  event mechanism supports workspace scope + cursors; Phase 0.1 must answer
  this before Phase 5 commits to SSE or reuse.

### 2.4 Verdict

The plan is **valid and internally coherent** with the design docs after the
fixes in §2.2. Its conservative ordering (host authority → runtime boundary →
security → operations → artifacts/external capabilities) matches the governing
rules agreed in Alignment1. Release gates are testable and map one-to-one to
doc acceptance criteria.
