import type { BlockRuntimeRegistration, BlockRuntimeServices, CanvasBlockDescriptor } from "../contracts"

export interface OperatingChatView {
  workspaceID: string
  blockID: string
  sessionID: string
  directory: string
  queueEnabled: true
}

export const operatingChatRuntimeRegistration: BlockRuntimeRegistration<OperatingChatView, OperatingChatView, never> = {
  functionalityID: "builtin:operating-chat-session",
  mode: "native",
  async resolve(input: {
    workspaceID: string
    block: CanvasBlockDescriptor
    services: BlockRuntimeServices
    signal: AbortSignal
  }) {
    await input.services.workspace.awaitDescriptorPersisted(input.block.id, input.signal)
    const result = await input.services
      .serverSDK()
      .client.v2.workspace.operatingChat.ensure(
        { workspaceID: input.workspaceID, blockID: input.block.id },
        { throwOnError: true, signal: input.signal },
      )
    return {
      workspaceID: result.data.workspaceID,
      blockID: result.data.blockID,
      sessionID: result.data.sessionID,
      directory: result.data.directory,
      queueEnabled: true,
    }
  },
  eventKeys: (resolved) => [
    {
      type: "workspace.operatingChat.binding.updated",
      workspaceID: resolved.workspaceID,
      blockID: resolved.blockID,
    },
  ],
  onEvent: () => "invalidate",
  select: ({ resolved }) => resolved,
}
