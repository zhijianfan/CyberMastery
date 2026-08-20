## Session-Binding Adapter Handoff

### What was added
- Added new reusable host-bound runtime factory in
  - `packages/app/src/pages/canvas/runtime/adapters/session-binding.ts`
- Added focused unit tests covering ensure/reconcile/invalidation/reset/dispose behavior in
  - `packages/app/src/pages/canvas/runtime/adapters/session-binding.test.ts`

### Runtime contract implemented
- `createHostSessionBindingRegistration` returns `BlockRuntimeRegistration` with:
  - `mode: "native"`
  - `TResolved = HostSessionBindingState<B>`
  - `TCommand = ResetCommand`
- `HostSessionBindingState<B>` is
  - `{ status: "unbound" }`
  - `{ status: "bound"; binding: B }`

### Behavior covered
- Resolver waits for `services.workspace.id()` and `services.workspace.awaitDescriptorPersisted(blockID, signal)` before calling `ensure`.
- Supports shared in-flight `resolve` and `dispatch` so concurrent callers converge to one request.
- `onEvent` handles:
  - `workspace.functionality.instance.changed` with optional `functionalityID` guard.
- Includes legacy event types through `eventTypes`.
- Revision-aware invalidation:
  - ignores lower/equal revisions.
  - ignores repeated equal/older events.
  - coalesces burst invalidations into one queued action.
- Reset flow:
  - surfaces non-stale errors directly after normalization.
  - on stale payload (`type === "stale-binding"`) triggers a refetch attempt, then rethrows the normalized stale error.
- `dispose` aborts active resolve/dispatch signal trees, clears in-flight refs, and drops cached invalidation state.
- No session binding data is stored in local browser storage.

### Validation
- Tests run:
  - `cd packages/app && bun test src/pages/canvas/runtime/adapters/session-binding.test.ts`
  - Result: **pass** (10 tests, 0 fail)
- Typecheck:
  - `bun typecheck` currently still fails from unrelated existing files outside this feature area (notably `src/test/fake-host-binding-port.ts` and `src/test/fake-workspace-api.ts`).

### Notes for M
- Integrate this adapter by replacing old ad hoc session-binding registration builders with
  `createHostSessionBindingRegistration`.
- Pass domain-specific handlers:
  - `get`, `ensure`, `reset`, `normalizeError`
  - `validateBinding` for adapter-specific payload type guard
- Keep command enums aligned with reset command wiring (default expected command here is `"reset"`).
