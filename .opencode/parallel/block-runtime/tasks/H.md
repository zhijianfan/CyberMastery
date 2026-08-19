# Task H — Observability, Feature Flag, Rollout Controls (worker 8 of 8)

You are worker 8 of 8. Implement ONLY this task.
- Edit ONLY the files listed as your owned files. Never touch other files, shared configs, lockfiles, or generated code.
- Read any existing code you need first; follow the repo conventions (bun workspace, .js import suffixes, AGENTS.md style).
- Do not run repo-wide builds, typechecks, or tests — the master integrates and tests. A quick targeted check of your own code is allowed.
- Do not wait for, check on, or communicate with other workers.
- When done, reply with: files changed, what was implemented, what was left undone or uncertain.

## Owned files (create/edit; touch nothing else)
- `packages/core/src/flag/flag.ts` — ONE guarded addition to the `Flag` object
  (see below). Nothing else in this file.
- `packages/app/src/pages/canvas/diagnostics.ts` (new)
- `specs/workspace-canvas/block-runtime-observability.md` (new)

## Context
Tracks B/D (server gateway, frontend runtime store) expose diagnostics counters
(active subscriptions, last cursor, resync causes, batch stats). You add the
feature flag that gates the new runtime path and the tooling that lets a
developer tell WHICH path is active and WHY a stale UI looks stale.

## What to implement

1. Feature flag — in `packages/core/src/flag/flag.ts`, add exactly ONE entry to
   the `Flag` object using the existing `truthy()` helper:
   `CYBERMASTER_BLOCK_RUNTIME_V2: truthy("CYBERMASTER_BLOCK_RUNTIME_V2"),`
   Do not reformat, rename, or otherwise touch the rest of the file.
2. `packages/app/src/pages/canvas/diagnostics.ts` — a dependency-light
   diagnostics module that builds even though Tracks D/E may not be merged yet:
   - `registerBlockRuntimeDiagnostics(stats: () => BlockRuntimeDiagnostics): () => void`
     (idempotent per key; returns unregister),
   - `getBlockRuntimeDiagnostics(): BlockRuntimeDiagnostics | undefined`,
   - a small dev-only render helper (optional) that displays:
     descriptor + bindings, active adapter functionalityID, resource
     subscription count, connection state, last cursor/revision, last snapshot
     time, resync count + reason, event batching statistics.
   - IMPORTANT: do NOT import Track D's store or Track E's adapter modules
     (they may not exist yet). Registration-based wiring only; the master
     connects the real stats provider at integration.
   - Type `BlockRuntimeDiagnostics` locally with the fields above (all optional).
3. `specs/workspace-canvas/block-runtime-observability.md` — document:
   - the flag (env `CYBERMASTER_BLOCK_RUNTIME_V2`, default off → legacy path);
   - how to inspect which path is active in the served web bundle: compare the
     served entry asset hash against `packages/app/dist/assets/` (baseline entry
     is `index-mjRXeggk.js` — after the runtime UI lands the hash MUST differ),
     check the flag, check the diagnostics module;
   - network checks: a working prompt sends NO request to
     `chatgpt.com/backend-api/conversation`; browser talks only to the local
     OpenCode/CyberMaster server; no duplicate legacy+native prompt requests;
   - log redaction rules: never log OAuth credentials, device tokens,
     authorization headers, or message content unless an explicit debug mode
     allows content logging;
   - safe fallback policy: flag off → legacy path; flag on → exactly one prompt
     transport per block; a low-frequency status check is allowed ONLY as
     disconnected-mode diagnostics, never as the primary state mechanism;
   - a failure triage table: stale bundle / disconnected stream / failed
     snapshot / missing binding / stale event → symptom → check.
   Follow the style of existing files in `specs/workspace-canvas/`.

## Do not touch
- Everything not listed: `packages/server/src/runtime/**` (Track B), adapters
  (Track C), app runtime/store/UI files (Tracks D/E/F/G), protocol, generated SDK.

## Acceptance
- `packages/core` still typechecks (`bun typecheck` from `packages/core` — you
  may run this targeted command; other packages may have in-flight track errors,
  ignore them).
- diagnostics.ts compiles standalone in `packages/app`.
- Doc answers "stale UI = stale bundle vs disconnected stream vs failed snapshot
  vs missing binding vs stale event" unambiguously.
- Report: files changed, implemented, uncertain.
