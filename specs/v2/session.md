# Session API

## Current V2 Core Slice

The Effect-native core facade treats prompt recording and execution as separate responsibilities:

```text
sessions.create({ id?, location, ... })
  -> omitted ID generates one internal Session ID
  -> supplied ID creates the Session when absent
  -> reused ID returns the existing Session identity

sessions.prompt({ id?, sessionID, prompt, delivery?, resume? })
  -> omitted ID generates one internal message ID
  -> supplied ID inserts one durable Session inbox row when absent
  -> exact reuse returns the same admission receipt
  -> reusing one message ID for another Session, prompt, or delivery mode fails
  -> exact retry schedules another wake unless resume is false
  -> resume omitted or true schedules execution after admission
  -> resume false admits only

sessions.interrupt(sessionID)
  -> interrupts active execution on this process
  -> waits for runner cleanup and settlement
  -> clears a coalesced follow-up wake already registered with this coordinator
  -> preserves durable inbox rows for a later wake or resume
  -> idle or missing Session is a no-op

sessions.active()
  -> snapshots foreground Session drains owned by this process
  -> returns only active Session IDs with { type: "running" }
  -> absence means inactive; activity is not durable across process restarts
```

`session_input` is the durable admission inbox. `PromptAdmitted` records and projects accepted input so pending queue state can be replayed, replicated, and observed by clients. Admitted inputs remain outside model-visible Session history until the serialized runner publishes `Prompted`. Its projector atomically writes the visible user message and marks the inbox row promoted in the same event transaction. The V1-to-V2 shadow bridge publishes the same `Prompted` event for already-visible V1 prompts.

`admittedSeq` is the durable Session event sequence of `PromptAdmitted`. Clients may use the admission event to represent queued input before `Prompted` makes it part of visible conversation history.

Execution routing starts from only the Session ID:

```text
SessionExecution.resume(sessionID)
-> SessionStore.get(sessionID)
-> LocationServiceMap.get(session.location)
-> SessionRunner.run({ sessionID, force? })
```

`SessionExecution` and the read-side `SessionStore` are process-global. `SessionRunner`, catalog, model resolver, tool registry, permission state, and filesystem are cached per Location. No layer takes a Session ID. An omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.

The local runner issues one explicit `llm.stream(request)` per provider turn, projects each complete local tool call durably before eagerly starting its structured child execution, awaits every started tool fiber after provider-stream closure, and reloads projected history once before continuation. Promoting any new user input resets the selected agent's configured provider-turn allowance; multiple steers promoted at one boundary reset it once. Tool settlement events carry the owning assistant message ID because provider-local call IDs may repeat across turns. Before assembling a provider request, the runner durably fails any local tool still projected as `running` from a previous process with `Tool execution interrupted`; abandoned side effects are never silently replayed.

Projected hosted tools preserve call-side and settlement-side provider metadata separately so settlement and interruption recovery cannot erase continuation identifiers. Provider-native reasoning and provider metadata replay only while the historical assistant model matches the selected continuation model; after a model switch, visible reasoning text remains ordinary assistant text and provider-native metadata is omitted.

## Context Epochs

V2 Sessions persist the exact privileged System Context shown to the model. A Context Epoch stores one immutable provider-cache baseline and a model-hidden structured snapshot used to compare independently observed Context Sources. Environment facts, the host-local date, ambient global/upward-project `AGENTS.md` files, and selected-agent available-skill guidance are the initial sources. Location-wide sources come from the System Context Registry; selected-agent guidance composes with them immediately before Context Epoch admission.

The first complete observation initializes the epoch before any pending prompt becomes model-visible. If initial context is temporarily unavailable, execution stops while the prompt remains pending and retryable. On later provider turns, the runner promotes eligible input first, then reconciles current sources at the safe boundary. Changed context becomes one durable chronological System message, and its event commit advances the epoch snapshot atomically.

