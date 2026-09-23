import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { dict } from "@/i18n/en"
import { createComponent, createSignal, mergeProps } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import { CanvasTabs } from "./canvas-tabs"
import { Workspace } from "@opencode-ai/schema/workspace"
mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (key: keyof typeof dict) => dict[key] }) }))

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

const Fragment = (props: { children?: unknown }) => props.children
;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

const entries = (count: number, archivedAt?: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${archivedAt ? "archived" : "owned"}-${index}`,
    workspaceID: Workspace.ID.make("wrk_test"),
    kind: "operating-chat" as const,
    blockID: "block-1",
    conversationID: `session-${index}`,
    title: `${archivedAt ? "Archived" : "Owned"} session ${index}`,
    createdAt: count - index,
    ...(archivedAt ? { archivedAt } : {}),
    writable: !archivedAt,
  }))

const disposers: VoidFunction[] = []

function mount(overrides: Partial<Parameters<typeof CanvasTabs>[0]> = {}) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const props = mergeProps(
    {
      owned: entries(3),
      archived: entries(8, 1),
      selectedID: "owned-0",
      status: "ready",
      loading: false,
      error: undefined,
      search: "",
      onSearch: () => {},
      onCreate: () => {},
      onSelect: () => {},
      onRestore: () => {},
      onArchive: () => {},
      onLoadMore: () => {},
      onRetry: () => {},
    },
    overrides,
  )
  disposers.push(render(() => createComponent(CanvasTabs, props), host))
  return host
}

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  mock.restore()
  document.body.innerHTML = ""
})

test("keeps the search input focused through typing, loading and result updates", () => {
  const [search, setSearch] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const host = mount({
    get search() {
      return search()
    },
    get loading() {
      return loading()
    },
    onSearch: (value) => {
      setSearch(value)
      setLoading(true)
    },
  })
  host.querySelector<HTMLButtonElement>(".canvas-tab-history-button")!.click()
  const input = host.querySelector<HTMLInputElement>("input")!
  input.focus()
  input.value = "session"
  input.setSelectionRange(3, 3)
  input.dispatchEvent(new Event("input", { bubbles: true }))
  expect(input.isConnected).toBe(true)
  expect(document.activeElement).toBe(input)
  expect(input.selectionStart).toBe(3)
  setLoading(false)
  expect(host.querySelector("input")).toBe(input)
  expect(document.activeElement).toBe(input)
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  expect(host.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(true)
  expect(document.activeElement).toBe(host.querySelector(".canvas-tab-history-button"))
})

test("keeps an archived exact conversation-ID match returned by the server", () => {
  const host = mount({ owned: [], search: "session-2" })
  host.querySelector<HTMLButtonElement>(".canvas-tab-history-button")!.click()
  expect([...host.querySelectorAll('[role="option"]')].map((row) => row.textContent)).toEqual(["Archived session 2"])
})

test("applies the measured sixteen-character width and reserves status space at overflow thresholds", () => {
  spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: () => ({ width: 224 }),
  } as unknown as CanvasRenderingContext2D)
  const host = mount({ owned: entries(2).map((entry) => ({ ...entry, title: "界".repeat(16) + "more" })) })
  const strip = host.querySelector<HTMLElement>(".canvas-tab-strip")!
  const indicator = host.querySelector<HTMLElement>('[role="status"]')!
  Object.defineProperty(strip, "clientWidth", { configurable: true, value: 692 })
  spyOn(indicator, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 60, 16))
  window.dispatchEvent(new Event("resize"))
  const tabs = [...host.querySelectorAll<HTMLElement>(".canvas-tab-item")]
  expect(tabs).toHaveLength(2)
  expect(tabs.map((tab) => tab.style.minWidth)).toEqual(["276px", "276px"])
  expect(tabs.map((tab) => tab.style.width)).toEqual(["276px", "276px"])
  Object.defineProperty(strip, "clientWidth", { configurable: true, value: 691 })
  window.dispatchEvent(new Event("resize"))
  expect(host.querySelectorAll(".canvas-tab-item")).toHaveLength(1)
  Object.defineProperty(strip, "clientWidth", { configurable: true, value: 411 })
  window.dispatchEvent(new Event("resize"))
  expect(host.querySelectorAll(".canvas-tab-item")).toHaveLength(0)
  host.querySelector<HTMLButtonElement>(".canvas-tab-history-button")!.click()
  expect(host.querySelectorAll('[role="option"][aria-selected="true"]')).toHaveLength(1)
})

test("renders plus and history controls and opens a six-row scrollable menu", async () => {
  const host = mount()
  host.querySelector<HTMLButtonElement>('button[aria-label="Session history"]')!.click()
  await new Promise((resolve) => setTimeout(resolve, 0))

  const menu = host.querySelector('[role="dialog"]')
  expect(menu).not.toBeNull()
  expect(menu!.querySelectorAll('[role="option"]').length).toBeGreaterThan(6)
  expect(host.querySelector('input[aria-label="Search archived sessions"]')).not.toBeNull()
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="New session"]')).not.toBeNull()
})

test("filters archived entries and restores the selected result", async () => {
  let restored = ""
  const host = mount({
    search: "session 2",
    onRestore: (entry) => {
      restored = entry.id
    },
  })
  host.querySelector<HTMLButtonElement>('button[aria-label="Session history"]')!.click()
  await new Promise((resolve) => setTimeout(resolve, 0))

  const options = [...host.querySelectorAll<HTMLElement>('[role="option"]')]
  expect(options.some((option) => option.textContent?.includes("Archived session 2"))).toBe(true)
  options
    .find((option) => option.textContent?.includes("Archived session 2"))!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }))
  expect(restored).toBe("archived-2")
})

test("shows retry for errors and closes the menu with Escape", async () => {
  let retried = 0
  const host = mount({
    error: new Error("failed"),
    onRetry: (_event?: unknown) => {
      retried++
    },
  })
  host.querySelector<HTMLButtonElement>('button[aria-label="Session history"]')!.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
  host.querySelector<HTMLButtonElement>('button[aria-label="Retry loading sessions"]')!.click()
  expect(retried).toBe(1)

  host.querySelector<HTMLButtonElement>('button[aria-label="Session history"]')!.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  await Promise.resolve()
  expect(host.querySelector<HTMLElement>('[role="dialog"]')?.hidden).toBe(true)
})

test("renders the current status indicator at the right edge", () => {
  const host = mount({ status: "working" })
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Working")
  expect(host.querySelector('[data-status-indicator="working"]')).not.toBeNull()
})

test("uses the observed strip width when selecting whole visible tabs", () => {
  const host = mount()
  Object.defineProperty(host, "clientWidth", { configurable: true, value: 180 })
  host.dispatchEvent(new Event("resize"))
  expect(host.querySelectorAll(".canvas-tab-button").length).toBeLessThan(3)
})

test("archives a tab only after confirming the prompt", () => {
  let archived = ""
  const host = mount({
    onArchive: (entry) => {
      archived = entry.id
    },
  })
  const closes = [...host.querySelectorAll<HTMLButtonElement>(".canvas-tab-close")]
  expect(closes.length).toBeGreaterThan(0)

  closes[0].click()
  const confirm = host.querySelector<HTMLElement>(".canvas-tab-confirm")!
  expect(confirm.textContent).toContain("Archive this session?")
  expect(archived).toBe("")

  confirm.querySelector<HTMLButtonElement>(".canvas-tab-confirm-cancel")!.click()
  expect(host.querySelector(".canvas-tab-confirm")).toBeNull()
  expect(archived).toBe("")

  closes[0].click()
  host.querySelector<HTMLButtonElement>(".canvas-tab-confirm-accept")!.click()
  expect(archived).toBe("owned-0")
  expect(host.querySelector(".canvas-tab-confirm")).toBeNull()
})

test("hides the close control on the only tab and dismisses the prompt with Escape", () => {
  const single = mount({ owned: entries(1) })
  expect(single.querySelectorAll(".canvas-tab-close")).toHaveLength(0)

  const host = mount()
  host.querySelectorAll<HTMLButtonElement>(".canvas-tab-close")[0].click()
  expect(host.querySelector(".canvas-tab-confirm")).not.toBeNull()
  host.querySelector(".canvas-tab-strip")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  expect(host.querySelector(".canvas-tab-confirm")).toBeNull()
})
