import { describe, expect, test } from "bun:test"
import { parseTranscript, splitTurns } from "../core/ingest.js"
import { renderInboxFile, type InboxFile } from "./types.js"
import { clauseChunks, jitter, lcg, pausePlan, typeDelaySequence } from "./human.js"
import { createCaptureMachine } from "./state.js"
import { downloadableFilesFromContainer, markdownFromContainer } from "./capture.js"
import { DEFAULT_PLAN, interpolate, writeInboxTurn } from "./runplan.js"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

function fixture(overrides: Partial<InboxFile> = {}): InboxFile {
  return {
    source: "chatgpt",
    conversationId: "conv-abc-123",
    turn: 3,
    capturedAt: "2026-08-14T08:00:00.000Z",
    complete: true,
    body: "The answer is 42.\n\nSecond paragraph.",
    ...overrides,
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("renderInboxFile", () => {
  test("renders frontmatter that round-trips through the core parser", () => {
    const rendered = renderInboxFile(fixture())
    const parsed = parseTranscript(rendered)
    expect(parsed.meta.source).toBe("chatgpt")
    expect(parsed.meta.conversationId).toBe("conv-abc-123")
    expect(parsed.meta.turn).toBe(3)
    expect(parsed.meta.capturedAt).toBe("2026-08-14T08:00:00.000Z")
    expect(parsed.meta.complete).toBe(true)
    expect(parsed.body).toBe("# Turn 3\n\nThe answer is 42.\n\nSecond paragraph.\n")
    const turns = splitTurns(parsed.body)
    expect(turns.length).toBe(1)
    expect(turns[0]?.heading).toBe("# Turn 3")
    expect(turns[0]?.content).toBe("The answer is 42.\n\nSecond paragraph.")
  })

  test("marks incomplete transcripts with complete: false", () => {
    const rendered = renderInboxFile(fixture({ complete: false }))
    const parsed = parseTranscript(rendered)
    expect(parsed.meta.complete).toBe(false)
  })
})

describe("jitter", () => {
  test("stays within bounds for a fixed random source", () => {
    const random = lcg(1234)
    for (let index = 0; index < 200; index++) {
      const value = jitter(100, 50, random)
      expect(value).toBeGreaterThanOrEqual(20)
      expect(value).toBeLessThanOrEqual(250)
    }
  })
})

describe("clauseChunks", () => {
  test("returns non-empty chunks that preserve the input and respect the cap", () => {
    const text = "Hello, world! This is a very long sentence that keeps going beyond forty characters for sure."
    const chunks = clauseChunks(text)
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0)
      expect(chunk.length).toBeLessThanOrEqual(40)
    }
    expect(chunks.join("")).toBe(text)
  })

  test("splits long unbroken runs into hard chunks", () => {
    const word = "a".repeat(90)
    const chunks = clauseChunks(word)
    expect(chunks.length).toBe(3)
    expect(chunks.join("")).toBe(word)
  })
})

describe("typeDelaySequence", () => {
  test("returns one delay per character, deterministically", () => {
    const text = "hello world"
    const first = typeDelaySequence(text)
    const second = typeDelaySequence(text)
    expect(first.length).toBe(text.length)
    expect(second.length).toBe(text.length)
    expect(first).toEqual(second)
    for (const delay of first) {
      expect(delay).toBeGreaterThanOrEqual(20)
    }
  })
})

describe("pausePlan", () => {
  test("returns deterministic jittered pauses of at least one second", () => {
    const first = pausePlan(4)
    const second = pausePlan(4)
    expect(first.length).toBe(3)
    expect(first).toEqual(second)
    for (const pause of first) {
      expect(pause).toBeGreaterThanOrEqual(1000)
    }
  })
})

