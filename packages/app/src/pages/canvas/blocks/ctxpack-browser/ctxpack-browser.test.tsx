/** @jsxImportSource solid-js */
import { afterEach, describe, expect, it, mock } from "bun:test"
import { createRequire } from "node:module"
import { dict } from "@/i18n/en"

// Compile the real Solid components so interaction tests exercise reactive updates.
const pluginRequire = createRequire(import.meta.resolve("vite-plugin-solid"))
const babel = pluginRequire("@babel/core") as {
  transformSync(source: string, options: Record<string, unknown>): { code: string }
}
await Bun.plugin({
  name: "ctxpack-solid-test",
  setup(build) {
    build.onLoad({ filter: /ctxpack-browser[\\/].*\.tsx$/ }, async (args) => ({
      contents: babel.transformSync(await Bun.file(args.path).text(), {
        filename: args.path,
        presets: [
          [pluginRequire("babel-preset-solid"), { generate: "dom" }],
          pluginRequire("@babel/preset-typescript"),
        ],
      }).code,
      loader: "js",
    }))
  },
})
mock.module("@/context/language", () => ({
  useLanguage: () => ({
    t: (key: keyof typeof dict, values?: Record<string, string | number>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
        dict[key],
      ),
  }),
}))

// Type-only imports are erased at compile time and never resolve at runtime.
import type { Accessor } from "solid-js"
import type { CtxPackBrowserCommand, CtxPackBrowserView } from "./view-model"
import type { CtxPackInfo, CtxPackSource, CtxPackSummary } from "./types"
import { CTXPACK_DRAG_MIME } from "./types"
import { initialCtxPackBrowserView } from "./view-model"

// The test environment resolves solid-js to its server build (the `node`
// export condition wins), so — following the repo's probe-mock pattern, but
// with DYNAMIC imports because mock.module only intercepts imports made AFTER
// registration — redirect solid-js and solid-js/web to the client builds
// before loading any solid value or component module.
const clientSolid = import.meta.resolve("solid-js").replace("dist/server.js", "dist/solid.js")
const clientWeb = import.meta.resolve("solid-js/web").replace("dist/server.js", "dist/web.js")
const clientStore = import.meta.resolve("solid-js/store").replace("dist/server.js", "dist/store.js")

mock.module("solid-js", () => require(clientSolid))
mock.module("solid-js/web", () => require(clientWeb))
mock.module("solid-js/store", () => require(clientStore))

const { createSignal, createComponent } = await import("solid-js")
const { render: solidRender } = await import("solid-js/web")
const { default: h } = await import("solid-js/h")

// React classic-JSX shim (repo convention — see chat-relay/view.test.tsx):
// bun compiles JSX to React.createElement regardless of the solid pragma, so
// route React.createElement into solid's createComponent / h.
function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}
const Fragment = (props: { children?: unknown }) => props.children
;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

const CtxPackBrowser = (await import("./index")).default

interface Mounted {
  dispose: () => void
  container: HTMLElement
}

const mounted: Mounted[] = []

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!
    entry.dispose()
    entry.container.remove()
  }
})

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeSource(blockID: string, functionalityID: string): CtxPackSource {
  return {
    workspaceID: "ws-1",
    blockID,
    functionalityID,
    kind: "message",
    direction: "received",
    sourceTimestamp: 1718000000000,
    capturedAt: 1718000001000,
    entityRef: null,
    label: null,
    metadata: {},
    sensitivity: "workspace",
  }
}

function makeSummary(overrides: Partial<CtxPackSummary> = {}): CtxPackSummary {
  return {
    id: "pack-1",
    workspaceID: "ws-1",
    title: "Alpha pack",
    keywords: ["react", "hooks", "state", "effects", "extra-a", "extra-b"],
    sensitivity: "workspace",
    revision: 3,
    contentHash: "hash-1",
    byteLength: 2048,
    estimatedTokens: 512,
    fragmentCount: 2,
    sourceBlockIDs: ["blk-1", "blk-2"],
    sourceFunctionalityIDs: ["builtin:chat"],
    sourceKinds: ["message", "tool-output"],
    usage: { attachedCount: 3, lastAttachedAt: 1720000000000 },
    createdAt: 1719000000000,
    updatedAt: 1720000000000,
    deletedAt: null,
    ...overrides,
  }
}

