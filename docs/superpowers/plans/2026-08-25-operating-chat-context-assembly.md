# OperatingChat Context Assembly Parallel Implementation Plan

> Required execution skills: use `superpowers:using-git-worktrees` before
> implementation, `superpowers:test-driven-development` for every behavior
> change, `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to run the tasks, and
> `superpowers:verification-before-completion` before each completion claim.

Status: future implementation plan

Design authority: [OperatingChat Session Context Assembly Design](../specs/2026-08-25-operating-chat-context-assembly-design.md)
Source baseline: `bed110dd46f7a280c56a690ce58f2197f968e1f1`

## Goal

Give OperatingChat a Hermes-inspired but OpenCode-native context lifecycle:
one cached System Context epoch, one durable SessionV2 transcript, exact
historical model-facing user sidecars, automatic plus explicit CtxPack recall,
and the existing structured compaction path.

## Architecture

SessionV2 remains the only prompt, transcript, tool-loop, and compaction owner.
An OperatingChat session profile is derived from its existing live
FunctionalityInstance binding. First admission deterministically materializes
explicit context, performs bounded automatic CtxPack recall for OperatingChat,
and atomically stores an immutable V2 sidecar with exact canonical
`apiContent`. The runner composes selected-agent and OperatingChat host facts
into the existing Context Epoch, replays V2 sidecars by message ID, and passes
enriched content to the existing compactor.

No new user-facing prompt/session endpoint, table, database, event stream,
queue, vector index, browser store, or context runtime is part of this plan.
One additive nullable `session_message.model_context_json` column is required so
enriched compaction remains private instead of leaking through public events.
The existing experimental host-sync HttpApi gains a versioned private-transfer
form. The public event marker is regenerated into the Promise/Effect clients;
the OpenCode-only sync contract is regenerated into the legacy JavaScript SDK.

## Tech stack

- TypeScript and Bun
- Effect, Effect Schema, and Effect layers
- Drizzle/SQLite and existing FTS5 tables
- SessionV2, EventV2, System Context/Context Epoch, CtxPack, and
  FunctionalityInstance
- the existing host-sync routes and legacy JavaScript SDK, plus generated
  Promise/Effect clients for the public Protocol marker
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
  Session input state.
- Same-ID exact retry never searches again.
- Explicit context fails closed; automatic context fails open with a sanitized
  status.
- Automatic recall reads validated immutable pack fragments directly and does
  not create durable ContextCapsule rows; the admitted sidecar is its durable
  copy.
- The final rendered context envelope, including provenance and wrapper bytes,
  must fit the existing attachment budget. Each automatic candidate is kept
  only when its tentative render fits; explicit overflow rejects.
- Missing actor identity never triggers recall under a synthetic user.
- The existing structured compactor and thresholds remain; only its input view
  becomes sidecar-aware.
- Enriched compaction summary/recent data is stored in one private message
  sidecar column. The public compaction event contains a fixed sentinel plus
  clean transcript serialization.
- Every V2 `PromptAdmitted` event carries only a version marker; its projector
  leaves a pending marker until the private sidecar is atomically committed.
- Public `/global/event` sync remains clean. It emits sync hints only after
  request/response negotiation of transfer version 1; each hint wakes a
  versioned `/sync/history` pull that transfers private envelopes separately.
- Version-1 private transfer and negotiated sync hints require the existing
  host credential to be configured and valid. An otherwise-open listener
  refuses this private capability.
- Private bytes may use loopback HTTP, HTTPS, or an explicitly equivalent
  confidential transport. Loopback means only literal `127.0.0.0/8` or `::1`,
  not a DNS name. A non-loopback plain-HTTP target fails preflight, and private
  requests never follow redirects.
- Empty-destination import, catch-up, live sync, and sidecar repair use one typed
  `SessionProjectionTransfer` contract and reject incompatible peers. Same-
  workspace replication carries the Context Epoch. A missing private target is
  acceptable only when the same frozen snapshot contains a later authoritative
  revert that deterministically deletes that exact target; every other absence
  is a projection defect. Phase 1 rejects every
  Session workspace/location warp unconditionally before side effects; safe
  warp is a separate durable-maintenance-fence design.
- Network transfer discovers at most 128 Session aggregates per batch. Every
  serialized page is at most 512 KiB and carries at most 256 complete public
  events or 64 chunks for one oversized public/private record. It spools both kinds and applies
  one source-high-water snapshot atomically. Replay uses bounded idempotent
  begin/append/finalize rather than complete arrays.
- Deployment is coordinated: no V2 admission marker or private checkpoint may
  be enabled until the control plane and every managed peer report transfer
  version 1.
- Managed readiness is a short-lived, revisioned lease delivered to each worker
  by the control plane through authenticated `/sync/start`, not a coordinator-
  local boolean. Restart/expiry/revocation removes readiness, and admission
  requires an unforgeable per-request lease token injected by that control plane
  and holds a scoped readiness permit through the same commit that revalidates
  the OperatingChat profile.
- A combined OpenCode process with zero remote peers uses an in-process self
  permit without host credentials or HTTP self-probing. Before the first remote
  attach it revokes/drains that permit, queries transfer-required state, and
  enters the authenticated all-peer protocol.
- Once any transfer-required input/checkpoint/epoch row or retained requiredness
  event exists, the control
  plane refuses to attach or launch a non-v1 managed peer. That decision unions
  the content-free result from self and every drained worker, so delayed live
  sync cannot hide the first private commit. Existing enriched Sessions may
  continue local private compaction, but no legacy transfer is allowed and all
  Session warp remains unsupported in this phase.
- Agent system instructions and the OperatingChat host profile join the Context
  Epoch as replacement-only private sources. They are no longer a changing
  request-system prefix and never become public `ContextUpdated` text.
- The Location-scoped `SystemContextRegistry` stays argument-free.

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

Wave 3 is serial because runner replay and compaction touch the same runner
file as Wave 2E. Wave 4 is serial integration, cleanup, full verification, and
docs; no Wave 4 task edits production concurrently with another.

Do not let workers share an unstaged worktree. Do not combine task commits
until their focused RED/GREEN evidence and diff review are recorded.

## Dependency graph

```text
Wave 1A schema ─────────────┐
                           ├── Wave 2D admission/sidecar ──┐
Wave 1B recall ─────────────┘                              │
                                                          ├── Wave 3 replay/compaction
Wave 1C profile ──┬────────── Wave 2E system/epoch ────────┘
                  ├────────── Wave 2D target resolution
                  └────────── Wave 2F App target projection

Wave 3 ──> Wave 4 end-to-end, dead-code removal, full verification, docs
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
bun ./packages/sdk/js/script/build.ts
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
because its full OpenCode event union consumes the public marker; Task 3C will
regenerate it again for the later OpenCode-only sync change.

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
- an ordinary Session resolves `{ kind: "generic" }`;
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
a generic profile, it requires that no live OperatingChat binding now owns the
Session. The value contains no CtxPack text. Admission calls `revalidate` from
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
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/session/input.ts`
- Modify: `packages/core/src/session/subagent-runner.ts`
- Modify: `packages/core/src/session/projector.ts`
- Modify: `packages/core/src/session/sql.ts`
- Modify: `packages/core/src/ctxpack/wiring.ts`
- Modify as needed: `packages/core/src/ctxpack/index.ts`
- Modify: `packages/server/src/routes.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts`
- Extend: `packages/core/test/session-ctxpack-admission.test.ts`
- Update test composition fakes:
  `packages/core/test/session-ctxpack-promotion.test.ts`
- Update test composition fakes:
  `packages/core/test/ctxpack-acceptance.test.ts`
- Update every existing direct `SessionV2.node` composition:
  `packages/core/test/session-create.test.ts`,
  `packages/core/test/session-history.test.ts`,
  `packages/core/test/session-projector.test.ts`,
  `packages/core/test/session-prompt.test.ts`,
  `packages/core/test/session-runner.test.ts`,
  `packages/core/test/session-runner-recorded.test.ts`,
  `packages/core/test/integration/master-agent-session.test.ts`,
  `packages/core/test/workspace/master-agent-events.test.ts`,
  `packages/server/test/integration/master-agent-api.test.ts`,
  `packages/opencode/test/session/compaction.test.ts`, and
  `packages/opencode/test/session/prompt.test.ts`
- Extend only if behavior requires it: `packages/core/test/ctxpack-materialize.test.ts`
- Extend: `packages/core/test/session-subagent-runner.test.ts`

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
- a strictly local/no-sync explicit placement stays on the compatible V1
  snapshot path, performs no automatic recall, and creates no V2 marker;
- a managed not-ready placement admits a clean prompt with no sidecar but
  rejects explicit attachments as transfer-unavailable;
- revocation requested after assembly waits for the held permit, the in-flight
  admission commits atomically before revoke acknowledgement, and the next
  acquisition selects V1 without leaving a pending marker;
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
  same typed missing-private-context error; transfer-export coverage is deferred
  to Task 3C where `SessionProjectionTransfer` is introduced;
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
    input: { sessionID: SessionSchema.ID; proof?: SessionContextTransferRequestProof },
    run: (
      mode: "v1-local-explicit" | "v1-clean-only" | "v2-enriched",
    ) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R>
}
```

