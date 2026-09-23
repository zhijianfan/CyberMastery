import type { BlockRuntimeRegistration, BlockRuntimeServices, CanvasBlockDescriptor } from "../contracts"

export type OperatingChatView =
  | {
      status: "uninitialized"
      workspaceID: string
      blockID: string
    }
  | {
      status: "ready"
      workspaceID: string
      blockID: string
      functionalityInstanceID: string
      sessionID: string
      directory: string
      queueEnabled: true
      revision: number
    }

export type OperatingChatCommand = { type: "ensure" } | { type: "reset" }

export const operatingChatRuntimeRegistration: BlockRuntimeRegistration<
  OperatingChatView,
  OperatingChatView,
  OperatingChatCommand
> = {
  functionalityID: "builtin:operating-chat-session",
  mode: "native",
  async resolve(input: {
    workspaceID: string
    block: CanvasBlockDescriptor
    services: BlockRuntimeServices
    signal: AbortSignal
  }) {
    await input.services.workspace.awaitDescriptorPersisted(input.block.id, input.signal)
    // Resolve is a read: a block without a session stays uninitialized until
    // the user explicitly creates one.
    const result = await input.services
      .serverSDK()
      .client.v2.workspace.operatingChat.get(
        { workspaceID: input.workspaceID, blockID: input.block.id },
        { throwOnError: true, signal: input.signal },
      )
    if (result.data.status === "unbound")
      return { status: "uninitialized", workspaceID: input.workspaceID, blockID: input.block.id }
    return {
      status: "ready",
      workspaceID: result.data.binding.workspaceID,
      blockID: result.data.binding.blockID,
      functionalityInstanceID: result.data.binding.functionalityInstanceID,
      sessionID: result.data.binding.sessionID,
      directory: result.data.binding.directory,
      queueEnabled: true,
      revision: result.data.binding.revision,
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
  async dispatch(input) {
    if (input.command.type === "ensure") {
      await input.services.serverSDK().client.v2.workspace.operatingChat.ensure(
        {
          workspaceID: input.resolved.workspaceID,
          blockID: input.resolved.blockID,
        },
        { throwOnError: true, signal: input.signal },
      )
      return
    }
    if (input.resolved.status !== "ready") return
    await input.services.serverSDK().client.v2.workspace.operatingChat.reset(
      {
        workspaceID: input.resolved.workspaceID,
        blockID: input.resolved.blockID,
        operatingChatResetPayload: {
          expectedSessionID: input.resolved.sessionID,
          expectedRevision: input.resolved.revision,
        },
      },
      { throwOnError: true, signal: input.signal },
    )
  },
}
