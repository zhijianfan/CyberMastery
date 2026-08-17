import { launchProfile, warmUp, type ProfileOptions } from "./browser.js"
import { captureTurn as capture, typeLikeHuman } from "./capture.js"
import type { ChatCrawler } from "./chat-crawler.js"
import type { CaptureOptions, ChatProvider, ChatSession, Turn } from "./types.js"

export class ChatGPTProvider implements ChatProvider {
  readonly id = "chatgpt"

  constructor(private profile: ProfileOptions, private homeUrl = "https://chatgpt.com") {}

  prefersApi(): boolean {
    return false
  }

  async openSession(): Promise<ChatSession> {
    const context = await launchProfile(this.profile)
    const page = context.pages()[0] ?? (await context.newPage())
    await warmUp(page, this.homeUrl)

    const conversationId = page.url().match(/\/(?:c|chat)\/([0-9a-f-]{36})\b/i)?.[1] ?? `c-${Date.now()}`

    const findComposer = () => page.getByRole("textbox").last()

    const send = async function* (prompt: string): AsyncIterable<string> {
      const composer = findComposer()
      if ((await composer.count()) > 0) {
        await composer.click()
        await typeLikeHuman(page, prompt)
        await page.keyboard.press("Enter")
      }
      for (const char of prompt) yield char
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

// Crawler for the ChatGPT webpage, used by the router subsystem.
export const ChatGPTCrawler: ChatCrawler = {
  id: "chatgpt",
  homeUrl: "https://chatgpt.com",
  isLoggedIn: async (page) => (await page.getByRole("textbox").count()) > 0,
  conversationIdFromURL: (url) => url.match(/\/(?:c|chat)\/([0-9a-f-]{36})\b/i)?.[1],
  send: async (page, message) => {
    await page.getByRole("textbox").last().click()
    await typeLikeHuman(page, message)
    await page.keyboard.press("Enter")
  },
}
