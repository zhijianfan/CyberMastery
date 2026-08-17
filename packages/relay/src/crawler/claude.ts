import { typeLikeHuman } from "./capture.js"
import type { ChatCrawler } from "./chat-crawler.js"

const CONVERSATION_ID =
  /(?:\/(?:chat|conversations)\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i

// Crawler for the Claude.ai webpage.
export const ClaudeCrawler: ChatCrawler = {
  id: "claude",
  homeUrl: "https://claude.ai/new",
  isLoggedIn: async (page) => (await page.getByRole("textbox").count()) > 0,
  conversationIdFromURL: (url) => url.match(CONVERSATION_ID)?.[1],
  send: async (page, message) => {
    await page.getByRole("textbox").last().click()
    await typeLikeHuman(page, message)
    await page.keyboard.press("Enter")
  },
}
