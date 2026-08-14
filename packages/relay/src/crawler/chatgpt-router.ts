import type { BrowserContext, Page } from "@playwright/test"
import type { ProfileOptions } from "./browser.js"
import { launchProfile, warmUp } from "./browser.js"
import { captureTurn, typeLikeHuman } from "./capture.js"
import type { CaptureOptions, Turn } from "./types.js"

export type RouterState = "uninitialized" | "initializing" | "ready" | "missing-login" | "error"

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

export interface OperatingAgentRelay {
  (message: RelayedMessage, context: ChatSessionContext): Promise<void> | void
}

export interface RouterPage {
  getByRole(role: string): { count(): Promise<number> }
}

export async function isLoggedIn(page: RouterPage): Promise<boolean> {
  const composer = page.getByRole("textbox")
  return (await composer.count()) > 0
}

export interface ChatGPTRouterOptions {
  profile: ProfileOptions
  homeUrl?: string
  relay?: OperatingAgentRelay
  captureOptions?: CaptureOptions
}

const DEFAULT_CAPTURE: CaptureOptions = { quietMs: 2000, timeoutMs: 600_000 }

export class ChatGPTRouter {
  private state: RouterState = "uninitialized"
  private context: BrowserContext | undefined
  private session: ChatSessionContext | undefined

  constructor(private options: ChatGPTRouterOptions) {}

  get homeUrl() {
    return this.options.homeUrl ?? "https://chatgpt.com"
  }

  status(): RouterState {
    return this.state
  }

  isInitialized(): boolean {
    return this.state === "ready"
  }

  sessionContext(): ChatSessionContext | undefined {
    return this.session
  }

  async initialize(): Promise<RouterState> {
    if (this.state === "ready") return this.state
    this.state = "initializing"
    try {
      this.context = await launchProfile(this.options.profile)
      const page = this.context.pages()[0] ?? (await this.context.newPage())
      await warmUp(page, this.homeUrl)
      this.state = (await isLoggedIn(page)) ? "ready" : "missing-login"
      if (this.state === "ready") {
        const conversationId =
          page.url().match(/\/(?:c|chat)\/([0-9a-f-]{36})\b/i)?.[1] ?? `c-${Date.now()}`
        this.session = createChatSessionContext(conversationId, page.url())
      }
    } catch {
      this.state = "error"
    }
    return this.state
  }

  async submit(message: string): Promise<Turn> {
    if (!this.isInitialized()) {
      throw new Error("ChatGPTRouter cannot route until initialized with a ChatGPT login")
    }
    const page = this.requirePage()
    const store = this.session
    if (!store) throw new Error("ChatGPTRouter has no chat session context")

    const composer = page.getByRole("textbox").last()
    await composer.click()
    await typeLikeHuman(page, message)
    await page.keyboard.press("Enter")

    const user = store.append({ role: "user", text: message })
    await this.relayMessage(user, store)

    const turn = await captureTurn(page, this.options.captureOptions ?? DEFAULT_CAPTURE)
    if (turn.text.trim()) {
      const assistant = store.append({ role: "assistant", text: turn.text, at: turn.finishedAt ?? Date.now() })
      await this.relayMessage(assistant, store)
    }
    return turn
  }

  async dispose(): Promise<void> {
    if (this.context) await this.context.close()
    this.context = undefined
    this.session = undefined
    this.state = "uninitialized"
  }

  private requirePage(): Page {
    if (!this.context) throw new Error("ChatGPTRouter has no browser context")
    const page = this.context.pages()[0]
    if (!page) throw new Error("ChatGPTRouter has no open page")
    return page
  }

  private async relayMessage(message: RelayedMessage, store: ChatSessionContext): Promise<void> {
    if (!this.options.relay) return
    await this.options.relay(message, store)
  }
}
