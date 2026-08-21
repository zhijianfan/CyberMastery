import { afterEach, describe, expect, mock, test } from "bun:test"
import type { ContextAttachmentDraft } from "@/context/ctxpack/attachment-store"

// The repo's test setup resolves solid-js to its server build under the
// `solid` export condition, so redirect it to the client build before
// anything imports it. mock.module cannot intercept static imports, so
// solid-js and the ctxpack modules below are loaded dynamically, after
// registration (see HANDOFF-U3.md).
const clientSolid = import.meta.resolve("solid-js").replace("dist/server.js", "dist/solid.js")
mock.module("solid-js", () => require(clientSolid))

const { createRoot, createSignal } = await import("solid-js")
const { ContextAttachmentChips, contextAttachmentLimitReached } = await import("./context-attachments")

const disposes: Array<() => void> = []

afterEach(() => {
  while (disposes.length > 0) disposes.pop()!()
  document.body.replaceChildren()
})

let nextID = 0

function makeAttachment(overrides: Partial<ContextAttachmentDraft> = {}): ContextAttachmentDraft {
  return {
    clientAttachmentID: `attachment-${nextID++}`,
    kind: "context-capsule",
    contextCapsuleID: `capsule-${nextID}`,
    source: { kind: "ctxpack", ctxPackID: `pack-${nextID}`, contentHash: `hash-${nextID}` },
    label: `Pack ${nextID}`,
    contentHash: `hash-${nextID}`,
    estimatedTokens: 250,
    status: "ready",
    errorCode: null,
    ...overrides,
  }
}

function renderChips(
  props: {
    attachments?: readonly ContextAttachmentDraft[]
    totalEstimatedTokens?: number
    onRemove?: (clientAttachmentID: string) => void
    onPreview?: (clientAttachmentID: string) => void
  } = {},
) {
  const removed: string[] = []
  const previewed: string[] = []
  const container = document.createElement("div")
  document.body.appendChild(container)
  let element!: HTMLElement
  const dispose = createRoot((disposeRoot) => {
    element = ContextAttachmentChips({
      attachments: props.attachments ?? [],
      totalEstimatedTokens: props.totalEstimatedTokens ?? 0,
      onRemove: props.onRemove ?? ((id) => removed.push(id)),
      onPreview: props.onPreview ?? ((id) => previewed.push(id)),
    }) as HTMLElement
    container.appendChild(element)
    return () => {
      element.remove()
      container.remove()
      disposeRoot()
    }
  })
  disposes.push(dispose)
  return { element, removed, previewed }
}

