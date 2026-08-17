# MasterAgent Architecture Decisions

Target branch: `feature/UnrealViewer`.

This document freezes the design decisions shared by all implementation tracks. A track may refine internal implementation details, but it must not contradict these decisions without an explicit architecture review.

## 1. Coder rerouting mechanism

Use **host-side subagent delegation**.

The workspace's primary model and OperatingAgent remain responsible for planning, conversation, context gathering, and result synthesis. When Coder mode is enabled, repository-mutating work is delegated to a reserved `coder` child session created with the workspace's selected `coderModel`.

The primary session must not silently swap models. It must also not rely on client-side prompt classification. Host enforcement is required because browser-side routing can be bypassed, cannot reliably classify tool use, and would duplicate policy across clients.

### Enforced behavior

- The main MasterAgent session continues using `workspace.model` and `workspace.operatingAgent`.
- The host exposes a reserved Coder delegation tool or equivalent host-owned delegation path.
- The model used by the child Coder session is resolved from `workspace.coderModel` by the host.
- The client or model cannot pass an arbitrary Coder model, provider, permission override, or directory.
- When Coder mode is enabled, direct repository mutation by the primary agent is denied or removed from its effective tool set.
- Read-only repository inspection and architecture discussion may remain in the primary session.
- Build, test, formatting, migration, debugging, shell-based implementation, patching, editing, and file creation must execute in the Coder child session.
- If the selected Coder model is unavailable, fail visibly. Do not silently fall back to the primary model.

## 2. Coder persistence location

Add nullable `Workspace.Info.coderModel` and the matching patch field.

This is a workspace-wide execution policy, so it belongs beside `model` and `operatingAgent`. It must follow the existing schema → SQL column → service read/write → protocol patch → generated SDK path.

Recommended semantics:

```text
coderModel = null    Coder routing disabled
coderModel != null   Coder routing enabled with the selected model
```

Do not add a per-MasterAgent-block override in v1. Multiple MasterAgent blocks in the same workspace share one Coder policy. The UI should label the control **Workspace Coder** to make its scope clear.

Do not store this setting in layout tuples. Device/style tuples describe presentation, while Coder selection is execution policy.

## 3. MasterAgent session ownership and binding

Each `builtin:master-agent` block resolves a host-owned functionality instance using:

```text
(workspaceID, blockID, "builtin:master-agent")
```

That instance owns one active top-level session binding at a time.

Required lifecycle semantics:

- `ensure` is idempotent and returns the existing session when already bound.
- `reset` creates a new top-level session and atomically changes the binding.
- Binding updates use revision and expected-session checks to prevent races.
- Session IDs and binding generations are server-managed and cannot be patched through generic client configuration APIs.
- Moving, resizing, hiding, reconnecting, or remounting a block does not change its session.
- Removing a block does not delete its session or queued inputs.
- A transient EventV2 binding-update event keeps other connected viewers synchronized.

The layout stores only block identity and presentation. It does not store messages, session lifecycle, queue state, or the authoritative session binding.

## 4. Session UI reuse

Extract a route-independent session surface from the existing routed session page.

The reusable surface receives an explicit target session and renders the existing session UI: messages, composer, terminal, file tree, review panel, and related providers. Route pages remain thin wrappers around the same surface.

Do not fake a nested route inside the canvas block. Explicit session targeting is easier to test, avoids route-state coupling, and permits multiple independent session surfaces on one canvas.

Global keyboard commands must be scoped to the focused block so multiple mounted MasterAgent blocks do not respond simultaneously.

## 5. Queue integration

Reuse the existing composer and host admission path.

The MasterAgent block supplies its bound session ID and enables the existing queue-capable composer behavior. Queue submission must invoke the current `handleSubmit(event, "queue")` path, which sends `delivery: "queue"` to the host.

No client-side queue store, delayed browser submission, or block-local pending-input list may be introduced. Existing host events remain authoritative:

```text
session.input.admitted
session.input.promoted
```

The Session subsystem owns queue projection. The canvas manager owns only the MasterAgent session binding and workspace configuration.

## 6. Reset policy

For the initial implementation, permit reset only when the current session is idle and has no pending inputs.

A reset request must include the expected session ID and expected binding revision. The old session remains in history; queued work is never moved between sessions.

## 7. Block removal policy

Removing a MasterAgent block tombstones or removes its visible functionality instance, but preserves the host Session record, active work, and pending inputs. Deletion of historical sessions is a separate explicit operation.

## 8. Default decisions to freeze

```text
Coder persistence:        workspace.coderModel
Per-block Coder override:  no, not in v1
Routing:                  host-side Coder child-session delegation
Primary direct mutation: disabled while Coder routing is enabled
Unavailable Coder model: visible failure; no silent fallback
Session binding:          host-owned functionality instance
Reset:                    idle session with zero pending inputs
Block removal:            preserve session and queue
Queue implementation:     existing SessionInput host admission
Default layout:           retain builtin:chat; MasterAgent is addable
```
