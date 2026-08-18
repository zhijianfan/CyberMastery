export interface ModelSelection {
  providerID: string
  modelID: string
  variant?: string
}

export interface WorkspaceInfo {
  model: ModelSelection | null
  operatingAgent: string | null
  coderModel: ModelSelection | null
}

export interface WorkspacePatch {
  coderModel?: ModelSelection | null
}

export namespace MasterAgent {
  export const FunctionalityID = "builtin:master-agent" as const

  export type DirectoryBinding =
    | { mode: "workspace-primary" }
    | { mode: "fixed"; directory: string }

  export interface SessionBinding {
    mode: "owned"
    sessionID: string
    generation: number
  }

  export interface InstanceConfiguration {
    version: 1
    directoryBinding: DirectoryBinding
    sessionBinding: SessionBinding | null
  }

  export interface Binding {
    workspaceID: string
    blockID: string
    functionalityInstanceID: string
    sessionID: string
    directory: string
    generation: number
    revision: number
  }

  export interface GetRequest {
    workspaceID: string
    blockID: string
  }

  export interface EnsureRequest {
    workspaceID: string
    blockID: string
  }

  export interface ResetRequest {
    workspaceID: string
    blockID: string
    expectedSessionID: string
    expectedRevision: number
  }

  export interface BindingUpdatedEvent {
    type: "workspace.master-agent.binding.updated"
    workspaceID: string
    blockID: string
    sessionID: string
    generation: number
    revision: number
  }
}

export type MasterAgentError =
  | { type: "workspace-not-found" }
  | { type: "block-not-found" }
  | { type: "wrong-functionality"; actual?: string }
  | { type: "instance-not-found" }
  | { type: "session-not-found" }
  | { type: "access-denied" }
  | { type: "stale-binding"; current?: MasterAgent.Binding }
  | { type: "reset-busy" }
  | { type: "reset-has-pending-input" }
  | { type: "concurrent-conflict" }

export interface MasterAgentPort {
  get(workspaceID: string, blockID: string, signal?: AbortSignal): Promise<MasterAgent.Binding | null>
  ensure(workspaceID: string, blockID: string, signal?: AbortSignal): Promise<MasterAgent.Binding>
  reset(input: MasterAgent.ResetRequest, signal?: AbortSignal): Promise<MasterAgent.Binding>
  patchCoderModel(workspaceID: string, coderModel: ModelSelection | null, signal?: AbortSignal): Promise<WorkspaceInfo>
}

export type BindingState =
  | { status: "uninitialized" }
  | { status: "loading" }
  | { status: "ready"; binding: MasterAgent.Binding }
  | { status: "permission-denied" }
  | { status: "unavailable"; reason: string }
  | { status: "error"; error: unknown; recoverable: boolean }
