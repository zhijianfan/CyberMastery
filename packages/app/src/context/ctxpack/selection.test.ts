import { afterEach, describe, expect, it } from "bun:test"
import { captureCtxPackSelection, normalizeSelectedText } from "./selection"

function makeRoot(blockID: string, workspaceID = "ws-1", functionalityID = "builtin:chat"): HTMLElement {
  const article = document.createElement("article")
  article.setAttribute("data-ctxpack-source-root", "")
  article.setAttribute("data-workspace-id", workspaceID)
  article.setAttribute("data-block-id", blockID)
  article.setAttribute("data-functionality-id", functionalityID)
  document.body.appendChild(article)
  return article
}

function select(range: Range): Selection {
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})

describe("captureCtxPackSelection", () => {
  it("captures a single-block selection with source defaults", () => {
    document.body.innerHTML = `<article data-ctxpack-source-root data-workspace-id="ws-1" data-block-id="block-1" data-functionality-id="builtin:chat"><p id="message">Alpha <strong>Beta</strong> Gamma</p></article>`
    const p = document.getElementById("message")!
    const range = document.createRange()
    range.setStart(p.firstChild!, 0)
    range.setEnd(p.querySelector("strong")!.firstChild!, 4)

    const result = captureCtxPackSelection({ selection: select(range), now: 1000 })

    expect(result).not.toBeNull()
    expect(result!.text).toBe("Alpha Beta")
    expect(result!.clientFragmentID).toBeTruthy()
    expect(result!.source).toMatchObject({
      workspaceID: "ws-1",
      blockID: "block-1",
      functionalityID: "builtin:chat",
      kind: "block-text",
      direction: "unknown",
      sourceTimestamp: null,
      capturedAt: 1000,
      entityRef: null,
      label: null,
      metadata: {},
      sensitivity: "workspace",
    })
  })

  it("returns null for a collapsed selection", () => {
    const article = makeRoot("block-1")
    const p = document.createElement("p")
    p.textContent = "Alpha Beta"
    article.appendChild(p)
    const range = document.createRange()
    range.setStart(p.firstChild!, 2)
    range.setEnd(p.firstChild!, 2)

    expect(captureCtxPackSelection({ selection: select(range), now: 0 })).toBeNull()
  })

  it("returns null for an empty selection", () => {
    expect(captureCtxPackSelection({ selection: window.getSelection()!, now: 0 })).toBeNull()
  })

  it("rejects a selection crossing two source roots", () => {
    const articleA = makeRoot("block-1")
    const p1 = document.createElement("p")
    p1.textContent = "Alpha"
    articleA.appendChild(p1)
    const articleB = makeRoot("block-2")
    const p2 = document.createElement("p")
    p2.textContent = "Beta"
    articleB.appendChild(p2)

    const range = document.createRange()
    range.setStart(p1.firstChild!, 0)
    range.setEnd(p2.firstChild!, 4)

    expect(captureCtxPackSelection({ selection: select(range), now: 0 })).toBeNull()
  })

  it("rejects a selection anchored inside an input", () => {
    const article = makeRoot("block-1")
    const input = document.createElement("input")
    article.appendChild(input)
    const after = document.createElement("span")
    after.textContent = "rest"
    article.appendChild(after)

    const range = document.createRange()
    range.setStart(input, 0)
    range.setEnd(after.firstChild!, 1)

    expect(captureCtxPackSelection({ selection: select(range), now: 0 })).toBeNull()
  })

  it("rejects a selection anchored inside a textarea", () => {
    const article = makeRoot("block-1")
    const textarea = document.createElement("textarea")
    article.appendChild(textarea)
    const after = document.createElement("span")
    after.textContent = "rest"
    article.appendChild(after)

    const range = document.createRange()
    range.setStart(textarea, 0)
    range.setEnd(after.firstChild!, 1)

    expect(captureCtxPackSelection({ selection: select(range), now: 0 })).toBeNull()
  })

  it("rejects a selection inside a contenteditable region", () => {
    const article = makeRoot("block-1")
    const editable = document.createElement("div")
    editable.setAttribute("contenteditable", "true")
    editable.textContent = "Editable text"
    article.appendChild(editable)

    const range = document.createRange()
    range.setStart(editable.firstChild!, 0)
    range.setEnd(editable.firstChild!, 7)

    expect(captureCtxPackSelection({ selection: select(range), now: 0 })).toBeNull()
  })

  it("rejects a selection outside any source root", () => {
    const outside = document.createElement("div")
    outside.textContent = "Orphan text"
    document.body.appendChild(outside)

    const range = document.createRange()
    range.setStart(outside.firstChild!, 0)
    range.setEnd(outside.firstChild!, 6)

    expect(captureCtxPackSelection({ selection: select(range), now: 0 })).toBeNull()
  })

  it("returns null for whitespace-only text", () => {
    const article = makeRoot("block-1")
    const p = document.createElement("p")
    p.appendChild(document.createTextNode("   \n\t "))
    article.appendChild(p)

    const range = document.createRange()
    range.setStart(p.firstChild!, 0)
    range.setEnd(p.firstChild!, 6)

    expect(captureCtxPackSelection({ selection: select(range), now: 0 })).toBeNull()
  })

  it("returns null for text over 32 KiB UTF-8", () => {
    const article = makeRoot("block-1")
    const p = document.createElement("p")
    p.appendChild(document.createTextNode("x".repeat(33 * 1024)))
    article.appendChild(p)

    const range = document.createRange()
    range.setStart(p.firstChild!, 0)
    range.setEnd(p.firstChild!, 33 * 1024)

    expect(captureCtxPackSelection({ selection: select(range), now: 0 })).toBeNull()
  })

  it("normalizes CRLF to LF through the capture path", () => {
    const article = makeRoot("block-1")
    const p = document.createElement("p")
    const textNode = document.createTextNode("a\r\nb")
    p.appendChild(textNode)
    article.appendChild(p)

    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 4)

    const result = captureCtxPackSelection({ selection: select(range), now: 5 })
    expect(result?.text).toBe("a\nb")
  })

  it("trims trailing whitespace per line and trims the result", () => {
    expect(normalizeSelectedText("line one  \nline two \t\n  ")).toBe("line one\nline two")
    expect(normalizeSelectedText("  padded  ")).toBe("padded")
  })
})
