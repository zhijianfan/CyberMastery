import type { Page } from "@playwright/test"
import type { CaptureOptions, DownloadableFile, Turn } from "./types.js"
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

// Downloadable files ChatGPT renders in a response: anchors carrying a
// download attribute, links to the file CDN, and inline images (generated
// files / DALL-E).
const FILE_LINK = /files\.oaiusercontent\.com|\.(?:csv|xlsx?|pdf|png|jpe?g|gif|webp|svg|zip|txt|json|jsonl|md|py|js|ts|docx?|pptx?|mp3|mp4)(?:[?#]|$)/i

function tagAttributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {}
  const opening = tag.slice(0, tag.indexOf(">") + 1)
  for (const match of opening.matchAll(/([a-zA-Z-]+)(?:=(["'])(.*?)\2)?/g)) {
    result[match[1].toLowerCase()] = match[3] ?? ""
  }
  return result
}

function basenameFromUrl(url: string): string {
  const segment = (url.split(/[?#]/)[0] ?? url).split("/").pop() ?? ""
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function textWithoutTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim()
}

export function downloadableFilesFromContainer(html: string): DownloadableFile[] {
  const files: DownloadableFile[] = []
  const seen = new Set<string>()
  const add = (url: string, name: string) => {
    if (!url || seen.has(url)) return
    seen.add(url)
    files.push({ name: name || basenameFromUrl(url), url })
  }

  for (const match of html.matchAll(/<a\b[^>]*>(.*?)<\/a>/gis)) {
    const a = tagAttributes(match[0])
    const href = a["href"]
    if (!href) continue
    const text = textWithoutTags(match[1] ?? "")
    const explicit = a["download"] !== undefined
    if (explicit || FILE_LINK.test(href)) add(href, explicit ? (a["download"] || text) : text)
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const img = tagAttributes(match[0])
    const src = img["src"]
    if (src && FILE_LINK.test(src)) add(src, img["alt"] || "")
  }

  return files
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
    if (state === "complete" || state === "interrupted") {
      const files = (await region.count()) > 0 ? downloadableFilesFromContainer((await region.innerHTML()) ?? "") : []
      return {
        role: "assistant",
        text,
        files,
        startedAt,
        finishedAt: state === "complete" ? Date.now() : null,
      }
    }
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