function makeInfo(overrides: Partial<CtxPackInfo> = {}): CtxPackInfo {
  return {
    id: "pack-1",
    workspaceID: "ws-1",
    title: "Alpha pack",
    keywords: ["react", "hooks"],
    sensitivity: "workspace",
    revision: 3,
    contentHash: "hash-1",
    byteLength: 2048,
    estimatedTokens: 512,
    fragments: [
      {
        id: "frag-2",
        clientFragmentID: "cf-2",
        text: "second fragment body",
        ordinal: 2,
        source: makeSource("blk-2", "builtin:tool"),
        contentHash: "h2",
        byteLength: 10,
        estimatedTokens: 4,
      },
      {
        id: "frag-1",
        clientFragmentID: "cf-1",
        text: "first fragment body",
        ordinal: 1,
        source: makeSource("blk-1", "builtin:chat"),
        contentHash: "h1",
        byteLength: 10,
        estimatedTokens: 4,
      },
      {
        id: "frag-0",
        clientFragmentID: "cf-0",
        text: "zeroth fragment body",
        ordinal: 0,
        source: makeSource("blk-0", "builtin:file"),
        contentHash: "h0",
        byteLength: 10,
        estimatedTokens: 4,
      },
    ],
    usage: { attachedCount: 2, lastAttachedAt: 1720000000000 },
    createdByUserID: "u-1",
    createdAt: 1719000000000,
    updatedAt: 1720000000000,
    deletedAt: null,
    ...overrides,
  }
}

function makeHarness(view: Accessor<CtxPackBrowserView>) {
  const commands: CtxPackBrowserCommand[] = []
  const dragPayloads: CtxPackSummary[] = []
  const attaches: CtxPackSummary[] = []
  return {
    commands,
    dragPayloads,
    attaches,
    dispatch: async (command: CtxPackBrowserCommand): Promise<void> => {
      commands.push(command)
    },
    createDragPayload: (summary: CtxPackSummary): string => {
      dragPayloads.push(summary)
      return JSON.stringify({ id: summary.id })
    },
    attachToFocusedInput: async (summary: CtxPackSummary): Promise<void> => {
      attaches.push(summary)
    },
  }
}

function makeView(overrides: Partial<CtxPackBrowserView> = {}): CtxPackBrowserView {
  return { ...initialCtxPackBrowserView(), status: "ready", ...overrides }
}

function mount(view: Accessor<CtxPackBrowserView>, dispatch?: (command: CtxPackBrowserCommand) => Promise<void>) {
  const harness = makeHarness(view)
  const container = document.createElement("div")
  document.body.appendChild(container)
  const dispose = solidRender(
    () => (
      <CtxPackBrowser
        view={view}
        dispatch={dispatch ?? harness.dispatch}
        createDragPayload={harness.createDragPayload}
        attachToFocusedInput={harness.attachToFocusedInput}
      />
    ),
    container,
  )
  mounted.push({ dispose, container })
  return { harness, container, dispose }
}

/* ------------------------------------------------------------------ */
/* Query helpers                                                       */
/* ------------------------------------------------------------------ */

function byText(container: HTMLElement, text: string | RegExp): HTMLElement | null {
  for (const el of container.querySelectorAll<HTMLElement>("*")) {
    const content = el.textContent ?? ""
    const matches = typeof text === "string" ? content === text : text.test(content)
    if (matches) return el
  }
  return null
}

function byLabel(container: HTMLElement, label: string): HTMLElement | null {
  const byAria = container.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  if (byAria) return byAria
  for (const labelEl of container.querySelectorAll("label")) {
    if ((labelEl.textContent ?? "").trim() === label) {
      const control = labelEl.querySelector<HTMLElement>("input, select, textarea, button")
      if (control) return control
    }
  }
  return null
}

function buttons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
  return buttons(container).find((b) => (b.textContent ?? "").trim() === text) ?? null
}

function typeInto(el: HTMLElement, value: string, eventName = "input"): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = value
  el.dispatchEvent(new Event(eventName, { bubbles: true }))
}

