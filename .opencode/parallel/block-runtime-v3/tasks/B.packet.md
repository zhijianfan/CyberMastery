You are worker 2 of 7 (Wave 1) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task B — Backend generic FunctionalityInstance change events

Goal: one generic, small backend event telling the runtime layer WHEN a block's
authoritative functionality instance changed — IDs and revision only, no
configuration or UI state.

Required event (name frozen):

```text
workspace.functionality.instance.changed
{
  workspaceID, blockID, functionalityID, instanceID, revision,
  change: "created" | "updated" | "tombstoned"
}
```

Rules:
- Publish only after the database mutation SUCCEEDS (EventV2 after the SQL run).
- `getOrCreate` publishes only when it actually creates.
- CAS publishes only on `updated`, never on conflict.
- `upsert` publishes `created` or `updated` accurately.
- Tombstone publishes only on successful tombstone.
- Event payload contains NO `configuration`, session ID, prompt, token,
  credential, or view state.
- Existing domain-specific events (ChatRelay/MasterAgent binding events) remain
  untouched until Task O.
- The event is transient; clients refetch on reconnect.

Implementation steps:
1. Create `packages/core/src/workspace/functionality-instance-events.ts` with the
   typed event definition, following the EXACT EventV2 definition pattern shown
   in the inlined `master-agent-events.ts` below (Schema event with durable
   envelope + publish helper).
2. Inject `EventV2.Service` into the FunctionalityInstance service (inlined below)
   and publish from every successful mutation path (create, getOrCreate-create,
   upsert, CAS-update, tombstone).
3. Follow the service's existing error/return conventions exactly; do not change
   public method signatures.
4. Add tests beside the service (or in a sibling test file under
   `packages/core/src/workspace/`) covering: create publishes; getOrCreate
   idempotent (second call publishes nothing); upsert publishes created then
   updated; CAS conflict publishes nothing; tombstone publishes; event payload
   contains no configuration; encode/decode round-trip of the event schema.

## Owned files (edit ONLY these)

- `packages/core/src/workspace/functionality-instance.ts` (event publication only — preserve all existing behavior)
- `packages/core/src/workspace/functionality-instance-events.ts` (NEW)
- `packages/core/src/workspace/functionality-instance-events.test.ts` (NEW)
- `packages/core/src/workspace/HANDOFF-B.md` (handoff)

Do NOT edit frontend files, route aggregation, ChatRelay/MasterAgent business
logic, or generated SDK.

## Targeted validation (allowed)

- `cd packages/core && bun test src/workspace/functionality-instance-events.test.ts`
- `bun run typecheck` from `packages/core`

## Handoff

Write `HANDOFF-B.md`: files changed · tests + exact result · the exact event
`type` string and decoded payload shape that `serverSDK().event.listen` will see
(so C/F can match without reading backend internals) · assumptions · integration
actions (who registers the schema in central event aggregation = M) ·
prohibited-pattern grep result.