Add one small `SessionContextTransferReadiness` port beside the assembly port.
It owns a Core-private `SessionContextTransferRequestProof` value. Its
`withPermit` callback selects the mode and owns the whole dynamic scope from
profile resolution through the EventV2 transaction/commit hook; callers never
receive a detachable release function. The proof is not an Effect/HTTP ambient and is not part of the
public prompt Schema. Core has no
permissive ambient default. In this intermediate task, both standalone Server
and OpenCode production compositions provide an explicit not-ready layer; only
focused admission tests may provide a ready fake. Task 3 replaces those layers
with local readiness or the authenticated managed-worker lease only after exact
V2 user-message lowering exists. Admission must check readiness before assembly
can create a V2 marker.

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

Export named generic-profile and local-only/managed-not-ready node constructors,
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
graph and give its focused tests the named generic/not-ready or local-only
fixtures. A worker-child prompt must not obtain an ambient ready permit or an
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
   typed transfer-unavailable error and return no sidecar for a clean prompt;
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
private context is both required and ready. Strictly local/no-sync placement may
retain the compatible V1 explicit snapshot path. A managed but not-ready
placement disables automatic recall, admits clean prompts without a sidecar,
and rejects explicit attachments because even V1 snapshot bytes require private
transfer. Pass that choice as the assembly mode; do not retain a second
snapshot port or bypass the single assembly service. Its projector writes a small pending-V2 marker into
`context_snapshot_json`. Install a commit hook for every newly admitted row,
including generic, managed-not-ready clean, and sidecar-free V1 inputs. The hook
first calls `profilePort.revalidate(sessionID, profile)`, then conditionally
validates/writes V1 or replaces the V2 pending marker. This preserves the
observed absence of a binding as part of admission authority. Keep the readiness
permit held until the transaction scope closes. A revoked/not-ready acquisition selects V1 before assembly; a
revocation already waiting on a held permit cannot acknowledge until commit
finishes. A stale profile fails the admission scope; it must not acknowledge or
retain an input row.

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
`SessionContextSnapshot` values to assembly/runner callers. Transfer restore may
replace null/pending only when the validated envelope owns the same event and
message; it never accepts pending as model content.

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
bun test
bun typecheck
Set-Location ../server
bun test test/integration/master-agent-api.test.ts
bun typecheck
Set-Location ../opencode
bun test test/session/compaction.test.ts test/session/prompt.test.ts
bun typecheck
Set-Location ../..
git diff --check
git add packages/core/src/session/context-sidecar.ts packages/core/src/session/context-slot.ts packages/core/src/session/context-transfer-readiness.ts packages/core/src/ctxpack/session-context.ts packages/core/src/session.ts packages/core/src/session/input.ts packages/core/src/session/subagent-runner.ts packages/core/src/session/projector.ts packages/core/src/session/sql.ts packages/core/src/ctxpack/wiring.ts packages/core/src/ctxpack/index.ts packages/core/test/fixture/session-context.ts packages/core/test/session-context-sidecar.test.ts packages/core/test/session-create.test.ts packages/core/test/session-history.test.ts packages/core/test/session-projector.test.ts packages/core/test/session-prompt.test.ts packages/core/test/session-runner.test.ts packages/core/test/session-runner-recorded.test.ts packages/core/test/session-subagent-runner.test.ts packages/core/test/session-ctxpack-admission.test.ts packages/core/test/session-ctxpack-promotion.test.ts packages/core/test/ctxpack-acceptance.test.ts packages/core/test/ctxpack-materialize.test.ts packages/core/test/integration/master-agent-session.test.ts packages/core/test/workspace/master-agent-events.test.ts packages/server/src/routes.ts packages/server/test/integration/master-agent-api.test.ts packages/opencode/src/server/routes/instance/httpapi/server.ts packages/opencode/test/session/compaction.test.ts packages/opencode/test/session/prompt.test.ts
git commit -m "feat(core): admit exact operating chat context"
```

Omit unchanged optional files from staging.

**Exit gate:** every ready OperatingChat input has one immutable V2 sidecar,
local-only explicit placement keeps V1 compatibility, managed-not-ready explicit
placement rejects while clean input stays sidecar-free, exact retry cannot
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
  ephemeral `v1-composer-*`/`v2-composer-*` capsule; and
- target normalization preserves the optional context target while
  `targetKey()` remains based on Session/location identity and does not fork a
  second surface store.

Run from the worktree root:

```powershell
Set-Location packages/app
bun test --conditions=solid --isolate --preload ./happydom.ts src/components/prompt-input/composer-id.test.ts src/components/prompt-input-ctxpack-target.test.tsx src/components/prompt-input-v2.test.tsx src/pages/canvas/runtime/registrations/operating-chat.test.ts
bun test --conditions=browser --isolate --preload ./happydom.ts src/pages/canvas/operating-chat.browser.test.tsx
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
git add packages/app/src/pages/canvas/session-target.tsx packages/app/src/pages/canvas/session-target.test.tsx packages/app/src/pages/canvas/runtime/registrations/operating-chat.ts packages/app/src/pages/canvas/runtime/registrations/operating-chat.test.ts packages/app/src/pages/canvas/workspace.tsx packages/app/src/pages/canvas/operating-chat.browser.test.tsx packages/app/src/pages/session-surface-base.tsx packages/app/src/components/prompt-input/contracts.ts packages/app/src/components/prompt-input.tsx packages/app/src/components/prompt-input-ctxpack-target.test.tsx packages/app/src/components/prompt-input-v2.tsx packages/app/src/components/prompt-input/composer-id.ts packages/app/src/components/prompt-input/composer-id.test.ts packages/app/src/components/prompt-input-v2.test.tsx
git commit -m "fix(app): use canonical ctxpack targets"
```

Omit unchanged optional files from staging.

**Exit gate:** every explicit capsule is created for the same target Core will
validate, a no-Session composer creates none, and the production benchmark
comparison is recorded without an unexplained regression.

## Wave 2 integration review

Integrate D, E, then F. Resolve conflicts by preserving all three behaviors; do
not move sidecar content back into `request.system`.

From `packages/core`:

```powershell
bun test test/session-context-sidecar.test.ts test/session-ctxpack-admission.test.ts
bun test test/session-runner-system-context.test.ts test/session-runner.test.ts
bun typecheck
```

Review the resulting `llm.ts` and `input.ts` for these exact invariants:

- recall runs only before first admission;
- the admission commit hook remains atomic;
- the System Context registry remains Location-scoped and argument-free;
- call-time system additions contain no new V2 recalled context;
- no raw CtxPack text is logged; and
- generic SessionV2 has no automatic recall.

From `packages/app`, run the focused target tests and `bun typecheck`, then
confirm no composer-prefixed materialization target remains in production.

## Wave 3: exact replay, private compaction, and guarded activation

Wave 3 is serial but split into three independently reviewable green commits.
Production readiness remains disabled through 3A and 3B. Task 3C activates the
local permit and managed lease only after exact lowering, private compaction,
and lossless transfer all exist.

### Task 3A: Lower exact sidecars across turns

**Owner:** coordinator or one serial worker

**Depends on:** Tasks 2D and 2E
**Files:**

- Modify: `packages/core/src/session/input.ts` only for a narrow read helper if
  Task 2D did not already expose it
- Modify: `packages/core/src/session/runner/to-llm-message.ts`
- Modify: `packages/core/src/session/runner/llm.ts`
- Extend: `packages/core/test/session-ctxpack-promotion.test.ts`
- Extend: `packages/core/test/session-runner.test.ts`

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
- corrupt V1 or V2 JSON fails before `llm.stream`;
- valid V2 JSON with tampered API content, canonical provenance, request/content
  hash, byte length, or token estimate also fails before `llm.stream`; and
- process/service restart replays the same V2 `apiContent` without CtxPack
  access.

Run:

```powershell
bun test test/session-ctxpack-promotion.test.ts test/session-runner.test.ts
```

#### Step 2: Load active sidecars by message ID

Add a single Session-input read that fetches and decodes sidecars for active
user message IDs selected by `SessionHistory.entriesForRunner`. The current
`contextSnapshotsOf()` returns an ordered array and loses IDs; replace or
supplement it with a map keyed by message ID. Sort/order comes from Session
history, never from the SQL map. Keep the narrow array helper only if V1
promotion compatibility still consumes it.

For V2, call Task 2D's single strict decoder with the owning clean user message;
do not add another schema-only decode path. The same decoder is used by early
retry, runner lowering, compaction serialization, and transfer export/restore.

Do not query CtxPack, capsules, or the profile resolver during replay.

#### Step 3: Make user lowering sidecar-aware

Pass the decoded map into `toLLMMessages`. For each user message:

- V2: use `apiContent` for its text part;
- no sidecar: use clean `message.text`;
- V1: leave user text clean and let the runner's compatibility path supply the
  current promoted V1 system addition.

Do not mutate `SessionMessage` objects. Filter the runner's existing promoted
snapshot `request.system` rendering to V1; V2 must have exactly one owning user
message representation.

#### Step 4: Verify and commit exact lowering

From the worktree root:

```powershell
Set-Location packages/core
bun test test/session-ctxpack-promotion.test.ts test/session-runner.test.ts
bun typecheck
Set-Location ../..
git diff --check
git add packages/core/src/session/input.ts packages/core/src/session/runner/to-llm-message.ts packages/core/src/session/runner/llm.ts packages/core/test/session-ctxpack-promotion.test.ts packages/core/test/session-runner.test.ts
git commit -m "feat(core): replay exact session context"
```

Omit unchanged optional files. Keep both production readiness compositions
not-ready; this commit proves lowering but does not activate V2 admission.

### Task 3B: Compact enriched history privately

**Owner:** coordinator or the same serial worker

**Depends on:** Task 3A
**Files:**

- Create: `packages/core/src/session/compaction-context.ts`
- Generate: one migration under `packages/core/src/database/migration/` named
  by `bun run migration --name add-session-message-model-context`
- Create:
  `packages/core/test/database/session-message-context-migration.test.ts`
- Modify: `packages/core/src/session/sql.ts`
- Modify: `packages/core/src/session/projector.ts`
- Regenerate: `packages/core/src/database/migration.gen.ts`
- Regenerate: `packages/core/src/database/schema.gen.ts`
- Regenerate: `packages/core/schema.json`
- Modify: `packages/core/src/session/runner/to-llm-message.ts`
- Modify: `packages/core/src/session/runner/llm.ts`
- Modify: `packages/core/src/session/compaction.ts`
- Extend: `packages/core/test/session-runner.test.ts`
- Extend: `packages/core/test/session-compaction.test.ts`

#### Step 1: Write RED private-compaction tests

Prove:

- compaction serialization uses V2 `apiContent`, including recalled facts;
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
- a valid-shape private sidecar with changed summary/recent, content hash, UTF-8
  byte length, or token estimate fails before `llm.stream`;
- a later compaction with a sentinel whose private JSON is missing/corrupt
  fails before the auxiliary summarizer call;
- the same valid-shape tampering fails before the auxiliary summarizer call;
- full input/message/sidecar rows remain readable; and
- existing summary headings and threshold behavior do not change.

Run:

```powershell
bun test test/session-compaction.test.ts
```

Also prove the additive migration against a temporary on-disk database, close
and reopen it, and decode a persisted private sidecar.

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

Do not hand-edit `migration.gen.ts`, `schema.gen.ts`, or `schema.json`. Inspect
the generated migration and require that it only adds the nullable
`model_context_json` column. The generated registry is what makes the migration
run for an existing database; the schema snapshot and generated full schema
cover fresh databases.

Provide one strict decoder and reads keyed by compaction message ID. After
schema decoding, canonicalize `{ version, rendererVersion, summary, recent }`,
recompute SHA-256, UTF-8 byte length, and `ceil(bytes / 4)`, and require every
stored derived field to match. The runner, later compaction, export, and restore
must call this decoder rather than schema-decode independently. A
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

#### Step 4: Lower private checkpoints for the runner

Load private compaction sidecars by active compaction message ID beside the user
sidecar map. `toLLMMessages` uses the private values for the sentinel-bearing
message and public values for legacy messages. Public `sessions.messages` and
`sessions.events` remain unchanged and clean.

#### Step 5: Verify and commit private compaction

From the worktree root:

```powershell
Set-Location packages/core
bun test test/session-runner.test.ts test/session-compaction.test.ts
bun test test/database/session-message-context-migration.test.ts test/database-migration.test.ts
bun run migration --check
bun typecheck
Set-Location ../..
git diff --check
git add packages/core/src/session/compaction-context.ts packages/core/src/database/migration packages/core/src/database/migration.gen.ts packages/core/src/database/schema.gen.ts packages/core/schema.json packages/core/src/session/sql.ts packages/core/src/session/projector.ts packages/core/src/session/runner/to-llm-message.ts packages/core/src/session/runner/llm.ts packages/core/src/session/compaction.ts packages/core/test/database/session-message-context-migration.test.ts packages/core/test/session-runner.test.ts packages/core/test/session-compaction.test.ts
git commit -m "feat(core): compact private session context"
```

Production readiness remains disabled. This commit can read/test V2 fixtures but
cannot create the first production V2 marker.

### Task 3C: Transfer private projections and activate guarded admission

**Owner:** coordinator or the same serial worker

**Depends on:** Tasks 3A and 3B
**Files:**

- Create: `packages/core/src/session/projection-transfer.ts`
- Create: `packages/core/test/session-projection-transfer.test.ts`
- Modify: `packages/core/src/event.ts` only for the low-level atomic replay
  commit seam consumed by `SessionProjectionTransfer`
- Extend: `packages/core/test/event.test.ts`
- Modify: `packages/core/src/session/context-transfer-readiness.ts`
- Modify: `packages/core/src/session.ts` for a Core-private non-schema prompt
  option carrying the request proof
- Modify: `packages/core/src/session/context-epoch.ts`
- Modify: `packages/core/src/session/projector.ts`
- Modify: `packages/core/src/session/input.ts` only for a narrow transfer read
  helper if earlier tasks did not expose it
- Modify: `packages/server/src/routes.ts` to replace not-ready with local permit
- Modify: `packages/server/src/handlers/session.ts` to translate internal
  headers into the Core-private proof option
- Create: `packages/server/test/session-handler.test.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts` for
  managed-worker lease composition
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/sync.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/sync.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/global.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts`
- Modify:
  `packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts`
