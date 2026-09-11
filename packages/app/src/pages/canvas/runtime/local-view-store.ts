// Device-local per-block view state. Explicitly separate from the layout
// descriptor cache (C1): layout carries identity + transform only; view state
// lives here under its own localStorage key.
const KEY = "opencode.canvas.local-view.v1"

export interface BlockLocalViewStore {
  read<T>(blockID: string): T | undefined
  write<T>(blockID: string, value: T): void
  delete(blockID: string): void
  clearAll(): void
  flush?(): boolean
}

export function createBlockLocalViewStore(): BlockLocalViewStore {
  let entries: Record<string, Record<string, unknown>> = {}

  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Array<{ blockID: string; view: Record<string, unknown> }>
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.blockID === "string" && item.view && typeof item.view === "object") {
            entries[item.blockID] = item.view
          }
        }
      }
    }
  } catch {
    entries = {}
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    try {
      const list = Object.entries(entries).map(([blockID, view]) => ({ blockID, view }))
      localStorage.setItem(KEY, JSON.stringify(list))
      return true
    } catch {
      // localStorage can be unavailable in private contexts
      return false
    }
  }

  const scheduleFlush = () => {
    if (disposed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, 200)
  }

  return {
    read<T>(blockID: string): T | undefined {
      return entries[blockID] as T | undefined
    },
    write<T>(blockID: string, value: T) {
      const next = { ...(entries[blockID] ?? {}), ...(value as Record<string, unknown>) }
      entries[blockID] = next
      scheduleFlush()
    },
    delete(blockID) {
      delete entries[blockID]
      scheduleFlush()
    },
    clearAll() {
      entries = {}
      scheduleFlush()
    },
    flush,
  }
}
