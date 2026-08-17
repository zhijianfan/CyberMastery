# MasterAgent Shared Contracts and Data Model

Target branch: `feature/UnrealViewer`.

This file defines the shared contract that A0 must land before the other implementation tracks. Names may be adjusted to match repository conventions, but ownership, semantics, and field boundaries must remain unchanged.

## 1. Ownership model

```text
Workspace
  model                 primary model
  operatingAgent        primary coordinator agent
  coderModel            optional workspace-wide coding model

MasterAgent functionality instance
  workspace ID
  block ID
  functionality ID
  directory binding
  active session binding
  binding generation/revision

Session domain
  messages
  composer inputs
  queued/steered input state
  runs
  child Coder sessions
  terminal/file/review session state

Canvas layout
  block ID
  builtin:master-agent
  transform and presentation only
```

## 2. Workspace field

Add `coderModel` using the exact Effect Schema and encoded model-selection representation already used by `Workspace.Info.model`.

Conceptual contract:

```ts
export interface WorkspaceInfo {
  // Existing fields...
  model: ModelSelection | null
  operatingAgent: string | null

  /** Workspace-wide model used by the reserved Coder subagent. */
  coderModel: ModelSelection | null
}

export interface WorkspacePatch {
  // Existing patch fields...
  coderModel?: ModelSelection | null
}
```

`null` disables Coder routing. The new field must be readable, writable, patchable, persisted, and present in generated SDK types.

## 3. MasterAgent functionality ID

```ts
export const MasterAgentFunctionalityID = "builtin:master-agent" as const
```

The same literal must be registered in the core/server built-in list and mapped by the app's canvas functionality mapping.

## 4. Functionality-instance configuration

Conceptual schema:

```ts
export namespace MasterAgent {
  export const FunctionalityID = "builtin:master-agent" as const

  export interface InstanceConfiguration {
    version: 1

    directoryBinding:
      | { mode: "workspace-primary" }
      | { mode: "fixed"; directory: string }

    /**
     * Server-managed. It must not be accepted by the generic public
     * functionality-configuration patch endpoint.
     */
    sessionBinding:
      | {
          mode: "owned"
          sessionID: Session.ID
          generation: number
        }
      | null
  }
}
```

The exact storage representation may use normalized columns or JSON according to the existing functionality-instance infrastructure. The important boundary is that the client cannot authoritatively write `sessionBinding`.

## 5. Binding projection

```ts
export interface MasterAgentBinding {
  workspaceID: Workspace.ID
  blockID: string
  functionalityInstanceID: string
  sessionID: Session.ID
  directory: string
  generation: number
  revision: number
}
```

Every get, ensure, reset, and binding-update event should return or carry enough information for the client to reconcile this projection.

## 6. Lifecycle requests

```ts
export interface MasterAgentEnsureRequest {
  workspaceID: Workspace.ID
  blockID: string
}

export interface MasterAgentResetRequest {
  workspaceID: Workspace.ID
  blockID: string
  expectedSessionID: Session.ID
  expectedRevision: number
}
```

Recommended operations:

```text
workspace.masterAgent.get
workspace.masterAgent.ensure
workspace.masterAgent.reset
```

There is deliberately no MasterAgent-specific prompt endpoint. After resolving the binding, the embedded composer uses the ordinary Session prompt/admission API.

## 7. Binding update event

```ts
export interface MasterAgentBindingUpdatedEvent {
  type: "workspace.master-agent.binding.updated"
  workspaceID: Workspace.ID
  blockID: string
  sessionID: Session.ID
  generation: number
  revision: number
}
```

The event is a transient synchronization signal. The persisted functionality-instance binding remains authoritative and must be re-fetchable after reconnect.

## 8. Concurrency contract

`ensure` must tolerate multiple clients mounting the same block simultaneously.

One of these implementation strategies is required:

1. Create session and binding within one transaction where supported.
2. Create a candidate session and use a functionality-instance revision compare-and-swap. A loser reloads the winning binding and archives/removes its unbound candidate session.

The final state must contain exactly one active binding for the block.

`reset` must reject stale requests whose `expectedSessionID` or `expectedRevision` no longer matches.

## 9. Coder execution contract

The host resolves Coder policy from the parent MasterAgent session back to its workspace and functionality instance.

A reserved Coder delegation request must not accept these values from the model or client:

```ts
model?: ModelSelection
providerID?: string
modelID?: string
permissionOverride?: unknown
directory?: string
```

The host provides them from trusted state:

```text
model       snapshot(workspace.coderModel)
directory   MasterAgent directory binding
parentID    MasterAgent top-level session
agent       reserved coder agent
permissions effective workspace/project policy
```

Changing `coderModel` affects future child sessions only. An already-running child retains its creation-time model snapshot.

## 10. Permission contract

The existing `task` permission gates Coder delegation in both UI and host enforcement.

Client gating improves usability but is not a security boundary. The server or opencode host must independently reject delegation when the effective project configuration denies `task`.

User-operated terminal UI is not disabled merely because the primary agent's autonomous shell/edit tools are restricted during Coder mode.