```text
Client            Runner                         System Context Registry       Context Epoch Store       Session History         LLM
   │                 │                                      │                           │                       │                 │
   ├─ Admit prompt ─────────────────────────────────────────────────────────────────────────────────────────────▶                 │
   │                 │                                      │                           │                       │                 │
   │                 ├─ Observe initial context ────────────▶                           │                       │                 │
   │                 │                                      │                           │                       │                 │
   │                 ◀─ Complete baseline or unavailable ───┤                           │                       │                 │
   │                 │                                      │                           │                       │                 │
   │                 ├─ Initialize missing epoch ───────────────────────────────────────▶                       │                 │
   │                 │                                      │                           │                       │                 │
   │                 ├─ Promote eligible input ─────────────────────────────────────────────────────────────────▶                 │
   │                 │                                      │                           │                       │                 │
   │                 ├─ Reconcile at safe boundary ─────────▶                           │                       │                 │
   │                 │                                      │                           │                       │                 │
   │                 ◀─ Unchanged or chronological update ──┤                           │                       │                 │
   │                 │                                      │                           │                       │                 │
   │                 ├─ Advance snapshot atomically with update ────────────────────────▶                       │                 │
   │                 │                                      │                           │                       │                 │
   │                 ├─ Baseline + chronological history ─────────────────────────────────────────────────────────────────────────▶
```

Agent and model selection are provider-turn scoped. A switch admitted after the current safe provider-turn boundary applies to the next provider turn without restarting the current turn or replacing the baseline. Agent-specific skill guidance remains a Context Source, so changed guidance is admitted as a chronological System message. A completed compaction causes the next provider attempt to render a fresh baseline directly from current complete context. A Session move clears the epoch so the destination Location initializes a complete baseline on its next run.

```text
Session                            Epoch
   │                                 │
   ├─ initialize complete baseline ──▶
   │                                 │
   │                                 ├─────────────────────────────────╮
   │                                 │ reconcile chronological update  │
   │                                 ◀─────────────────────────────────╯
   │                                 │
   ├─ completed compaction ──────────▶
   │                                 ├─ render fresh baseline
   │                                 │
   ├─ clear after Location move ─────▶
```

Ambient project discovery canonicalizes and contains traversal within the project root and honors `OPENCODE_DISABLE_PROJECT_CONFIG`. An unavailable observation preserves the previously admitted value. A confirmed partial instruction removal emits the complete remaining aggregate with explicit supersession text; removing the final instruction emits a revocation message.

Current Context Epoch follow-ups:

- Add configured, remote, and nested instruction sources with explicit precedence and removal semantics.
- Add durable post-crash continuation recovery for promoted or provider-dispatched work.
- Add explicit manual compaction on top of automatic request-budget compaction.
- Add operational metrics for observation latency, unavailable sources, contention, baseline size, and chronological-update growth.
- Consider watcher-backed per-file caching only if measurements show direct safe-boundary observation is too expensive.
- Expose plugin-defined Context Sources only after plugin reload and scoped cleanup semantics are designed.
- Add clustered Session execution ownership and stale-runtime fencing.

## OperatingChat Context Profile (approved target)

The approved OperatingChat follow-up keeps the generic SessionV2 runtime and
adds a session-aware context profile rather than a second OperatingContext
engine. The complete design is
[OperatingChat Session Context Assembly](../../docs/superpowers/specs/2026-08-25-operating-chat-context-assembly-design.md),
with implementation ordered by the companion
[parallel plan](../../docs/superpowers/plans/2026-08-25-operating-chat-context-assembly.md).

The target separates durable history from the active model view:

- `session_message` remains the clean chronological transcript;
- `session_input.context_snapshot_json` becomes a backward-compatible V1/V2
  sidecar contract;
- a V2 sidecar stores exact canonical model-facing user text (`apiContent`), its
  hash and renderer version, explicit/automatic CtxPack provenance, the explicit
  request fingerprint, and sanitized recall state;
- the runner selects active history using the existing epoch/compaction rules
  and replaces only the outgoing user text with stored V2 `apiContent`; and
- the browser and ordinary Session message APIs continue to expose clean user
  text.

OperatingChat identity is resolved from its existing live
FunctionalityInstance binding by Session ID. This profile contributes a
session-specific host Context Source and enables automatic CtxPack recall. It is
not registered in the argument-free Location-scoped System Context Registry,
because two Sessions in one Location may represent different blocks. Generic
Sessions do not receive automatic recall.

The selected agent system instruction and OperatingChat host profile also join
the Context Epoch algebra as replacement-only private sources. Agent/profile
changes produce no public chronological System message while the current
baseline remains immutable; an add/change/removal installs a fresh private epoch
at the next safe provider-turn boundary, and completed compaction may do the
same. Per-turn CtxPack content is attached to the user sidecar, never
to the changing system prefix.

