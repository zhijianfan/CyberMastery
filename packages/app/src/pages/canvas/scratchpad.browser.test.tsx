import { afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test"
import { createComponent, createSignal } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import "../../../happydom"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

const Fragment = (props: { children?: unknown }) => props.children

;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

const WORKSPACE_ID = "workspace-scratchpad"
const BLOCK_ID = "scratchpad-1"
const copied: string[] = []
const toasts: string[] = []
const disposers: Array<() => void> = []
let submitBarrier: Promise<void> | undefined
let submitStarted: (() => void) | undefined
let submitFailure = false
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard")
const [runtimeView, setRuntimeView] = createSignal<{
  workspaceID: string
  workspaceEpoch: number
  blockID: string
  draft: string
  messages: Array<{ id: string; text: string; createdAt: number }>
}>({ workspaceID: WORKSPACE_ID, workspaceEpoch: 1, blockID: BLOCK_ID, draft: "", messages: [] })
const runtimeHandle = {
  status: () => "ready" as const,
  view: runtimeView,
  error: () => undefined,
  refresh: async () => {},
  dispatch: async (input: unknown) => {
    if (!input || typeof input !== "object" || !("type" in input)) return
    if (input.type === "set-draft" && "text" in input && typeof input.text === "string") {
      const text = input.text
      setRuntimeView((current) => ({ ...current, draft: text }))
      return
    }
    if (input.type !== "submit" || !("id" in input) || !("createdAt" in input)) return
    const text = runtimeView().draft.trim()
    if (!text || typeof input.id !== "string" || typeof input.createdAt !== "number") return
    const barrier = submitBarrier
    submitBarrier = undefined
    submitStarted?.()
    submitStarted = undefined
    await barrier
    if (submitFailure) throw new Error("submit failed")
    const id = input.id
    const createdAt = input.createdAt
    setRuntimeView((current) => ({
      ...current,
      draft: "",
      messages: [...current.messages, { id, text, createdAt }],
    }))
  },
  dispose: () => {},
}

mock.module("@/context/language", () => ({
  useLanguage: () => ({
    t: (key: string) =>
      ({
        "canvas.scratchpad.add": "Add thought",
        "canvas.scratchpad.copy": "Copy message",
        "canvas.scratchpad.copied": "Message copied",
        "canvas.scratchpad.copyFailed": "Unable to copy message.",
        "canvas.scratchpad.submitFailed": "Unable to add this thought. Try again.",
        "canvas.scratchpad.input": "Scratchpad",
      })[key] ?? key,
  }),
}))
mock.module("@/context/ctxpack/draft", () => ({
  useCtxPackDraft: () => ({
    workspaceID: () => WORKSPACE_ID,
    createOpen: () => false,
    openCreate: () => {},
    closeCreate: () => {},
    fragments: () => [],
    add: () => ({ status: "added" }),
    remove: () => {},
    move: () => {},
    clear: () => {},
    byteLength: () => 0,
    estimatedTokens: () => 0,
  }),
}))
mock.module("./runtime/block-runtime-host", () => ({ useBlockRuntimeHandle: () => runtimeHandle }))
mock.module("@/utils/toast", () => ({ showToast: (message: string) => void toasts.push(message) }))
mock.module("@opencode-ai/ui/v2/tooltip-v2", () => ({ TooltipV2: (props: { children?: unknown }) => props.children }))
mock.module("@/pages/session/timeline/response-save-actions", () => ({
  ResponseSaveActions: () => h("button", { type: "button", "aria-label": "Save as CtxPack" }),
}))

let ScratchpadBody: typeof import("./scratchpad").ScratchpadBody

beforeAll(async () => {
  ScratchpadBody = (await import("./scratchpad")).ScratchpadBody
})

beforeEach(() => {
  copied.length = 0
  toasts.length = 0
  submitBarrier = undefined
  submitStarted = undefined
  submitFailure = false
  setRuntimeView({ workspaceID: WORKSPACE_ID, workspaceEpoch: 1, blockID: BLOCK_ID, draft: "", messages: [] })
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void copied.push(text) },
  })
})

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
  document.body.innerHTML = ""
  if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor)
  if (!clipboardDescriptor) delete (navigator as { clipboard?: Clipboard }).clipboard
})

function mountScratchpad() {
  const host = document.createElement("section")
  host.dataset.ctxpackSourceRoot = ""
  host.dataset.workspaceId = WORKSPACE_ID
  host.dataset.blockId = BLOCK_ID
  host.dataset.functionalityId = "builtin:notes"
  document.body.appendChild(host)
  const dispose = render(
    () =>
      createComponent(ScratchpadBody, {
        blockID: BLOCK_ID,
        workspaceID: () => WORKSPACE_ID,
        workspaceEpoch: () => 1,
        create: async () => ({}) as never,
      }) as never,
    host,
  )
  disposers.push(() => {
    dispose()
    host.remove()
  })
  return host
}

function input(composer: HTMLTextAreaElement, value: string) {
  composer.value = value
  composer.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }))
}

