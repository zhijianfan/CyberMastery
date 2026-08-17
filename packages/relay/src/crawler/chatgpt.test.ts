import { describe, expect, test } from "bun:test"
import { ChatGPTCrawler } from "./chatgpt.js"
import type { CrawlerPage } from "./chat-crawler.js"

// Models the three ChatGPT page states the crawler must tell apart: a
// logged-in chat (composer + send button), a logged-out landing page, and the
// login form (email/password textboxes but no send button).
function fakePage(state: "chat" | "landing" | "login"): CrawlerPage {
  const composer = state === "chat" ? 1 : 0
  const loginTextboxes = state === "login" ? 2 : 0
  const send = state === "chat" ? 1 : 0
  return {
    getByRole: (role, options) => ({
      count: async () => {
        if (role === "textbox") return composer + loginTextboxes
        if (role === "button" && options?.name && /send/i.test(String(options.name))) return send
        return 0
      },
    }),
  }
}

describe("ChatGPTCrawler", () => {
  test("reports logged-in only when the composer and send button are both present", async () => {
    expect(await ChatGPTCrawler.isLoggedIn(fakePage("chat"))).toBe(true)
    expect(await ChatGPTCrawler.isLoggedIn(fakePage("landing"))).toBe(false)
  })

  test("does not mistake the login form for a logged-in session", async () => {
    expect(await ChatGPTCrawler.isLoggedIn(fakePage("login"))).toBe(false)
  })

  test("extracts the conversation id from /c/ URLs and rejects non-conversations", () => {
    const uuid = "0a1b2c3d-4e5f-6789-abcd-ef0123456789"
    expect(ChatGPTCrawler.conversationIdFromURL(`https://chatgpt.com/c/${uuid}`)).toBe(uuid)
    expect(ChatGPTCrawler.conversationIdFromURL("https://chatgpt.com/")).toBeUndefined()
    expect(ChatGPTCrawler.conversationIdFromURL(`https://chatgpt.com/share/${uuid}`)).toBeUndefined()
    expect(ChatGPTCrawler.conversationIdFromURL("https://chatgpt.com/c/not-a-uuid")).toBeUndefined()
  })

  test("identifies as the chatgpt provider", () => {
    expect(ChatGPTCrawler.id).toBe("chatgpt")
    expect(ChatGPTCrawler.homeUrl).toBe("https://chatgpt.com")
  })
})
