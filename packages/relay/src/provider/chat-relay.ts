import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ChatCredentials, DeviceLogin } from "./oauth.js"
import type { ChatProvider } from "./provider.js"
import type { ChatSession, DownloadableFile, Turn } from "./types.js"

export type RelayState = "uninitialized" | "initializing" | "awaiting-login" | "ready" | "missing-login" | "error"

export interface AuthInfo {
  verificationUrl: string
  userCode: string
}

export interface RelayedMessage {
  id: string
  role: "user" | "assistant"
  text: string
  files?: DownloadableFile[]
  at: number
}

export interface ChatSessionContext {
  readonly conversationId: string
  readonly url: string
  readonly parentMessageId: string | undefined
  readonly messages: readonly RelayedMessage[]
  append(message: { role: "user" | "assistant"; text: string; files?: DownloadableFile[]; at?: number }): RelayedMessage
  /** Adopt the provider's latest conversation identity before persisting. */
  sync(conversationId: string | undefined, url: string, parentMessageId: string | undefined): void
}

export function createChatSessionContext(conversationId: string, url: string): ChatSessionContext {
  const messages: RelayedMessage[] = []
  let currentId = conversationId
  let currentUrl = url
  let currentParent: string | undefined
  return {
    get conversationId() {
      return currentId
    },
    get url() {
      return currentUrl
    },
    get parentMessageId() {
      return currentParent
    },
    get messages() {
      return messages
    },
    append(message) {
      const entry: RelayedMessage = {
        id: `${currentId}-${messages.length + 1}`,
        role: message.role,
        text: message.text,
        files: message.files,
        at: message.at ?? Date.now(),
      }
      messages.push(entry)
      return entry
    },
    sync(conversationId, url, parentMessageId) {
      if (conversationId) currentId = conversationId
      if (url) currentUrl = url
      currentParent = parentMessageId
    },
  }
}

export interface PersistedSessionContext {
  conversationId: string
  url: string
  parentMessageId?: string
  messages: RelayedMessage[]
}

// The stored session survives server restarts: the relay re-adopts the last
// conversation context so relayed messages accumulate across sessions.
export async function loadStoredSession(file: string): Promise<PersistedSessionContext | undefined> {
  try {
    const saved = JSON.parse(await readFile(file, "utf8")) as PersistedSessionContext
    if (typeof saved.conversationId !== "string" || typeof saved.url !== "string") return undefined
    return saved
  } catch {
    return undefined
  }
}

export async function saveStoredSession(file: string, session: ChatSessionContext): Promise<void> {
  try {
    await mkdir(path.dirname(file), { recursive: true })
    const payload: PersistedSessionContext = {
      conversationId: session.conversationId,
      url: session.url,
      parentMessageId: session.parentMessageId,
      messages: [...session.messages],
    }
    await writeFile(file, JSON.stringify(payload))
  } catch {
    // storage failure must not fail the relay
  }
}

function sessionFromStored(stored: PersistedSessionContext): ChatSessionContext {
  const session = createChatSessionContext(stored.conversationId, stored.url)
  session.sync(stored.conversationId, stored.url, stored.parentMessageId)
  for (const message of stored.messages) {
    if (message.role !== "user" && message.role !== "assistant") continue
    session.append({ role: message.role, text: message.text, files: message.files, at: message.at })
  }
  return session
}

export interface OperatingAgentRelay {
  (message: RelayedMessage, context: ChatSessionContext): Promise<void> | void
}

export interface ChatRelayOptions {
  /** Provider-specific account auth and message exchange. */
  provider: ChatProvider
  relay?: OperatingAgentRelay
  sessionStorePath?: string
  /** Wall-clock deadline for the device-login poll (default 15 minutes). */
  loginDeadlineMs?: number
  /** Override for the login poll delay (tests); defaults to the flow interval. */
  loginPollDelayMs?: number
  now?: () => number
}

const LOGIN_POLL_SAFETY_MS = 3000
const DEFAULT_LOGIN_DEADLINE_MS = 15 * 60_000
// Refresh an access token before its last minute to keep sends cheap.
const CREDENTIAL_SKEW_MS = 60_000

interface PendingLogin {
  flow: DeviceLogin
  deadline: number
  timer: ReturnType<typeof setTimeout> | undefined
}

export class ChatRelay {
  private state: RelayState = "uninitialized"
  private chat: ChatSession | undefined
  private pendingLogin: PendingLogin | undefined
  private session: ChatSessionContext | undefined

  constructor(private options: ChatRelayOptions) {}

  get providerId() {
    return this.options.provider.id
  }

  status(): RelayState {
    return this.state
  }

  isInitialized(): boolean {
    return this.state === "ready"
  }

  sessionContext(): ChatSessionContext | undefined {
    return this.session
  }

  /** The verification URL and user code while authorization is pending. */
  authInfo(): AuthInfo | undefined {
    if (!this.pendingLogin) return undefined
    return {
      verificationUrl: this.pendingLogin.flow.verificationUrl,
      userCode: this.pendingLogin.flow.userCode,
    }
  }

