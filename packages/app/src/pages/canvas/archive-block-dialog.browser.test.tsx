import { afterEach, expect, mock, test } from "bun:test"
import { dict } from "@/i18n/en"
import { Workspace } from "@opencode-ai/schema/workspace"
import type { CanvasTab } from "@opencode-ai/schema/canvas-tab"
import { createComponent } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import { ArchiveBlockDialog } from "./archive-block-dialog"

mock.module("@/context/language", () => ({
  useLanguage: () => ({
    t: (key: keyof typeof dict, params?: Record<string, string | number>) => {
      const template = String(dict[key] ?? key)
      if (!params) return template
      return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, name: string) => String(params[name] ?? ""))
    },
  }),
}))

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

const Fragment = (props: { children?: unknown }) => props.children
;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

const entry = (id: string, createdAt: number): CanvasTab.Entry => ({
  id,
  workspaceID: Workspace.ID.make("wrk_test"),
  kind: "master-agent",
  blockID: "block-1",
  conversationID: `sess-${id}`,
  title: `Session ${id}`,
  createdAt,
  writable: true,
})

interface OwnedPage {
  items: CanvasTab.Entry[]
  next: CanvasTab.Cursor | null
  selectedTabID?: string | null
  revision: number
  bindingRevision?: number
}

const disposers: VoidFunction[] = []

function mount(input: {
  listOwned: (args: {
    workspaceID: string
    kind: CanvasTab.Kind
    blockID: string
    cursor?: string
    limit: number
  }) => Promise<OwnedPage>
  confirm?: (revision: number) => Promise<void>
  close?: () => void
}) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  disposers.push(
    render(
      () =>
        createComponent(ArchiveBlockDialog, {
          workspaceID: "ws-1",
          blockID: "block-1",
          kind: "master-agent" as CanvasTab.Kind,
          client: { listOwned: input.listOwned } as never,
          confirm: input.confirm ?? (async () => {}),
          close: input.close ?? (() => {}),
        }),
      host,
    ),
  )
  return host
}

function dialog(): HTMLElement {
  const element = document.body.querySelector<HTMLElement>('[data-component="dialog-v2"]')
  if (!element) throw new Error("archive dialog not found")
  return element
}

function button(text: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === text)
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button ${text} not found`)
  return match
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the archive dialog")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  document.body.innerHTML = ""
})

test("counts every owned page and confirms with the observed revision", async () => {
  const cursors: Array<string | undefined> = []
  let confirmed: number | undefined
  let closed = 0
  mount({
    listOwned: async (args) => {
      cursors.push(args.cursor)
      if (!args.cursor)
        return {
          items: [entry("tab-a", 3), entry("tab-b", 2)],
          next: { createdAt: 2, id: "tab-b" },
          selectedTabID: "tab-a",
          revision: 4,
          bindingRevision: 1,
        }
      return { items: [entry("tab-c", 1)], next: null, selectedTabID: "tab-a", revision: 4, bindingRevision: 1 }
    },
    confirm: async (revision) => {
      confirmed = revision
    },
    close: () => {
      closed++
    },
  })

  await waitFor(() => dialog().textContent?.includes("Sessions to archive: 3") === true)
  expect(dialog().textContent).toContain("Remove block?")
  expect(dialog().textContent).toContain("restored from other Master Agent blocks")
  expect(cursors[1]).toBe(JSON.stringify({ createdAt: 2, id: "tab-b" }))

  button("Archive sessions and remove block").click()
  await waitFor(() => closed === 1)
  expect(confirmed).toBe(4)
})

test("cancel closes the dialog without confirming", async () => {
  let confirmed = 0
  let closed = 0
  mount({
    listOwned: async () => ({ items: [entry("tab-a", 1)], next: null, revision: 2, bindingRevision: 1 }),
    confirm: async () => {
      confirmed++
    },
    close: () => {
      closed++
    },
  })

  await waitFor(() => dialog().textContent?.includes("Sessions to archive: 1") === true)
  button("Cancel").click()
  await waitFor(() => closed === 1)
  expect(confirmed).toBe(0)
})

test("a failed removal keeps the dialog open, reports the error, and reloads the count", async () => {
  let revision = 4
  let attempts = 0
  let confirmed: number | undefined
  let closed = 0
  mount({
    listOwned: async () => ({
      items: Array.from({ length: revision === 4 ? 2 : 3 }, (_, index) => entry(`tab-${index}`, 4 - index)),
      next: null,
      revision,
      bindingRevision: 1,
    }),
    confirm: async (value) => {
      confirmed = value
      attempts++
      if (attempts === 1) throw new Error("network")
    },
    close: () => {
      closed++
    },
  })

  await waitFor(() => dialog().textContent?.includes("Sessions to archive: 2") === true)
  revision = 5
  button("Archive sessions and remove block").click()
  await waitFor(() => dialog().textContent?.includes("Unable to remove the block") === true)
  expect(closed).toBe(0)

  await waitFor(() => dialog().textContent?.includes("Sessions to archive: 3") === true)
  button("Archive sessions and remove block").click()
  await waitFor(() => closed === 1)
  expect(confirmed).toBe(5)
})

test("a failed count shows a retry action and keeps confirm disabled", async () => {
  let attempts = 0
  mount({
    listOwned: async () => {
      attempts++
      if (attempts === 1) throw new Error("offline")
      return { items: [entry("tab-a", 1)], next: null, revision: 7, bindingRevision: 1 }
    },
  })

  await waitFor(() => dialog().textContent?.includes("Unable to remove the block") === true)
  expect(button("Archive sessions and remove block").disabled).toBe(true)
  button("Retry loading sessions").click()
  await waitFor(() => dialog().textContent?.includes("Sessions to archive: 1") === true)
  expect(button("Archive sessions and remove block").disabled).toBe(false)
})

test("rejects a registry revision change while counting pages", async () => {
  let page = 0
  mount({
    listOwned: async () => {
      page++
      if (page === 1)
        return {
          items: [entry("tab-a", 3)],
          next: { createdAt: 3, id: "tab-a" },
          revision: 4,
          bindingRevision: 1,
        }
      return { items: [entry("tab-b", 2)], next: null, revision: 5, bindingRevision: 1 }
    },
  })

  await waitFor(() => dialog().textContent?.includes("Unable to remove the block") === true)
  expect(button("Archive sessions and remove block").disabled).toBe(true)
})
