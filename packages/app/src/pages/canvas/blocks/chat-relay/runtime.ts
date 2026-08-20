import type { BlockRuntimeRegistration, BlockRuntimeServices, CanvasBlockDescriptor } from "../../runtime/contracts"

export interface ChatRelayView {
  workspaceID: string
  sessionID: string
  directory: string
  queueEnabled: true
}

export interface ChatRelayResolved extends ChatRelayView {
  blockID: string
}

export const ChatRelayRuntimeAdapter: BlockRuntimeRegistration<ChatRelayResolved, ChatRelayView, never> = {
  functionalityID: "builtin:chat-relay",
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
      .client.v2.workspace.chatRelay.ensure(
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
      type: "workspace.chatRelay.binding.updated",
      workspaceID: resolved.workspaceID,
      blockID: resolved.blockID,
      functionalityID: "builtin:chat-relay",
    },
  ],

  onEvent: () => "invalidate",

  select: ({ resolved }) => ({
    workspaceID: resolved.workspaceID,
    sessionID: resolved.sessionID,
    directory: resolved.directory,
    queueEnabled: true,
  }),
}