function dragStart(el: HTMLElement): { data: Record<string, string>; dataTransfer: { effectAllowed: string } } {
  const data: Record<string, string> = {}
  const dataTransfer = {
    setData: (kind: string, value: string) => {
      data[kind] = value
    },
    effectAllowed: "",
  }
  const event = new Event("dragstart", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer })
  el.dispatchEvent(event)
  return { data, dataTransfer }
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("CtxPackBrowser", () => {
  it("renders only a skeleton while loading, without stale list controls", () => {
    const [view] = createSignal(initialCtxPackBrowserView())
    const { container } = mount(view)
    expect(container.querySelector(".ctxpack-browser-skeleton")).not.toBeNull()
    expect(byLabel(container, "Search context packs")).toBeNull()
    expect(container.querySelector(".ctxpack-browser-load-more")).toBeNull()
    expect(container.querySelector(".ctxpack-browser-stale")).toBeNull()
    expect(container.querySelector(".ctxpack-browser-card")).toBeNull()
  })

  it("shows an explicit permission-denied state with the error code", () => {
    const [view] = createSignal(makeView({ status: "permission-denied", errorCode: "ERR_FORBIDDEN" }))
    const { container } = mount(view)
    expect(byText(container, /permission denied/i)).not.toBeNull()
    expect(byText(container, "ERR_FORBIDDEN")).not.toBeNull()
    expect(byText(container, /no context packs/i)).toBeNull()
  })

  it("shows an explicit unavailable state without a fake empty list", () => {
    const [view] = createSignal(makeView({ status: "unavailable" }))
    const { container } = mount(view)
    expect(byText(container, /unavailable/i)).not.toBeNull()
    expect(container.querySelector(".ctxpack-browser-card")).toBeNull()
    expect(byText(container, /no context packs/i)).toBeNull()
  })

  it("keeps last items and shows a stale badge when stale", () => {
    const [view] = createSignal(makeView({ status: "stale", items: [makeSummary({ id: "p1", title: "Stale pack" })] }))
    const { container } = mount(view)
    expect(byText(container, "Stale pack")).not.toBeNull()
    expect(container.querySelector('[aria-label="stale data"]')).not.toBeNull()
  })

  it("shows the stale warning while a pack detail remains open", () => {
    const [view] = createSignal(makeView({ status: "stale", selected: makeInfo() }))
    const { container } = mount(view)
    expect(container.querySelector(".ctxpack-browser-detail")).not.toBeNull()
    expect(container.querySelector('[aria-label="stale data"]')).not.toBeNull()
  })

  it("renders search, filters, sort, cards and load-more when ready", () => {
    const [view] = createSignal(
      makeView({
        items: [makeSummary({ id: "p1", title: "Pack one" }), makeSummary({ id: "p2", title: "Pack two" })],
        nextCursor: "cursor-1",
      }),
    )
    const { container } = mount(view)
    expect(byLabel(container, "Search context packs")).not.toBeNull()
    expect(byLabel(container, "Source kind")).not.toBeNull()
    expect(byLabel(container, "Sensitivity")).not.toBeNull()
    expect(byLabel(container, "Keyword")).not.toBeNull()
    expect(byLabel(container, "Created after")).not.toBeNull()
    expect(byLabel(container, "Created before")).not.toBeNull()
    expect(byLabel(container, "Include deleted")).not.toBeNull()
    expect(byLabel(container, "Sort")).not.toBeNull()
    expect(byText(container, "Pack one")).not.toBeNull()
    expect(byText(container, "Pack two")).not.toBeNull()
    expect(byText(container, "Load more")).not.toBeNull()
  })

  it("distinguishes an empty query from a query with no results", () => {
    const [emptyView] = createSignal(makeView({ items: [] }))
    const first = mount(emptyView)
    expect(byText(first.container, "No context packs yet.")).not.toBeNull()
    first.dispose()
    first.container.remove()
    const [noResultsView] = createSignal(
      makeView({ items: [], query: { ...initialCtxPackBrowserView().query, query: "zzz" } }),
    )
    const second = mount(noResultsView)
    expect(byText(second.container, "No context packs match your filters.")).not.toBeNull()
  })

  it("only renders deleted items when includeDeleted is enabled", () => {
    const items = [
      makeSummary({ id: "live", title: "Live pack" }),
      makeSummary({ id: "gone", title: "Gone pack", deletedAt: 1720000000000 }),
    ]
    // Classic-JSX compilation freezes initial props, so each state is mounted
    // as its own render (this also matches how the adapter re-projects).
    const [plainView] = createSignal(makeView({ items }))
    const plain = mount(plainView)
    expect(byText(plain.container, "Live pack")).not.toBeNull()
    expect(byText(plain.container, "Gone pack")).toBeNull()
    plain.dispose()
    plain.container.remove()
    const [withDeletedView] = createSignal(makeView({ items, query: { ...makeView({}).query, includeDeleted: true } }))
    const withDeleted = mount(withDeletedView)
    expect(byText(withDeleted.container, "Gone pack")).not.toBeNull()
    expect(byText(withDeleted.container, "deleted")).not.toBeNull()
  })

  it("renders every fragment in ordinal order with source metadata in the detail view", () => {
    const [view] = createSignal(makeView({ selected: makeInfo() }))
    const { container } = mount(view)
    expect(container.querySelector('[data-component="ctxpack-browser"]')).not.toBeNull()
    const fragments = [...container.querySelectorAll<HTMLElement>(".ctxpack-browser-fragment")]
    expect(fragments.length).toBe(3)
    expect(fragments.map((f) => f.getAttribute("data-ordinal"))).toEqual(["0", "1", "2"])
    expect(fragments.map((f) => f.querySelector(".ctxpack-browser-fragment-text")?.textContent)).toEqual([
      "zeroth fragment body",
      "first fragment body",
      "second fragment body",
    ])
    const title = container.querySelector(".ctxpack-browser-detail-title")
    expect(title).not.toBeNull()
    expect(title?.textContent).toBe("Alpha pack")
    const first = fragments[0]
    expect(first.textContent).toContain("ws-1")
    expect(first.textContent).toContain("blk-0")
    expect(first.textContent).toContain("builtin:file")
    const firstSource = first.querySelector(".ctxpack-browser-fragment-source")
    expect(firstSource?.getAttribute("data-source-workspace")).toBe("ws-1")
    expect(firstSource?.getAttribute("data-source-block")).toBe("blk-0")
    expect(firstSource?.getAttribute("data-source-functionality")).toBe("builtin:file")
    expect(firstSource?.getAttribute("data-source-timestamp")).toBe("1718000000000")
  })

  it("never uses markup-injection APIs in component sources", async () => {
    const dir = import.meta.dir
    const files = [
      "index.tsx",
      "filters.tsx",
      "ctxpack-card.tsx",
      "ctxpack-detail.tsx",
      "view-model.ts",
      "types.ts",
      "manifest.ts",
    ]
    // Needles are assembled at runtime so the literals never appear in source.
    const innerNeedle = "inner" + "HTML"
    const unsafeNeedle = "unsafe" + "HTML"
    for (const file of files) {
      const source = await Bun.file(`${dir}/${file}`).text()
      expect(source, file).not.toContain(innerNeedle)
      expect(source, file).not.toContain(unsafeNeedle)
    }
  })

  it("drag icon is draggable, labeled, and seeds the frozen drag payload", () => {
    const [view] = createSignal(makeView({ selected: makeInfo() }))
    const { harness, container } = mount(view)
    const icon = byLabel(container, "Drag pack to attach")
    expect(icon).not.toBeNull()
    expect(icon!.getAttribute("draggable")).toBe("true")
    const { data, dataTransfer } = dragStart(icon!)
    expect(data[CTXPACK_DRAG_MIME]).toBe(JSON.stringify({ id: "pack-1" }))
    expect(data["text/plain"]).toBe("Alpha pack")
    expect(dataTransfer.effectAllowed).toBe("copy")
    expect(harness.dragPayloads.length).toBe(1)
    expect(harness.dragPayloads[0].title).toBe("Alpha pack")
  })

  it("attach button calls attachToFocusedInput with the pack summary", async () => {
    const [view] = createSignal(makeView({ selected: makeInfo() }))
    const { harness, container } = mount(view)
    const button = buttonByText(container, "Attach to focused input")
    expect(button).not.toBeNull()
    button!.click()
    await Promise.resolve()
    expect(harness.attaches.length).toBe(1)
    expect(harness.attaches[0].id).toBe("pack-1")
    expect(harness.attaches[0].fragmentCount).toBe(3)
  })

  it("debounces text search and always resets cursor on set-query", async () => {
    const [view] = createSignal(makeView({ items: [makeSummary()] }))
    const { harness, container } = mount(view)
    const search = byLabel(container, "Search context packs") as HTMLInputElement | null
    expect(search).not.toBeNull()
    typeInto(search!, "ab")
    typeInto(search!, "abc")
    expect(harness.commands.filter((c) => c.type === "set-query")).toHaveLength(0)
    await new Promise((resolve) => setTimeout(resolve, 210))
    const setQueries = harness.commands.filter((c) => c.type === "set-query")
    expect(setQueries).toHaveLength(1)
    expect(setQueries[0]).toEqual({ type: "set-query", patch: { query: "abc", cursor: null } })
    const sort = byLabel(container, "Sort") as HTMLSelectElement | null
    expect(sort).not.toBeNull()
    typeInto(sort!, "title-asc", "change")
    expect(harness.commands[harness.commands.length - 1]).toEqual({
      type: "set-query",
      patch: { sort: "title-asc", cursor: null },
    })
  })

  it("edits metadata with the summary revision; card click opens", async () => {
    const [view] = createSignal(
      makeView({
        items: [makeSummary({ id: "p1", title: "Patchable" })],
        canPatch: true,
        canDelete: true,
      }),
    )
    const { harness, container } = mount(view)
    const patchButton = buttonByText(container, "Patch")
    expect(patchButton).not.toBeNull()
    patchButton!.click()
    await Promise.resolve()
    expect(harness.commands).toEqual([])
    typeInto(byLabel(container, "Title")!, "  Updated pack  ")
    typeInto(byLabel(container, "Keywords")!, "Bun, bun, context packs")
    typeInto(byLabel(container, "Pack sensitivity")!, "private", "change")
    buttonByText(container, "Save changes")!.click()
    await Promise.resolve()
    expect(harness.commands.find((c) => c.type === "patch-metadata")).toEqual({
      type: "patch-metadata",
      ctxPackID: "p1",
      expectedRevision: 3,
      patch: { title: "Updated pack", keywords: ["Bun", "context packs"], sensitivity: "private" },
    })
    const deleteButton = buttonByText(container, "Delete")
    expect(deleteButton).not.toBeNull()
    deleteButton!.click()
    await Promise.resolve()
    expect(harness.commands.find((c) => c.type === "remove")).toEqual({
      type: "remove",
      ctxPackID: "p1",
      expectedRevision: 3,
    })
    const card = container.querySelector<HTMLElement>('[data-ctxpack-id="p1"]')
    expect(card).not.toBeNull()
    card!.click()
    await Promise.resolve()
    expect(harness.commands.find((c) => c.type === "open")).toEqual({ type: "open", ctxPackID: "p1" })
  })

  it("validates metadata before sending and preserves edits after a failed mutation", async () => {
    const [view] = createSignal(makeView({ items: [makeSummary()], canPatch: true }))
    const requests: CtxPackBrowserCommand[] = []
    const { container } = mount(view, async (command) => {
      requests.push(command)
      throw { code: "CtxPackRevisionConflictError" }
    })
    buttonByText(container, "Patch")!.click()
    const title = byLabel(container, "Title") as HTMLInputElement
    expect(title).not.toBeNull()
    typeInto(title, " ")
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    expect(requests).toEqual([])
    expect(container.textContent).toContain("Use a title between 1 and 120 characters.")
    typeInto(title, "Changed title")
    typeInto(byLabel(container, "Keywords")!, "x".repeat(49))
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    expect(requests).toEqual([])
    expect(container.textContent).toContain("Use up to 12 keywords, each between 1 and 48 characters.")
    typeInto(byLabel(container, "Keywords")!, "valid")
    buttonByText(container, "Save changes")!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests).toHaveLength(1)
    expect(title.value).toBe("Changed title")
    expect(container.textContent).toContain("This pack changed. Reload its latest metadata before saving again.")
    expect(buttonByText(container, "Save changes")).not.toBeNull()
  })

  it("keeps unsaved metadata and its original revision when an event replaces list summaries", async () => {
    const [view, setView] = createSignal(makeView({ items: [makeSummary()], canPatch: true }))
    const { harness, container } = mount(view)
    buttonByText(container, "Patch")!.click()
    typeInto(byLabel(container, "Title")!, "Unsaved title")
    setView(makeView({ items: [makeSummary({ title: "Another user edited this", revision: 4 })], canPatch: true }))
    expect((byLabel(container, "Title") as HTMLInputElement | null)?.value).toBe("Unsaved title")
    buttonByText(container, "Save changes")!.click()
    await Promise.resolve()
    expect(harness.commands[0]).toMatchObject({
      type: "patch-metadata",
      expectedRevision: 3,
      patch: { title: "Unsaved title" },
    })
  })
})
