# MasterAgent — `builtin:master-agent` (implemented behavior)

**Branch:** `feature/UnrealViewer` — **Baseline:** `32e5e230b`
**Status:** documents the behavior as implemented by the MasterAgent tracks (schema C0–C2, core D1–D4/F1–F4/E1, protocol P1–P3, server S1–S2, opencode R1–R6, app M1–M6/I1–I2/U1–U3/Q1/B1–B3).
**Contract source of truth:** `specs/master-agent-max-parallel-plan/` (01 architecture decisions, 02 contracts, 05 verification).

The MasterAgent block embeds the **existing Session surface**; it does not create a second chat implementation. One host-owned functionality instance per block owns the authoritative Session binding; the canvas owns presentation only.

---

## 1. Invariants (enforced by the landed code)

- `builtin:master-agent` embeds the existing Session surface (messages, composer, terminal, file tree, review panel) via the reusable `SessionSurfaceBase`; no fake route, no copied page.
- The host functionality instance owns the authoritative Session binding. Layout JSON stores only block identity and presentation; no session ID, revision, or queue state ever reaches layout serialization, `localStorage`, or IndexedDB.
- Queue delivery uses the existing host SessionInput admission path with `delivery: "queue"`. There is no browser holding queue.
- `workspace.coderModel` is nullable and workspace-wide in v1 (UI label **Workspace Coder**).
- Enabled Coder mode delegates coding execution to a host-created child Session; the primary stays on the workspace primary model.
- The host — never the browser or the model — chooses the child model, directory, parent, workspace, agent, and permissions.
- No silent fallback to the primary model: an unavailable or incompatible Coder model is a visible failure.
- Routed Session pages, ordinary sessions, and `builtin:chat` remain compatible; no layout is auto-migrated.

---

## 2. Session binding lifecycle (host-owned)

One functionality-instance row keyed `(workspaceID, blockID, "builtin:master-agent")` (unique index `(workspace_id, block_id, functionality_id)`) owns at most one active top-level Session binding. Instance configuration is server-managed:

```ts
InstanceConfiguration = {
  version: 1,
  directoryBinding: { mode: "workspace-primary" } | { mode: "fixed", directory },
  sessionBinding: { mode: "owned", sessionID, generation } | null,   // never client-writable
}
```

The default configuration is unbound + workspace-primary. The built-in descriptor (`builtin:master-agent`, label "Master agent", minW/minH 4) carries no configuration passthrough, so session binding fields can never be written through a generic client configuration patch.

