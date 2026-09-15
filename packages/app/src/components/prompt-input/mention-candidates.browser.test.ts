import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { renderPromptInputV2Editor } from "@opencode-ai/session-ui/v2/prompt-input"
import { contextMentionCandidates, createSkillMentionCatalog, skillMentionCandidates } from "./mention-candidates"

describe("skill mention candidates", () => {
  test("keeps the caret after a skill inserted in the middle of the prompt", () => {
    const editor = document.createElement("div")
    document.body.append(editor)
    editor.contentEditable = "true"
    editor.focus()

    renderPromptInputV2Editor(
      editor,
      [
        { type: "text", content: "Before ", start: 0, end: 7 },
        { type: "skill", name: "review", contentHash: "hash", content: "@review", start: 7, end: 14 },
        { type: "text", content: " after", start: 14, end: 20 },
      ],
      15,
    )

    const selection = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.setEnd(selection.anchorNode!, selection.anchorOffset)
    expect(range.toString()).toBe("Before @review ")
    editor.remove()
  })

  test("preserves resource identity and filters hidden and primary agents", () => {
    const items = contextMentionCandidates({
      references: [],
      agents: [
        { name: "build", mode: "primary" },
        { name: "secret", mode: "subagent", hidden: true },
        { name: "review", mode: "subagent" },
      ],
      resources: [{ name: "review", server: "docs", uri: "docs://review", mimeType: "text/markdown" }],
      recent: ["review"],
      skills: [{ name: "review", contentHash: "hash" }],
    })
    expect(items.map((item) => item.id)).toEqual([
      "agent:review",
      "resource:docs:docs://review",
      "skill:review",
      "file:review",
    ])
    expect(items[1].mention).toMatchObject({
      type: "file",
      url: "docs://review",
      source: { type: "resource", clientName: "docs", uri: "docs://review" },
    })
  })
  test("keeps canonical skill identity separate from same-named files and agents", () => {
    expect(skillMentionCandidates([{ name: "review", description: "Review changes", contentHash: "hash" }])).toEqual([
      {
        id: "skill:review",
        kind: "skill",
        label: "@review",
        description: "Review changes",
        mention: { type: "skill", name: "review", contentHash: "hash", content: "@review", start: 0, end: 0 },
      },
    ])
  })

  test("loads on opening and ignores stale results after a scope change", async () => {
    const first = Promise.withResolvers<readonly { name: string; contentHash: string }[]>()
    const second = Promise.withResolvers<readonly { name: string; contentHash: string }[]>()
    const calls: string[] = []
    const fixture = createRoot((dispose) => {
      const [state, setState] = createStore({ identity: "block-a", open: false })
      const catalog = createSkillMentionCatalog({
        identity: () => state.identity,
        open: () => state.open,
        load: () => {
          calls.push(state.identity)
          return state.identity === "block-a" ? first.promise : second.promise
        },
      })
      return { dispose, setState, catalog }
    })
    try {
      expect(calls).toEqual([])
      fixture.setState("open", true)
      expect(calls).toEqual(["block-a"])
      expect(fixture.catalog.loading()).toBe(true)
      fixture.setState("identity", "block-b")
      second.resolve([{ name: "second", contentHash: "b" }])
      await second.promise
      first.resolve([{ name: "first", contentHash: "a" }])
      await first.promise
      expect(fixture.catalog.items().map((item) => item.name)).toEqual(["second"])
      expect(fixture.catalog.loading()).toBe(false)
    } finally {
      fixture.dispose()
    }
  })

  test("refreshes on reopening and exposes failures without retaining stale candidates", async () => {
    const refreshed = Promise.withResolvers<readonly { name: string; contentHash: string }[]>()
    const reopened = Promise.withResolvers<readonly { name: string; contentHash: string }[]>()
    const requests: AbortSignal[] = []
    const fixture = createRoot((dispose) => {
      const [state, setState] = createStore({ open: true })
      const catalog = createSkillMentionCatalog({
        identity: () => "scope",
        open: () => state.open,
        load: (signal) => {
          requests.push(signal)
          return requests.length === 1 ? refreshed.promise : reopened.promise
        },
      })
      return { dispose, setState, catalog }
    })
    try {
      refreshed.resolve([{ name: "review", contentHash: "hash" }])
      await refreshed.promise
      expect(fixture.catalog.items()).toHaveLength(1)
      fixture.setState("open", false)
      expect(fixture.catalog.loading()).toBe(false)
      expect(fixture.catalog.items()).toEqual([])
      expect(requests[0].aborted).toBe(true)
      fixture.setState("open", true)
      expect(requests).toHaveLength(2)
      reopened.resolve([{ name: "changed", contentHash: "new" }])
      await reopened.promise
      expect(fixture.catalog.items().map((item) => item.name)).toEqual(["changed"])
    } finally {
      fixture.dispose()
    }
    const failed = createRoot((dispose) => ({
      dispose,
      catalog: createSkillMentionCatalog({
        identity: () => "scope",
        open: () => true,
        load: () => Promise.reject(new Error("unavailable")),
      }),
    }))
    await Promise.resolve()
    expect(failed.catalog.error()).toBe(true)
    expect(failed.catalog.loading()).toBe(false)
    expect(failed.catalog.items()).toEqual([])
    failed.dispose()
  })
})
