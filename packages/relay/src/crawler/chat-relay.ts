import type { BrowserContext, Page } from "@playwright/test"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ProfileOptions } from "./browser.js"
import { launchProfile, warmUp } from "./browser.js"
import { captureTurn } from "./capture.js"
import type { ChatCrawler } from "./chat-crawler.js"
import type { CaptureOptions, Turn } from "./types.js"

export type RelayState = "uninitialized" | "initializing" | "ready" | "missing-login" | "error"

export interface RelayedMessage {
  id: string
  role: "user" | "assistant"
  text: string
  at: number
}

export interface ChatSessionContext {
  readonly conversationId: string
  readonly url: string
  readonly messages: readonly RelayedMessage[]
  append(message: { role: "user" | "assistant"; text: string; at?: number }): RelayedMessage
}

export function createChatSessionContext(conversationId: string, url: string): ChatSessionContext {
  const messages: RelayedMessage[] = []
  return {
    conversationId,
    url,
    get messages() {
      return messages
    },
    append(message) {
      const entry: RelayedMessage = {
        id: `${conversationId}-${messages.length + 1}`,
        role: message.role,
        text: message.text,
        at: message.at ?? Date.now(),
      }
      messages.push(entry)
      return entry
    },
  }
}

export interface PersistedSessionContext {
  conversationId: string
  url: string
  messages: RelayedMessage[]
}

// The stored session survives browser restarts: the relay re-adopts the last
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
      messages: [...session.messages],
    }
    await writeFile(file, JSON.stringify(payload))
  } catch {
    // storage failure must not fail the relay
  }
}

function sessionFromStored(stored: PersistedSessionContext): ChatSessionContext {
  const session = createChatSessionContext(stored.conversationId, stored.url)
  for (const message of stored.messages) {
    if (message.role !== "user" && message.role !== "assistant") continue
    session.append({ role: message.role, text: message.text, at: message.at })
  }
  return session
}

export interface OperatingAgentRelay {
  (message: RelayedMessage, context: ChatSessionContext): Promise<void> | void
}

export interface ChatRelayOptions {
  /** Provider-specific crawl behavior; swap to crawl a different provider. */
  crawler: ChatCrawler
  profile: ProfileOptions
  relay?: OperatingAgentRelay
  captureOptions?: CaptureOptions
  sessionStorePath?: string
}

const DEFAULT_CAPTURE: CaptureOptions = { quietMs: 2000, timeoutMs: 600_000 }

export class ChatRelay {
  private state: RelayState = "uninitialized"
  private context: BrowserContext | undefined
  private session: ChatSessionContext | undefined

  constructor(private options: ChatRelayOptions) {}

  get crawler() {
    return this.options.crawler
  }

  get crawlerId() {
    return this.options.crawler.id
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

  async initialize(): Promise<RelayState> {
    if (this.state === "ready") return this.state
    this.state = "initializing"
    try {
      this.context = await launchProfile(this.options.profile)
      const page = this.context.pages()[0] ?? (await this.context.newPage())
      await warmUp(page, this.crawler.homeUrl)
      this.state = (await this.crawler.isLoggedIn(page)) ? "ready" : "missing-login"
      if (this.state === "ready") {
        const stored = this.options.sessionStorePath
          ? await loadStoredSession(this.options.sessionStorePath)
          : undefined
        this.session = stored
          ? sessionFromStored(stored)
          : createChatSessionContext(
              this.crawler.conversationIdFromURL(page.url()) ?? `c-${Date.now()}`,
              page.url(),
            )
      }
    } catch {
      this.state = "error"
    }
    return this.state
  }

  async submit(message: string): Promise<Turn> {
    if (!this.isInitialized()) {
      throw new Error("ChatRelay cannot route until initialized with a logged-in browser session")
    }
    const page = this.requirePage()
    const store = this.session
    if (!store) throw new Error("ChatRelay has no chat session context")

    await this.crawler.send(page, message)

    const user = store.append({ role: "user", text: message })
    await this.relayMessage(user, store)
    await this.persistSession(store)

    const turn = await captureTurn(page, this.options.captureOptions ?? DEFAULT_CAPTURE)
    if (turn.text.trim()) {
      const assistant = store.append({ role: "assistant", text: turn.text, at: turn.finishedAt ?? Date.now() })
      await this.relayMessage(assistant, store)
      await this.persistSession(store)
    }
    return turn
  }

  async dispose(): Promise<void> {
    if (this.context) await this.context.close()
    if (this.session) await this.persistSession(this.session)
    this.context = undefined
    this.session = undefined
    this.state = "uninitialized"
  }

  private requirePage(): Page {
    if (!this.context) throw new Error("ChatRelay has no browser context")
    const page = this.context.pages()[0]
    if (!page) throw new Error("ChatRelay has no open page")
    return page
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
