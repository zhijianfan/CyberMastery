You are worker 6 of 7 (Wave 1) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task F — Reusable host-owned session-binding runtime adapter

Goal: extract the common lifecycle used by ChatRelay and MasterAgent into a
reusable runtime adapter factory, keeping each domain's existing API and
business rules. H and I will configure this factory; it must contain NO
ChatRelay or MasterAgent specific text/UI.

## Required factory (all in NEW files under
`packages/app/src/pages/canvas/runtime/adapters/`)

```ts
createHostSessionBindingRegistration<B, ResetCommand>({
  functionalityID,
  get,        // (services, signal) => Promise<{ status: "unbound" } | { status: "bound"; binding: B }>
  ensure,     // (services, signal) => Promise<B>
  reset,      // (binding: B, services, signal) => Promise<void>
  normalizeError, // (error: unknown) => RuntimeStatus-usable classification
  eventTypes, // readonly string[] — generic FunctionalityInstance event + legacy domain events
  validateBinding, // (unknown) => B | undefined
})
```

Resolved projection:

```ts
type HostSessionBindingState<B> =
  | { status: "unbound" }
  | { status: "bound"; binding: B }
```

Required behavior:
1. Wait for workspace ID and `awaitDescriptorPersisted(blockID, signal)` before
   `ensure` (services.workspace from the frozen BlockRuntimeServices).
2. Initial mount: `get`, then `ensure` ONLY when domain policy requires
   automatic binding (both current domains do).
3. Match the generic FunctionalityInstance changed event
   (`workspace.functionality.instance.changed`) by workspace/block/functionality.
4. During migration also match the legacy binding events listed in `eventTypes`.
5. Revision-order events; lower/equal revision ignored.
6. Coalesce event invalidation into one authoritative `get`.
7. Reconnect performs `get`/`ensure`.
8. Reset uses the current binding (session ID + revision); busy/stale handled
   distinctly; refreshes after stale; never deletes the old session.
9. Dispose aborts requests and removes listeners; does NOT cancel session work.
10. No binding is written to browser persistence.

The registration shape returned must satisfy `BlockRuntimeRegistration` from
A's `contracts.ts` (mode "native", TResolved = HostSessionBindingState<B>,
TCommand = ResetCommand, select returns the binding view). Use the frozen
interfaces; do not import SolidJS values into the factory core (types only).

## Required tests (new files beside the factory)

- unbound → ensure → bound;
- concurrent ensure calls converge (one ensure, both resolve);
- event arrives before initial get completes;
- stale/lower-revision event ignored;
- reconnect performs refetch;
- reset busy (delegated, error surfaced);
- reset stale then refetch;
- workspace epoch change disposes and re-resolves;
- block removed while ensure in flight (abort, no state leak);
- two blocks have isolated bindings.

Use fake ports/events (no timers).

## Owned files (edit ONLY these)

- `packages/app/src/pages/canvas/runtime/adapters/session-binding.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/adapters/session-binding.test.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/adapters/HANDOFF-F.md`

Do NOT edit ChatRelay, MasterAgent, manager, workspace page, backend services,
or runtime core owned by A/C/D.

## Targeted validation (allowed)

- `cd packages/app && bun test src/pages/canvas/runtime/adapters/session-binding.test.ts`
- `bun run typecheck` from `packages/app`

## Handoff

`HANDOFF-F.md`: factory export signature · ONE minimal configuration example
for ChatRelay (using `v2.workspace.chatRelay.get/ensure/reset`) and ONE for
MasterAgent (using `v2.workspace.masterAgent.*`) · tests + results · integration
actions M must take · prohibited-pattern grep result.
