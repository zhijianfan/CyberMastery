import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { classifyDocument, extractDocuments, titleFor } from "./classify.js"
import { documentPath, renderDocument, writeDocument, writeLedgerRecord } from "./docwriter.js"
import { markdownToText, parseTranscript, splitTurns } from "./ingest.js"
import { appendLedger, organizeInbox } from "./organize.js"
import { DEFAULT_ROOTS, isAllowedExtension, isWithinSpecs, resolveContained } from "./paths.js"

test("parses transcript frontmatter with all keys", () => {
  const transcript = parseTranscript(
    [
      "---",
      "source: chatgpt",
      "conversationId: conv-123",
      "turn: 2",
      "capturedAt: 2026-01-01T00:00:00.000Z",
      "complete: false",
      "---",
      "# Turn 2",
      "hello",
    ].join("\n"),
  )
  expect(transcript.meta).toEqual({
    source: "chatgpt",
    conversationId: "conv-123",
    turn: 2,
    capturedAt: "2026-01-01T00:00:00.000Z",
    complete: false,
  })
  expect(transcript.body).toBe("# Turn 2\nhello")
})

test("parses complete: true and tolerates colons in values", () => {
  const transcript = parseTranscript(
    ["---", "conversationId: chat:1", "complete: true", "---", "body"].join("\n"),
  )
  expect(transcript.meta.conversationId).toBe("chat:1")
  expect(transcript.meta.complete).toBeTrue()
})

test("defaults missing frontmatter keys and unknown values", () => {
  const transcript = parseTranscript(
    ["---", "source: gpt", "turn: not-a-number", "capturedAt: invalid", "---", "body text"].join("\n"),
  )
  expect(transcript.meta.source).toBe("manual")
  expect(transcript.meta.conversationId).toBe("unknown")
  expect(transcript.meta.turn).toBe(1)
  expect(transcript.meta.complete).toBeTrue()
  expect(Number.isNaN(Date.parse(transcript.meta.capturedAt))).toBeFalse()
  expect(transcript.body).toBe("body text")
})

test("treats text without frontmatter as a manual transcript with defaults", () => {
  const transcript = parseTranscript("just a plain body")
  expect(transcript.meta.source).toBe("manual")
  expect(transcript.meta.conversationId).toBe("unknown")
  expect(transcript.meta.turn).toBe(1)
  expect(transcript.body).toBe("just a plain body")
})

test("splits turns on turn headings and keeps preamble as a headingless chunk", () => {
  const chunks = splitTurns("preamble\n# Turn 1\nhello\n## turn 2\nworld\n")
  expect(chunks).toEqual([
    { heading: "", content: "preamble" },
    { heading: "# Turn 1", content: "hello" },
    { heading: "## turn 2", content: "world" },
  ])
})

test("returns a single headingless chunk when there are no turn headings", () => {
  expect(splitTurns("no headings here")).toEqual([{ heading: "", content: "no headings here" }])
})

test("strips fenced code blocks and inline backticks", () => {
  expect(markdownToText("```ts\ncode\n```\nkeep `inline` here")).toBe("\nkeep inline here")
})

test("classifies requirements by FR and acceptance criteria keywords", () => {
  expect(classifyDocument("FR-1 with acceptance criteria and user stories")).toBe("requirements")
})

test("classifies architecture by component and diagram keywords", () => {
  expect(classifyDocument("The system context diagram shows components and a data model")).toBe("architecture")
})

test("classifies plans by phase and milestone keywords", () => {
  expect(classifyDocument("Implementation plan phase 1: tickets, milestones, delivery wave")).toBe("plan")
})

test("falls back to notes for unclassifiable text", () => {
  expect(classifyDocument("Random thoughts about lunch")).toBe("notes")
})

