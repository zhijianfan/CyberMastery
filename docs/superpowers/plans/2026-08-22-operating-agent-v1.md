# OperatingAgent V1 Parallel Implementation Plan

Status: completed historical V1 binding plan. Its deferred context work is
superseded by the approved
[OperatingChat Session Context Assembly Design](../specs/2026-08-25-operating-chat-context-assembly-design.md)
and [parallel implementation plan](./2026-08-25-operating-chat-context-assembly.md).
The decisions below remain the implementation history for the durable
OperatingChat SessionV2 binding.

## Goal

Turn `builtin:operating-chat-session` from a browser-local draft prototype into a server-authoritative Session V2 surface while preserving the separate MasterAgent coordinator model.

## Decisions

- `workspace.model` remains the MasterAgent coordinator model.
- `workspace.operatingAgent` remains an independent model selection and receives its own picker in the OperatingChat block.
- Each OperatingChat block owns one durable Session V2 binding through its `(workspaceID, blockID, functionalityID)` functionality instance.
- Layout records continue to contain identity and transforms only. Session IDs and revisions never enter layout or local view state.
- OperatingChat uses the standard `CanvasSessionSurface`, so prompt admission, queue/steer behavior, interruption, durable history, compaction, and reconnect behavior remain Session V2 concerns.
- V1 does not inject the draft OperatingContext layer array into provider input. Per-session context admission needs an explicit Session/System Context contract; concatenating it into a user prompt would corrupt roles and chronology.
- The old local history is presentation-only legacy data. It is not migrated into the Session transcript.
- An unset or invalid `workspace.operatingAgent` leaves the block unconfigured and must not silently fall back to `workspace.model`.

## Parallel Tracks

### A. Public Contract

Owned paths:

- `packages/schema/src/operating-chat.ts`
- `packages/schema/src/index.ts`
- `packages/schema/src/event-manifest.ts`
- `packages/schema/test/operating-chat.test.ts`
- `packages/protocol/src/groups/operating-chat.ts`
- `packages/protocol/src/api.ts`
- `packages/protocol/test/operating-chat-group.test.ts`

Deliver a typed binding, instance configuration, binding-updated event, get/ensure/reset requests, declared lifecycle errors, and a workspace OperatingChat HTTP group.

### B. Core Lifecycle

Owned paths:

- `packages/core/src/workspace/operating-chat-session.ts`
- `packages/core/test/operating-chat-session.test.ts`

Mirror the proven MasterAgent functionality-instance CAS lifecycle. Create and configure Session V2 with the selected OperatingAgent model, preserve fixed directory bindings across reset, reject missing/invalid model configuration, reject reset while active or pending, clean losing candidates, and publish binding updates only after persistence.

### C. Server Composition

Owned paths:

- `packages/server/src/handlers/operating-chat.ts`
- `packages/server/src/handlers/operating-chat-access.ts`
- `packages/server/src/handlers.ts`
- `packages/server/src/routes.ts`
- `packages/server/test/operating-chat-handler.test.ts`
- `packages/opencode/src/server/routes/instance/httpapi/server.ts`

Mount the lifecycle handlers, enforce workspace access, and provide the live Core lifecycle/session adapter in the application graph.

### D. Client Model State

Owned paths:

- `packages/app/src/pages/canvas/manager.ts`
- `packages/app/src/pages/canvas/master-agent/manager-integration.browser.test.ts`

Make `selectOperatingAgent` and `selectModel` adopt authoritative responses, roll back failed latest requests, ignore stale out-of-order completions, and remain isolated across workspace switches.

### E. OperatingChat UI and Runtime

Owned paths:

- `packages/app/src/pages/canvas/runtime/registrations/operating-chat.ts`
- `packages/app/src/pages/canvas/runtime/registrations/operating-chat.test.ts`
- `packages/app/src/pages/canvas/workspace.tsx`
- `packages/app/src/pages/canvas/master-agent.integration.browser.test.tsx`

Convert OperatingChat to a native runtime that awaits persisted block identity and calls the generated ensure endpoint. Render an explicit OperatingAgent picker and the reusable Session V2 surface. Show configuration, loading, and retry states without synthesizing assistant replies or retaining a second browser transcript.

## Serial Integration

After Tracks A-C land:

1. Regenerate the Promise and Effect clients from `packages/client` using `bun run generate`.
2. Reconcile generated method names with the app runtime.
3. Resolve shared composition/type errors without weakening declared errors.
4. Update architecture/status documentation to distinguish implemented Session execution from deferred OperatingContext admission.

## Acceptance

- Two OperatingChat blocks in one workspace bind distinct durable Sessions.
- Reconnect reuses the persisted binding; concurrent ensure creates one visible winner.
- The selected `workspace.operatingAgent` configures the bound Session model with no fallback to `workspace.model`.
- Changing OperatingAgent selection is authoritative and survives reload; failed or stale writes do not leave incorrect UI state.
- Prompting, queueing, interruption, history, and automatic compaction use existing Session V2 behavior.
- Reset is revision-guarded and blocked while active or while input is pending.
- No Session ID, transcript, queue, or execution state is stored in layout or browser local view.
- Package-scoped tests and typechecks pass; generated clients are clean after a second generation run.

## Deferred

- Typed per-session context admission, host profile context, exact sidecar
  replay, and automatic/explicit CtxPack recall moved to the 2026-08-25 design
  and plan linked above. The new design replaces the draft five-layer
  OperatingContext stack rather than completing it.
- Durable user-authored profile/context editing and revision-conflict UX remain
  deferred beyond that plan.
- ChatRelay-to-OperatingAgent forwarding.
- Shared workspace-wide OperatingAgent session mode.
- Migration of legacy browser-local draft exchanges.