- Modify: `packages/opencode/src/server/shared/workspace-routing.ts`
- Modify: `packages/opencode/src/control-plane/workspace.ts`
- Create: `packages/opencode/src/control-plane/session-context-readiness.ts`
- Create: `packages/opencode/test/control-plane/session-context-readiness.test.ts`
- Create: `packages/opencode/src/control-plane/session-context-transfer-spool.ts`
- Create: `packages/opencode/test/control-plane/session-context-transfer-spool.test.ts`
- Extend: `packages/opencode/test/server/httpapi-sync.test.ts`
- Extend: `packages/opencode/test/server/httpapi-global.test.ts`
- Extend: `packages/opencode/test/server/httpapi-workspace-routing.test.ts`
- Extend: `packages/opencode/test/server/workspace-routing.test.ts`
- Extend: `packages/opencode/test/control-plane/workspace.test.ts`
- Extend: `packages/opencode/test/session/session.test.ts`
- Regenerate: `packages/sdk/js/src/v2/gen/**`

#### Step 1: Write RED transfer, routing, and readiness tests

Write the Core transfer/event tests, Server proof-seam test, and OpenCode
sync/spool/readiness/routing/workspace tests before production edits. Include all
behaviors listed below, especially exact-duplicate sidecar repair, reverted-
target deletion proofs, bounded encrypted paging, high-water concurrency,
managed local/remote proof, zero-
remote activation, partial grant/revoke races, pending-marker export refusal,
and unconditional Session-warp rejection.

