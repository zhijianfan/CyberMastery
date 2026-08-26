# OperatingChat Context Assembly Parallel Implementation Plan

> Required execution skills: use `superpowers:using-git-worktrees` before
> implementation, `superpowers:test-driven-development` for every behavior
> change, `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to run the tasks, and
> `superpowers:verification-before-completion` before each completion claim.

Status: future implementation plan

Design authority: [OperatingChat Session Context Assembly Design](../specs/2026-08-25-operating-chat-context-assembly-design.md)
Source baseline: `1374764640c4be02a56eb2156a97b54d272fbe81`

## Goal

Give OperatingChat a Hermes-inspired but OpenCode-native context lifecycle:
one cached System Context epoch, one durable SessionV2 transcript, exact
historical model-facing user sidecars, automatic plus explicit CtxPack recall,
and the existing structured compaction path.

## Architecture

SessionV2 remains the only prompt, transcript, tool-loop, and compaction owner.
An OperatingChat profile is derived from its existing live
FunctionalityInstance binding. Admission materializes explicit context,
performs bounded automatic CtxPack recall, and atomically stores an immutable
sidecar with exact canonical `apiContent`. The runner puts selected-agent and
OperatingChat host facts in the Context Epoch, replays sidecars by message ID,
and feeds enriched content to the existing compactor.

No new user-facing prompt/mutation authority, database, event stream, queue,
browser store, or context runtime is introduced. One nullable
`session_message.model_context_json` column keeps enriched compaction private.
The compatible surface adds only a bounded descendant-recovery read and reuses
the runtime-neutral Todo read. Private state remains in the primary process's
SQLite database and is absent from Event/history/live sync.

Task 2G is the atomic local authority boundary. It adds the immutable Session
runtime, runtime-safe service/projector guards, one server-owned compatible
adapter, App runtime awareness, authenticated local `v2-enriched` readiness,
Core process-role enforcement, and negative routing/sync guards. A stored V2
Session may execute only when its RequestPlan is Local to the combined process.
A true Remote V2/mixed plan fails before proxy/effects. A managed child auth-
first denies the entire current `/api` prefix before body read, and direct Core
role guards deny every current mutation before row, event, FTS, provider,
filesystem, or pending-state effects. Legacy services and missing-runtime/
legacy routing stay byte-for-byte unchanged.

Tasks 3A and 3B add only local exact replay and private compaction. Managed V2
clustering, private projection transfer, distributed execution ownership,
request proofs, leases, placement fences, spools, and worker binding routing
are explicitly deferred.

## Tech stack

- TypeScript and Bun
- Effect, Effect Schema, and Effect layers
- Drizzle/SQLite and existing FTS5 tables
- SessionV2, EventV2, System Context/Context Epoch, CtxPack, and
  FunctionalityInstance
- generated Promise/Effect clients and the legacy JavaScript SDK for the public
  runtime/compatibility/status shapes
- package-scoped Bun tests and `bun typecheck`

## Frozen decisions

- Automatic recall is enabled only for the
  `builtin:operating-chat-session` profile.
- Existing explicit attachments continue to work for generic SessionV2.
- The current user-facing CtxPack list/search contract is unchanged.
- `operating-chat-v1` scans at most 16 deterministic recall candidates and
  selects at most four automatic packs.
- OperatingChat identity is resolved from existing Session and
  FunctionalityInstance rows; there is no target table or ensure-flow rewrite.
- The clean transcript remains public. Exact enriched content is private
  Session input state. Same-ID exact retry never searches again.
- Explicit context fails closed; automatic context fails open with a sanitized
  status. Automatic recall creates no durable ContextCapsule; its immutable
  admitted sidecar is the durable copy.
- Missing actor identity never triggers recall under a synthetic user.
- The existing compactor and thresholds remain. Its input becomes sidecar-aware,
  and enriched summary/recent data is stored in one private message sidecar.
- Every V2 PromptAdmitted event carries only a version marker; its projector
  leaves a pending marker until the full private sidecar commits atomically.
- `session.runtime` is immutable `legacy | v2 | mixed`. Existing child tables
  classify rows; missing wire runtime means legacy. New legacy/V2 creators stamp
  their own runtime. Mixed is metadata-only quarantine.
- Service guards protect externally callable high-level production mutations;
  projector/direct-writer checks are the transactional last fence. Managed-child
  process-role checks independently reject every direct internal SessionV2,
  WorkspaceV2, FunctionalityInstance/binding, CtxPack/ContextCapsule,
  capability-authorized, Todo, interaction, and execution mutation before row,
  event, FTS, file, provider, or pending-state effects. Legacy services remain
  unchanged. Managed-child HTTP default-denies the entire `/api` prefix before
  body read; legacy routes remain outside it and health stays `/global/health`.
- Fresh local OperatingChat, MasterAgent, and ChatRelay bindings create V2.
  Existing legacy bindings remain readable legacy; mixed returns diagnostic
  metadata only. Neither converts or resets in phase 1.
- Authenticated combined OpenCode and authenticated standalone Server compose
  `v2-enriched` and use only the optional authenticated-external-user actor.
  Open listeners have actor undefined: zero attachments clean-admit/run with no
  recall, while nonempty context fails unavailable before admission. A managed
  child never derives an actor from its service Basic credential and cannot
  execute V2.
- An explicit workspace on Session Location is context metadata, reserved for
  future placement semantics. It does not authorize cross-process execution.
  The Session directory must be coordinator-accessible and remains the
  Location-scoped filesystem/tool/model/permission directory.
- Runtime-aware compatible routing decodes the Session ID exactly once and
  catches only typed Session NotFound. Unexpected lookup defects fail
  content-free and never proxy. Missing-runtime/legacy takes the exact old
  route. V2/mixed Local stays in process; V2/mixed Remote fails before body,
  handler, proxy, or target HTTP. Never force Remote Local.
- Preserve the existing prefix-based legacy `GET /session` routing rule exactly;
  runtime-aware Session-ID dispatch is a separate branch and never changes the
  target or bytes of legacy descendants.
- One endpoint-specific current `/api` authority boundary rejects duplicate,
  malformed, or disagreeing flat `workspace`, deep `location[workspace]`, and
  `x-opencode-workspace` selectors, then cross-checks cursor, stored-Session,
  path, or body authority before planning/handling. Session-ID routes trust the
  stored Session. Process-global `/api/session/active` accepts only a truly
  unscoped request. Permission/question pending LocationQuery reads require
  deep workspace or header when scoped; flat may only corroborate that mounted
  value and flat-only rejects. Session list preserves its flat metadata filter
  and binds cursor workspace; create rejects query/header selectors; built-ins
  trust the path. Compatible legacy flat routing is unchanged.
- The same negative guard covers the combined current `/api/session` surface
  and exact OperatingChat/MasterAgent/ChatRelay GET/ensure/reset routes.
  Fresh Remote built-in ensure fails before Session/binding creation. POST
  `/api/session` authenticates and performs one exact 16-MiB bounded mounted-
  Schema decode. Body location is local metadata, never a proxy selector;
  Remote metadata rejects. An existing Local ID adopts only V2 with absent or
  byte-equal requested location. An absent supplied ID is allowed only when
  zero remote targets make absence authoritative; omitted ID keeps normal
  server-owned local creation. Directory/Location resolution precedes writes.
- Global status/permission/question bootstrap remains legacy-only. Concrete
  local V2 roots use Session-scoped message, status, Todo, descendant,
  permission, and question compatibility routes on the coordinator and one
  global SSE.
- The App keeps the existing CompatibleApi and ServerSession stores. It adds no
  V2 client/controller/store/registry or second stream. Runtime-v2 submit uses
  the exact canonical Text/File/Agent subset, stable optimistic IDs, delivery,
  resume, context attachments, and bound Session ID; incompatible controls are
  hidden on the bound Session surface.
- `SessionExecutionLocal` publishes the existing session.status busy/idle once
  around the complete coalesced ownership chain. Scoped recovery repairs local
  V2 metadata/transcript/status/interactions with bounded pages and independent
  family revisions.
- Sync uses two exact definition sets: durable wire classification is
  `SessionV1.Event.Definitions.filter((definition) => definition.durable !==
  undefined)` plus `SessionEvent.DurableDefinitions`, matching EventManifest.
  Ordinary live uses all V1 Definitions plus full `SessionEvent.Definitions` so
  transient deltas cannot escape classification. V2/mixed raw Session records
  always quarantine. Durable legacy accepts only filtered V1 plus current
  AgentSwitched/ModelSwitched/Moved; V1 message.part.delta/session.diff/
  session.error never enter replay/history. Ordinary V1 requires a matching
  legacy row except a Schema-valid `session.error` without sessionID, which is
  sessionless/runtime-neutral and forwards byte-exact. Replay and catch-up
  arrays shadow-preflight in order before the first write; any invalid tail
  rejects the whole batch. Other unknown/sessionless records fail closed.
- Core MoveSession, OpenCode Workspace.sessionWarp, `/sync/steal`, Core
  WorkspaceV2 removal, and control-plane Workspace removal reject
  unconditionally at their first operation for every shape. Workspace removal
  performs no prewalk/cascade/adapter/worktree work. Direct legacy Session
  recursive delete separately prewalks its full descendant tree and rejects
  before deleting a protected V2/mixed descendant.
- Agent system instructions and the OperatingChat host profile are
  replacement-only private Context Epoch sources, never public ContextUpdated
  payloads.
- One coordinator process per database is supported. HA and managed V2
  clustering are unsupported.
- Generic workspace-proxy redirect/header/log hardening and managed-child
  credential-environment scrubbing are separate infrastructure work, not
  delivered by this plan.
## Coordination model

Create a coordinator worktree on branch `operating-context`. Wave 1 may use
three additional worktrees because the available agent budget is one
coordinator plus three workers:

| Worker | Branch | Exclusive Wave 1 ownership |
| --- | --- | --- |
| A | `context-schema` | Session input schema/tests, V1 renderer narrowing, and generated public clients |
| B | `ctxpack-recall` | Internal recall query/tests |
| C | `context-profile` | Session profile port, OperatingChat resolver, composition/tests |

Workers must not edit another worker's paths. Each worker commits its own
green task. The coordinator reviews and integrates Wave 1 commits in A, B, C
order, then runs the shared package typecheck before starting Wave 2.

Wave 2 runs three independent workers after Wave 1 integration:

| Worker | Branch | Exclusive Wave 2 ownership |
| --- | --- | --- |
| D | `context-admission` | Sidecar rendering, recall/materialization orchestration, admission/retry |
| E | `context-system` | Agent/OperatingChat System Context and epoch integration |
| F | `context-target` | App-only canonical CtxPack target projection for generic and OperatingChat composers |

Task 2G is one serial cross-package compatibility cutover after Tasks 3A and 3B
because it reopens F's submit path, migrates the shared Session table, changes
both runtimes' guards, adds the OpenCode compatibility adapter, and owns the
existing-status manifest/Core coordinator changes. Its migration, guards,
adapter, local readiness/process-role/routing guards, generated SDK, and minimal
App runtime awareness land atomically. Wave 3 is serial because runner replay
and compaction touch the same runner file as Wave 2E. Wave 4 is serial
integration, cleanup, full verification, and docs; no Wave 4 task edits
production concurrently with another. Its later number does not weaken this
dependency: exact lowering and private compaction must exist before local
`v2-enriched` activation. Managed SessionV2 deployment is outside
this plan; Task 2G makes every Remote/worker V2 path fail before effects.

Do not let workers share an unstaged worktree. Do not combine task commits
until their focused RED/GREEN evidence and diff review are recorded.

## Dependency graph

```text
Wave 1A schema ─────────────┐
                           ├── Wave 2D admission/sidecar ──┐
Wave 1B recall ─────────────┘                              │
                                                          ├── Wave 3A/3B replay + compaction
Wave 1C profile ──┬────────── Wave 2E system/epoch ────────┘             │
                  ├────────── Wave 2D target resolution                  │
                  └────────── Wave 2F App target projection ─────────────┤
                                                                         v
                                                     Task 2G local runtime-safe activation
                                                                         │
                                                                         v
                                                     Wave 4 integration/cleanup/docs
