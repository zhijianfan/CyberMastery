import type { Page } from "@playwright/test"
import type { CaptureOptions, Turn } from "./types.js"
import { clauseChunks, lcg, typeDelaySequence } from "./human.js"
import { createCaptureMachine } from "./state.js"

export function markdownFromContainer(html: string): string {
  return html
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, (_, body) => "```\n" + body.trim() + "\n```")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/g, "`$1`")
    .replace(/<h([1-6])[^>]*>/g, (_, level) => "#".repeat(Number(level)) + " ")
    .replace(/<\/h[1-6]>/g, "\n\n")
    .replace(/<p[^>]*>/g, "")
    .replace(/<\/p>/g, "\n\n")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
}

const POLL_INTERVAL = 250

async function buttonGone(page: Page): Promise<boolean> {
  const stop = page.getByRole("button", { name: /stop/i })
  return (await stop.count()) === 0 || (await stop.isHidden())
}

export async function captureTurn(page: Page, opts: CaptureOptions): Promise<Turn> {
  const startedAt = Date.now()
  const machine = createCaptureMachine({ quietMs: opts.quietMs, timeoutMs: opts.timeoutMs }, startedAt)
  const region = page.getByRole("article").last()
  let text = ""

  while (true) {
    if ((await region.count()) > 0) {
      const content = (await region.textContent()) ?? ""
      if (content.length > text.length) machine.push(content.slice(text.length))
      text = content
    }
    machine.tick(Date.now())
    if (await buttonGone(page)) machine.stopButtonGone(Date.now())
    const state = machine.state()
    if (state === "complete") return { role: "assistant", text, startedAt, finishedAt: Date.now() }
    if (state === "interrupted") return { role: "assistant", text, startedAt, finishedAt: null }
    await page.waitForTimeout(POLL_INTERVAL)
  }
}

export async function typeLikeHuman(page: Page, text: string): Promise<void> {
  const random = lcg(0xdeadbeef)
  const chunks = clauseChunks(text)
  const delays = typeDelaySequence(text)
  let offset = 0

  for (const chunk of chunks) {
    for (const char of chunk) {
      const delay = delays[offset++] ?? 45
      await page.keyboard.type(char, { delay: Math.round(delay) })
      if (random() < 0.004) {
        await page.keyboard.press("Backspace")
        await page.keyboard.type(char, { delay: Math.round(80 + (random() - 0.5) * 140) })
      }
    }
    await page.waitForTimeout(Math.round(250 + random() * 650))
  }
}