First admission validates/materializes explicit attachments, then optionally
fills the remaining existing budget from a deterministic workspace-scoped
FTS/BM25 recall. The versioned policy scans at most 16 automatic candidates;
they are authorized immutable reads and do not
create ContextCapsule rows; the admitted sidecar is their durable copy. Final
rendered wrapper, provenance, and fragment bytes must fit both limits: explicit
overflow rejects and automatic overflow trims the ranked tail. Explicit
selection fails closed; automatic recall fails open with a sanitized status,
including when user identity is absent. A stored `contextRequestHash` covers
ordered explicit capsule/pack identity, content hashes, and labels. Same-ID
retries must match it and reuse the original sidecar without searching again.
Concurrent losers strictly validate the winner, and only the newly committed
admission records CtxPack usage. One strict decoder per input/compaction form
recomputes canonical hashes, byte lengths, and token estimates for every
authoritative read; valid-shape tampering fails closed.

The App may project the current OperatingChat functionality-instance target to
the existing explicit materialization endpoint; an established generic Session
uses `chat-instance:<sessionID>`/`builtin:chat`, while a no-Session composer
disables CtxPack drop. This projection is not authority. Admission reruns the
authoritative lookup and revalidates the complete Session workspace/location/
directory plus FunctionalityInstance generation/revision proof in its event
transaction, so reset, move/warp, and stale-browser races fail closed.

Compaction receives enriched V2 user content for a Core-private checkpoint
stored in nullable `session_message.model_context_json`. Its public durable
event retains a fixed sentinel and clean recent serialization, so recalled
fragments do not enter Session event/history APIs. The runner selects the
private summary/recent sidecar after older rows leave active history. Full
messages, inputs, sidecars, and events remain durable; excluded pre-checkpoint
sidecars are not falsely replayed as independent active messages. This requires
one additive nullable column but no public Session field. The existing
compactor, thresholds, recent-tail rules, and single-provider-turn invariant
remain unchanged.

V2 admission marks required private input context with the optional,
content-free `PromptAdmitted.modelContextVersion: 2`; the projector writes a
pending database marker until the atomic sidecar commit replaces it. Private
sidecars and the Context Epoch survive ordinary database restart/reopen and
remain absent from EventV2/global SSE. A typed, versioned
`SessionProjectionTransfer` bundle preserves them across empty-destination import and
same-workspace host sync through the existing sync routes only when a valid,
configured host credential is present over HTTPS, literal `127.0.0.0/8`/`::1`,
or an equivalent confidential transport; proof-bearing prompts/private sync do
not follow redirects, and an otherwise-open or non-loopback plain-HTTP listener
refuses private transfer. Live public sync records are only coalesced wake hints
for authoritative history pull. Private repair handles at most 128 Session
aggregates per snapshot; each serialized page is at most 512 KiB and carries at
most 256 complete public events or 64 chunks for one oversized public/private
record. It spools both forms and atomically applies the fixed source-high-
water snapshot. A missing private target is accepted only when a content-free
record binds it to a later authoritative revert in that same snapshot and the
existing projector deletion predicate proves the exact deletion; otherwise it
is a typed projection defect. A retained revert with a still-present target is
also a projection defect and never causes implicit projector replay. Bounded replay is idempotent
begin/append/finalize. Phase 1
rejects every Session workspace/location warp unconditionally before final sync,
prompt cancellation, replay, claim, or filesystem mutation. Raw public EventV2 replay
without the private bundle is insufficient and required pending/sentinel state
fails closed. V2 marker/checkpoint creation remains gated until every managed
peer has negotiated transfer v1. The experimental
control plane treats every non-null V1/V2 input sidecar, pending marker, private
checkpoint, Context Epoch, or retained durable V2 marker/private-sentinel event
(including one later reverted) as transfer-required and refuses a non-v1 peer once
the union reported by self and every drained worker is non-empty; local compaction
of an already-enriched Session may still create the private checkpoint required
for correctness. The experimental sync shape and legacy JavaScript SDK reflect this admin transport;
authoritative generation also refreshes the Promise/Effect clients for the
content-free event marker. Ordinary Session operations do not expose private
payloads.

This subsection records an approved target, not current implementation status.
The V1 Runtime Context Parity table below must be updated only when its code and
verification land.