Run the intended failing checkpoints from the worktree root:

```powershell
Set-Location packages/core
bun test test/session-projection-transfer.test.ts test/event.test.ts
Set-Location ../server
bun test test/session-handler.test.ts
Set-Location ../opencode
bun test test/server/httpapi-sync.test.ts test/server/httpapi-global.test.ts test/server/httpapi-workspace-routing.test.ts test/server/workspace-routing.test.ts test/control-plane/session-context-readiness.test.ts test/control-plane/session-context-transfer-spool.test.ts test/control-plane/workspace.test.ts test/session/session.test.ts
Set-Location ../..
```

Require failures for missing transfer contracts, atomic replay repair, private
sync forms, spool limits/encryption, proof routing, lease behavior, or the
unconditional warp guard. Fix test syntax/fixture mistakes before proceeding; a missing file or
unrelated environment failure is not the RED evidence.

#### Step 2: Add typed private projection transfer and host sync

Create one Core-private `SessionProjectionTransfer` schema/service. Keep its
versioned event-sidecar and epoch envelopes separate from public serialized
events. Each input/compaction envelope must bind and validate:

- event ID, aggregate/session ID, aggregate sequence, and exact versioned event
  type;
- canonical event-data hash;
- target message/input ID and sidecar kind (`input` or `compaction`);
- sidecar schema version, canonical-payload SHA-256, and canonical private JSON.

Add a content-free `reverted-target` deletion record for the one intentional
absence case. It binds the aggregate, owning target event/message and kind to a
later `RevertEvent.Committed`, its aggregate sequence, and boundary message.
Core validates the relation with the Session projector's existing deletion
predicate inside the same frozen high-water snapshot. Never infer a deletion
record from a missing database row. Bind the target, deleting revert, and
boundary-message event with complete ID/aggregate/sequence/versioned-type/
canonical-data-hash identity. Declare whether deletion follows message,
admitted-input, or promoted-input sequence; the promoted-input branch also
binds the exact promotion event with that complete identity. Validate these
identities against retained destination history even when its cursor has moved
beyond the referenced events.

The epoch envelope binds its canonical baseline/snapshot payload to the Session,
baseline sequence, current source sequence, epoch schema version, and payload
hash. It has no invented event/message identity or self-asserted owner. Restore
receives the expected routed workspace/claim owner separately from the
authenticated transport; local empty-destination import supplies no remote owner.

Keep `PromptAdmitted` at durable event version 1; its optional
`modelContextVersion: 2` field is backward-compatible. Do not bump the durable
event version unless historical v1/v2 decoding is designed separately.

`SessionProjectionTransfer.export` reads the requested public events, all
required sidecars, and the current Context Epoch in one SQLite read transaction.
It resolves each owning clean prompt/compaction message and calls the single V2
input or compaction strict decoder before enveloping bytes. It fails if a V2
pending marker or private compaction sentinel has no valid, internally
consistent sidecar, except when the same frozen bundle contains the validated
later revert proof for that exact target. Export emits the content-free
deletion record in that case. It also scans retained reverts inside the frozen
snapshot and fails with a typed projection defect if any target that the
projector should have deleted is still present. Restore validates the outer envelope hash/identity and then
runs the same inner strict decoder before any write, so an attacker cannot
recompute only the envelope hash around tampered sidecar metadata. It never
places an envelope in `EventTable`, EventV2 data, logs, or browser events.

`SessionProjectionTransfer.restore` is the only sync/import entry point that
may pair replay with a private write. Add the narrow low-level EventV2 replay
commit seam needed to run the validated write after the Session projector and
inside the same event transaction; do not pass arbitrary callbacks from HTTP
handlers. Validate the complete bundle before the first write. Handle exact
duplicates explicitly:

- matching event + matching sidecar: no-op;
- matching event + missing sidecar: restore only when the projected target row
  exists;
- matching event + conflicting sidecar: typed conflict;
- matching event + missing projected target + a validated later retained revert
  deleting that target: expected idempotent no-op;
- matching event + missing projected target without that proof: typed
  projection defect; and
- new deleting revert + present/new target: let the ordinary projector delete
  it inside the atomic batch before commit;
- already-retained deleting revert + absent target: idempotent no-op;
- already-retained deleting revert + still-present target: typed projection
  defect, never an implicit projector replay or silent delete; and
- new event + envelope: project and restore atomically before publication.

Do not market or implement this as arbitrary re-projection. Empty-destination
import streams new events so their projector creates each target row in the same
transaction as private restore. A validated deletion record permits the atomic
batch to project a temporary pending input/private compaction sentinel without
sidecar bytes only because the later revert in that same batch deletes it before
commit, publication, or wake. Final validation rejects any unresolved marker or
sentinel. If the identical EventV2 row already exists but its projected target
is missing without the later retained revert proof, return the typed defect
above. Final validation also rejects any target left present behind an already-
retained deleting revert. Rebuilding lost projections from an existing event log needs a separate
deterministic projector replay design.

For same-workspace replication, restore a missing epoch and no-op an identical
epoch. Replace a different epoch only when the expected workspace/claim owner
from the authenticated routed context matches the target's existing placement
fence, the source sequence is current, and no local advance exists; otherwise
conflict. Never trust an owner string from the envelope. An implicit-local
empty-destination import may restore missing/identical state but conflicts on divergence. Do not
use this service to approximate a distributed Session move. Guard the existing
workspace/location warp entry point unconditionally with typed
`SessionWarpContextAssemblyUnsupported` before remote final sync, prompt
cancellation, filesystem mutation, replay, or claim. Do not use a read-only
private-state preflight: a concurrent admission can commit after it. Safe warp
needs a Session-scoped durable maintenance fence consulted by every
admission/resume, a two-sided transfer receipt, and clustered execution-
ownership recovery; that is outside this plan.

Write Core tests for those cases, wrong event ID/aggregate/sequence/type/data
hash/target, wrong payload hash/schema, input/compaction/epoch transfer, an
incomplete export, an unauthorized/stale epoch replacement, and a consistent
empty-destination export/import cycle restoring all three private-state kinds.
Also prove that an already-present identical event with a deleted/missing
projected target returns the typed defect and performs no re-projection when no
later revert proves intentional deletion. Add RED/GREEN imports for a V2 input
reverted past its boundary and a private compaction message reverted past its
boundary: both omit private payload, carry the validated content-free deletion
record, apply the whole event sequence atomically, and finish with no unresolved
target. Reject a wrong target, boundary, sequence, deleting event, or revert
outside the frozen snapshot. Bind and verify ID, aggregate, sequence, versioned
type, and canonical data hash for the target, deleting revert, boundary-message
event, and—when that is the deletion branch—the input promotion event. Reject
changed bytes for any referenced public event. Add the admitted-before-boundary/
promoted-after-boundary case and require its exact promotion proof. For both
input and private-compaction targets, add
the inverse RED/GREEN cases: export fails when the source retains a revert but
still projects its deleted target; restore permits a new revert to delete a
present target, no-ops an existing revert with an absent target, and fails an
existing revert with a present target without rerunning projectors. Plain
EventV2 replay of a V2 admission must retain the pending marker and fail closed;
plain replay of a private compaction retains its sentinel and likewise fails
closed.

Evolve the existing experimental sync schemas with explicit legacy and version
1 forms:

