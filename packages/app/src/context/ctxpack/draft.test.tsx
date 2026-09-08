import { afterEach, describe, expect, it, mock } from "bun:test"
import type { Accessor, Setter } from "solid-js"
import type { CapturedCtxPackFragment } from "./selection"

const clientSolid = import.meta.resolve("solid-js").replace("dist/server.js", "dist/dev.js")
if (import.meta.resolve("solid-js").includes("dist/server.js")) mock.module("solid-js", () => require(clientSolid))
const { createRoot, createSignal } = await import("solid-js")
const { createCtxPackDraftController } = await import("./draft")

interface MountedDraft {
  draft: ReturnType<typeof createCtxPackDraftController>
  workspaceID: Accessor<string | undefined>
  setWorkspaceID: Setter<string | undefined>
  setWorkspaceEpoch: Setter<number>
}

const disposers: Array<() => void> = []

function mountController(initialWorkspaceID?: string | undefined): MountedDraft {
  const [workspaceID, setWorkspaceID] = createSignal<string | undefined>(initialWorkspaceID)
  const [workspaceEpoch, setWorkspaceEpoch] = createSignal(0)
  let draft!: ReturnType<typeof createCtxPackDraftController>
  disposers.push(
    createRoot((dispose: () => void) => {
      draft = createCtxPackDraftController(workspaceID, workspaceEpoch)
      return dispose
    }),
  )
  return { draft, workspaceID, setWorkspaceID, setWorkspaceEpoch }
}

function baseSource(blockID = "block-1"): CapturedCtxPackFragment["source"] {
  return {
    workspaceID: "ws-1",
    blockID,
    functionalityID: "builtin:chat",
    kind: "block-text",
    direction: "unknown",
    sourceTimestamp: null,
    capturedAt: 1,
    entityRef: null,
    label: null,
    metadata: {},
    sensitivity: "workspace",
  }
}

function fragment(id: string, text: string, blockID = "block-1"): CapturedCtxPackFragment {
  return { clientFragmentID: id, text, source: baseSource(blockID) }
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

describe("CtxPackDraftController", () => {
  it("adds fragments and dedupes by normalized text + source identity", () => {
    const { draft } = mountController()

    expect(draft.add(fragment("a", "Hello world"))).toEqual({ status: "added" })
    expect(draft.fragments()).toHaveLength(1)
    // Same text + same source -> duplicate no-op.
    expect(draft.add(fragment("b", "Hello world"))).toEqual({ status: "duplicate" })
    expect(draft.fragments()).toHaveLength(1)
    // Same text modulo normalization -> duplicate.
    expect(draft.add(fragment("c", "  Hello world  "))).toEqual({ status: "duplicate" })
    expect(draft.fragments()).toHaveLength(1)
    // Same text from a different block -> NOT a duplicate.
    expect(draft.add(fragment("d", "Hello world", "block-2"))).toEqual({ status: "added" })
    expect(draft.fragments()).toHaveLength(2)
  })

  it("removes fragments by clientFragmentID", () => {
    const { draft } = mountController()

    draft.add(fragment("a", "aaa"))
    draft.add(fragment("b", "bbb"))
    draft.remove("a")
    expect(draft.fragments().map((f) => f.clientFragmentID)).toEqual(["b"])
    draft.remove("missing")
    expect(draft.fragments()).toHaveLength(1)
  })

  it("moves fragments with clamped target ordinal", () => {
    const { draft } = mountController()
    const ids = () => draft.fragments().map((f) => f.clientFragmentID)

    draft.add(fragment("a", "aaa"))
    draft.add(fragment("b", "bbb"))
    draft.add(fragment("c", "ccc"))
    draft.move("c", 0)
    expect(ids()).toEqual(["c", "a", "b"])
    draft.move("a", 99)
    expect(ids()).toEqual(["c", "b", "a"])
    draft.move("b", -5)
    expect(ids()).toEqual(["b", "c", "a"])
    draft.move("missing", 1)
    expect(ids()).toEqual(["b", "c", "a"])
  })

  it("clears the draft", () => {
    const { draft } = mountController()

    draft.add(fragment("a", "aaa"))
    draft.add(fragment("b", "bbb"))
    draft.clear()
    expect(draft.fragments()).toHaveLength(0)
  })

  it("reports byteLength and estimatedTokens aggregates", () => {
    const { draft } = mountController()

    draft.add(fragment("a", "abc"))
    draft.add(fragment("b", "héllo"))
    expect(draft.byteLength()).toBe(9) // 3 + 6 UTF-8 bytes
    expect(draft.estimatedTokens()).toBe(Math.ceil(9 / 4))
    expect(draft.estimatedTokens()).toBe(3)
    expect(draft.estimatedTokens()).toBe(draft.estimatedTokens()) // stable
  })

  it("auto-clears when workspaceID changes", () => {
    const { draft, setWorkspaceID } = mountController()

    draft.add(fragment("a", "aaa"))
    expect(draft.fragments()).toHaveLength(1)
    setWorkspaceID("ws-2")
    expect(draft.fragments()).toHaveLength(0)
    expect(draft.workspaceID()).toBe("ws-2")
  })

  it("auto-clears when workspaceEpoch changes", () => {
    const { draft, setWorkspaceEpoch } = mountController()

    draft.add(fragment("a", "aaa"))
    expect(draft.fragments()).toHaveLength(1)
    setWorkspaceEpoch(1)
    expect(draft.fragments()).toHaveLength(0)
  })

  it("works with an initially undefined workspace id", () => {
    const { draft, workspaceID } = mountController(undefined)

    expect(workspaceID()).toBeUndefined()
    expect(draft.workspaceID()).toBeUndefined()
    expect(draft.add(fragment("a", "aaa"))).toEqual({ status: "added" })
    expect(draft.fragments()).toHaveLength(1)
  })
})
