import type { BlockRuntimeRegistration, BlockRuntimeServices } from "../../runtime/contracts"
import type { ChatProxyRelay } from "@opencode-ai/sdk/v2/client"
import type { SessionContextAttachmentInput } from "@/context/ctxpack/attachment-store"
import type { PromptInputV2Attachment, PromptInputV2PersistedState } from "@opencode-ai/session-ui/v2/prompt-input"
import { blobDataUrl } from "@/utils/draft-store"

export type ChatRelay = ChatProxyRelay & { readonly?: boolean; busy?: boolean }
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
  | { type: "set-draft"; tabID?: string; draft: PromptInputV2PersistedState; revision: number }
  | {
      type: "prompt"
      tabID?: string
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
    const sdk = services.serverSDK()
    // Resolve is a read: a block without a conversation stays empty until the
    // user explicitly starts one.
    const owned = await sdk.canvasTabClient.listOwned({ workspaceID, kind: "chat-relay", blockID: block.id, limit: 1 })
    if (owned.items.length === 0)
      return {
        ...(await readDraft(services, workspaceID, block.id, undefined)),
        workspaceID,
        blockID: block.id,
        relay: {
          providerID: "chatgpt",
          workspaceID,
          blockID: block.id,
          status: "closed",
          messages: [],
          readonly: true,
        } as ChatProxyRelay,
      }
    const relay = (
      await sdk.client.v2.chatProxy.relay({ workspaceID, blockID: block.id }, { signal, throwOnError: true })
    ).data
    return {
      ...(await readDraft(services, workspaceID, block.id, relay.tabID)),
      workspaceID,
      blockID: block.id,
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
    if (resolved.relay !== current || signal.aborted) return
    const next =
      current.tabID !== relay.tabID
        ? await readDraft(services, resolved.workspaceID, resolved.blockID, relay.tabID)
        : undefined
    if (resolved.relay !== current || signal.aborted) return
    if (next) Object.assign(resolved, next)
    resolved.relay = relay
  },

  select: ({ resolved }) => ({
    draft: resolved.draft,
    draftRevision: resolved.draftRevision,
    relay: resolved.relay,
  }),

  dispatch: async ({ resolved, command, services, signal }) => {
    if (command.type === "set-draft") {
      if (command.tabID && command.tabID !== resolved.relay.tabID) return
      if (command.revision < resolved.draftRevision) return
      resolved.draft = command.draft
      resolved.draftRevision = command.revision
      await persistDraft(services, resolved.storageKey, command.draft, command.revision)
      return
    }
    if (command.type === "prompt") {
      const tabID = resolved.relay.tabID
      if (
        !tabID ||
        (command.tabID && command.tabID !== tabID) ||
        resolved.relay.readonly ||
        resolved.relay.status === "closed"
      )
        throw new Error("chat-relay-tab-unavailable")
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

async function readDraft(services: BlockRuntimeServices, workspaceID: string, blockID: string, tabID?: string) {
  const legacyKey = JSON.stringify(["chat-relay", workspaceID, blockID])
  const storageKey = tabID ? JSON.stringify(["chat-relay", workspaceID, blockID, tabID]) : legacyKey
  const read = async (key: string) => {
    const durable = await services.draftStore?.getItem(key).catch((error: unknown) => {
      if (error instanceof SyntaxError) return ""
      throw error
    })
    return durable == null ? services.localView.read(key) : (parseStored(durable) ?? null)
  }
  const stored = await read(storageKey)
  const legacy = stored === undefined && tabID ? await read(legacyKey) : undefined
  const value = stored ?? legacy
  const draft = normalizeDraft(value && typeof value === "object" && "draft" in value ? value.draft : undefined)
  const revision =
    value && typeof value === "object" && "revision" in value && typeof value.revision === "number" ? value.revision : 0
  if (services.draftStore || value !== undefined) await persistDraft(services, storageKey, draft, revision)
  if (legacy !== undefined) {
    // Consume the single pre-tabs draft once; it must not leak into later conversations.
    await services.draftStore?.removeItem(legacyKey)
    services.localView.delete(legacyKey)
  }
  return { storageKey, draft, draftRevision: revision }
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