## Automatic Compaction

Before each provider turn, the runner estimates the complete model-visible request and compares it with the selected model's context window minus absolute reserved headroom. The reserve is the greater of the requested/model output allowance and configured `compaction.buffer`. When the request exceeds that budget and older complete turns are available, the runner compacts before executing the pending turn.

Compaction keeps the full transcript durable while replacing its active model representation with one hidden checkpoint containing a structured rolling summary and token-bounded serialized recent context. Provider-native assistant, reasoning, and tool messages never survive across the boundary, avoiding signature and encrypted-reasoning failures when the earlier prefix changes.

`session.next.compaction.started.1` durably identifies the attempt. Compaction deltas are live-only progress. `session.next.compaction.ended.1` durably stores the final summary and serialized recent context; only this completed event projects a model-visible compaction message. On the next provider attempt, the runner observes that completed compaction and directly renders a fresh Context Epoch baseline. A failed or interrupted attempt therefore leaves the previous history boundary active.

Repeated compactions update the previous structured summary with newly compacted messages. The runner then reloads projected history and executes the original pending turn.

When a provider rejects a request as context overflow before durable assistant output or tool execution, the runner attempts one overflow-triggered compaction even when the local estimate did not predict pressure. A completed checkpoint rebuilds the same logical provider turn with one remaining physical attempt. A second overflow, unavailable compaction, or overflow after durable output becomes the ordinary terminal failure; recovery never loops or replays partial side effects. Deterministic old tool-result pruning remains a separate follow-up.

## V1 Runtime Context Parity

This is the canonical checklist for model-visible runtime context still needed before the V2 runner replaces V1. Keep each behavior in its owning boundary rather than treating all model-visible text as a durable Context Source. Update this table in the PR that changes a status.

Status: `complete` is usable in the native V2 path, `partial` covers only part of V1 behavior, and `missing` has no native V2 equivalent.

| Boundary                   | Behavior                                                                 | Status   | Remaining V2 work                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Durable Context Source     | Environment facts and host-local date                                    | partial  | Add selected provider/model identity without making model selection a stale Location-wide value.                                       |
| Durable Context Source     | Global and upward project instructions                                   | partial  | Decide whether V2 also discovers legacy `CLAUDE.md` and deprecated `CONTEXT.md`.                                                       |
| Durable Context Source     | Configured local/glob and remote URL instructions                        | missing  | Add independent sources with explicit precedence, unavailable, and removal semantics.                                                  |
| Durable Context Source     | Nearby nested instructions discovered after successful reads             | missing  | Persist discoveries and admit them at the next safe provider-turn boundary.                                                            |
| Durable Context Source     | Selected-agent available skill guidance and skill-body loading           | partial  | Guidance and body exposure are permission-filtered; remove globally denied skill definitions during request-time tool materialization. |
| Per-turn request assembly  | Placement, selected model, chronological history, and canonical lowering | complete | None.                                                                                                                                  |
| Per-turn request assembly  | Selected agent, agent prompt, and effective permissions                  | partial  | V2 uses selected-agent permissions for skill guidance and tool authorization; still apply the agent system prompt and request policy.  |
| Per-turn request assembly  | Provider/model-specific base instructions                                | missing  | Select the provider-family baseline unless the effective agent overrides it.                                                           |
| Per-turn request assembly  | Policy-filtered built-in, MCP, plugin, and structured-output tools       | partial  | Materialize definitions for the effective agent and request.                                                                           |
| Per-turn request assembly  | Per-prompt system text and tool overrides                                | missing  | Design admission and durable replay semantics before exposing them.                                                                    |
| Per-turn request assembly  | Steering, plan/build-switch, and final-step reminders                    | missing  | Add only reminders whose behavior remains part of V2.                                                                                  |
| Per-turn request assembly  | Plugin message, system, parameter, and header transforms                 | missing  | Design V2 plugin hooks and lifecycle semantics.                                                                                        |
| Per-turn request assembly  | Model variants and request settings                                      | partial  | Apply effective agent options and future plugin-mutated request settings.                                                              |
| Per-turn request assembly  | Structured-output policy                                                 | missing  | Add prompt format, generated tool, tool choice, and model-visible policy together.                                                     |
| Per-turn request assembly  | Automatic/context-pressure compaction                                    | complete | V2 initiates automatic and overflow-triggered compaction, then rebuilds the baseline from the completed checkpoint.                    |
| Prompt/reference expansion | Durable typed prompt attachments                                         | complete | None.                                                                                                                                  |
| Prompt/reference expansion | Native template and `@` mention expansion                                | missing  | Parse and resolve native V2 prompt input before durable admission.                                                                     |
| Prompt/reference expansion | File, directory, media, and MCP-resource materialization                 | partial  | Materialize and normalize sources instead of lowering unresolved attachment metadata.                                                  |
| Prompt/reference expansion | Agent-reference expansion                                                | missing  | Produce permission-aware model-visible task guidance.                                                                                  |
| Prompt/reference expansion | Configured-reference expansion                                           | missing  | Resolve aliases and emit durable model-visible reference context or failures.                                                          |
| Prompt/reference expansion | Native synthetic expansion replay                                        | partial  | V2 replays synthetic messages but only the V1 compatibility path creates them.                                                         |

