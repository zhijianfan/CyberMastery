import { CanvasTab } from "@opencode-ai/schema"
import { visibleTabs } from "./canvas-tab-layout"
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
  root.dataset.status = props.status
  const owned = [...props.owned].sort(orderEntries)
  const archived = [...props.archived].sort(orderEntries)
  const visible = document.createElement("div")
  visible.className = "canvas-tab-visible"
  visible.setAttribute("role", "tablist")
  visible.setAttribute("aria-label", "Canvas sessions")
  const measured = Object.fromEntries(owned.map((entry) => [entry.id, Math.max(96, Array.from(entry.title).slice(0, 16).length * 8 + 28)]))
  const layout = visibleTabs(owned, props.selectedID, 420, measured)
  const entriesByID = new Map(owned.map((entry) => [entry.id, entry]))
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

  const create = document.createElement("button")
  create.type = "button"
  create.className = "canvas-tab-new"
  create.setAttribute("aria-label", "New session")
  create.textContent = "+"
  create.addEventListener("click", () => void props.onCreate())
  root.append(create)

  const history = document.createElement("button")
  history.type = "button"
  history.className = "canvas-tab-history-button"
  history.setAttribute("aria-label", "Session history")
  history.setAttribute("aria-expanded", "false")
  history.textContent = "…"
  root.append(history)

  const menu = document.createElement("div")
  menu.className = "canvas-tab-history-menu"
  menu.setAttribute("role", "menu")
  menu.hidden = true
  const search = document.createElement("input")
  search.setAttribute("aria-label", "Search archived sessions")
  search.placeholder = "Search archived sessions"
  search.value = props.search
  search.addEventListener("input", () => props.onSearch(search.value))
  menu.append(search)
  const list = document.createElement("div")
  list.className = "canvas-tab-history-list"
  list.setAttribute("role", "group")
  const query = props.search.trim().toLocaleLowerCase()
  const archivedResults = archived.filter((entry) => !query || entry.title.toLocaleLowerCase().includes(query) || entry.id === props.search.trim())
  for (const entry of [...owned, ...archivedResults]) {
    const row = document.createElement("button")
    row.type = "button"
    row.className = "canvas-tab-history-row"
    row.dataset.canvasTabId = entry.id
    row.setAttribute("role", "option")
    row.setAttribute("aria-selected", String(entry.id === props.selectedID))
    row.textContent = entry.title
    if (entry.archivedAt) row.classList.add("archived")
    row.addEventListener("click", () => void (entry.archivedAt ? props.onRestore(entry) : props.onSelect(entry)))
    list.append(row)
  }
  menu.append(list)
  const loadMore = document.createElement("button")
  loadMore.type = "button"
  loadMore.className = "canvas-tab-load-more"
  loadMore.textContent = "Load more"
  loadMore.addEventListener("click", () => void props.onLoadMore())
  menu.append(loadMore)
  if (props.error) {
    const error = document.createElement("div")
    error.setAttribute("role", "alert")
    error.textContent = "Unable to load sessions."
    const retry = document.createElement("button")
    retry.type = "button"
    retry.setAttribute("aria-label", "Retry loading sessions")
    retry.textContent = "Retry"
    retry.addEventListener("click", () => void props.onRetry())
    error.append(retry)
    menu.replaceChildren(error)
  }
  if (props.loading) {
    const loading = document.createElement("div")
    loading.className = "canvas-tab-history-state"
    loading.textContent = "Loading sessions…"
    menu.replaceChildren(loading)
  }
  history.addEventListener("click", () => {
    const next = menu.hidden
    menu.hidden = !next
    history.setAttribute("aria-expanded", String(next))
    if (next) search.focus()
  })
  root.append(menu)
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      menu.hidden = true
      history.setAttribute("aria-expanded", "false")
    }
  })
  document.addEventListener("pointerdown", (event) => {
    if (!root.contains(event.target as Node)) {
      menu.hidden = true
      history.setAttribute("aria-expanded", "false")
    }
  })
  return root
}

function orderEntries(a: CanvasTab.Entry, b: CanvasTab.Entry) {
  return b.createdAt - a.createdAt || a.id.localeCompare(b.id)
}