describe("ContextAttachmentChips", () => {
  test("renders label, estimated tokens and a CtxPack source icon per chip", () => {
    const first = makeAttachment({ label: "Architecture notes", estimatedTokens: 340 })
    const second = makeAttachment({ label: "API reference", estimatedTokens: 1210 })
    const { element } = renderChips({ attachments: [first, second] })

    const text = element.textContent ?? ""
    expect(text).toContain("Architecture notes")
    expect(text).toContain("340 tokens")
    expect(text).toContain("API reference")
    expect(text).toContain("1210 tokens")
    expect(element.querySelectorAll("[data-ctxpack-icon]").length).toBe(2)
    expect(element.querySelectorAll("[data-attachment-id]").length).toBe(2)
  })

  test("remove button calls onRemove with the clientAttachmentID", () => {
    const first = makeAttachment()
    const { element, removed } = renderChips({ attachments: [first] })

    const remove = element.querySelector<HTMLButtonElement>('[data-action="ctxpack-attachment-remove"]')
    expect(remove).not.toBeNull()
    remove!.click()

    expect(removed).toEqual([first.clientAttachmentID])
  })

  test("preview button calls onPreview with the clientAttachmentID", () => {
    const first = makeAttachment()
    const { element, previewed } = renderChips({ attachments: [first] })

    const preview = element.querySelector<HTMLButtonElement>('[data-action="ctxpack-attachment-preview"]')
    expect(preview).not.toBeNull()
    preview!.click()

    expect(previewed).toEqual([first.clientAttachmentID])
  })

  test("keyboard focus order is first-to-last with native buttons", () => {
    const first = makeAttachment()
    const second = makeAttachment()
    const { element } = renderChips({ attachments: [first, second] })

    const buttons = Array.from(element.querySelectorAll("button"))
    expect(buttons.map((button) => button.dataset.action)).toEqual([
      "ctxpack-attachment-preview",
      "ctxpack-attachment-remove",
      "ctxpack-attachment-preview",
      "ctxpack-attachment-remove",
    ])
    for (const button of buttons) {
      expect(button.tabIndex).toBe(0)
    }
    // Focus order follows DOM order: preview of the first chip precedes the
    // second chip's preview.
    expect(buttons[0]!.compareDocumentPosition(buttons[2]!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  test("exposes an aria-live polite region", () => {
    const { element } = renderChips({ attachments: [makeAttachment()] })
    const live = element.querySelector('[aria-live="polite"]')
    expect(live).not.toBeNull()
  })

  test("announces additions in the aria-live region", () => {
    const { element } = renderChips({
      attachments: [makeAttachment({ label: "Sentinel pack" })],
    })
    const live = element.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toContain("Sentinel pack")
  })

  test("never renders fragment text — only the label and token count appear", () => {
    // A draft can never carry a text field per the frozen store contract, but
    // if one sneaks in (transport regression) it must not reach the DOM.
    const withText = {
      ...makeAttachment({ label: "Sentinel label" }),
      text: "SECRET-FRAGMENT-CONTENT-7812",
    } as ContextAttachmentDraft & { text?: string }
    const { element } = renderChips({ attachments: [withText] })

    const text = element.textContent ?? ""
    expect(text).toContain("Sentinel label")
    expect(text).not.toContain("SECRET-FRAGMENT-CONTENT-7812")
    expect(text).not.toContain("text")
  })

  test("re-renders when the attachments accessor changes", () => {
    const [items, setItems] = createSignal<readonly ContextAttachmentDraft[]>([makeAttachment()])
    const container = document.createElement("div")
    document.body.appendChild(container)
    let element!: HTMLElement
    const dispose = createRoot((disposeRoot) => {
      element = ContextAttachmentChips({
        attachments: items,
        totalEstimatedTokens: () => items().reduce((sum, item) => sum + item.estimatedTokens, 0),
        onRemove: () => undefined,
        onPreview: () => undefined,
      }) as HTMLElement
      container.appendChild(element)
      return () => {
        element.remove()
        container.remove()
        disposeRoot()
      }
    })
    disposes.push(dispose)

    expect(element.querySelectorAll("[data-attachment-id]").length).toBe(1)
    setItems([makeAttachment(), makeAttachment(), makeAttachment()])
    expect(element.querySelectorAll("[data-attachment-id]").length).toBe(3)
  })
})

describe("contextAttachmentLimitReached", () => {
  test("disables at 8 attachments", () => {
    const items = Array.from({ length: 8 }, () => makeAttachment())
    expect(contextAttachmentLimitReached(items, 100)).toBe(true)
    expect(contextAttachmentLimitReached(items.slice(0, 7), 100)).toBe(false)
  })

  test("disables at 6,000 aggregate estimated tokens", () => {
    expect(contextAttachmentLimitReached([], 6_000)).toBe(true)
    expect(contextAttachmentLimitReached([], 5_999)).toBe(false)
    expect(contextAttachmentLimitReached([makeAttachment({ estimatedTokens: 3_500 })], 3_500)).toBe(false)
  })

  test("combines both budgets", () => {
    expect(contextAttachmentLimitReached([makeAttachment()], 6_000)).toBe(true)
    expect(contextAttachmentLimitReached(Array.from({ length: 8 }, () => makeAttachment()), 0)).toBe(true)
  })
})