Provider timeout, retry, and watchdog policy is intentionally deferred. The runner does not impose a universal provider-stream inactivity or absolute timeout. A future slice should design configurable policy around provider behavior, durable failure reporting, and local drain-chain release rather than hardcoding one default for every provider.

Inbox delivery is explicit:

- `steer` inputs promote at the next safe provider-turn boundary, including continuation inside the current drain.
- `queue` inputs remain in a FIFO while the current drain requires continuation. When the Session would otherwise become idle, the runner promotes exactly one queued input, then reevaluates continuation before promoting another.

Execution has two entry points:

- `run` is an explicit resume. It joins any active execution or starts a forced drain while idle. A forced drain bypasses the no-eligible-input guard, but preparation may still fail before a provider attempt.
- `wake` reports newly recorded durable inbox work. Repeated wakes coalesce. A wake calls the provider only when it can promote eligible input.

Post-crash continuation recovery is intentionally deferred. A wake does not infer that ambiguous provider work is safe to retry after an input has already been promoted. Explicit `run` may deliberately continue from durable projected history. A future recovery slice should model provider-dispatch ambiguity, required continuation, queued-input promotion, retry policy, and visible recovery status together. It must not assume an enclosing durable execution identity that the Session model does not otherwise need.

A process-global `SessionRunCoordinator` serializes execution for each local Session while allowing different Sessions to run concurrently. Resumes join active execution, overlapping wakes coalesce into one follow-up, and interruption stops current process-local execution without deleting durable inbox work. The runner enters the Session's current Location when execution starts and fences each new provider turn against that Location.

The coordinator's active registry is also the source for `sessions.active()`. It represents only foreground Session drains owned by the current process; background subagents and tasks do not add parent Sessions to this registry. The snapshot is runtime state and is empty after a process restart.

Inbox promotion coalesces pending steers in durable admission order. Once continuation would otherwise end, it promotes one queued input at a time in FIFO order. Add explicit inbox backlog and steering-batch limits before exposing broad multi-caller admission or untrusted queue growth.

Eager local-tool execution is intentionally unbounded in the current local slice. This minimizes tool latency but does not increase SQLite settlement throughput: Session-event publication remains serialized per provider turn. Before broadening exposure, revisit per-turn call limits, output truncation, and operational backpressure using observed workloads. The `session.next.*` event schemas remain experimental and unshipped; databases created by earlier experimental builds are disposable rather than compatibility targets.

The synchronized `session.next.*` event family and projected Session-message model predate this branch. This slice refines their replay contract: projected Session messages retain their source aggregate sequence so canonical context ordering and `sessions.messages(...)` pagination follow durable event order even when caller-supplied IDs or timestamps do not. Consumers can use `sessions.events({ sessionID, after? })` to replay durable `session.next.*` events after an aggregate sequence cursor, then tail durable events without a race. Live-only text, reasoning, and tool-input fragments remain available through EventV2 subscriptions for connected renderers; they are intentionally absent from the replayable Session stream.

The first `sessions.events(...)` contract is durable-only during both replay and live tailing. This keeps one cursor equal to one persisted aggregate sequence and is sufficient for reconnect-safe consumers. A later UI-facing API may optionally interleave live-only deltas while connected, but those fragments must remain explicitly ephemeral: they cannot advance the durable cursor, replay after reconnect, or be mistaken for publication boundaries.

