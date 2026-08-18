import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { startDeviceLogin, refreshAccessToken, type ChatCredentials, type FetchLike, type OAuthClientOptions } from "./oauth.js"
import type { ChatProvider } from "./provider.js"
import { parseEventStream } from "./sse.js"
import type { ChatSession, Turn } from "./types.js"

// The first provider: ChatGPT, authenticated with opencode's built-in
// ChatGPT/Codex OAuth app (see oauth.ts). Messages are sent through the
// ChatGPT backend-api conversation endpoint and the reply is captured from
// the SSE stream — no browser, no page crawler.

export const CHATGPT_ISSUER = "https://auth.openai.com"
export const CHATGPT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
export const CHATGPT_HOME_URL = "https://chatgpt.com"
const CHATGPT_API_BASE = "https://chatgpt.com/backend-api"
const SEND_TIMEOUT_MS = 600_000
const REFRESH_RETRY_STATUSES = new Set([401, 403])

export interface ChatGPTProviderOptions extends Partial<OAuthClientOptions> {
  credentialsPath: string
  apiBase?: string
  sendTimeoutMs?: number
}

interface ConversationEvent {
  message?: {
    id?: string
    author?: { role?: string }
    content?: { content_type?: string; parts?: unknown[] }
  }
  conversation_id?: string
  message_id?: string
  error?: string
}

function requestBody(prompt: string, context: { conversationId?: string; parentMessageId?: string }) {
  return JSON.stringify({
    action: "next",
    messages: [
      {
        id: crypto.randomUUID(),
        author: { role: "user" },
        content: { content_type: "text", parts: [prompt] },
      },
    ],
    model: "auto",
    conversation_id: context.conversationId,
    parent_message_id: context.parentMessageId,
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

export function createChatGPTProvider(options: ChatGPTProviderOptions): ChatProvider {
  const oauth: OAuthClientOptions = {
    issuer: options.issuer ?? CHATGPT_ISSUER,
    clientId: options.clientId ?? CHATGPT_CLIENT_ID,
    userAgent: options.userAgent,
    fetchFn: options.fetchFn,
    now: options.now,
  }
  const apiBase = options.apiBase ?? CHATGPT_API_BASE
  const sendTimeoutMs = options.sendTimeoutMs ?? SEND_TIMEOUT_MS
  const fetchFn: FetchLike = options.fetchFn ?? fetch

  const readCredentials = async (): Promise<ChatCredentials | undefined> => {
    try {
      const saved = JSON.parse(await readFile(options.credentialsPath, "utf8")) as Partial<ChatCredentials>
      if (
        typeof saved.accessToken !== "string" ||
        typeof saved.refreshToken !== "string" ||
        typeof saved.expiresAt !== "number"
      ) {
        return undefined
      }
      return {
        accessToken: saved.accessToken,
        refreshToken: saved.refreshToken,
        expiresAt: saved.expiresAt,
        accountId: typeof saved.accountId === "string" ? saved.accountId : undefined,
      }
    } catch {
      return undefined
    }
  }

  const writeCredentials = async (credentials: ChatCredentials): Promise<void> => {
    await mkdir(path.dirname(options.credentialsPath), { recursive: true })
    await writeFile(options.credentialsPath, JSON.stringify(credentials))
  }

  const openChat = async ({
    credentials,
    onRefresh,
    context,
  }: {
    credentials: ChatCredentials
    onRefresh: (credentials: ChatCredentials) => Promise<ChatCredentials>
    context?: { conversationId?: string; parentMessageId?: string }
  }): Promise<ChatSession> => {
    let current = credentials
    let conversationId = context?.conversationId
    let parentMessageId = context?.parentMessageId
    let lastTurn: Turn | undefined
    let activeController: AbortController | undefined

    const headers = () => {
      const result: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${current.accessToken}`,
        Origin: CHATGPT_HOME_URL,
        "User-Agent": "opencode",
      }
      if (current.accountId) result["ChatGPT-Account-Id"] = current.accountId
      return result
    }

    const send = async function* (prompt: string): AsyncIterable<string> {
      const startedAt = Date.now()
      let text = ""
      let finishedAt: number | null = null
      const controller = new AbortController()
      activeController = controller
      const timer = setTimeout(() => controller.abort(), sendTimeoutMs)

      try {
        const endpoint = conversationId ? `${apiBase}/conversation/${conversationId}` : `${apiBase}/conversation`
        const body = requestBody(prompt, { conversationId, parentMessageId })
        let response = await fetchFn(endpoint, { method: "POST", headers: headers(), body, signal: controller.signal })
        if (REFRESH_RETRY_STATUSES.has(response.status)) {
          current = await onRefresh(current)
          response = await fetchFn(endpoint, { method: "POST", headers: headers(), body, signal: controller.signal })
        }
        if (!response.ok || !response.body) throw new Error(`ChatGPT conversation request failed: ${response.status}`)

        for await (const data of parseEventStream(response.body)) {
          if (data === "[DONE]") break
          let event: ConversationEvent
          try {
            event = JSON.parse(data) as ConversationEvent
          } catch {
            continue
          }
          if (event.error) throw new Error(`ChatGPT conversation error: ${event.error}`)
          if (event.message?.author?.role === "assistant") {
            for (const part of event.message.content?.parts ?? []) {
              if (typeof part === "string") {
                text += part
                yield part
              }
            }
            if (event.message.id) parentMessageId = event.message.id
          }
          conversationId = event.conversation_id ?? conversationId
        }
        // Reached only when the stream ends cleanly ([DONE] or EOF).
        finishedAt = Date.now()
      } catch (error) {
        // A stall (timeout) leaves a partial turn; any other failure before
        // content arrived still throws.
        if (!isAbortError(error) && !text) throw error
      } finally {
        clearTimeout(timer)
        if (activeController === controller) activeController = undefined
      }
      lastTurn = { role: "assistant", text, files: [], startedAt, finishedAt }
    }

    return {
      get conversationId() {
        return conversationId
      },
      get parentMessageId() {
        return parentMessageId
      },
      get url() {
        return conversationId ? `${CHATGPT_HOME_URL}/c/${conversationId}` : CHATGPT_HOME_URL
      },
      send,
      turn: () => lastTurn,
      dispose: async () => {
        activeController?.abort()
      },
    }
  }

  return {
    id: "chatgpt",
    homeUrl: CHATGPT_HOME_URL,
    restoreCredentials: readCredentials,
    saveCredentials: writeCredentials,
    clearCredentials: async () => {
      await rm(options.credentialsPath, { force: true })
    },
    refreshCredentials: (credentials) => refreshAccessToken(oauth, credentials.refreshToken, options.now?.() ?? Date.now()),
    startLogin: () => startDeviceLogin(oauth),
    openChat,
  }
}
