import "./canvas.css"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { DebugBar } from "@/components/debug-bar"
import { useWorkspace } from "@/context/workspace"
import { createEffect, createSignal, For, Index, onCleanup, onMount, Show, type JSX, type ParentProps } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import {
  clampCamera,
  panCamera,
  screenToWorld,
  zoomCamera,
  type Camera,
  type Point,
  type Size,
  WORLD_SIZE,
} from "./editor/camera"
import {
  DEFAULT_CELL,
  fitDefaultLayout,
  moveBlock,
  resizeBlock,
  snap,
  type GridConstraints,
  type GridRect,
} from "./editor/grid"
import {
  appendExchange,
  defaultOperatingLayers,
  OPERATING_CONTEXT_LIMIT,
  type OperatingExchange,
  type OperatingLayer,
} from "./editor/operating-context"

const STORAGE_KEY = "opencode-canvas-v1"
const LEGACY_BLOCK_ID = "canvas-legacy"

const legacyConstraints: GridConstraints = { minW: 320, minH: 200, maxW: null, maxH: null, initialAspect: "free" }
const blockConstraints: GridConstraints = { minW: 248, minH: 124, maxW: 760, maxH: 760, initialAspect: "square" }

export type CanvasBlockType =
  | "chat"
  | "context"
  | "tools"
  | "files"
  | "notes"
  | "voice"
  | "chatgpt-router"
  | "operating-chat"

export type RouterBlockState = "uninitialized" | "initializing" | "ready" | "missing-login" | "error"

interface CanvasMessage {
  role: "user" | "assistant"
  text: string
}

interface CanvasBlock {
  id: string
  type: CanvasBlockType | "legacy"
  x: number
  y: number
  w: number
  h: number
  z: number
  collapsed: boolean
  defaultRect: boolean
  text: string
  listening: boolean
  messages: CanvasMessage[]
  router: RouterBlockState
  agentKey: string
  layers: OperatingLayer[]
  history: OperatingExchange[]
}

interface BlockModule {
  title: string
  subtitle: string
  accent: string
  w: number
  h: number
  icon: () => JSX.Element
}

