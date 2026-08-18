import { describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { parseTranscript, splitTurns } from "../core/ingest.js"
import { renderInboxFile, type ChatSession, type InboxFile, type Turn } from "./types.js"
import { DEFAULT_PLAN, interpolate, runPlan, writeInboxTurn } from "./runplan.js"

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

function fakeSession(conversationId?: string): ChatSession {
  let lastTurn: Turn | undefined
  return {
    conversationId,
    parentMessageId: undefined,
    url: conversationId ? `https://chatgpt.com/c/${conversationId}` : "https://chatgpt.com",
    send: async function* (prompt: string) {
      yield "plan text"
      lastTurn = { role: "assistant", text: `response for: ${prompt}`, files: [], startedAt: Date.now(), finishedAt: Date.now() }
    },
    turn: () => lastTurn,
    dispose: async () => {},
  }
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

  test("rejects filenames that would escape the inbox", async () => {
    const inboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-inbox-"))
    try {
      await expect(
        writeInboxTurn({ inboxDir, file: fixture({ conversationId: "../../escape", turn: 1 }) }),
      ).rejects.toThrow("escapes inbox")
    } finally {
      await fs.rm(inboxDir, { recursive: true, force: true })
    }
  })
})

describe("runPlan", () => {
  test("writes one user and one assistant turn per plan entry", async () => {
    const inboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-plan-"))
    try {
      const written = await runPlan({ session: fakeSession("conv-plan"), idea: "an idea", inboxDir })
      expect(written).toHaveLength(6)
      const turns = await fs.readdir(inboxDir)
      expect(turns.sort()).toEqual([
        "conv-plan-1.md",
        "conv-plan-2.md",
        "conv-plan-3.md",
        "conv-plan-4.md",
        "conv-plan-5.md",
        "conv-plan-6.md",
      ])
      const assistant = parseTranscript(await fs.readFile(written[1]!, "utf8"))
      expect(assistant.meta.turn).toBe(2)
      expect(assistant.meta.complete).toBe(true)
      expect(assistant.body).toContain("response for:")
    } finally {
      await fs.rm(inboxDir, { recursive: true, force: true })
    }
  })

  test("marks an interrupted assistant turn incomplete", async () => {
    const inboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-plan-"))
    try {
      const session = fakeSession()
      session.send = async function* () {
        yield "partial"
      }
      session.turn = () => ({ role: "assistant", text: "partial", files: [], startedAt: Date.now(), finishedAt: null })
      const written = await runPlan({ session, idea: "an idea", inboxDir })
      const assistant = parseTranscript(await fs.readFile(written[1]!, "utf8"))
      expect(assistant.meta.complete).toBe(false)
    } finally {
      await fs.rm(inboxDir, { recursive: true, force: true })
    }
  })
})