```text
sync-start v1 payload  = version + readiness action + workspace ID + topology revision + expiry + request token
sync-start v1 response = accepted revision + effective expiry + content-free transferRequired
history v1 request  = version + capabilityOnly + aggregate-discovery cursor or at most 128 aggregate cursors/digests + optional snapshot/page cursor
history v1 response = version + at most 128 discovered aggregate IDs/manifests (each with bounded deletion count/digest) + discovery cursor + source snapshot token + one <=512-KiB page of at most 256 combined complete public events/content-free deletion records or 64 chunks for one oversized public/private record + next cursor
replay v1 begin     = version + action + client transfer ID + directory + source snapshot token + at most 128-entry high-water vector + manifest digest + expiry
replay v1 append    = version + action + transfer handle + page index + page hash + one bounded public/private page
replay v1 finalize  = version + action + transfer handle + expected page count + manifest digest
replay v1 abort     = version + action + transfer handle
replay v1 response  = transfer handle/next receipt or atomically committed manifest receipt
```

Legacy history/replay shapes remain accepted only when the selected Sessions
contain no private rows and no retained V2 marker/private-compaction sentinel
event, including one later removed from projection by a revert. A
version/capability mismatch
returns a typed conflict; it never silently replays only the clean projection.
Scope both legacy and v1 history queries to Sessions owned by the routed workspace before
reading events or envelopes. Reject any requested aggregate outside that
workspace, and never query all `EventTable` aggregates as the current legacy
handler does.

Set `MAX_SYNC_AGGREGATES = 128`. Discover authorized Session aggregate IDs in
stable ID order through a bounded discovery cursor, then accept at most 128
aggregate cursors/digests and return at most 128 private manifests, each with
only a content-free deletion-record count and digest, for one
snapshot batch. Reject oversized caller maps. Sessions beyond that batch use the
next discovery cursor, so neither the request, response, high-water vector, nor
opaque snapshot state grows with the entire workspace.

Set `MAX_SYNC_PAGE_BYTES = 512 KiB`, `MAX_SYNC_PUBLIC_EVENTS = 256`, and
`MAX_SYNC_RECORD_CHUNKS = 64`. In the first source SQLite read transaction, freeze one high-water sequence for
every authorized requested/discovered aggregate and the corresponding private
manifests (including deletion count/digest) and epoch digests. Order v1 public events deterministically by aggregate
ID and sequence, return at most 256 combined complete public events and
content-free deletion records only while the entire
serialized response remains at or below 512 KiB, and export only events at or
below that high-water vector. Chunk a single oversized canonical public event
through the same ordered record-chunk form as a private envelope; return at
most 64 chunks and reassemble at most one public/private record at a time. Bind every opaque public/private cursor to the
routed workspace, original request cursor set, source snapshot token,
high-water vector, and complete private/deletion manifest digest. An expired snapshot or
any bound-state mismatch returns a typed restart. Events appended concurrently
above the vector are excluded and the existing dirty-bit trailing history pull
collects them. This bounds growth by event count without changing the stored
EventV2 payload contract; legacy no-private responses retain their compatibility
shape.

The v1 history request carries one bounded digest over the destination's sorted
private identities/hashes for each requested Session. A mismatch returns a
content-free repair manifest and starts a sequence-ordered snapshot; it does
not return the Session's complete private state in one JSON value. One request
may carry a repair cursor for at most one Session. Encode each oversized
canonical public event or private envelope as ordered chunks of its UTF-8 bytes
using base64 so one large record cannot bypass the page bound. Return at most 64
chunks within the 512-KiB serialized whole-response limit. The response fixes `sourceSeq`, orders event
envelopes and deletion records by aggregate sequence plus
kind/identity/chunk index, and returns an
opaque next cursor. Count base64 overhead and aggregate/private metadata inside
the 512-KiB serialized-response cap. Buffer/reassemble at most one public event
or private envelope and validate its
declared byte length/content hash. Append canonical public EventV2 records,
content-free deletion records, and reassembled private envelopes to one
random-name transfer spool under a
dedicated host-private temp directory. Encrypt every record with AES-256-GCM, a
per-transfer 256-bit key held only in process memory, and a fresh random 96-bit
nonce stored with the ciphertext. Bind transfer handle, page index, record
index, and record kind as associated data. Reject nonce/index reuse,
authentication failure, record reordering, or conflicting ciphertext before
restore. Apply and verify restrictive permissions/ACLs where supported, but
never rely on random naming or filesystem permissions alone. Record each page index/hash so an equal
retry is a no-op and conflicting reuse fails. Do not replay a public event or
write a sidecar while pages arrive. Place epoch chunks last. After the final
page and manifest validation, expose a replayable two-pass source from the spool to
`SessionProjectionTransfer.restoreBatch`: validate the entire Session bundle,
including every revert/target deletion proof, against the current projection in
pass one, then apply public events,
input/compaction sidecars, content-free deletion records, and same-workspace
epoch in one SQLite transaction in pass two. Notify/wake only after commit. If
any captured public row, epoch digest, deletion proof, or private manifest entry
at or below the frozen high-water changes
before completion, return a typed snapshot-advanced error and restart from a
fresh digest. New events/private rows above the vector remain excluded for the
dirty-bit trailing pull. Restoration of an older exact event follows the duplicate rules
above, so partial-range repair is explicit and idempotent without an
ever-growing hash map or unbounded private response.

Delete payload files after success/failure and sweep stale random-name spools on
startup. A restart loses the key, so an orphan is never resumed and is deleted.
Never put Session IDs/private text in filenames or logs. A crash before
the final apply changes no projection; SQLite rolls back a crash during apply.
This deliberately avoids a durable repair fence and prevents SessionExecution
from observing sidecars without the matching epoch.

Make `/sync/replay` use that same bounded representation rather than sending
complete envelope arrays. `begin` creates or idempotently reopens a random-name
target spool bound to the authenticated workspace/directory, caller-generated
transfer ID, source snapshot token, high-water vector, full manifest digest, and
expiry; it returns an opaque server handle. `append`
accepts one indexed/hash-bound page containing at most 256 complete public
events/content-free deletion records or 64 chunks for one oversized
public/private record and at most 512 KiB serialized in every case, and spools
all record kinds without projection writes.
`finalize` requires the complete page count/manifest and calls the same two-pass
atomic restore; `abort`, expiry, and startup cleanup discard incomplete spools.
Equal begin/append retries are idempotent and conflicting reuse fails. Keep a
content-free completion receipt in memory until the bounded transfer TTL so an
immediate duplicate finalize can return success after payload deletion. After a
restart or unknown handle, require authenticated digest reconciliation and a new
begin; Core restore idempotence makes an already committed snapshot a no-op.
This avoids durable transfer authority.

Clamp caller expiry and resource use before begin/append:
`MAX_ACTIVE_TRANSFERS = 8`, `MAX_TRANSFER_BYTES = 512 MiB`,
`MAX_TOTAL_SPOOL_BYTES = 1 GiB`, five-minute idle TTL, and 30-minute absolute
lifetime. Activity may refresh only the idle deadline. Return typed
busy/too-large/expired failures and delete partial files; do not add a
configuration subsystem in this slice.

Compute the digest as SHA-256 of canonical JSON over sorted private identities,
kinds, schema versions, content hashes, validated deletion-record target/revert/
boundary/promotion identities, and epoch baseline/source sequence. It contains no payload
bytes and is recomputed from existing rows plus retained public history; add no
digest table or cache.

Do not add private bytes to `/global/event` or `EventV2Bridge`. Declare the
content-free `x-opencode-session-sync-version` request/response header on the
global event endpoint. Emit `payload.type === "sync"` records and echo version
`1` only when the connection requests version `1` and presents a configured,
valid existing host credential. An otherwise-open listener must return a typed
private-sync-unavailable response for v1 history/replay and must not negotiate
sync hints. Ordinary browser/TUI, unauthenticated, and old-peer connections
receive public domain events but no sync envelope. A new destination requires
the response header before marking sync connected, so an old source cannot
trigger direct public-event replay. Local in-process empty-destination import bypasses HTTP and
does not require a network credential.

Before any v1 capability probe or private request, validate the target URL:
allow loopback HTTP, HTTPS, or an adapter-declared transport with equivalent
confidentiality; reject non-loopback plain HTTP. Classify only literal IPv4
`127.0.0.0/8` and IPv6 `::1` as loopback—do not trust `localhost` or another DNS
name. Use a private HTTP client with redirect following disabled for capability,
lease, history, replay, sync, and the proof-bearing `RequestPlan.Remote` prompt
proxy; treat every 3xx as a typed failure and never forward Authorization,
internal topology/lease proof, or a body to the advertised location. Do this before lease grant,
history export, replay, patch, or claim side effects. Basic host
authorization authenticates the peer but is not transport encryption.