describe("createCaptureMachine", () => {
  test("completes after the quiet period with no deltas", async () => {
    const machine = createCaptureMachine({ quietMs: 100, timeoutMs: 10_000 }, Date.now())
    machine.push("streaming")
    await wait(150)
    machine.tick(Date.now())
    machine.tick(Date.now())
    expect(machine.state()).toBe("complete")
  })

  test("push resets the quiet clock", async () => {
    const machine = createCaptureMachine({ quietMs: 100, timeoutMs: 10_000 }, Date.now())
    machine.push("first")
    await wait(60)
    machine.push("second")
    await wait(60)
    machine.tick(Date.now())
    expect(machine.state()).toBe("quiet")
  })

  test("interrupts when the timeout elapses without completion", async () => {
    const machine = createCaptureMachine({ quietMs: 10_000, timeoutMs: 120 }, Date.now())
    machine.push("stalled")
    await wait(150)
    machine.tick(Date.now())
    expect(machine.state()).toBe("interrupted")
  })

  test("stop button disappearing completes immediately", () => {
    const machine = createCaptureMachine({ quietMs: 10_000, timeoutMs: 10_000 })
    machine.push("streaming")
    machine.stopButtonGone(Date.now())
    expect(machine.state()).toBe("complete")
  })
})

describe("markdownFromContainer", () => {
  test("unwraps code, headings, and paragraphs into markdown", () => {
    expect(markdownFromContainer("<h2>Title</h2><p>Hello <code>world</code>.</p>")).toBe("## Title\n\nHello `world`.\n\n")
    expect(markdownFromContainer("<pre>const x = 1</pre>")).toBe("```\nconst x = 1\n```")
    expect(markdownFromContainer("<h1>Big</h1><p>line one</p><p>line two</p>")).toBe(
      "# Big\n\nline one\n\nline two\n\n",
    )
  })
})

describe("downloadableFilesFromContainer", () => {
  test("extracts anchors with a download attribute, preferring the download filename", () => {
    const html = `<a download="report.csv" href="https://example.com/dl/abc">Download</a>`
    expect(downloadableFilesFromContainer(html)).toEqual([{ name: "report.csv", url: "https://example.com/dl/abc" }])
  })

  test("extracts file-CDN links and images, deduping by url", () => {
    const html =
      `<a href="https://files.oaiusercontent.com/file/data.csv">data.csv</a>` +
      `<img alt="chart" src="https://files.oaiusercontent.com/file/chart.png">` +
      `<a href="https://files.oaiusercontent.com/file/data.csv">again</a>`
    expect(downloadableFilesFromContainer(html)).toEqual([
      { name: "data.csv", url: "https://files.oaiusercontent.com/file/data.csv" },
      { name: "chart", url: "https://files.oaiusercontent.com/file/chart.png" },
    ])
  })

  test("ignores ordinary links, data URIs, and anchors without href", () => {
    const html = `<a href="https://example.com/docs">docs</a><img src="data:image/png;base64,AAA"><a>no href</a>`
    expect(downloadableFilesFromContainer(html)).toEqual([])
  })
})

describe("DEFAULT_PLAN", () => {
  test("interpolates the idea into the first entry and leaves the rest intact", () => {
    const idea = "a banana stand"
    expect(DEFAULT_PLAN.length).toBe(3)
    const prompts = DEFAULT_PLAN.map((entry) => interpolate(entry.prompt, idea))
    expect(prompts[0]).toContain(idea)
    expect(prompts[0]).not.toContain("{idea}")
    expect(prompts[1]).toBe("Continue with the architecture document.")
    expect(prompts[2]).toBe("Now write the implementation plan as contract-first parallel tracks.")
  })
})

describe("writeInboxTurn", () => {
  test("writes a markdown file into the inbox directory", async () => {
    const inboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-inbox-"))
    try {
      const target = await writeInboxTurn({ inboxDir, file: fixture() })
      const content = await fs.readFile(target, "utf8")
      expect(path.extname(target)).toBe(".md")
      expect(parseTranscript(content).meta.turn).toBe(3)
    } finally {
      await fs.rm(inboxDir, { recursive: true, force: true })
    }
  })
})
