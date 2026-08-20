You are worker 5 of 7 (Wave 1) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task E — Typed workspace-not-found and live workspace recovery

Goal: fix both boot-time and in-session stale workspace IDs without looping on
the same deleted ID or recreating a workspace under an old identity. The
reported production bug: `Workspace not found: wrk_...` loops forever because
`ensureWorkspace()` returns the in-memory ID without revalidation.

## Required work

### Backend (typed 404)

1. `packages/core/src/workspace/service.ts`: add a typed
   `WorkspaceNotFoundError` (`Schema.TaggedErrorClass`, mirroring the
   `WorkspaceNotFoundError` pattern in the inlined `chat-relay-session.ts` —
   fields `{ workspaceID }`) and return it from `get`, `update`, `remove`,
   `duplicate`, and layout get/save where the workspace row is missing
   (currently `requireWorkspace` throws a generic NotFound). Preserve the
   conflict/handover result unions — do NOT collapse them into not-found.
2. `packages/protocol/src/groups/workspace.ts`: add the typed error to the
   affected endpoint error channels (only where step 1 added it).
3. `packages/server/src/handlers/workspace.ts`: map the error to HTTP 404
   (follow the existing error-mapping pattern in the inlined handler).

### Frontend manager (`packages/app/src/pages/canvas/manager.ts`, FULL file inlined)

4. Add `workspaceEpoch()` signal (starts 0).
5. Add typed transport error detection WITHOUT string matching: detect the
   error by its SDK error shape/status (the generated SDK surfaces a 404 as an
   error with `status === 404` — use that; do not match on message text).
6. One serialized recovery operation (single in-flight promise; concurrent
   failures join it):
   ```text
   on typed workspace-not-found
     → capture current local records + dirty state
     → clear workspaceID signal, revision, connected, persisted ID
       (localStorage key opencode.canvas.workspaceID.v1)
     → increment workspaceEpoch
     → stop retry timer; invoke a manager-provided disposal callback
       (input.onWorkspaceInvalidated?.) — add this optional input callback
     → ensureWorkspace() with FORCED validation (always validate, even when
       workspaceID() is non-empty)
     → load authoritative target workspace/layout
     → if local edits existed: keep them local-authoritative and explicitly push
     → notify the user via input.notify(...)
   ```
7. Apply the recovery wrapper to: `connect`, `refresh`, `sync`, model/directory
   updates, and the ChatRelay/MasterAgent binding calls (via the same
   not-found detection; those calls already flow through manager methods).
8. Do NOT recover on auth/permission/validation/network errors.
9. Do NOT auto-create a replacement if an existing `Default` (or any) workspace
   exists — reuse the existing preferred workspace.
10. Remove the stale localStorage key BEFORE selecting a replacement.

## Required tests (new files beside manager.ts)

- persisted ID missing at startup → normal resolve;
- workspace deleted after successful connect → epoch bumps, ID re-resolved, one recovery;
- DB reset while page open → same;
- multiple simultaneous not-found requests → exactly one recovery;
- dirty local layout survives recovery and is pushed once;
- no dirty local layout → replacement layout adopted;
- auth/network failure does NOT clear workspace ID or bump epoch;
- recovery cannot recurse (recovery flag/in-flight guard).

## Owned files (edit ONLY these)

- `packages/core/src/workspace/service.ts` (typed not-found only)
- `packages/protocol/src/groups/workspace.ts` (error channel)
- `packages/server/src/handlers/workspace.ts` (404 mapping)
- `packages/app/src/pages/canvas/manager.ts` (epoch + recovery)
- tests for the above (new files beside the sources)
- `packages/app/src/pages/canvas/runtime/HANDOFF-E.md`

Do NOT edit `workspace.tsx`, runtime core, ChatRelay, MasterAgent, generated
SDK, or route aggregation.

## Targeted validation (allowed)

- `cd packages/app && bun test <your new manager test files>` (package-scoped)
- `cd packages/core && bun test <your new service tests>`
- `bun run typecheck` from `packages/app` and `packages/core`

## Handoff

`HANDOFF-E.md`: final manager API (`workspaceEpoch`, recovery notification,
`onWorkspaceInvalidated` input) for D/C · exact SDK error shape used for
detection · generated-SDK regeneration note (M must run `bun run generate`
after protocol changes — DO NOT run it yourself) · tests + results ·
prohibited-pattern grep result.
