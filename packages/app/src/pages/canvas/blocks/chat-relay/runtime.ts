import type { BlockRuntimeRegistration } from "../../runtime/contracts"
import type { ChatProxyRelay } from "@opencode-ai/sdk/v2/client"
import type { SessionContextAttachmentInput } from "@/context/ctxpack/attachment-store"
import type { PromptInputV2PersistedState } from "@opencode-ai/session-ui/v2/prompt-input"

export type ChatRelay = ChatProxyRelay
export type ChatRelayMessage = ChatRelay["messages"][number]

export interface ChatRelayView {
  draft: PromptInputV2PersistedState
  draftRevision: number
  relay: ChatRelay
}

export interface ChatRelayResolved extends ChatRelayView {
  storageKey: string
  workspaceID: string
  blockID: string
}

export type ChatRelayCommand =
  | { type: "set-draft"; draft: PromptInputV2PersistedState; revision: number }
  | {
      type: "prompt"
      messageID: string
      text: string
      draftRevision: number
      skills?: { name: string; contentHash: string }[]
      contextAttachments?: SessionContextAttachmentInput[]
    }
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
    const stored = services.localView.read<{ draft?: unknown; revision?: unknown }>(storageKey)
    const relay = (
      await services
        .serverSDK()
        .client.v2.chatProxy.relay({ workspaceID, blockID: block.id }, { signal, throwOnError: true })
    ).data
    return {
      storageKey,
      workspaceID,
      blockID: block.id,
      draft: normalizeDraft(stored?.draft),
      draftRevision: typeof stored?.revision === "number" ? stored.revision : 0,
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

  select: ({ resolved }) => ({
    draft: resolved.draft,
    draftRevision: resolved.draftRevision,
    relay: resolved.relay,
  }),

  dispatch: async ({ resolved, command, services, signal }) => {
    if (command.type === "set-draft") {
      if (command.revision < resolved.draftRevision) return
      resolved.draft = command.draft
      resolved.draftRevision = command.revision
      services.localView.write(resolved.storageKey, { draft: command.draft, revision: command.revision })
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
              ...(command.skills?.length ? { skills: command.skills } : {}),
              ...(command.contextAttachments?.length ? { contextAttachments: command.contextAttachments } : {}),
            },
          },
          { signal, throwOnError: true },
        )
      ).data
      if (signal.aborted || sdk.scope !== services.serverSDK().scope || resolved.relay.tabID !== tabID) return
      resolved.relay = relay
      if (resolved.draftRevision === command.draftRevision) {
        resolved.draft = normalizeDraft("")
        resolved.draftRevision += 1
        services.localView.write(resolved.storageKey, { draft: resolved.draft, revision: resolved.draftRevision })
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

function normalizeDraft(value: unknown): PromptInputV2PersistedState {
  if (typeof value === "string") {
    return {
      prompt: [{ type: "text", content: value, start: 0, end: value.length }],
      context: { items: [] },
    }
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "prompt" in value &&
    Array.isArray(value.prompt) &&
    "context" in value &&
    typeof value.context === "object" &&
    value.context !== null &&
    "items" in value.context &&
    Array.isArray(value.context.items)
  )
    return value as PromptInputV2PersistedState
  return { prompt: [{ type: "text", content: "", start: 0, end: 0 }], context: { items: [] } }
}