`sessions.history({ sessionID, after?, limit? })` is the finite counterpart for request/response consumers. `after` is an exclusive aggregate sequence, and omission starts before sequence zero. The response is `{ data, hasMore }`; callers derive the next `after` from the final event's durable sequence when `hasMore` is true. Public durable Session events are selected before pagination, which permits gaps from private or historical aggregate events while preserving strictly increasing unique sequences. The log has a moving head, so events committed between pages may appear on the next page.

The finite endpoint is `GET /api/session/:sessionID/history`, uses the normal Session Location and authorization middleware, defaults to 50 events, and accepts at most 100. It returns only events in the public durable Session schema. The existing `sessions.events()` replay-and-tail stream is unchanged.

Durable event tail wakeups are advisory and edge-triggered. Each active tail owns one sliding-capacity-1 dirty signal for its aggregate and re-queries SQLite after a wake. Repeated commits coalesce while the tail is busy because durable rows, not in-memory notifications, preserve every event and sequence. Subscribe and register the dirty signal before historical replay, then remove it when the tail closes, so replay handoff cannot miss a commit and inactive aggregates retain no wake state.

Event replay owner claims are separate from clustered Session execution ownership. The former already fences synchronized projection reconstruction; the latter still needs distributed active-run acquisition, stale-runtime rejection, interruption, and placement orchestration.

## Current Tool Registry Slice

`ApplicationTools` stores process-scoped application registrations shared by all Locations. Each Location-scoped `ToolRegistry` overlays Location registrations, materializes definitions, and owns lookup and settlement. Closing a contribution scope removes its definition and rebuilds the advertised catalog. Trusted tool executors capture and perform authorization; the registry applies catalog visibility filtering, decodes input, invokes the retained handler, validates output, and settles failures as typed tool-result errors.

When a Session omits `agent`, both execution and permission evaluation use the default `build` agent. A caller must not observe `build` model behavior while permission checks silently evaluate an empty no-agent policy.

The first built-in contribution is bounded `read`:

```text
resolve one path relative to the Location or a named project reference
-> reject absolute paths, path escapes, and symlink escapes
-> authorize read against the canonical resource identity
-> for a file: return UTF-8 text or base64 binary content; page oversized UTF-8 text by bounded line ranges
-> for a directory: return direct children in directory-first alphabetical order
-> page directory results with one-based offset and next cursor
```

V2 `bash` uses the normal permission semantics: configured agent rules plus saved project approvals, with `ask` as the default when no rule matches. Bash is not sandboxed: the spawned shell runs with the host user's filesystem, process, and network authority. Structured external `workdir` resolution remains an enforced `external_directory` authority check. Best-effort scans of absolute command arguments produce advisory warnings only; they are not sandbox boundaries and do not request or enforce `external_directory` approval.

The first V2 `apply_patch` leaf supports add, update, and delete hunks. It parses every hunk, resolves every mutation target, approves external directories, approves one edit batch, and preflights approved update/delete targets before committing operations sequentially. A later commit-time failure leaves earlier operations applied and returns an explicit partial-application report. Moves and atomic rollback remain separate follow-ups rather than implied behavior.

### Current Runner Follow-Ups

- Keep eager structured local-tool settlement: durably record each complete call, start its child execution immediately, await all started settlements after provider-turn consumption, persist every result, and reload history once before continuation.
- Buffer or coalesce streamed deltas before rewriting growing assistant projections.
- Revisit additional covering indexes as larger-history query shapes become concrete.
- Design any global multi-Session event stream separately; the finite history API deliberately reads one authorized Session aggregate and does not change global Event publication.
- Decide whether UI-facing Session subscriptions should optionally interleave ephemeral deltas while connected without advancing the durable cursor.
- Add provider-aware context control for provider-executed tool results. Generic text truncation cannot replace provider-native structured payloads that must round-trip exactly.

## Remove Dedicated `session.init` Route

The dedicated `POST /session/:sessionID/init` endpoint exists only as a compatibility wrapper around the normal `/init` command flow.

Current behavior:

- the route calls `SessionPrompt.command(...)`
- it sends `Command.Default.INIT`
- it does not provide distinct session-core behavior beyond running the existing init command in an existing session

V2 plan:

- remove the dedicated `session.init` endpoint
- rely on the normal `/init` command flow instead
- avoid reintroducing `Session.initialize`-style special cases in the session service layer
