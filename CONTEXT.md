# OpenCode Session Runtime

OpenCode sessions preserve durable conversational history while assembling the runtime context an agent needs to act correctly in its current environment.

The Model-Facing Input Sidecar, API Content, Context Request Hash, and
Automatic Recall vocabulary below records the approved OperatingChat target in
`docs/superpowers/specs/2026-08-25-operating-chat-context-assembly-design.md`.
It becomes current runtime behavior only when that implementation and its
verification land.

## Language

**System Context**:
The structured collection of contextual facts presented to the model as initial instructions and chronological updates.
_Avoid_: System prompt

**Session History**:
The projected chronological conversation selected for a provider turn after applying the active compaction and **Context Epoch** cutoffs.
_Avoid_: Session Context

**Context Source**:
One independently observed typed value within the **System Context**, represented by a stable key, JSON codec, infallible loader, pure baseline/update renderers, and an optional removal renderer for dynamic sources.
_Avoid_: Prompt fragment

**System Context Registry**:
The Location-scoped registry of ordered, scoped producers that contribute to the current **System Context**.

**Mid-Conversation System Message**:
A durable chronological instruction that tells the model the newly effective state of a changed **Context Source**.
_Avoid_: System update, system notification, raw text diff

**Context Epoch**:
The span during which one initially rendered **System Context** remains the immutable provider-cache baseline, ending at completed compaction, Session movement, or an incompatible context transition that requires a fresh baseline.

**Baseline System Context**:
The full **System Context** rendered at the start of a **Context Epoch**.
_Avoid_: Live system prompt

**Context Snapshot**:
The overwriteable model-hidden JSON state used to compare each **Context Source** with the value last admitted to a provider turn.

**Unavailable Context**:
An expected temporary inability to observe a **Context Source** value; the runtime retains its prior effective state and emits no update, or omits it until first successfully loaded.

**Safe Provider-Turn Boundary**:
The point immediately before a provider call, after durable input promotion and any required tool settlement, where context changes may be admitted chronologically.

**Admitted Prompt**:
A durable user input accepted into the Session inbox but not yet included in **Session History**.

**Prompt Promotion**:
The durable transition that removes an **Admitted Prompt** from pending input and appends its user message to **Session History**.

**Clean Transcript Content**:
The user-authored text and attachments projected through ordinary Session message APIs and UI surfaces, excluding host-injected recalled context.

**Model-Facing Input Sidecar**:
An immutable, versioned record attached to one admitted Session input that preserves the exact canonical user text presented to the provider layer plus compact provenance and hashes. It does not replace **Clean Transcript Content**.
_Avoid_: Hidden message, second transcript

**API Content**:
The exact normalized pre-provider user text stored in a **Model-Facing Input Sidecar** and replayed for that historical message. A provider adapter may subsequently encode it into provider-specific wire format.

**Context Request Hash**:
The deterministic hash of ordered caller-selected explicit capsule identity, CtxPack identity, content hash, and label used to reconcile an exact prompt retry. Automatically recalled results are excluded because an exact retry reuses the stored sidecar rather than searching again.

**Context Target Projection**:
An App-internal instance/functionality pair carried to the explicit CtxPack materialization endpoint. It helps create a capsule for the correct target but is never admission authority; Core independently resolves and revalidates the live binding.

**Automatic Recall**:
A first-admission-only, policy-controlled selection of authorized CtxPack material that is appended to the current turn's **API Content**. Automatic Recall is distinct from stable **System Context** and from a model-invoked search tool.

**Provider Turn**:
One request to a model provider and the response projected from that request.

**Session Drain**:
One process-local execution span that promotes eligible input and runs required **Provider Turns** until no immediate continuation remains. A Session Drain has no durable identity or transcript boundary.

**Model Tool Output**:
The bounded projection of a Core-executed tool result persisted in Session history and replayed to the model. A tool may shape this projection semantically, but the Tool Registry enforces the final size limit.

