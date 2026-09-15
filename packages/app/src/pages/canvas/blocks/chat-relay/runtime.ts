import type { BlockRuntimeRegistration, BlockRuntimeServices } from "../../runtime/contracts"
import type { ChatProxyRelay } from "@opencode-ai/sdk/v2/client"
import type { SessionContextAttachmentInput } from "@/context/ctxpack/attachment-store"
import type { PromptInputV2Attachment, PromptInputV2PersistedState } from "@opencode-ai/session-ui/v2/prompt-input"
import { blobDataUrl } from "@/utils/draft-store"

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
      files?: Pick<PromptInputV2Attachment, "filename" | "mime" | "blob">[]
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
    const durable = await services.draftStore?.getItem(storageKey).catch((error: unknown) => {
      // The shared store decodes JSON before returning it; a corrupt document is still present.
      if (error instanceof SyntaxError) return ""
      throw error
    })
    const stored = durable == null ? services.localView.read(storageKey) : parseStored(durable)
    const draft = normalizeDraft(stored && typeof stored === "object" && "draft" in stored ? stored.draft : undefined)
    const revision =
      stored && typeof stored === "object" && "revision" in stored && typeof stored.revision === "number"
        ? stored.revision
        : 0
    if (services.draftStore) {
      if (durable == null && stored !== undefined)
        await services.draftStore.setItem(storageKey, JSON.stringify({ draft, revision }))
      services.localView.write(storageKey, { draft: localDraft(draft), revision })
    }
    const relay = (
      await services
        .serverSDK()
        .client.v2.chatProxy.relay({ workspaceID, blockID: block.id }, { signal, throwOnError: true })
    ).data
    return {
      storageKey,
      workspaceID,
      blockID: block.id,
      draft,
      draftRevision: revision,
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
      await persistDraft(services, resolved.storageKey, command.draft, command.revision)
      return
    }
    if (command.type === "prompt") {
      const tabID = resolved.relay.tabID
      if (!tabID) throw new Error("chat-relay-tab-unavailable")
      const sdk = services.serverSDK()
      const files = command.files?.length
        ? await Promise.all(
            command.files.map(async (file) => ({
              uri: await blobDataUrl(file.blob, file.mime),
              mime: file.mime,
              name: file.filename,
            })),
          )
        : undefined
      const relay = (
        await sdk.client.v2.chatProxy.prompt(
          {
            workspaceID: resolved.workspaceID,
            blockID: resolved.blockID,
            chatProxyPromptPayload: {
              tabID,
              messageID: command.messageID,
              text: command.text,
              ...(files ? { files } : {}),
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
        await persistDraft(services, resolved.storageKey, resolved.draft, resolved.draftRevision)
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

function parseStored(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function localDraft(draft: PromptInputV2PersistedState): PromptInputV2PersistedState {
  return { ...draft, prompt: draft.prompt.filter((part) => part.type !== "image") }
}

async function persistDraft(
  services: BlockRuntimeServices,
  storageKey: string,
  draft: PromptInputV2PersistedState,
  revision: number,
) {
  // Publish coordination state before awaiting storage so older writes cannot overwrite newer edits.
  services.localView.write(storageKey, { draft: services.draftStore ? localDraft(draft) : draft, revision })
  await services.draftStore?.setItem(storageKey, JSON.stringify({ draft, revision }))
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
    return {
      ...value,
      prompt: value.prompt.filter((part) => {
        if (!part || typeof part !== "object") return false
        if (part.type !== "image") return true
        return (
          typeof part.id === "string" &&
          typeof part.filename === "string" &&
          typeof part.mime === "string" &&
          part.blob &&
          typeof part.blob === "object" &&
          typeof part.blob.id === "string" &&
          typeof part.blob.url === "string"
        )
      }),
    } as PromptInputV2PersistedState
  return { prompt: [{ type: "text", content: "", start: 0, end: 0 }], context: { items: [] } }
}
