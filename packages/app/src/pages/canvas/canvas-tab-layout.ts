export interface CanvasTabLayoutEntry {
  id: string
  title: string
  createdAt: number
}

const CONTROL_WIDTH = 72
const TAB_GAP = 4

export function visibleTabs(
  entries: readonly CanvasTabLayoutEntry[],
  selectedID: string | undefined,
  availableWidth: number,
  measuredWidths: Readonly<Record<string, number>>,
) {
  const ordered = [...entries].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
  const remaining = Math.max(0, availableWidth - CONTROL_WIDTH)
  const visible: string[] = []
  let used = 0

  const add = (entry: CanvasTabLayoutEntry) => {
    const width = Math.max(1, measuredWidths[entry.id] ?? measureFallback(entry.title))
    const next = used + (visible.length ? TAB_GAP : 0) + width
    if (next > remaining) return false
    visible.push(entry.id)
    used = next
    return true
  }

  const selected = ordered.find((entry) => entry.id === selectedID)
  if (selected) add(selected)
  for (const entry of ordered) {
    if (visible.includes(entry.id)) continue
    add(entry)
  }

  const visibleSet = new Set(visible)
  return {
    visible,
    overflow: ordered.filter((entry) => !visibleSet.has(entry.id)).map((entry) => entry.id),
  }
}

function measureFallback(title: string) {
  return Math.max(96, Array.from(title).slice(0, 16).length * 8 + 28)
}