For a negotiated connection, treat only `payload.type === "sync"` as a wake hint
in `Workspace.syncWorkspaceLoop`: schedule a versioned authenticated history
pull, return from the SSE callback, and let that pull restore public events plus
bounded private pages. Coalesce hints with one process-local single-flight/dirty
bit per workspace: hints received during a pull cause at most one trailing
pull, and one history response may advance through many durable events.
Ordinary public event records do not trigger a second replay path.

At the session-warp entry point, return
`SessionWarpContextAssemblyUnsupported` unconditionally before remote final
sync, prompt cancellation, patch copy, replay, ownership claim, or filesystem
mutation. Cover empty, public-only, epoch-only, V1-sidecar, and V2-sidecar
Sessions. Do not perform a private-state query: without a Session-scoped durable
maintenance fence, admission can race any read result. New/old mixed-version
live sync still fails closed.

Implement the managed admission-readiness gate as a worker-local lease service,
not a coordinator-local boolean. Extend the existing authenticated `/sync/start`
shape with a version-1 `grant` or `revoke` action containing the routed
workspace ID, a deterministic topology revision, an absolute expiry, and a
fresh 256-bit request token. The token is never logged or returned; the response
echoes the accepted revision/effective expiry plus a content-free
`transferRequired` boolean computed after any revoke drain. A legacy start may
start legacy sync only after the local bounded query proves
`transferRequired === false`; otherwise it returns typed incompatibility and
does not join/start sync. It never creates or renews readiness. A v1 lease
request is rejected when host authorization is unconfigured or invalid.

`SessionContextTransferReadiness` in a managed worker reads this in-memory
lease. The managed control plane grants that same lease/token to its own local
worker service as well as each remote worker. `WorkspaceRoutingMiddleware`
strips any caller-supplied
`x-opencode-session-context-topology` and
`x-opencode-session-context-lease` headers for every routed prompt. For
`RequestPlan.Local` it injects the coordinator's current self-proof into the
downstream local request; for `RequestPlan.Remote` it injects the selected
worker's proof into the proxy request. `packages/server` reads those two internal headers,
constructs the Core-private non-schema `SessionContextTransferRequestProof`,
and passes it as the optional second argument to `SessionV2.prompt`. Direct
Core/non-HTTP callers omit it. A managed worker acquires a scoped permit only
when that request proof matches the live version/workspace/revision/token/expiry. Hold the
permit through the EventV2 transaction and sidecar commit. Worker restart starts
empty. Use a 30-second lease renewed every 10 seconds while the topology remains
unchanged, with fake-clock tests so the values are not timing-sensitive. The
standalone local Server composition uses its local permit and sends no lease or
header.

Make that path real rather than testing a probe route: extend the shared
workspace-route Session matcher to recognize
`/api/session/:sessionID/prompt`, and wrap the mounted `ServerApi` SessionV2
surface with the OpenCode workspace-routing middleware in `server.ts` while
retaining `SessionLocationMiddleware`. Add an end-to-end HttpApi routing test
that posts to the actual V2 prompt path through a coordinator, resolves the
Session under both `RequestPlan.Local` and `RequestPlan.Remote`, strips a forged
caller header, injects the selected live lease proof, and observes the matching
worker permit. Also prove that a direct external worker request and the same
request through an old/no-token coordinator take the V1-compatible admission
path.

Revoke atomically closes the worker lease to new permits, waits for every active
permit to leave its transaction scope, clears the lease, and only then returns
its acknowledgement with the worker's freshly queried content-free
`transferRequired` value. Define that query as any non-null V1/V2 input sidecar,
pending V2 marker, private compaction checkpoint, Context Epoch, or retained
durable V2 `PromptAdmitted` marker/private-compaction sentinel event—including
one whose projected row was later removed by a revert—not only live rows. This
removes the revalidate/commit TOCTOU window and prevents an admit-only V2 input
reverted before its first epoch from enabling legacy transfer. An
expired lease closes new permits; an already-held permit may finish its current
atomic admission before expiry, exactly like a revoke drain.

Before granting, the control plane probes itself plus every configured
source/target with `capabilityOnly: true` using the configured host credential,
hashes the sorted workspace/endpoint/version set as the topology revision, and
then grants the same revision to self and every worker. Treat grant/renewal as
two-phase: do not enable local or remote proof injection until every
acknowledgement succeeds. On partial grant or renewal failure, keep readiness
inactive and revoke acknowledged leases, or wait for their expiry, before
retrying. Before any topology or placement
mutation it sends revoke to all currently leased workers and waits for every
acknowledgement, including self, and unions their `transferRequired` results;
failure aborts the mutation. Attaching a non-v1 peer is
refused when any result is true, even if live sync has not yet copied the newest
sidecar into the coordinator database. Only after a
fresh all-peer probe may it grant again. Until then, clean prompts remain V1,
managed explicit attachments fail transfer-unavailable, and automatic recall
plus new enriched private checkpoints stay disabled. A strictly
local/no-sync Session may continue using its V1 explicit snapshot path.

Special-case zero remote endpoints: the combined OpenCode process installs an
in-process self permit and enables local V2 without host credentials or an HTTP
`/sync/start` call. Before attaching the first remote endpoint, close/drain the
self permit, query its transfer-required state, then require credential,
confidential transport, peer capability, and the normal two-phase lease grant.
Test default unauthenticated `opencode web`, the first-remote transition, and
refusal of an incompatible first peer after local private state exists.

Serialize peer probe, grant, renewal, revoke, and peer attach/detach under one
existing-control-plane mutex. Session warp is rejected before entering this
protocol. Renewal may reuse the token
for the unchanged topology revision; any new revision rotates it. An old
replacement coordinator lacks the in-memory token, so its proxied prompt falls
back to V1 immediately even if the previous lease has not yet expired.

Once an enriched Session exists, its later private compaction checkpoints remain
required for local correctness; instead of suppressing them, reject any non-v1
peer from the managed topology and keep legacy transfer closed. This coordinated
activation is necessary because an old coordinator can ignore a failed final
history pull and claim stale state; a new response contract cannot repair old
coordinator behavior retroactively. Expose one bounded Core query on
`SessionProjectionTransfer` that answers whether any required input marker,
private checkpoint, epoch row, or retained durable V2 marker/private-sentinel
event exists for the worker's managed scope; run it
for each drained revoke acknowledgement and at peer attach/start instead of
adding a feature-state table.

Use `capabilityOnly: true` for the target preflight so it proves the version
without exporting unrelated target-workspace history. Normal catch-up uses
`capabilityOnly: false` and preserves current discovery of authorized Sessions
that are absent from the destination cursor map.

Cover all six paths:

- v1 `/sync/history` transfers input, compaction, and same-workspace epoch
  envelopes through 64-chunk pages, pages public history at 256 complete events,
  enforces the 512-KiB whole-response ceiling including metadata/base64 overhead,
  chunks a public event larger than that ceiling, discovers at most 128 aggregates/manifests per batch, repairs an
  already-known event, restarts on any changed private manifest, excludes a
  concurrently appended event until the trailing pull, rejects a 129-entry
  caller map, rejects cross-workspace aggregate access, and rejects valid-shape
  input/compaction tampering even when the outer envelope hash was recomputed.
  It exports a content-free deletion record only when a later retained revert
  deterministically deletes that exact V2 input/private-compaction target;
- v1 `/sync/replay` spools both public records and private chunks through
  begin/append/finalize, restores all supplied kinds atomically, chunks one
  oversized private envelope or public event, enforces the 512-KiB combined
  serialized-page ceiling, and enforces every identity, hash, duplicate page,
  conflicting transfer-ID, projection, interruption/retry/expiry, encrypted-at-
  rest/tamper, record-reordering, nonce/index-reuse, active-count/byte/TTL limit,
  immediate completion-receipt, unknown-
  handle reconciliation, and idempotent-restore check. It imports reverted V2
  input and private-compaction sequences without private payload, leaves no
  temporary marker visible, and rejects forged or incomplete deletion proofs;