| Operation | Behavior (as implemented) |
| --- | --- |
| **get** | Verifies the workspace exists and the block exists with functionality `builtin:master-agent` (else 404/400 typed errors); returns the `Binding` or `unbound`. |
| **ensure** | Idempotent. Resolves the directory binding first (fixed wins; workspace-primary → `workspace.directories[0]` else process cwd), creates the host Session through the narrow `SessionPort` (`create`/`active`/`cleanupLosingCandidate`; live adapter wraps `SessionV2`), then claims the instance row via insert-or-revision-CAS. A concurrent winner is returned; the loser's unbound, empty candidate session is best-effort cleaned up (no session-deletion API exists; non-empty or unreadable candidates are left untouched). Publishes the binding event only after persistence and only on a real change; an idempotent ensure publishes nothing. |
| **reset** | Guarded by `expectedSessionID` + `expectedRevision` (client's last observed binding). Rejects with `stale` when the revision or session no longer matches; rejects with `busy` when the session is active **or** has any admitted-but-unpromoted input (`session_input.promoted_seq IS NULL`). Otherwise creates a fresh Session with `generation + 1` through the same CAS and returns the new binding. The old session is preserved in history; queued inputs are **not** transferred. |
| **tombstone** | Block removal/tombstoning hides the instance row only (revision-guarded; a racing transition makes it a no-op). The host Session record, running work, and admitted queue are preserved. |

**Events are transient hints.** `workspace.master-agent.binding.updated` (workspaceID, blockID, sessionID, generation, revision) is published through core EventV2 after persistence succeeds, forwarded by the opencode event-v2 bridge to GlobalBus as a plain event (never a `sync` envelope), and is never replayed. Clients must refetch via get/ensure after reconnect; persisted functionality-instance state is authoritative.

**Client projection** (per block, in `manager.ts` + `lifecycle-controller.ts` + `reducer.ts`): states `uninitialized → loading → ready | permission-denied | unavailable | error`; in-flight requests deduplicated; stale responses dropped after workspace switch/removal/dispose; `binding-updated` applied only when workspace/block match and the revision is strictly newer; snapshots are authoritative but never adopt an older revision; reconnect refetches all known blocks.

---

## 3. Queue delivery

- The embedded composer reuses the existing Queue action (`handleSubmit(event, "queue")`): while the host session is busy, the Queue button submits the draft **immediately** with `delivery: "queue"` through the existing SessionInput admission API.
- Pending state is projected from existing `session.input.admitted`/`session.input.promoted` events; the host promotes one queued input when the drain would otherwise idle, preserving order, then re-evaluates before promoting another.
- The block/manager keep **no** block-local, manager-local, localStorage, or IndexedDB queue. Reload/remount restores host-admitted pending inputs from the server; removing the visual block does not discard them.
- Steer (Enter / primary send) is unchanged.
- `packages/app/src/components/prompt-input.tsx` and `packages/session-ui/src/v2/components/prompt-input` were deliberately left untouched.

---

## 4. Workspace Coder (`workspace.coderModel`)

- Schema: `Workspace.Info.coderModel` is `optional(NullOr(String))` — the same model-selection representation as `Workspace.Info.model`. Absent key (pre-feature rows) decodes as undefined → reads as `null`. Patch semantics: omitted key = unchanged; explicit `null`/empty = clear; concrete value = persist exactly.
- Migration `20260816090000_master-agent` adds `workspace_v2.coder_model`; `migration.gen.ts`/`schema.gen.ts` agree.
- The setting is **workspace-wide** (not per block, not per layout tuple). The block footer shows the **Workspace Coder** selector with a "Workspace-wide" scope hint, shared by every MasterAgent block in the workspace.
- Selecting the same model as the primary is allowed with a visible warning; the product keeps no global capability ranking. A model with known tool-call limitations shows a compatibility warning.
- Client controller (`coder-controller.ts`): optimistic with rollback on failure; the server response is authoritative; sequence-guarded so stale responses are dropped; `set`/`clear`/`retry`.
- Wire encoding (app → server): `providerID:modelID[:variant]` via `workspace.update` patch. The generated `WorkspaceUpdatePayload` dropped the `null` branch, so the clear case uses a type-only escape confined to `sdk-port.ts`.
- Changing the Coder model does not alter an active child; the next child uses the new model (snapshot at delegation time).
- Host-side parse (`master-agent-context.parseModelSelection`): expects `providerID/modelID` (exactly two `/`-separated parts); anything else decodes as `null` (Coder disabled) — **known discrepancy**: the canvas writes `providerID:modelID` keys, so end-to-end Coder enablement currently requires the two formats to be reconciled (see verification doc, findings).

---

## 5. Coder routing (host-side subagent delegation)

- **Eligibility** is resolved once per run: the session must be bound to a live `builtin:master-agent` instance (top-level session, no `parentID`, owned binding in the workspace's live instance rows) **and** the workspace `coderModel` must be non-null. Resolution failures log a warning and **fail open** (default tools kept) so ordinary sessions and broken bindings never lose tooling.
- **Enabled** MasterAgent primaries get a deterministic effective tool set (`master-agent-policy.ts`): `edit`, `write`, `apply_patch`, `bash`, `execute` are removed; read/search/context tools stay; the reserved `coder-task` tool is added unless the `task` permission denies it. User-operated terminal UI is not an agent tool and is untouched.
- **`coder-task` tool** (model-visible arguments: `task`, optional `context` — nothing else): resolves host state through `MasterAgentContext`, refuses when `coderModel` is null ("Coder mode is not configured … the primary model is not used"), refuses when `task` is denied, otherwise goes through the existing ask flow unless the permission is `allow`, snapshots `{parentSessionID, directory, workspaceID, model}`, validates the model via `Provider.getModel` (missing model → visible failure; missing `toolcall` capability → visible failure), and calls `ChildTaskRunner.runTrusted`.
- **Child session**: agent `coder` (reserved hidden subagent, no model field — `agent/coder.ts`), title "Coder task", host-resolved model + directory (recorded as session metadata), derived subagent permissions plus `todowrite`/`task` denies and `primary_tools` denies, admitted through the same `SessionPrompt` admission surface as the primary. Returns `{sessionID, output}` for the primary to synthesize.
- No provider/model/directory/permission/session/workspace overrides are accepted from model-visible tool arguments.
- Ordinary sessions and Coder-disabled MasterAgent sessions are behaviorally unchanged.

---

## 6. Permissions and access

- `task` + `coder` wildcard rules (session ruleset, `findLast`) decide delegation authority: `allow` skips the ask, `deny` blocks the tool and disables the selector/delegation UI, anything else goes through the existing ask flow.
- Server handlers check caller access before every lifecycle call (access port `MasterAgentAccessService`; the live implementation is permissive because fork-wide Authorization middleware already gates every route with 401, and the port exists for per-workspace policy injection). Block/functionality validation is owned by the lifecycle service (typed `WrongFunctionality`).
- Cross-workspace isolation: events for another workspace/block are ignored by the manager; workspace switch disposes subscriptions and suppresses stale responses; session-to-instance resolution only matches live instances in the session's own workspace.

---

## 7. Reset and removal (user-facing)

- **Reset session** (block footer): enabled only when the binding is `ready` and the client-side busy projection is idle; the host re-enforces idle + zero-pending-input and the expected session/revision. Outcomes: `reset` (new binding), `stale` (client reconciles from the returned revision), `busy` (kept disabled with reason).
- Reset replaces only the selected block's binding; other blocks are untouched. The old session remains in history.
- **Removal/remount**: unmounting a block drops only the local projection; the host Session, running work, and admitted queue are preserved and re-resolved by the next mount's ensure.
- **Full page** opens the bound session in the routed Session page.

---

## 8. Limitations (v1)

- Per-block directory binding (`fixed`) exists in the server configuration schema but has no client patch path in v1.
- No per-block Coder model override (workspace-wide only).
- No input edit/cancel UI for queued prompts; editing a queued prompt requires a server-side input-edit operation.
- Coder child sessions are not resumable from the UI (each `coder-task` creates a fresh child; `taskID` resume exists only in the runner surface).
- Model-selection encoding mismatch between canvas keys (`providerID:modelID`) and the host resolver (`providerID/modelID`) — see §4.
- Host composition: the opencode server mounts the protocol `Api` and the merged `handlers` layer (which includes the MasterAgent group) but the live `app` node group does not yet provide `MasterAgentService.node` / `MasterAgentAccessService` — the S2 host wiring must add them (see verification doc).

---

## 9. API surface summary

**Schema** (`packages/schema/src/master-agent.ts`, exported from the schema index):
`FunctionalityID` (`"builtin:master-agent"`), `DirectoryBinding`, `SessionBinding`, `InstanceConfiguration` (v1), `Binding`, `GetRequest`, `EnsureRequest`, `ResetRequest`, `GetResponse` (`bound|unbound`), `ResetResponse` (`reset|stale{currentRevision}|busy{reason}`), `BindingUpdated` event.

**Protocol** (`packages/protocol/src/groups/workspace-master-agent.ts`, mounted under the P3 server `Api`):

| Endpoint | Behavior |
| --- | --- |
| `GET /api/workspace/:workspaceID/master-agent/:blockID` | `GetResponse`; errors 404 (workspace/block/instance), 400 (wrong functionality), 403 (access), 409 (conflict) |
| `POST …/ensure` | `Binding`; idempotent; same error set |
| `POST …/reset` | payload `{expectedSessionID, expectedRevision}`; `ResetResponse` (200 status union per repo CAS convention) or 409 typed errors |

`Workspace.update` composes `WorkspaceCoder.patchFields` (`coderModel?: string | null`) — `packages/protocol/src/groups/workspace-coder.ts`.

**Client port** (`packages/app/src/pages/canvas/master-agent/`): `types.ts` (domain models + error union), `port.ts` (get/ensure/reset/patchCoderModel), `sdk-port.ts` (generated-client adapter + error normalization), consumed by the manager (`manager.ts` → `masterAgent` API) and the block renderer (`block.tsx` → `CanvasSessionSurface` + `CoderSelector`).

---

## 10. File map (implementation → doc)

| Area | Files |
| --- | --- |
| Schema | `packages/schema/src/master-agent.ts`, `workspace.ts` (`coderModel`), `index.ts` |
| Core lifecycle | `packages/core/src/workspace/master-agent.ts`, `functionality-instance.ts`, `builtins/master-agent.ts`, `master-agent-events.ts`, `coder-model-codec.ts`, `sql.ts`, `service.ts`, `database/migration/20260816090000_master-agent.ts` |
| Protocol | `packages/protocol/src/groups/workspace-master-agent.ts`, `workspace-coder.ts`, `workspace.ts`, `api.ts` |
| Server | `packages/server/src/handlers/workspace.ts`, `workspace-master-agent.ts`, `workspace-master-agent-access.ts`, `handlers.ts`, `api.ts` |
| opencode host | `packages/opencode/src/event-v2-bridge.ts`, `session/master-agent-context.ts`, `session/master-agent-policy.ts`, `session/prompt.ts`, `tool/coder-task.ts`, `tool/task-runner.ts`, `agent/coder.ts`, `agent/agent.ts` |
| App | `packages/app/src/pages/canvas/manager.ts`, `workspace.tsx`, `session-surface.tsx`, `session-target.tsx`, `session-scope.tsx`, `master-agent/*` (block, block-shell, status-view, coder-selector, coder-controller, lifecycle-controller, reducer, event-reconciliation, sdk-port, port, types, functionality, session-options) |