test("extracts and classifies headed sections into document chunks", () => {
  const text = [
    "# Requirements",
    "",
    "FR-1 The system must log in.",
    "Acceptance criteria: verified login flow.",
    "",
    "## Architecture",
    "",
    "The system context diagram shows three components.",
    "",
    "# Implementation Plan",
    "",
    "Phase 1 tickets and milestones land in the first delivery wave.",
    "",
    "## Notes",
    "",
    "Miscellaneous remarks collected during the session.",
  ].join("\n")
  const chunks = extractDocuments(text)
  expect(chunks.map((chunk) => chunk.kind)).toEqual(["requirements", "architecture", "plan", "notes"])
  expect(chunks.map((chunk) => chunk.title)).toEqual([
    "Requirements",
    "Architecture",
    "Implementation Plan",
    "Notes",
  ])
  expect(chunks[0]!.body).toContain("FR-1 The system must log in.")
})

test("extracts headingless text as one classified chunk and drops empty sections", () => {
  const text = "# Empty\n# Requirements\nFR-1 alone"
  const chunks = extractDocuments(text)
  expect(chunks).toHaveLength(1)
  expect(chunks[0]!.kind).toBe("requirements")
  expect(chunks[0]!.title).toBe("Requirements")
  expect(chunks[0]!.body).toBe("FR-1 alone")
})

test("titles notes chunks with the fallback and defaults to Notes", () => {
  expect(titleFor("notes", "Session Notes")).toBe("Session Notes")
  expect(titleFor("notes", "  ")).toBe("Notes")
  expect(titleFor("requirements", "ignored")).toBe("Requirements")
  expect(titleFor("architecture", "ignored")).toBe("Architecture")
  expect(titleFor("plan", "ignored")).toBe("Implementation Plan")
})

test("renders documents with provenance frontmatter and title", () => {
  const rendered = renderDocument(
    { kind: "requirements", title: "Requirements", body: "FR-1 Do the thing." },
    {
      source: "chatgpt",
      conversationId: "c1",
      capturedAt: "2026-01-01T00:00:00.000Z",
      rawTranscript: "specs/relay/archive/c1-1.md",
    },
  )
  expect(rendered.startsWith("---\n")).toBeTrue()
  expect(rendered).toContain("source: chatgpt")
  expect(rendered).toContain("conversationId: c1")
  expect(rendered).toContain("capturedAt: 2026-01-01T00:00:00.000Z")
  expect(rendered).toContain("rawTranscript: specs/relay/archive/c1-1.md")
  expect(rendered).toContain("# Requirements\n\nFR-1 Do the thing.")
  expect(rendered.endsWith("\n")).toBeTrue()
})

test("maps kinds to spec document paths", () => {
  expect(documentPath("auth", "requirements")).toBe("specs/auth/requirements.md")
  expect(documentPath("auth", "architecture")).toBe("specs/auth/architecture.md")
  expect(documentPath("auth", "plan")).toBe("specs/auth/implementation-plan.md")
  expect(documentPath("auth", "notes")).toBe("specs/auth/notes.md")
})

test("allows only whitelisted extensions", () => {
  expect(isAllowedExtension("notes.md")).toBeTrue()
  expect(isAllowedExtension("NOTES.MD")).toBeTrue()
  expect(isAllowedExtension("data.jsonl")).toBeTrue()
  expect(isAllowedExtension("index.json")).toBeTrue()
  expect(isAllowedExtension("image.png")).toBeFalse()
  expect(isAllowedExtension("no-extension")).toBeFalse()
})

test("resolves contained paths and rejects escapes", () => {
  const base = join(tmpdir(), "relay-paths-base")
  expect(resolveContained(base, "specs/relay/inbox")).toBe(join(base, "specs/relay/inbox"))
  expect(resolveContained(base, ".")).toBe(base)
  expect(() => resolveContained(base, join("..", "escape"))).toThrow()
  expect(() => resolveContained(base, join("specs", "..", "..", "escape"))).toThrow()
  expect(() => resolveContained(base, join(tmpdir(), "relay-outside"))).toThrow()
})

