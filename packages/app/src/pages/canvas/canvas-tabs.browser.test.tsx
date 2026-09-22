import { afterEach, expect, mock, test } from "bun:test"
import { dict } from "@/i18n/en"
import { createComponent } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import { CanvasTabs } from "./canvas-tabs"
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
    workspaceID: "wrk_test",
    kind: "operating-chat" as const,
    blockID: "block-1",
    conversationID: `session-${index}`,
    title: `${archivedAt ? "Archived" : "Owned"} session ${index}`,
    createdAt: count - index,
    ...(archivedAt ? { archivedAt } : {}),
    writable: !archivedAt,
  }))

function mount(overrides: Partial<Parameters<typeof CanvasTabs>[0]> = {}) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const props = {
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
    onLoadMore: () => {},
    onRetry: () => {},
    ...overrides,
  }
  render(() => h(CanvasTabs as never, props as never) as never, host)
  return host
}

afterEach(() => {
  document.body.innerHTML = ""
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