**Managed Tool Output File**:
A temporary file created under OpenCode's shared tool-output directory to retain complete output that was too large for Session history.

**Model Request Options**:
Provider-semantic model settings selected from the Catalog and active Session variant before the LLM protocol adapter encodes them for a provider request.
_Avoid_: Request body, wire options

**Generation Controls**:
Provider-neutral sampling and output controls, partitioned from provider semantics and compatibility wire fields when model metadata enters the Catalog.

**Native Continuation Metadata**:
Opaque protocol-shaped data attached to assistant content and required to continue that content natively with a compatible model, such as a reasoning signature or provider-hosted item identifier.

**PTY Environment**:
The host-supplied environment overlay applied by the server when creating a PTY, observed for the request Location and resolved PTY working directory.

**OpenCode Client**:
The generated Promise and Effect APIs derived from the public `HttpApi`; **Embedded OpenCode** shares the Effect API through an in-memory `HttpClient` against the same router and handlers.
_Avoid_: Remote client

**SDK Contract IR**:
The runtime-neutral compiled representation of the authoritative `HttpApi`, preserving encoded and decoded type projections plus transport metadata so independent SDK emitters can choose their public value model and runtime interpreter.

**Embedded OpenCode**:
A scoped in-process host that structurally extends the **OpenCode Client**, supplies an in-memory HTTP transport, and exposes additional same-process capabilities directly.
_Avoid_: Local implementation

**Page**:
A bounded ordered result containing `items` and opaque `previous` and `next` cursor links for navigating the same query in either direction.
_Avoid_: Response envelope

## Relationships