  async initialize(): Promise<RelayState> {
    if (this.state === "ready" || this.state === "awaiting-login") return this.state
    this.state = "initializing"
    try {
      const credentials = await this.restoreCredentials()
      if (!credentials) return await this.startLogin()
      return await this.openChat(credentials)
    } catch {
      this.state = "error"
      return this.state
    }
  }

  async submit(message: string): Promise<Turn> {
    if (!this.isInitialized()) {
      throw new Error("ChatRelay cannot route until authenticated with a chat account")
    }
    const chat = this.chat
    const store = this.session
    if (!chat || !store) throw new Error("ChatRelay has no chat session context")

    const user = store.append({ role: "user", text: message })
    await this.relayMessage(user, store)
    await this.persistSession(store)

    const startedAt = Date.now()
    let text = ""
    let turn: Turn
    try {
      for await (const delta of chat.send(message)) text += delta
      const captured = chat.turn()
      turn = captured ?? { role: "assistant", text, files: [], startedAt, finishedAt: Date.now() }
    } catch (cause) {
      // Hard failure with no content rethrows so the caller surfaces it;
      // partial content degrades to an incomplete turn.
      if (!text.trim()) throw cause
      turn = { role: "assistant", text, files: [], startedAt, finishedAt: null }
    }

    store.sync(chat.conversationId, chat.url, chat.parentMessageId)
    if (turn.text.trim()) {
      const assistant = store.append({ role: "assistant", text: turn.text, files: turn.files, at: turn.finishedAt ?? Date.now() })
      await this.relayMessage(assistant, store)
      await this.persistSession(store)
    }
    return turn
  }

  async dispose(): Promise<void> {
    if (this.pendingLogin?.timer) clearTimeout(this.pendingLogin.timer)
    this.pendingLogin = undefined
    if (this.chat) await this.chat.dispose()
    if (this.session) await this.persistSession(this.session)
    this.chat = undefined
    this.session = undefined
    this.state = "uninitialized"
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private async restoreCredentials(): Promise<ChatCredentials | undefined> {
    const stored = await this.options.provider.restoreCredentials()
    if (!stored) return undefined
    if (stored.expiresAt > this.now() + CREDENTIAL_SKEW_MS) return stored
    try {
      const refreshed = await this.options.provider.refreshCredentials(stored)
      await this.options.provider.saveCredentials(refreshed)
      return refreshed
    } catch {
      await this.options.provider.clearCredentials()
      return undefined
    }
  }

  private async openChat(credentials: ChatCredentials): Promise<RelayState> {
    const stored = this.options.sessionStorePath
      ? await loadStoredSession(this.options.sessionStorePath)
      : undefined
    const chat = await this.options.provider.openChat({
      credentials,
      onRefresh: async (current) => {
        const refreshed = await this.options.provider.refreshCredentials(current)
        await this.options.provider.saveCredentials(refreshed)
        return refreshed
      },
      context: stored
        ? { conversationId: stored.conversationId, parentMessageId: stored.parentMessageId }
        : undefined,
    })
    this.chat = chat
    this.session = stored
      ? sessionFromStored(stored)
      : createChatSessionContext(chat.conversationId ?? `c-${Date.now()}`, chat.url)
    this.session.sync(chat.conversationId, chat.url, chat.parentMessageId)
    this.state = "ready"
    return this.state
  }

  private async startLogin(): Promise<RelayState> {
    const flow = await this.options.provider.startLogin()
    this.pendingLogin = {
      flow,
      deadline: this.now() + (this.options.loginDeadlineMs ?? DEFAULT_LOGIN_DEADLINE_MS),
      timer: undefined,
    }
    this.state = "awaiting-login"
    this.scheduleLoginPoll()
    return this.state
  }

  private scheduleLoginPoll(): void {
    const pending = this.pendingLogin
    if (!pending || this.state !== "awaiting-login") return
    const delay = this.options.loginPollDelayMs ?? Math.max(pending.flow.pollIntervalMs, 5000) + LOGIN_POLL_SAFETY_MS
    pending.timer = setTimeout(() => {
      void this.pollLogin()
    }, delay)
  }

  private async pollLogin(): Promise<void> {
    const pending = this.pendingLogin
    if (!pending || this.state !== "awaiting-login") return
    if (this.now() >= pending.deadline) {
      this.finishLogin()
      return
    }

    try {
      const result = await pending.flow.poll()
      if (result.type === "pending") {
        this.scheduleLoginPoll()
        return
      }
      this.pendingLogin = undefined
      if (result.type === "denied") {
        this.state = "missing-login"
        return
      }
      try {
        await this.options.provider.saveCredentials(result.credentials)
        await this.openChat(result.credentials)
      } catch {
        this.state = "error"
      }
    } catch {
      // Transient poll failure: keep polling until the deadline.
      this.scheduleLoginPoll()
    }
  }

  private finishLogin(): void {
    this.pendingLogin = undefined
    this.state = "missing-login"
  }

  private async persistSession(store: ChatSessionContext): Promise<void> {
    if (!this.options.sessionStorePath) return
    await saveStoredSession(this.options.sessionStorePath, store)
  }

  private async relayMessage(message: RelayedMessage, store: ChatSessionContext): Promise<void> {
    if (!this.options.relay) return
    await this.options.relay(message, store)
  }
}
