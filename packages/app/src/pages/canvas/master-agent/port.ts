import type { MasterAgent, MasterAgentPort, WorkspaceInfo, WorkspacePatch } from "./types"

export interface MasterAgentTransport {
  get(request: MasterAgent.GetRequest, signal?: AbortSignal): Promise<MasterAgent.Binding | null>
  ensure(request: MasterAgent.EnsureRequest, signal?: AbortSignal): Promise<MasterAgent.Binding>
  reset(request: MasterAgent.ResetRequest, signal?: AbortSignal): Promise<MasterAgent.Binding>
  patchWorkspace(workspaceID: string, patch: WorkspacePatch, signal?: AbortSignal): Promise<WorkspaceInfo>
}

export function createMasterAgentPort(transport: MasterAgentTransport): MasterAgentPort {
  return {
    get(workspaceID, blockID, signal) {
      return transport.get({ workspaceID, blockID }, signal)
    },
    ensure(workspaceID, blockID, signal) {
      return transport.ensure({ workspaceID, blockID }, signal)
    },
    reset(input, signal) {
      return transport.reset(input, signal)
    },
    patchCoderModel(workspaceID, coderModel, signal) {
      return transport.patchWorkspace(workspaceID, { coderModel }, signal)
    },
  }
}
