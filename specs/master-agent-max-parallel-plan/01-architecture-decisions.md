# MasterAgent Architecture Decisions

Target branch: `feature/UnrealViewer`.

These decisions are frozen for all tracks. Internal implementation details may change only when they preserve these boundaries.

## 1. Coder rerouting mechanism

Use **host-side subagent delegation**. The primary MasterAgent session stays on the workspace primary model and remains responsible for planning, conversation, context gathering, and synthesis. Repository mutation, build, test, migration, formatting, shell-based debugging, and similar coding execution are delegated to a reserved Coder child session. The host selects the child model, directory, workspace, parent, permissions, and agent. Browser-side classification and silent model substitution are prohibited.

When Coder mode is enabled, the primary's effective agent tools exclude direct edit/write/patch and unrestricted coding shell tools. Read/search/context tools remain available. User-operated terminal UI is not the same as an agent shell tool and retains its existing permission behavior.

## 2. Coder persistence

Add nullable `Workspace.Info.coderModel` and the matching workspace patch field, using exactly the same provider/model representation as `Workspace.Info.model`.

```text
coderModel = null     Coder routing disabled
coderModel != null    Coder routing enabled
```

The setting is workspace-wide, not per block and not layout-tuple scoped. The UI label is **Workspace Coder**. Selecting the same model as the primary is allowed with a warning; the product does not maintain a global capability ranking.

## 3. MasterAgent session ownership

Each `builtin:master-agent` block resolves one host-owned functionality instance keyed by:

```text
(workspaceID, blockID, "builtin:master-agent")
```

That instance owns one active top-level Session binding. Layout JSON stores only block identity and presentation. `ensure` is idempotent; `reset` replaces the binding with expected-session and expected-revision protection. Session IDs and generations are server-managed and cannot be written through generic client configuration.

## 4. Session UI reuse

Extract the original routed Session page into an explicit-target reusable surface. The same surface must render messages, composer, terminal, file tree, and review/diff panel for either a route target or a canvas target. Do not create a fake nested route or copy the page. Multiple mounted surfaces must have isolated focus, command handling, terminal mounts, portals, DOM IDs, and local view state.

## 5. Queue integration

Reuse the existing composer submission path. A Queue action sends `delivery: "queue"` immediately to the host through the existing Session input admission API. Existing admitted/promoted events and Session state project pending work. The canvas block and manager must not create a browser holding queue, delay submission, or persist queued prompts in layout/local storage.

## 6. Lifecycle defaults

- Reset is allowed in v1 only when the current session is idle and has zero pending inputs.
- Reset preserves the old session in history and does not transfer queued inputs.
- Removing/tombstoning a block preserves its Session, active run, and admitted queue.
- Binding update events are transient hints; persisted functionality-instance state is authoritative.
- Reconnect always refetches/reconciles authoritative binding state.
- `builtin:chat` remains supported and existing layouts are not auto-migrated.

## 7. Failure behavior

- Unavailable or known-incompatible Coder model: visible failure, no silent primary fallback.
- Stale reset/ensure conflict: typed conflict followed by authoritative refetch.
- Denied `task` permission: disable selector/delegation UX and enforce denial host-side.
- Concurrent ensure: exactly one active binding; clean up only a losing, unbound, empty candidate when safe.
- Ordinary non-MasterAgent sessions: no Coder restrictions or behavioral changes.

## Frozen defaults

```text
Functionality ID:          builtin:master-agent
Coder field:               workspace.coderModel
Per-block override:        absent in v1
Routing boundary:          host-owned child Session
Primary direct mutation:   disabled while Coder is enabled
Queue ownership:           existing host SessionInput path
Binding ownership:         functionality instance
Reset:                     idle + zero pending input
Removal:                   preserve Session and queue
Fallback:                  none
Event authority:           persisted binding, not EventV2
```
