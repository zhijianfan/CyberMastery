/** @jsxImportSource solid-js */
import { afterEach, describe, expect, it, mock } from "bun:test"
import { createRequire } from "node:module"
import { dict } from "@/i18n/en"
import { serializeCtxPackDragPayload } from "@/context/ctxpack/drag"

// Compile the real Solid components so interaction tests exercise reactive updates.
const pluginRequire = createRequire(import.meta.resolve("vite-plugin-solid"))
const translations: string[] = []
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
    t: (key: keyof typeof dict, values?: Record<string, string | number>) => {
      translations.push(key)
      return Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
        dict[key] ?? key,
      )
    },
  }),
}))

// Type-only imports are erased at compile time and never resolve at runtime.
import type { Accessor, JSX } from "solid-js"
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
const clientHModule = import.meta.resolve("solid-js/h").replace("dist/server.js", "dist/h.js")

mock.module("solid-js", () => require(clientSolid))
mock.module("solid-js/web", () => require(clientWeb))
mock.module("solid-js/store", () => require(clientStore))
mock.module("@opencode-ai/ui/tabs", () => {
  const h = require(clientHModule).default as typeof import("solid-js/h").default
  const solid = require(clientSolid) as typeof import("solid-js")
  const [active, setActive] = solid.createSignal("pinned")
  let onChange: ((value: string) => void) | undefined
  const Tabs = Object.assign(
    (props: { value: string; onChange?: (value: string) => void; children?: unknown }) => {
      solid.createEffect(() => setActive(props.value))
      onChange = props.onChange
      return props.children
    },
    {
      List: (props: Record<string, unknown>) => h("div", { ...props, role: "tablist" }, props.children),
      Trigger: (props: Record<string, unknown>) => {
        return h(
          "button",
          {
            ...props,
            type: "button",
            role: "tab",
            get "aria-selected"() {
              return active() === props.value
            },
            onClick: () => {
              setActive(String(props.value))
              onChange?.(String(props.value))
            },
          },
          props.children,
        )
      },
      Content: (props: Record<string, unknown>) => {
        const Show = solid.Show as unknown as (props: { when: boolean; children: JSX.Element }) => JSX.Element
        return solid.createComponent(Show, {
          get when() {
            return active() === props.value
          },
          get children() {
            return h("div", { ...props, role: "tabpanel" }, props.children) as unknown as JSX.Element
          },
        })
      },
    },
  )
  return { Tabs }
})

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
const { CtxPackDropTarget } = await import("@/context/ctxpack/drop-target")
const { createContextAttachmentStore } = await import("@/context/ctxpack/attachment-store")

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
  translations.splice(0)
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
    pinnedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

function withPinnedAt(summary: CtxPackSummary, pinnedAt: number | null): CtxPackSummary {
  return { ...summary, pinnedAt } as CtxPackSummary
}

