import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { CanvasTab } from "@opencode-ai/schema"
import { measureTabMinimum, visibleTabs } from "./canvas-tab-layout"
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
  onLoadMore(): void | Promise<void>
  onRetry(): void | Promise<void>
}

export function CanvasTabs(props: CanvasTabsProps): HTMLDivElement {
  const root = document.createElement("div")
  root.className = "canvas-tab-strip"
  const [width, setWidth] = createSignal(420)
  const [open, setOpen] = createSignal(false)
  let observer: ResizeObserver | undefined

  const render = () => {
    root.replaceChildren()
    root.dataset.status = props.status
    const owned = [...props.owned].sort(orderEntries)
    const archived = [...props.archived].sort(orderEntries)
    const style = getComputedStyle(root)
    const font = style.font || "14px sans-serif"
    const measured = Object.fromEntries(owned.map((entry) => [entry.id, measureTabMinimum(entry.title, font)]))
    const layout = visibleTabs(owned, props.selectedID, width(), measured)
    const entriesByID = new Map(owned.map((entry) => [entry.id, entry]))
    const visible = document.createElement("div")
    visible.className = "canvas-tab-visible"
    visible.setAttribute("role", "tablist")
    visible.setAttribute("aria-label", "Canvas sessions")
    for (const id of layout.visible) {
      const entry = entriesByID.get(id)
      if (!entry) continue
      const button = document.createElement("button")
      button.type = "button"
      button.className = "canvas-tab-button"
      if (entry.id === props.selectedID) button.classList.add("selected")
      button.setAttribute("role", "tab")
      button.setAttribute("aria-selected", String(entry.id === props.selectedID))
      button.title = entry.title
      button.textContent = entry.title
      button.addEventListener("click", () => void props.onSelect(entry))
      visible.append(button)
    }
    root.append(visible)
    const create = button("canvas-tab-new", "New session", "+", () => props.onCreate())
    root.append(create)
    const history = button("canvas-tab-history-button", "Session history", "…", () => { setOpen((current) => !current) })
    history.setAttribute("aria-expanded", String(open()))
    root.append(history)
    const indicator = document.createElement("span")
    indicator.className = "canvas-tab-status-indicator"
    indicator.dataset.statusIndicator = props.status
    indicator.setAttribute("role", "status")
    indicator.textContent = statusLabel(props.status)
    root.append(indicator)

    const menu = document.createElement("div")
    menu.className = "canvas-tab-history-menu"
    menu.setAttribute("role", "dialog")
    menu.hidden = !open()
    const search = document.createElement("input")
    search.setAttribute("aria-label", "Search archived sessions")
    search.placeholder = "Search archived sessions"
    search.value = props.search
    search.addEventListener("input", () => props.onSearch(search.value))
    menu.append(search)
    const list = document.createElement("div")
    list.className = "canvas-tab-history-list"
    list.setAttribute("role", "listbox")
    const query = props.search.trim().toLocaleLowerCase()
    const archivedResults = archived.filter((entry) => !query || entry.title.toLocaleLowerCase().includes(query) || entry.id === props.search.trim())
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
    menu.append(list)
    const loadMore = button("canvas-tab-load-more", "Load more", "Load more", () => props.onLoadMore())
    menu.append(loadMore)
    if (props.error) {
      const error = document.createElement("div")
      error.setAttribute("role", "alert")
      error.textContent = "Unable to load sessions."
      error.append(button("", "Retry loading sessions", "Retry", () => props.onRetry()))
      menu.replaceChildren(error)
    }
    if (props.loading) {
      const loading = document.createElement("div")
      loading.className = "canvas-tab-history-state"
      loading.textContent = "Loading sessions…"
      menu.replaceChildren(loading)
    }
    root.append(menu)
  }

  const onPointerDown = (event: PointerEvent) => {
    if (root.contains(event.target as Node)) return
    setOpen(false)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") setOpen(false)
  }

  onMount(() => {
    const measure = () => setWidth(root.clientWidth || 420)
    measure()
    observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure)
    observer?.observe(root)
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

function statusLabel(status: string) {
  if (status === "working") return "Working"
  if (status === "attention" || status === "error") return "Attention"
  if (status === "loading") return "Loading"
  return "Ready"
}