- live `/global/event` contains no envelope or recalled fragment, coalesces
  negotiated hints, refuses v1 when host authorization is unconfigured, and
  converges through the authenticated history pull;
- a non-loopback plain-HTTP target fails before any private history/replay/lease
  request, literal loopback HTTP and HTTPS remain supported, and loopback/HTTPS
  302/307/308 downgrade or cross-host redirects are rejected without contacting
  the redirect target for both admin sync and proof-bearing routed prompts; no
  Authorization, internal proof, or prompt body is forwarded;
- a simulated old destination omits the version header and receives no `sync`
  envelope for a new V2 admission/private compaction, while a new destination
  rejects an old source that does not echo the capability; and
- every session warp—empty, public-only, epoch-only, V1-sidecar, or V2-sidecar—
  fails before final sync, prompt cancellation, patch/replay/claim, or filesystem
  mutation with `SessionWarpContextAssemblyUnsupported`.

Also test legacy no-private compatibility, mixed-version failure, restart after
restore with byte-identical `apiContent` and baseline, unconditional warp
rejection with zero sync/cancel/query/patch/replay/claim/filesystem side effects,
all-peer admission gating (including an old-coordinator characterization), and
lease grant/renew/expiry/revoke/restart, partial grant/renewal rollback,
commit-spanning permit lifetime,
request-header stripping/injection for both `RequestPlan.Local` and
`RequestPlan.Remote`, direct-worker fail-closed behavior, an old coordinator
during a still-live lease, revoke waiting on an admission paused after permit
acquisition but before commit, serialized topology mutation, rejection of a
newly attached non-v1 peer when a worker committed private state but its sync is
delayed, rejection of a legacy `/sync/start` after local private state exists,
rejection after `resume: false` admits a V2 marker and a later revert removes its
input before any Context Epoch exists,
zero-remote unauthenticated self-permit activation and first-remote transition,
crash/restart before final spool apply, transaction rollback during
batch apply, stale-spool cleanup, plus
absence of private payloads from EventTable/public Session history/global
SSE/OpenAPI event schemas.

Because the experimental OpenCode sync shape changes, regenerate the legacy
JavaScript SDK in Step 3. The Promise/Effect clients were already regenerated in
Task 1A for the public marker; Task 3C does not generate them because SyncApi is
not part of their Protocol contract. Never edit generated files directly.

#### Step 3: Verify, activate, and commit

Start from the worktree root. First verify and commit Core transfer plus the
standalone local permit:

```powershell
Set-Location packages/core
bun test test/session-ctxpack-admission.test.ts test/session-projection-transfer.test.ts test/event.test.ts
bun typecheck
Set-Location ../server
bun test test
bun typecheck
Set-Location ../..
git diff --check
git add packages/core/src/event.ts packages/core/src/session.ts packages/core/src/session/projection-transfer.ts packages/core/src/session/context-transfer-readiness.ts packages/core/src/session/input.ts packages/core/src/session/context-epoch.ts packages/core/src/session/projector.ts packages/core/test/event.test.ts packages/core/test/session-projection-transfer.test.ts packages/server/src/routes.ts packages/server/src/handlers/session.ts packages/server/test/session-handler.test.ts
git commit -m "feat(core): transfer private session context"
```

Omit unchanged optional Core files. Then verify OpenCode before generation:

```powershell
Set-Location packages/opencode
bun test test/server/httpapi-sync.test.ts test/server/httpapi-global.test.ts test/server/httpapi-workspace-routing.test.ts test/server/workspace-routing.test.ts test/control-plane/session-context-readiness.test.ts test/control-plane/session-context-transfer-spool.test.ts test/control-plane/workspace.test.ts test/session/session.test.ts
bun run test:httpapi
bun typecheck
Set-Location ../..
```

Regenerate the legacy SDK and keep the managed lease/proxy plus its generated
OpenCode contract in one green commit:

```powershell
bun ./packages/sdk/js/script/build.ts
git add packages/opencode/src/server/routes/instance/httpapi/server.ts packages/opencode/src/server/routes/instance/httpapi/groups/sync.ts packages/opencode/src/server/routes/instance/httpapi/handlers/sync.ts packages/opencode/src/server/routes/instance/httpapi/groups/global.ts packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts packages/opencode/src/server/shared/workspace-routing.ts packages/opencode/src/control-plane/workspace.ts packages/opencode/src/control-plane/session-context-readiness.ts packages/opencode/src/control-plane/session-context-transfer-spool.ts packages/opencode/test/server/httpapi-sync.test.ts packages/opencode/test/server/httpapi-global.test.ts packages/opencode/test/server/httpapi-workspace-routing.test.ts packages/opencode/test/server/workspace-routing.test.ts packages/opencode/test/control-plane/session-context-readiness.test.ts packages/opencode/test/control-plane/session-context-transfer-spool.test.ts packages/opencode/test/control-plane/workspace.test.ts packages/opencode/test/session/session.test.ts packages/sdk/js/src/v2/gen
Set-Location packages/sdk/js
bun test
bun typecheck
Set-Location ../../..
git diff --cached --check
git commit -m "feat(opencode): sync private session context"
```

Omit the legacy generated path from staging only after confirming generation
produced no diff for it.

**Exit gate:** active historical V2 turns are byte-stable at canonical lowering;
compaction preserves enriched content only in its private atomic sidecar, public
events remain clean, the runner selects the private checkpoint after
compaction, and every supported empty-destination import/sync path preserves required private
context and same-workspace epoch through the typed versioned bundle. Every
Session workspace/location warp rejects before side effects in phase 1.

## Wave 4: end-to-end proof, cleanup, and status documentation

Wave 4 starts only after Tasks 2D, 2E, 2F, 3A, 3B, and 3C are integrated and green.
Run 4A, then 4B, then 4C in one integration worktree. Task 4A may expose a
production design gap, so do not run cleanup or documentation edits in parallel
with it. Any production correction returns to RED/GREEN review before 4B.

### Task 4A: Add a real OperatingChat assembly integration test

**Files:**

- Create: `packages/core/test/operating-chat-context-assembly.test.ts`
- Modify production only if the failing test proves a design gap

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
13. verify layout JSON and durable event payloads contain no fragment text.

Run:

