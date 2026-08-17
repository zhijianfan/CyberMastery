import type { Page } from "@playwright/test"

// Minimal page surface the crawler needs for login detection, so crawler
// implementations stay testable without a live browser. Playwright's `Page`
// satisfies this structurally.
export interface CrawlerPage {
  getByRole(role: string, options?: { name?: string | RegExp }): { count(): Promise<number> }
}

// A crawler for one chat provider. The relay drives the browser generically;
// the crawler owns everything provider-specific: where the chat lives, how a
// logged-in session is detected, how the conversation id is derived from the
// URL, and how a message is typed into the composer and submitted. To crawl a
// new provider, implement this interface and hand it to the relay.
export interface ChatCrawler {
  readonly id: "chatgpt" | "claude" | string
  readonly homeUrl: string
  /** True when the page shows a logged-in chat session (composer present). */
  isLoggedIn(page: CrawlerPage): Promise<boolean>
  /** Extract a stable conversation id from the current URL, if present. */
  conversationIdFromURL(url: string): string | undefined
  /** Type the message into the composer and submit it. */
  send(page: Page, message: string): Promise<void>
}
