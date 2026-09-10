import type { BlockRuntimeRegistration } from "../../runtime/contracts"
import type { ChatProxyRelay } from "@opencode-ai/sdk/v2/client"
import type { SessionContextAttachmentInput } from "@/context/ctxpack/attachment-store"

export type ChatRelay = ChatProxyRelay
export type ChatRelayMessage = ChatRelay["messages"][number]

export interface ChatRelayView {
  draft: string
  relay: ChatRelay
}

export interface ChatRelayResolved extends ChatRelayView {
  storageKey: string
  workspaceID: string
  blockID: string
}

export type ChatRelayCommand =
  | { type: "set-draft"; draft: string }
  | { type: "prompt"; messageID: string; text: string; contextAttachments?: SessionContextAttachmentInput[] }
  | { type: "reset" }
  | { type: "open-relay" }
  | { type: "refresh-options" }
  | { type: "configure"; model?: string; effort?: string }

export const ChatRelayRuntimeAdapter: BlockRuntimeRegistration<ChatRelayResolved, ChatRelayView, ChatRelayCommand> = {
  functionalityID: "builtin:chat-relay",
  mode: "native",
  refreshAfterDispatch: false,

  resolve: async ({ workspaceID, block, services, signal }) => {
    await services.workspace.awaitDescriptorPersisted(block.id, signal)
    const storageKey = JSON.stringify(["chat-relay", workspaceID, block.id])
    const draft = services.localView.read<{ draft?: unknown }>(storageKey)?.draft
    const relay = (
      await services
        .serverSDK()
        .client.v2.chatProxy.relay({ workspaceID, blockID: block.id }, { signal, throwOnError: true })
    ).data
    return {
      storageKey,
      workspaceID,
      blockID: block.id,
      draft: typeof draft === "string" ? draft : "",
      relay,
    }
  },

  refresh: async ({ resolved, services, signal }) => {
    const current = resolved.relay
    const relay = (
      await services
        .serverSDK()
        .client.v2.chatProxy.relay(
          { workspaceID: resolved.workspaceID, blockID: resolved.blockID },
          { signal, throwOnError: true },
        )
    ).data
    if (resolved.relay === current) resolved.relay = relay
  },

  select: ({ resolved }) => ({ draft: resolved.draft, relay: resolved.relay }),

  dispatch: async ({ resolved, command, services, signal }) => {
    if (command.type === "set-draft") {
      resolved.draft = command.draft
      services.localView.write(resolved.storageKey, { draft: command.draft })
      return
    }
    if (command.type === "prompt") {
      const tabID = resolved.relay.tabID
      if (!tabID) throw new Error("chat-relay-tab-unavailable")
      const sdk = services.serverSDK()
      const relay = (
        await sdk.client.v2.chatProxy.prompt(
          {
            workspaceID: resolved.workspaceID,
            blockID: resolved.blockID,
            chatProxyPromptPayload: {
              tabID,
              messageID: command.messageID,
              text: command.text,
              ...(command.contextAttachments?.length ? { contextAttachments: command.contextAttachments } : {}),
            },
          },
          { signal, throwOnError: true },
        )
      ).data
      if (signal.aborted || sdk.scope !== services.serverSDK().scope || resolved.relay.tabID !== tabID) return
      resolved.relay = relay
      if (resolved.draft.trim() === command.text) {
        resolved.draft = ""
        services.localView.write(resolved.storageKey, { draft: "" })
      }
      return
    }
    if (command.type === "reset") {
      const tabID = resolved.relay.tabID
      if (!tabID) throw new Error("chat-relay-tab-unavailable")
      const sdk = services.serverSDK()
      const relay = (
        await sdk.client.v2.chatProxy.reset(
          {
            workspaceID: resolved.workspaceID,
            blockID: resolved.blockID,
            chatProxyResetPayload: { tabID },
          },
          { signal, throwOnError: true },
        )
      ).data
      if (signal.aborted || sdk.scope !== services.serverSDK().scope || resolved.relay.tabID !== tabID) return
      resolved.relay = relay
      return
    }
    const tabID = resolved.relay.tabID
    if (!tabID) throw new Error("chat-relay-tab-unavailable")
    if (command.type === "refresh-options") {
      const sdk = services.serverSDK()
      const relay = (
        await sdk.client.v2.chatProxy.options(
          {
            workspaceID: resolved.workspaceID,
            blockID: resolved.blockID,
            chatProxyOptionsPayload: { tabID },
          },
          { signal, throwOnError: true },
        )
      ).data
      if (!signal.aborted && sdk.scope === services.serverSDK().scope && resolved.relay.tabID === tabID)
        resolved.relay = relay
      return
    }
    if (command.type === "configure") {
      const sdk = services.serverSDK()
      const relay = (
        await sdk.client.v2.chatProxy.configure(
          {
            workspaceID: resolved.workspaceID,
            blockID: resolved.blockID,
            chatProxyConfigurePayload: { tabID, model: command.model, effort: command.effort },
          },
          { signal, throwOnError: true },
        )
      ).data
      if (!signal.aborted && sdk.scope === services.serverSDK().scope && resolved.relay.tabID === tabID)
        resolved.relay = relay
      return
    }
    const sdk = services.serverSDK()
    const relay = (
      await sdk.client.v2.chatProxy.openRelay(
        {
          workspaceID: resolved.workspaceID,
          blockID: resolved.blockID,
          chatProxyOpenRelayPayload: { tabID },
        },
        { signal, throwOnError: true },
      )
    ).data
    if (!signal.aborted && sdk.scope === services.serverSDK().scope && resolved.relay.tabID === tabID)
      resolved.relay = relay
  },
}
