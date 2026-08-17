import type { Page } from "@playwright/test"
import { launchProfile, warmUp, type ProfileOptions } from "./browser.js"
import { captureTurn as capture, typeLikeHuman } from "./capture.js"
import type { ChatCrawler, CrawlerPage } from "./chat-crawler.js"
import type { CaptureOptions, ChatProvider, ChatSession, Turn } from "./types.js"

const HOME_URL = "https://chatgpt.com"

// ChatGPT conversation ids live under `/c/<uuid>`. Shared links (`/share/…`)
// and the home page carry no live conversation id.
const CONVERSATION_ID = /\/(?:c)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i

// A logged-in ChatGPT session exposes both the prompt composer and a send
// button. The login form exposes email/password textboxes but no send button,
// so a bare "textbox present" check would false-positive on the login page.
const SEND_BUTTON = /send/i

export const ChatGPTCrawler: ChatCrawler = {
  id: "chatgpt",
  homeUrl: HOME_URL,

  isLoggedIn: async (page: CrawlerPage) => {
    const composer = (await page.getByRole("textbox").count()) > 0
    const send = (await page.getByRole("button", { name: SEND_BUTTON }).count()) > 0
    return composer && send
  },

  conversationIdFromURL: (url) => url.match(CONVERSATION_ID)?.[1],

  send: async (page: Page, message: string) => {
    // The composer is the last textbox on the page; ChatGPT submits on Enter.
    const composer = page.getByRole("textbox").last()
    await composer.click()
    await typeLikeHuman(page, message)
    await page.keyboard.press("Enter")
  },
}

// Provider adapter for the CLI crawl path (runPlan). Unlike the relay's
// ChatGPTCrawler, this owns a full browser session and captures the turn
// after each submission.
export class ChatGPTProvider implements ChatProvider {
  readonly id = "chatgpt"

  constructor(private profile: ProfileOptions, private homeUrl = HOME_URL) {}

  prefersApi(): boolean {
    return false
  }

  async openSession(): Promise<ChatSession> {
    const context = await launchProfile(this.profile)
    const page = context.pages()[0] ?? (await context.newPage())
    await warmUp(page, this.homeUrl)

    const conversationId = ChatGPTCrawler.conversationIdFromURL(page.url()) ?? `c-${Date.now()}`

    const send = async function* (prompt: string): AsyncIterable<string> {
      const composer = page.getByRole("textbox").last()
      if ((await composer.count()) > 0) {
        await composer.click()
        await typeLikeHuman(page, prompt)
        await page.keyboard.press("Enter")
      }
    }

    const session: ChatSession = {
      conversationId,
      url: page.url(),
      send,
      captureTurn: (opts?: CaptureOptions): Promise<Turn> => capture(page, opts ?? { quietMs: 2000, timeoutMs: 600_000 }),
      dispose: async (): Promise<void> => {
        await context.close()
      },
    }

    return session
  }
}