function uid() {
  return `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const iconChat = () => (
  <svg viewBox="0 0 24 24">
    <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.4-4.2A8 8 0 1 1 21 12Z" />
    <path d="M8 11h8M8 15h5" />
  </svg>
)
const iconContext = () => (
  <svg viewBox="0 0 24 24">
    <path d="M7 4h10l3 3v13H4V4h3Z" />
    <path d="M14 4v5h6M8 13h8M8 17h6" />
  </svg>
)
const iconTools = () => (
  <svg viewBox="0 0 24 24">
    <path d="m14.7 6.3 3-3a5 5 0 0 1-6.5 6.5l-7.6 7.6a2.1 2.1 0 0 0 3 3l7.6-7.6a5 5 0 0 1 6.5-6.5l-3 3-3-3Z" />
  </svg>
)
const iconFiles = () => (
  <svg viewBox="0 0 24 24">
    <path d="M3 6h7l2 2h9v11H3V6Z" />
  </svg>
)
const iconNotes = () => (
  <svg viewBox="0 0 24 24">
    <path d="M5 4h14v16H5z" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
)
const iconVoice = () => (
  <svg viewBox="0 0 24 24">
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
  </svg>
)
const iconRouter = () => (
  <svg viewBox="0 0 24 24">
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
    <path d="M13 7h4a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4h-4" />
  </svg>
)
const iconOperating = () => (
  <svg viewBox="0 0 24 24">
    <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.4-4.2A8 8 0 1 1 21 12Z" />
    <circle cx="12" cy="12" r="2.4" />
    <path d="M12 5.5v2M12 16.5v2M5.5 12h2M16.5 12h2" />
  </svg>
)
const iconCollapse = () => (
  <svg viewBox="0 0 24 24">
    <path d="m7 10 5 5 5-5" />
  </svg>
)
const iconClose = () => (
  <svg viewBox="0 0 24 24">
    <path d="m7 7 10 10M17 7 7 17" />
  </svg>
)
const iconPin = () => (
  <svg viewBox="0 0 24 24">
    <path d="M12 17v5" />
    <path d="M5 17h14l-2.4-2.4V9.2a2 2 0 0 0-.6-1.4L14 5.8V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v1.8L8 7.8a2 2 0 0 0-.6 1.4v5.4L5 17Z" />
  </svg>
)
const iconSend = () => (
  <svg viewBox="0 0 24 24">
    <path d="m4 12 16-8-5 16-3-7-8-1Z" />
    <path d="m12 13 8-9" />
  </svg>
)
const iconSearch = () => (
  <svg viewBox="0 0 24 24">
    <circle cx="11" cy="11" r="6" />
    <path d="m16 16 4 4" />
  </svg>
)
const iconFolder = () => (
  <svg viewBox="0 0 24 24">
    <path d="M3 6h7l2 2h9v11H3V6Z" />
  </svg>
)
const iconFile = () => (
  <svg viewBox="0 0 24 24">
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v5h5" />
  </svg>
)
const iconCheck = () => (
  <svg viewBox="0 0 24 24">
    <path d="m6 12 4 4 8-9" />
  </svg>
)
const iconSpin = () => (
  <svg viewBox="0 0 24 24">
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v6h-6" />
  </svg>
)
const iconMic = () => (
  <svg viewBox="0 0 24 24">
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
  </svg>
)

const MODULES: Record<CanvasBlockType, BlockModule> = {
  chat: {
    title: "Conversation",
    subtitle: "Agent · ready",
    accent: "var(--canvas-purple)",
    w: 410,
    h: 440,
    icon: iconChat,
  },
  context: {
    title: "Project Context",
    subtitle: "Design principles",
    accent: "var(--canvas-blue)",
    w: 344,
    h: 334,
    icon: iconContext,
  },
  tools: {
    title: "Tool Activity",
    subtitle: "Everything looks healthy",
    accent: "var(--canvas-mint)",
    w: 368,
    h: 300,
    icon: iconTools,
  },
  files: {
    title: "Workspace Files",
    subtitle: "agent-canvas / src",
    accent: "var(--canvas-yellow)",
    w: 320,
    h: 352,
    icon: iconFiles,
  },
  notes: {
    title: "Scratchpad",
    subtitle: "Private to this canvas",
    accent: "var(--canvas-peach)",
    w: 330,
    h: 270,
    icon: iconNotes,
  },
  voice: {
    title: "Voice Input",
    subtitle: "Browser microphone",
    accent: "var(--canvas-pink)",
    w: 286,
    h: 300,
    icon: iconVoice,
  },
  "chatgpt-router": {
    title: "ChatGPT Router",
    subtitle: "Relayed to chatgpt.com",
    accent: "var(--canvas-green)",
    w: 380,
    h: 440,
    icon: iconRouter,
  },
  "operating-chat": {
    title: "Operating Chat Session",
    subtitle: "OperatingAgent · context stack",
    accent: "var(--canvas-blue)",
    w: 420,
    h: 460,
    icon: iconOperating,
  },
}

const LEGACY_MODULE: BlockModule = {
  title: "OpenCode",
  subtitle: "Legacy interface · pinned",
  accent: "var(--canvas-purple)",
  w: 0,
  h: 0,
  icon: iconChat,
}

interface CanvasState {
  camera: Camera
  editing: boolean
  selectedId: string | null
  zCounter: number
  blocks: CanvasBlock[]
}

interface PersistedState {
  camera: Camera
  editing: boolean
  blocks: CanvasBlock[]
}

function defaultCamera(): Camera {
  return { x: 0, y: 0, scale: 1 }
}

function legacyBlock(panel: Size): CanvasBlock {
  const rect = fitDefaultLayout({ w: panel.w, h: panel.h }, legacyConstraints)
  return {
    id: LEGACY_BLOCK_ID,
    type: "legacy",
    ...rect,
    z: 0,
    collapsed: false,
    defaultRect: true,
    text: "",
    listening: false,
    messages: [],
    router: "uninitialized",
    agentKey: "inherit",
    layers: defaultOperatingLayers(),
    history: [],
  }
}

function blockOf(type: CanvasBlockType, x: number, y: number, z: number): CanvasBlock {
  const module = MODULES[type]
  return {
    id: uid(),
    type,
    x: Math.round(snap(x, DEFAULT_CELL)),
    y: Math.round(snap(y, DEFAULT_CELL)),
    w: module.w,
    h: module.h,
    z,
    collapsed: false,
    defaultRect: false,
    text: "",
    listening: false,
    messages: [],
    router: "uninitialized",
    agentKey: "inherit",
    layers: defaultOperatingLayers(),
    history: [],
  }
}

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || element.isContentEditable
}

type Interaction =
  | { type: "move"; pointerId: number; start: Point; rect: GridRect; blockId: string; legacy: boolean }
  | { type: "resize"; pointerId: number; start: Point; rect: GridRect; blockId: string; legacy: boolean }

function pointerDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function worldClamp(rect: GridRect): GridRect {
  const w = Math.min(rect.w, WORLD_SIZE.w)
  const h = Math.min(rect.h, WORLD_SIZE.h)
  const x = Math.min(Math.max(rect.x, 0), WORLD_SIZE.w - w)
  const y = Math.min(Math.max(rect.y, 0), WORLD_SIZE.h - h)
  return { x, y, w, h, z: rect.z }
}

export function CanvasWorkspace(props: ParentProps) {
  const theme = useTheme()
  const [size, setSize] = createSignal<Size>({ w: 0, h: 0 })
  const [zoomValue, setZoomValue] = createSignal("100%")
  const [toast, setToast] = createSignal<string>()
  const [draggingId, setDraggingId] = createSignal<string>()
  const [resizingId, setResizingId] = createSignal<string>()
  const [selectedType, setSelectedType] = createSignal<CanvasBlockType>("notes")
  const [paletteOpen, setPaletteOpen] = createSignal(false)
  const [statsVisible, setStatsVisible] = createSignal(false)
  let viewportRef: HTMLDivElement | undefined
  let worldRef: HTMLDivElement | undefined
  let interaction: Interaction | undefined
  let panSession: { start: Point; camera: Camera; moved: boolean; startTime: number } | undefined
  const panPointers = new Map<number, Point>()
  let pinch: { camera: Camera; scale: number; distance: number } | undefined
  let lastTap: { time: number; point: Point } | undefined
  let ignoreDblClickUntil = 0
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  const [state, setState] = createStore<CanvasState>({
    camera: defaultCamera(),
    editing: true,
    selectedId: null,
    zCounter: 10,
    blocks: [],
  })

  const panel = (): Size => ({ w: size().w, h: size().h })

  function persist() {
    const payload: PersistedState = {
      camera: state.camera,
      editing: state.editing,
      blocks: state.blocks.filter((block) => block.type !== "legacy"),
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      /* localStorage can be unavailable in private contexts */
    }
  }

  function saveSoon() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(persist, 160)
  }

  function load() {
    let saved: PersistedState | undefined
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) saved = JSON.parse(raw) as PersistedState
    } catch {
      saved = undefined
    }
    setState("camera", saved?.camera ?? defaultCamera())
    setState("editing", saved?.editing ?? true)
    setState("blocks", [
      ...(saved?.blocks ?? []).map((block) => ({
        ...block,
        messages: block.messages ?? [],
        router: block.router ?? "uninitialized",
        agentKey: block.agentKey ?? "inherit",
        layers: block.layers ?? defaultOperatingLayers(),
        history: block.history ?? [],
      })),
      legacyBlock(panel()),
    ])
    setState("zCounter", Math.max(10, ...(saved?.blocks ?? []).map((block) => block.z)) + 1)
  }

  function showToast(message: string) {
    setToast(message)
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => setToast(undefined), 1700)
  }

  function select(id: string | null) {
    setState("selectedId", id)
  }

  function bringToFront(id: string) {
    select(id)
    const block = state.blocks.find((item) => item.id === id)
    if (!block || block.type === "legacy") return
    const z = state.zCounter + 1
    setState("zCounter", z)
    setState("blocks", (blocks) => blocks.map((item) => (item.id === id ? { ...item, z } : item)))
  }

  function setRect(id: string, rect: GridRect) {
    setState("blocks", (blocks) => blocks.map((block) => (block.id === id ? { ...block, ...rect } : block)))
  }

  function applyCamera(camera: Camera) {
    setState("camera", clampCamera(camera, size()))
  }

  function resetView() {
    applyCamera({ x: 0, y: 0, scale: 1 })
    setState("blocks", (blocks) =>
      blocks.map((block) =>
        block.type === "legacy"
          ? { ...block, ...fitDefaultLayout(panel(), legacyConstraints), defaultRect: true }
          : block,
      ),
    )
    showToast("View reset")
  }

  function addBlock(type: CanvasBlockType, worldPoint?: Point) {
    const module = MODULES[type]
    const center = worldPoint ?? screenToWorld(state.camera, { x: size().w / 2, y: size().h / 2 })
    const z = state.zCounter + 1
    setState("zCounter", z)
    const block = blockOf(type, center.x - module.w / 2, center.y - module.h / 2, z)
    setState("blocks", (blocks) => [...blocks, block])
    select(block.id)
    showToast(`${module.title} added`)
  }

  function removeBlock(id: string) {
    const block = state.blocks.find((item) => item.id === id)
    if (!block || block.type === "legacy") return
    setState("blocks", (blocks) => blocks.filter((item) => item.id !== id))
    if (state.selectedId === id) select(null)
    showToast("Block removed")
  }

  function tidyBlocks() {
    let x = 330
    let y = 140
    let rowHeight = 0
    const gap = 28
    const maxX = 1540
    setState("blocks", (blocks) =>
      blocks.map((block) => {
        if (block.type === "legacy") return block
        const width = block.collapsed ? 62 : block.w
        const height = block.collapsed ? 62 : block.h
        if (x + width > maxX) {
          x = 330
          y += rowHeight + gap
          rowHeight = 0
        }
        const next = { ...block, x, y }
        x += width + gap
        rowHeight = Math.max(rowHeight, height)
        return next
      }),
    )
    showToast("Board tidied")
  }

  function toggleTheme() {
    theme.setColorScheme(theme.mode() === "dark" ? "light" : "dark")
  }

  createResizeObserver(
    () => viewportRef,
    ({ width, height }) => {
      setSize({ w: width, h: height })
    },
  )

  let lastFitted: Size = { w: 0, h: 0 }

  createEffect(() => {
    const { w, h } = size()
    if (w <= 0 || h <= 0) return
    if (w === lastFitted.w && h === lastFitted.h) return
    lastFitted = { w, h }
    const legacy = state.blocks.find((block) => block.type === "legacy")
    if (!legacy?.defaultRect) return
    setState("blocks", (blocks) =>
      blocks.map((block) =>
        block.type === "legacy" ? { ...block, ...fitDefaultLayout({ w, h }, legacyConstraints) } : block,
      ),
    )
  })

  createEffect(() => {
    const camera = clampCamera(state.camera, size())
    const world = worldRef
    if (!world) return
    world.style.transform = `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})`
    const gridSize = 24 * camera.scale
    const viewport = viewportRef
    if (viewport) {
      viewport.style.setProperty("--canvas-grid-size", `${gridSize}px`)
      viewport.style.setProperty("--canvas-grid-x", `${camera.x % gridSize}px`)
      viewport.style.setProperty("--canvas-grid-y", `${camera.y % gridSize}px`)
    }
    setZoomValue(`${Math.round(camera.scale * 100)}%`)
  })

  createEffect(() => {
    state.camera.x
    state.camera.y
    state.camera.scale
    state.editing
    state.blocks
    saveSoon()
  })

  onMount(() => {
    load()
    makeEventListener(viewportRef!, "wheel", onWheel, { passive: false })
  })

  onCleanup(() => {
    clearTimeout(saveTimer)
    clearTimeout(toastTimer)
  })

  const onViewportPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return
    if (interaction) return
    const target = event.target as HTMLElement
    if (
      target.closest(
        ".canvas-toolbar, .canvas-block-bar-wrap, .canvas-stats-overlay, .canvas-bottom-left, .canvas-bottom-right",
      )
    )
      return
    if (target.closest(".canvas-card")) return
    event.preventDefault()
    select(null)
    viewportRef?.classList.add("is-panning")
    viewportRef?.setPointerCapture(event.pointerId)
    panPointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (panPointers.size === 1) {
      panSession = {
        start: { x: event.clientX, y: event.clientY },
        camera: state.camera,
        moved: false,
        startTime: performance.now(),
      }
      return
    }
    if (panPointers.size === 2) {
      const [a, b] = [...panPointers.values()]
      pinch = { camera: state.camera, scale: state.camera.scale, distance: Math.max(pointerDistance(a, b), 1) }
      panSession = undefined
    }
  }

  const onViewportDoubleClick = (event: MouseEvent) => {
    if (performance.now() < ignoreDblClickUntil) return
    if (
      (event.target as HTMLElement).closest(
        ".canvas-card, .canvas-toolbar, .canvas-block-bar-wrap, .canvas-stats-overlay, .canvas-bottom-left, .canvas-bottom-right",
      )
    )
      return
    if (!state.editing) return
    const point = screenToWorld(state.camera, { x: event.clientX, y: event.clientY })
    addBlock("notes", { x: point.x - MODULES.notes.w / 2, y: point.y - 50 })
  }

  function onViewportTap(point: Point) {
    const now = performance.now()
    const previous = lastTap
    lastTap = undefined
    if (!state.editing) return
    if (previous && now - previous.time < 420 && pointerDistance(point, previous.point) < 44) {
      ignoreDblClickUntil = performance.now() + 600
      const world = screenToWorld(state.camera, point)
      addBlock("notes", { x: world.x - MODULES.notes.w / 2, y: world.y - 50 })
      return
    }
    lastTap = { time: now, point }
  }

  const onCardPointerDown = (block: CanvasBlock) => {
    bringToFront(block.id)
  }

  const onHeaderPointerDown = (event: PointerEvent, block: CanvasBlock) => {
    if (event.button !== 0 || !state.editing) return
    if (interaction || panPointers.size > 0) return
    if ((event.target as HTMLElement).closest("button, span")) return
    event.preventDefault()
    event.stopPropagation()
    bringToFront(block.id)
    const header = event.currentTarget as HTMLElement
    header.setPointerCapture(event.pointerId)
    setDraggingId(block.id)
    interaction = {
      type: "move",
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      rect: { x: block.x, y: block.y, w: block.w, h: block.h, z: block.z },
      blockId: block.id,
      legacy: block.type === "legacy",
    }
  }

  const onResizePointerDown = (event: PointerEvent, block: CanvasBlock) => {
    if (event.button !== 0 || !state.editing) return
    if (interaction || panPointers.size > 0) return
    event.preventDefault()
    event.stopPropagation()
    bringToFront(block.id)
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    setResizingId(block.id)
    interaction = {
      type: "resize",
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      rect: { x: block.x, y: block.y, w: block.w, h: block.h, z: block.z },
      blockId: block.id,
      legacy: block.type === "legacy",
    }
  }

  function endInteraction() {
    if (!interaction) return
    setDraggingId(undefined)
    setResizingId(undefined)
    if (interaction.legacy) {
      setState("blocks", (blocks) =>
        blocks.map((block) => (block.id === LEGACY_BLOCK_ID ? { ...block, defaultRect: false } : block)),
      )
    }
    interaction = undefined
  }

  makeEventListener(window, "pointermove", (event: PointerEvent) => {
    if (interaction) {
      if (interaction.pointerId !== event.pointerId) return
      const dx = event.clientX - interaction.start.x
      const dy = event.clientY - interaction.start.y
      const delta = { dx: dx / state.camera.scale, dy: dy / state.camera.scale }
      if (interaction.type === "move") {
        const next = interaction.legacy
          ? moveBlock(interaction.rect, delta, panel())
          : worldClamp({
              ...interaction.rect,
              x: snap(interaction.rect.x + delta.dx, DEFAULT_CELL),
              y: snap(interaction.rect.y + delta.dy, DEFAULT_CELL),
            })
        setRect(interaction.blockId, next)
        return
      }
      const constraints = interaction.legacy ? legacyConstraints : blockConstraints
      setRect(interaction.blockId, resizeBlock(interaction.rect, delta, "se", constraints))
      return
    }
    if (!panPointers.has(event.pointerId)) return
    panPointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const pointers = [...panPointers.values()]
    if (pointers.length >= 2) {
      if (!pinch) return
      const distance = Math.max(pointerDistance(pointers[0], pointers[1]), 1)
      applyCamera(
        zoomCamera(pinch.camera, pinch.scale * (distance / pinch.distance), midpoint(pointers[0], pointers[1]), size()),
      )
      return
    }
    if (!panSession) return
    if (!panSession.moved && pointerDistance({ x: event.clientX, y: event.clientY }, panSession.start) > 8) {
      panSession.moved = true
    }
    applyCamera(
      panCamera(
        panSession.camera,
        { x: event.clientX - panSession.start.x, y: event.clientY - panSession.start.y },
        size(),
      ),
    )
  })

  makeEventListener(window, "pointerup", (event: PointerEvent) => {
    if (interaction && interaction.pointerId === event.pointerId) {
      endInteraction()
      return
    }
    if (!panPointers.has(event.pointerId)) return
    const wasTap =
      !!panSession &&
      !panSession.moved &&
      event.pointerType === "touch" &&
      performance.now() - panSession.startTime < 450
    const tapPoint = { x: event.clientX, y: event.clientY }
    panPointers.delete(event.pointerId)
    if (panPointers.size === 0) {
      viewportRef?.classList.remove("is-panning")
      pinch = undefined
      panSession = undefined
    } else if (panPointers.size === 1 && pinch) {
      const [, point] = [...panPointers.entries()][0]
      panSession = { start: point, camera: state.camera, moved: true, startTime: performance.now() }
      pinch = undefined
    }
    if (wasTap) onViewportTap(tapPoint)
  })

  makeEventListener(window, "pointercancel", (event: PointerEvent) => {
    if (interaction && interaction.pointerId === event.pointerId) endInteraction()
    if (!panPointers.has(event.pointerId)) return
    panPointers.delete(event.pointerId)
    if (panPointers.size === 0) {
      viewportRef?.classList.remove("is-panning")
      pinch = undefined
      panSession = undefined
    } else if (panPointers.size === 1 && pinch) {
      const [, point] = [...panPointers.entries()][0]
      panSession = { start: point, camera: state.camera, moved: true, startTime: performance.now() }
      pinch = undefined
    }
  })

  makeEventListener(
    window,
    "lostpointercapture",
    (event: PointerEvent) => {
      if (interaction && interaction.pointerId === event.pointerId) endInteraction()
    },
    { capture: true },
  )

  function onWheel(event: WheelEvent) {
    const target = event.target as HTMLElement
    const overCardBody = !!target.closest(".canvas-card-body")
    const wantsZoom = state.editing ? !overCardBody || event.ctrlKey || event.metaKey : event.ctrlKey || event.metaKey
    if (!wantsZoom) return
    event.preventDefault()
    const sensitivity = event.ctrlKey || event.metaKey ? 0.006 : 0.0017
    const factor = Math.exp(-event.deltaY * sensitivity)
    setState("camera", (camera) =>
      zoomCamera(camera, camera.scale * factor, { x: event.clientX, y: event.clientY }, size()),
    )
  }

  makeEventListener(window, "keydown", (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return
    if (event.key === "Escape") select(null)
    if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId) {
      removeBlock(state.selectedId)
    }
    if (event.key === "0") resetView()
    if (event.key.toLowerCase() === "n" && state.editing) addBlock("notes")
    if (event.key === "+" || event.key === "=") {
      setState("camera", (camera) =>
        zoomCamera(camera, camera.scale * 1.12, { x: size().w / 2, y: size().h / 2 }, size()),
      )
    }
    if (event.key === "-") {
      setState("camera", (camera) =>
        zoomCamera(camera, camera.scale / 1.12, { x: size().w / 2, y: size().h / 2 }, size()),
      )
    }
  })

  function cardStyle(block: CanvasBlock) {
    const accent = block.type === "legacy" ? LEGACY_MODULE.accent : MODULES[block.type].accent
    return {
      left: `${block.x}px`,
      top: `${block.y}px`,
      width: `${block.w}px`,
      height: `${block.h}px`,
      "z-index": String(block.z),
      "--accent": accent,
    }
  }

  function cardClass(block: CanvasBlock) {
    return {
      selected: state.selectedId === block.id,
      collapsed: block.collapsed,
      dragging: draggingId() === block.id,
      resizing: resizingId() === block.id,
    }
  }

  function moduleOf(block: CanvasBlock) {
    return block.type === "legacy" ? LEGACY_MODULE : MODULES[block.type]
  }

  function toggleCollapse(block: CanvasBlock) {
    if (block.type === "legacy") return
    setState("blocks", (blocks) =>
      blocks.map((item) => (item.id === block.id ? { ...item, collapsed: !item.collapsed } : item)),
    )
  }

  return (
    <div class="canvas-app">
      <div
        ref={(element) => (viewportRef = element)}
        class="canvas-viewport"
        classList={{ "canvas-editing": state.editing }}
        onPointerDown={onViewportPointerDown}
        onDblClick={onViewportDoubleClick}
      >
        <div ref={(element) => (worldRef = element)} class="canvas-world">
          <div class="canvas-ambient-blob one" />
          <div class="canvas-ambient-blob two" />
          <Index each={state.blocks}>
            {(block) => {
              const item = block()
              return (
                <section
                  class="canvas-card"
                  classList={cardClass(item)}
                  style={cardStyle(item)}
                  data-card-id={item.id}
                  onPointerDown={() => onCardPointerDown(item)}
                >
                  <div class="canvas-card-header" onPointerDown={(event) => onHeaderPointerDown(event, item)}>
                    <div class="canvas-card-icon">{moduleOf(item).icon()}</div>
                    <div class="canvas-card-title-wrap">
                      <h2 class="canvas-card-title">{moduleOf(item).title}</h2>
                      <div class="canvas-card-subtitle">{moduleOf(item).subtitle}</div>
                    </div>
                    <div class="canvas-header-actions">
                      <Show when={item.type === "legacy"}>
                        <span class="canvas-icon-button" aria-label="Pinned" title="Pinned — cannot be removed">
                          {iconPin()}
                        </span>
                      </Show>
                      <Show when={item.type !== "legacy"}>
                        <button
                          type="button"
                          class="canvas-icon-button"
                          aria-label={item.collapsed ? "Expand" : "Collapse"}
                          onClick={() => toggleCollapse(item)}
                        >
                          {iconCollapse()}
                        </button>
                        <button
                          type="button"
                          class="canvas-icon-button"
                          aria-label="Remove block"
                          onClick={() => removeBlock(item.id)}
                        >
                          {iconClose()}
                        </button>
                      </Show>
                    </div>
                  </div>
                  <div class="canvas-card-body">
                    <Show when={item.type === "legacy"}>
                      <div class="canvas-legacy-body">{props.children}</div>
                    </Show>
                    <Show when={item.type === "chat"}>
                      <ChatBody block={item} setState={setState} />
                    </Show>
                    <Show when={item.type === "context"}>
                      <ContextBody />
                    </Show>
                    <Show when={item.type === "tools"}>
                      <ToolsBody />
                    </Show>
                    <Show when={item.type === "files"}>
                      <FilesBody />
                    </Show>
                    <Show when={item.type === "notes"}>
                      <NotesBody block={item} setState={setState} />
                    </Show>
                    <Show when={item.type === "voice"}>
                      <VoiceBody block={item} setState={setState} />
                    </Show>
                    <Show when={item.type === "chatgpt-router"}>
                      <ChatGPTRouterBody block={item} setState={setState} />
                    </Show>
                    <Show when={item.type === "operating-chat"}>
                      <OperatingChatBody block={item} setState={setState} />
                    </Show>
                  </div>
                  <Show when={state.editing}>
                    <div
                      class="canvas-resize-handle"
                      aria-hidden="true"
                      onPointerDown={(event) => onResizePointerDown(event, item)}
                    />
                  </Show>
                </section>
              )
            }}
          </Index>
        </div>
      </div>

      <header class="canvas-toolbar" aria-label="Canvas toolbar">
        <div class="canvas-brand" aria-label="Agent Canvas">
          <div class="canvas-brand-mark" aria-hidden="true" />
          <div class="canvas-brand-copy">
            <div class="canvas-brand-name">Agent Canvas</div>
            <div class="canvas-brand-tag">A quieter place to think</div>
          </div>
        </div>
        <div class="canvas-toolbar-group">
          <button type="button" class="canvas-toolbar-button" title="Tidy the board" onClick={tidyBlocks}>
            {iconTools()}
            <span class="label">Tidy</span>
          </button>
          <button type="button" class="canvas-toolbar-button" title="Reset view" onClick={resetView}>
            {iconSpin()}
          </button>
          <button
            type="button"
            class="canvas-toolbar-button"
            classList={{ active: state.editing }}
            title={state.editing ? "Leave editing mode" : "Enter editing mode"}
            onClick={() => setState("editing", (value) => !value)}
          >
            {iconContext()}
            <span class="label">Edit</span>
          </button>
          <button type="button" class="canvas-toolbar-button" title="Toggle color theme" onClick={toggleTheme}>
            {iconFiles()}
          </button>
          <Show when={import.meta.env.DEV}>
            <button
              type="button"
              class="canvas-toolbar-button dev"
              classList={{ active: statsVisible() }}
              title="Toggle dev stats"
              aria-pressed={statsVisible()}
              onClick={() => setStatsVisible((value) => !value)}
            >
              <span class="label">DEV</span>
            </button>
          </Show>
        </div>
        <div class="canvas-toolbar-divider" aria-hidden="true" />
        <div id="opencode-titlebar-center" class="canvas-toolbar-center" />
        <div id="opencode-titlebar-right" class="canvas-toolbar-right" />
      </header>

      <Show when={state.editing}>
        <div class="canvas-block-bar-wrap">
          <Show when={paletteOpen()}>
            <div class="canvas-block-palette" role="listbox" aria-label="Select a block">
              <For each={Object.keys(MODULES) as CanvasBlockType[]}>
                {(type) => (
                  <button
                    type="button"
                    class="canvas-palette-item"
                    classList={{ active: selectedType() === type }}
                    style={{ "--button-accent": MODULES[type].accent }}
                    role="option"
                    aria-selected={selectedType() === type}
                    title={MODULES[type].title}
                    onClick={() => {
                      setSelectedType(type)
                      setPaletteOpen(false)
                    }}
                  >
                    <span class="canvas-palette-icon">{MODULES[type].icon()}</span>
                    <span class="canvas-palette-label">{MODULES[type].title}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <nav class="canvas-block-bar" aria-label="Block bar">
            <button
              type="button"
              class="canvas-block-bar-button"
              classList={{ active: paletteOpen() }}
              data-tip="Blocks"
              aria-expanded={paletteOpen()}
              aria-haspopup="listbox"
              title="Select a block"
              onClick={() => setPaletteOpen((value) => !value)}
            >
              {MODULES[selectedType()].icon()}
              <span class="canvas-block-bar-chevron">{iconCollapse()}</span>
            </button>
            <button
              type="button"
              class="canvas-block-bar-button add"
              data-tip="Add block"
              title="Add block"
              onClick={() => addBlock(selectedType())}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </nav>
        </div>
      </Show>

      <Show when={import.meta.env.DEV && statsVisible()}>
        <div class="canvas-stats-overlay" aria-label="Dev stats">
          <DebugBar inline />
        </div>
      </Show>

      <div class="canvas-bottom-left">
        <div class="canvas-status-pill">
          <span class="canvas-status-dot" /> Canvas workspace · saved
        </div>
        <div class="canvas-hint-pill">Pick a block · press + to add · drag empty space to pan</div>
      </div>

      <div class="canvas-bottom-right">
        <div class="canvas-zoom-control" aria-label="Zoom controls">
          <button
            type="button"
            class="canvas-control-button square"
            title="Zoom out"
            onClick={() =>
              setState("camera", (camera) =>
                zoomCamera(camera, camera.scale / 1.12, { x: size().w / 2, y: size().h / 2 }, size()),
              )
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 12h12" />
            </svg>
          </button>
          <div class="canvas-zoom-value">{zoomValue()}</div>
          <button
            type="button"
            class="canvas-control-button square"
            title="Zoom in"
            onClick={() =>
              setState("camera", (camera) =>
                zoomCamera(camera, camera.scale * 1.12, { x: size().w / 2, y: size().h / 2 }, size()),
              )
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 6v12M6 12h12" />
            </svg>
          </button>
        </div>
      </div>

      <div class="canvas-toast" classList={{ show: !!toast() }} role="status" aria-live="polite">
        {toast()}
      </div>
    </div>
  )
}

function ChatBody(props: { block: CanvasBlock; setState: SetStoreFunction<CanvasState> }) {
  const pushMessage = (message: CanvasMessage) =>
    props.setState("blocks", (blocks) =>
      blocks.map((block) =>
        block.id === props.block.id ? { ...block, messages: [...block.messages, message] } : block,
      ),
    )

  return (
    <div class="canvas-chat-layout">
      <div class="canvas-messages">
        <Show when={props.block.messages.length === 0}>
          <div class="canvas-message">
            <div class="canvas-avatar">AI</div>
            <div class="canvas-bubble">Ask the workspace anything — replies stay calm and small.</div>
          </div>
        </Show>
        <For each={props.block.messages}>
          {(message) => (
            <div class="canvas-message" classList={{ user: message.role === "user" }}>
              <div class="canvas-avatar">{message.role === "user" ? "YOU" : "AI"}</div>
              <div class="canvas-bubble">{message.text}</div>
            </div>
          )}
        </For>
      </div>
      <form
        class="canvas-composer"
        onSubmit={(event) => {
          event.preventDefault()
          const form = event.currentTarget
          const textarea = form.querySelector("textarea")
          if (!textarea) return
          const value = textarea.value.trim()
          if (!value) return
          pushMessage({ role: "user", text: value })
          textarea.value = ""
          setTimeout(() => {
            pushMessage({
              role: "assistant",
              text: "Got it. I'll keep the next step small, visible, and easy to move around.",
            })
          }, 520)
        }}
      >
        <textarea rows={1} aria-label="Message" placeholder="Ask the workspace…" />
        <button class="canvas-send-button" type="submit" title="Send">
          {iconSend()}
        </button>
      </form>
    </div>
  )
}

function ContextBody() {
  return (
    <div class="canvas-context-content">
      <div class="canvas-section-label">Current direction</div>
      <div class="canvas-chip-row">
        <span class="canvas-chip">
          <span class="canvas-chip-dot" style={{ "--chip-color": "var(--canvas-purple)" }} />
          Canvas-first
        </span>
        <span class="canvas-chip">
          <span class="canvas-chip-dot" style={{ "--chip-color": "var(--canvas-mint)" }} />
          No wires
        </span>
        <span class="canvas-chip">
          <span class="canvas-chip-dot" style={{ "--chip-color": "var(--canvas-pink)" }} />
          Friendly
        </span>
      </div>
      <div class="canvas-section-label">Remember</div>
      <div class="canvas-fact-list">
        <div class="canvas-fact">
          <div class="canvas-fact-number">1</div>
          <div>
            <strong>Everything is a block</strong>
            <span>Chat, files, voice, context, and tools share one visual language.</span>
          </div>
        </div>
        <div class="canvas-fact">
          <div class="canvas-fact-number">2</div>
          <div>
            <strong>Space carries meaning</strong>
            <span>Nearby blocks feel related without drawing explicit connections.</span>
          </div>
        </div>
        <div class="canvas-fact">
          <div class="canvas-fact-number">3</div>
          <div>
            <strong>Motion stays quiet</strong>
            <span>Animate state changes, not decoration.</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolsBody() {
  return (
    <div class="canvas-tool-list">
      <div class="canvas-tool-row">
        <div class="canvas-tool-state" style={{ "--tool-color": "var(--canvas-green)" }}>
          {iconCheck()}
        </div>
        <div>
          <div class="canvas-tool-name">Read project context</div>
          <div class="canvas-tool-detail">12 files indexed</div>
        </div>
        <div class="canvas-tool-time">0.18s</div>
      </div>
      <div class="canvas-tool-row">
        <div class="canvas-tool-state" style={{ "--tool-color": "var(--canvas-green)" }}>
          {iconCheck()}
        </div>
        <div>
          <div class="canvas-tool-name">Search codebase</div>
          <div class="canvas-tool-detail">query: canvas modules</div>
        </div>
        <div class="canvas-tool-time">0.42s</div>
      </div>
      <div class="canvas-tool-row">
        <div class="canvas-tool-state" style={{ "--tool-color": "var(--canvas-blue)" }}>
          {iconSpin()}
        </div>
        <div>
          <div class="canvas-tool-name">Generate interface</div>
          <div class="canvas-tool-detail">streaming preview…</div>
        </div>
        <div class="canvas-tool-time">live</div>
      </div>
      <div class="canvas-tool-row">
        <div class="canvas-tool-state" style={{ "--tool-color": "var(--canvas-yellow)" }}>
          {iconFile()}
        </div>
        <div>
          <div class="canvas-tool-name">Write artifact</div>
          <div class="canvas-tool-detail">agent_canvas_demo.html</div>
        </div>
        <div class="canvas-tool-time">queued</div>
      </div>
    </div>
  )
}

const FILE_ITEMS = [
  { name: "src", folder: true, nested: false, active: false },
  { name: "canvas.tsx", folder: false, nested: true, active: true },
  { name: "module-card.tsx", folder: false, nested: true, active: false },
  { name: "workspace-store.ts", folder: false, nested: true, active: false },
  { name: "public", folder: true, nested: false, active: false },
  { name: "icons.svg", folder: false, nested: true, active: false },
  { name: "package.json", folder: false, nested: false, active: false },
  { name: "README.md", folder: false, nested: false, active: false },
]

function FilesBody() {
  return (
    <div class="canvas-file-layout">
      <div class="canvas-search-wrap">
        <label class="canvas-search-box">
          {iconSearch()}
          <input
            aria-label="Filter files"
            placeholder="Filter files"
            onInput={(event) => {
              const query = event.currentTarget.value.toLowerCase().trim()
              const tree = event.currentTarget.closest(".canvas-file-layout")?.querySelector(".canvas-file-tree")
              tree?.querySelectorAll("[data-file-name]").forEach((item) => {
                ;(item as HTMLElement).style.display = item
                  .getAttribute("data-file-name")
                  ?.toLowerCase()
                  .includes(query)
                  ? "flex"
                  : "none"
              })
            }}
          />
        </label>
      </div>
      <div class="canvas-file-tree">
        <For each={FILE_ITEMS}>
          {(item) => (
            <div
              class="canvas-file-item"
              classList={{ nested: item.nested, active: item.active }}
              data-file-name={item.name}
            >
              {item.folder ? iconFolder() : iconFile()}
              <span>{item.name}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function NotesBody(props: { block: CanvasBlock; setState: SetStoreFunction<CanvasState> }) {
  return (
    <textarea
      class="canvas-notes-area"
      aria-label="Scratchpad"
      placeholder="Drop a thought here…"
      value={props.block.text}
      onInput={(event) => {
        const value = event.currentTarget.value
        props.setState("blocks", (blocks) =>
          blocks.map((block) => (block.id === props.block.id ? { ...block, text: value } : block)),
        )
      }}
    />
  )
}

function VoiceBody(props: { block: CanvasBlock; setState: SetStoreFunction<CanvasState> }) {
  return (
    <div class="canvas-voice-content">
      <button
        class="canvas-orb"
        classList={{ listening: props.block.listening }}
        type="button"
        aria-label="Toggle listening"
        onClick={() =>
          props.setState("blocks", (blocks) =>
            blocks.map((block) => (block.id === props.block.id ? { ...block, listening: !block.listening } : block)),
          )
        }
      >
        {iconMic()}
      </button>
      <div class="canvas-waveform" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div>
        <div class="canvas-voice-title">{props.block.listening ? "Listening…" : "Tap to speak"}</div>
        <div class="canvas-voice-note">Local voice capture can live here as a modular input surface.</div>
      </div>
    </div>
  )
}

function ChatGPTRouterBody(props: { block: CanvasBlock; setState: SetStoreFunction<CanvasState> }) {
  const patch = (patch: Partial<CanvasBlock>) =>
    props.setState("blocks", (blocks) =>
      blocks.map((block) => (block.id === props.block.id ? { ...block, ...patch } : block)),
    )

  const pushMessage = (message: CanvasMessage) => patch({ messages: [...props.block.messages, message] })

  const initialize = () => {
    patch({ router: "initializing" })
    setTimeout(() => {
      patch({ router: Math.random() < 0.85 ? "ready" : "missing-login" })
    }, 1400)
  }

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    if (props.block.router !== "ready") return
    const target = event.currentTarget
    if (!(target instanceof HTMLFormElement)) return
    const textarea = target.querySelector("textarea")
    if (!textarea) return
    const value = textarea.value.trim()
    if (!value) return
    pushMessage({ role: "user", text: value })
    textarea.value = ""
    setTimeout(() => {
      pushMessage({
        role: "assistant",
        text: "Relayed through the ChatGPTRouter — this reply stands in for the extracted response.",
      })
    }, 900)
  }

  return (
    <div class="canvas-router-layout">
      <Show when={props.block.router === "uninitialized" || props.block.router === "missing-login"}>
        <div class="canvas-router-state" classList={{ "needs-login": props.block.router === "missing-login" }}>
          <div class="canvas-router-state-icon">{iconRouter()}</div>
          <div class="canvas-router-state-title">
            {props.block.router === "missing-login" ? "ChatGPT login unavailable" : "Block needs a ChatGPT login"}
          </div>
          <div class="canvas-router-state-note">
            {props.block.router === "missing-login"
              ? "The login could not be verified. Sign in to chatgpt.com and try again."
              : "This block reroutes to the ChatGPT webpage and cannot route until initialized."}
          </div>
          <button type="button" class="canvas-router-init-button" onClick={initialize}>
            Initialize login
          </button>
        </div>
      </Show>
      <Show when={props.block.router === "initializing"}>
        <div class="canvas-router-state">
          <div class="canvas-router-spinner" aria-hidden="true">
            {iconSpin()}
          </div>
          <div class="canvas-router-state-title">Opening ChatGPT…</div>
          <div class="canvas-router-state-note">Downloading the page and checking the login state.</div>
        </div>
      </Show>
      <Show when={props.block.router === "error"}>
        <div class="canvas-router-state" classList={{ error: true }}>
          <div class="canvas-router-state-icon">{iconClose()}</div>
          <div class="canvas-router-state-title">Router unavailable</div>
          <div class="canvas-router-state-note">The crawl subsystem reported an error. Retry initialization.</div>
          <button type="button" class="canvas-router-init-button" onClick={initialize}>
            Retry
          </button>
        </div>
      </Show>
      <Show when={props.block.router === "ready"}>
        <div class="canvas-router-ready">
          <div class="canvas-router-status">
            <span class="canvas-router-status-dot" />
            Routed · chatgpt.com · session context stored
          </div>
          <div class="canvas-messages">
            <Show when={props.block.messages.length === 0}>
              <div class="canvas-message">
                <div class="canvas-avatar">GPT</div>
                <div class="canvas-bubble">
                  Type a message — it is relayed to the ChatGPT webpage and the reply is extracted.
                </div>
              </div>
            </Show>
            <For each={props.block.messages}>
              {(message) => (
                <div class="canvas-message" classList={{ user: message.role === "user" }}>
                  <div class="canvas-avatar">{message.role === "user" ? "YOU" : "GPT"}</div>
                  <div class="canvas-bubble">{message.text}</div>
                </div>
              )}
            </For>
          </div>
          <form class="canvas-composer" onSubmit={submit}>
            <textarea rows={1} aria-label="Message" placeholder="Relay a message…" />
            <button class="canvas-send-button" type="submit" title="Send">
              {iconSend()}
            </button>
          </form>
        </div>
      </Show>
    </div>
  )
}

export { LEGACY_BLOCK_ID }

function useOperatingAgentKey(): string | undefined {
  try {
    return useWorkspace().operatingAgent()
  } catch {
    return undefined
  }
}

const OPERATING_LAYER_LABELS: Record<OperatingLayer["layer"], string> = {
  workspace: "WorkspaceContext",
  block: "BlockContext",
  operational: "OperationalContext",
  custom: "CustomContext",
}

function OperatingChatBody(props: { block: CanvasBlock; setState: SetStoreFunction<CanvasState> }) {
  const workspaceKey = useOperatingAgentKey()
  const [stackOpen, setStackOpen] = createSignal(true)

  const patch = (patch: Partial<CanvasBlock>) =>
    props.setState("blocks", (blocks) =>
      blocks.map((block) => (block.id === props.block.id ? { ...block, ...patch } : block)),
    )

  const agentKey = () =>
    props.block.agentKey === "inherit" ? (workspaceKey ?? "workspace-default") : props.block.agentKey

  const record = (role: "user" | "assistant", text: string) => {
    const history = appendExchange(props.block.history, { role, text })
    const layers = props.block.layers.map((layer) =>
      layer.layer === "operational" ? { ...layer, text: tail(text) } : layer,
    )
    patch({ history, layers })
  }

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    const target = event.currentTarget
    if (!(target instanceof HTMLFormElement)) return
    const textarea = target.querySelector("textarea")
    if (!textarea) return
    const value = textarea.value.trim()
    if (!value) return
    record("user", value)
    textarea.value = ""
    setTimeout(() => {
      record(
        "assistant",
        "The OperatingAgent answered through the workspace's modded session. This reply is recorded into the HistoricalContextStack.",
      )
    }, 620)
  }

  return (
    <div class="canvas-operating-layout">
      <div class="canvas-operating-status">
        <span class="canvas-operating-status-dot" />
        <span class="canvas-operating-agent">OperatingAgent · {agentKey()}</span>
        <button
          type="button"
          class="canvas-operating-stack-toggle"
          aria-expanded={stackOpen()}
          onClick={() => setStackOpen((value) => !value)}
        >
          context stack {props.block.history.length}/{OPERATING_CONTEXT_LIMIT}
        </button>
      </div>
      <Show when={stackOpen()}>
        <div class="canvas-operating-stack">
          <For each={props.block.layers}>
            {(layer) => (
              <div class="canvas-operating-layer" classList={{ custom: layer.layer === "custom" }}>
                <div class="canvas-operating-layer-label">{OPERATING_LAYER_LABELS[layer.layer]}</div>
                <Show
                  when={layer.layer !== "custom"}
                  fallback={
                    <textarea
                      class="canvas-operating-layer-custom"
                      aria-label="CustomContext"
                      placeholder="Fixed text provided by the user"
                      value={layer.text}
                      onInput={(event) => {
                        const value = event.currentTarget.value
                        patch({
                          layers: props.block.layers.map((item) =>
                            item.layer === "custom" ? { ...item, text: value } : item,
                          ),
                        })
                      }}
                    />
                  }
                >
                  <div class="canvas-operating-layer-text">
                    {layer.text ||
                      (layer.layer === "operational" ? "(decided by the BlockSubsystem's output)" : "(empty)")}
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class="canvas-messages">
        <Show when={props.block.history.length === 0}>
          <div class="canvas-message">
            <div class="canvas-avatar">AGENT</div>
            <div class="canvas-bubble">
              Submissions here are answered by the workspace's OperatingAgent and recorded in the
              HistoricalContextStack.
            </div>
          </div>
        </Show>
        <For each={props.block.history}>
          {(exchange) => (
            <div class="canvas-message" classList={{ user: exchange.role === "user" }}>
              <div class="canvas-avatar">{exchange.role === "user" ? "YOU" : "AGENT"}</div>
              <div class="canvas-bubble">
                <span class="canvas-operating-index">#{exchange.index}</span>
                {exchange.text}
              </div>
            </div>
          )}
        </For>
      </div>
      <form class="canvas-composer" onSubmit={submit}>
        <textarea rows={1} aria-label="Message" placeholder="Submit to the OperatingAgent…" />
        <button class="canvas-send-button" type="submit" title="Send">
          {iconSend()}
        </button>
      </form>
    </div>
  )
}

function tail(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim()
  return compact.length > 140 ? `${compact.slice(0, 137)}…` : compact
}