function makePinnedView(overrides: Partial<CtxPackBrowserView> = {}): CtxPackBrowserView {
  return {
    ...makeView(),
    pinnedItems: [],
    pinnedNextCursor: null,
    loadingMorePinned: false,
    ...overrides,
  } as CtxPackBrowserView
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
    pinnedAt: null,
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
      return serializeCtxPackDragPayload({
        version: 1,
        workspaceID: summary.workspaceID,
        ctxPackID: summary.id,
        contentHash: summary.contentHash,
        label: summary.title,
        estimatedTokens: summary.estimatedTokens,
      })
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

function dragEvent(type: string, dataTransfer: DataTransfer) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer })
  return event
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
    const [view] = createSignal(
      makeView({ status: "stale", items: [makeSummary({ id: "p1", title: "Stale pack" })], pinnedItems: [makeSummary({ id: "p1", title: "Stale pack" })] }),
    )
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
    buttonByText(container, "Search")!.click()
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
    buttonByText(first.container, "Search")!.click()
    expect(byText(first.container, "No context packs yet.")).not.toBeNull()
    first.dispose()
    first.container.remove()
    const [noResultsView] = createSignal(
      makeView({ items: [], query: { ...initialCtxPackBrowserView().query, query: "zzz" } }),
    )
    const second = mount(noResultsView)
    buttonByText(second.container, "Search")!.click()
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
    buttonByText(plain.container, "Search")!.click()
    expect(byText(plain.container, "Live pack")).not.toBeNull()
    expect(byText(plain.container, "Gone pack")).toBeNull()
    plain.dispose()
    plain.container.remove()
    const [withDeletedView] = createSignal(makeView({ items, query: { ...makeView({}).query, includeDeleted: true } }))
    const withDeleted = mount(withDeletedView)
    buttonByText(withDeleted.container, "Search")!.click()
    expect(byText(withDeleted.container, "Gone pack")).not.toBeNull()
    expect(withDeleted.container.querySelector('[data-ctxpack-id="gone"]')?.getAttribute("draggable")).toBe("false")
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
    expect(JSON.parse(data[CTXPACK_DRAG_MIME])).toEqual({
      version: 1,
      workspaceID: "ws-1",
      ctxPackID: "pack-1",
      contentHash: "hash-1",
      label: "Alpha pack",
      estimatedTokens: 512,
    })
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
    buttonByText(container, "Search")!.click()
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

  it("opens details before revealing metadata actions and saves the selected revision", async () => {
    const [view, setView] = createSignal(
      makeView({
        items: [makeSummary({ id: "p1", title: "Patchable" })],
        canPatch: true,
        canDelete: true,
      }),
    )
    const { harness, container } = mount(view)
    buttonByText(container, "Search")!.click()
    expect(buttonByText(container, "Patch")).toBeNull()
    const card = container.querySelector<HTMLElement>('[data-ctxpack-id="p1"] .ctxpack-browser-row-content')!
    card.click()
    expect(harness.commands[0]).toEqual({ type: "open", ctxPackID: "p1" })
    setView(makeView({ selected: makeInfo({ id: "p1", title: "Patchable" }), canPatch: true, canDelete: true }))
    const patchButton = buttonByText(container, "Patch")
    expect(patchButton).not.toBeNull()
    expect(translations).toContain("canvas.ctxpack.edit.patch")
    expect(translations).toContain("canvas.ctxpack.edit.delete")
    patchButton!.click()
    await Promise.resolve()
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
  })

  it("validates metadata before sending and preserves edits after a failed mutation", async () => {
    const [view] = createSignal(makeView({ selected: makeInfo(), canPatch: true }))
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

  it("localizes the restore action for a deleted pack", () => {
    const [view] = createSignal(
      makeView({ selected: makeInfo({ deletedAt: 1720000000000 }), canPatch: false, canDelete: true }),
    )
    const { container } = mount(view)

    expect(buttonByText(container, "Restore")).not.toBeNull()
    expect(translations).toContain("canvas.ctxpack.edit.restore")
  })

  it("keeps unsaved metadata and its original revision when an event refreshes selected details", async () => {
    const [view, setView] = createSignal(makeView({ selected: makeInfo(), canPatch: true }))
    const { harness, container } = mount(view)
    buttonByText(container, "Patch")!.click()
    typeInto(byLabel(container, "Title")!, "Unsaved title")
    setView(makeView({ selected: makeInfo({ title: "Another user edited this", revision: 4 }), canPatch: true }))
    expect((byLabel(container, "Title") as HTMLInputElement | null)?.value).toBe("Unsaved title")
    buttonByText(container, "Save changes")!.click()
    await Promise.resolve()
    expect(harness.commands[0]).toMatchObject({
      type: "patch-metadata",
      expectedRevision: 3,
      patch: { title: "Unsaved title" },
    })
  })

  it("shows row metadata and at most three keyword tags on each compact card", () => {
    const [view] = createSignal(makePinnedView({ pinnedItems: [withPinnedAt(makeSummary(), 1720000000000)] } as Partial<CtxPackBrowserView>))
    const { container } = mount(view)
    const card = container.querySelector(".ctxpack-browser-row")!
    expect(card.querySelector("h3")?.textContent).toBe("Alpha pack")
    expect([...card.querySelectorAll(".ctxpack-browser-chip")].map((chip) => chip.textContent)).toEqual([
      "react",
      "hooks",
      "state",
    ])
    expect(card.querySelector("button[data-action=\"pin\"]")).not.toBeNull()
    expect(card.querySelector(".ctxpack-browser-card-meta")).not.toBeNull()
    expect(card.textContent).toContain("Saved")
  })

  it("drags a collapsed card into one chat's real context attachment store", async () => {
    const [view] = createSignal(makeView({ items: [makeSummary()], canMaterialize: true }))
    const { container, harness } = mount(view)
    buttonByText(container, "Search")!.click()
    const card = container.querySelector<HTMLElement>(".ctxpack-browser-card")!
    expect(card.getAttribute("draggable")).toBe("true")
    const transfers = new DataTransfer()
    card.dispatchEvent(dragEvent("dragstart", transfers))
    const targets = document.createElement("div")
    document.body.append(targets)
    const materialized: unknown[] = []
    const stores: ReturnType<typeof createContextAttachmentStore>[] = []
    const dispose = solidRender(
      () =>
        ["operating", "master"].map((role) => {
          const store = createContextAttachmentStore(
            () => "ws-1",
            async (input) => {
              materialized.push(input)
              return {
                contextCapsuleID: "capsule-1",
                sourceCtxPackID: "pack-1",
                label: "Alpha pack",
                contentHash: "hash-1",
                estimatedTokens: 512,
              }
            },
          )
          stores.push(store)
          return createComponent(CtxPackDropTarget, {
            targetID: `chat-${role}`,
            workspaceID: "ws-1",
            instanceID: `instance-${role}`,
            functionalityID: `builtin:${role}`,
            addCtxPack: (payload) =>
              store.addCtxPack(payload, { instanceID: `instance-${role}`, functionalityID: `builtin:${role}` }),
            children: document.createElement("textarea"),
          })
        }),
      targets,
    )
    mounted.push({ dispose, container: targets })
    const target = targets.children[1]!
    const hover = dragEvent("dragover", transfers)
    target.dispatchEvent(hover)
    expect(hover.defaultPrevented).toBe(true)
    target.dispatchEvent(dragEvent("drop", transfers))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(stores[0].attachments()).toHaveLength(0)
    expect(stores[1].attachments().map((attachment) => attachment.source.ctxPackID)).toEqual(["pack-1"])
    expect(materialized).toEqual([
      {
        workspaceID: "ws-1",
        ctxPackID: "pack-1",
        expectedContentHash: "hash-1",
        targetInstanceID: "instance-master",
        targetFunctionalityID: "builtin:master",
      },
    ])
    expect(transfers.effectAllowed).toBe("copy")
    expect(harness.commands).toEqual([])
  })

  it("edits ParallelPlan separately from keywords in the opened details", async () => {
    const [view] = createSignal(makeView({ selected: makeInfo(), canPatch: true }))
    const { container, harness } = mount(view)
    buttonByText(container, "Patch")!.click()
    const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"][name="parallelPlan"]')
    expect(toggle !== null).toBe(true)
    toggle!.click()
    buttonByText(container, "Save changes")!.click()
    await Promise.resolve()
    expect(harness.commands[0]).toMatchObject({
      type: "patch-metadata",
      patch: { tags: ["ParallelPlan"], keywords: ["react", "hooks"] },
    })
  })

  it("opens with pinned selected and keeps pinned and search panels separate", () => {
    const recent = withPinnedAt(makeSummary({ id: "recent", title: "Recent pin", createdAt: 1720000000000 }), 1710000000000)
    const older = withPinnedAt(makeSummary({ id: "older", title: "Older pin", createdAt: 1710000000000 }), 1720000000000)
    const searchOnly = withPinnedAt(makeSummary({ id: "search", title: "Search result" }), null)
    const [view] = createSignal(
      makePinnedView({ items: [searchOnly], pinnedItems: [older, recent] } as Partial<CtxPackBrowserView>),
    )
    const { container } = mount(view)

    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Pinned")
    const pinnedPanel = container.querySelector<HTMLElement>(".ctxpack-browser-pinned-panel")!
    const rows = [...pinnedPanel.querySelectorAll<HTMLElement>(".ctxpack-browser-row")]
    expect(rows.map((row) => row.querySelector("h3")?.textContent)).toEqual(["Recent pin", "Older pin"])

    buttonByText(container, "Search")!.click()
    const searchPanel = container.querySelector<HTMLElement>(".ctxpack-browser-search-panel")!
    expect(searchPanel.textContent).toContain("Search result")
    expect(searchPanel.textContent).not.toContain("Recent pin")
  })

  it("renders one-column rows with saved time and pin actions that do not open the row", () => {
    const saved = withPinnedAt(makeSummary({ title: "Saved row", keywords: ["one", "two", "three", "four"] }), 1720000000000)
    const [view] = createSignal(makePinnedView({ pinnedItems: [saved] } as Partial<CtxPackBrowserView>))
    const { container, harness } = mount(view)
    const row = container.querySelector<HTMLElement>('[data-ctxpack-id="pack-1"]')!
    expect(row.classList.contains("ctxpack-browser-row")).toBe(true)
    expect(row.textContent).toContain("Saved row")
    expect(row.textContent).toContain("one")
    expect(row.textContent).toContain("three")
    expect(row.textContent).not.toContain("four")
    expect(row.textContent).toContain("Saved")
    expect(row.querySelector("time")?.getAttribute("datetime")).toBe(new Date(1719000000000).toISOString())
    const pin = row.querySelector<HTMLButtonElement>('button[data-action="pin"]')!
    expect(pin).not.toBeNull()
    expect(pin.getAttribute("aria-label")).toBe("Unpin Saved row")
    pin.click()
    expect(harness.commands.at(-1)).toEqual({ type: "set-pinned", ctxPackID: "pack-1", pinned: false })
    expect(harness.commands.some((command) => command.type === "open")).toBe(false)
  })

  it("disables pin controls while saving and reports mutation failures", async () => {
    const [view] = createSignal(
      makePinnedView({ pinnedItems: [withPinnedAt(makeSummary(), 1720000000000)] } as Partial<CtxPackBrowserView>),
    )
    let reject!: (error: Error) => void
    const pending = new Promise<void>((_, fail) => {
      reject = fail
    })
    const { container } = mount(view, () => pending)
    const button = container.querySelector<HTMLButtonElement>('button[data-action="pin"]')!

    button.click()
    expect(button.disabled).toBe(true)
    expect(button.getAttribute("aria-busy")).toBe("true")

    reject(new Error("offline"))
    await pending.catch(() => undefined)
    await Promise.resolve()
    expect(button.disabled).toBe(false)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not update this pin.")
  })

  it("handles pin failures from an open pack without an unhandled rejection", async () => {
    const [view] = createSignal(makePinnedView({ selected: makeInfo() } as Partial<CtxPackBrowserView>))
    let reject!: (error: Error) => void
    const pending = new Promise<void>((_, fail) => {
      reject = fail
    })
    const { container } = mount(view, () => pending)
    const button = container.querySelector<HTMLButtonElement>('button[data-action="pin"]')!

    button.click()
    expect(button.disabled).toBe(true)
    reject(new Error("offline"))
    await pending.catch(() => undefined)
    await Promise.resolve()

    expect(button.disabled).toBe(false)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not update this pin.")
  })

  it("disables pinning deleted packs while still allowing them to be unpinned", () => {
    const deleted = makeSummary({ id: "deleted", title: "Deleted", deletedAt: 1720000000000 })
    const pinned = withPinnedAt(
      makeSummary({ id: "pinned-deleted", title: "Pinned deleted", deletedAt: 1720000000000 }),
      1720000000000,
    )
    const [view] = createSignal(
      makePinnedView({
        items: [deleted, pinned],
        query: { ...initialCtxPackBrowserView().query, includeDeleted: true },
      } as Partial<CtxPackBrowserView>),
    )
    const { container } = mount(view)
    buttonByText(container, "Search")!.click()

    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Pin Deleted"]')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Unpin Pinned deleted"]')?.disabled).toBe(false)
  })

  it("shows a pinned-only empty state and loads more pinned items", () => {
    const [view] = createSignal(
      makePinnedView({ pinnedItems: [], pinnedNextCursor: "pin-next" } as Partial<CtxPackBrowserView>),
    )
    const { container, harness } = mount(view)
    expect(byText(container, "No pinned context packs yet.")).not.toBeNull()
    buttonByText(container, "Load more pinned")!.click()
    expect(harness.commands.at(-1)).toEqual({ type: "load-more-pinned" })
  })

  it("shows paging progress and suppresses repeated clicks while dispatch is pending", async () => {
    const [view] = createSignal(
      makePinnedView({ pinnedItems: [], pinnedNextCursor: "pin-next" } as Partial<CtxPackBrowserView>),
    )
    const commands: CtxPackBrowserCommand[] = []
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const { container } = mount(view, async (command) => {
      commands.push(command)
      await pending
    })
    const button = buttonByText(container, "Load more pinned")!

    button.click()
    expect(button.disabled).toBe(true)
    expect(button.getAttribute("aria-busy")).toBe("true")
    button.click()
    expect(commands).toEqual([{ type: "load-more-pinned" }])

    finish()
    await pending
    await Promise.resolve()
    expect(button.disabled).toBe(false)
  })

  it("pins an unpinned pack from detail", () => {
    const [view] = createSignal(makePinnedView({ selected: makeInfo({ pinnedAt: null }) } as Partial<CtxPackBrowserView>))
    const { container, harness } = mount(view)
    const pin = container.querySelector<HTMLButtonElement>('button[data-action="pin"]')!
    expect(pin).not.toBeNull()
    expect(pin.getAttribute("aria-label")).toBe("Pin Alpha pack")
    pin.click()
    expect(harness.commands.at(-1)).toEqual({ type: "set-pinned", ctxPackID: "pack-1", pinned: true })
  })

  it("returns to Search after closing detail", () => {
    const searchOnly = makeSummary({ id: "search", title: "Search result" })
    const [view, setView] = createSignal(
      makePinnedView({ items: [searchOnly] } as Partial<CtxPackBrowserView>),
    )
    const { container, harness } = mount(view)
    buttonByText(container, "Search")!.click()
    expect(container.querySelector(".ctxpack-browser-search-panel")?.textContent).toContain("Search result")
    setView(makePinnedView({ items: [searchOnly], selected: makeInfo() } as Partial<CtxPackBrowserView>))
    expect(container.querySelector(".ctxpack-browser-detail")).not.toBeNull()
    buttonByText(container, "Close")!.click()
    expect(harness.commands.at(-1)).toEqual({ type: "close-detail" })
    setView(makePinnedView({ items: [searchOnly] } as Partial<CtxPackBrowserView>))
    expect(container.querySelector(".ctxpack-browser-search-panel")?.textContent).toContain("Search result")
    expect(container.querySelector(".ctxpack-browser-pinned-panel")).toBeNull()
  })
})