```

## Wave 0: isolate and prove the baseline

### Task 0: Create the implementation worktree

**Files:** none

1. Read the repository root `AGENTS.md` in the implementation session.
2. Confirm this approved design/plan documentation is committed on the source
   branch; never create the implementation worktree from an unstaged docs tree.
3. Use the worktree skill to create branch `operating-context` from that docs
   commit on the then-current `feature/CyberMaster` head.
4. Confirm the source baseline and a clean worktree:

```powershell
git rev-parse HEAD
git status --short
```

5. From `packages/schema`, run:

```powershell
bun test
bun typecheck
```

6. From `packages/core`, run the focused baseline:

```powershell
bun test test/session-ctxpack-admission.test.ts test/session-ctxpack-promotion.test.ts
bun test test/session-runner.test.ts test/session-compaction.test.ts
bun test test/operating-chat-session.test.ts
bun test test/ctxpack-search.test.ts test/ctxpack-materialize.test.ts
bun typecheck
```

7. Record environmental failures before editing. Do not change unrelated code
   to make the baseline green.

**Exit gate:** clean isolated worktree and a recorded package-scoped baseline.

## Wave 1: parallel foundations

### Task 1A: Define the backward-compatible V2 sidecar schema

**Owner:** Worker A / `context-schema`
**Files:**

- Modify: `packages/schema/src/session-input.ts`
- Modify: `packages/schema/src/session-event.ts`
- Create: `packages/schema/test/session-input.test.ts`
- Create: `packages/schema/test/session-event.test.ts`
- Modify: `packages/core/src/session/runner/ctxpack-context.ts`
- Modify: `packages/core/src/session/runner/llm.ts` only to narrow the existing
  promoted-system renderer to V1 snapshots
- Extend: `packages/core/test/session-ctxpack-promotion.test.ts`
- Regenerate: `packages/client/src/generated/**`
- Regenerate: `packages/client/src/generated-effect/**`
- Regenerate: `packages/sdk/js/src/v2/gen/**`

#### Step 1: Write failing schema tests

Cover:

- the current version-1 snapshot still decodes unchanged;
- a version-2 snapshot decodes with exact `apiContent`, hashes, compact
  provenance, recall policy/status, sizes, and timestamp;
- unsupported versions, missing hashes, invalid selection values, and negative
  sizes reject;
- V2 allows zero attachments for an OperatingChat no-recall decision;
- V2 attachment order is preserved;
- explicit provenance requires a capsule ID while automatic provenance cannot
  carry one;
- `PromptAdmitted` accepts only the optional literal
  `modelContextVersion: 2`; and
- the marker carries no rendered content, CtxPack ID, query, or content hash.

Run from `packages/schema`:

```powershell
bun test test/session-input.test.ts test/session-event.test.ts
```

Require the new V2 cases to fail before production edits.

#### Step 2: Add a V1/V2 union

Keep the existing V1 shape under an explicit
`SessionContextSnapshotV1` export. Add `SessionContextSnapshotV2` with this
frozen conceptual shape:

```ts
{
  version: 2,
  rendererVersion: NonNegativeInt,
  contextRequestHash: Schema.String,
  apiContent: Schema.String,
  apiContentHash: Schema.String,
  attachments: Schema.Array(Schema.Union([
    Schema.Struct({
      selection: Schema.Literal("explicit"),
      contextCapsuleID: Schema.String,
      sourceCtxPackID: Schema.String,
      label: Schema.String,
      contentHash: Schema.String,
    }),
    Schema.Struct({
      selection: Schema.Literal("automatic"),
      sourceCtxPackID: Schema.String,
      label: Schema.String,
      contentHash: Schema.String,
    }),
  ])),
  recall: {
    policy: Schema.Literals(["disabled", "operating-chat-v1"]),
    status: Schema.Literals([
      "disabled",
      "skipped-trivial",
      "no-match",
      "selected",
      "unavailable",
    ]),
  },
  byteLength: NonNegativeInt,
  estimatedTokens: NonNegativeInt,
  createdAt: NonNegativeInt,
}
```

Export `SessionContextSnapshot` as the union. Do not add refinements that the
HTTP code generator cannot represent, even though the snapshot is currently
private; enforce frozen count/uniqueness limits in Core admission as today.

Add optional `modelContextVersion: 2` to `PromptAdmitted` only. It is the public
requiredness marker used to make a missing private sidecar detectable; it must
not contain context bytes or a content hash. The Core projector will translate
it to a pending V2 slot before the private admission commit replaces it.

Keep the current promoted-system renderer explicitly V1-only when the public
snapshot type becomes a union. Narrow `promotedSnapshots` to version 1 before
calling `renderSessionContextSnapshot`; do not render V2 as system text and do
not add V2 user lowering in this task. Extend the current renderer/promotion
test to lock the unchanged V1 bytes. This is a compile-compatibility step;
production V2 admission remains disabled until Task 3 installs exact
user-message lowering.

#### Step 3: Regenerate the public clients and legacy SDK

`PromptAdmitted` is part of the public Session/Event `HttpApi` even though its
new field is content-free. Start from the worktree root:

```powershell
./packages/sdk/js/script/build.ts
Set-Location packages/client
bun run generate
Set-Location ../..
git add packages/client/src/generated packages/client/src/generated-effect
Set-Location packages/client
bun run check:generated
bun test
bun typecheck
Set-Location ../sdk/js
bun test
bun typecheck
Set-Location ../../..
```

Do not edit generated output directly. Staging the Promise/Effect output before
`check:generated` is intentional because that command compares generated
worktree output with the index. The legacy SDK must be regenerated here as well
because its full OpenCode event union consumes the public marker.

#### Step 4: Verify and commit

```powershell
Set-Location packages/schema
bun test test/session-input.test.ts test/session-event.test.ts
bun typecheck
Set-Location ../..
Set-Location packages/core
bun test test/session-ctxpack-promotion.test.ts
bun typecheck
Set-Location ../..
git diff --check
git add packages/schema/src/session-input.ts packages/schema/src/session-event.ts packages/schema/test/session-input.test.ts packages/schema/test/session-event.test.ts packages/core/src/session/runner/ctxpack-context.ts packages/core/src/session/runner/llm.ts packages/core/test/session-ctxpack-promotion.test.ts packages/client/src/generated packages/client/src/generated-effect packages/sdk/js/src/v2/gen
git commit -m "feat(schema): version session context sidecars"
```

**Exit gate:** V1 and V2 decode, V2 admission requiredness is public but
content-free, and the generated Promise/Effect clients plus legacy SDK exactly
match the public schema before Wave 1 integration.

### Task 1B: Add a dedicated deterministic CtxPack recall query

**Owner:** Worker B / `ctxpack-recall`
**Files:**

- Create: `packages/core/src/ctxpack/recall.ts`
- Create: `packages/core/test/ctxpack-recall.test.ts`
- Modify only if required: `packages/core/src/ctxpack/sql.ts`
- Modify: `packages/core/src/ctxpack/index.ts`

Do not change `searchPacks()` or the public list/search sorting contract.

#### Step 1: Write failing query-policy tests

Use real SQLite/FTS fixtures, not a duplicated ranking algorithm. Cover:

- NFKC normalization, `unicode61`-compatible underscore separation, and at most
  eight first-occurrence unique terms;
- deterministic trivial skip for exactly `hi`, `hello`, `hey`, `ok`, `okay`,
  `thanks`, `thank you`, `got it`, and `sounds good` after lowercase,
  punctuation removal, and whitespace collapse; `yes`, `no`, and `continue`
  remain non-trivial;
- stop-word and punctuation-only input produces no query;
- OR semantics return a pack matching any retained term;
- workspace and non-deleted filters are mandatory;
- BM25 lower score sorts first and CtxPack ID breaks a tie;
- the fixed `MAX_RECALL_CANDIDATES = 16` cap is enforced, including the boundary
  where denied/stale rows in the first 16 do not cause a 17th row to be read;
- automatic snapshot reads enforce workspace membership, pack sensitivity,
  `ctxpack.read`, and `chat.context.attach` for the authoritative target without
  writing a ContextCapsule row; and
- raw prompt/query text is absent from diagnostic output.

Run from `packages/core`:

```powershell
bun test test/ctxpack-recall.test.ts
```

Require the missing recall API to fail before implementation.

#### Step 2: Implement the smallest internal recall surface

Expose pure policy functions and one internal database query:

```ts
type RecallCandidate = {
  readonly ctxPackID: CtxPack.ID
  readonly contentHash: string
  readonly byteLength: number
  readonly estimatedTokens: number
  readonly rank: number
}

type RecallSnapshot = {
  readonly sourceCtxPackID: CtxPack.ID
  readonly label: string
  readonly contentHash: string
  readonly fragments: readonly {
    readonly text: string
    readonly source: CtxPack.Source
    readonly contentHash: string
  }[]
}

const MAX_RECALL_CANDIDATES = 16

const RECALL_STOP_WORDS_V1 = [
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has",
  "have", "i", "in", "is", "it", "of", "on", "or", "that", "the", "this",
  "to", "was", "we", "were", "what", "when", "where", "which", "with", "you",
] as const

buildRecallTerms(text: string): readonly string[]
isTrivialRecallTurn(text: string): boolean
searchForRecall(input: {
  workspaceID: string
  terms: readonly string[]
}): Effect.Effect<readonly RecallCandidate[]>

CtxPackRecall.snapshotCandidate(input: {
  actor: CtxPackActor
  targetInstanceID: string
  targetFunctionalityID: string
  ctxPackID: CtxPack.ID
  expectedContentHash: string
}): Effect.Effect<RecallSnapshot, CtxPackError>
```

Build a parameterized FTS5 OR expression. `MAX_RECALL_CANDIDATES = 16` is part
of the immutable `operating-chat-v1` policy, not a caller tuning knob. Query
CtxPack rows joined to the FTS
table, exclude deleted rows, and order by `bm25(...) ASC, ctx_pack_id ASC`.
The query returns metadata only. `CtxPackRecall.snapshotCandidate` is a separate
internal reader, not a new method on `CtxPackMaterializer`: it checks the
instance attachment capability and pack read capability, verifies the current
hash/deletion state, and returns a deep-frozen fragment snapshot directly from
the repository. Its dependency graph contains no `ContextCapsuleStore`, so it
cannot persist automatic capsules. This preserves the materializer's explicit
capsule contract and prevents failed admission from leaving auto-recall orphans.

Do not add embeddings, a cache, an LLM reranker, or a new public endpoint.

#### Step 3: Verify and commit

```powershell
Set-Location packages/core
bun test test/ctxpack-recall.test.ts test/ctxpack-search.test.ts
bun typecheck
Set-Location ../..
git diff --check
git add packages/core/src/ctxpack/recall.ts packages/core/src/ctxpack/index.ts packages/core/src/ctxpack/sql.ts packages/core/test/ctxpack-recall.test.ts
git commit -m "feat(core): add deterministic ctxpack recall"
```

Omit `sql.ts` from `git add` when it did not need modification.

**Exit gate:** internal BM25 recall is deterministic, automatic snapshots are
authorized without durable capsule writes, and existing public search tests are
unchanged and green.

### Task 1C: Resolve the OperatingChat session profile from existing authority

**Owner:** Worker C / `context-profile`
**Files:**

- Create: `packages/core/src/session/context-profile.ts`
- Create: `packages/core/src/workspace/operating-chat-context.ts`
- Create: `packages/core/test/operating-chat-context.test.ts`
- Modify: `packages/server/src/routes.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts`

#### Step 1: Write failing resolver tests

Build real Session and FunctionalityInstance rows. Cover:

- a live OperatingChat binding resolves workspace, name, block, instance,
  functionality, generation, FunctionalityInstance revision, directory, and
  OperatingAgent;
- an ordinary persisted Session resolves a generic profile carrying its
  authoritative `workspace_id` and `directory` proof;
- a losing candidate Session never resolves as OperatingChat;
- after reset, the new Session resolves and the replaced Session becomes
  generic;
- deleted/tombstoned instances do not resolve;
- two matching live rows fail with a typed ambiguity instead of choosing one;
- `revalidate(sessionID, profile)` succeeds for unchanged authority and fails
  after a concurrent reset/reconfiguration;
- a concurrent Session `workspace_id` or `directory` change invalidates the
  resolved OperatingChat proof even when the FunctionalityInstance revision is
  unchanged;
- generic-profile revalidation fails if the Session acquires a live
  OperatingChat binding between resolution and commit; and
- no new table or Session metadata is written.

Run from `packages/core`:

```powershell
bun test test/operating-chat-context.test.ts test/operating-chat-session.test.ts
```

#### Step 2: Define the inversion port

`packages/core/src/session/context-profile.ts` owns the interface and a global
unbound `SessionContextProfile.node`. It must not import Workspace modules. The
live producer exports a replacement node with the same service tag; only that
producer may decide that a real Session is generic. Do not add a production
fallback that could silently disable OperatingChat recall when wiring is absent.

The live producer in `workspace/operating-chat-context.ts` uses the established
MasterAgent resolver pattern:

```text
SessionTable
  INNER JOIN live FunctionalityInstanceTable
    ON workspace_id matches
   AND functionality_id = builtin:operating-chat-session
  decode InstanceConfiguration
  keep rows whose owned sessionBinding.sessionID equals the requested Session
```

Load the current Workspace record only after a unique binding is found. Return
a typed ambiguity error for multiple matches. Do not add an index until a
profile proves the current workspace-scale lookup is material.

The port exposes `resolve(sessionID)` plus
`revalidate(sessionID, resolvedProfile)`. For an OperatingChat profile,
revalidation reruns the same authoritative join and compares the full proof:
Session `workspace_id` and `directory` (the actual persisted `Location.Ref`
components), functionality-instance ID, generation,
revision, and every decoded workspace/instance field consumed by assembly. For
a live generic profile, it requires that no live OperatingChat binding now owns
the Session and that it retains the same persisted `workspace_id` and
`directory`. Test-only generic profiles may omit that proof. The value contains
no CtxPack text. Admission calls `revalidate` from
its existing commit hook immediately before persisting the sidecar so reset,
reconfiguration, Session placement change, or a newly established binding
cannot race stale authority into the durable input.

#### Step 3: Wire the live producer at both composition roots

Use one global unbound profile node and one live OperatingChat producer,
then pass the same replacement pair through every relevant composition:

- `packages/server/src/routes.ts`: include the replacement in
  `AppNodeBuilder.build(applicationServices, replacements)`. That builder also
  forwards it into its generated `buildLocationServiceMap(replacements)`.
- `packages/opencode/src/server/routes/instance/httpapi/server.ts`: pass the
  pair to the explicit `buildLocationServiceMap(replacements)`, the standalone
  `AppNodeBuilderV1.build(SessionV2.node, replacements)`, and the final
  `AppNodeBuilderV1.build(app, replacements)`.

This is required because admission is global while `SessionRunnerLLM` is built
inside the Location service graph. Verify both paths plus the subagent runner's
use of that Location graph. Do not make the Location-scoped System Context
registry session-aware. Do not modify Protocol or handlers.

#### Step 4: Verify and commit

From `packages/core`:

```powershell
bun test test/operating-chat-context.test.ts test/operating-chat-session.test.ts
bun typecheck
```

From `packages/server`:

```powershell
bun typecheck
```

From `packages/opencode`:

```powershell
bun typecheck
```

Then:

```powershell
git diff --check
git add packages/core/src/session/context-profile.ts packages/core/src/workspace/operating-chat-context.ts packages/core/test/operating-chat-context.test.ts packages/server/src/routes.ts packages/opencode/src/server/routes/instance/httpapi/server.ts
git commit -m "feat(core): resolve operating chat context profile"
```

**Exit gate:** the existing FunctionalityInstance remains the only binding
authority and both server compositions provide the live profile port.

## Wave 1 integration review

The coordinator integrates the three commits, then checks:

```powershell
git diff <wave-1-base>..HEAD --check
```

From `packages/schema`:

```powershell
bun test test/session-input.test.ts
bun typecheck
```

From `packages/core`:

```powershell
bun test test/ctxpack-recall.test.ts test/ctxpack-search.test.ts
bun test test/operating-chat-context.test.ts test/operating-chat-session.test.ts
bun typecheck
```

Review specifically for:

- no target table/migration;
- no new endpoint or private public field; the only public/generated change is
  the content-free `PromptAdmitted.modelContextVersion` marker;
- no CtxPack text in errors or logs;
- no session-to-workspace import inversion; and
- no abstraction beyond the one profile port and one internal recall surface.

## Wave 2: parallel admission and stable-system integration

### Task 2D: Assemble and atomically admit V2 model-facing sidecars

**Owner:** Worker D / `context-admission`

**Depends on:** Tasks 1A, 1B, 1C
**Files:**

- Create: `packages/core/src/session/context-sidecar.ts`
- Create: `packages/core/src/session/context-slot.ts`
- Create: `packages/core/src/session/context-transfer-readiness.ts`
- Create: `packages/core/src/ctxpack/session-context.ts`
- Create: `packages/core/test/session-context-sidecar.test.ts`
- Create: `packages/core/test/fixture/session-context.ts`
- Create: `packages/opencode/src/effect/session-context.ts`
- Create: `packages/opencode/test/effect/session-context-location-map.test.ts`
- Modify: `packages/core/src/ctxpack/index.ts`
- Modify: `packages/core/src/ctxpack/wiring.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/session/context-profile.ts`
- Modify: `packages/core/src/session/input.ts`
- Modify: `packages/core/src/session/projector.ts`
- Modify: `packages/core/src/session/runner/llm.ts`
- Modify: `packages/core/src/session/sql.ts`
- Modify: `packages/core/src/session/subagent-runner.ts`
- Modify: `packages/core/src/workspace/operating-chat-context.ts`
- Modify: `packages/core/test/ctxpack-acceptance.test.ts`
- Modify: `packages/core/test/effect/layer-node/node-build.test.ts`
- Modify: `packages/core/test/integration/master-agent-session.test.ts`
- Modify: `packages/core/test/location-layer.test.ts`
- Modify: `packages/core/test/operating-chat-context.test.ts`
- Modify: `packages/core/test/session-create.test.ts`
- Modify: `packages/core/test/session-ctxpack-admission.test.ts`
- Modify: `packages/core/test/session-ctxpack-promotion.test.ts`
- Modify: `packages/core/test/session-history.test.ts`
- Modify: `packages/core/test/session-projector.test.ts`
- Modify: `packages/core/test/session-prompt.test.ts`
- Modify: `packages/core/test/session-runner-recorded.test.ts`
- Modify: `packages/core/test/session-runner.test.ts`
- Modify: `packages/core/test/session-subagent-runner.test.ts`
- Modify: `packages/server/src/routes.ts`
- Modify: `packages/server/test/integration/master-agent-api.test.ts`
- Modify: `packages/opencode/src/agent/agent.ts`
- Modify: `packages/opencode/src/cli/cmd/debug/file.ts`
- Modify: `packages/opencode/src/cli/cmd/debug/v2.ts`
- Modify: `packages/opencode/src/effect/app-runtime.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts`
- Modify: `packages/opencode/src/session/session.ts`
- Modify: `packages/opencode/src/session/system.ts`
- Modify: `packages/opencode/test/session/compaction.test.ts`
- Modify: `packages/opencode/test/session/prompt.test.ts`

#### Step 1: Write RED tests for pure rendering and hashing

Cover:

- canonical ordered explicit-request hashing;
- literal fingerprint goldens from the design for the `cap-1` fixture and the
  empty `[]` request;
- capsule ID, source ID, content hash, and label all participate in that hash;
- automatic results do not affect `contextRequestHash`;
- deterministic fixed renderer output and UTF-8 SHA-256;
- literal equality with the renderer-version-1 golden frame, key order,
  separators, notice text, and post-JSON escaping frozen in the design;
- clean text is first and CtxPack text is inside the untrusted
  `<workspace-context>` envelope;
- the envelope body is fixed-order canonical JSON and escapes `&`, `<`, and `>`
  as Unicode JSON escapes after normal JSON quoting;
- fragments containing `</workspace-context>`, fake provenance delimiters,
  quotes, backticks, control characters, or Unicode cannot alter framing and
  replay byte-identically;
- explicit order precedes automatic order;
- compact provenance matches rendered sources;
- final byte/token measurement includes the rendered wrapper and provenance;
- measurement retains the current UTF-8 bytes and `ceil(bytes / 4)` estimator;
- the one strict V2 decoder accepts the owning clean prompt and recomputes the
  canonical wrapper, explicit `contextRequestHash`, `apiContentHash`, injected
  byte length, and token estimate;
- valid-shape tampering of `apiContent`, provenance, either hash, byte length,
  or token estimate fails with the typed corruption error;
- explicit overflow rejects, while an oversized early automatic candidate is
  skipped and a later smaller candidate is retained; scanning continues through
  at most 16 returned candidates until four fit;
- an explicit selection whose legacy V1 serialized snapshot exceeds the
  caller budget still succeeds when its canonical compact V2 envelope fits,
  proving the final renderer—not V1-only metadata overhead—owns the enriched
  budget decision; and
- no-recall OperatingChat input still produces V2 `apiContent` equal to its
  clean text, with no empty context wrapper.

Run:

```powershell
Set-Location packages/core
bun test test/session-context-sidecar.test.ts
```

#### Step 2: Write RED admission tests

Extend the real admission tests to prove:

- generic plain prompt keeps a null sidecar and performs no recall;
- a `v1-local-explicit` test composition stays on the compatible V1 snapshot
  path, performs no automatic recall, and creates no V2 marker;
- a `v1-clean-only` test composition admits a clean prompt with no sidecar but
  rejects explicit attachments with the fixed unavailable error;
- generic explicit prompt stores V2 and uses the generic chat target;
- OperatingChat plain prompt resolves the real functionality instance and
  stores V2;
- an OperatingChat prompt without user identity admits clean text with
  `unavailable`, while an explicit attachment without identity fails
  `missing-actor`;
- explicit attachments materialize first and fail the admission on any error;
- a non-trivial OperatingChat prompt searches once, selects at most four auto
  packs, and respects the combined eight-attachment and existing byte/token
  budget;
- trivial input skips search;
- duplicate explicit/automatic pack content appears once;
- capability-denied/deleted/stale/oversized automatic candidates are skipped;
- all 16 returned candidates may be skipped without a second query or any
  attempt to read a valid row 17;
- recall read/storage failure produces a sanitized `unavailable` sidecar and
  still admits explicit-only/clean content;
- automatic recall creates no ContextCapsule rows, including when admission
  later fails;
- no raw fragment/query text appears in errors, events, logs, or diagnostics;
- every V2 event exposes only `modelContextVersion: 2`, its projector writes a
  pending marker, and successful admission atomically replaces that marker;
- the SQL slot's Core-private stored union decodes complete V1/V2 values or the
  exact `{ state: "pending", version: 2 }` marker, while the public snapshot
  decoder rejects pending;
- replaying a V2 admission without its private sidecar leaves the pending
  marker and fails a typed read/provider turn instead of using clean text;
- the shared private-slot read and exact retry against pending fail with that
  same typed missing-private-context error;
- same ID + same request returns the stored input without invoking recall or
  materialization again;
- same ID + changed explicit selection conflicts;
- the same ID with only a changed label conflicts through public
  `SessionV2.prompt`;
- two concurrent admissions using the same message ID but different context
  produce one winning sidecar and one conflict; usage is best-effort,
  winner-only, and at most once, while concurrent equal retries never invoke it
  for the loser;
- typed usage-port failure and a non-interruption defect cannot fail or alter
  the already committed admission; both are caught and logged with bounded
  metadata, while interruption remains interruption;
- V1 rows derive a compatible explicit request hash; and
- a reset between profile resolution and commit rejects stale admission and
  leaves no input/sidecar row.

Run:

```powershell
bun test test/session-ctxpack-admission.test.ts
```

Require the new assertions to fail before production changes.

#### Step 3: Replace the snapshot-only port with one assembly contract

The current internal `SessionCtxSnapshotPort` can only materialize explicit V1
attachments. Replace it with one private Session-owned contract and remove the
old tag/node after static search confirms no external consumer:

```ts
interface SessionContextAssemblyPort {
  assemble(input: {
    actor?: { userID: string; workspaceID?: string }
    sessionID: SessionSchema.ID
    promptText: string
    explicitAttachments: readonly SessionContextAttachmentInput[]
    budget: ContextBudget
    profile: SessionContextProfile
    mode: "v1-local-explicit" | "v1-clean-only" | "v2-enriched"
  }): Effect.Effect<{
    snapshot?: SessionContextSnapshot
  }, SessionContextAssemblyError>
}

interface SessionContextTransferReadiness {
  withPermit<A, E, R>(
    input: {
      sessionID: SessionSchema.ID
      actor?: { userID: string; workspaceID?: string }
      hasContextAttachments: boolean
    },
    run: (
      mode: "v1-local-explicit" | "v1-clean-only" | "v2-enriched",
    ) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R>
}
```

Add one small `SessionContextTransferReadiness` port beside the assembly port.
Its callback selects only the assembly mode and owns the dynamic scope from
profile resolution through the EventV2 transaction and sidecar commit hook.
Callers receive no detachable permit and no HTTP/proof value. Exact retry stays
inside that scope so readiness fences new and reconciled admission equally.
Both production compositions provide an explicit not-ready layer in this
intermediate task; focused tests may provide a ready fake. Task 2G replaces
those layers with process-role-aware local readiness: authenticated combined
OpenCode and authenticated standalone Server select `v2-enriched`, open
listeners select clean-only and reject nonempty context, and managed children
reject V2 before assembly.
Admission checks readiness before assembly can create a V2 marker.

`SessionInput` owns the unbound global port and profile types; Session-owned
`context-sidecar.ts` owns renderer inputs/provenance and imports no CtxPack
module. The CtxPack wiring node adapts `CtxPackMaterializer`, the internal
recall query, and diagnostics to that Session-owned contract. Replace
`sessionCtxSnapshotPortNode` with `sessionContextAssemblyPortNode` in the
`packages/server` application group and the OpenCode `app` group. Do not make
Session input import CtxPack modules.

Add `SessionContextAssemblyPort.node` and `SessionContextProfile.node` to
`SessionV2.node`'s explicit dependency list together with
`SessionContextTransferReadiness.node`. This makes all three services available
to `SessionInput.admit`; do not rely on ambient Layer provision. Update the
standalone Server not-ready layer, the OpenCode not-ready layer, and every test
fake explicitly. Each `AppNodeBuilder` needs explicit replacement tuples, not
only sibling nodes in a group: Server replaces assembly with the live CtxPack
assembly, profile with `OperatingChatContext`, and readiness with its named
not-ready node; OpenCode passes the same three replacements to
`buildLocationServiceMap(...)`, `build(SessionV2.node, ...)`, and the final
`build(app, ...)` call.

OpenCode must expose one named three-service composition in
`effect/session-context.ts` and use it everywhere production can acquire a
Location graph. The HTTP Session/File/PTY paths, Agent/System tracked-node
paths, AppRuntime, and CLI debug commands must either inherit that explicit map
or construct it from the same named replacement set. No production consumer may
fall back to the default `locationServiceMapLayer`, because the context ports
are intentionally unbound.

Export named generic-profile, V1-explicit, and clean-only node constructors,
but never auto-compose them as production fallbacks. Put the Core test set in
`test/fixture/session-context.ts`; the fixture is a three-service replacement
set: clean assembly, generic profile, and explicit readiness. Every direct
`SessionV2.node` test listed in this task must pass that set or a
behavior-specific ready fake. Server/OpenCode tests pass the same three named
constructors explicitly at their own composition root.
Before committing, rerun `rg -l "SessionV2\.node"` across Core, Server, and
OpenCode tests and account for every result.

`SessionInput.admit` is also called directly by `SubagentRunner`. Add the three
context-port nodes to `SubagentRunner.node`'s explicit Location dependency
graph and give its focused tests the named generic/not-ready or V1-explicit
fixtures. A child prompt must not obtain an ambient ready permit or an
OperatingChat profile merely because its parent shares a Location.

#### Step 4: Implement one CtxPack assembly service

Keep orchestration out of the wiring module. The service should:

1. receive actor, Session ID, clean prompt text, explicit attachments, budget,
   readiness-selected mode, and the profile resolved by Session admission;
2. for OperatingChat, use the profile workspace and reject an actor-workspace
   mismatch before any query;
3. validate/count explicit attachments;
4. materialize the explicit V1 fragment snapshot with the real profile target
   or the existing generic chat target;
   in enriched mode use that materializer for validation and immutable
   fragment capture without treating its V1 JSON byte/token measurement as the
   caller's final budget check; the canonical V2 renderer in step 8 owns that
   decision, while V1 compatibility mode retains the legacy check;
5. in `v1-local-explicit` mode, return the existing explicit V1 snapshot and
   never search; in `v1-clean-only` mode reject any explicit attachment with a
   fixed typed unavailable error and return no sidecar for a clean prompt;
   otherwise, for OperatingChat only, apply trivial skip or run internal recall;
6. greedily process the returned candidates in ranked order by calling
   `CtxPackRecall.snapshotCandidate`, deduplicating, tentatively appending, and
   rendering each one against the final budget before keeping it; continue
   after denied/stale/deleted/oversized candidates until four fit or all 16 are
   exhausted, never query/read row 17, and never materialize an automatic
   capsule;
7. fail closed for explicit errors and fall back to explicit-only/clean for
   automatic errors;
8. render, measure, and enforce the final envelope; reject explicit overflow;
9. render exactly one V2 sidecar in enriched mode, preserve the existing V1
   snapshot only in local-explicit mode, or keep clean-only mode sidecar-free;
   and
10. return only the snapshot; record bounded counts/sizes/status internally for
    diagnostics and never emit query, request, or API-content hashes to
    telemetry. Winner usage IDs are derived later from the strictly decoded
    committed sidecar, never from a second assembly return value.

Use the explicit materializer's stored snapshot label and the automatic pack's
authoritative title in the envelope. Because the explicit label is
model-visible, it remains part of the request fingerprint.

Do not interpolate labels or fragment text directly into tag/provenance lines.
Build one fixed-key object, canonical-JSON encode it, replace `&`, `<`, and `>`
with their Unicode JSON escapes, then place those bytes between the fixed
wrapper delimiters. Hash and budget the final escaped bytes.

#### Step 5: Fix retry reconciliation before recall

Route tests through public `SessionV2.prompt`, then move the existing-row
decision ahead of profile resolution and all recall/materialization.
`SessionInput.admit` computes the canonical explicit hash first and its existing
row query must use the single strict sidecar decoder with the owning clean
prompt before `equivalent()` compares:

- Session;
- resolved prompt;
- delivery;
- canonical explicit `contextRequestHash` derived from stored V2, stored V1, or
  empty legacy state.

That decoder schema-validates, verifies canonical framing/provenance, and
recomputes/compares the explicit request hash, exact API-content hash,
injected-envelope UTF-8 byte length, and token estimate. The stored-slot decoder
first distinguishes pending, V1, and V2: pending maps to the sanitized
missing-private-context admission code; V1 uses only its compatibility
schema/fingerprint; V2 requires `rendererVersion === 1` and the strict framing
checks. Conflict through the existing `LifecycleConflict`/`PromptConflictError`
path.
This explicitly changes the current `admit()` behavior that returns an existing
row before checking context. An exact retry returns immediately with no profile
port, assembly port, search, materializer, or diagnostic call.

Make the internal admission result distinguish `created` from `existing`.
Catch only the known `SessionInput.LifecycleConflict`/duplicate-publication
defect when concurrent publication loses to another writer; arbitrary storage,
commit-hook, validation, or profile defects must keep failing. Then reload and strictly decode
the winner, rerun equivalence, and return `created: false` only for an exact
winner; otherwise return the prompt conflict. Record CtxPack usage only after
this invocation actually commits the event/sidecar (`created: true`), using the
winning committed sidecar provenance. A loser or exact retry must never record
false or duplicate usage from its preassembled snapshot. The post-commit ledger
is idempotent but best-effort: this guarantees at-most-once winner-only usage,
not exactly-once recovery after a process crash. Derive its distinct pack IDs
only from the strictly decoded committed snapshot. Catch both typed failures and
non-interruption defects from the usage port after commit, log bounded metadata,
and preserve interruption.

#### Step 6: Resolve, assemble, revalidate, and commit once

For a new input, `SessionInput.admit` checks transfer readiness, resolves
`SessionContextProfile`, passes it to the assembly port, then publishes the
existing `PromptAdmitted` event. Set `modelContextVersion: 2` only when V2
private context is both required and ready. A `v1-local-explicit` composition
retains the compatible V1 explicit snapshot path. A `v1-clean-only`
composition disables automatic recall, admits clean prompts without a sidecar,
and rejects explicit attachments. Pass that choice as the assembly mode; do not retain a second
snapshot port or bypass the single assembly service. Its projector writes a small pending-V2 marker into
`context_snapshot_json`. Install a commit hook for every newly admitted row,
including generic clean-only and sidecar-free V1 inputs. The hook
first calls `profilePort.revalidate(sessionID, profile)`, then conditionally
validates/writes V1 or replaces the V2 pending marker. This preserves the
observed absence of a binding as part of admission authority. Keep the readiness
scope held until the transaction closes. A stale profile fails the admission
scope and must not retain an input row.

Because EventV2 commit hooks are defect-only inside the transaction, convert
only the known profile revalidation error to a recognizable private defect so
the transaction rolls back, then recover it outside `publish` as the existing
sanitized `SessionInput.ContextAttachmentError` code. Map pending/corrupt private
reads to the same existing error surface. Do not widen the public Session or
Protocol error union in this task, and never reconcile these defects as a
concurrent winner.

Keep EventV2 `PromptAdmitted` publication, projector, and commit hook as the
single admission transaction. Do not add a second transaction or event with
fragment text. A pending marker is never a valid provider-side snapshot:
strict reads and exact retries surface a typed missing-private-context error.

Define the pending marker and stored-slot Effect Schema plus the only strict V2
decoder in the Core-private
`session/context-slot.ts`. Type the Drizzle JSON column as that stored union.
Decode through it at the database boundary, then return only complete public
`SessionContextSnapshot` values to assembly/runner callers. No event/sync replay
may repair null/pending; it is never accepted as model content.

Update usage recording to read the compact V2 attachment provenance as well as
legacy V1 attachments, and call it only for a newly committed admission.

#### Step 7: Verify and commit

Start from the worktree root:

```powershell
Set-Location packages/core
bun test test/session-context-sidecar.test.ts
bun test test/session-ctxpack-admission.test.ts test/session-ctxpack-promotion.test.ts
bun test test/session-subagent-runner.test.ts
bun test test/ctxpack-acceptance.test.ts test/ctxpack-materialize.test.ts
bun test test/operating-chat-context.test.ts
bun test
bun typecheck
Set-Location ../server
bun test test/integration/master-agent-api.test.ts
bun typecheck
Set-Location ../opencode
bun test test/session/compaction.test.ts test/session/prompt.test.ts
bun test test/effect/session-context-location-map.test.ts
bun typecheck
Set-Location ../..
git diff --check
git add packages/core/src/ctxpack/index.ts packages/core/src/ctxpack/session-context.ts packages/core/src/ctxpack/wiring.ts packages/core/src/session.ts packages/core/src/session/context-profile.ts packages/core/src/session/context-sidecar.ts packages/core/src/session/context-slot.ts packages/core/src/session/context-transfer-readiness.ts packages/core/src/session/input.ts packages/core/src/session/projector.ts packages/core/src/session/runner/llm.ts packages/core/src/session/sql.ts packages/core/src/session/subagent-runner.ts packages/core/src/workspace/operating-chat-context.ts packages/core/test/ctxpack-acceptance.test.ts packages/core/test/effect/layer-node/node-build.test.ts packages/core/test/fixture/session-context.ts packages/core/test/integration/master-agent-session.test.ts packages/core/test/location-layer.test.ts packages/core/test/operating-chat-context.test.ts packages/core/test/session-context-sidecar.test.ts packages/core/test/session-create.test.ts packages/core/test/session-ctxpack-admission.test.ts packages/core/test/session-ctxpack-promotion.test.ts packages/core/test/session-history.test.ts packages/core/test/session-projector.test.ts packages/core/test/session-prompt.test.ts packages/core/test/session-runner-recorded.test.ts packages/core/test/session-runner.test.ts packages/core/test/session-subagent-runner.test.ts packages/server/src/routes.ts packages/server/test/integration/master-agent-api.test.ts packages/opencode/src/agent/agent.ts packages/opencode/src/cli/cmd/debug/file.ts packages/opencode/src/cli/cmd/debug/v2.ts packages/opencode/src/effect/app-runtime.ts packages/opencode/src/effect/session-context.ts packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts packages/opencode/src/server/routes/instance/httpapi/server.ts packages/opencode/src/session/session.ts packages/opencode/src/session/system.ts packages/opencode/test/effect/session-context-location-map.test.ts packages/opencode/test/session/compaction.test.ts packages/opencode/test/session/prompt.test.ts
git commit -m "feat(core): admit exact operating chat context"
```

Omit unchanged optional files from staging.

**Exit gate:** every ready OperatingChat input has one immutable V2 sidecar,
the V1-explicit composition keeps compatibility, clean-only rejects explicit
context while clean input stays sidecar-free, exact retry cannot
trigger a second recall, and no production
composition can admit V2 before Task 3 lowering lands.

### Task 2E: Fold agent and OperatingChat host context into Context Epochs

**Owner:** Worker E / `context-system`

**Depends on:** Task 2D (and therefore Task 1C)
**Files:**

- Create: `packages/core/test/session-runner-system-context.test.ts`
- Modify: `packages/core/src/system-context/index.ts`
- Extend: `packages/core/test/system-context/index.test.ts`
- Modify: `packages/core/src/session/runner/index.ts`
- Modify: `packages/core/src/session/runner/llm.ts`
- Extend: `packages/core/test/session-runner.test.ts`
- Extend: `packages/core/test/session-runner-recorded.test.ts`
- Extend if the existing coverage needs it:
  `packages/core/test/session-subagent-runner.test.ts`

#### Step 1: Write RED Context Epoch tests

Use the real runner/context epoch with a captured LLM request. Cover:

- selected agent system text appears in the persisted epoch baseline and is
  absent from separate call-time system additions;
- OperatingChat host identity appears only for an OperatingChat Session;
- two blocks in one Location produce distinct host identity;
- ordinary turns and process/service restart reuse a byte-identical baseline;
- workspace/profile or selected-agent identity/system-source
  add/change/removal returns `ReplacementReady`, publishes no
  `ContextUpdated`, and installs the current private baseline at the next safe
  boundary before the next provider call; permission- or step-only changes do
  not claim to alter the byte-stable prefix;
- an agent switch sends the new agent instruction on that next provider call
  alongside the same agent's tools, permissions, and turn limit—never the old
  instruction with new runtime policy;
- privileged-source replacement emits no `SessionEvent.ContextUpdated` row in
  raw EventV2 history or the event-stream projection, and no such event text
  contains the selected agent system prompt or profile-only
  block/functionality-instance/binding fields. Existing lifecycle events may
  legitimately carry the Session location directory and are not part of this
  assertion;
- compaction replacement also creates a fresh private baseline with current values;
- an ambiguous profile fails before provider invocation;
- promoted V2 sidecars never appear in `request.system`; and
- a real `buildLocationServiceMap(...)` graph receives the same live/spy
  profile replacement rather than the generic fallback. Prove this in the new
  system-context suite; the existing SubagentRunner suite replaces
  `SessionRunnerLLM.node` with a mock and cannot satisfy this gate. Do not let
  Task 2D's bundled generic test replacement shadow the live profile tuple.

Run:

```powershell
bun test test/session-runner-system-context.test.ts
```

#### Step 2: Build session-aware sources without changing the registry

Keep the existing registry, skill guidance, and reference guidance. Add pure
System Context sources for:

- selected agent ID/system instruction; and
- the resolved OperatingChat profile.

Create the agent source whenever a selected `agent.info` exists and snapshot
only its `{ id, system }`. This defines replacement semantics for selected-agent
identity/instruction changes without making permission- or step-only policy
part of the rendered prefix.

Mark both sources `refresh: "replacement-only"`. Extend the existing System
Context algebra and its private `SourceSnapshot` with that optional policy:
reconciliation maps a new/changed/removed replacement-only source to the
existing `ReplacementReady` flow without rendering update/removal text, while
`replace(...)` observes the current value for a fresh generation. Existing
sources default to chronological behavior.
Test changed, newly added, and removed privileged sources directly in
`system-context/index.test.ts`.

Compose them directly in the existing `loadSystemContext(session, agent)`
inside `runner/llm.ts`; do not create a single-use
`runner/system-context.ts`. The OperatingChat source must have a stable
namespaced key and complete baseline, update, and removal semantics. It includes
no layout transform, transcript, CtxPack content, or credentials.

Resolve the profile once at the existing safe provider-turn boundary with
`const profile = yield* profiles.resolve(session.id)`, before calling the
Context Epoch APIs. Pass that already-resolved value into an error-free
`loadSystemContext(agent, profile)`; `SessionContextEpoch.initialize/prepare`
continue receiving an infallible context effect and are not generalized in this
task. Preserve one sampled agent value for its source text, skill guidance, tools,
permissions, provider-turn allowance, and assistant attribution so a switch can
never pair a new runtime policy with an old system instruction. Add
`SessionContextProfile.AmbiguousError` to `SessionRunner.RunError`; ambiguity is
a typed run failure and must stop before provider invocation, never become an
`orDie` defect.

Add `SessionContextProfile.node` to `SessionRunnerLLM.node`'s explicit
Location-node dependencies. Task 1C's shared replacement list then feeds the
same live service through `buildLocationServiceMap`, including subagent runners.

Remove `agent.info.system` from the separate `request.system` array after the
epoch tests prove it is present in `system.baseline`.

The current runner renders every promoted context snapshot into
`request.system`. Restrict that compatibility branch to V1 only. V2 is never a
system addition: Wave 3 lowers its `apiContent` into the owning user message.
Until Wave 3 lands, a V2 promotion must not be silently rendered in another
channel.

#### Step 3: Preserve SessionV2 invariants

- Initialize complete context before first promotion.
- Reconcile only at the existing safe provider-turn boundary; privileged
  replacement-only changes install their fresh private epoch before the next
  provider call and produce no chronological event.
- Keep `promptCacheKey` session-based.
- Keep one `llm.stream(request)` call per provider turn.
- Do not wake an idle Session for a context-source change.

#### Step 4: Verify and commit

```powershell
Set-Location packages/core
bun test test/session-runner-system-context.test.ts test/session-runner.test.ts test/session-runner-recorded.test.ts test/session-subagent-runner.test.ts
bun test test/session-ctxpack-promotion.test.ts
bun test test/system-context/index.test.ts test/system-context/registry.test.ts
bun typecheck
Set-Location ../server
bun test test/integration/master-agent-api.test.ts
bun typecheck
Set-Location ../opencode
bun test test/session/compaction.test.ts test/session/prompt.test.ts
bun typecheck
Set-Location ../..
git diff --check
git add packages/core/src/system-context/index.ts packages/core/src/session/runner/index.ts packages/core/src/session/runner/llm.ts packages/core/test/system-context/index.test.ts packages/core/test/session-runner-system-context.test.ts packages/core/test/session-runner.test.ts packages/core/test/session-runner-recorded.test.ts packages/core/test/session-subagent-runner.test.ts
git commit -m "feat(core): cache operating chat system context"
```

**Exit gate:** the Context Epoch is the sole stable system-prefix authority for
agent and OperatingChat host instructions, and those privileged bytes never
enter public chronological update events.

### Task 2F: Project the canonical CtxPack target into App composers

**Owner:** Worker F / `context-target`

**Depends on:** Task 1C's frozen target identity
**Operational prerequisite:** the benchmark-harness cleanup must be committed
and its serial suite green before recording Task 2F's `before` baseline. Task
2F must not absorb benchmark-file edits, because its before/after scenario sets
must be identical.
**Files:**

- Modify: `packages/app/src/pages/canvas/session-target.tsx`
- Extend: `packages/app/src/pages/canvas/session-target.test.tsx`
- Modify:
  `packages/app/src/pages/canvas/runtime/registrations/operating-chat.ts`
- Extend:
  `packages/app/src/pages/canvas/runtime/registrations/operating-chat.test.ts`
- Modify: `packages/app/src/pages/canvas/workspace.tsx`
- Extend: `packages/app/src/pages/canvas/operating-chat.browser.test.tsx`
- Modify: `packages/app/src/pages/session-surface-base.tsx`
- Extend: `packages/app/src/pages/session-surface-base.browser.test.tsx`
- Modify: `packages/app/src/components/prompt-input/contracts.ts`
- Modify: `packages/app/src/components/prompt-input.tsx`
- Create: `packages/app/src/components/prompt-input-ctxpack-target.test.tsx`
- Modify: `packages/app/src/components/prompt-input-v2.tsx`
- Modify or delete if made obsolete:
  `packages/app/src/components/prompt-input/composer-id.ts`
- Extend: `packages/app/src/components/prompt-input/composer-id.test.ts`
- Extend: `packages/app/src/components/prompt-input-v2.test.tsx`

#### Step 0: Record the production benchmark baseline

Before any App production edit, run the package's serial production benchmark
suite from the worktree root and preserve every emitted `BENCHMARK` and
`BENCHMARK_PAGE` JSON line in the worker's task report under a `before` label:

```powershell
Set-Location packages/app
$env:PLAYWRIGHT_WORKERS = "1"
bun run test:bench
Set-Location ../..
```

Do not invent a machine-dependent pass threshold. The baseline records the
scenario set, completion, metric collection, and raw metrics for comparison.

#### Step 1: Write RED target-plumbing tests

Prove through the real component/controller boundaries:

- OperatingChat calls CtxPack materialization with the runtime view's
  `functionalityInstanceID` and `builtin:operating-chat-session`;
- the OperatingChat registration preserves the binding response's
  `functionalityInstanceID` in its resolved/view projection;
- an established generic Session uses `chat-instance:<sessionID>` and
  `builtin:chat` in both V1 and V2 composers;
- a composer without a Session disables CtxPack drop and cannot materialize an
  ephemeral `v1-composer-*`/`v2-composer-*` capsule through either the wrapper
  drop target or the V2 editor's inner `view.onDrop`/direct `addCtxPack` path;
- an explicitly supplied but empty/malformed override fails closed rather than
  silently falling back to the generic target; and
- target normalization preserves the optional context target while
  `targetKey()` remains based on Session/location identity and does not fork a
  second surface store.

Run from the worktree root:

```powershell
Set-Location packages/app
bun test --conditions=solid --isolate --preload ./happydom.ts src/pages/canvas/session-target.test.tsx src/components/prompt-input/composer-id.test.ts src/components/prompt-input-ctxpack-target.test.tsx src/components/prompt-input-v2.test.tsx src/pages/canvas/runtime/registrations/operating-chat.test.ts
bun test --conditions=browser --isolate --preload ./happydom.ts src/pages/canvas/operating-chat.browser.test.tsx src/pages/session-surface-base.browser.test.tsx
Set-Location ../..
```

#### Step 2: Add one internal target projection

Extend `SessionSurfaceTarget` and `PromptInputProps` with an optional internal
shape:

```ts
contextTarget?: {
  instanceID: string
  functionalityID: string
}
```

`OperatingChatBody` supplies the live runtime view's functionality-instance ID
and `builtin:operating-chat-session`. `SessionSurfaceBase` forwards that value
to both composer implementations. If absent and a Session ID exists, the
composer derives only the canonical generic target
`chat-instance:<sessionID>`/`builtin:chat`. If no Session exists, drop is
disabled and no materialization request is sent.

Resolve one target object reactively and use it for both drop registration and
`store.addCtxPack`. V2 must forward `contextTarget` with a getter rather than
capturing a binding value that reset/refresh can replace. Generic fallback is
allowed only when the override itself is `undefined`; an explicitly supplied
invalid projection disables materialization. Both composers' `addCtxPack`
functions re-resolve and return before dispatch when there is no valid target,
and V2's inner `view.onDrop` also returns `false` while disabled. A disabled
wrapper alone is not an authority boundary.

This value is a convenience projection for the existing capsule endpoint, not
admission authority. Core independently resolves and revalidates the live
profile, so a stale browser projection fails closed.

The runtime registration first carries
`result.data.functionalityInstanceID` into `OperatingChatView`; do not derive it
from the block ID or layout.

#### Step 3: Remove ephemeral capsule identity behavior

Delete or narrow `createCtxPackComposerIdentity` so it cannot produce random or
prefix-based capability subjects. Keep a helper only if both composers reuse a
canonical `contextTarget(sessionID, override)` calculation; do not preserve
dead flexibility.

#### Step 4: Verify and commit

```powershell
Set-Location packages/app
bun run test:unit
bun run test:browser
bun typecheck
$env:PLAYWRIGHT_WORKERS = "1"
bun run test:bench
Set-Location ../..
git diff --check
```

Preserve the second benchmark's emitted JSON lines under an `after` label and
compare the identical scenario set with Step 0. Require every scenario and
metric collection to complete. Investigate and explain a material regression
before commit, but do not turn host-dependent timing into a hard threshold.

Only after that comparison gate passes, stage and commit from the worktree root:

```powershell
git add packages/app/src/pages/canvas/session-target.tsx packages/app/src/pages/canvas/session-target.test.tsx packages/app/src/pages/canvas/runtime/registrations/operating-chat.ts packages/app/src/pages/canvas/runtime/registrations/operating-chat.test.ts packages/app/src/pages/canvas/workspace.tsx packages/app/src/pages/canvas/operating-chat.browser.test.tsx packages/app/src/pages/session-surface-base.tsx packages/app/src/pages/session-surface-base.browser.test.tsx packages/app/src/components/prompt-input/contracts.ts packages/app/src/components/prompt-input.tsx packages/app/src/components/prompt-input-ctxpack-target.test.tsx packages/app/src/components/prompt-input-v2.tsx packages/app/src/components/prompt-input/composer-id.ts packages/app/src/components/prompt-input/composer-id.test.ts packages/app/src/components/prompt-input-v2.test.tsx
git commit -m "fix(app): use canonical ctxpack targets"
```

Omit unchanged optional files from staging.

**Exit gate:** every explicit capsule is created for the same target Core will
validate, a no-Session composer creates none, and the production benchmark
comparison is recorded without an unexplained regression.

## Wave 2 integration review

Integrate D, E, then F and review the App target projection. Do not execute
Task 2G yet; Tasks 3A and 3B must make replay/compaction sidecar-aware before
local enriched activation. Resolve conflicts by preserving canonical target
projection and keeping sidecar content out of `request.system`.

From `packages/core`:

```powershell
bun test test/session-context-sidecar.test.ts test/session-ctxpack-admission.test.ts
bun test test/session-runner-system-context.test.ts test/session-runner.test.ts test/session-subagent-runner.test.ts
bun test test/session-run-coordinator.test.ts test/session-execution-local.test.ts
bun typecheck
```

Review the resulting `llm.ts` and `input.ts` for these exact invariants:

- recall runs only before first admission;
- the admission commit hook remains atomic;
- the System Context registry remains Location-scoped and argument-free;
- call-time system additions contain no new V2 recalled context;
- no raw CtxPack text is logged; and
- generic SessionV2 has no automatic recall.

From `packages/schema`, rerun `bun test test/event-manifest.test.ts` and
`bun typecheck`. From `packages/app`, run Task 2F's focused target tests and
`bun typecheck`, then confirm no composer-prefixed materialization target
remains in production. Production readiness stays not-ready until Task 2G.

## Wave 3: exact replay and private compaction

Wave 3 is serial and split into independently reviewable green commits 3A and
3B. Production readiness remains not-ready through both commits. After 3B is
green, execute Task 2G as the single local activation; Wave 3 itself adds no
network or worker authority.

### Task 3A: Lower exact sidecars across turns

**Owner:** coordinator or one serial worker

**Depends on:** Tasks 2D and 2E
**Files:**

- Modify: `packages/core/src/session/input.ts` only for a narrow read helper if
  Task 2D did not already expose it
- Modify: `packages/core/src/session/runner/to-llm-message.ts`
- Modify: `packages/core/src/session/runner/llm.ts`
- Extend: `packages/core/test/session-runner-message.test.ts`
- Extend: `packages/core/test/session-ctxpack-promotion.test.ts`
- Extend: `packages/core/test/session-runner.test.ts`
- Create: `packages/core/test/session-context-replay.test.ts`

#### Step 1: Write RED exact-replay tests

Prove with captured canonical LLM requests:

- turn N sends V2 `apiContent` as the user text;
- turn N+1 replays turn N with exactly the same string;
- the visible Session message remains the clean user text;
- durable file/media parts and metadata are preserved beside replaced text;
- tool calls/results remain ordered with their owning assistant turn;
- generic/no-sidecar user messages lower exactly as before;
- a current legacy V1 snapshot uses the compatibility system addition once and
  is not duplicated in user content;
- no V2 snapshot appears in `request.system`;
- a completed historical V2 turn is corrupted, then a later provider turn fails
  before an additional `llm.stream`; table-drive malformed JSON, renderer
  version, API content, canonical provenance, request/content hash, byte length,
  and token estimate, plus corrupt V1 JSON, so current-promotion validation
  cannot make this replay assertion pass accidentally;
- a pending/corrupt sidecar outside the active history window is not decoded;
- an active V2-required input whose row or slot is missing/null/pending fails
  with the same missing-private-context error, while a true legacy admission
  without the V2 durable marker remains clean; and
- an active V2 marker paired with a valid V1 snapshot also fails before
  `llm.stream`; marker version 2 requires decoded snapshot version 2 and cannot
  silently take the V1/clean compatibility path; and
- process/service restart replays the same V2 `apiContent` without CtxPack
  access, proven by closing and reopening a temporary on-disk database.

Run from `packages/core`:

```powershell
Set-Location packages/core
bun test test/session-runner-message.test.ts test/session-ctxpack-promotion.test.ts test/session-runner.test.ts test/session-context-replay.test.ts
Set-Location ../..
```

#### Step 2: Load active sidecars by message ID

Add one Session-owned helper that fetches sidecars and their durable
`PromptAdmitted.modelContextVersion` markers only for active user message IDs
returned by `SessionHistory.entriesForRunner`. Scope both reads by `session_id`
plus those IDs, schema-decode the durable marker, index the results, then iterate
active user messages in history order so the first corruption is deterministic.
Return a `ReadonlyMap<Message.ID, SessionContextSnapshot>`. A V2 marker makes
the private row/slot mandatory: missing row, null, or pending fails with
`MissingPrivateContext`, and a decoded V1 snapshot is a typed version mismatch;
only an admission with no V2 marker may remain clean or use V1 compatibility.
Do not load every Session input and do not derive the map only from the current
turn's promoted/retry rows.

The current `contextSnapshotsOf()` returns an ordered array and loses IDs;
supplement it rather than removing it, because the current-turn V1 compatibility
system branch still consumes that ordered array. Sort/order comes from Session
history, never from the SQL map.

For V2, call Task 2D's single strict decoder with the owning projected
`SessionMessage.User.text`, not a duplicate prompt/input field; do not add
another schema-only decode path. The same decoder is used by early retry,
runner lowering, compaction serialization, and local compatibility projection.

The new sidecar lookup/lowering path must not query CtxPack, capsules, or the
profile resolver. The runner still performs Task 2E's one profile resolution at
each safe provider-turn boundary for Context Epoch replacement.

#### Step 3: Make user lowering sidecar-aware

Make the decoded map a required `toLLMMessages` input and update every direct
caller with a typed empty map when no sidecars exist; a silent default could
drop model-facing context. Add the pure lowering assertions to
`session-runner-message.test.ts`. For each user message:

- V2: use `apiContent` for its text part;
- no sidecar: use clean `message.text`;
- V1: leave user text clean and let the runner's compatibility path supply the
  current promoted V1 system addition.

Do not mutate `SessionMessage` objects or lose file/media parts, metadata, or
agent attribution. Filter the runner's existing promoted snapshot
`request.system` rendering to V1; V2 must have exactly one owning user message
representation.

#### Step 4: Verify and commit exact lowering

From the worktree root:

```powershell
Set-Location packages/core
bun test test/session-runner-message.test.ts test/session-ctxpack-promotion.test.ts test/session-runner.test.ts test/session-context-replay.test.ts
bun test test/session-context-sidecar.test.ts test/session-ctxpack-admission.test.ts test/session-runner-system-context.test.ts test/session-runner-recorded.test.ts test/session-subagent-runner.test.ts
bun test
bun typecheck
Set-Location ../server
bun test test/integration/master-agent-api.test.ts
bun typecheck
Set-Location ../opencode
bun test test/session/compaction.test.ts test/session/prompt.test.ts test/effect/session-context-location-map.test.ts
bun typecheck
Set-Location ../..
rg -n "managedNotReadyNode" packages/server/src/routes.ts packages/opencode/src/effect/session-context.ts
git diff --check
git add packages/core/src/session/input.ts packages/core/src/session/runner/to-llm-message.ts packages/core/src/session/runner/llm.ts packages/core/test/session-runner-message.test.ts packages/core/test/session-ctxpack-promotion.test.ts packages/core/test/session-runner.test.ts packages/core/test/session-context-replay.test.ts
git commit -m "feat(core): replay exact session context"
```

Omit unchanged optional files. Keep both production readiness compositions
not-ready; this commit proves lowering but does not activate V2 admission.

### Task 3B: Compact enriched history privately

**Owner:** coordinator or the same serial worker

**Depends on:** Task 3A

Do not begin production edits until Task 3A is committed and green. Re-read its
actual sidecar-map/read-helper signatures first; Task 3B extends those exact
paths and must not create a parallel lookup.

**Files:**

- Create: `packages/core/src/session/compaction-context.ts`
- Generate: one migration under `packages/core/src/database/migration/` named
  by `bun run migration --name add-session-message-model-context`
- Create:
  `packages/core/test/database/session-message-context-migration.test.ts`
- Modify: `packages/core/src/session/sql.ts`
- Regenerate: `packages/core/src/database/migration.gen.ts`
- Regenerate: `packages/core/src/database/schema.gen.ts`
- Regenerate: `packages/core/schema.json`
- Modify: `packages/core/src/session/runner/to-llm-message.ts`
- Modify: `packages/core/src/session/runner/llm.ts`
- Modify: `packages/core/src/session/compaction.ts`
- Extend: `packages/core/test/session-runner-message.test.ts`
- Extend: `packages/core/test/session-context-replay.test.ts`
- Extend: `packages/core/test/session-runner.test.ts`
- Extend: `packages/core/test/session-compaction.test.ts`

#### Step 1: Write RED private-compaction tests

Prove:

- compaction serialization uses V2 `apiContent`, including recalled facts;
- one head/recent membership split is computed from enriched token sizes and
  reused for both private enriched and public clean rendering; a fixture where
  recall changes the split proves selection is not run twice;
- the compaction row's private `model_context_json` stores the enriched
  structured summary and recent tail with version/hash/size metadata;
- `Compaction.Ended.text` is exactly
  `[Private model context checkpoint v1]` and its public `recent` contains only
  clean transcript serialization;
- durable Session events, public messages, and browser-facing projections do
  not contain recalled fragments;
- the next runner request lowers the private sidecar inside the existing
  `<summary>`/`<recent-context>` checkpoint;
- pre-checkpoint user rows excluded by `entriesForRunner` are not falsely
  expected to replay as separate messages after compaction;
- a later compaction updates the prior private structured summary;
- enriched compaction deltas are never published;
- legacy compaction messages without the sentinel keep their current public
  lowering;
- active history containing no V2 user sidecar or prior private checkpoint keeps
  the legacy public compaction path and creates no private sentinel/sidecar;
- a sentinel with missing/corrupt private JSON fails before `llm.stream`;
- a non-sentinel compaction row with any private sidecar also fails before
  `llm.stream`; the sentinel exists if and only if a valid supported sidecar
  exists;
- a valid-shape private sidecar with changed summary/recent, content hash, UTF-8
  byte length, or token estimate fails before `llm.stream`;
- a later compaction with a sentinel whose private JSON is missing/corrupt
  fails before the auxiliary summarizer call;
- the same valid-shape tampering fails before the auxiliary summarizer call;
- a superseded corrupt private checkpoint outside the active window is not
  loaded or decoded;
- fault-injected sidecar persistence rolls back `Compaction.Ended`, its
  projected row, the sidecar, and notification together;
- an already-enriched Session still creates or updates its required private
  checkpoint while production readiness is not-ready; Task 3B does not
  activate first V2 admission;
- full input/message/sidecar rows remain readable; and
- existing summary headings and threshold behavior do not change.

Run:

```powershell
bun test test/session-compaction.test.ts
```

Also prove both fresh-schema initialization and additive upgrade of a temporary
pre-column database containing an existing legacy compaction row. Preserve that
row with a null sidecar, then close and reopen the database and decode a
persisted private sidecar. Extend Task 3A's file-backed replay test to reopen
after private compaction and prove the runner selects the checkpoint after
older inputs leave the active window.

#### Step 2: Add one private compaction sidecar column

Define a Core-private `SessionCompactionContextV1` Effect Schema with version,
renderer version, summary, recent, UTF-8 content hash, byte/token sizes, and
timestamp. Add nullable `session_message.model_context_json` through the
Drizzle table and one additive migration. It is not part of
`SessionMessage.Compaction`, Protocol, or any generated client.

Hash and measure canonical UTF-8 JSON of
`{ version, rendererVersion, summary, recent }` with SHA-256 and
`ceil(bytes / 4)`.

After changing `session/sql.ts`, generate the additive migration and all
repository-owned database artifacts from `packages/core`:

```powershell
bun run migration --name add-session-message-model-context
bun run migration --check
```

On Windows, checked-out generated files may be CRLF while the generator
compares LF bytes. Do not treat a pre-generation `migration --check` failure as
semantic drift. Run the generator first as above; its subsequent check is the
meaningful gate.

Do not hand-edit `migration.gen.ts`, `schema.gen.ts`, or `schema.json`. Inspect
the generated migration and require that it only adds the nullable
`model_context_json` column. The generated registry is what makes the migration
run for an existing database; the schema snapshot and generated full schema
cover fresh databases.

Provide one strict decoder and reads keyed by compaction message ID. After
schema decoding, canonicalize `{ version, rendererVersion, summary, recent }`,
recompute SHA-256, UTF-8 byte length, and `ceil(bytes / 4)`, and require every
stored derived field to match. The runner and later compaction must call this
decoder rather than schema-decode independently. A
sidecar-bearing sentinel without valid and internally consistent content is a
typed corruption error; do not fall back to the clean public checkpoint.

#### Step 3: Feed enriched user content to the existing compactor

Extend compaction serialization with the already decoded sidecar map or an
equivalent pre-rendered user-content lookup. Use enriched user text for the
private summarizer head and private recent tail only when selected active history
contains a V2 user sidecar or a prior private checkpoint. Otherwise preserve the
legacy public compaction event/message exactly and write no private state. For an
enriched checkpoint, use clean serialization for the public `recent`, persist
the fixed sentinel as public `text`, and write the private sidecar from the
existing `Compaction.Ended` EventV2 commit hook after its message projector in
the same database transaction.

Refactor selection just enough to retain entry/group identity. Compute one
head/recent boundary from enriched serialization, then render private and clean
forms from the same exact entry sets. Never invoke selection separately for the
two representations.

Keep `session/projector.ts` unaware of private payloads. The commit-hook helper
in `compaction-context.ts` updates exactly one null `session_message` row bound
to the Session, compaction message, durable sequence, type, and sentinel; it
fails on zero, multiple, or mismatched targets so EventV2 rolls the whole
transaction back.

Pass the runner's existing database handle explicitly into
`SessionCompaction.make`; do not resolve a new service ambiently or introduce a
compaction repository abstraction for one column.

Keep one auxiliary compaction model call. On repeat compaction, seed it from the
previous private summary/recent when present, otherwise from legacy public
fields only when the checkpoint is genuinely legacy. A private sentinel with a
missing or corrupt sidecar fails before the summarizer call; it never falls back
to the clean public checkpoint. Do not emit enriched `Compaction.Delta` data, change
`SessionHistory.entriesForRunner`, resurrect rows before the checkpoint, or add
an OperatingChat-only compactor/new threshold.

Local readiness controls creation of the first enriched input, not maintenance
of already-enriched history. Repeat/private compaction must remain available
after a feature-off rollback. A rollback that can encounter a sentinel
must retain private lowering and private-aware repeat compaction, or explicitly
disable compaction for that Session; retaining only the column and decoder is
not enough.

#### Step 4: Lower private checkpoints for the runner

Load private compaction sidecars by active compaction message ID beside the user
sidecar map. `toLLMMessages` uses the private values for the sentinel-bearing
message and public values for legacy messages. Public `sessions.messages` and
`sessions.events` remain unchanged and clean. Enforce both directions of the
sentinel/sidecar invariant and decode in active history order. Never query or
validate superseded compaction rows outside the selected window.

#### Step 5: Verify and commit private compaction

From the worktree root:

```powershell
Set-Location packages/core
bun test test/session-runner-message.test.ts test/session-context-replay.test.ts test/session-runner.test.ts test/session-compaction.test.ts
bun test test/session-context-sidecar.test.ts test/session-ctxpack-promotion.test.ts test/session-ctxpack-admission.test.ts
bun test test/database/session-message-context-migration.test.ts test/database-migration.test.ts
bun run migration --check
bun test
bun typecheck
Set-Location ../server
bun test test/integration/master-agent-api.test.ts
bun typecheck
Set-Location ../opencode
bun test test/session/compaction.test.ts test/session/prompt.test.ts test/effect/session-context-location-map.test.ts
bun typecheck
Set-Location ../..
rg -n "managedNotReadyNode" packages/server/src/routes.ts packages/opencode/src/effect/session-context.ts
git diff --check
git status --short packages/core/src/database/migration
git add packages/core/src/session/compaction-context.ts packages/core/src/database/migration/<generated-migration-file>.ts packages/core/src/database/migration.gen.ts packages/core/src/database/schema.gen.ts packages/core/schema.json packages/core/src/session/sql.ts packages/core/src/session/runner/to-llm-message.ts packages/core/src/session/runner/llm.ts packages/core/src/session/compaction.ts packages/core/test/database/session-message-context-migration.test.ts packages/core/test/session-runner-message.test.ts packages/core/test/session-context-replay.test.ts packages/core/test/session-runner.test.ts packages/core/test/session-compaction.test.ts
git commit -m "feat(core): compact private session context"
```

Production readiness remains disabled. This commit can read/test V2 fixtures but
cannot create the first production V2 marker.

### Task 2G: Add one runtime-safe SessionV2 compatibility boundary

**Depends on:** Tasks 2D, 2E, 2F, 3A, and 3B. Execute this activation only
after exact sidecar lowering and private compaction are green.

This is one serial, cross-package activation task. It deliberately does **not**
add a second App transcript store, an App-local V2 controller, a second event
shape, or a broad raw `/api` router. The browser keeps using the generated
legacy-compatible `/session/:sessionID/*` surface and the existing
`ServerSession` stores. The OpenCode boundary dispatches that surface to the
legacy runtime or SessionV2 according to one durable Session discriminator.

The migration, service/projector runtime guards, compatibility handlers, event adapter, generated
SDK, and minimal App awareness must land in one commit. Do not land a dormant
runtime column or guard before the compatibility handlers:
pre-existing strong-V2 rows would immediately reject legacy handlers. Do not
land the compatibility handlers without the guards: another legacy write could
contaminate a V2 Session before enforcement becomes active.

The same atomic cutover also changes the readiness and process-role boundary.
Authenticated combined OpenCode and authenticated standalone Server compose
`v2-enriched`; an open listener has no authenticated actor, clean-admits only a
zero-attachment prompt with no recall, and rejects nonempty context before
admission. A managed child auth-first denies the entire `/api` prefix with no
body read. The same Core authority rejects every direct SessionV2, WorkspaceV2,
FunctionalityInstance/binding, CtxPack/capsule, capability-authorized, Todo,
interaction, or execution mutation before effects; compatible V2 mutations
cannot bypass it. Legacy services/routing and `/global/health` stay unchanged.
An explicit Session workspace remains metadata and never forces local
execution of a true Remote plan.

Phase-1 supported runtime-v2 compatibility operations are exactly:

- `prompt_async`, with message ID, `delivery`, optional `resume`, and
  `contextAttachments`;
- paged `message` history and single-message lookup, including clean pending
  `session_input` rows;
- `abort` mapped to SessionV2 interruption;
- Session-scoped status plus the existing `session.status` busy/idle stream;
- Session-scoped runtime-neutral Todo read through the existing shared service;
- the generated, runtime-v2-only bounded descendant-recovery read
  `/session/:sessionID/children/page`;
- Session-scoped permission list/reply and question list/reply/reject; and
- list/get Session metadata, including the runtime discriminator.

Session update/delete, command, shell, init, manual compact/summarize, fork,
revert/unrevert, share/unshare, message/part update/delete, and any other
unproved mutation fail closed for `runtime=v2` and `runtime=mixed`. Hide those
controls in the shared Session UI when runtime is not `legacy`. Internal
automatic compaction and current
SessionV2 execution remain supported; the compatibility event adapter renders
their committed results.

For a V2/mixed Session, a Local plan executes only in the combined process and
a Remote plan returns a fixed content-free unavailable/quarantine error before
body, handler, proxy, or target HTTP. Missing-runtime/legacy preserves its exact
existing routing path. Standalone Server has no workspace proxy and follows the
same authenticated/open readiness rule. Legacy Sessions retain byte-compatible
behavior.
Every fresh built-in binding whose live Core port already calls
`SessionV2.create`—OperatingChat, MasterAgent, and ChatRelay—therefore stamps V2
and uses this compatibility boundary in the App. Existing bindings classified
legacy remain legacy. Each service is runtime-first on an existing binding: V2
keeps its current configure/return behavior, legacy returns unchanged/readable,
mixed returns metadata only, and reset conversion is unsupported. This
preserves MasterAgent's current `parallel-master`
and binding-aware parallel-task authority rather than routing a fresh V2 binding
through legacy coder-task policy. Automatic CtxPack recall remains
OperatingChat-profile-only.

**Files:**

- Create: `packages/schema/src/session-runtime.ts`
- Create: `packages/schema/src/session-compatibility.ts`
- Modify: `packages/schema/src/index.ts`
- Modify: `packages/schema/src/session.ts`
- Modify: `packages/schema/src/v1/session.ts`
- Modify: `packages/schema/src/event-manifest.ts`
- Test: `packages/schema/test/session-runtime.test.ts`
- Test: `packages/schema/test/session-compatibility.test.ts`
- Test: `packages/schema/test/event-manifest.test.ts`
- Create: `packages/core/src/database/migration/<generated>_session-runtime.ts`
- Modify (generator-owned): `packages/core/src/database/migration.gen.ts`
- Modify (generator-owned): `packages/core/src/database/schema.gen.ts`
- Modify (generator-owned): `packages/core/schema.json`; never hand-edit it
- Create: `packages/core/src/session/runtime.ts`
- Create: `packages/core/src/session/process-role.ts` for the injected
  combined/standalone/managed-child current mutation authority shared by
  Session, Workspace, binding, CtxPack/capsule/capability, and Todo services
- Modify: `packages/core/src/session/context-transfer-readiness.ts`
- Modify: `packages/core/src/session/sql.ts`
- Modify: `packages/core/src/session/info.ts`
- Modify: `packages/core/src/session/create.ts`
- Modify: `packages/core/src/session/projector.ts`
- Modify: `packages/core/src/session/store.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/session/input.ts`
- Modify: `packages/core/src/session/context-epoch.ts`
- Modify: `packages/core/src/session/compaction-context.ts`
- Modify: `packages/core/src/session/revert.ts`
- Modify: `packages/core/src/session/compaction.ts`
- Modify: `packages/core/src/session/runner/llm.ts` for the concrete
  `SessionRunner.run` guard
- Modify: `packages/core/src/session/runner/index.ts` only if the exported
  runtime-conflict error surface changes
- Modify: `packages/core/src/session/subagent-runner.ts`
- Modify: `packages/core/src/session/execution/local.ts`
- Modify: `packages/core/src/session/run-coordinator.ts`
- Modify: `packages/core/src/permission.ts`
- Modify: `packages/core/src/question.ts`
- Modify: `packages/core/src/session/todo.ts`
- Modify: `packages/core/src/control-plane/move-session.ts`
- Modify: `packages/core/src/tool/task-batch.ts`
- Modify: `packages/core/src/workspace/service.ts`
- Modify: `packages/core/src/workspace/functionality-instance.ts`
- Modify: `packages/core/src/workspace/operating-chat-session.ts`
- Modify: `packages/core/src/workspace/master-agent.ts`
- Modify: `packages/core/src/workspace/chat-relay-session.ts`
- Modify: `packages/core/src/ctxpack/service.ts`
- Modify: `packages/core/src/ctxpack/sql.ts`
- Modify: `packages/core/src/ctxpack/materialize.ts`
- Modify: `packages/core/src/ctxpack/usage.ts`
- Modify: `packages/core/src/context-broker/capsule.ts`
- Modify: `packages/core/src/capability/service.ts`
- Test: `packages/core/test/database/session-runtime-migration.test.ts`
- Test: `packages/core/test/session-runtime.test.ts`
- Create: `packages/core/test/session-process-role.test.ts`
- Test: `packages/core/test/session-projector.test.ts`
- Test: `packages/core/test/session-runner.test.ts`
- Test: `packages/core/test/session-subagent-runner.test.ts`
- Test: `packages/core/test/session-compaction.test.ts`
- Test: `packages/core/test/session-run-coordinator.test.ts`
- Test: `packages/core/test/session-execution-local.test.ts`
- Test: `packages/core/test/move-session.test.ts`
- Test: `packages/core/test/tool-task-batch.test.ts`
- Test: `packages/core/test/session-todo.test.ts`
- Create: `packages/core/test/workspace/service.test.ts`
- Test: `packages/core/test/workspace/functionality-instance.test.ts`
- Test: `packages/core/test/operating-chat-session.test.ts`
- Test: `packages/core/test/integration/master-agent-session.test.ts`
- Create: `packages/core/test/workspace/chat-relay-session.test.ts`
- Test: `packages/core/test/ctxpack-service.test.ts`
- Test: `packages/core/test/ctxpack-sql.test.ts`
- Test: `packages/core/test/ctxpack-materialize.test.ts`
- Test: `packages/core/test/ctxpack-usage.test.ts`
- Test: `packages/core/test/context-broker-capsule.test.ts`
- Test: `packages/core/test/capability-service.test.ts`
- Modify fixture: `packages/core/test/ctxpack-acceptance.test.ts`
- Modify fixture: `packages/core/test/database-migration.test.ts`
- Modify fixture: `packages/core/test/operating-chat-context.test.ts`
- Extend: `packages/core/test/permission.test.ts`
- Extend: `packages/core/test/question.test.ts`
- Modify fixture: `packages/core/test/session-create.test.ts`
- Modify fixture: `packages/core/test/session-history.test.ts`
- Modify fixture: `packages/core/test/session-prompt.test.ts`
- Modify fixture: `packages/core/test/session-tool-progress.test.ts`
- Modify fixture: `packages/core/test/session-ctxpack-admission.test.ts`
- Modify fixture: `packages/core/test/session-ctxpack-promotion.test.ts`
- Modify fixture: `packages/core/test/session-context-replay.test.ts`
- Modify fixture: `packages/core/test/session-runner-recorded.test.ts`
- Modify fixture: `packages/core/test/session-runner-system-context.test.ts`
- Modify fixture: `packages/core/test/tool-task.test.ts`
- Modify fixture: `packages/core/test/tool-todowrite.test.ts`
- Modify fixture: `packages/core/test/workspace/master-agent.test.ts`
- Create: `packages/server/src/session-private-http.ts` for the shared exact
  prompt-body cap and parameterized single-read replacement helper
- Modify: `packages/server/src/auth.ts`
- Modify: `packages/server/src/routes.ts`
- Modify: `packages/server/src/handlers/session.ts`
- Modify: `packages/server/src/handlers/operating-chat.ts` for fixed
  runtime/role/conversion conflict translation
- Modify: `packages/server/src/handlers/workspace-master-agent.ts` for the same
  content-free translation
- Modify: `packages/server/src/handlers/chat-relay-session.ts` for the same
  content-free translation
- Modify: `packages/server/src/middleware/authorization.ts`
- Modify: `packages/server/src/middleware/schema-error.ts`
- Create: `packages/server/test/session-private-http.test.ts`
- Test: `packages/server/test/middleware/authorization.test.ts`
- Create: `packages/server/test/middleware/schema-error.test.ts`
- Create: `packages/server/test/session-local-readiness.test.ts`
- Test: `packages/server/test/operating-chat-handler.test.ts`
- Test: `packages/server/test/handlers/workspace-master-agent.test.ts`
- Create: `packages/server/test/handlers/chat-relay-session.test.ts`
- Create: `packages/opencode/src/session/session-v2-compat.ts`
- Modify: `packages/opencode/src/session/session.ts`
- Modify: `packages/opencode/src/session/prompt.ts`
- Modify: `packages/opencode/src/session/revert.ts`
- Modify: `packages/opencode/src/session/compaction.ts`
- Modify: `packages/opencode/src/session/summary.ts`
- Modify: `packages/opencode/src/session/todo.ts`
- Modify: `packages/opencode/src/share/session.ts`
- Modify: `packages/opencode/src/share/share-next.ts`
- Modify: `packages/opencode/src/permission/index.ts`
- Modify: `packages/opencode/src/question/index.ts`
- Modify: `packages/opencode/src/control-plane/workspace.ts` for the Task 2G
  unconditional first-operation warp/remove rejections plus guarded history-
  catch-up and live sync apply/forwarding
- Modify: `packages/opencode/src/effect/session-context.ts`
- Modify: `packages/opencode/src/cli/cmd/import.ts`
- Modify: `packages/opencode/src/event-v2-bridge.ts` for exact durable-wire and
  full ordinary-live Session classifiers plus guarded ordinary/sync forwarding
- Modify: `packages/opencode/src/server/shared/workspace-routing.ts` for the
  single-decode Session path matcher and endpoint-specific current selector
  matrix
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/sync.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/sync.ts`
  for source-history and target-replay quarantine
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/workspace.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/workspace.ts`
  for the fixed content-free removal-conflict translation
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/control-plane.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/control-plane.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/errors.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/middleware/schema-error.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/middleware/error.ts`
  for exact compatible/current private-prompt defect redaction
- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts` for
  the current selector/create-adopt pre-handler matrix
- Test: `packages/opencode/test/session/session-v2-compat.test.ts`
- Test: `packages/opencode/test/session/session.test.ts`
- Test: `packages/opencode/test/session/session-schema.test.ts`
- Test: `packages/opencode/test/session/schema-decoding.test.ts`
- Test: `packages/opencode/test/session/prompt.test.ts`
- Test: `packages/opencode/test/session/revert-compact.test.ts`
- Test: `packages/opencode/test/session/compaction.test.ts`
- Test: `packages/opencode/test/share/share-next.test.ts`
- Test: `packages/opencode/test/permission/next.test.ts`
- Test: `packages/opencode/test/question/question.test.ts`
- Test: `packages/opencode/test/control-plane/workspace.test.ts`
- Test: `packages/opencode/test/project/project.test.ts`
- Test: `packages/opencode/test/project/migrate-global.test.ts`
- Create: `packages/opencode/test/session/todo.test.ts`
- Test: `packages/opencode/test/cli/import.test.ts`
- Create: `packages/opencode/test/event-v2-bridge.test.ts`
- Test: `packages/opencode/test/server/httpapi-session.test.ts`
- Test: `packages/opencode/test/server/httpapi-sync.test.ts`
- Test: `packages/opencode/test/server/httpapi-workspace.test.ts`
- Test: `packages/opencode/test/server/httpapi-control-plane.test.ts`
- Test: `packages/opencode/test/server/httpapi-workspace-routing.test.ts`
- Test: `packages/opencode/test/server/workspace-routing.test.ts`
- Test: `packages/opencode/test/server/httpapi-authorization.test.ts`
- Test: `packages/opencode/test/effect/session-context-location-map.test.ts`
- Create: `packages/opencode/test/server/httpapi-v2-local-only.test.ts`
- Test: `packages/opencode/test/server/httpapi-error-middleware.test.ts`
- Modify: `packages/app/src/utils/server-compat.ts`
- Modify: `packages/app/src/utils/session.ts`
- Modify: `packages/app/src/components/prompt-input/build-request-parts.ts`
- Modify: `packages/app/src/components/prompt-input/submit.ts`
- Modify: `packages/app/src/components/prompt-input/contracts.ts`
- Modify: `packages/app/src/components/prompt-input.tsx`
- Modify: `packages/app/src/components/prompt-input-v2.tsx`
- Modify: `packages/app/src/context/global-sync/bootstrap.ts`
- Modify: `packages/app/src/context/global-sync/session-load.ts`
- Modify: `packages/app/src/context/global-sync/home-session-index.ts`
- Modify: `packages/app/src/context/server-sync.tsx`
- Modify: `packages/app/src/context/permission.tsx`
- Modify: `packages/app/src/context/server-session.ts`
- Modify: `packages/app/src/pages/session-surface-base.tsx`
- Modify: `packages/app/src/pages/session/composer/session-composer-controls.ts`
- Modify: `packages/app/src/pages/session/use-composer-commands.tsx`
- Modify: `packages/app/src/pages/session/use-session-commands.tsx`
- Modify: `packages/app/src/pages/session/timeline/message-timeline.tsx`
- Modify: `packages/app/src/pages/canvas/workspace.tsx` only for
  runtime-driven control visibility/reset-required presentation; it keeps the
  existing CompatibleApi transport
- Test: `packages/app/src/utils/server-compat.test.ts`
- Test: `packages/app/src/utils/session.test.ts`
- Test: `packages/app/src/components/prompt-input/build-request-parts.test.ts`
- Test: `packages/app/src/components/prompt-input/submit.test.ts`
- Test: `packages/app/src/components/prompt-input-v2.test.tsx`
- Test: `packages/app/src/context/global-sync/bootstrap.test.ts`
- Create: `packages/app/src/context/global-sync/session-load.test.ts`
- Test: `packages/app/src/context/global-sync/home-session-index.test.ts`
- Test: `packages/app/src/context/server-sync.test.ts`
- Test: `packages/app/src/context/permission.test.tsx`
- Test: `packages/app/src/context/server-session.test.ts`
- Test: `packages/app/src/pages/session-surface-base.browser.test.tsx`
- Create: `packages/app/src/pages/session/composer/session-composer-controls.test.ts`
- Create: `packages/app/src/pages/session/use-session-commands.test.tsx`
- Create: `packages/app/src/pages/session/timeline/message-timeline.test.tsx`
- Extend: `packages/app/src/pages/canvas/runtime/registrations/operating-chat.test.ts`
- Test: `packages/app/src/pages/canvas/operating-chat.browser.test.tsx`
- Test: `packages/app/src/pages/canvas/master-agent/block.browser.test.tsx`
- Test: `packages/app/src/pages/canvas/blocks/chat-relay/view.browser.test.tsx`
- Regenerate: `packages/client/src/generated/**`
- Regenerate: `packages/client/src/generated-effect/**`
- Regenerate: `packages/sdk/js/src/gen/**`
- Regenerate: `packages/sdk/js/src/v2/gen/**`

#### Step 1: Freeze the runtime and compatibility schemas

Create minimal typed module skeletons first so the new imports compile. Then
write behavioral RED tests; do not treat a missing-module compiler error as the
behavioral RED.

`SessionRuntime` is exactly:

~~~ts
export const SessionRuntime = Schema.Literals(["legacy", "v2", "mixed"])
~~~

Add optional `runtime` to current `Session.Info`, public OpenCode `Session.Info`,
and every historical/V1 Session information shape, including Created, Updated,
and Deleted. Freeze one wire-compatibility rule: `undefined => "legacy"`.
Core/OpenCode `fromRow` always emits the concrete non-null database value, and
all server runtime guards read the database rather than infer authority from a
wire object. This keeps old events/servers/fixtures decodable without a separate
historical-info schema or mass fixture rewrite. Add old current and
Created/Updated/Deleted fixtures with no runtime plus concrete new list/get
fixtures.

Add one Schema-owned deterministic compatibility ID function used by both the
OpenCode projector and App optimistic builder:

~~~ts
legacyPartID({
  messageID,
  ordinal,
  family: "text" | "file" | "agent" | "reasoning" | "tool" | "step-start" | "step-finish",
  key,
}): Promise<SessionV1.PartID>
~~~

The function is total for every valid durable message/semantic string; it must
never make an already-committed Session unreadable because an ID is long. Build
one unambiguous length-prefixed byte string from a versioned domain,
`messageID`, non-negative safe-integer global source ordinal, family, and key,
then compute the full SHA-256 with the standard cross-runtime Web Crypto API.
The App already submits asynchronously, so `buildRequestParts` awaits this
Schema helper before installing optimism; OpenCode awaits the same helper while
projecting. Do not add a hashing dependency, truncate the digest, use a 32-bit
hash, or impose a new source-ID length bound.

The ID format is
`prt_<ordinal-key>_<family-code>_<full-base64url-digest>`. Encode
`ordinal-key` as two ASCII digits for the decimal digit count followed by the
decimal ordinal (`01`+`0` through the maximum real JavaScript array index), so
lexical sort equals numeric source order without a 999,999 ceiling. Validate
only the actual array-index/safe-integer invariant. The digest binds the entire
tuple; the readable prefix is not a reversible source-ID encoding. Maintain a
bounded, rebuildable compatibility index from tuple to PartID and PartID to
tuple per authoritative projected message. Also index
`(messageID, family, semanticID)` to the latest source ordinal and PartID:
valid current text/reasoning semantic IDs may repeat, and Core mutation uses
`findLast`. Rebuild both indices atomically in source order on each authoritative
full upsert or corresponding Started notification. A live delta updates only
the latest indexed occurrence; on a miss it refetches/projects the source
message and otherwise waits for the next durable full upsert. The indices are
caches, never transcript authority.
Schema text/reasoning/tool IDs remain the semantic `key`; file/agent/prompt-only
values use deterministic position keys.

Add the already-existing `SessionStatusEvent.Definitions` to
`EventManifest.ServerDefinitions` so strict `/api/event` encoding accepts the
status events SessionExecution will publish. This is an inventory change, not a
new status family.

RED assertions:

- every new row-backed current/OpenCode Session serializes one concrete runtime;
- old current and Created/Updated/Deleted payloads without runtime decode as
  wire-compatible legacy, while no service guard trusts that omission;
- deterministic part IDs are equal in independently encoded server/App
  fixtures, differ for every tuple component, satisfy `PartID`, accept very long
  valid durable message/semantic IDs without truncation or rejection, and keep
  a mixed text/file/agent/tool sequence of at least 12 parts in exact source
  order after lexical ID sort. Two long inputs with equal readable prefixes
  remain distinct, and the rebuilt tuple index resolves both directions;
- `session.status` occurs once in both the appropriate server and public
  inventories; and
- generated public shapes will expose optional runtime without changing private sidecar
  fields.

#### Step 2: Migrate, classify, and enforce one Session runtime

Generate one migration through the repository migration script. The migration
adds `session.runtime TEXT NOT NULL DEFAULT 'legacy'` and classifies old rows in
one transaction. SQLite cannot safely add a populated NOT NULL/no-default parent
column without a foreign-key-sensitive table rebuild. The conservative default
makes an omitted raw insert legacy; every V2 creator must stamp `v2` explicitly,
and `SessionRuntime.require(..., "v2")` then makes a forgotten stamp fail closed
before V2 effects.
Classification uses projected child tables only. A `message` or `part` row is
legacy evidence. A `session_input`, `session_message`, or
`session_context_epoch` row is V2 evidence. Both produce `mixed`, only V2
evidence produces `v2`, and every legacy-only, empty, or ambiguous row produces
`legacy`. Do not classify from event names: projected admissions remain in
`session_input`, projected V2 history remains in `session_message`, initialized
V2 context remains in `session_context_epoch`, while an event allowlist would
be a second brittle authority. In particular event-only model/agent switch,
move, revert, and empty Created histories remain legacy. Add those explicit
regression fixtures.

Do not add SQLite triggers or a post-migration invariant installer. They cannot
stop pre-write plugin/filesystem/provider effects and would add fresh/upgrade
DDL and rollback hazards. Mechanically inventory every production child-table
writer with `rg`: Core `session/projector.ts`, `session/input.ts`,
`context-epoch.ts`, and `compaction-context.ts`, plus OpenCode
`cli/cmd/import.ts`. Guard those writers and each externally callable high-level
production mutation owner enumerated below before its first effect. The import
command preflights runtime and stamps/retains
legacy before its existing Session on-conflict location update. A new direct
writer must join this audited list and tests before merge.

Inventory every direct `SessionTable` insert/update separately. Inserts stamp a
runtime; updates preserve the stored value and never accept runtime from caller
data. Core `tool/task-batch.ts` is a real direct writer: its worker-archive
transaction must require every selected child to be V2 before updating
`time_archived`. OpenCode `project/project.ts` performs runtime-neutral bulk
placement/project maintenance and must prove legacy, V2, and mixed rows retain
their discriminator unchanged. Todo reads are runtime-neutral auxiliary state,
but their writers are direct mutation owners: Core `SessionTodo.update` requires
the current process role and runtime V2, while OpenCode `Todo.update` requires
runtime legacy. No public V2 Todo mutation is added. Direct tests prove matching
legacy/V2 behavior and zero Todo row/event changes for wrong-runtime, mixed, and
managed-child V2 calls.

Add one central `SessionRuntime.require(sessionID, expected, dbOrTx)` and call it
at the earliest boundary of each enumerated production mutation plus every
projector/direct writer inside its transaction. Service and projector checks
return typed, content-free runtime conflicts. New legacy creation
stamps `legacy`. `SessionCreate` stamps `v2`. SessionV2 create/adopt and every
V2 mutation reject legacy/mixed; legacy mutation paths reject v2/mixed.
List/get remain available for all three. Historical AgentSwitched,
ModelSwitched, and Moved projector callbacks are the narrow shared-metadata
exception: replay may update only their existing metadata on a legacy, V2, or
mixed row, must preserve runtime, and may never create/relabel a Session. This is
required because migration deliberately classifies event-only switch/move rows
as legacy. New high-level V2 switch entrypoints still require V2, and Move is
unconditionally unsupported. Updated/Moved cannot smuggle a replacement runtime.
Deleted first loads the stored row: a present event runtime must match, while an
omitted historical runtime may delete only a legacy row. It cannot erase a V2/
mixed row by applying the wire default. Internal losing-candidate/rollback
cleanup uses its already-known expected runtime; user-facing V2/mixed deletion
remains unsupported before effects.

Every V2 create/adopt immediately re-reads and requires `v2` before returning or
starting any V2 effect. A forgotten/wrong stamp can leave only an empty legacy
orphan, which existing losing-candidate cleanup may remove; it cannot create
input/message/epoch/event/execution state.

Put the guard at each externally callable high-level production boundary, not
only in HttpApi handlers.
Legacy prompt must reject before model/session updates, file/resource reads,
plugin calls, Message/Part writes, or provider work. Legacy update/delete,
fork/init/share/unshare, summarize/compact, command/shell, revert/unrevert, and
direct message/part mutations check before their first effect. SessionV2
prompt/input, runner/resume, interrupt, revert, compaction, Context Epoch,
model/agent switches, and the audited current writers likewise require V2 before
their first event/database/filesystem/provider effect. HTTP branches and UI
hiding are defense in depth. Add direct tests for the named public/high-level
services with instrumented effects, including mixed, so their supported
alternate call paths cannot bypass the runtime boundary.
The concrete runner check belongs at `session/runner/llm.ts` `Service.run`, not
only `execution/local.ts`, because callers may invoke the service directly.
`SessionCreate.make({ parentID })` also requires the parent to be V2 before
creating a child; `SubagentRunner.run` checks that same parent before model/tool/
child work. Tests prove a legacy/mixed direct runner or subagent parent produces
no child, model resolution, tool materialization, filesystem, provider, event,
or execution effect.
`SessionProcessor`, `SessionRunState`, and `SessionStatus` are internal
post-guard mechanisms in this phase, not additional public runtime mutation
authorities. Audit every production callsite and prove each is dominated by one
of the guarded high-level owners above; do not add speculative guards or claim
that every exported internal helper is independently safe. A future callsite
that invokes one outside those owners must first add a guard and a zero-effect
test to this inventory.
Core `PermissionV2` and `QuestionV2` are explicit externally callable current
owners, not post-guard internals. Require runtime `v2` inside permission
ask/assert/reply and question ask/reply/reject before pending-map, persisted
grant, or event effects. OpenCode legacy `permission/index.ts` and
`question/index.ts` require runtime `legacy` at their equivalent ask/reply/
reject boundaries. Compatibility endpoints dispatch by runtime only after
these service fences. Focused legacy/V2/mixed tests prove wrong-runtime calls
leave maps, approvals/grants, and events unchanged while the matching runtime
retains current behavior.
OpenCode's `share/share-next.ts` direct and background paths are a named legacy
boundary too: require runtime `legacy` before any external HTTP, cache, listener
flush, or SessionShare-row effect. Migration may leave retained share rows on a
V2/mixed Session, but no listener may flush them. Direct and background tests
for V2/mixed assert zero HTTP/cache/share-row mutation.
Install the shared Core `SessionWarpContextAssemblyUnsupported` in Task 2G and
return it unconditionally as the first operation from
`MoveSession.moveSession`, OpenCode `Workspace.sessionWarp`, and `/sync/steal`
for every runtime/Session shape. Tests prove zero database, sync/cancel,
filesystem, Git, event, replay, patch, or claim work. This is the permanent
phase-1 rule; no legacy or V2 warp is temporarily allowed.

Add one injected Core process-role authority beside `SessionRuntime`. The
combined and standalone roles allow locally owned current work; the managed-
child role returns one typed retryable/unavailable error at the earliest
boundary of every SessionV2 create/adopt/prompt/switch/revert/interrupt/
execution, built-in binding, PermissionV2, QuestionV2, Todo, WorkspaceV2,
FunctionalityInstance, CtxPack, ContextCapsule, and capability-authorized
mutation. Guard the actual direct owners, not only HTTP: WorkspaceV2 create,
rename, remove, duplicate, update, legacy-adoption writes reached by list/get,
layout default/authority creation reached by layout get, and layout save;
FunctionalityInstance get-or-create, upsert, configuration CAS, and tombstone;
CtxPack service plus
SQL-repository create/patch/delete/restore/record-use; materializer capsule
creation and usage accounting; ContextCapsule store; capability `require` for
write/execute operations; and Core Todo update. Read-only list/get/search/check
remain available where their existing quarantine policy permits them.
Projector/direct-writer guards remain the last fence. Direct service tests set
the managed-child role and assert zero Session/input/message/epoch/event/
provider/filesystem/pending-map/grant, Workspace/Functionality/Capsule/CtxPack/
Todo row, and FTS effects. OpenCode chooses that injected role once in its
composition root from the existing managed-child flag; standalone Server always
injects standalone, and combined OpenCode injects combined. Core services
consume only the injected authority and never read process environment directly.

At the authenticated HTTP boundary, a managed child default-denies every method
and path beneath `/api` before request-body consumption. It has no current Api
allowlist: legacy services are outside `/api`, and child health remains the
existing `/global/health`. Keep the monolithic current Api mounted behind that
single prefix guard rather than forking Protocol. A test derives/enumerates the
mounted current endpoint manifest and proves every route is denied, so a future
endpoint cannot silently become worker-reachable. Legacy HttpApi groups and
compatible routing remain unchanged, and the direct Core fences make an
internal call fail identically.

Make sync quarantine symmetric and impossible to bypass. Export two exact
classifiers from the existing `event-v2-bridge.ts` boundary. Durable wire data
reuses EventManifest's source-aligned
`SessionV1.Event.Definitions.filter((definition) => definition.durable !==
undefined)` plus `SessionEvent.DurableDefinitions`. Ordinary live data uses all
`SessionV1.Event.Definitions` plus full `SessionEvent.Definitions`, which also
classifies legacy PartDelta/Diff/Error and current Text/Reasoning/Tool.Input/
Compaction deltas. Do not infer Session family from
`type.startsWith("session")` or aggregate-ID text. Every other exact manifest
family retains its existing path.

On the source, Schema-decode each `/sync/history` row and ordinary live record
through its applicable exact versioned definition before history output or
ordinary/sync GlobalBus forwarding. Durable history containing a Schema-valid
but non-durable V1 message.part.delta, session.diff, or session.error is forged
and quarantines before output. For session.created/updated/deleted, use the
embedded historical `info.runtime ?? "legacy"` and require it to equal the
SessionTable row when present. Every other Session record requires the row and
uses its runtime. Ordinary-live V1 `session.error` is the sole exception: absent
sessionID is a Schema-valid sessionless/runtime-neutral plugin/skill failure and
forwards byte-exact; present sessionID requires a matching legacy row. No other
unknown/sessionless event bypasses the row check. Raw V2/mixed always
quarantines; locally owned V2 may emit only legacy compatibility siblings. For a
legacy row, ordinary live may forward all V1 definitions, while durable wire
allows only filtered durable V1 and exactly current AgentSwitched, ModelSwitched,
and Moved. Reject every other current definition even when the row is legacy.
Allowed records preserve bytes/order; disallowed, unknown, and mismatch stop
before forwarding.

Before `/sync/replay` calls `replayAll`, preflight the complete input array in
order with an in-memory shadow of persisted Session runtime/existence and exact
event-ID records. Identical ID, aggregate, sequence, versioned type, and encoded
data is a no-op; divergent reuse rejects. A decoded missing/legacy
`session.created.1` may seed a legacy shadow row, durable V1 updates preserve
it, Deleted removes it, and only AgentSwitched/ModelSwitched/Moved from the
current family preserve it. Each accepted new event enters the event-ID shadow
before the next array element. Any V1 non-durable PartDelta/Diff/Error, other
current event, V2/mixed row, runtime mismatch, unknown non-Created, or Updated/
Deleted without the required legacy shadow rejects the whole array before the
first replay/projector/child-table/ordinary-or-sync GlobalBus/SessionExecution
effect. A Created followed by an invalid current tail therefore writes nothing.
Apply the same complete shadow preflight to every history-catch-up page before
its first `replayAll`; live apply uses the same policy one record at a time. The
exact duplicate rule keeps Deleted idempotent after row removal. Direct handler,
catch-up, and live tests prove no alternate entry bypasses the policy;
pre-existing managed-child V2/mixed rows cannot run.

Do not inspect authority and then race a removal. Core `WorkspaceV2.remove` and
control-plane `Workspace.remove` return their existing fixed content-free
conflict unconditionally as the first operation for every workspace/runtime
shape. They perform no lookup/prewalk, Session deletion, sync stop, adapter/
worktree call, workspace/cascade mutation, binding cleanup, or event. Direct
legacy `Session.remove` is distinct: it first builds the full descendant closure
and validates every stored runtime; a V2/mixed grandchild rejects the root before
background cancellation or the first Deleted event/row, while an all-legacy
tree retains its existing cleanup.

The migration generator also owns `packages/core/schema.json`; generate and
stage it with `migration.gen.ts`/`schema.gen.ts`, never by hand. After the column
lands, sweep every raw `insert(SessionTable)` fixture. Fixtures that exercise a
V2 service must set `runtime: "v2"`; legacy fixtures may rely on the database
default only when that default is the behavior under test. Run the complete Core
suite so no old V2 fixture accidentally becomes a legacy row. At minimum the
sweep covers ctxpack acceptance/admission/promotion, database migration,
move/OperatingChat, permission, context replay, Session history/projector/
prompt/runner variants, todo/tool progress, task/task-batch/todowrite, and
MasterAgent fixtures. OpenCode project migration/project fixtures must also
prove runtime preservation.

Do not mutate or replace an old bound Session in place. A Core transaction
cannot fence OpenCode legacy pre-save work such as plugins/file resolution.
Phase 1 therefore creates `runtime=v2` only for a fresh/unbound SessionV2-owned
built-in binding (OperatingChat, MasterAgent, or ChatRelay). All three services
read an existing binding's stored runtime before configuration, creation,
adoption, cleanup, or reset. Existing V2 follows its current path—OperatingChat
and MasterAgent configure, while ChatRelay returns the binding without a new
Session. Empty or populated legacy returns the exact binding with its legacy
transcript readable; mixed returns it for diagnostic metadata only. Legacy/
mixed invoke no V2 configure/adopt, binding CAS, cleanup, or event and report
conversion/reset unsupported; they are never CAS-swapped, rewritten, or
deleted. The same check applies to a CAS winner/rebound before configuring or
cleaning a losing candidate. Conversion is outside this plan.

Keep the existing Core OperatingChat SessionPort. Create stamps V2. One reused
existing-binding completion path handles the initial read plus CAS winner/
rebound: inspect `SessionRuntime` first; V2 resolves the workspace model and
configures exactly as today, while legacy/mixed returns the binding unchanged
without model validation, configure, or adopt. Reset still calls
`SessionRuntime.require`, proceeds only for an already-V2 binding, and reports
legacy/mixed conversion unsupported. No second OpenCode adapter or legacy-
service quiescence port is needed.

Extend `SessionRunCoordinator` with effectful whole-chain lifecycle callbacks,
then have `SessionExecutionLocal` publish the existing
`SessionStatusEvent.Status` (`busy`/`idle`) through EventV2. Busy publishes only
on inactive→active. Coalesced wakes/successor drains remain within that chain;
idle publishes only after all of them settle, whether success, failure, or
interruption. Use a per-Session serialized transition gate covering the final
pending-wake observation, active-map removal, idle publication, and registration
of a later chain, in that order. Recheck/coalesce a wake already observed; it
suppresses idle and joins the chain. Otherwise remove/mark inactive before the
asynchronous observational idle publication while retaining the gate, so an
active snapshot latched during publication sees absent/idle. A new wake/register
blocks behind that in-flight idle, then installs a new active chain and publishes
busy strictly after idle. Do not use a global cross-Session lock.

On the busy edge load and retain the authoritative Session location. Both
status publications pass that exact location explicitly to EventV2 because the
callbacks execute outside the Location-scoped runner. Publication is
observational: isolate/log listener failure content-free and preserve the drain
exit. Add latched idle-vs-wake, pending-wake no-flicker, interruption/failure,
different-Session concurrency, exact location/directory routing, and listener-
failure tests. The latched test must snapshot while idle publication is paused
and prove it cannot restore busy; a racing wake produces idle(N) then busy(N+1).
`SessionExecution.active` remains the authoritative resnapshot;
the App never manufactures V2 busy/idle.

Migration/runtime-boundary RED and GREEN fixtures cover:

- fresh database and an upgraded database;
- raw Session insert without runtime becoming legacy, subsequent V2
  adopt/mutation rejecting with zero effects, and direct SessionTable updates
  preserving runtime;
- legacy-only, V2-only, both/mixed, empty, and event-only
  Created→ModelSwitched/AgentSwitched/Moved/Revert classification;
- legacy Created→ModelSwitched/AgentSwitched/Moved history replay updating only
  shared metadata while preserving legacy runtime, with new high-level switch
  still rejected and Move still universally unsupported;
- old Deleted-without-runtime replay deleting legacy only, explicit matching
  runtime deletion, and omitted/mismatched deletion against V2/mixed producing
  zero row/event cleanup;
- runtime immutability;
- every inventoried child-table/projector/import writer;
- the TaskBatch worker archive requiring V2 in-transaction before its update;
  Core Todo update succeeding only for allowed local V2, OpenCode Todo update
  succeeding only for legacy, and wrong-runtime/mixed/managed-child attempts
  leaving Todo rows/events unchanged;
- OpenCode project bulk Session maintenance preserving legacy, V2, and mixed;
- mixed rejection and cleanup deletes;
- new legacy and new V2 stamps;
- omitted/wrong V2 stamp producing a typed conflict with zero input, message,
  epoch, event, provider, or execution effect (and at most an empty legacy
  orphan eligible for cleanup);
- cross-runtime service/projector failures with zero event, row, filesystem, or
  execution effects;
- direct SessionRunner and SubagentRunner calls rejecting legacy/mixed before
  provider/tool/filesystem work or V2 child creation;
- managed-child auth-first denial of the entire mounted current `/api` manifest
  with zero request-body reads, while legacy routes and `/global/health` retain
  captured behavior; process role rejecting direct V2 create/adopt/prompt/switch/
  revert/interrupt/execution, all three built-in binding services, WorkspaceV2,
  FunctionalityInstance, CtxPack service/repository/materializer/usage,
  ContextCapsule store, write/execute capability authorization, Core Todo, and
  permission/question operations before any row/event/FTS/provider/filesystem/
  map/grant effect, including Workspace list/get legacy-adoption and layout-get
  default/authority writers rather than trusting their read-like names;
- raw projector/direct-writer cross-runtime attempts failing inside their
  transaction before a child row or event commit;
- concurrent fresh/unbound creation uses the existing FunctionalityInstance CAS
  and losing-candidate cleanup;
- existing V2 OperatingChat and MasterAgent ensure configure as today and V2
  ChatRelay ensure returns unchanged; empty and populated legacy plus mixed
  ensure for all three return the exact binding before validation/V2 configure/
  adopt/cleanup, with zero binding/event/execution effect; legacy transcript
  remains readable, mixed remains metadata diagnostic, and every legacy/mixed
  reset reports conversion unsupported;
- separate exact durable-wire and full ordinary-live Session classifiers;
  filtered durable V1 plus current AgentSwitched/ModelSwitched/Moved pass wire
  replay on legacy, while V1 PartDelta/Diff/Error, other current families, and
  raw V2/mixed quarantine; ordinary sessionless V1 Error forwards byte-exact but
  a bound Error requires legacy; replay/history page batches shadow-preflight in
  order, so `[Created, V1 PartDelta]` and forged history produce zero replay/
  projector/GlobalBus/execution and allowed bytes remain exact; Core and
  control-plane Workspace removal rejecting unconditionally before even a
  prewalk for every shape, while direct legacy recursive Session removal
  prewalks the full tree and an all-legacy cleanup remains unchanged;
- one busy/idle pair around a whole coalesced chain; active removal precedes a
  latched idle publish, snapshot during that latch sees inactive, and a racing
  wake serializes idle→next-busy; exact retained location and observational
  listener failure.

Run from `packages/core`:

~~~powershell
bun run migration --name add-session-runtime
bun run migration --check
bun test test/database/session-runtime-migration.test.ts
bun test test/session-runtime.test.ts test/session-process-role.test.ts test/session-projector.test.ts
bun test test/permission.test.ts test/question.test.ts
bun test test/session-runner.test.ts test/session-subagent-runner.test.ts test/session-compaction.test.ts test/session-run-coordinator.test.ts test/session-execution-local.test.ts
bun test test/move-session.test.ts test/tool-task-batch.test.ts test/session-todo.test.ts
bun test test/workspace/service.test.ts test/workspace/functionality-instance.test.ts
bun test test/ctxpack-service.test.ts test/ctxpack-sql.test.ts test/ctxpack-materialize.test.ts test/ctxpack-usage.test.ts test/context-broker-capsule.test.ts test/capability-service.test.ts
bun test test/operating-chat-session.test.ts test/integration/master-agent-session.test.ts test/workspace/chat-relay-session.test.ts
bun typecheck
~~~

Run generation before the check, including on Windows; inspect the generated
migration and require only the runtime column plus bounded classification SQL.
The generator owns `migration.gen.ts`, `schema.gen.ts`, and `schema.json`.

Do not commit yet; the compatibility handlers must activate in the same commit.

#### Step 3: Implement the server-owned V2 compatibility adapter

Create one pure, bounded projector in
`packages/opencode/src/session/session-v2-compat.ts`. It accepts an encoded
`SessionMessage.Message` plus explicit Session ID, runtime-backed Session
defaults, directory, and preceding user root when required, and returns zero or
one keyed legacy `WithParts`. Phase 1 projects only pending/User and Assistant
messages. It folds AgentSwitched/ModelSwitched into the state needed to fill
those messages and deliberately returns no compatibility row for Synthetic,
System, Shell, or Compaction. Runtime-v2 UI already forbids shell/custom command
submission, and Compaction remains model-context state rather than a legacy UI
turn; omitting those non-required forms avoids a derived message-ID/pagination
protocol. A separate pending-input projection accepts
only the public `Prompt`, delivery, message ID, admitted sequence, and created
time. Neither function may read `context_snapshot_json` or a private model
sidecar.

Freeze these projection rules:

- User becomes one legacy user message. Runtime-v2 App optimism and the server
  both use the same canonical `buildRequestParts` source order and pass its one
  global ordinal into `legacyPartID` for every text/file/agent part. The input
  adapter already enforces zero/one Text then Files then Agents, so projection
  never reconstructs a lost interleaving. For a Session without
  presentation metadata (notably fresh ChatRelay), pending/Prompted user uses
  `agent = session.agent ?? "build"` and
  `model = session.model ?? { providerID: "", modelID: "" }`; branded empty
  model strings are the existing UI sentinel, not an execution choice. The
  first Step.Started emits a keyed full update of that user message with the
  actual resolved turn agent/model. Core's existing `AgentV2.select(undefined)`
  and `SessionRunnerModel.resolve` choose configured/default supported execution
  values; the browser sends no per-turn selector. On committed reload, never use
  the Session's latest agent/model for an older user turn: derive display
  metadata from the first following Assistant/Step.Started before the next User.
  Only an unfinished/pending turn may use current Session defaults or the empty
  UI sentinel. Bounded pagination carries or lookaheads enough turn state to
  make that association; otherwise it returns typed incomplete.
- Assistant keeps the current message ID, agent/model/finish, and uses the
  nearest preceding retained user root as `parentID`. If bounded lookup cannot
  prove that root, return typed incomplete rather than inventing an ID. Freeze
  the Schema-valid compatibility defaults already used by the App normalizer:
  `mode = message.agent`; `path` is the bound Session directory when the
  projector has it, otherwise `{ cwd: "", root: "" }`; `cost = message.cost ??
  0`; and `tokens = message.tokens ?? { input: 0, output: 0, reasoning: 0,
  cache: { read: 0, write: 0 } }`. Current error type is always literal
   `unknown`: map only exact message `Provider turn interrupted` to
   `MessageAbortedError`; map every other current error to `UnknownError` and
   preserve its message byte-for-byte. Current `AssistantReasoning.time` is
   optional while legacy ReasoningPart time is required: map
   `start = reasoning.time?.created ?? assistant.time.created` and
   `end = reasoning.time?.completed`. Text and reasoning preserve current
   semantic IDs in their deterministic legacy part IDs.
- Tool input `pending` parses the raw JSON to a record when valid and otherwise
  uses `{}` while always preserving the bounded raw string. Set start to
  `tool.time.ran ?? tool.time.created`; running uses that start and normalized
  metadata, while completed/error end is `tool.time.completed ?? start`.
  Completed output joins text content with `\n`, including valid empty output
  `""`; its required compatibility title is synthesized as `tool.name` because
  current tool state has no title. Normalize metadata to a record or `{}`. Map
  ToolStateError `state.error.message` byte-for-byte to legacy `error`, including
  a valid empty string.
  Normalize completed tool files with one pure mapper: take
  `state.attachments` in source order, then file items from `state.content` in
  source order; dedupe the exact canonical `(uri, mime, name)` tuple and keep
  the first. For each retained file derive `legacyPartID` from the assistant
  message ID, the parent tool's global ordinal, existing family `file`, and a
  length-prefixed semantic key containing tool ID, origin, source index, and the
  canonical tuple. Populate the full legacy FilePart—ID, Session/message IDs,
  type, MIME, URL, filename, and only representable source data. Reuse this
  mapper for every full upsert and reload; duplicate durable notification is
  idempotent, and replacement/shrink removes stale attachment IDs. Rich current
  `content`, `structured`, `result`, `outputPaths`, and provider metadata are
  deliberately flattened; document and test the dropped/non-isomorphic fields
  rather than claiming they are preserved.
- Synthetic, System, Shell, and Compaction are explicit compatibility no-ops in
  phase 1. Automatic compaction still controls provider history and durable
  current state; it simply gains no synthetic legacy timeline row.
- The allowlisted projector folds agent/model switches and preceding user
  history only to derive required legacy message fields; switch records do not
  create fake chat turns. The compatibility UI deliberately does not render
  system-context records. Raw current V2 ContextUpdated is quarantined from
  ordinary/sync/history with its Session family. Replacement-only selected-agent
  and OperatingChat profile sources also reconcile by Replace before rendering
  and never put sentinel text into event bytes; a legacy Session update and a
  non-Session manifest event remain byte-exact controls. System/synthetic/shell handling is explicit and tested; do not cast
  an unrepresentable current value to `SessionV1.Info`.
- Prompt files retain URI, MIME, filename, and representable source span. No
  compatibility path reads file bytes merely to render history.

Projector tests cover every input variant, require exactly one result for
pending/User and Assistant, and require explicit no-op results for Synthetic,
System, Shell, and Compaction. Pass the actual projected output through the
real `SessionV1.WithParts` Schema encoder for an unfinished Assistant and
pending, running, completed-with-empty-content, and error tool states; structural
object assertions alone are insufficient. These tests also prove a current row
ID remains the lookup/pagination ID—there is no derived compatibility message
ID that cannot resolve back to `session_message`.

Branch the existing Session HttpApi handlers on concrete runtime:

- `legacy` executes the existing handler unchanged;
- `v2` uses SessionV2 plus the projector for only the frozen allowlist; and
- `mixed` permits only list/get Session metadata for diagnosis. Session-scoped
  status, Todo, transcript, pending interactions, and every write endpoint fail
  with one stable quarantined/read-only error. Never merge V1 and V2 child rows
  into a compatibility transcript.

Keep `GET /session/:sessionID/todo` as the one explicitly runtime-neutral
auxiliary read in the compatibility allowlist. Resolve the concrete Session
runtime before reading Todo state: legacy and V2 both use the existing shared
TodoTable/Schema service, while mixed returns the same fixed quarantine error.
Do not add a public Todo mutation. Existing Core/OpenCode Todo writers remain
runtime-specific despite sharing TodoTable: Core update requires the allowed
local process role and runtime V2, OpenCode update requires runtime legacy, and
mixed or managed-child V2 returns before row/event effects. The matching guarded
tool/model loops retain current behavior; only Todo reads are runtime-neutral.

For runtime-v2 `prompt_async`, require the caller message ID to decode as current
`SessionMessage.ID` (`msg_...`), not merely the wider legacy-compatible
`msg...`, and lower only one explicitly representable `PromptPayload` subset
into current `Prompt`. Accept
`parts`, `delivery`, optional `resume`, and `contextAttachments`; reject
top-level `model`, `agent`, `noReply`, `tools`, `format`, `system`, and `variant`
with fixed `session_v2_prompt_unsupported` before file/resource/plugin/admission/
event/wake work. Reject `SubtaskPartInput`. The accepted parts sequence is
canonical and lossless: zero or one nonblank plain Text first, then every File,
then every Agent. Reject an explicit empty or trim-empty Text, a second Text,
Text after another family, File after Agent, or any other interleaving/
reordering. Zero Text persists `text: ""` and projects no text part. The optional
nonblank Text maps its bytes exactly; reject it when `synthetic`, `ignored`,
`time`, or `metadata` is present. The App's V2 builder emits this same canonical
sequence before optimism. A part `id` is accepted
only when absent or exactly equal to the shared deterministic ID for the caller
message/global ordinal; it is a checked compatibility correlation value, not a
silently discarded current field.

Map File exactly as `{ uri: url, mime, name: filename }`. An absent source stays
absent. Accept only a `source.type === "file"` whose canonical `path` denotes
the same file URI as `url`, then map `source.text.{ value, start, end }` to
`Prompt.Source { text, start, end }`; reject symbol/resource sources because
their range/name/kind/client metadata has no current representation. Map Agent
as `{ name, source?: { text: value, start, end } }`. File and Agent relative
order within their arrays is stable. Derive/check every deterministic part ID
over the materialized sequence—Text only when present, then Files, then Agents—
so authoritative reload reconstructs the same global ordinals without an absent-
Text hole. No field outside this named subset is ignored.

Preserve the caller message ID, delivery, and context attachments. Do not make
the existing defaulted Server `RequestUser` optional or use its
`{ id: "default" }` fallback for identity. OpenCode Authorization provides a
separate optional authenticated-external-user context populated only after
successful required Basic authentication; the compatibility handler reads only
that context and synchronously awaits `SessionV2.prompt` admission/validation
before returning 204. When Basic authentication is required, use the actual
configured username (whose default is `opencode`); an intentionally open
listener yields undefined. A managed child never treats its Basic
service credential as an external actor, so it suppresses the optional
authenticated-external-user value and rejects V2 before admission. Do not
fork/swallow admission, route through
`SessionPrompt`, accept per-turn agent/model/variant, or fall back after a V2
error. SessionExecution wake remains advisory inside SessionV2.
Forward optional `resume` exactly: `resume: false` durably admits without wake;
absent/true follows normal SessionV2 scheduling. Legacy runtime preserves its
current absent/true behavior and rejects `resume: false` as typed unsupported
before any prompt side effect; it never silently turns admit-only into execution.
`resume` is call-time scheduling, not persisted admission equivalence. Same-ID
retry reconciles only when prompt, delivery, and attachment snapshot match.
After reconciliation, false emits no new wake; absent/true may advisory-wake the
existing admission. Thus false→true intentionally resumes it, while true→false
cannot retract a wake already issued. Tests count wake calls in both directions.

Because `contextAttachments` contain private labels and hashes, sanitize prompt
decode failures instead of returning/logging `cause.message`. Keep normal
HttpApi `.handle` payload decoding; do not switch to `handleRaw`. Add an exact
POST `/session/:sessionID/message` and
`/session/:sessionID/prompt_async` middleware within the
outer Authorization boundary. Authenticate first, extract the Session ID, and
resolve Workspace plan plus concrete Session runtime without consuming the
body. `mixed` rejects content-free before a read. `legacy` passes the original
request to its existing unbounded decoder/handler byte-for-byte; legacy
PromptInput/data URLs have no aggregate size contract, so the new adapter may
not impose one. Valid legacy bodies larger than the V2 cap remain a regression
fixture. Newly added V2-only fields on a legacy body return one fixed sanitized
unsupported error after normal decode rather than reaching SessionPrompt.

Only `runtime=v2` uses the bounded-body helper. Create one Server-owned internal
module importable as `@opencode-ai/server/session-private-http`. It exports
`MAX_PRIVATE_PROMPT_HTTP_BODY_BYTES = 16_777_216` and the parameterized
single-read/replacement-request helper. OpenCode imports it through the existing
Server dependency, and standalone Server reuses it for
`/api/session/:id/prompt`. Never duplicate or weaken the
constant. Effect's
`HttpIncomingMessage.MaxBodySize` does not cap JSON `text`/`json` in this
checkout. Reject an oversized numeric Content-Length without reading; otherwise
consume `request.stream` incrementally under a hard byte counter, stop/cancel on
overflow, then build a replacement
`HttpServerRequest.fromWeb(new Request(...bounded bytes...))` preserving the
method, URL, and safe headers for the unchanged downstream `.handle` decoder.
Use the exact 16,777,216-byte bound so the existing valid 10-MiB attachment
allowance still fits after base64/JSON overhead. Absent-length/chunked bodies use
the same hard cap. The prompt-specific schema-error middleware maps V2/mixed
size/JSON/schema failures and rejected new fields on legacy to fixed content-
free codes and never logs rejected fields, raw JSON, labels, hashes, or
attachment content. Existing valid legacy handling remains unchanged. Valid V2
admission failures return only stable codes. Standalone Server
`/api/session/:id/prompt` receives the same auth-first bounded-replacement
invariant in its Authorization middleware while preserving normal decoded
`.handle`. Modify standalone `packages/server/src/middleware/schema-error.ts`
as part of the same task: exact prompt decode/size/schema failures return and
log only the fixed private-prompt code plus safe correlation, while other routes
retain the existing truncated diagnostic. A captured-log fixture puts unique
attachment labels/hashes/raw values in rejected input and proves none appears in
the response or logs.

The global OpenCode `middleware/error.ts` currently logs the raw defect and
`Cause.pretty` after an unexpected failure. In Task 2G it must recognize exact
POST `/session/:sessionID/message` and
`/session/:sessionID/prompt_async`, plus the combined current POST
`/api/session/:sessionID/prompt`, before every type-specific/generic defect
branch. Reuse `getWorkspaceRouteSessionID`'s exact one-segment,
decodeURIComponent-once, Session-Schema path logic rather than a second regex.
Emit/log only a fixed private-prompt code plus its safe correlation reference;
never include the defect, `Cause.pretty`, raw request/body, attachment, label,
hash, or Session ID. Ordinary routes retain their current diagnostic behavior.
Add a captured response/log fixture that dies with a unique private sentinel on
each exact route; neither sentinel nor cause text appears, while a neighboring
ordinary route still records its existing diagnostics.

Replace both global not-ready compositions in this same task. Authenticated
combined OpenCode and authenticated standalone Server select `v2-enriched`.
An open listener has no actor, selects `v1-clean-only`, and allows only a
zero-attachment prompt with no recall; any nonempty attachment returns the fixed
unavailable error before admission, materialization, event publication, or
wake. Managed-child process role rejects V2 instead of selecting clean-only.
Delete the misleading `managedNotReadyNode`/layer names. Export explicit
clean-only, local-enriched, and managed-denied test/composition nodes; the last
returns the Core process-role error rather than a usable assembly mode.
Pass the optional actor and `hasContextAttachments` into `withPermit`, and move
the existing-row lookup/exact-retry reconciliation inside that scope. Exact
retry still performs no profile/assembly/recall work, but it cannot bypass the
open-listener context rule or managed-child process-role rejection.
Tests assert sanitized errors and zero private sentinel in logs/responses.

Runtime-v2 messages use one bounded, versioned, Schema-validated opaque local
cursor bound to Session ID, runtime, direction, stable position, and a first-
page aggregate high-water `H`. Do not add signing without a restart-stable key;
authentication/Session routing protects the endpoint, while strict decoding and
binding prevent cursor confusion. Freeze `MAX_COMPAT_MESSAGE_PAGE = 100`,
`MAX_COMPAT_SCAN_ROWS = 4096`, and the exact final encoded-response bound
`MAX_COMPAT_MESSAGE_PAGE_BYTES = 33_554_432` (32 MiB): omitted limit defaults
to 100; single-message lookup applies that identical bound to its own final
Schema-encoded response; zero, negative,
non-integer, or above 100 returns a fixed typed error for V2, while legacy keeps
its existing query behavior. Merge:

- committed `session_message.seq` rows; and
- unpromoted `session_input.admitted_seq` rows, exposing only prompt,
  delivery, message ID, and time.

For every page select committed messages only at `seq <= H`; select inputs only
when `admitted_seq <= H` and (`promoted_seq IS NULL` or `promoted_seq > H`).
Dedupe an input as committed only when `promoted_seq <= H`. Sort by aggregate
sequence and scan skipped control rows under a fixed cap. Schema-encode each
zero-or-one projected compatibility row once, UTF-8 encode its JSON once, and
account exactly for the response-array brackets and commas; stop when adding the
next row would exceed 33,554,432 bytes. Preserve the
same `H` and source-sequence cursor so the next request resumes at that exact
row. Never split one encoded row or emit partial JSON; if one row alone exceeds
the whole cap, return a fixed content-free oversized error. Synthetic/System/
Shell/Compaction remain no-ops, so there is no projection ordinal or sibling
cursor. The 32-MiB limit contains the largest accepted 16-MiB canonical prompt
plus its compatibility envelope; a larger provider/tool row is deliberately
typed unreadable instead of making every reload unbounded. Return the same
Link/X-Next-Cursor contract as legacy pagination. Single-message lookup reads
committed current message and unpromoted input in one SQLite read transaction/
snapshot (or one equivalent UNION query), not two sequential autocommit reads.
Within that snapshot prefer committed; otherwise return the clean unpromoted
input owned by that Session; otherwise 404. Schema-encode that selected
compatibility object exactly once, serialize/UTF-8 encode the final lookup
response once, and reject over 33,554,432 bytes with the fixed content-free
oversized error. Never return a partial object or rely on proxy buffering. A
promotion cannot fall between the two logical views. A wrong-Session ID, malformed cursor, or private decode
failure is typed and content-free. If control rows hit
4096 before filling the requested page or proving end-of-history, return typed
incomplete; never scan farther or return a partial page as authoritative.
Test empty, pending-only, two pages, exact retry, pending ChatRelay metadata
converging on Step.Started, and an assistant whose parent
root lies on the prior page. Add the race where page 1 exposes a pending input,
it promotes after H, and page 2 retains the frozen pending representation rather
than omitting it or duplicating the post-H committed message.
Latch promotion between the lookup's two logical reads and prove the result is
either the pending snapshot or committed current message, never a false 404 or
removal.
Add a two-turn, two-page agent/model-switch fixture proving each historical user
keeps the first following Assistant/Step.Started metadata for its own turn, not
the Session's newest selection.
Add a final-encoded-byte boundary fixture whose next row resumes on the cursor,
plus huge file and tool-raw single-row fixtures that return the fixed oversized
error without leaking content. Legacy response-size behavior remains unchanged.

Map abort to `SessionV2.interrupt`. Do not merge `SessionV2.active` into global
`/session/status`: that response remains byte-compatible and legacy-only.
Runtime-v2 status is available only through the exact Session-scoped route and
its bounded reconnect recovery. Runtime-v2 does not implement the other legacy
mutations listed above; prove each returns before any legacy or V2 side effect.

Add Session-scoped compatibility endpoints beneath the already routed Session
group:

~~~text
GET  /session/:sessionID/permission
POST /session/:sessionID/permission/:requestID/reply
GET  /session/:sessionID/question
POST /session/:sessionID/question/:requestID/reply
POST /session/:sessionID/question/:requestID/reject
GET  /session/:sessionID/status
GET  /session/:sessionID/children/page?limit&cursor
~~~

For legacy runtime, use the existing legacy services filtered to that Session.
For V2, use `PermissionV2.forSession` and filtered `QuestionV2.list`, verify
request ownership again before reply/reject, and map to existing legacy request
schemas. Freeze one pure PermissionV2-to-legacy Request mapper and reuse it for
both the scoped list and live asked event:

~~~ts
{
  id: request.id,
  sessionID: request.sessionID,
  permission: request.action,
  patterns: request.resources,
  always: request.save ?? [],
  metadata: request.metadata ?? {},
  tool: request.source?.type === "tool"
    ? { messageID: request.source.messageID, callID: request.source.callID }
    : undefined,
}
~~~

Do not cast or leave required legacy fields undefined. Pass list/event outputs
through the actual legacy Request Schema encoder for every optional-absence case
and a tool source, and assert byte-identical mapping across both call sites.
Use a second pure mapper for QuestionV2 scoped-list and asked-event output:
copy `id`, `sessionID`, and `questions` exactly; when `tool` exists, decode
`tool.messageID` with legacy `SessionV1.MessageID` and retain
`{ messageID, callID }` only on success, otherwise omit optional provenance
content-free. The same legacy Question Request Schema encoder must accept both a
valid tool and an invalid-current/legacy-message-ID omission fixture.
Mixed fails read-only. These routes inherit Authorization,
InstanceContext, and `WorkspaceRoutingMiddleware`, so local V2 operations remain
Session-ID scoped and never depend on ambiguous global `/question` routing.
Leave existing `/session/:sessionID/children` bytes unchanged. The new
runtime-v2-only child page orders by stable `(created, id)`, accepts `limit`
1–64 (default 64), and returns a schema-validated opaque continuation cursor
binding root Session, first-page high-water tuple, last tuple, and limit. The
App may consume at most 16 pages, 512 total descendants, and depth 16 with
dedupe/cycle detection. Canonical encoded output is capped by
`MAX_CHILD_PAGE_BYTES = 256 KiB`; one oversized Session or page returns a fixed
typed incomplete/error before any partial page. If any cursor remains or a total/depth/cycle bound is
hit, it marks lineage recovery incomplete and installs no descendant
interactions; a child created after the frozen high-water is handled by the live
descendant trigger and a fresh crawl. The Session-scoped status route returns
the legacy status for a legacy Session and `busy` iff that exact V2 Session is in
`SessionExecution.active` for a V2 Session. Mixed receives the fixed quarantine
error and the App does not request its status. The route never answers for a
different Session or clears the existing global legacy status map.
Own the child-page contract in the existing Session HttpApi group/handler and
regenerate/stage both legacy JavaScript SDK generated trees in Step 6; never
hand-edit generated clients.

Harden the existing shared `getWorkspaceRouteSessionID` in
`server/shared/workspace-routing.ts` for every compatible Session-ID route.
Extract exactly one raw segment, apply `decodeURIComponent` exactly once, reject
invalid escapes plus decoded `/`, `\`, or control segment-confusion characters,
then decode with the SessionID Schema. Never use `SessionID.make` on raw path
text or decode twice. Residual literal `%` is valid: `%25` encodes it, and raw
`%255F` decodes to literal `%5F`, not `_`, so it cannot alias another Session.
Return the decoded ID for RequestPlan. Tests prove percent-encoded underscore
and an existing literal-percent remote ID route distinctly; double-encoded input
does not alias, while malformed escape and encoded slash/backslash/control forms
return a fixed content-free error before plan/handler. The combined current
route guard reuses this helper for exact/descendant Session paths.

At `WorkspaceRoutingMiddleware`, resolve that decoded Session ID and concrete
stored runtime before reading a prompt body or constructing a proxy. Catch only
the typed Session NotFound needed by the unchanged legacy planner. Any database,
decode, or service defect returns a fixed content-free error and cannot fall
through to Remote. Missing runtime and `legacy` use the byte-exact existing
planner/proxy. For `v2`/`mixed`, Local stays in the combined process and Remote
fails before body/handler/proxy/target HTTP. Never replace a Remote decision
with Local merely because the coordinator has a stale or partial Session row.

Add one `collectCurrentWorkspaceSelectors` boundary beside the shared path
decoder. It reads every flat `workspace`, deep `location[workspace]`, and
`x-opencode-workspace` occurrence; rejects duplicate query keys, a combined/
repeated header, invalid workspace IDs, or any disagreement content-free; and
returns the decoded singleton values. Apply it by exact method/path before the
combined current handler, without changing compatible legacy query bytes:

- exact/descendant `/api/session/:sessionID` routes decode the path once, load
  the Session, and derive authority only from its stored workspace. Each
  selector must be absent or equal that value; a selector never retargets the
  Session;
- exact GET `/api/session/active` is process-global and has no LocationQuery.
  Accept only a truly unscoped URL/header; any flat, deep, or header workspace
  selector rejects content-free before plan/handler work for Local and Remote
  values alike;
- permission/question pending LocationQuery reads derive the mounted workspace
  from deep `location[workspace]` or the header. An optional flat transport
  selector may corroborate only and must equal that value; flat-only is
  nonrepresentable and rejects before plan/handler. No selector remains process-
  local. Deep-only, header-only, and matching flat+deep/header derive the same
  authority, including all three selectors together. Local strips only the flat
  transport selector and preserves exact deep/header input for the mounted
  handler; Remote rejects before the handler;
- exact GET `/api/session` preserves flat `workspace` as the mounted metadata
  filter and routing selector. Decode `cursor` through exported
  `SessionsCursor.parse`; its embedded workspace is authoritative for a
  continuation, and any flat/deep/header selector must exactly match it. Deep
  and header only corroborate, flat remains in the handler query, malformed/
  conflicting/duplicate selectors reject, and truly unscoped no-cursor input
  remains process-local;
- current POST `/api/session` rejects all flat/deep/header routing selectors;
  and
- exact OperatingChat, MasterAgent, and ChatRelay GET/ensure/reset derive
  authority from the path workspace ID. Query/header values must be absent or
  equal it. Local executes the whole existing transaction; Remote fails before
  body or FunctionalityInstance/Session create/configure/CAS/cleanup/event work.

POST `/api/session` create/adopt authority lives in its body. After
Authorization, use `MAX_PRIVATE_PROMPT_HTTP_BODY_BYTES` and the shared
single-read replacement helper to cap the body at exactly 16,777,216 bytes and
decode it once with
`Api.groups["server.session"].endpoints["session.create"].payload`. Treat
`location.workspaceID` only as persisted context metadata, never a Remote proxy
selector, and apply this closed matrix before the ordinary `.handle` decoder:

- if the requested workspace currently resolves to a Remote control-plane
  target, reject locally with zero proxy/target request, whether ID is supplied
  or omitted;
- if a supplied ID already resolves Local, require stored runtime V2. Preserve
  its stored location as authority; requested location may be omitted or must
  exactly equal decoded directory and workspace. Legacy/mixed, Remote, or a
  location mismatch is a fixed conflict;
- if a supplied ID is absent locally, accept it only on standalone/combined with
  zero managed remote targets. With any remote target, reject because a worker
  may own an unseen row; and
- if ID is omitted, keep normal server-owned local creation, subject to the same
  Remote-workspace rejection.

Before Session/Event writes, resolve the chosen directory and Location service
on the coordinator; inaccessible location is a fixed conflict. On acceptance,
provide the same replacement request to ordinary `.handle`, so the underlying
stream is consumed once. Query/header selector, malformed/oversized body,
Remote metadata, ambiguous ID, wrong runtime/location, and inaccessible
directory fixtures produce fixed content-free response/logs with zero
Session/Event/filesystem/provider effects and zero target HTTP.

Extend the existing error mappers in the three Server binding handlers. Core
runtime conflict, managed-child role denial, and legacy/mixed reset-conversion
errors map respectively to the already-declared
`OperatingChatConflictError`, `MasterAgentConflictError`, and
`ChatRelayConflictError`, each with one fixed content-free message. Do not copy
`error.message`, Session/binding IDs, runtime details, or private data. In the
OpenCode workspace handler, map the unconditional remove error to the endpoint's
existing fixed `HttpApiError.BadRequest` response before any removal call. Reuse
those existing response unions; this translation adds no Protocol error or
generation requirement.

The injected managed-child process role is checked below HTTP too. In the
authenticated outer boundary, default-deny the complete `/api` prefix before
payload decoding; do not maintain a mutation matcher or allowlist. Legacy
traffic remains on its existing non-`/api` routes and `/global/health` remains
the child health seam. Derive a manifest-drift test from the mounted current Api
and prove every current method/path receives the same content-free denial. Direct
SessionV2, WorkspaceV2, FunctionalityInstance, CtxPack SQL/
service/materializer/usage, ContextCapsule, write/execute Capability, Core Todo,
and all three built-in services return the same fixed authority error before
effects even if `OPENCODE_WORKSPACE_ID` makes the child planner report Local.
Tests exercise the complete current worker Api manifest, compatible V2 mutation matrix, plus
direct Core services and assert zero row/event/FTS/file/provider effect; legacy
routes/services are captured unchanged and there is no clean-only worker escape.

An explicit workspace on a Local Session remains metadata. Keep its persisted
directory in the Location context used by provider/tools and prove it is
coordinator-accessible. A capture transport must observe zero target HTTP for
prompt, reload, interactions, and tool execution.

Preserve the existing rule

~~~ts
{ method: "GET", path: "/session", action: "local" }
~~~

with its current prefix semantics; do **not** add `exact: true`. Add the runtime-
aware Session-ID branch before/alongside the legacy matcher. Missing-runtime/
legacy returns to the original matcher so `/session` descendants preserve their
captured target, request, and response bytes. V2 or mixed descendants resolve
runtime first and a Remote plan returns the fixed error before proxy.

Server RED/GREEN tests cover the full runtime matrix, exact unchanged legacy
bytes, V2 prompt admission, delivery/context attachments, server-derived user,
same-ID retry/conflict, pending merge/pagination, interrupt, status, every
unsupported route, mixed metadata-only behavior with fixed status/Todo/
transcript/interaction rejection, Session-scoped interactions,
wrong-session requests, unchanged prefix-based legacy GET routing, explicit-workspace clean
admission on an open listener, authenticated local enrichment, and open-listener
explicit-attachment unavailable with zero admission. Route-ID fixtures prove
percent-encoded underscore and literal-percent IDs reach distinct plans, double-encoded input never aliases,
and invalid escapes or encoded separators/controls reach neither plan nor
handler. Authentication fixtures prove required Basic auth exposes the actual
configured username (default `opencode` and a named override), an open listener
exposes no optional authenticated external user, managed-child service Basic is
suppressed, and the unrelated defaulted `{ id: "default" }` RequestUser remains
unchanged for legacy handlers. A worker fixture enumerates the mounted current
Api manifest and proves every `/api` method/path returns the same fixed denial
after auth but before body read; `/global/health` and representative legacy
routes retain their existing bytes. Additional routing fixtures prove V2/mixed Local
executes entirely in the combined process, V2/mixed Remote returns before body/
proxy/target HTTP, legacy Remote preserves its captured request/response bytes,
and only typed Session NotFound reaches the legacy fallback; an injected lookup
defect is content-free and reaches no proxy. Keep the prefix-based legacy
`GET /session` rule unchanged and capture the same descendant target/bytes before
and after the runtime-aware branch.

Use literal URLs captured from the generated client for current active,
permission/question pending, Session-list first/continuation pages, Session-ID,
and built-in routes. Test the endpoint matrices separately. `/api/session/active`
accepts only no selector; flat-only, deep-only, header-only, or any matching/
conflicting combination rejects before its process-global handler for both Local
and Remote values. Permission/question pending accepts unscoped process-local,
deep-only, header-only, or matching flat+deep/header; flat-only rejects as
nonrepresentable; all three matching selectors are also valid. Local preserves
exact deep/header mounted input and removes the transport-only flat value, while
Remote rejects before the handler. Repeat
flat-only, deep-only, header-only, and matching combinations under explicit
Local and Remote plans. Pin duplicates within either query key, repeated/
combined header, disagreement,
stored-Session and path mismatch, malformed cursor, cursor-only workspace,
selector-vs-cursor mismatch, and truly unscoped list. Prove flat Session-list
workspace reaches its mounted handler unchanged and legacy flat compatible
target/request/response bytes do not change.

For POST `/api/session`, test query/header rejection and the complete decoded
body matrix: existing Local V2 with omitted/exact location succeeds; location
mismatch plus existing legacy/mixed/Remote rejects; absent supplied ID succeeds
with zero remote targets but rejects with any remote target; omitted ID creates
locally; and Remote-valued metadata rejects for supplied or omitted ID. Add an
inaccessible directory/Location-service fixture. Malformed JSON and bodies
over 16 MiB reject; a valid body exactly at the cap reaches normal decode.
Instrument the source to prove one read and normal
handler decode from the replacement only; capture rows/events/files/provider
and target HTTP to prove every rejection has zero effect and no sentinel in
response/log.

Exercise exact/descendant current Session routes plus all three built-in GET/
ensure/reset routes, including fresh Remote ensure, managed-child role, and an
explicit local workspace directory used by provider/tools with zero target HTTP.
The private-defect fixture must include current POST
`/api/session/:sessionID/prompt` alongside both compatible prompt routes and an
ordinary control route; private response/logs contain only the fixed code and
safe correlation, while the ordinary route keeps its existing diagnostics.
Focused binding-handler fixtures force every new Core runtime/role/conversion
error through OperatingChat, MasterAgent, and ChatRelay GET/ensure/reset and
assert the existing conflict tag plus fixed content-free body. The OpenCode
workspace-handler fixture forces unconditional removal rejection and asserts
the existing fixed BadRequest, zero service/effect work, and no domain message.
Add a full PromptPayload matrix: canonical zero/one plain Text plus exact
file/agent lowering and deterministic IDs succeed, while Subtask, text
synthetic/ignored/time/metadata, top-level model/agent/noReply/tools/format/
system/variant, legacy-only `msgx` message ID, mismatched part ID, and symbol/
resource file source, multiple Text parts, Text after File/Agent, and File after
Agent return the
same fixed content-free unsupported code before file/resource/plugin/admission/
event/wake effects and create zero input/event/wake state. Put unique secret
values in every rejected field and assert
they are absent from responses and logs. Add malformed, oversized Content-Length, and
oversized chunked prompt bodies containing unique private sentinels; assert an
unauthorized oversized request fails before routing/body read, authorized size
failures for a runtime-v2 Session are fixed/content-free, sentinels are absent
from logs/responses, and a valid approximately 10-MiB V2 attachment still
admits. A concrete legacy Session body larger than the V2 cap follows its
unchanged decoder/handler successfully with no bounded-helper read/rebuild;
mixed rejects before reading. Instrument the V2 source stream to prove the
bounded helper reads it once and `.handle` decodes only the replacement bytes.
The shared Server helper's focused test pins Content-Length and chunked bodies at
16,777,215, 16,777,216, and 16,777,217 bytes.

Run the owning suites before event-bridge work:

~~~powershell
Set-Location packages/server
bun test test/middleware/authorization.test.ts test/middleware/schema-error.test.ts test/session-private-http.test.ts test/session-local-readiness.test.ts
bun test test/operating-chat-handler.test.ts test/handlers/workspace-master-agent.test.ts test/handlers/chat-relay-session.test.ts
bun typecheck
Set-Location ../opencode
bun test test/session/session-v2-compat.test.ts test/session/session.test.ts test/session/todo.test.ts test/server/httpapi-session.test.ts test/server/httpapi-v2-local-only.test.ts test/server/httpapi-workspace-routing.test.ts test/server/workspace-routing.test.ts test/server/httpapi-sync.test.ts test/server/httpapi-error-middleware.test.ts
bun test test/control-plane/workspace.test.ts test/server/httpapi-workspace.test.ts test/effect/session-context-location-map.test.ts
bun typecheck
~~~

#### Step 4: Adapt current events once at the OpenCode boundary

Keep one browser event stream. `EventV2Bridge` applies the durable-wire
classifier to sync envelopes and the full ordinary-live classifier to ordinary
events, including V1 and current transient deltas. Allowed durable V1/current-
metadata, matching-legacy V1 live, and non-Session manifest records preserve raw
bytes. A Schema-valid V1 `session.error` without sessionID is the sole
sessionless/runtime-neutral live exception and also preserves bytes; a bound
error requires a legacy row, and Error is never durable. Raw V2/mixed/unknown or
forbidden current-on-legacy Session records quarantine; a locally owned V2
record instead emits only the legacy ordinary compatibility vocabulary consumed
by the existing App. Those siblings are local presentation events, never sync
replay records, and need no pair/dedupe carrier:

- every durable message-affecting event runs after the current projector commit,
  queries the post-commit authoritative current row, and emits its zero-or-one
  full deterministic `message.updated` plus keyed
  `message.part.updated`/removed projection;
- PromptAdmitted projects the clean pending input, while Prompted replaces it
  under the same message/part IDs;
- text/reasoning deltas map to `message.part.delta` with `field: "text"` and
  the secondary semantic index's latest source ordinal/PartID, matching Core
  `findLast` when semantic IDs repeat. A missing index triggers bounded
  refetch/wait and never a guessed PartID;
- tool-input deltas are deliberately not translated: the App reducer appends
  only a top-level string while current raw input is nested under `state`.
  Durable Input.Ended/Called/Progress/Success/Failed events instead query the
  authoritative row and emit a complete tool/message upsert. Phase 1 therefore
  streams text/reasoning but not partial tool arguments;
- Session metadata and every Revert.Staged/Cleared/Committed event query the
  post-projection Session and emit only ordinary `session.updated`;
- current permission/question asked/resolved events map to the existing legacy
  request lifecycle; and
- existing `session.status` passes through unchanged.

One source event may yield several legacy events. Do not invent a source-ID
carrier or sibling-dedupe protocol. Durable compatibility projections are
at-least-once full `message.updated`/`message.part.updated` (or keyed removal)
operations whose deterministic message/part IDs make duplicate delivery
idempotent. Transient text/reasoning deltas, status, and interaction
notifications are live-only and are never replayed from durable catch-up;
tool-input deltas are omitted until the next durable full upsert. Test
duplicate durable translation converges to byte-identical App state, and
each live transient delta is emitted once and not emitted by replay.
Because the Global SSE carries event data rather than an SSE `id`, one current
source event may reuse its source ID across a message upsert plus several part
siblings. Add an App-chain assertion that every sibling applies; do not invent a
carrier or dedupe them by payload ID.
Replacement-only selected-agent/OperatingChat profile material must already have
reconciled to `Replace` before publication and therefore appears in neither raw
ordinary nor sync/history bytes. Add an on-wire sentinel regression proving that
privacy boundary. A legacy public Session update and a non-Session manifest
event remain byte-exact controls through ordinary delivery, sync, and history;
current V2 ContextUpdated remains local/quarantined like every V2 Session record.

Revert is not exposed as a phase-1 compatibility mutation, but another current
client may produce it. Do not add a bridge suffix cache, removed-ID list, or
tombstone map. Revert.Staged preserves the projected Session revert marker, so
the existing UI keeps the suffix hidden. Revert.Cleared and Revert.Committed
both publish the post-projection `session.updated`; when the App observes a
runtime-v2 Session transition from `revert` present to absent it performs one
authoritative compatibility-message reload and atomically replaces the loaded
window. Existing load generations discard responses started before that reload.
Task 2G Step 5 also performs an unconditional generation-invalidating newest-100
reload after each `server.connected` authoritative root/descendant resolve,
because all revert events may have been missed. Test staged/cleared, staged/
committed, bridge restart between events, all missed-transition cache states,
and a delayed pre-reload page response.

Durable EventV2 listener failures are already isolated after projection, but
transient text/reasoning notifications call listeners inline. Wrap compatibility
lookup/projection/GlobalBus emission observationally for both classes. A failure
is logged content-free and never replaces or interrupts the provider stream,
model drain, or admission result. A missing source converges from the next
durable full upsert or one bounded Session-scoped reload; never guess or log
content. Benchmark the full-message durable traffic in the existing Task 2G App
scenario. Add coalescing only if the measured result shows a material regression.

Sync RED/GREEN fixtures exercise each boundary independently, not only the HTTP
handler. Source durable history rejects forged V1 message.part.delta,
session.diff, and session.error rows; ordinary live covers those three on a
matching legacy row, a byte-exact sessionless Error from worker to coordinator,
and a session-bound Error against legacy versus V2/mixed. It also covers the
three current metadata exceptions, forbidden current events, transient current
deltas, and a non-Session control. Target replay, page-batched catch-up, and live
apply cover exact/divergent IDs, Created/Deleted shadow state, unknown events,
V2/mixed rows, metadata exceptions, and forbidden current families. A
`[legacy Created, V1 message.part.delta]` request and forged catch-up page both
leave zero rows/events. Every quarantine path asserts zero projector, child row,
GlobalBus, and SessionExecution effect; other unknown/sessionless input fails.

Run from `packages/opencode`:

~~~powershell
bun test test/session/session-v2-compat.test.ts test/cli/import.test.ts
bun test test/session/session.test.ts test/session/prompt.test.ts test/session/revert-compact.test.ts test/session/compaction.test.ts test/share/share-next.test.ts test/permission/next.test.ts test/question/question.test.ts
bun test test/control-plane/workspace.test.ts test/project/project.test.ts test/project/migrate-global.test.ts test/session/todo.test.ts
bun test test/event-v2-bridge.test.ts
bun test test/server/httpapi-session.test.ts test/server/httpapi-sync.test.ts test/server/httpapi-workspace.test.ts test/server/httpapi-control-plane.test.ts test/server/httpapi-workspace-routing.test.ts test/server/workspace-routing.test.ts test/server/httpapi-error-middleware.test.ts
bun typecheck
Set-Location ../server
bun test test/session-private-http.test.ts
bun typecheck
Set-Location ../opencode
~~~

#### Step 5: Keep the App on its existing stores and compatible API

Do not add `ServerEvent.v2`, a current-message source, a V2 surface controller,
a transport registry, a second SSE subscription, generated-V2 history polling,
or a raw-workspace router. The existing `ServerSession` message/part/status/
permission/question reducers remain the only App presentation authority.

Make only these runtime-aware changes:

1. The App's `server-compat.ts` consumes pinned vendored `SessionInfo`/`SessionApi`
   inputs, even though regenerated workspace-SDK `Session` and ServerSession
   stores do gain runtime. Keep one narrow local validated intersection/helper
   at that adapter boundary: Schema-decode runtime from the unknown compatible
   list/get/event value, include it in `sessionInfo()`, and return the normal
   current-shaped Session with concrete runtime—no vendor cast or broad store
   widening. `normalizeSessionInfo`, home index, directory sync, and ServerSession
   then use their regenerated workspace type normally. Add raw compatible list/
   get/event fixtures proving legacy/v2/mixed survive normalization and malformed
   runtime fails closed. Wire the actual event intake too: before
   `ServerSession.apply` calls `remember` for `session.created` or
   `session.updated`, decode and normalize `properties.info` through that same
   shared boundary. Missing runtime becomes legacy; malformed runtime leaves the
   existing Session store unchanged. Remove the unchecked cast as a runtime
   authority path. A missing runtime from an older server is treated only
   as `legacy`; endpoint success never infers V2. Freeze one App-internal,
   non-wire compatible-prompt field, `sessionRuntime: "legacy" | "v2"`.
   `createPromptSubmit` derives it only from resolved normalized Session info;
   an older-server omitted runtime has already normalized to `legacy`, while an
   unresolved or mixed bound/existing Session stops before local mutation or
   network and never reaches the adapter. Unbound generic legacy creation keeps
   its existing path. `server-compat.ts` strips `sessionRuntime`: its legacy/
   old-server branch calls the existing legacy `promptAsync` with the byte-exact
   pre-change JSON body and omits `delivery`, `resume`, and
   `contextAttachments`; only its V2 branch includes those three fields. It uses
   the new Session-scoped permission/question reply/reject routes, always
   including the request's Session ID. No failure retries through another
   runtime body or endpoint.
2. For `runtime=v2`, preflight the real `buildRequestParts` result before any
   draft/history/input/attachment/optimistic/network mutation. The main draft is
   the sole optional nonblank Text. Losslessly reorder all representable prompt
   files, comment-free context files, and images before all Agents, then compute
   `legacyPartID` values over that canonical materialized order. Reject a context
   item with a nonblank comment or synthetic metadata, symbol/resource source,
   or any noncanonical source content-free; never turn it into visible text or
   silently drop it. The server accepts the same Text/File/Agent order. Authoritative
   Prompted/part events therefore confirm and clear queued optimistic content
   without duplicates. Legacy runtime retains its current request parts and
   random-ID behavior.
3. Runtime-v2 submit sends no per-turn agent/model/variant, never writes
   optimistic `session_status`, and keeps the immediate optimistic message.
   It bypasses the legacy submit precondition that requires browser-local agent
   and model selections; durable Session/default runner resolution owns them.
   Core `session.status` plus Session-scoped V2 status recovery own busy/idle;
   global `/session/status` remains legacy-only. Admission failure
   rolls back only the optimistic message/draft under existing retry rules.
   `sendFollowupDraft` and its outer catch never set busy or idle for V2; a
   failed queue/steer while a drain is already busy therefore cannot force
   idle. Legacy status behavior is unchanged.
   A bound/existing Session whose normalized info/runtime is still absent or
   loading fails closed before draft capture, history/comment/attachment change,
   optimistic IDs, prompt runtime dispatch, or network; never guess legacy/random
   IDs. Once an older server returns concrete info with an omitted runtime, the
   adapter's explicit default-to-legacy rule applies and emits the byte-exact
   legacy prompt body. Unbound generic new-Session legacy flow is unchanged.
4. In the bound Session surface, Session update/delete, command, shell, init,
   compact/summarize, fork, revert, share, and direct message/part update/delete
   controls are hidden for V2/mixed.
   `use-session-commands.tsx` filters share/unshare, revert/unrevert, compact,
   fork, and every other incompatible command from command/slash menus as well
   as guarding its callback. `MessageTimeline` also hides its unconditional
   rename, share/unshare, archive, and delete controls for V2/mixed while keeping
   read/export presentation.
   Do not chase global sidebar/layout commands or every deep-link/dialog/home/
   stale callsite solely to prevent a rejected HTTP request. The UI guarantee is
   limited to the bound Session surface, its Session command palette, and
   MessageTimeline already named here. Other callers may issue one request; the
   Server runtime guard is authoritative and rejects it with a fixed content-free
   conflict before durable/plugin/filesystem/provider effects, after which the
   App may refresh. Existing legacy bindings retain their legacy controls;
   mixed is read-only. OperatingChat runtime conversion/reset is explicitly
   unsupported in phase 1 and performs no binding or Session mutation.
   `PromptInputControls` also exposes one runtime-derived
   `selectorsVisible: boolean`. Both PromptInput renderers and
   `use-composer-commands` hide/lock agent,
   model, and variant selection for V2/mixed; legacy keeps the exact current
   selectors and shortcuts. The server remains authoritative for forced input.
5. Keep global bootstrap as an opportunistic warm-up, but do not make it the
   recovery authority. A bound root can be absent from coordinator-local bare
   `GET /session` and only appear later when the Canvas/DirectoryDataProvider
   calls `session.sync(boundID)`. When a concrete runtime-v2 Session is resolved
   or pinned by that sync, trigger one per-Session deduped scoped recovery; also
   retrigger it on `server.connected`. Add one token-owned
   `authoritativeResolve(sessionID)` primitive: synchronously retire/delete any
   existing `requests.get` owner, install a fresh request token, capture that
   Session's info revision, and issue a new Session GET even while the old
   request is in flight. At `ServerSession.apply`, successfully decoded
   `session.created`/`session.updated` events pass the shared raw runtime decoder
   before mutation (missing runtime becomes legacy; malformed changes nothing),
   and `session.deleted` Schema-decodes its Session identity. Before a valid
   event remembers/updates/forgets/evicts, increment that Session's info revision
   and retire its matching GET token. A GET result may normalize/remember only
   if both token and captured revision are still current; only that token's
   `finally` may clear ownership. Thus a live create/update beats older HTTP
   metadata and a live delete cannot be resurrected.
   On every connected event, call `authoritativeResolve` for the pinned root
   first and immediately call the authoritative reload primitive defined below
   after that fresh metadata result to replace it with the newest authoritative 100-row
   compatibility page before starting lineage recovery. Root repair does not depend on a
   complete crawl; permanent byte/count/depth/cycle incomplete lineage must not
   preserve a missed root Revert.Committed suffix. Keep the legacy raw `children` endpoint
   byte-compatible; runtime-v2 recovery instead pages the new Session-ID-routed
   `/session/:sessionID/children/page` endpoint from each V2 root. It consumes
   all pages under the frozen 64-page-size/256-KiB-page/16-page/512-total/
   depth-16 high-water, dedupe, and cycle bounds or marks recovery incomplete and fails descendant
   interaction handling closed. Before the crawl, capture the bounded cached
   descendant-ID set and its revisions. Maintain a server-scope-local info revision for
   every Session summary, including deletion tombstones. Each page captures the
   revision map for known IDs (absent is 0); live create/update/move/delete
   increments that Session's revision. Normalize each returned child and CAS-
   apply it only if its revision is unchanged, then advance the revision. This
   refreshes unchanged stale cache on reconnect while a live insert/update/move/
   delete during the request wins and cannot be overwritten or resurrected. Only
   after the full crawl completes within every bound, CAS-forget/tombstone each
   previously cached descendant absent from the result when its captured
   revision is still unchanged, clearing its scoped permission/question/status
   state and aliases. An incomplete/error crawl removes nothing.
   Then call Session-scoped status and pending endpoints only for the root plus
   validated crawl. This recovers a pre-existing child that V1 bootstrap never remembered;
   no directory-wide scan is added. A child created after the page high-water
   enters only through the live validation trigger/fresh crawl. Never query or display
   unrelated same-directory Sessions. Group interactions
   by Session exactly as today. Reconnect results are
   guarded by independent revisions for each
   `(sessionID, summary|status|permission|question)` family. Each live event
   advances only its own family; a stale permission response cannot restore a
   resolved request, permission activity cannot suppress a question snapshot,
   and status/summary updates cannot suppress or overwrite one another. A live child-created or
   unknown-child interaction triggers one deduped bounded lineage validation and
   scoped resnapshot, so children created after mount recover too.
6. `createServerPermissionState` performs auto-response refresh through the same
   Session-scoped V2-compatible route for known runtime-v2 Sessions. Manual and
   automatic replies need no provenance marker or registry: Session runtime and
   Session-ID routing are authoritative.
7. When `server-session.ts` observes a runtime-v2 `session.updated` transition
   from `revert` present to absent, it forces one authoritative compatibility
   transcript reload through one named `authoritativeReload(sessionID)`
   primitive. Do not implement this as a generation bump followed by the
   existing loader. In one synchronous transition the primitive retires/deletes
   the old `messageLoads` owner, installs a fresh per-Session load token/
   generation plus a fresh `MessageLoadState`, marks that token loading, and
   starts one newest-first page at limit 100 even when the retired owner left
   `meta.loading` true. Feed the response through the existing live-change
   journal and `reconcileFetched`, so message/part update, removal, or delta SSE
   received during the fresh request wins over the HTTP snapshot. Its result and
   `finally` may change rows, parts, cursor, completion, or loading only when
   their captured token is still current. A stale result cannot replace fresh
   rows, the fresh result cannot overwrite later SSE state, and a stale `finally`
   cannot clear the new owner's loading state or leave a permanent spinner.
   Best-effort abort is optional and not correctness authority. Atomically replace the loaded window even
   if it previously held 250 or more rows. Older surviving history is reachable
   only through the fresh cursor; never issue one `meta.limit > 100` request.
   The existing generation rejects every page/reload started before the revert.
   No new tombstone or removed-ID authority is introduced. A transition alone
   is not reconnect authority: after every `server.connected`, reconnect calls
   `authoritativeResolve` then
   `authoritativeReload` for the root; only after a complete bounded lineage
   crawl does it run the same resolve-then-reload pair for each validated
   retained V2 descendant. Discard every late pre-reconnect metadata result or
   transcript page.
   This repairs root state even when lineage is permanently incomplete, plus
   missed Cleared, missed Committed with cached staged state, and missed
   Staged+Committed with cached absent state. Legacy
   reconnect behavior is unchanged; mixed performs no transcript, status, Todo,
   or interaction request.
8. The bound Session accessor (`input.sessionID()` or `input.info()?.id`) is
   authoritative for runtime-v2 interrupt and existing-Session detection.
   Route `params.id` is fallback only for an unbound generic surface. A Canvas
   OperatingChat with empty route params interrupts its bound ID and never
   enters the worktree/create path.
9. Make `server-session` message loading runtime-aware without racing cold
   metadata and transcript reads. If cached normalized Session info has a
   concrete runtime—including an older-server missing wire field already
   normalized to legacy—retain the appropriate fast path. If no Session info is
   cached, await compatible Session get/normalization first, then choose the
   transcript path; metadata failure, malformed/unresolved runtime, or mixed
   performs no transcript request. A concrete runtime-v2 Session requests limit
   100 on initial load, every load-more continuation, revert/reconnect reload,
   and prefetch, matching `MAX_COMPAT_MESSAGE_PAGE`. Legacy preserves exact
   source behavior: initial load 20, load-more and prefetch 200, and legacy
   revert retains its current `meta.limit` behavior unchanged. Prefetch follows
   the same resolve-first sequence and selects V2 100, legacy/older-server 200,
   or mixed none. Keep the layout callsite unchanged: choose runtime target and
   limit inside `server-session.prefetch`.

Tests prove:

- the captured V2 `promptAsync` JSON body includes message ID, delivery, resume,
  context attachments, stable V2-compat part ordering, and omits the internal
  `sessionRuntime` dispatch field plus per-turn selections/user ID; runtime-
  v2 accepts an absent Text or exactly one nonblank Text followed by Files then
  Agents and only the accepted source subset. Explicit empty/whitespace Text,
  multiple Text, and interleaving reject before effects; absent Text persists
  empty current text, projects no text part, and assigns file/agent ordinals
  without a gap. Unsupported PromptPayload fields remain absent from the App path;
- comment-free context files and images that originally follow Agents are
  losslessly reordered before Agents and reconcile under canonical IDs; a
  nonblank context comment/synthetic Text, symbol/resource source, or
  noncanonical source rejects before any draft/history/input/attachment/
  optimistic/network mutation, while legacy buildRequestParts is unchanged;
- V2/mixed composers expose no agent/model/variant selector or shortcut and can
  submit with no browser-local selection; legacy selector behavior is unchanged;
- a bound Session with unresolved info/runtime or mixed performs zero draft/
  history/optimism/network mutation until resolved, while an explicit old-
  server missing runtime normalizes to the `sessionRuntime: "legacy"` dispatch
  branch and generic new-Session creation is unchanged;
- a captured legacy and old-server-missing-runtime `promptAsync` request has the
  exact pre-change JSON body and omits `sessionRuntime`, `delivery`, `resume`, and
  `contextAttachments`; no legacy/V2 branch retries through the other shape;
- queued canonical text+file+agent optimism is visible immediately and fully
  reconciles by the same persisted-sequence IDs after authoritative reload;
  file+agent-only optimism uses the same zero-based materialized ordinals;
  committed messages whose message/text/reasoning/tool IDs are very long reload
  without a compatibility error, distinct long tuples do not alias, and a
  rebuilt compatibility index resolves live semantic IDs to the same full-
  digest PartIDs used by history;
- duplicate text and reasoning semantic IDs rebuild the secondary index in
  source order, a live delta updates only the latest occurrence exactly like
  Core `findLast`, and reload produces the same mapping;
- V2 transcript limit omission defaults to 100; limit 0, negative, non-integer,
  or above 100 rejects; max 100 succeeds, legacy query behavior is unchanged,
  and 4,096 skipped control rows return typed incomplete without an unbounded
  scan or authoritative partial page;
- final Schema-encoded V2 responses stop before exactly 33,554,432 bytes and
  resume the next source sequence under the same high-water; huge file and tool-
  raw single rows fail with the fixed content-free oversized error, while
  legacy byte behavior and the zero-or-one Shell/Compaction-no-op cursor remain
  unchanged. A separate huge single-message lookup fixture selects its row under
  one SQLite snapshot, encodes the final response once, and fails with the same
  fixed content-free oversized error rather than exercising the page path;
- cached App runtime-v2 initial/loadMore uses two 100-row cursor pages; prefetch,
  revert, and reconnect reload also request exactly 100. Cached legacy and old-
  server-missing-runtime initial remains 20, loadMore/prefetch remains 200, and
  legacy revert preserves its current `meta.limit` rule. Cold uncached V2,
  legacy, and old-server Session loads fetch/normalize metadata before requesting
  the corresponding transcript limit; cold mixed, malformed/unresolved, and
  metadata-failure fixtures issue no transcript request. Cold prefetch follows
  the same ordering with V2 100, legacy/old-server 200, and mixed none; metadata
  and transcript are never concurrent and the layout callsite needs no change;
- an old message load latched before `authoritativeReload` cannot block the
  fresh newest-100 request even while `meta.loading` is true. Fresh completion
  wins when the old result arrives later, and old `finally` both before and
  after the fresh completion can neither clear the new token's loading state nor
  leave loading stuck. A message/part update, removal, and delta delivered after
  the fresh request but before its response is journaled by the new
  `MessageLoadState`; `reconcileFetched` preserves each live change over stale
  response bytes;
- an old metadata GET returning staged revert state is latched before reconnect;
  `authoritativeResolve` supersedes it, applies the fresh absent-revert Session
  and rows, and the old result plus `finally` in either order cannot remember or
  clear the fresh request owner. The same token rule covers validated retained
  descendants. Separate fresh-GET races deliver a newer valid live created/
  updated event or a live deleted event before the HTTP response; the event
  advances only its Session info revision, retires the request token, preserves
  runtime/title/location/parent/revert, and prevents response/finally from
  overwriting or resurrecting it;
- V2 prompt failure does not force idle, while legacy behavior stays unchanged;
- `resume:false` admits V2 without wake and legacy rejects it before effects;
- false→true same-ID retry reconciles the existing admission then advisory-wakes
  once, while true→false reconciles without a new wake and cannot retract the
  earlier wake;
- failed queue/steer during an already-busy drain preserves busy, and Canvas
  with no route ID uses the bound Session for interrupt/existing-session logic;
- incompatible controls owned by the bound Session surface, its
  `use-session-commands` palette, and MessageTimeline are absent/disabled, and
  direct forced server routes have zero durable/plugin/filesystem/provider
  effects. Global sidebar/layout/deep-link/stale callers are not a universal
  zero-network promise; they may make one request that receives the same fixed
  content-free conflict before effects;
- fresh OperatingChat, MasterAgent, and ChatRelay bindings report V2, render
  through the same compatible stores, and keep their own profile/policy;
  Core ensure configures an existing V2 but returns empty/populated legacy and
  mixed bindings unchanged with zero V2 configure/adopt/event. The real App
   OperatingChat runtime registration resolves that unchanged ensure response;
   legacy then loads its transcript, while mixed presents diagnostic metadata and
   issues no transcript, status, Todo, or interaction request;
  ChatRelay with absent stored agent/model completes one provider turn through
  existing agent/model default resolution and converges its presentation on
  Step.Started; existing legacy fixtures remain legacy;
- raw compatible list/get/event payloads cross the narrow pinned
  SessionInfo/SessionApi adapter with validated runtime into the regenerated
  workspace Session type, malformed runtime fails closed, and an old-server
  missing field is classified only as legacy. Raw `session.created` and
  `session.updated` exercise `ServerSession.apply` itself: both decode before
  `remember`, missing runtime becomes legacy, and malformed runtime does not
  mutate the existing Session store;
- manual approval, auto approval, question reply/reject, child interaction,
  Session-scoped busy/idle recovery, and reconnect pending recovery use
  Session-scoped paths;
- `GET /session/:sessionID/todo` returns the same Schema-valid Todo rows for
  legacy and V2 after runtime resolution, mixed receives the fixed quarantine
  error, and a bound busy V2 Session populates the existing App Todo dock without
  adding a Todo mutation or a second store;
- PermissionV2 scoped-list and asked-event projection use the same pure mapper,
  and actual legacy Request encoding succeeds with every optional field absent
  and with a tool source;
- QuestionV2 scoped-list and asked-event projection use the same pure mapper;
  valid legacy tool provenance encodes, while a current tool message ID invalid
  for `SessionV1.MessageID` is omitted content-free and the Request still
  Schema-encodes;
- stale pending snapshots cannot resurrect resolved requests;
- reload discovers more than one page of never-preseeded children through the
  bounded routed V2 child-page endpoint before installing pending approval/
  question state; page/total/depth/cycle overflow is explicit incomplete and
  fails closed. A huge title/location cannot exceed 256 KiB or cause a partial
  page/pending-state claim, while legacy raw `/children` bytes are unchanged;
- per-Session summary-revision CAS refreshes an unchanged stale cached child,
  while snapshot-before-event, event-before-snapshot, and delete-during-page
  races preserve the live runtime, title, location, parent, and revert summary
  and never resurrect a deleted child;
- independent `(sessionID, family)` revisions let same-child permission and
  question snapshots race without suppressing one another, and status-versus-
  summary races preserve both authorities;
- a complete reconnect crawl forgets a missed deleted descendant and clears its
  scoped state/aliases, an incomplete crawl preserves every cached descendant,
  and a concurrent live update defeats absence cleanup through the revision CAS;
- on `server.connected`, a pinned V2 root resolves and atomically reloads newest
  100 before lineage; a permanent oversized/cyclic/incomplete child crawl plus a
  missed root Revert.Committed still repairs the root while preserving uncertain
  descendant cache;
- a local Canvas root absent from initial coordinator-local bootstrap is recovered
  when its bound `session.sync` resolves, and reconnect refreshes its busy state
  plus never-preseeded child pending requests without duplicating calls;
- current message/tool/status legacy events drive the existing timeline;
- completed tool files from attachment and content arrays preserve first-seen
  canonical tuple order, dedupe cross-origin duplicates, keep stable nested IDs
  across reload/duplicate replay, and remove stale files on full-upsert shrink;
- actual runner interruption maps only exact `Provider turn interrupted` to
  `MessageAbortedError`; near-miss/current unknown messages remain
  `UnknownError`, and ToolStateError exposes `state.error.message` byte-for-byte
  in list, full-upsert, and live-event projections, including empty string.
  Timed and missing-time current reasoning map respectively to their own created
  time and the enclosing Assistant created time, with optional completion, and
  both pass the actual `SessionV1.WithParts` Schema encoder;
- Synthetic/System/Shell/Compaction create no compatibility timeline rows,
  text/reasoning deltas stream under deterministic part IDs, tool-input deltas
  are intentionally absent, and the next durable tool event converges by full
  upsert;
- staged/cleared and staged/committed revert transitions reload exact rows, and
  a late pre-reload page cannot republish the old suffix. On real
  `server.connected` resolve/remember, missed Cleared, missed Committed with a
  cached staged marker, and missed Staged+Committed with cached absent all
  invalidate the old generation and atomically reload at most 100 rows for the
  root and validated descendants. With 250 rows loaded, revert produces one
  exact fresh newest-first window of at most 100 and older surviving history
  loads only through its new cursor; and
- generic legacy surfaces retain their existing controls, global pending lists,
  transcript, and compatible routing.

Run from `packages/app`:

~~~powershell
bun test --conditions=solid --isolate --preload ./happydom.ts src/utils/server-compat.test.ts src/utils/session.test.ts src/components/prompt-input/build-request-parts.test.ts src/components/prompt-input/submit.test.ts src/components/prompt-input-v2.test.tsx src/context/global-sync/bootstrap.test.ts src/context/global-sync/session-load.test.ts src/context/global-sync/home-session-index.test.ts src/context/server-sync.test.ts src/context/permission.test.tsx src/context/server-session.test.ts src/pages/session/composer/session-composer-controls.test.ts src/pages/session/use-session-commands.test.tsx src/pages/session/timeline/message-timeline.test.tsx src/pages/canvas/runtime/registrations/operating-chat.test.ts
bun test --conditions=browser --isolate --preload ./happydom.ts src/pages/session-surface-base.browser.test.tsx src/pages/canvas/operating-chat.browser.test.tsx src/pages/canvas/master-agent/block.browser.test.tsx src/pages/canvas/blocks/chat-relay/view.browser.test.tsx
bun typecheck
~~~

#### Step 6: Generate, verify, and commit the atomic cutover

After public Schema/OpenCode HttpApi changes, record a PRE-STAGE inventory and
confirm only Task 2G paths are present. The repository's generated check expects
the intended generator output staged, so use the serial order generate -> stage
only that generator's owned trees -> check; never hand-edit generated files.

~~~powershell
Set-Location packages/client
bun run generate
Set-Location ../..
git status --short
git diff --name-only
git add packages/client/src/generated packages/client/src/generated-effect
Set-Location packages/client
bun run check:generated
bun test
bun typecheck
Set-Location ../..
./packages/sdk/js/script/build.ts
git add packages/sdk/js/src/gen packages/sdk/js/src/v2/gen
Set-Location packages/sdk/js
bun test
bun typecheck
Set-Location ../../server
bun test test
bun typecheck
Set-Location ../opencode
bun typecheck
Set-Location ../..
~~~

Then rerun the focused Schema/Core/OpenCode/App commands above, plus:

~~~powershell
Set-Location packages/schema
bun test
bun typecheck
Set-Location ../core
bun test test/session-ctxpack-admission.test.ts test/session-ctxpack-promotion.test.ts
bun test test/session-runtime.test.ts test/session-process-role.test.ts test/session-create.test.ts
bun test test/session-runner.test.ts test/session-subagent-runner.test.ts test/session-compaction.test.ts test/session-run-coordinator.test.ts test/session-execution-local.test.ts test/move-session.test.ts
bun test test/tool-task-batch.test.ts test/session-todo.test.ts
bun test test/workspace/service.test.ts test/workspace/functionality-instance.test.ts test/ctxpack-service.test.ts test/ctxpack-sql.test.ts test/ctxpack-materialize.test.ts test/ctxpack-usage.test.ts test/context-broker-capsule.test.ts test/capability-service.test.ts
bun test test/permission.test.ts test/question.test.ts
bun test test/integration/master-agent-session.test.ts test/workspace/chat-relay-session.test.ts
bun test
bun typecheck
Set-Location ../server
bun test test/middleware/authorization.test.ts test/middleware/schema-error.test.ts test/session-private-http.test.ts test/session-local-readiness.test.ts
bun test test/operating-chat-handler.test.ts test/handlers/workspace-master-agent.test.ts test/handlers/chat-relay-session.test.ts
bun test
bun typecheck
Set-Location ../opencode
bun test test/session/session-v2-compat.test.ts test/session/session.test.ts test/session/session-schema.test.ts test/session/schema-decoding.test.ts test/session/prompt.test.ts test/session/revert-compact.test.ts test/session/compaction.test.ts test/share/share-next.test.ts test/permission/next.test.ts test/question/question.test.ts test/control-plane/workspace.test.ts test/project/project.test.ts test/project/migrate-global.test.ts test/session/todo.test.ts test/event-v2-bridge.test.ts
bun test test/effect/session-context-location-map.test.ts test/server/httpapi-authorization.test.ts test/server/httpapi-v2-local-only.test.ts test/server/httpapi-workspace.test.ts test/server/httpapi-workspace-routing.test.ts test/server/workspace-routing.test.ts test/server/httpapi-sync.test.ts
bun run test:httpapi
Set-Location ../app
bun run test:unit
bun run test:browser
bun run build
$env:PLAYWRIGHT_WORKERS = "1"
bun run test:bench
Set-Location ../..
git diff --check
git status --short
~~~

Inspect generated diffs. They may contain the runtime discriminator, extended
legacy prompt payload, Session-scoped compatibility interaction routes, and the
already-existing status definitions newly admitted to the server manifest.
They must not contain private sidecar/proof values.

Record the benchmark JSON as the Task 2G after result and compare the identical
scenario/metric set with Task 2F's serial baseline. Require every scenario to
finish and investigate/explain a material regression before staging; do not turn
host-dependent timing into a hard threshold.

This migration is forward-only as soon as classification finds any `v2`/`mixed`
row or the new runtime creates one. An old binary would route those rows through
legacy services and is not a safe code-only rollback. Operational rollback must
stop writers and restore a verified pre-migration database backup, or explicitly
drop/recreate the database when data loss is acceptable. Only a database proven
all-legacy with no V2 mutation may run an older binary that ignores the extra
defaulted column. Never rewrite V2/mixed rows to legacy as rollback.

Because enforcement and compatibility must activate atomically, stage exactly
one Task 2G commit after every gate is green. Replace the migration placeholder
below with the single filename printed by the generator; do not stage the whole
migration directory:

~~~powershell
git add packages/schema/src/session-runtime.ts packages/schema/src/session-compatibility.ts packages/schema/src/index.ts packages/schema/src/session.ts packages/schema/src/v1/session.ts packages/schema/src/event-manifest.ts packages/schema/test/session-runtime.test.ts packages/schema/test/session-compatibility.test.ts packages/schema/test/event-manifest.test.ts packages/core/src/database/migration/<generated>_session-runtime.ts packages/core/src/database/migration.gen.ts packages/core/src/database/schema.gen.ts packages/core/schema.json packages/core/src/session/runtime.ts packages/core/src/session/sql.ts packages/core/src/session/info.ts packages/core/src/session/create.ts packages/core/src/session/projector.ts packages/core/src/session/store.ts packages/core/src/session.ts packages/core/src/session/input.ts packages/core/src/session/context-epoch.ts packages/core/src/session/compaction-context.ts packages/core/src/session/revert.ts packages/core/src/session/compaction.ts packages/core/src/session/runner/llm.ts packages/core/src/session/runner/index.ts packages/core/src/session/subagent-runner.ts packages/core/src/session/execution/local.ts packages/core/src/session/run-coordinator.ts packages/core/src/control-plane/move-session.ts packages/core/src/tool/task-batch.ts packages/core/src/workspace/operating-chat-session.ts packages/core/src/workspace/master-agent.ts packages/core/src/workspace/chat-relay-session.ts packages/core/test/database/session-runtime-migration.test.ts packages/core/test/session-runtime.test.ts packages/core/test/session-projector.test.ts packages/core/test/session-runner.test.ts packages/core/test/session-subagent-runner.test.ts packages/core/test/session-compaction.test.ts packages/core/test/session-run-coordinator.test.ts packages/core/test/session-execution-local.test.ts packages/core/test/move-session.test.ts packages/core/test/tool-task-batch.test.ts packages/core/test/session-todo.test.ts packages/core/test/operating-chat-session.test.ts packages/core/test/integration/master-agent-session.test.ts packages/core/test/workspace/chat-relay-session.test.ts packages/core/test/ctxpack-acceptance.test.ts packages/core/test/database-migration.test.ts packages/core/test/operating-chat-context.test.ts packages/core/test/permission.test.ts packages/core/test/session-create.test.ts packages/core/test/session-history.test.ts packages/core/test/session-prompt.test.ts packages/core/test/session-tool-progress.test.ts packages/core/test/session-ctxpack-admission.test.ts packages/core/test/session-ctxpack-promotion.test.ts packages/core/test/session-context-replay.test.ts packages/core/test/session-runner-recorded.test.ts packages/core/test/session-runner-system-context.test.ts packages/core/test/tool-task.test.ts packages/core/test/tool-todowrite.test.ts packages/core/test/workspace/master-agent.test.ts packages/opencode/src/session/session-v2-compat.ts packages/opencode/src/session/session.ts packages/opencode/src/session/prompt.ts packages/opencode/src/session/revert.ts packages/opencode/src/session/compaction.ts packages/opencode/src/session/summary.ts packages/opencode/src/share/session.ts packages/opencode/src/share/share-next.ts packages/opencode/src/control-plane/workspace.ts packages/opencode/src/cli/cmd/import.ts packages/opencode/src/event-v2-bridge.ts packages/opencode/src/server/shared/workspace-routing.ts packages/opencode/src/server/routes/instance/httpapi/groups/session.ts packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts packages/opencode/src/server/routes/instance/httpapi/groups/sync.ts packages/opencode/src/server/routes/instance/httpapi/handlers/sync.ts packages/opencode/src/server/routes/instance/httpapi/groups/workspace.ts packages/opencode/src/server/routes/instance/httpapi/groups/control-plane.ts packages/opencode/src/server/routes/instance/httpapi/handlers/control-plane.ts packages/opencode/src/server/routes/instance/httpapi/errors.ts packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts packages/opencode/src/server/routes/instance/httpapi/middleware/schema-error.ts packages/opencode/src/server/routes/instance/httpapi/server.ts packages/opencode/test/session/session-v2-compat.test.ts packages/opencode/test/session/session.test.ts packages/opencode/test/session/prompt.test.ts packages/opencode/test/session/revert-compact.test.ts packages/opencode/test/session/compaction.test.ts packages/opencode/test/share/share-next.test.ts packages/opencode/test/control-plane/workspace.test.ts packages/opencode/test/project/project.test.ts packages/opencode/test/project/migrate-global.test.ts packages/opencode/test/session/todo.test.ts packages/opencode/test/cli/import.test.ts packages/opencode/test/event-v2-bridge.test.ts packages/opencode/test/server/httpapi-session.test.ts packages/opencode/test/server/httpapi-sync.test.ts packages/opencode/test/server/httpapi-workspace.test.ts packages/opencode/test/server/httpapi-control-plane.test.ts packages/opencode/test/server/httpapi-workspace-routing.test.ts packages/opencode/test/server/workspace-routing.test.ts packages/app/src/utils/server-compat.ts packages/app/src/utils/server-compat.test.ts packages/app/src/utils/session.ts packages/app/src/utils/session.test.ts packages/app/src/components/prompt-input/build-request-parts.ts packages/app/src/components/prompt-input/build-request-parts.test.ts packages/app/src/components/prompt-input/submit.ts packages/app/src/components/prompt-input/submit.test.ts packages/app/src/context/global-sync/bootstrap.ts packages/app/src/context/global-sync/session-load.ts packages/app/src/context/global-sync/bootstrap.test.ts packages/app/src/context/global-sync/session-load.test.ts packages/app/src/context/server-sync.tsx packages/app/src/context/server-sync.test.ts packages/app/src/context/permission.tsx packages/app/src/context/permission.test.tsx packages/app/src/context/server-session.ts packages/app/src/context/server-session.test.ts packages/app/src/pages/session-surface-base.tsx packages/app/src/pages/session/use-session-commands.tsx packages/app/src/pages/session/timeline/message-timeline.tsx packages/app/src/pages/session-surface-base.browser.test.tsx packages/app/src/pages/session/use-session-commands.test.tsx packages/app/src/pages/session/timeline/message-timeline.test.tsx packages/app/src/pages/canvas/workspace.tsx packages/app/src/pages/canvas/operating-chat.browser.test.tsx packages/app/src/pages/canvas/master-agent/block.browser.test.tsx packages/app/src/pages/canvas/blocks/chat-relay/view.browser.test.tsx packages/client/src/generated packages/client/src/generated-effect packages/sdk/js/src/gen packages/sdk/js/src/v2/gen
git add packages/core/src/permission.ts packages/core/src/question.ts packages/core/test/question.test.ts
git add packages/core/src/session/process-role.ts packages/core/src/session/context-transfer-readiness.ts packages/core/test/session-process-role.test.ts
git add packages/core/src/session/todo.ts packages/core/src/workspace/service.ts packages/core/src/workspace/functionality-instance.ts packages/core/src/ctxpack/service.ts packages/core/src/ctxpack/sql.ts packages/core/src/ctxpack/materialize.ts packages/core/src/ctxpack/usage.ts packages/core/src/context-broker/capsule.ts packages/core/src/capability/service.ts packages/core/test/workspace/service.test.ts packages/core/test/workspace/functionality-instance.test.ts packages/core/test/ctxpack-service.test.ts packages/core/test/ctxpack-sql.test.ts packages/core/test/ctxpack-materialize.test.ts packages/core/test/ctxpack-usage.test.ts packages/core/test/context-broker-capsule.test.ts packages/core/test/capability-service.test.ts
git add packages/server/src/session-private-http.ts packages/server/src/auth.ts packages/server/src/routes.ts packages/server/src/handlers/session.ts packages/server/src/handlers/operating-chat.ts packages/server/src/handlers/workspace-master-agent.ts packages/server/src/handlers/chat-relay-session.ts packages/server/src/middleware/authorization.ts packages/server/src/middleware/schema-error.ts packages/server/test/session-private-http.test.ts packages/server/test/middleware/authorization.test.ts packages/server/test/middleware/schema-error.test.ts packages/server/test/session-local-readiness.test.ts packages/server/test/operating-chat-handler.test.ts packages/server/test/handlers/workspace-master-agent.test.ts packages/server/test/handlers/chat-relay-session.test.ts
git add packages/opencode/src/effect/session-context.ts packages/opencode/test/effect/session-context-location-map.test.ts packages/opencode/test/server/httpapi-authorization.test.ts packages/opencode/test/server/httpapi-v2-local-only.test.ts
git add packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts
git add packages/opencode/src/server/routes/instance/httpapi/handlers/workspace.ts
git add packages/opencode/src/server/routes/instance/httpapi/middleware/error.ts packages/opencode/test/server/httpapi-error-middleware.test.ts
git add packages/opencode/src/permission/index.ts packages/opencode/src/question/index.ts packages/opencode/test/permission/next.test.ts packages/opencode/test/question/question.test.ts
git add packages/opencode/src/session/todo.ts
git add packages/opencode/test/session/session-schema.test.ts packages/opencode/test/session/schema-decoding.test.ts packages/app/src/context/global-sync/home-session-index.ts packages/app/src/context/global-sync/home-session-index.test.ts
git add packages/app/src/components/prompt-input/contracts.ts packages/app/src/components/prompt-input.tsx packages/app/src/components/prompt-input-v2.tsx packages/app/src/components/prompt-input-v2.test.tsx packages/app/src/pages/session/composer/session-composer-controls.ts packages/app/src/pages/session/composer/session-composer-controls.test.ts packages/app/src/pages/session/use-composer-commands.tsx
git add packages/app/src/pages/canvas/runtime/registrations/operating-chat.test.ts
git commit -m "feat(session): enforce runtime compatibility"
~~~

Use `git diff --cached --name-only` before commit and compare it to this
inventory. Omit `session/runner/index.ts` only when its exported error surface is
unchanged; never stage unrelated concurrent work.

**Exit gate:** one non-null runtime authority prevents V1/V2 cross-writes;
fresh/unbound bindings create V2. OperatingChat and MasterAgent configure an
existing V2, ChatRelay returns it, and all three return existing legacy/mixed
bindings unchanged without V2 configure/adopt/reset conversion; legacy history
remains readable and mixed is diagnostic read-only through the real App registration; the existing App stores
legacy surface; authenticated local admission enriches, while open-listener
zero-attachment admission is clean and open-listener nonempty context remains
content-free unavailable with zero effect. Remote V2 fails at the route boundary.
Managed-child compatible/current HTTP and direct Session/Workspace/binding/
CtxPack/capsule/capability/Todo mutations reject before payload/effects while
legacy stays unchanged. Both Workspace removal services reject unconditionally
before lookup/prewalk/effects, while protected recursive Session-tree deletion
is atomic, and prefix-based legacy `GET /session` routing is unchanged.
Unsupported mutations fail closed; runtime migration/guards,
local readiness, and the adapter are in the same commit; there
is one SSE and no App-local V2 controller/store/registry or broad raw V2 router.
This checkpoint supports one coordinator process per database; managed V2
clustering remains unsupported.


## Wave 3 integration review

After Tasks 3A, 3B, and 2G are green, verify that exact replay and private
compaction remain local database features. Durable-wire and full ordinary-live
classification must still quarantine V2/mixed and forbidden current-on-legacy
Session records, every Remote V2 request must still fail before
proxy/effects, and no projection-transfer, placement, proof, lease, spool, or
worker-auth surface may have appeared. Do not deploy a second coordinator
against the same database. Task 2G's atomic commit is the only step that
replaces not-ready with authenticated local readiness.

## Wave 4: end-to-end proof, cleanup, and status documentation

Wave 4 starts only after Tasks 2D, 2E, 2F, 2G, 3A, and 3B are integrated and green.
Run 4A, then 4B, then 4C in one integration worktree. Task 4A may expose a
production design gap, so do not run cleanup or documentation edits in parallel
with it. Any production correction returns to RED/GREEN review before 4B.

### Task 4A: Add a real OperatingChat assembly integration test

**Files:**

- Create: `packages/core/test/operating-chat-context-assembly.test.ts`
- Modify production only if the failing test proves a design gap

**Transport assumption:** this Core test begins below HTTP and is not evidence
that the browser uses the SessionV2 lifecycle. Before running it, rerun Task
2G's production browser compatibility and local-authority routing tests. Require
proof that OperatingChat uses only the
existing `/session/:sessionID/*` compatible endpoints; runtime-v2 prompt,
interrupt, message/status reload, and root/child permission/question operations
dispatch to SessionV2 in the combined process, while unsupported mutations are
hidden/fail closed. The authenticated local user reaches enriched admission;
Remote and managed-child V2 paths fail before effects, and no request falls back
to a legacy runtime writer or target HTTP.
Current live/durable events must project once at OpenCode into the existing
legacy App vocabulary/stores over one stream; duplicate durable full upserts
converge, transient deltas are not replayed, whole-chain `session.status` and
scoped status/pending snapshots recover reconnect state. Do not replace either
transport test with a direct Core call or count this fixture as the browser gate.

Use an on-disk temporary SQLite database and real Core services. Exercise:

1. create one workspace with two OperatingChat blocks and CtxPacks;
2. ensure both bindings and materialize one explicit capsule against each real
   functionality-instance target;
3. admit the same non-trivial text to both sessions with different authorized
   context;
4. prove distinct real functionality-instance targets;
5. run one captured provider turn and inspect system baseline + exact user
   `apiContent`;
6. force compaction, prove its public event is clean and its private sidecar
   contains the enriched checkpoint;
7. reopen a fresh service stack over the same database;
8. submit the next turn and prove exact historical/private-checkpoint replay
   without a second
   recall for the first message;
9. retry the first message ID and prove no duplicate admission/search/provider
   call;
10. change explicit attachments on that ID and prove conflict;
11. verify public messages remain clean;
12. verify automatic selection created no ContextCapsule row; and
13. verify layout JSON and durable event payloads contain no fragment text; and
14. use an explicit workspace metadata value and temporary coordinator-visible
    directory, then prove provider/tools use that directory with zero target HTTP.

Run:

```powershell
Set-Location packages/app
bun test --conditions=browser --isolate --preload ./happydom.ts src/pages/canvas/operating-chat.browser.test.tsx
Set-Location ../opencode
bun test test/server/httpapi-v2-local-only.test.ts
Set-Location ../core
bun test test/operating-chat-context-assembly.test.ts
Set-Location ../..
```

Commit only after the test is green:

```powershell
git add packages/core/test/operating-chat-context-assembly.test.ts
git commit -m "test(core): verify operating chat context recovery"
```

### Task 4B: Remove the abandoned browser OperatingContext stack

**Files:**

- Delete: `packages/app/src/pages/canvas/editor/operating-context.ts`
- Delete: `packages/app/src/pages/canvas/editor/operating-context.test.ts`

First prove zero production imports:

```powershell
rg -n "operating-context|OperatingContext|HistoricalContextStack" packages/app/src --glob "*.ts" --glob "*.tsx"
```

Only the dead module and its own test may remain. Delete both, then run from
the worktree root:

```powershell
Set-Location packages/app
bun run test:unit
bun typecheck
Set-Location ../..
```

Commit:

```powershell
git add packages/app/src/pages/canvas/editor/operating-context.ts packages/app/src/pages/canvas/editor/operating-context.test.ts
git commit -m "refactor(app): remove obsolete context stack"
```

Do not add a browser-owned durable context or runtime authority. OperatingChat
continues to use `CanvasSessionSurface`, its Task 2F internal target projection,
the existing CompatibleApi and `ServerSession` stores, and the server-owned
runtime-aware Session adapter. There is one App transcript/status/interaction
path and one event stream; no current-Session controller, provenance registry,
or generated-V2 browser path is introduced.

### Task 4C: Update implementation status after code lands

**Files:**

- Modify: `docs/superpowers/specs/2026-08-25-operating-chat-context-assembly-design.md`
- Modify: `docs/superpowers/plans/2026-08-25-operating-chat-context-assembly.md`
- Modify: `specs/2026-08-25-operating-chat-context-assembly.md`
- Modify: `specs/workspace-canvas/architecture.md`
- Modify: `specs/workspace-canvas/functionality-subsystem-management-architecture.md`
- Modify: `specs/workspace-canvas/requirements.md`
- Modify: `specs/backend/cybermaster-host-manager-future-plan.md`
- Modify: `specs/relay/chat-relay-session-migration.md`
- Modify: `specs/v2/session.md`
- Modify: `docs/superpowers/plans/2026-08-22-operating-agent-v1.md`
- Modify: `PseudoBlock/ChatRelay/README.md`
- Modify: `devplan/workspace-canvas/ProgressionReport.md`
- Modify: `CONTEXT.md`

Change only status/evidence statements that the final current-tree tests prove.
Record commit IDs and verification results. Do not rewrite historical baseline
records as if the feature had existed earlier. Mechanically resync the root plan
copy from this canonical plan, restore only its intentional relative design
link, and inspect the no-index diff below; that one link hunk must be the entire
diff before staging.

Commit:

```powershell
git diff --no-index -- specs/2026-08-25-operating-chat-context-assembly.md docs/superpowers/plans/2026-08-25-operating-chat-context-assembly.md
git add docs/superpowers/specs/2026-08-25-operating-chat-context-assembly-design.md docs/superpowers/plans/2026-08-25-operating-chat-context-assembly.md specs/2026-08-25-operating-chat-context-assembly.md specs/workspace-canvas/architecture.md specs/workspace-canvas/functionality-subsystem-management-architecture.md specs/workspace-canvas/requirements.md specs/backend/cybermaster-host-manager-future-plan.md specs/relay/chat-relay-session-migration.md specs/v2/session.md docs/superpowers/plans/2026-08-22-operating-agent-v1.md PseudoBlock/ChatRelay/README.md devplan/workspace-canvas/ProgressionReport.md CONTEXT.md
git commit -m "docs: record operating chat context assembly"
```

## Final verification matrix

Run tests only from their package directories.

### Schema

```powershell
bun test test/session-runtime.test.ts test/session-compatibility.test.ts test/event-manifest.test.ts
bun test
bun typecheck
```

### Core focused

```powershell
bun test test/session-context-sidecar.test.ts test/session-ctxpack-admission.test.ts test/session-ctxpack-promotion.test.ts
bun test test/ctxpack-recall.test.ts test/ctxpack-search.test.ts test/ctxpack-materialize.test.ts
bun test test/operating-chat-context.test.ts test/operating-chat-session.test.ts test/integration/master-agent-session.test.ts test/workspace/chat-relay-session.test.ts
bun test test/system-context/index.test.ts test/system-context/registry.test.ts test/session-runner-system-context.test.ts
bun test test/session-runtime.test.ts test/session-process-role.test.ts test/session-projector.test.ts test/session-create.test.ts
bun test test/session-runner.test.ts test/session-subagent-runner.test.ts test/session-compaction.test.ts
bun test test/session-run-coordinator.test.ts test/session-execution-local.test.ts
bun test test/session-todo.test.ts test/permission.test.ts test/question.test.ts test/tool-task.test.ts test/tool-task-batch.test.ts
bun test test/workspace/service.test.ts test/workspace/functionality-instance.test.ts
bun test test/ctxpack-service.test.ts test/ctxpack-sql.test.ts test/ctxpack-materialize.test.ts test/ctxpack-usage.test.ts test/context-broker-capsule.test.ts test/capability-service.test.ts
bun test test/move-session.test.ts
bun test test/database/session-runtime-migration.test.ts test/database/session-message-context-migration.test.ts test/database-migration.test.ts
bun run migration --check
bun test test/operating-chat-context-assembly.test.ts
bun typecheck
```

Then run the full Core suite:

```powershell
bun test
```

Classify pre-existing platform failures against Wave 0. Do not weaken focused
tests to accommodate unrelated failures.

### Server

```powershell
bun test test/middleware/authorization.test.ts test/middleware/schema-error.test.ts test/session-private-http.test.ts test/session-local-readiness.test.ts
bun test
bun typecheck
```

### OpenCode composition

```powershell
bun test test/session/session-v2-compat.test.ts test/session/session.test.ts test/session/prompt.test.ts test/session/revert-compact.test.ts test/session/compaction.test.ts test/share/share-next.test.ts test/session/todo.test.ts
bun test test/permission/next.test.ts test/question/question.test.ts test/cli/import.test.ts test/event-v2-bridge.test.ts
bun test test/control-plane/workspace.test.ts test/project/project.test.ts test/project/migrate-global.test.ts
bun test test/effect/session-context-location-map.test.ts
bun test test/server/httpapi-authorization.test.ts test/server/httpapi-session.test.ts test/server/httpapi-sync.test.ts test/server/httpapi-workspace.test.ts test/server/httpapi-control-plane.test.ts
bun test test/server/httpapi-v2-local-only.test.ts test/server/httpapi-workspace-routing.test.ts test/server/workspace-routing.test.ts test/server/httpapi-error-middleware.test.ts
bun run test:httpapi
bun typecheck
```

Run the full OpenCode test/build matrix only when required by touched
composition or release policy; record known Windows/platform limitations
honestly.

### Generated Promise/Effect client

```powershell
bun run check:generated
bun test
bun typecheck
```

### Legacy JavaScript SDK regeneration

From the repository root:

```powershell
./packages/sdk/js/script/build.ts
```

Then from `packages/sdk/js`:

```powershell
bun test
bun typecheck
```

### App surface and cleanup

```powershell
bun test --conditions=solid --isolate --preload ./happydom.ts src/pages/canvas/session-target.test.tsx src/utils/session.test.ts src/utils/server-compat.test.ts src/components/prompt-input/build-request-parts.test.ts src/components/prompt-input/submit.test.ts src/components/prompt-input-v2.test.tsx src/context/global-sync/bootstrap.test.ts src/context/global-sync/session-load.test.ts src/context/global-sync/home-session-index.test.ts src/context/server-sync.test.ts src/context/permission.test.tsx src/context/server-session.test.ts src/pages/session/composer/session-composer-controls.test.ts src/pages/session/use-session-commands.test.tsx src/pages/session/timeline/message-timeline.test.tsx
bun test --conditions=browser --isolate --preload ./happydom.ts src/pages/canvas/session-surface.browser.test.tsx src/pages/session-surface-base.browser.test.tsx src/pages/canvas/operating-chat.browser.test.tsx src/pages/canvas/master-agent/block.browser.test.tsx src/pages/canvas/blocks/chat-relay/view.browser.test.tsx
bun run test:unit
bun run test:browser
bun typecheck
bun run build
```

Task 2F's serial production benchmark baseline and Task 2G's after report remain
mandatory App evidence.

### Static boundary checks

From the repository root:

```powershell
rg -n "session_context_target|MEMORY\.md|USER\.md|SOUL\.md" packages
rg -n "OperatingContext|HistoricalContextStack" packages/app/src
rg -n "v1-composer|v2-composer" packages/app/src/components packages/app/src/pages
rg -n "sessionMutationMode|SessionV2MutationPort|ServerEvent\.v2|SESSION_V2_INTERACTION_PROVENANCE|current-session-message|current-session-projection|session-v2-surface" packages/app/src
rg -n "SessionRuntime\.require|SessionProcessRole|runtime" packages/core/src/session packages/core/src/workspace packages/core/src/ctxpack packages/core/src/context-broker packages/core/src/capability packages/opencode/src/session packages/opencode/src/cli/cmd/import.ts
rg -n "apiContent|contextRequestHash|operating-chat-v1|model_context_json" packages/schema packages/core
rg -n "collectCurrentWorkspaceSelectors|SessionsCursor\.parse|MAX_PRIVATE_PROMPT_HTTP_BODY_BYTES" packages/opencode/src packages/server/src
rg -n "SessionV1\.Event\.Definitions\.filter|definition\.durable|SessionEvent\.(DurableDefinitions|Definitions)|session\.error|message\.part\.delta|AgentSwitched|session\.created\.1|replayAll" packages/schema/src/event-manifest.ts packages/opencode/src/event-v2-bridge.ts packages/opencode/src/control-plane/workspace.ts packages/opencode/src/server/routes/instance/httpapi/handlers/sync.ts
rg -n "SessionProjectionTransfer|workspace_placement_route|RequestProof|placement fence|private spool" packages
rg -n "managedNotReadyNode" packages/core/src packages/server/src packages/opencode/src
git diff 1374764640c4be02a56eb2156a97b54d272fbe81..HEAD --check
git status --short
```

Expected results:

- no target table, Hermes memory-file implementation, browser OperatingContext,
  App V2 controller/store/registry, second event stream, or broad raw V2 router;
- the runtime adapter is the only compatible V1/V2 dispatch boundary;
- authenticated local authority is explicit, Remote V2 and every managed-child
  current mutation surface are rejected, and legacy services/routing stay unchanged;
- current selector authority is endpoint-specific: active is unscoped-only,
  pending requires mounted deep/header authority when scoped and never flat-only,
  and Session list retains its distinct flat/cursor contract;
  create/adopt uses one bounded mounted-Schema decode, never treats body location
  as a proxy selector, and validates local collision/location authority before writes;
- Core and control-plane Workspace removal remain unconditional first-operation
  conflicts for every workspace/runtime shape; only direct recursive legacy
  Session deletion performs the separate descendant prewalk;
- exact durable-wire and full ordinary-live classifiers guard source and target;
  durable V1 is filtered by the existing `definition.durable` convention,
  non-durable V1 never replays, sessionless V1 Error is the only row-free live
  exception, replay/catch-up preflights atomically, and no private transfer/
  placement/proof/spool implementation exists;
- no production `managedNotReadyNode` remains; readiness names state local/open/
  managed-denied behavior directly;
- private payload fields exist only in Schema/Core private context paths;
- generated diffs are generator-owned and limited to runtime/compatible Session,
  status, and bounded descendant-recovery shapes; and
- only intended implementation/documentation files differ.

## Manual smoke

1. Start combined `opencode web` with no configured Basic credentials. Ensure a
   fresh local OperatingChat binding reports `runtime=v2`. Send one
   zero-attachment prompt and confirm it runs clean with no recall; a nonempty
   attachment returns the fixed unavailable error with zero admission/sidecar.
2. Restart with `OPENCODE_SERVER_USERNAME=context-smoke-user` and a nonempty
   `OPENCODE_SERVER_PASSWORD`; reconnect using those exact credentials.
3. Drop an explicit CtxPack into OperatingChat, send a non-trivial prompt, and
   confirm `/session/:sessionID/prompt_async` carries message ID, delivery,
   resume/context attachments but no userID or per-turn model/agent/variant.
   Confirm the authenticated local actor can commit the sidecar and automatic
   recall runs.
4. Confirm optimism, streaming, tools, busy/idle, permissions, questions, Todo,
   and reconnect recovery use the existing App stores and one SSE.
5. Use an explicit workspace metadata value whose Session directory is visible
   to the coordinator. Confirm provider/tools run in that directory and capture
   zero target-host HTTP.
6. Use literal generated-client URLs for active, permission/question pending,
   Session list continuation, Session-ID, and all three built-in routes. Active
   accepts only unscoped input: every flat/deep/header spelling rejects for Local
   and Remote. Pending accepts unscoped, deep-only, header-only, matching
   flat+deep/flat+header, or all three matching; flat-only, disagreement,
   duplicates, and Remote authority
   reach no handler. Session list keeps its distinct flat/cursor behavior.
   Inject an
   unexpected private sentinel defect into current POST
   `/api/session/:sessionID/prompt`; response/logs contain only the fixed code and
   correlation while an ordinary route retains diagnostics.
7. Exercise POST `/api/session`: existing Local V2 with omitted/exact location,
   absent supplied ID with zero remote targets, and omitted ID create/adopt
   locally. Query/header selectors, existing legacy/mixed/Remote, mismatched or
   inaccessible location, Remote-valued metadata, and an unknown supplied ID
   when any remote target exists all reject after the one bounded decode but
   before Session/Event/filesystem/provider or target HTTP.
8. Start a managed-child-role fixture and enumerate the mounted current Api:
   every `/api` method/path must fail auth-first without reading its body, while
   legacy routes and `/global/health` remain unchanged. Then call the compatible
   V2 mutation matrix plus direct SessionV2, WorkspaceV2,
   FunctionalityInstance/binding, CtxPack service/SQL/materializer/usage,
   ContextCapsule, write/execute Capability, Todo, permission/question, and
   execution paths. Confirm rejection before payload decode and zero row/event/
   FTS/file/provider/pending/grant effects; legacy calls remain unchanged.
9. Open existing legacy and mixed bindings. Legacy remains byte-compatible and
   readable; mixed exposes only metadata and issues no status/Todo/transcript/
   interaction request. A fresh Remote built-in ensure creates nothing.
10. Attempt source history/live and target replay/history-catch-up/live sync with
   durable V1, forged V1 PartDelta/Diff/Error history, sessionless and bound live
   Error, current metadata exceptions, forbidden current prompt/tool/revert,
   transient deltas, `[Created, V1 PartDelta]`, exact/divergent IDs, unknown,
   V2, mixed, and mismatched records plus a non-Session control. Only the exact
   allowlist passes; invalid batches write nothing and quarantine reaches no
   projector/GlobalBus/execution effect. Then
   attempt both Workspace removal services,
   a legacy-root deletion with a nested V2 child, and all three warp/move/steal
   paths. Sync is quarantined. Both Workspace removals reject unconditionally
   before even authority lookup/prewalk for legacy, V2, mixed, empty, or bound
   workspaces, with rows/bindings/adapter/worktree untouched. Direct recursive
   Session deletion prewalks and rejects the protected tree atomically;
   warp/move/steal reject before effects.
11. Reopen the same SQLite database and prove exact historical sidecar/private
    compaction replay. A whole-database backup/restore retains it; Event/history/
    live sync contains no private bytes.

## Non-negotiable acceptance gates

| Gate | Required result |
| --- | --- |
| One runtime per Session | V2 uses SessionV2, legacy uses legacy services, and mixed is metadata-only quarantine |
| Local authority | Authenticated combined OpenCode and standalone Server use local `v2-enriched`; open actorless requests are clean-only; managed-child auth-first denies all `/api` routes and direct role guards reject Session/Workspace/binding/CtxPack/capsule/capability/Todo mutations before effects while legacy and `/global/health` remain unchanged |
| Routing honesty | V2/mixed Local executes only in the combined process; true Remote fails before body/handler/proxy/target HTTP where identity is path/query-known; only typed NotFound may select fallback; active is strictly unscoped, scoped pending requires deep/header mounted authority with optional matching flat corroboration, Session list retains flat/cursor semantics, and all duplicate/conflicting authority rejects; legacy/missing routing, including prefix `GET /session`, is byte-exact |
| Current/binding guard | Remote current Session and OperatingChat/MasterAgent/ChatRelay GET/ensure/reset fail before local effects; fresh Remote bindings create nothing; each binding handler maps Core runtime/role/conversion errors to its existing fixed content-free Protocol conflict; POST `/api/session` rejects query/header selectors, decodes once under 16 MiB, treats body location only as local metadata, adopts only a matching-location Local V2 row, permits an absent supplied ID only with zero remote targets, resolves coordinator Location before writes, and never proxies |
| Private error boundary | Compatible prompt routes and current POST `/api/session/:sessionID/prompt` share the exact single-decoded private matcher; unexpected failures log/return only fixed code plus safe correlation, never defect/Cause/body/private fields; ordinary diagnostics remain unchanged |
| Directory semantics | Explicit workspace remains metadata; coordinator-visible Session.directory drives Location-scoped provider/tools with zero target HTTP |
| Sync quarantine | Durable wire filters V1 definitions by `durable !== undefined` and adds current durable definitions; V1 PartDelta/Diff/Error never replay or leave history, while ordinary live allows them only on legacy except sessionless Error, the sole byte-exact row-free runtime-neutral case; V2/mixed raw always quarantine, current-on-legacy allows only AgentSwitched/ModelSwitched/Moved, and invalid preflight tails reach no projector/GlobalBus/execution |
| Removal/move | Core and control-plane Workspace removal reject unconditionally as their first operation for every workspace/runtime shape, with no lookup/prewalk/cascade/adapter/worktree effect; direct recursive legacy Session deletion separately prewalks the full descendant tree and rejects atomically on any V2/mixed row; Core move, legacy warp, and sync steal reject first-operation |
| Stable prefix | Context Epoch is byte-stable across turns/restart; agent/profile changes replace the private epoch and never enter public ContextUpdated |
| Exact replay | Historical V2 user apiContent and private compaction lower identically after restart |
| Clean transcript | Visible messages/checkpoints/events contain no recalled fragments |
| First-admission recall | Exact retry performs no recall/materialization and changed explicit identity/hash/label conflicts |
| Bounded selection | Explicit-first, max 4 automatic, max 8 combined, fixed byte/token budget |
| Sidecar integrity | Strict input/compaction decoders recompute and verify canonical hashes, lengths, and token estimates |
| App boundary | One CompatibleApi, ServerSession store family, and SSE; V2 uses bound Session ID, stable optimism, scoped recovery, and no optimistic status |
| Status lifecycle | Global `/session/status` remains legacy-only; V2 status comes only from the scoped route/events, with one busy/idle pair around the complete coalesced local coordinator chain without flicker |
| Runtime-aware loading | Missing wire runtime means legacy; mixed reads no transcript/status/Todo/interactions; capped reload/reconnect is token/revision/live-event safe |
| Forward-only migration | Any V2/mixed row forbids code-only downgrade; restore a verified pre-migration DB or recreate it |
| Surface restraint | No new user-facing prompt authority, private sync protocol, remote V2 router, proof, lease, placement fence, spool, or clustered execution owner |
| One provider turn | Existing single explicit `llm.stream(request)` invariant remains |

## Rollback

Runtime activation is forward-only for a live database:

1. Take and verify a database backup before migration.
2. If migration classifies or later creates any V2/mixed row, never deploy an old
   binary against that database and never relabel it. Operational downgrade
   stops writers and restores the verified pre-migration backup or deliberately
   recreates the database.
3. A feature-off rollback may disable automatic recall and reject new enriched
   context, but it must retain runtime-aware compatibility readers, process-role/
   endpoint-selector/create authority, the exact private-route defect matcher,
   exact source/target sync guards, both unconditional Workspace-removal
   conflicts, sidecar decoders, and clean local V2 presentation while any
   V2/mixed row exists.
4. Do not delete or rewrite Session inputs/messages/sidecars, CtxPacks,
   Functionality bindings, or Context Epochs. Do not restore the browser
   OperatingContext stack.
5. Any public HttpApi rollback regenerates Promise/Effect clients and both legacy
   JavaScript SDK trees.

Rollback cannot undo already produced provider/tool effects. Test feature-off
local readability and the operational backup-restore procedure; code-only
managed fallback is not acceptance evidence.

## Explicit deferrals

- managed SessionV2 clustering, execution ownership, HA, and durable provider
  attempt recovery;
- private projection/binding/CtxPack transfer or repair across processes;
- distributed readiness/proofs/leases/topology/placement fencing/spools/cursors;
- remote OperatingChat/MasterAgent/ChatRelay binding transactions;
- generic workspace-proxy redirect/header/query/log hardening;
- managed-child credential-environment scrubbing;
- automatic recall policy configuration UI;
- per-user long-term memory/profile records;
- vector or embedding retrieval;
- nested instruction discovery beyond current OpenCode behavior;
- user-visible inspection of private sidecar metadata;
- reconstruction of private sidecars from public EventV2 alone;
- ChatRelay-to-OperatingAgent forwarding; and
- deletion/archival policy for Sessions replaced by OperatingChat reset.
