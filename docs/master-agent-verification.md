# MasterAgent — Regression Gate and Verification

**Branch:** `feature/UnrealViewer` — **Baseline:** `32e5e230b`
**Track:** V4 (Release: Regression Gate and Documentation) — **Docs portion.** The orchestrator runs the gate itself; this file is the checklist it follows and the record of what the documentation pass verified by reading landed code.

---

## 1. Package typecheck gate (run from package dirs, never repo root)

```bash
bun --cwd packages/schema typecheck
bun --cwd packages/core typecheck
bun --cwd packages/protocol typecheck
bun --cwd packages/server typecheck
bun --cwd packages/sdk/js typecheck
bun --cwd packages/opencode typecheck
bun --cwd packages/app typecheck
```

## 2. Tests that must pass

Run from each package dir (tests cannot run from repo root).

**core** (`packages/core`):
- `bun test test/workspace/master-agent.test.ts` — lifecycle: idempotent ensure, concurrent ensure single binding, losing-candidate cleanup, stale/busy reset, generation bump, tombstone preservation, event-after-persistence.
- `bun test test/workspace/master-agent-events.test.ts` — transient event publisher, schema validation, no replay.
- `bun test test/integration/master-agent-session.test.ts` — session-port integration, directory binding (workspace-primary vs fixed), pending-input gating.

**protocol** (`packages/protocol`):
- `bun test test/workspace-coder.test.ts` — patch omitted/null/value semantics.

**server** (`packages/server`):
- `bun test test/handlers/workspace-master-agent-composition.test.ts` — route mount under the P3 Api, coderModel patch propagation through `workspace.update`, transient binding event bridge (listener registered after publish sees nothing).

**opencode** (`packages/opencode`):
- `bun test test/session/master-agent-policy.test.ts` — excluded-tool sets, coder-task visibility per task permission.
- `bun test test/session/master-agent-context.test.ts` — binding resolution, parent/workspace guards, model parsing, task permission.
- `bun test test/session/master-agent-coder-integration.test.ts` — primary stays on workspace model; child uses Coder model snapshot.
- `bun test test/integration/master-agent-coder.test.ts` — end-to-end delegation, no-fallback failure modes.
- `bun test test/tool/coder-task.test.ts` — argument schema has no provider/model/directory/workspace/permission overrides; refusal paths.
- `bun test test/agent/coder.test.ts` — reserved agent definition (hidden subagent, no model field).

**app** (`packages/app`):
- `bun test src/pages/canvas/master-agent/*.test.ts(x)` — reducer, lifecycle-controller, event-reconciliation, coder-controller, sdk-port, functionality, block, block-shell, coder-selector, queue, probe-mock, manager-integration.
- `bun test src/pages/canvas/master-agent.integration.test.tsx` — canvas block end-to-end (two blocks, distinct sessions, no layout leakage).
- `bun test src/pages/canvas/session-surface.test.tsx src/pages/canvas/session-target.test.tsx` — multi-surface isolation.

## 3. SDK idempotence

```bash
node packages/sdk/js/script/build.ts
git status --short        # expected: no generated drift (G1 committed output)
node packages/sdk/js/script/build.ts
git diff --exit-code      # must be empty
```

## 4. App production build

```bash
bun --cwd packages/app run build
```

## 5. Contract and persistence checks

- `Workspace.Info.coderModel` uses the same representation as `Workspace.Info.model` (schema `optional(NullOr(String))`); pre-feature rows read `null`; omitted patch unchanged; explicit null clears.
- Migration `20260816090000_master-agent` (adds `workspace_v2.coder_model`, creates `functionality_instance` with unique `(workspace_id, block_id, functionality_id)` index + cascade FK) agrees with `migration.gen.ts` and `schema.gen.ts`.
- `builtin:master-agent` appears exactly once in the core built-ins registry (`packages/core/src/workspace/service.ts`) and once in the client mapping (`master-agent/functionality.ts`).
- Session binding is absent from layout JSON: `Workspace.Block.Record` carries only `id`, `functionality`, `transform`; `manager.ts` reads binding exclusively through the port; `workspace.tsx` passes only block identity/focus to `MasterAgentBlock`.

Negative searches:

```bash
! rg 'localStorage|indexedDB|followupQueue|clientQueue|holdingQueue' packages/app/src/pages/canvas/master-agent
! rg 'sessionBinding|sessionID.*layout|queue.*layout' packages/app/src/pages/canvas/workspace.tsx
git diff -- packages/app/src/components/prompt-input.tsx            # must be empty
git diff -- packages/session-ui/src/v2/components/prompt-input      # must be empty
```

