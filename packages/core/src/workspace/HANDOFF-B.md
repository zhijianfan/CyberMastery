# Handoff B

## Summary
- Added `workspace.functionality.instance.changed` event emission for `FunctionalityInstance` mutations in `packages/core/src/workspace/functionality-instance.ts`.
- Added a dedicated event publisher contract in `packages/core/src/workspace/functionality-instance-events.ts`.
- Added focused unit coverage in `packages/core/src/workspace/functionality-instance-events.test.ts`.

## Event contract
- Event type: `workspace.functionality.instance.changed`.
- Data payload: `workspaceID`, `blockID`, `functionalityID`, `instanceID`, `revision`, `change`.
- Allowed `change`: `"created" | "updated" | "tombstoned"`.
- Payload intentionally excludes transient fields such as `configuration`, `sessionID`, etc.

## Emission rules
- `getOrCreate`: emits only when insert path creates a new row (`created`).
- `compareAndSwapConfiguration`: emits only on successful CAS update (`updated`).
- `upsert`: emits `created` for insert, `updated` for update.
- `tombstone`: emits only on successful tombstone (`tombstoned`).
- All events are emitted after the DB mutation commit succeeds.

## Files changed
- `packages/core/src/workspace/functionality-instance.ts`
  - Wired `FunctionalityInstance` service to `FunctionalityInstanceEvents.make(EventV2.Service)`.
  - Emitted events in the mutating methods above.
- `packages/core/src/workspace/functionality-instance-events.ts`
  - Added `FunctionalityInstance.EventV2` event definition and publisher interface.
  - Exported `FunctionalityInstanceEventPublisherService` + `make`, `layer`, `node`, and `InvalidInstanceChangedEventError`.
- `packages/core/src/workspace/functionality-instance-events.test.ts`
  - Added tests for create/update/conflict/tombstone behavior and event payload shape.
  - Added schema decode round-trip test for the new event definition.
- `packages/core/src/workspace/HANDOFF-B.md`
  - This handoff document.

## Validation
- Ran `bun test src/workspace/functionality-instance-events.test.ts` from `packages/core`.
- Test result: `6 pass`.

## Notes
- `FunctionalityInstance.node.implementation` is used in tests to build a test layer because tests also need direct `Database.Service` access (for workspace seeding).
- No global route/SDK aggregation updates were made yet.
- Existing unrelated typecheck issue in `workspace/chat-relay-session.ts` remains outside this task scope.
