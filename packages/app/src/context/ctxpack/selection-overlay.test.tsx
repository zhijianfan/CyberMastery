/** @jsxImportSource solid-js */
/**
 * CtxPack selection overlay tests (U4).
 *
 * Renders the overlay with the real U1 draft provider (controller grabbed
 * via a Probe child), the real solid client runtime, and a fake dialog
 * context that mimics the repo's portal mount (Kobalte Root + Portal) so the
 * create dialog can be exercised end-to-end under happy-dom.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { dict } from "@/i18n/en"

import type { CtxPackDraftController } from "./draft"
import type { CtxPackCreateRequestLocal, CtxPackInfoLocal } from "./create-dialog"

// The test environment resolves solid-js to its server build (the `node`
// export condition wins), so — following the repo's probe-mock pattern —
// redirect solid-js and solid-js/web to the client builds before loading any
// solid value or component module (mock.module only intercepts imports made
// AFTER registration, hence the dynamic imports below).
// Exercise the development core even under the default unit command: a
// hardwired production-core import would split the reactive graph again.
const clientSolid = import.meta.resolve("solid-js").replace("dist/server.js", "dist/dev.js")
const clientStore = import.meta.resolve("solid-js/store").replace("dist/server.js", "dist/store.js")
if (import.meta.resolve("solid-js/store").includes("dist/server.js"))
  mock.module("solid-js/store", () => require(clientStore))
const clientWeb = import.meta.resolve("solid-js/web").replace("dist/server.js", "dist/web.js")

if (import.meta.resolve("solid-js").includes("dist/server.js")) mock.module("solid-js", () => require(clientSolid))
if (import.meta.resolve("solid-js/web").includes("dist/server.js"))
  mock.module("solid-js/web", () => require(clientWeb))

// Fake dialog context: mimics the real `useDialog().show()` mount (Kobalte
// Root + Portal into document.body) with deterministic close control.
const dialogState: {
  open: boolean
  onClose: (() => void) | undefined
  dispose: (() => void) | undefined
} = { open: false, onClose: undefined, dispose: undefined }

function closeFakeDialog() {
  if (!dialogState.open) return
  dialogState.open = false
  const callback = dialogState.onClose
  dialogState.onClose = undefined
  dialogState.dispose?.()
  dialogState.dispose = undefined
  callback?.()
}

mock.module("@opencode-ai/ui/context/dialog", () => ({
  DialogProvider: (props: { children?: unknown }) => props.children,
  useDialog: () => ({
    get active() {
      return dialogState.open ? ({ id: "fake" } as never) : undefined
    },
    show: (element: () => unknown, onClose?: () => void) => {
      closeFakeDialog()
      // render() returns the root's dispose, which removes the portaled DOM.
      const dispose = render(
        () =>
          createComponent(KobalteDialog, {
            modal: true,
            open: true,
            onOpenChange: (isOpen: boolean) => {
              if (!isOpen) closeFakeDialog()
            },
            // Lazy child: the Portal must be created inside the Root's render
            // scope so Kobalte's dialog context is available to the content.
            children: (() =>
              createComponent(KobalteDialog.Portal, {
                children: element() as unknown as Element,
              })) as unknown as Element,
          }),
        document.body,
      )
      dialogState.onClose = onClose
      dialogState.dispose = dispose
      dialogState.open = true
    },
    close: () => closeFakeDialog(),
    push: () => {},
  }),
}))

// Toast mock: capture calls so tests can assert both the notice and that no
// selected text ever reaches a toast.
const toastCalls: string[] = []
mock.module("@/utils/toast", () => ({
  showToast: (options: string | { title?: string; description?: string }) => {
    toastCalls.push(
      typeof options === "string" ? options : `${options.title ?? ""} ${options.description ?? ""}`.trim(),
    )
  },
  dismissToast: () => {},
  setV2Toast: () => {},
  ToastRegion: () => null,
}))

mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (key: keyof typeof dict) => dict[key] }) }))

// The shared buttons/menu have browser integration coverage. Keep their callback
// boundary here so these tests exercise real capture, draft, save, and dialog state.
mock.module("@/pages/session/timeline/response-save-actions", () => ({
  ResponseSaveActions: (props: {
    onSave(options: { details: boolean }): Promise<void> | void
    onOpenChange?(open: boolean): void
    onAddToDraft?(): void
  }) => [
    h("button", {
      type: "button",
      "data-action": "save-response-ctxpack",
      onClick: (_event: MouseEvent) => props.onSave({ details: false }),
    }),
    h("button", {
      type: "button",
      "data-action": "save-response-options",
      onClick: (_event: MouseEvent) => props.onOpenChange?.(true),
    }),
    h("button", {
      type: "button",
      "data-ctxpack-action": "details",
      onClick: (_event: MouseEvent) => {
        void props.onSave({ details: true })
        props.onOpenChange?.(false)
      },
    }),
    h("button", {
      type: "button",
      "data-ctxpack-action": "add",
      onClick: (_event: MouseEvent) => {
        props.onAddToDraft?.()
        props.onOpenChange?.(false)
      },
    }),
  ],
}))

const { createSignal, createComponent } = await import("solid-js")
const { render } = await import("solid-js/web")
const { default: h } = await import("solid-js/h")

// React classic-JSX shim (repo convention): bun compiles JSX to
// React.createElement regardless of the solid pragma, so route it into
// solid's createComponent / h. Static element children are wrapped in a lazy
// accessor (as the solid compiler does) so they evaluate inside the parent's
// render scope — required for context propagation and reactivity; children
// that are already functions (e.g. `For` render props) pass through raw.
function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) {
    const value = children.length > 1 ? children : children[0]
    next.children = typeof value === "function" ? value : () => value
  }
  return createComponent(tag as never, next)
}
const Fragment = (props: { children?: unknown }) => props.children
;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

const { Dialog: KobalteDialog } = await import("@kobalte/core/dialog")
const { CtxPackSelectionOverlay } = await import("./selection-overlay")
const { CtxPackDraftProvider, useCtxPackDraft } = await import("./draft")

const OVERLAY_SENTINEL = "CTXPACK_SELECTION_SECRET_4417"

function makeInfo(): CtxPackInfoLocal {
  return {
    id: "pack-1",
    title: "Pack",
    keywords: [],
    sensitivity: "workspace",
    revision: 1,
    contentHash: "h",
    byteLength: 10,
    estimatedTokens: 3,
    fragments: [],
    usage: { attachedCount: 0, lastAttachedAt: null },
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    createdByUserID: "u-1",
  }
}

interface Mounted {
  dispose: () => void
  container: HTMLElement
}

const mounted: Mounted[] = []
let consoleCalls: string[] = []
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
}

beforeEach(() => {
  consoleCalls = []
  console.log = (...args: unknown[]) => {
    consoleCalls.push(args.map(String).join(" "))
  }
  console.warn = (...args: unknown[]) => {
    consoleCalls.push(args.map(String).join(" "))
  }
  console.error = (...args: unknown[]) => {
    consoleCalls.push(args.map(String).join(" "))
  }
  console.info = (...args: unknown[]) => {
    consoleCalls.push(args.map(String).join(" "))
  }
})

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!
    entry.dispose()
    entry.container.remove()
  }
  closeFakeDialog()
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
  toastCalls.length = 0
  console.log = originalConsole.log
  console.warn = originalConsole.warn
  console.error = originalConsole.error
  console.info = originalConsole.info
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const frame = () => new Promise((resolve) => setTimeout(resolve, 30))

function q<T extends Element = HTMLElement>(selector: string, root: ParentNode = document.body): T | null {
  return root.querySelector<T>(selector)
}

function qAll<T extends Element = HTMLElement>(selector: string, root: ParentNode = document.body): T[] {
  return [...root.querySelectorAll<T>(selector)]
}

function makeSourceArticle(container: HTMLElement, blockID = "block-1", workspaceID = "ws-1"): HTMLElement {
  const article = document.createElement("article")
  article.setAttribute("data-ctxpack-source-root", "")
  article.setAttribute("data-workspace-id", workspaceID)
  article.setAttribute("data-block-id", blockID)
  article.setAttribute("data-functionality-id", "builtin:chat")
  const p = document.createElement("p")
  p.textContent = "Alpha Beta Gamma Delta"
  article.appendChild(p)
  container.appendChild(article)
  return article
}

/** Selects [start, end) of the article's paragraph text. */
function selectText(article: HTMLElement, start = 0, end = 11): void {
  const p = article.querySelector("p")!
  const range = document.createRange()
  range.setStart(p.firstChild!, start)
  range.setEnd(p.firstChild!, end)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

function showToolbar(article: HTMLElement): void {
  selectText(article)
  document.dispatchEvent(new Event("selectionchange"))
}

function Probe(props: { onController: (controller: CtxPackDraftController) => void }) {
  props.onController(useCtxPackDraft())
  return null
}

function mount(create?: (request: CtxPackCreateRequestLocal) => Promise<CtxPackInfoLocal>) {
  const [workspaceID, setWorkspaceID] = createSignal<string | undefined>("ws-1")
  const [epoch, setEpoch] = createSignal(1)
  let controller: CtxPackDraftController | undefined
  const created: CtxPackInfoLocal[] = []
  const createRequests: CtxPackCreateRequestLocal[] = []
  const container = document.createElement("div")
  document.body.appendChild(container)
  // Built with explicit createComponent + function children (JSX evaluates
  // children eagerly, which would run Probe before the provider mounts).
  const dispose = render(
    () =>
      createComponent(CtxPackDraftProvider, {
        workspaceID,
        workspaceEpoch: epoch,
        children: (() => [
          createComponent(Probe, { onController: (next) => (controller = next) }),
          createComponent(CtxPackSelectionOverlay, {
            workspaceID,
            workspaceEpoch: epoch,
            create: async (request) => {
              createRequests.push(request)
              return create ? create(request) : makeInfo()
            },
            onCreated: (pack) => created.push(pack),
          }),
        ]) as unknown as Element,
      }),
    container,
  )
  mounted.push({ dispose, container })
  return {
    container,
    dispose,
    controller: () => controller!,
    setWorkspaceID,
    setEpoch,
    created,
    createRequests,
    toolbar: () => q<HTMLDivElement>("[data-ctxpack-selection-toolbar]"),
  }
}

describe("CtxPackSelectionOverlay", () => {
  it("shows the toolbar for a valid selection and positions it near the range", async () => {
    const harness = mount()
    const article = makeSourceArticle(harness.container)
    expect(harness.toolbar()!.style.display).toBe("none")
    showToolbar(article)
    expect(harness.toolbar()!.style.display).not.toBe("none")
    await frame()
    const toolbar = harness.toolbar()!
    expect(toolbar.style.position).toBe("fixed")
    expect(toolbar.style.left).toBe("8px")
    expect(toolbar.style.top).toBe("8px")
  })

  it("hides on collapse, workspace change, and Escape", async () => {
    const harness = mount()
    const article = makeSourceArticle(harness.container)

    showToolbar(article)
    expect(harness.toolbar()!.style.display).not.toBe("none")

    // Collapse: remove the selection, then a selectionchange event hides it.
    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event("selectionchange"))
    expect(harness.toolbar()!.style.display).toBe("none")

    // Workspace change hides it.
    showToolbar(article)
    expect(harness.toolbar()!.style.display).not.toBe("none")
    harness.setWorkspaceID("ws-2")
    await tick()
    expect(harness.toolbar()!.style.display).toBe("none")

    // Escape hides it.
    article.setAttribute("data-workspace-id", "ws-2")
    showToolbar(article)
    expect(harness.toolbar()!.style.display).not.toBe("none")
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(harness.toolbar()!.style.display).toBe("none")
  })

  it("adds the captured fragment to the draft once and clears the DOM selection", () => {
    const harness = mount()
    const article = makeSourceArticle(harness.container)
    showToolbar(article)
    q<HTMLButtonElement>('[data-ctxpack-action="add"]', harness.toolbar()!)!.click()

    const fragments = harness.controller().fragments()
    expect(fragments).toHaveLength(1)
    expect(fragments[0].text).toBe("Alpha Beta")
    expect(fragments[0].source).toMatchObject({
      workspaceID: "ws-1",
      blockID: "block-1",
      functionalityID: "builtin:chat",
      sensitivity: "workspace",
    })
    expect(window.getSelection()?.rangeCount).toBe(0)
    expect(harness.toolbar()!.style.display).toBe("none")
  })

  it("shows a fixed duplicate notice and does not add the fragment twice", () => {
    const harness = mount()
    const article = makeSourceArticle(harness.container)
    showToolbar(article)
    q<HTMLButtonElement>('[data-ctxpack-action="add"]', harness.toolbar()!)!.click()

    // Re-select the same text and add again.
    showToolbar(article)
    q<HTMLButtonElement>('[data-ctxpack-action="add"]', harness.toolbar()!)!.click()

    expect(harness.controller().fragments()).toHaveLength(1)
    expect(toastCalls).toContain("Already in draft")
  })

  it("quick-saves only the selection and preserves an existing draft", async () => {
    const harness = mount()
    const previous = makeSourceArticle(harness.container, "block-previous")
    showToolbar(previous)
    q<HTMLButtonElement>('[data-ctxpack-action="add"]', harness.toolbar()!)!.click()
    const draft = [...harness.controller().fragments()]
    const article = makeSourceArticle(harness.container)
    article.querySelector("p")!.textContent = "Selected context only"
    selectText(article, 0, 16)
    document.dispatchEvent(new Event("selectionchange"))

    const save = q<HTMLButtonElement>('[data-action="save-response-ctxpack"]', harness.toolbar()!)
    expect(save).not.toBeNull()
    save!.click()
    await tick()

    expect(harness.createRequests).toHaveLength(1)
    expect(harness.createRequests[0]).toMatchObject({
      workspaceID: "ws-1",
      title: "Selected context",
      sensitivity: "workspace",
      fragments: [{ text: "Selected context", source: { workspaceID: "ws-1", blockID: "block-1" } }],
    })
    expect(harness.createRequests[0].fragments).toHaveLength(1)
    expect(harness.controller().fragments()).toEqual(draft)
    expect(harness.created).toHaveLength(1)
    expect(dialogState.open).toBe(false)
    expect(window.getSelection()?.rangeCount).toBe(0)
    expect(harness.toolbar()!.style.display).toBe("none")
  })

  it("opens details for the captured selection after menu focus collapses the live range", async () => {
    const harness = mount()
    const article = makeSourceArticle(harness.container)
    showToolbar(article)
    q<HTMLButtonElement>('[data-action="save-response-options"]', harness.toolbar()!)!.click()
    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event("selectionchange"))
    await frame()
    q<HTMLButtonElement>('[data-ctxpack-action="details"]', harness.toolbar()!)!.click()

    expect(harness.controller().fragments()).toHaveLength(1)
    expect(harness.controller().fragments()[0].text).toBe("Alpha Beta")
    expect(harness.createRequests).toHaveLength(0)
    expect(window.getSelection()?.rangeCount).toBe(0)
    expect(harness.toolbar()!.style.display).toBe("none")

    await tick()
    expect(dialogState.open).toBe(true)
    expect(q('[data-component="dialog-v2"]')).not.toBeNull()
    expect(qAll("[data-ctxpack-fragment]")).toHaveLength(1)
    q<HTMLButtonElement>("[data-ctxpack-save]")!.click()
    await tick()
    expect(harness.createRequests).toHaveLength(1)
    expect(harness.createRequests[0].fragments).toMatchObject([
      { text: "Alpha Beta", source: { workspaceID: "ws-1", blockID: "block-1" } },
    ])
  })

  it("adds the captured selection to the draft after menu focus collapses the live range", async () => {
    const harness = mount()
    const article = makeSourceArticle(harness.container)
    showToolbar(article)
    q<HTMLButtonElement>('[data-action="save-response-options"]', harness.toolbar()!)!.click()
    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event("selectionchange"))
    await frame()
    q<HTMLButtonElement>('[data-ctxpack-action="add"]', harness.toolbar()!)!.click()

    expect(harness.controller().fragments()).toHaveLength(1)
    expect(harness.controller().fragments()[0].text).toBe("Alpha Beta")
    expect(harness.createRequests).toHaveLength(0)
    expect(dialogState.open).toBe(false)
    expect(harness.toolbar()!.style.display).toBe("none")
  })

  it.each(["workspace", "epoch"])("discards a cached selection after a %s change", async (change) => {
    const harness = mount()
    const article = makeSourceArticle(harness.container)
    showToolbar(article)
    q<HTMLButtonElement>('[data-action="save-response-options"]', harness.toolbar()!)!.click()
    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event("selectionchange"))
    if (change === "workspace") harness.setWorkspaceID("ws-2")
    if (change === "epoch") harness.setEpoch(2)
    await tick()

    q<HTMLButtonElement>('[data-action="save-response-ctxpack"]', harness.toolbar()!)!.click()
    q<HTMLButtonElement>('[data-ctxpack-action="details"]', harness.toolbar()!)!.click()
    q<HTMLButtonElement>('[data-ctxpack-action="add"]', harness.toolbar()!)!.click()
    await tick()

    expect(harness.createRequests).toHaveLength(0)
    expect(harness.created).toHaveLength(0)
    expect(harness.controller().fragments()).toHaveLength(0)
    expect(dialogState.open).toBe(false)
    expect(toastCalls).toHaveLength(0)
    expect(harness.toolbar()!.style.display).toBe("none")
  })

  it.each(["workspace", "epoch"])("ignores a pending quick-save result after a %s change", async (change) => {
    const request = Promise.withResolvers<CtxPackInfoLocal>()
    const harness = mount(() => request.promise)
    const article = makeSourceArticle(harness.container)
    showToolbar(article)
    q<HTMLButtonElement>('[data-action="save-response-ctxpack"]', harness.toolbar()!)!.click()
    expect(harness.createRequests).toHaveLength(1)

    if (change === "workspace") harness.setWorkspaceID("ws-2")
    if (change === "epoch") harness.setEpoch(2)
    await tick()
    request.resolve(makeInfo())
    await tick()

    expect(harness.created).toHaveLength(0)
    expect(harness.controller().fragments()).toHaveLength(0)
    expect(toastCalls).toHaveLength(0)
    expect(harness.toolbar()!.style.display).toBe("none")
  })

  it("keeps a failed selection save retryable without leaking its fragment", async () => {
    let attempts = 0
    const harness = mount(async () => {
      if (attempts++ === 0) throw new Error(OVERLAY_SENTINEL)
      return makeInfo()
    })
    const article = makeSourceArticle(harness.container)
    article.querySelector("p")!.textContent = OVERLAY_SENTINEL
    selectText(article, 0, OVERLAY_SENTINEL.length)
    document.dispatchEvent(new Event("selectionchange"))
    q<HTMLButtonElement>('[data-action="save-response-ctxpack"]', harness.toolbar()!)!.click()
    await tick()

    expect(harness.createRequests).toHaveLength(1)
    expect(harness.created).toHaveLength(0)
    expect(harness.controller().fragments()).toHaveLength(0)
    expect(harness.toolbar()!.style.display).not.toBe("none")
    expect(toastCalls).toHaveLength(1)
    expect(toastCalls[0]).toBe(dict["canvas.ctxpack.saveFailed"])
    expect(consoleCalls.some((line) => line.includes(OVERLAY_SENTINEL))).toBe(false)
    expect(
      qAll("*")
        .flatMap((element) => [...element.attributes])
        .some((attr) => attr.value.includes(OVERLAY_SENTINEL)),
    ).toBe(false)

    q<HTMLButtonElement>('[data-action="save-response-ctxpack"]', harness.toolbar()!)!.click()
    await tick()
    expect(harness.createRequests).toHaveLength(2)
    expect(harness.createRequests[1].fragments).toEqual(harness.createRequests[0].fragments)
    expect(harness.created).toHaveLength(1)
    expect(harness.controller().fragments()).toHaveLength(0)
    expect(harness.toolbar()!.style.display).toBe("none")
    expect(toastCalls.some((toast) => toast.includes(OVERLAY_SENTINEL))).toBe(false)
  })

  it("mousedown on the toolbar does not clear the captured Range", () => {
    const harness = mount()
    const article = makeSourceArticle(harness.container)
    showToolbar(article)
    const toolbar = harness.toolbar()!
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    toolbar.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(window.getSelection()?.rangeCount).toBe(1)
    expect(harness.toolbar()!.style.display).not.toBe("none")
  })

  it("never leaks the selected text into data-*, URLs, toasts, or console", () => {
    const harness = mount()
    const article = makeSourceArticle(harness.container)
    const p = article.querySelector("p")!
    p.textContent = `${OVERLAY_SENTINEL} is private`
    const range = document.createRange()
    range.setStart(p.firstChild!, 0)
    range.setEnd(p.firstChild!, OVERLAY_SENTINEL.length)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event("selectionchange"))
    expect(harness.toolbar()!.style.display).not.toBe("none")

    q<HTMLButtonElement>('[data-ctxpack-action="add"]', harness.toolbar()!)!.click()

    // No data-* attribute value anywhere carries the sentinel.
    const leaks: string[] = []
    for (const el of qAll<Element>("*")) {
      for (const attr of el.attributes) {
        if (attr.value.includes(OVERLAY_SENTINEL)) leaks.push(`${el.tagName}[${attr.name}]`)
      }
      const urlish = (el as HTMLElement).getAttribute("href") ?? (el as HTMLElement).getAttribute("src")
      if (urlish?.includes(OVERLAY_SENTINEL)) leaks.push(`${el.tagName}[url]`)
    }
    expect(leaks).toEqual([])
    expect(toastCalls.some((toast) => toast.includes(OVERLAY_SENTINEL))).toBe(false)
    expect(consoleCalls.some((line) => line.includes(OVERLAY_SENTINEL))).toBe(false)
  })
})