- A **System Context** is an opaque carrier composed from zero or more **Context Sources**.
- **Session History** contains projected conversational messages and admitted **Mid-Conversation System Messages**; the active **Baseline System Context** remains separate provider-request state.
- The **System Context Registry** uses stable-keyed scoped contributions to assemble the current **System Context**; contributor removal naturally removes its sources at the next **Safe Provider-Turn Boundary**.
- A changed **Context Source** may produce one **Mid-Conversation System Message** containing its newly effective state.
- A **Mid-Conversation System Message** persists the exact combined rendered text sent to the model.
- The current **Context Snapshot** advances atomically with the corresponding durable **Mid-Conversation System Message**.
- A **Context Snapshot** stores one codec-encoded JSON value and, for removable dynamic sources, a pre-rendered removal message per stable **Context Source** key.
- Changes from multiple **Context Sources** admitted at one safe boundary combine into one **Mid-Conversation System Message**.
- Context changes are sampled and admitted lazily at a **Safe Provider-Turn Boundary**, never pushed asynchronously when their source changes.
- At a **Safe Provider-Turn Boundary**, newly promoted user input or settled tool results precede any combined **Mid-Conversation System Message**.
- An **Admitted Prompt** is replayable pending input, not yet model-visible **Session History**.
- **Prompt Promotion** atomically consumes the pending inbox entry and appends its model-visible user message.
- **Clean Transcript Content** remains the public Session-message authority even when the provider-facing turn uses richer **API Content**.
- A **Model-Facing Input Sidecar** is keyed by the same message/input ID as its clean user message; it is not an independently ordered transcript record.
- Historical input replay restores stored **API Content** exactly and never re-runs **Automatic Recall**.
- A same-ID exact retry must match the stored **Context Request Hash** as well as Session, prompt, and delivery mode. A changed explicit context request conflicts.
- A concurrent same-ID loser reloads and strictly validates the committed winner. Only the invocation that committed the input/sidecar records CtxPack usage; retries and losers record none.
- The single strict input/compaction sidecar decoders recompute canonical hashes, UTF-8 byte lengths, and token estimates on retry, runner, compactor, export, and restore. Valid-shape tampering fails closed just like malformed JSON.
- The approved OperatingChat profile performs **Automatic Recall** only during first durable admission, after explicit attachments and before the admission commit. Its versioned policy scans at most 16 deterministic candidates; generic Sessions do not gain automatic recall.
- Automatic Recall reads an authorized immutable CtxPack snapshot without creating a durable capsule; the admitted **Model-Facing Input Sidecar** is its durable copy.
- The final rendered injected envelope, including wrapper and provenance, must fit the context byte/token budget. Explicit overflow rejects; automatic candidates are removed from the ranked tail until it fits.
- Missing actor identity produces sanitized unavailable recall rather than a synthesized user. Explicit selection without an actor still rejects.
- The browser's **Context Target Projection** must align explicit capsule creation with the real OperatingChat instance or canonical generic Session target, but Core remains authoritative and rejects stale projections.
- Per-turn recalled text belongs to **API Content**, not the **Baseline System Context**. This preserves the provider-cache prefix while retaining exact historical recall.
- A Session-specific context source is composed by the Session runner and must not be registered as a Location-wide source when two Sessions in one Location may observe different values.
- Selected-agent instructions and the OperatingChat host profile are replacement-only **Context Sources**. Their values stay private within one **Context Epoch**; add/change/removal installs a fresh private baseline at the next **Safe Provider-Turn Boundary** and emits no public **Mid-Conversation System Message**.
- Compaction serializes **API Content** into a private model-context sidecar so recalled facts enter its structured summary and recent tail without entering the public durable event. Pre-checkpoint rows remain durable even when active selection subsequently uses that private checkpoint instead of replaying those rows separately.
- A V2 **Private Context Required Marker** is a content-free field on `PromptAdmitted`; its projector leaves a pending database marker until the atomic sidecar commit replaces it. Pending input and private compaction sentinels always fail closed when their payload is absent or corrupt.
- **Session Projection Transfer** is the versioned Core-private bundle that carries validated input/compaction sidecars and the same-workspace **Context Epoch** beside, never inside, public EventV2 history. Empty-destination import and host sync with a configured valid host credential over HTTPS, literal `127.0.0.0/8`/`::1`, or an equivalent confidential transport must use it; private requests never follow redirects, private transfer is disabled on an otherwise-open/plain-remote listener, and raw public-event replay is not lossless model-context recovery. An already-present event with a missing projected target fails as a projection defect unless the same frozen history proves a later authoritative revert intentionally deleted that exact target; absence alone is never proof. Conversely, a retained revert with a still-present target is a defect, not permission to rerun its projector. This feature does not invent an arbitrary reproject path.
- Public global sync records are emitted only after authenticated transfer-version negotiation and become coalesced wake hints for an authoritative versioned history pull. Private repair discovers at most 128 Session aggregates per batch; every serialized page is at most 512 KiB and carries at most 256 complete public events or 64 chunks for one oversized public/private record. Both forms spool and apply atomically, and replay uses bounded idempotent begin/append/finalize. Same-workspace replication preserves the current epoch. Phase 1 rejects every Session workspace/location warp unconditionally before final sync, prompt cancellation, patch, replay, claim, or filesystem mutation; a safe move requires a later Session-scoped durable maintenance fence. V2 private admission stays disabled until every managed peer has negotiated the transfer version; topology or capability changes invalidate that readiness proof, and a non-v1 peer cannot join once the union of transfer-required state reported by self and every drained worker is non-empty. Transfer-required includes retained durable V2 marker/private-sentinel events even after a later revert removed their projection.
- Steering prompts promote at the next **Safe Provider-Turn Boundary** while the current **Session Drain** still requires continuation. Promoting any newly admitted user input resets the selected agent's provider-turn allowance; multiple prompts promoted at one boundary reset it once.
- A queued prompt does not promote while the current **Session Drain** requires continuation. The runner promotes one queued prompt when the Session would otherwise become idle, then reevaluates continuation before promoting another.
- A **Session Drain** is process-local coordination rather than a durable domain entity. Durable recovery must reason from prompts, projected history, provider attempts, and tool state rather than inventing an enclosing execution identity.
- The first provider turn renders the latest complete **Baseline System Context** and initializes its **Context Snapshot** without emitting a redundant **Mid-Conversation System Message**; unavailable initial context blocks the turn instead of persisting an incomplete baseline.
- Initial **System Context** preparation precedes the first durable input promotion so an unavailable baseline leaves that input pending and retryable; ordinary reconciliation remains after promotion.
- Compaction starts a new **Context Epoch** with a freshly rendered **Baseline System Context** and **Context Snapshot**; prior **Mid-Conversation System Messages** remain durable audit history but leave projected model history.
- A newly registered ordinary core or plugin-defined **Context Source** absent from the current snapshot emits its baseline rendering once at the next **Safe Provider-Turn Boundary**; a replacement-only source instead replaces the private epoch.
- **Context Source** keys are stable and namespaced; duplicate keys fail composition. `SystemContext.combine(...)` preserves caller order; the **System Context Registry** evaluates producers concurrently and combines them in stable contribution-key order so rendered context remains deterministic.
- Each **Context Source** loader returns one coherent typed value. `SystemContext.make(...)` hides that value type so differently typed sources compose uniformly. Its codec compares and stores that value; its pure renderers produce model-visible baseline, update, and removal text only when needed.
- `SystemContext.initialize(...)` observes a composed **System Context** once and produces a fresh **Baseline System Context** with its **Context Snapshot**.
- `SystemContext.reconcile(...)` observes a composed **System Context** once and returns exactly one next action: unchanged, updated, replacement ready, or replacement blocked.
- `SystemContext.replace(...)` renders a fresh generation after completed compaction or another baseline-replacing transition; it reports replacement blocked while previously admitted context is unavailable.
- **Unavailable Context** uses stale-while-revalidate semantics and is distinct from a successfully loaded absence, which may emit removal text.
- Ordinary **Context Source** loaders return values directly; loaders that intentionally use stale-while-revalidate may explicitly return **Unavailable Context**.
- Nested project instruction discovery after successful reads remains a follow-up; when implemented, discovered instructions must be admitted durably at the next **Safe Provider-Turn Boundary**.
- Location-scoped services naturally re-resolve effective context when a moved session next runs in its destination location.
- Moving a Session clears its active **Context Epoch**, so the destination must initialize a complete baseline before another prompt can promote.
- Instruction discovery, source identity, persistence, and file loading belong to the instruction service; the **System Context** abstraction only composes effectful producers and renders loaded values.
- The first instruction-service slice observes global and upward project `AGENTS.md` files as one ordered aggregate **Context Source** at each **Safe Provider-Turn Boundary**.
- Built-in and instruction context producers register through the **System Context Registry** with stable contribution keys. Plugin-defined context registration and hot-reload lifecycle remain a follow-up built on the same scoped registry seam.
- Selected-agent available-skill guidance is a **Context Source** composed with Location-wide registry sources immediately before Context Epoch admission. It lists only names and descriptions permitted for that agent; skill bodies and locations are exposed only through the permission-checked `skill` tool.
- The selected agent and model are sampled when a provider turn starts. Changes admitted after that boundary apply to the next provider turn and do not restart the current turn.
- Selected-agent available-skill guidance remains a **Context Source**. An agent switch also changes the replacement-only agent source, so the next safe boundary replaces the private epoch and captures matching instruction/skills/tools without a public **Mid-Conversation System Message**.
- Local tool authorization and pending permission requests retain the effective agent of the provider turn that issued the call; a later agent switch cannot change that call's policy.
- Context source changes never wake idle sessions; the next naturally scheduled **Safe Provider-Turn Boundary** loads and compares current values lazily.
- Once admitted, a **Mid-Conversation System Message** remains durable even if the following provider attempt fails and is replayed unchanged on retry.
- **Mid-Conversation System Messages** remain durable Session-message history; normal user-facing transcript surfaces may hide them.
- The date **Context Source** initially preserves host-local calendar-date behavior; a configured user timezone may replace that default later.
- A **Context Epoch** begins with one immutable **Baseline System Context**.
- A **Baseline System Context** is stored durably and reused verbatim across process restarts within its **Context Epoch**.
- A **Baseline System Context** durably preserves the exact joined text used for the active provider-cache prefix.
- Completed compaction starts a new **Context Epoch** on the next provider attempt, folding the current complete **System Context** into a fresh baseline and removing earlier **Mid-Conversation System Messages** from active model history.
- A model/provider switch preserves the current **Context Epoch** and chronological conversation history; the new selection applies to the next provider turn.
- **Native Continuation Metadata** remains in durable history. Provider-turn projection includes it only for a successful exact originating provider/model match; failed turns and incompatible models omit opaque metadata, while non-empty visible reasoning lowers to ordinary assistant text after a model switch. This conservative relation may widen only when recorded provider tests establish compatibility.
- **Model Request Options** remain provider-semantic through Catalog resolution. The Session runner maps them into the LLM package's provider-option namespace; the selected protocol adapter alone owns provider wire encoding.
- **Generation Controls**, protocol-semantic **Model Request Options**, and compatibility request body fields are separate Catalog domains. A shared ingestion adapter partitions legacy and models.dev AI-SDK-shaped options before routing.
- The **PTY Environment** is a server concern rather than a Core PTY concern. PTY creation merges caller values, then the host overlay, then Core-forced terminal invariants such as `TERM` and `OPENCODE_TERMINAL`.
- Networked and **Embedded OpenCode** use the same **OpenCode Client** and preserve the full HTTP encoding, routing, middleware, and decoding boundary; only the `HttpClient` transport differs.
- The Effect-native network constructor obtains `HttpClient.HttpClient` from its environment so callers own transport selection, recording, tracing, retries, and tests. Convenience runtimes may provide a fetch transport separately.
- Creating **Embedded OpenCode** is scoped. Closing its owning Scope releases the in-process server resources, database resources, registrations, and fibers.
- **Embedded OpenCode** exposes shared client capabilities and embedded-only capabilities on one object; consumers do not navigate through a nested `.client` property.
- The beta **OpenCode Client** currently uses plural consumer-facing capability groups such as `sessions`; whether the stable Session namespace should instead be singular `session` must be settled before stabilization. Internal server identifiers do not implicitly define public client names.
- Server's concrete `HttpApi` is authoritative for shared **OpenCode Client** capabilities. Codegen compiles its Session group directly; the Effect runtime uses an equivalent Protocol-only projection so generated artifacts remain independent of Core and Server.
- SDK generation reflects the public `HttpApi` once into an **SDK Contract IR**. Promise and Effect emitters share endpoint structure and transport metadata without being required to expose identical public values: an emitter may select encoded wire types, decoded domain types, compile-time brands, runtime validation, and its own execution abstraction independently.
- The first Effect emitter is the rich projection: it exposes decoded Effect-native values, preserves brands and schema transformations, performs runtime schema decoding, and delegates transport interpretation to `HttpApiClient`. Lighter wire-shaped Effect output remains possible through another emitter policy rather than constraining the shared IR.
- The rich Effect emitter regenerates private executable schemas when the **SDK Contract IR** proves that their transport semantics can be reproduced exactly. Contracts with authoritative custom transformations use the import-based Effect emitter against a Protocol-only client projection whose generated transport output is tested against Server's concrete API; the Promise emitter still derives zero-Effect structural wire types from the same IR.
- `@opencode-ai/protocol` owns Session endpoint construction and middleware placement. Server supplies concrete middleware keys to produce the authoritative build-time API; the client projection supplies transport-only keys without importing Core or Server at runtime.
- The first Promise emitter targets the same clean domain-oriented method organization rather than Hey API source compatibility. It returns unwrapped values directly, rejects declared and infrastructure failures, and begins with minimal client-level transport configuration; result wrappers, interceptors, and legacy generated signatures are outside the initial surface.
- The first Promise emitter parses response syntax and trusts its generated structural types; it does not perform runtime structural validation. Malformed payload syntax fails, while a syntactically valid shape mismatch is not detected at the SDK boundary. Standalone validator generation remains an optional future emitter policy.
- Declared Promise-client failures retain their tagged structural wire values and have generated type guards. Consumers do not depend on generated `Error` subclass identity, preserving discrimination across package copies and realms while remaining structurally aligned with Effect domain errors.
- Promise-client infrastructure failures use one generated `ClientError` class with a structured reason such as transport failure, unexpected status, unsupported content type, or malformed response. Promise methods reject with either a tagged declared domain failure or `ClientError`, matching the Effect client's conceptual domain/infrastructure error division.
- Promise methods accept a separate optional per-call transport-options argument containing `AbortSignal` and header overrides. Cancellation and transport metadata do not enter the domain input object; broader interceptor and response-mode APIs remain deferred.
- Promise streaming methods return a lazy `AsyncIterable` directly rather than a Promise-wrapped stream object. Iteration opens the connection, `AbortSignal` cancels it, and ending iteration closes the underlying request; the Effect emitter analogously returns `Stream` directly.
- Promise SSE connection establishment, declared HTTP failures, and infrastructure failures occur during `AsyncIterable` iteration, beginning with its first `next()` call, rather than during synchronous method construction.
- Neither generated streaming runtime automatically reconnects after disconnection. Promise `AsyncIterable` and Effect `Stream` fail explicitly; live consumers refresh and resubscribe, while durable sequence-based resume remains explicit composition above the generated client.
- Promise client construction is synchronous and network-free. It requires `baseUrl`, defaults to `globalThis.fetch`, accepts client-level headers, and merges them with per-call header overrides.
- Effect client construction accepts an explicit `baseUrl` and obtains `HttpClient.HttpClient` from the Effect environment. It does not install fetch or duplicate per-call transport policy; callers transform/provide the client for headers, tracing, retries, recording, and tests, while fiber interruption owns cancellation.
- Promise and Effect emitters each own their generated public type modules. The **SDK Contract IR**, not a physically shared generated type package, is the common source; this permits zero-Effect wire types and rich decoded Effect types to evolve independently.
- Promise and Effect network clients ship from `@opencode-ai/client` behind isolated root and `/effect` exports. The root has no runtime path to Effect; `/effect` imports only Effect, Schema, and Protocol.
- The Effect-native scoped host belongs to `@opencode-ai/sdk-next`, which will assume the existing `@opencode-ai/sdk` name after legacy consumers migrate. Client remains network-only and SDK depends one-way on Client.
- SDK executes Server's assembled `HttpRouter` in memory. It opens no listener and performs no network I/O, while preserving Server routing, middleware, codecs, handlers, and errors.
- The Effect Client and SDK re-export their decoded datatype facade from Schema so callers do not depend on internal package locations or Core's versioned names.
- A capability intended for both networked and **Embedded OpenCode** belongs in the authoritative public `HttpApi`; embedded-only same-process capabilities extend **Embedded OpenCode** separately.
- `sessions.events({ sessionID, after })` is a public durable Session event stream. It verifies the Session, replays durable events after the optional aggregate sequence, continues with newly committed durable events, excludes live-only fragments, and is transported as SSE in both networked and embedded modes.
- `events.subscribe()` is a distinct public instance-wide live stream for Session and non-Session activity. It has no replay guarantee and includes connection, heartbeat, and instance-disposal lifecycle events; consumers recover from disconnection by refreshing authoritative state.
- A Session ID is not an optional filter on `events.subscribe()`: instance-wide live events and durable Session events have different schemas, replay guarantees, cursors, lifecycle events, and failure behavior.
- The initial common OpenCode Client does not expose server-global event aggregation. `events.subscribe()` is bounded to the connected OpenCode instance or workspace; any future cross-instance administrative stream requires a separately designed API.
- `events.subscribe()` does not automatically reconnect after transport loss. The live-only stream fails with `ClientError`; consumers refresh authoritative state before explicitly opening a new subscription because events missed during disconnection cannot be replayed.
- `sessions.events({ sessionID, after })` returns the generated HTTP client's cold durable event stream and does not build reconnection policy into the endpoint or client constructor. Transport loss fails the stream with `ClientError`. Callers may compose an explicit resuming stream above it by retaining the last observed durable sequence and opening a new subscription with `after`; any reusable resume helper remains a separate API design question.
- The stable `sessions.list(...)` design returns a **Page** in both networked and **Embedded OpenCode**; embedded execution does not define a separate unbounded array-returning list operation. The beta client currently preserves the existing HTTP `{ data, cursor }` envelope until emitter-level Page projection is implemented.
- Session list cursors are opaque branded values carrying continuation query and ordering state. Consumers pass them back unchanged and do not inspect storage anchors or encoded filter fields.
- A Session list continuation accepts only its opaque cursor. Scope, filters, ordering, and page size are fixed by the initial query and carried by that cursor.
- `sessions.messages(...)` returns a **Page** and uses the same cursor discipline as `sessions.list(...)`: the initial request supplies `sessionID`, ordering, and page size; continuation supplies `sessionID` plus only an opaque branded message cursor carrying ordering, page size, direction, and message anchor. Using a cursor with another Session is invalid.
- `sessions.message({ sessionID, messageID })` is a required resource lookup. An unknown Session fails with `SessionNotFoundError`; a known Session with an absent or differently owned message fails with `MessageNotFoundError` without disclosing cross-Session ownership. Absence is not represented as `undefined` across the public HTTP boundary.
- `sessions.interrupt({ sessionID })` first verifies that the durable Session exists, failing with `SessionNotFoundError` otherwise. For a known Session, interruption is idempotent: idle, already-settled, or locally unowned execution is a no-op.
- `sessions.active()` snapshots the current process's foreground Session drain registry as a record of Session IDs to `{ type: "running" }`. Missing IDs are inactive; background subagents and tasks do not make their parent Session active, and process restart clears the registry.
- `sessions.context({ sessionID })` preserves the existing message-only operation. It returns projected conversational messages selected as Session context; it does not include or represent the complete provider request context, whose baseline system context and other contributions remain separate.
- **Open question**: Should a future, separately named operation expose the complete provider request context, including baseline system context, selected source contributions, and context-epoch metadata?
- `sessions.prompt(...)` exposes `resume?: boolean`. Omitting it preserves durable admission followed by an advisory execution wake; `resume: false` requests durable admit-only behavior.
- The public operation remains `sessions.prompt(...)`; `SessionInput.admit` is the internal primitive, while the public `Admission` result and `resume` option express its durable admission semantics.
- `sessions.create(...)` accepts an optional `location`. Omission resolves through the connected OpenCode instance's default or current location; an explicit value selects a known location. Networked and embedded transports use the same handler semantics.
- `sessions.switchAgent({ sessionID, agent })` is part of the common client alongside `sessions.switchModel(...)`. It affects subsequent Session activity and fails with `SessionNotFoundError` for an unknown Session.
- The **Embedded OpenCode** Layer delegates to the same scoped creation path; it does not define a second implementation.
- A **PTY Environment** adapter observes plugins in the request Location while passing the resolved PTY working directory to the hook; standalone servers use an empty adapter.
- A **Mid-Conversation System Message** lowers to the provider's native chronological instruction role when supported and to a wrapped chronological fallback otherwise.
- When the effective aggregate instruction set changes, its **Mid-Conversation System Message** includes the complete current ordered set and supersedes the prior aggregate value; when no ambient instructions remain, the message states that previously loaded instructions no longer apply.
- Ambient project instruction discovery honors `OPENCODE_DISABLE_PROJECT_CONFIG`; global instructions remain eligible.
- Oversized textual **Model Tool Output** retains a bounded preview in Session history while its complete text moves to managed tool-output storage. Arbitrary structured-result size is a separate concern.
- One tool settlement receives one aggregate textual limit, using the configured maximum lines or UTF-8 bytes, whichever is reached first. The limit is provider-independent; token pressure belongs to context assembly and compaction.
- Generic truncation preserves the beginning and end of textual output. Tools may apply a more meaningful strategy before the Tool Registry enforces the final limit.
- A truncated **Model Tool Output** identifies its complete text both in the bounded model-visible preview and as a typed managed output path. Managed output paths do not modify the tool's validated structured result.
- A **Managed Tool Output File** is temporary and may expire after its retention period. The bounded **Model Tool Output**, not the file, is the durable replayable record.
- Failure to retain a **Managed Tool Output File** does not change a successful tool operation into a failed one. The Session records an explicitly lossy bounded output without a path, while operators receive diagnostics for the storage failure.
- Once a tool operation succeeds, bounding its **Model Tool Output** and publishing its one durable settlement form an interruption-safe completion region. Raw oversized success is never published before a later correction.
- When a structured-only result would exceed the **Model Tool Output** limit, its validated structured value remains unchanged for Session consumers while model replay uses a bounded textual JSON preview and optional managed output path.
- Existing tool-managed output paths survive generic bounding. A fallback file retains exactly the complete projected text received by the Tool Registry and never claims to reconstruct output already discarded by tool-specific shaping.
- **Managed Tool Output Files** use globally unique names in one shared flat directory. Their absolute paths are readable and searchable by ordinary tools; other absolute paths remain outside Location-scoped filesystem authority.
- Provider-executed tool results remain provider-native transcript facts outside generic Tool Registry bounding. Their context control requires provider-aware pruning or compaction because some providers require exact structured round-trip payloads.

