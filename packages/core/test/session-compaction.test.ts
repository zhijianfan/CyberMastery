import { expect, test } from "bun:test"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionCompactionContext } from "@opencode-ai/core/session/compaction-context"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Effect } from "effect"

test("compaction prompt preserves detailed work state and relevant files", () => {
  const prompt = SessionCompaction.buildPrompt({ context: ["conversation history"] })

  expect(prompt).toStartWith(
    "Here is the conversation so far:\n\n<conversation>\nconversation history\n</conversation>",
  )
  expect(prompt.indexOf("</conversation>")).toBeLessThan(prompt.indexOf("Create a new anchored summary"))
  expect(prompt).toContain("conversation history in the <conversation> tags above")
  expect(prompt).toContain("## Work State\n### Completed")
  expect(prompt).toContain("### Active")
  expect(prompt).toContain("### Blocked")
  expect(prompt).toContain("## Relevant Files")
})

test("compaction prompt gives update instructions for a prior summary", () => {
  const prompt = SessionCompaction.buildPrompt({
    context: ["new conversation"],
    previousSummary: "existing summary",
  })

  expect(prompt.indexOf("<conversation>")).toBeLessThan(prompt.indexOf("<prior-summary>"))
  expect(prompt.indexOf("</prior-summary>")).toBeLessThan(prompt.indexOf("The <prior-summary> summarizes"))
  expect(prompt).toContain(
    "Carry forward objectives, constraints, user directives, decisions, and parallel workstreams from the <prior-summary>",
  )
  expect(prompt).toContain('Move completed work from "Active" to "Completed".')
  expect(prompt).toContain('Update "Objective" and "Next Move" to reflect the current work state.')
})

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})

test("private compaction context freezes canonical integrity metadata", () => {
  const context = SessionCompactionContext.make({
    summary: "Structured summary",
    recent: "[User]: private fact",
    createdAt: 123,
  })

  expect(context).toEqual({
    version: 1,
    rendererVersion: 1,
    summary: "Structured summary",
    recent: "[User]: private fact",
    contentHash: "7d2ad552ffede98bcf877da89b16ea7dd4ec49dd30db504f51a8e3b871da7374",
    byteLength: 96,
    estimatedTokens: 24,
    createdAt: 123,
  })
  expect(
    Effect.runSync(SessionCompactionContext.decode(context, SessionMessage.ID.make("msg_compaction_context"))),
  ).toEqual(context)
})

test("private compaction context rejects supported-shape tampering", () => {
  const messageID = SessionMessage.ID.make("msg_compaction_corrupt")
  const context = SessionCompactionContext.make({ summary: "Summary", recent: "Recent", createdAt: 123 })
  const corrupted = [
    { ...context, summary: "Changed summary" },
    { ...context, recent: "Changed recent" },
    { ...context, contentHash: "0".repeat(64) },
    { ...context, byteLength: context.byteLength + 1 },
    { ...context, estimatedTokens: context.estimatedTokens + 1 },
    { ...context, rendererVersion: 2 },
    { ...context, version: 2 },
    { ...context, createdAt: -1 },
    { ...context, unexpected: "private" },
  ]

  for (const value of corrupted) {
    const error = Effect.runSync(SessionCompactionContext.decode(value, messageID).pipe(Effect.flip))
    expect(error).toMatchObject({ _tag: "SessionCompactionContext.Corrupt", id: messageID })
  }
})