Public-argument assertion (matches must be internal trusted resolution only):

```bash
rg -n 'providerID|modelID|directory|workspaceID|parentSessionID|permissionOverride' packages/opencode/src/tool/coder-task.ts
```

## 6. Manual smoke checklist (release sign-off)

1. Add two MasterAgent blocks → distinct session IDs, full Session UI in each, no DOM-id/terminal/portal collisions.
2. Long prompt in block A, submit a second prompt with **Queue** → queued immediately host-side.
3. Reload → queued state restored (host-admitted), no client queue artifacts.
4. First run finishes → ordered promotion of the queued input.
5. Select a **Workspace Coder** model → warning on same-as-primary, tool-compatibility warning when applicable.
6. Ask for a small code change + focused test → child `coder` Session created with the Coder model; parent stays on the primary model.
7. Change the Coder model while a child runs → active child keeps its snapshot; next child uses the new model.
8. Set a Coder model that is unavailable / lacks tool calls → visible failure, no primary fallback.
9. Deny `task` in project config → selector/delegation disabled and denied host-side.
10. Reset block A → only block A changes; old session preserved in history; block B untouched; reset refused while busy/pending.
11. Remove and re-add block A → host Session history and queue preserved.
12. Open the routed Session page and a legacy `builtin:chat` block → no regressions.
13. Reconnect / workspace switch → bindings refetched, stale events ignored.

## 7. Release blockers (any one blocks merge)

```text
duplicate active binding
session ID persisted in layout
browser/client holding queue
silent Coder fallback
client/model-selected Coder directory/model/permission
cross-workspace access
ordinary Session behavior regression
non-idempotent SDK generation
failed production build
```

## 8. Findings recorded by the documentation pass (route to owning track; no production edits made)

1. **Model-selection encoding mismatch (blocks end-to-end Coder enablement).** The canvas writes workspace model keys as `providerID:modelID` (`workspace.tsx` ModelPicker, `manager.ts` `parseModelKey`, `sdk-port.ts` `formatModelSelection`), while the host resolver `packages/opencode/src/session/master-agent-context.ts` `parseModelSelection` accepts only `providerID/modelID` and decodes anything else as `null`. Net effect today: `coderModel` set from the UI parses as null host-side, so Coder mode stays disabled and `coder-task` fails with the visible "Coder mode is not configured" error — the no-fallback invariant holds, but the feature cannot be enabled end-to-end until one side changes. **Owner:** R1/contract (02-contracts §10) with C0/D2 confirmation of the canonical separator. This is a functional-deployment item, not a type error, so the typecheck gate will not catch it.
2. **Host composition gap (routes declared but services not provided live).** `packages/opencode/src/server/routes/instance/httpapi/server.ts` mounts `serverRoutes = HttpApiBuilder.layer(Api).pipe(Layer.provide(handlers))` where `handlers` (`packages/server/src/handlers.ts`) includes `WorkspaceHandler` → the MasterAgent group; the handler requires `MasterAgentService.Service` and `MasterAgentAccessService`, but the live `app` node group (lines 212–269) does not include `MasterAgentService.node` (nor `masterAgentAccessLive`). `MasterAgentContext.node` is correctly wired through `SessionPrompt.node` deps, and the Coder pipeline (resolver → policy → coder-task → task-runner) is fully composed. Only the lifecycle-service wiring is missing. **Owner:** S2 host composition (opencode app). Until it lands, live `GET/POST /api/workspace/:id/master-agent/:blockID*` requests fail with a service-not-available layer error; package-level composition tests cover the mount with fakes and pass.
3. **Deferred product decisions (unchanged):** no client patch path for fixed directory binding; no per-block Coder override; no queued-input edit/cancel UI; child sessions not resumable from the UI.

## 9. Track status

- Documentation deliverables complete: `docs/master-agent.md` (behavior), `docs/master-agent-verification.md` (this file), `specs/workspace-canvas/UIDesign.md` §10 (final design section).
- **Ready after:** the S2 opencode host composition (finding 2) merges and the encoding discrepancy (finding 1) is resolved or explicitly accepted by the owning tracks; the orchestrator then runs sections 1–5 and records results here.
- No production files were modified by this track.
