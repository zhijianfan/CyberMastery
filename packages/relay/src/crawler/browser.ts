import { chromium, type BrowserContext, type Page } from "@playwright/test"
import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface ProfileOptions {
  profileDir: string
  viewport?: { width: number; height: number }
  timezoneId?: string
  locale?: string
}

export async function launchProfile(opts: ProfileOptions): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(opts.profileDir, {
    channel: "chrome",
    headless: false,
    viewport: opts.viewport ?? { width: 1536, height: 900 },
    timezoneId: opts.timezoneId,
    locale: opts.locale,
    args: ["--disable-blink-features=AutomationControlled"],
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined })
  })
  return context
}

export async function warmUp(page: Page, homeUrl: string): Promise<void> {
  await page.goto(homeUrl)
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(600)
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(600)
}

export async function onChallenge(page: Page, failureDir: string): Promise<never> {
  await fs.mkdir(failureDir, { recursive: true })
  await page.screenshot({ path: path.join(failureDir, `${Date.now()}.png`) })
  throw new Error("human-intervention-required")
}
