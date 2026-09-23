import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { CanvasTab } from "@opencode-ai/schema"
import { visibleTabs } from "./canvas-tab-layout"
import { useLanguage } from "@/context/language"
import "./canvas-tabs.css"

export interface CanvasTabsProps {
  owned: readonly CanvasTab.Entry[]
  archived: readonly CanvasTab.Entry[]
  selectedID?: string
  status: string
  loading?: boolean
  error?: unknown
  search: string
  onSearch(value: string): void
  onCreate(): void | Promise<void>
  onSelect(entry: CanvasTab.Entry): void | Promise<void>
  onRestore(entry: CanvasTab.Entry): void | Promise<void>
  onArchive(entry: CanvasTab.Entry): void | Promise<void>
  onLoadMore(): void | Promise<void>
  onRetry(): void | Promise<void>
}

// Extra room a tab reserves for its close control.
const TAB_CLOSE_WIDTH = 24

export function CanvasTabs(props: CanvasTabsProps): HTMLDivElement {
  const language = useLanguage()
  const root = document.createElement("div")
  root.className = "canvas-tab-strip"
  const [width, setWidth] = createSignal(420)
  const [statusWidth, setStatusWidth] = createSignal(0)
  const [open, setOpen] = createSignal(false)
  let observer: ResizeObserver | undefined

  const visible = document.createElement("div")
  visible.className = "canvas-tab-visible"
  visible.setAttribute("role", "tablist")
  const create = button("canvas-tab-new", language.t("canvas.tabs.new"), "+", () => props.onCreate())
  const history = button("canvas-tab-history-button", language.t("canvas.tabs.history"), "…", () => {
    setOpen((current) => !current)
  })
  const indicator = document.createElement("span")
  indicator.className = "canvas-tab-status-indicator"
  indicator.setAttribute("role", "status")
  const menu = document.createElement("div")
  menu.className = "canvas-tab-history-menu"
  menu.setAttribute("role", "dialog")
  const searchBox = document.createElement("div")
  searchBox.className = "canvas-tab-history-search"
  const search = document.createElement("input")
  search.addEventListener("input", () => props.onSearch(search.value))
  searchBox.append(search)
  const list = document.createElement("div")
  list.className = "canvas-tab-history-list"
  list.setAttribute("role", "listbox")
  const loadMore = button("canvas-tab-load-more", language.t("canvas.tabs.more"), language.t("canvas.tabs.more"), () =>
    props.onLoadMore(),
  )
  const message = document.createElement("div")
  menu.append(searchBox, list, loadMore, message)
  root.append(visible, create, history, indicator, menu)

  let confirmation: { entry: CanvasTab.Entry; element: HTMLElement } | undefined
  const closeConfirm = () => {
    confirmation?.element.remove()
    confirmation = undefined
  }
  const openConfirm = (entry: CanvasTab.Entry) => {
    closeConfirm()
    const element = document.createElement("div")
    element.className = "canvas-tab-confirm"
    element.setAttribute("role", "dialog")
    element.setAttribute("aria-label", language.t("canvas.tabs.archive.title"))
    const text = document.createElement("p")
    text.textContent = language.t("canvas.tabs.archive.title")
    const actions = document.createElement("div")
    actions.className = "canvas-tab-confirm-actions"
    const cancel = button("canvas-tab-confirm-cancel", language.t("common.cancel"), language.t("common.cancel"), () =>
      closeConfirm(),
    )
    const accept = button(
      "canvas-tab-confirm-accept",
      language.t("canvas.tabs.archive.confirm"),
      language.t("canvas.tabs.archive.confirm"),
      () => {
        const target = confirmation?.entry
        closeConfirm()
        if (target) void props.onArchive(target)
      },
    )
    actions.append(cancel, accept)
    element.append(text, actions)
    root.append(element)
    confirmation = { entry, element }
    accept.focus()
  }

  const render = () => {
    root.dataset.status = props.status
    const owned = [...props.owned].sort(orderEntries)
    const archived = [...props.archived].sort(orderEntries)
    if (confirmation && !owned.some((entry) => entry.id === confirmation!.entry.id)) closeConfirm()
    const closeable = props.owned.length > 1
    const style = getComputedStyle(root)
    const font = style.font || "14px sans-serif"
    const measured = Object.fromEntries(
      owned.map((entry) => [entry.id, measureTabMinimum(entry.title, font) + (closeable ? TAB_CLOSE_WIDTH : 0)]),
    )
    // visibleTabs reserves the two buttons and their gaps; the status adds one more gap.
    const layout = visibleTabs(owned, props.selectedID, width() - statusWidth() - 4, measured)
    const entriesByID = new Map(owned.map((entry) => [entry.id, entry]))
    visible.replaceChildren()
    visible.setAttribute("aria-label", language.t("canvas.tabs.label"))
    for (const id of layout.visible) {
      const entry = entriesByID.get(id)
      if (!entry) continue
      const item = document.createElement("div")
      item.className = "canvas-tab-item"
      item.style.minWidth = `${measured[id]}px`
      item.style.width = `${measured[id]}px`
      if (entry.id === props.selectedID) item.classList.add("selected")
      const button = document.createElement("button")
      button.type = "button"
      button.className = "canvas-tab-button"
      button.setAttribute("role", "tab")
      button.setAttribute("aria-selected", String(entry.id === props.selectedID))
      button.title = entry.title
      button.textContent = entry.title
      button.addEventListener("click", () => void props.onSelect(entry))
      item.append(button)
      if (closeable) {
        const close = document.createElement("button")
        close.type = "button"
        close.className = "canvas-tab-close"
        close.setAttribute("aria-label", language.t("canvas.tabs.archive.label"))
        close.title = language.t("canvas.tabs.archive.label")
        close.textContent = "×"
        close.addEventListener("click", (event) => {
          event.stopPropagation()
          openConfirm(entry)
        })
        item.append(close)
      }
      visible.append(item)
    }
    create.setAttribute("aria-label", language.t("canvas.tabs.new"))
    // A block without tabs creates its first one from the block's own prompt.
    create.hidden = owned.length === 0
    history.setAttribute("aria-label", language.t("canvas.tabs.history"))
    history.setAttribute("aria-expanded", String(open()))
    indicator.dataset.statusIndicator = props.status
    indicator.textContent =
      props.status === "loading"
        ? language.t("canvas.tabs.loadingStatus")
        : language.t(
            `canvas.chat.${props.status === "working" ? "working" : props.status === "attention" || props.status === "error" ? "attention" : "ready"}`,
          )
    menu.setAttribute("aria-label", language.t("canvas.tabs.history"))
    menu.hidden = !open()
    search.setAttribute("aria-label", language.t("canvas.tabs.search"))
    search.placeholder = language.t("canvas.tabs.search")
    // Keep the focused input and its caret intact while queries update.
    if (search.value !== props.search) search.value = props.search
    list.replaceChildren()
    const query = props.search.trim().toLocaleLowerCase()
    const archivedResults = archived.filter(
      (entry) =>
        !query ||
        entry.title.toLocaleLowerCase().includes(query) ||
        entry.id === props.search.trim() ||
        entry.conversationID === props.search.trim(),
    )
    for (const entry of [...owned, ...archivedResults]) {
      const row = document.createElement("button")
      row.type = "button"
      row.className = "canvas-tab-history-row"
      row.setAttribute("role", "option")
      row.setAttribute("aria-selected", String(entry.id === props.selectedID))
      row.textContent = entry.title
      if (entry.archivedAt) row.classList.add("archived")
      row.addEventListener("click", () => void (entry.archivedAt ? props.onRestore(entry) : props.onSelect(entry)))
      list.append(row)
    }
    loadMore.textContent = language.t("canvas.tabs.more")
    loadMore.setAttribute("aria-label", language.t("canvas.tabs.more"))
    loadMore.disabled = !!props.loading
    message.replaceChildren()
    if (props.error) {
      const error = document.createElement("div")
      error.setAttribute("role", "alert")
      error.textContent = language.t("canvas.tabs.error")
      error.append(button("", language.t("canvas.tabs.retry"), language.t("common.retry"), () => props.onRetry()))
      message.append(error)
    }
    if (props.loading) {
      const loading = document.createElement("div")
      loading.className = "canvas-tab-history-state"
      loading.textContent = language.t("canvas.tabs.loading")
      message.replaceChildren(loading)
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    if (root.contains(event.target as Node)) return
    setOpen(false)
    closeConfirm()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    if (confirmation) {
      closeConfirm()
      return
    }
    if (!open()) return
    setOpen(false)
    history.focus()
  }

  onMount(() => {
    const measure = () => {
      setWidth(root.clientWidth || 420)
      setStatusWidth(indicator.getBoundingClientRect().width)
    }
    measure()
    observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure)
    observer?.observe(root)
    observer?.observe(indicator)
    window.addEventListener("resize", measure)
    document.addEventListener("pointerdown", onPointerDown)
    root.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      observer?.disconnect()
      window.removeEventListener("resize", measure)
      document.removeEventListener("pointerdown", onPointerDown)
      root.removeEventListener("keydown", onKeyDown)
    })
  })
  createEffect(render)
  return root
}

function button(className: string, ariaLabel: string, text: string, action: () => void | Promise<void>) {
  const result = document.createElement("button")
  result.type = "button"
  result.className = className
  result.setAttribute("aria-label", ariaLabel)
  result.textContent = text
  result.addEventListener("click", () => void action())
  return result
}

function orderEntries(a: CanvasTab.Entry, b: CanvasTab.Entry) {
  return b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function measureTabMinimum(title: string, font: string) {
  const graphemes =
    typeof Intl.Segmenter === "function"
      ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(title)]
          .slice(0, 16)
          .map((part) => part.segment)
          .join("")
      : Array.from(title).slice(0, 16).join("")
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")
  if (!context) return 96
  context.font = font
  return Math.max(96, context.measureText(graphemes).width + 28)
}