```powershell
Set-Location packages/core
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

Do not add a replacement App store. OperatingChat continues to use
`CanvasSessionSurface`, its Task 2F internal target projection, and the unchanged
public prompt API.

### Task 4C: Update implementation status after code lands

**Files:**

- Modify: `docs/superpowers/specs/2026-08-25-operating-chat-context-assembly-design.md`
- Modify: `docs/superpowers/plans/2026-08-25-operating-chat-context-assembly.md`
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
records as if the feature had existed earlier.

Commit:

```powershell
git add docs/superpowers/specs/2026-08-25-operating-chat-context-assembly-design.md docs/superpowers/plans/2026-08-25-operating-chat-context-assembly.md specs/workspace-canvas/architecture.md specs/workspace-canvas/functionality-subsystem-management-architecture.md specs/workspace-canvas/requirements.md specs/backend/cybermaster-host-manager-future-plan.md specs/relay/chat-relay-session-migration.md specs/v2/session.md docs/superpowers/plans/2026-08-22-operating-agent-v1.md PseudoBlock/ChatRelay/README.md devplan/workspace-canvas/ProgressionReport.md CONTEXT.md
git commit -m "docs: record operating chat context assembly"
```

## Final verification matrix

Run tests only from their package directories.

### Schema

```powershell
bun test
bun typecheck
```

### Core focused

```powershell
bun test test/session-context-sidecar.test.ts
bun test test/session-ctxpack-admission.test.ts test/session-ctxpack-promotion.test.ts
bun test test/ctxpack-recall.test.ts test/ctxpack-search.test.ts test/ctxpack-materialize.test.ts
bun test test/operating-chat-context.test.ts test/operating-chat-session.test.ts
bun test test/system-context/index.test.ts test/system-context/registry.test.ts
bun test test/session-runner-system-context.test.ts test/session-runner.test.ts
bun test test/session-compaction.test.ts
bun test test/session-projection-transfer.test.ts test/event.test.ts
bun test test/database/session-message-context-migration.test.ts test/database-migration.test.ts
bun run migration --check
bun test test/operating-chat-context-assembly.test.ts
bun typecheck
```

### Core full

```powershell
bun test
```

Classify pre-existing platform failures against the Wave 0 baseline. Do not
weaken focused acceptance tests to accommodate unrelated failures.

### Server

```powershell
bun test test
bun typecheck
```

### OpenCode composition

```powershell
bun test test/server/httpapi-sync.test.ts test/server/httpapi-global.test.ts test/server/httpapi-workspace-routing.test.ts test/server/workspace-routing.test.ts test/control-plane/session-context-readiness.test.ts test/control-plane/session-context-transfer-spool.test.ts test/control-plane/workspace.test.ts test/session/session.test.ts
bun run test:httpapi
bun typecheck
```

Run the full OpenCode test/build matrix only when required by touched
composition or release policy; record known Windows/platform limitations
honestly rather than changing unrelated production code.

### Generated Promise/Effect client

```powershell
bun run check:generated
bun test
bun typecheck
```

### Legacy JavaScript SDK regeneration

From the repository root:

```powershell
bun ./packages/sdk/js/script/build.ts
```

Then from `packages/sdk/js`:

```powershell
bun test
bun typecheck
```

### App cleanup

```powershell
bun run test:unit
bun run test:browser
bun typecheck
bun run build
```

Task 2F's serial production `test:bench` before/after report is mandatory App
acceptance evidence. If any active App session/timeline production path changes
after its `after` run, repeat the serial production benchmark and compare it to
the same baseline before completing this matrix.

### Static boundary checks

From the repository root, read-only commands only:

```powershell
rg -n "session_context_target|MEMORY\.md|USER\.md|SOUL\.md" packages
rg -n "OperatingContext|HistoricalContextStack" packages/app/src
rg -n "v1-composer|v2-composer" packages/app/src/components packages/app/src/pages
rg -n "apiContent|contextRequestHash|operating-chat-v1|model_context_json" packages/schema packages/core
git diff bed110dd46f7a280c56a690ce58f2197f968e1f1..HEAD --check
git status --short
```

Expected results:

- no target table or Hermes memory-file implementation;
- no production browser OperatingContext stack;
- no composer-prefixed CtxPack capability target;
- private payload fields exist only in Schema/Core private context paths and
  the authenticated sync transport;
- the Promise/Effect diff is generator-owned and limited to the content-free
  event marker; the legacy SDK generator additionally reflects versioned sync;
  and
- only intended implementation/documentation files differ.

## Manual smoke

1. Start `opencode web` on the normal combined listener.
2. Open a workspace with an OperatingChat block and at least two CtxPacks.
3. Drop an explicit CtxPack into OperatingChat, send a non-trivial prompt, and
   confirm materialization plus normal streaming/tools/approval.
4. Confirm the transcript displays only the typed prompt.
5. Reload and send a follow-up that depends on recalled context.
6. Queue and steer prompts during a tool turn; confirm existing delivery
   semantics.
7. Reset the OperatingChat binding; confirm the new Session starts a new profile
   and the old transcript remains readable.
8. Run the same prompt in a generic Session and confirm no automatic recall.
9. With two same-version managed hosts, live-sync an enriched Session and confirm
   the destination follow-up uses exact historical context while its global
   event stream contains no recalled text. Attempt to warp both an empty Session
   and the enriched Session; confirm the typed rejection occurs before final
   sync, prompt cancellation, patch/replay/claim, or filesystem mutation.

## Non-negotiable acceptance gates

| Gate | Required result |
| --- | --- |
| One context runtime | SessionV2 alone owns admission, history, tools, and compaction |
| Stable prefix | Context Epoch baseline is durable and byte-stable within a generation/across ordinary turns and restart; agent/profile changes replace the private epoch before the next provider call and never enter public `ContextUpdated` |
| Exact replay | Historical V2 user `apiContent` is identical at canonical lowering |
| Clean transcript | User messages stay user-authored; public checkpoints contain no recalled fragments |
| First-admission recall | Exact retry performs zero recall/materialization work |
| Retry conflict | Same ID with changed explicit identity, hash, or label fails; concurrent losers record neither a sidecar nor CtxPack usage |
| Bounded selection | Explicit-first, max 4 auto, max 8 combined, existing byte/token budget |
| Final budget | Rendered wrapper + provenance + fragments fit both limits; explicit overflow rejects and each oversized automatic candidate is skipped while later fitting candidates remain eligible |
| Capability safety | Unauthorized/deleted/stale context never reaches sidecar or model |
| No auto orphans | Automatic recall writes no ContextCapsule row before admission |
| Failure honesty | Explicit errors reject; automatic errors yield sanitized unavailable status |
| Sidecar integrity | One strict decoder per input/compaction form recomputes and verifies canonical hashes, byte lengths, and token estimates on retry, runner, compactor, export, and restore |
| Compaction continuity | Enriched facts reach only the private checkpoint sidecar; public event stays clean and full durable rows remain |
| Profile isolation | Two OperatingChat blocks resolve distinct real instance targets |
| Reset race | Generation/revision revalidation prevents a stale binding commit |
| Actor honesty | Missing identity never recalls under a synthesized user |
| Composer alignment | Browser explicit materialization and Core admission use the same canonical target |
| Generic isolation | Generic sessions receive no automatic recall |
| No new authority | No target table, second database, browser context store, or event stream |
| Private transfer | Empty-destination import, 512-KiB/count-bounded paged history/live repair, and same-workspace replication preserve sidecars plus epoch; an existing event with a missing projection fails explicitly unless a later retained authoritative revert proves intentional deletion of that exact target, while a retained revert with a still-present target also fails; reverted V2 input/private-compaction imports finish atomically without unresolved markers; oversized public/private records are chunked; every Session warp fails before sync/cancel or other effects; changed snapshots restart and mismatched peers fail before degradation |
| Transfer authorization | Network v1 requires a configured valid host credential plus HTTPS, literal `127/8`/`::1`, or equivalent confidential transport; admin sync and proof-bearing prompts reject redirects, and open/plain-remote listeners cannot negotiate or transfer private state |
| Coordinated activation | No first V2 marker/checkpoint is created until every peer negotiates v1; managed admission requires the control plane's request token plus a commit-spanning permit, and non-v1 peers cannot join after transfer-required rows or retained marker/sentinel events exist, including reverted ones |
| Public cleanliness | EventV2/global SSE never carry a private envelope; authenticated sync hints require version negotiation and V2 admission exposes only the content-free marker |
| Surface restraint | No new user-facing Session endpoint/request/private payload; public events gain only the content-free marker, while the experimental administrator sync contract is the explicit generated private-transfer exception |
| One provider turn | Existing single explicit `llm.stream(request)` invariant remains |

## Rollback

Rollback is code-only and must preserve new data:

1. Keep the V2 sidecar decoder even if automatic recall is disabled.
2. Disable OperatingChat automatic recall/profile policy first.
3. Revert runner V2 lowering only after a compatibility reader can still render
   already admitted V2 rows.
4. Keep the private compaction-sidecar decoder and nullable column while any
   sentinel-bearing checkpoint remains.
5. Keep private-transfer decoding, refuse mixed-version sync while any V1/V2
   sidecar or epoch remains, and continue rejecting every Session warp until a
   durable maintenance-fence design lands.
6. Do not delete or rewrite Session inputs, sidecars, messages, CtxPacks, or
   Context Epochs.
7. Do not restore the browser OperatingContext stack.

Rollback does not drop or reverse the additive nullable column. Any sync-shape
rollback must regenerate the legacy SDK and retain a compatibility guard for
sidecar-bearing Sessions. It cannot undo legitimate prompts or provider/tool
side effects produced while the feature was active.

## Explicit deferrals

- automatic recall policy configuration UI;
- per-user long-term memory/profile records;
- vector or embedding retrieval;
- nested instruction discovery beyond current OpenCode behavior;
- user-visible inspection of private sidecar metadata;
- reconstruction of private input/compaction sidecars from the public EventV2
  log alone;
- ChatRelay-to-OperatingAgent event forwarding;
- clustered Session execution and durable provider-attempt recovery; and
- deletion/archival policy for Sessions replaced by OperatingChat reset.