test("detects targets within the specs tree", () => {
  const base = join(tmpdir(), "relay-specs-base")
  expect(isWithinSpecs(join(base, "specs"), base)).toBeTrue()
  expect(isWithinSpecs(join(base, "specs", "relay", "inbox"), base)).toBeTrue()
  expect(isWithinSpecs(join(base, "src"), base)).toBeFalse()
  expect(isWithinSpecs(join(base, "specs-other"), base)).toBeFalse()
})

test("writes documents under specs/<domain> with provenance and rejects escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-docwriter-"))
  try {
    const target = await writeDocument(
      root,
      "auth",
      { kind: "requirements", title: "Requirements", body: "FR-1 Do the thing." },
      {
        source: "claude",
        conversationId: "c2",
        capturedAt: "2026-01-02T00:00:00.000Z",
        rawTranscript: "specs/relay/archive/c2-1.md",
      },
    )
    expect(target).toBe(join(root, "specs", "auth", "requirements.md"))
    const content = await readFile(target, "utf8")
    expect(content).toContain("source: claude")
    expect(content).toContain("# Requirements")
    expect(content).toContain("FR-1 Do the thing.")
    await expect(writeDocument(root, join("..", "evil"), { kind: "notes", title: "Notes", body: "x" }, {
      source: "manual",
      conversationId: "unknown",
      capturedAt: "2026-01-02T00:00:00.000Z",
      rawTranscript: "specs/relay/archive/x.md",
    })).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("appends ledger records as jsonl", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-ledger-"))
  try {
    const ledger = join(root, DEFAULT_ROOTS.ledger)
    await writeLedgerRecord(ledger, { id: "a", n: 1 })
    await appendLedger({ baseDir: root, record: { id: "b", n: 2 } })
    const lines = (await readFile(ledger, "utf8")).trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!)).toEqual({ id: "a", n: 1 })
    expect(JSON.parse(lines[1]!)).toEqual({ id: "b", n: 2 })
    await expect(writeLedgerRecord(join(root, "bad.log"), {})).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("organizes inbox transcripts into the archive and skips non-md files", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-organize-"))
  try {
    const inbox = join(root, DEFAULT_ROOTS.inbox)
    await mkdir(inbox, { recursive: true })
    await writeFile(join(inbox, "chat-1.md"), "# Turn 1\nhello")
    await writeFile(join(inbox, "chat-2.md"), "world")
    await writeFile(join(inbox, "notes.txt"), "text")
    await writeFile(join(inbox, "image.png"), "png")
    await mkdir(join(inbox, "nested"))

    const result = await organizeInbox({ baseDir: root })

    expect(result.processed).toEqual(["chat-1.md", "chat-2.md"])
    expect(result.skipped).toEqual(["notes.txt", "image.png"])
    expect(result.archived).toHaveLength(2)
    const archive = join(root, DEFAULT_ROOTS.archive)
    for (const archived of result.archived) {
      expect(dirname(archived)).toBe(archive)
      expect(archived.endsWith(".md")).toBeTrue()
    }
    expect((await readdir(inbox)).sort()).toEqual(["image.png", "nested", "notes.txt"])
    const archived = await readdir(archive)
    const chatOne = archived.find((name) => name.startsWith("chat-1-"))
    expect(archived.some((name) => name.startsWith("chat-2-"))).toBeTrue()
    expect(chatOne).toBeDefined()
    expect(await readFile(join(archive, chatOne!), "utf8")).toBe("# Turn 1\nhello")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("organizing a missing inbox returns an empty result", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-missing-inbox-"))
  try {
    const result = await organizeInbox({ baseDir: root })
    expect(result).toEqual({ processed: [], archived: [], skipped: [] })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("rejects inbox and archive directories outside the base", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-escape-"))
  try {
    await expect(organizeInbox({ baseDir: root, inboxDir: join("..", "evil") })).rejects.toThrow()
    await expect(organizeInbox({ baseDir: root, archiveDir: join(tmpdir(), "outside") })).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