## Client contract architecture

Semantic values that mean the same thing internally and publicly live in the lightweight Schema leaf. Core consumes Schema for domain behavior; Protocol composes Schema values into paths, payloads, envelopes, errors, cursors, and streams; Server imports both, hosts Protocol's exact groups, and owns protocol/domain adaptation. The root Promise client remains zero-Effect, `/effect` depends on Effect plus Schema and Protocol, and `@opencode-ai/sdk-next` composes the scoped in-process host above Client, Core, and Server.

Shared public records are plain objects declared with `Schema.Struct`. A same-name inferred interface gives object records readable TypeScript signatures without constructors, prototypes, or nominal identity; unions retain explicit type aliases.

Before stabilizing the client API:

- Keep additional public schemas in Schema and additional network groups in Protocol; neither package may transitively load databases, Drizzle, Session execution, providers, watchers, native modules, or WASM.
- Keep concrete Location middleware keys in Server while Protocol owns their placement. Client projections may supply transport-only keys, but must prove generated equivalence with Server's concrete API.
- Project the existing list response envelope to the stable client **Page** shape and enforce separate initial-query and cursor-continuation inputs without changing the hosted V2 wire contract.
- Settle the stable consumer namespace (`session` versus the current beta `sessions`) and use an explicit codegen annotation if the consumer name should differ from the server group identifier.
- Preserve V2 route paths, operation IDs, codecs, errors, middleware behavior, and OpenAPI output while making this change.
- Preserve browser-safe `@opencode-ai/client` and `@opencode-ai/client/effect` bundles through import-boundary tests.
- Define embedded-host placement before supporting multiple hosts over one database. Hosts that share durable Session storage must also share process-local Session execution coordination, or each host must receive isolated storage explicitly.
- Keep an embedded request scope alive until any streamed response body finishes. The initial non-streaming Session surface does not exercise this lifetime boundary; Session and instance event streams must do so before joining the embedded client.

## Example dialogue

> **Dev:** "The date changed while the session was active. Should the **Mid-Conversation System Message** say what the old date was?"
> **Domain expert:** "No. Emit the newly effective date so the agent can act on the current **System Context**."

## Flagged ambiguities

- Legacy `experimental.chat.system.transform` can mutate the assembled baseline system prompt arbitrarily, but V2 plugins do not yet expose an equivalent hook. Decide separately whether to port it, replace dynamic uses with plugin-defined **Context Sources**, or narrow its semantics.