function enter(composer: HTMLTextAreaElement, options: { shiftKey?: boolean; isComposing?: boolean } = {}) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Enter",
    shiftKey: options.shiftKey,
    isComposing: options.isComposing,
  })
  composer.dispatchEvent(event)
  return event
}

function button(container: ParentNode, name: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.getAttribute("aria-label") === name || item.textContent?.trim() === name,
  )
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (check()) return
    await Promise.resolve()
  }
  throw new Error("Scratchpad did not reach the expected state")
}

test("submits a multiline monologue in order and copies only the chosen message", async () => {
  setRuntimeView({
    workspaceID: WORKSPACE_ID,
    workspaceEpoch: 1,
    blockID: BLOCK_ID,
    draft: "First thought",
    messages: [],
  })
  const scratchpad = mountScratchpad()
  const composer = scratchpad.querySelector<HTMLTextAreaElement>('textarea[aria-label="Scratchpad"]')
  expect(composer).not.toBeNull()
  const add = button(scratchpad, "Add thought")
  expect(add).not.toBeUndefined()

  expect(add!.disabled).toBeFalse()
  add!.focus()
  add!.click()
  await waitFor(() => runtimeView().messages.length === 1)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(runtimeView().draft).toBe("")
  expect(document.activeElement).toBe(composer)

  input(composer!, "Second line")
  expect(enter(composer!, { shiftKey: true }).defaultPrevented).toBeFalse()
  expect(runtimeView().messages).toHaveLength(1)
  input(composer!, "Second line\ncontinued")
  expect(enter(composer!, { isComposing: true }).defaultPrevented).toBeFalse()
  expect(runtimeView().messages).toHaveLength(1)
  expect(runtimeView().draft).toBe("Second line\ncontinued")

  expect(enter(composer!).defaultPrevented).toBeTrue()
  await waitFor(() => runtimeView().messages.length === 2)
  expect(runtimeView().draft).toBe("")

  const rendered = mountScratchpad()
  const messages = [...rendered.querySelectorAll<HTMLElement>("[data-scratchpad-message]")]
  expect(messages.map((message) => message.querySelector("[data-scratchpad-message-text]")?.textContent)).toEqual([
    "First thought",
    "Second line\ncontinued",
  ])

  const copy = button(messages[1], "Copy message")
  expect(copy).not.toBeUndefined()
  copy!.click()
  await waitFor(() => copied.length === 1)
  expect(copied).toEqual(["Second line\ncontinued"])
})

test("restores keyboard focus after an asynchronous Enter submission", async () => {
  const scratchpad = mountScratchpad()
  const composer = scratchpad.querySelector<HTMLTextAreaElement>('textarea[aria-label="Scratchpad"]')!
  composer.focus()
  input(composer, "First thought")

  let releaseSubmit!: () => void
  submitBarrier = new Promise<void>((resolve) => {
    releaseSubmit = resolve
  })
  const started = new Promise<void>((resolve) => {
    submitStarted = resolve
  })

  enter(composer)
  await started
  releaseSubmit()

  await waitFor(() => runtimeView().messages.length === 1)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(runtimeView().messages).toEqual([
    { id: expect.any(String), text: "First thought", createdAt: expect.any(Number) },
  ])
  expect(document.activeElement).toBe(composer)

  input(composer, "Next thought")
  enter(composer)
  await waitFor(() => runtimeView().messages.length === 2)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(runtimeView().messages[1]).toEqual({
    id: expect.any(String),
    text: "Next thought",
    createdAt: expect.any(Number),
  })
  expect(document.activeElement).toBe(composer)
})

test("keeps the composer unavailable when its runtime view does not match", () => {
  setRuntimeView({ workspaceID: "workspace-other", workspaceEpoch: 1, blockID: BLOCK_ID, draft: "", messages: [] })
  const scratchpad = mountScratchpad()
  const composer = scratchpad.querySelector<HTMLTextAreaElement>('textarea[aria-label="Scratchpad"]')!

  expect(composer.disabled).toBeTrue()
})

test("restores focus and preserves the draft after submit failure", async () => {
  const scratchpad = mountScratchpad()
  const composer = scratchpad.querySelector<HTMLTextAreaElement>('textarea[aria-label="Scratchpad"]')!
  composer.focus()
  input(composer, "Retry this thought")
  submitFailure = true

  enter(composer)
  await waitFor(() => toasts.includes("Unable to add this thought. Try again."))
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(runtimeView().messages).toEqual([])
  expect(composer.value).toBe("Retry this thought")
  expect(document.activeElement).toBe(composer)
})

test("reports copy failure when the Clipboard API is unavailable", async () => {
  setRuntimeView({
    workspaceID: WORKSPACE_ID,
    workspaceEpoch: 1,
    blockID: BLOCK_ID,
    draft: "",
    messages: [{ id: "note-1", text: "Keep this exact", createdAt: 1 }],
  })
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined })
  const scratchpad = mountScratchpad()
  button(scratchpad, "Copy message")!.click()
  await waitFor(() => toasts.length === 1)
  expect(toasts).toEqual(["Unable to copy message."])
})
