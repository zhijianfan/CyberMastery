// Track I — MasterAgent as a generic BlockRuntimeRegistration. The existing
// manager-backed lifecycle remains the canvas's live path; this registration
// is the runtime-host path M wires in workspace.tsx at integration.
import type { BlockRuntimeRegistration } from "../runtime/contracts"
import { createMasterAgentSdkPort } from "./sdk-port"
import { MasterAgent, type ModelSelection } from "./types"

export interface MasterAgentRuntimeDescriptor {
  id: string
  functionalityID: typeof MasterAgent.FunctionalityID
}

export interface MasterAgentResolved {
  workspaceID: string
  blockID: string
  binding: MasterAgent.Binding
}

export interface MasterAgentView {
  status: "ready" | "uninitialized"
  workspaceID: string
  sessionID?: string
  directory?: string
  coder: ModelSelection | null
  queueEnabled: boolean
}

export type MasterAgentCommand =
  | { type: "ensure" }
  | { type: "retry" }
  | { type: "reset"; expectedSessionID?: string }
  | { type: "coder.set"; model: ModelSelection }
  | { type: "coder.clear" }

export const masterAgentRuntimeRegistration: BlockRuntimeRegistration<
  MasterAgentResolved,
  MasterAgentView,
  MasterAgentCommand
> = {
  functionalityID: MasterAgent.FunctionalityID,
  mode: "native",

  async resolve({ workspaceID, block, services, signal }) {
    await services.workspace.awaitDescriptorPersisted(block.id, signal)
    const transport = createMasterAgentSdkPort(services.serverSDK().client)
    const binding = await transport.ensure({ workspaceID, blockID: block.id }, signal)
    return { workspaceID, blockID: block.id, binding }
  },

  select({ resolved }) {
    return {
      status: "ready",
      workspaceID: resolved.workspaceID,
      sessionID: resolved.binding.sessionID,
      directory: resolved.binding.directory,
      coder: null,
      queueEnabled: true,
    }
  },

  eventKeys: (resolved) => [
    {
      type: "workspace.master-agent.binding.updated",
      workspaceID: resolved.workspaceID,
      blockID: resolved.blockID,
      functionalityID: MasterAgent.FunctionalityID,
    },
  ],

  onEvent: () => "invalidate",

  async dispatch({ resolved, command, services, signal }) {
    const transport = createMasterAgentSdkPort(services.serverSDK().client)
    switch (command.type) {
      case "ensure":
      case "retry":
        await transport.ensure({ workspaceID: resolved.workspaceID, blockID: resolved.blockID }, signal)
        return
      case "reset":
        await transport.reset(
          {
            workspaceID: resolved.workspaceID,
            blockID: resolved.blockID,
            expectedSessionID: command.expectedSessionID ?? resolved.binding.sessionID,
            expectedRevision: resolved.binding.revision,
          },
          signal,
        )
        return
      case "coder.set":
        await transport.patchWorkspace(resolved.workspaceID, { coderModel: command.model }, signal)
        return
      case "coder.clear":
        await transport.patchWorkspace(resolved.workspaceID, { coderModel: null }, signal)
        return
    }
  },
}
