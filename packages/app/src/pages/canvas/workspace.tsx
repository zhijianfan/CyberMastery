import { TitlebarSettingsButton } from "@/components/titlebar"
import "./canvas.css"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { makeResizeObserver } from "@solid-primitives/resize-observer"
import { useTheme } from "@opencode-ai/ui/theme/context"
import type { PermissionConfig, WorkspaceBlockRecord, WorkspaceLayoutInfo } from "@opencode-ai/sdk/v2/client"
import { DebugBar } from "@/components/debug-bar"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  onCleanup,
  onMount,
  Show,
  type JSX,
  type ParentProps,
} from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import { Portal } from "solid-js/web"
import { createCanvasManager } from "./manager"
import { MasterAgentBlock } from "./master-agent/block"
import { MASTER_AGENT_FUNCTIONALITY_BY_TYPE, MASTER_AGENT_MODULE } from "./master-agent/functionality"
import type { ModelSelection } from "./master-agent/types"
import { ChatRelayBody, iconClose, iconRelay, iconSpin } from "./blocks/chat-relay"
import { permissionDenied } from "./permissions"
import { BlockRuntimeHost, useBlockRuntimeHandle } from "./runtime/block-runtime-host"
import { useBlockRuntimeServices } from "./runtime/provider"
import { registrationFor } from "./runtime/registrations"
import { tail, type OperatingChatView } from "./runtime/registrations/operating-chat"
import type { CanvasDiagnosticsSource } from "./diagnostics"
import { BLOCK_RUNTIME_V3 } from "./flag"
import { createBlockLocalViewStore } from "./runtime/local-view-store"
import { BlockRuntimeProvider } from "./runtime/provider"
import { CanvasSessionSurfaceProviders } from "./session-surface-providers"
import {
  clampCamera,
  panCameraFree,
  screenToWorld,
  zoomCamera,
  type Camera,
  type Point,
  type Size,
} from "./editor/camera"
import {
  DEFAULT_CELL,
  clampBlockSize,
  clampInitialSquare,
  fitDefaultLayout,
  initialSquareSize,
  moveBlock,
  normalizeZOrder,
  packedPanel,
  resolveOverlap,
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
const VIEW_STORAGE_KEY = "opencode.canvas.frame.v1"

// Block-local view state (C1/C2): notes text, voice listening, operating-chat
// context stack — device-local, isolated from the layout descriptor.
const localViewStore = createBlockLocalViewStore()
const LEGACY_BLOCK_ID = "canvas-legacy"

interface CanvasModelCatalogItem extends ModelSelection {
  key: string
  providerName: string
  modelName: string
}

// Module-level listener registry: Vite HMR re-executes this module without
// disposing the previous instance's window listeners, which stacks them and
// makes every pointermove apply the pan/block delta N times (canvas moves
// faster than the cursor, gets laggy). Register the module dispose hook to
// clean up all tracked listeners on hot reload.
const moduleCleanups = new Set<() => void>()
function trackCleanup(cleanup: () => void) {
  moduleCleanups.add(cleanup)
}
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const cleanup of moduleCleanups) {
      try {
        cleanup()
      } catch {
        /* listener already removed */
      }
    }
    moduleCleanups.clear()
  })
}

const legacyConstraints: GridConstraints = { minW: 320, minH: 200, maxW: null, maxH: null, initialAspect: "free" }
const blockConstraints: GridConstraints = { minW: 248, minH: 124, maxW: null, maxH: null, initialAspect: "square" }
const hydratedLegacyConstraints = { ...legacyConstraints, minW: 0, minH: 0 }
const hydratedBlockConstraints = { ...blockConstraints, minW: 0, minH: 0 }

export type CanvasBlockType =
  | "context"
  | "tools"
  | "files"
  | "notes"
  | "voice"
  | "chat-relay"
  | "operating-chat"
  | "master-agent"

// Server-side functionality IDs (the workspace functionality registry is the
// authority). The legacy block is the spec's default agentic chat window, so
// it owns `builtin:chat`; the demo chat card was removed to avoid the
// collision. Every other block type maps 1:1 to a registered functionality.
// The master-agent mapping comes from the I1 descriptor so the renderer and
// the descriptor can never drift apart.
export const FUNCTIONALITY_BY_TYPE: Record<CanvasBlockType, string> = {
  ...MASTER_AGENT_FUNCTIONALITY_BY_TYPE,
  context: "builtin:context",
  tools: "builtin:tools",
  files: "builtin:files",
  notes: "builtin:notes",
  voice: "builtin:voice",
  "chat-relay": "builtin:chat-relay",
  "operating-chat": "builtin:operating-chat-session",
}

export const TYPE_BY_FUNCTIONALITY: Partial<Record<string, CanvasBlockType>> = Object.fromEntries(
  Object.entries(FUNCTIONALITY_BY_TYPE).map(([type, functionality]) => [functionality, type as CanvasBlockType]),
)

interface CanvasMessage {
  role: "user" | "assistant"
  text: string
  files?: { name: string; url: string }[]
  payloadId?: string
  index?: number
  timeCreated?: number
  important?: boolean
}

interface CanvasBlock {
  id: string
  type: CanvasBlockType | "legacy" | "error"
  functionalityID: string
  x: number
  y: number
  w: number
  h: number
  z: number
  collapsed: boolean
  defaultRect: boolean
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
const iconMic = () => (
  <svg viewBox="0 0 24 24">
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
  </svg>
)

const MODULES: Record<CanvasBlockType, BlockModule> = {
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
  "chat-relay": {
    title: "ChatRelay",
    subtitle: "Relayed to the chat account",
    accent: "var(--canvas-green)",
    w: 380,
    h: 440,
    icon: iconRelay,
  },
  "operating-chat": {
    title: "Operating Chat Session",
    subtitle: "OperatingAgent · context stack",
    accent: "var(--canvas-blue)",
    w: 420,
    h: 460,
    icon: iconOperating,
  },
  // The MasterAgent block owns its chrome (shell, session surface, Coder
  // selector) inside B3's renderer; the canvas only supplies presentation
  // metadata from the I1 descriptor.
  "master-agent": {
    ...MASTER_AGENT_MODULE,
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
  blocks: PersistedCanvasBlock[]
}

const ERROR_MODULE: BlockModule = {
  title: "Unavailable block",
  subtitle: "Functionality is not installed",
  accent: "var(--canvas-pink)",
  w: 320,
  h: 320,
  icon: iconClose,
}

interface PersistedCanvasBlock {
  id: string
  functionalityID: string
  transform: WorkspaceBlockRecord["transform"]
}

interface PersistedViewState {
  camera: Camera
  editing: boolean
}

interface LegacyPersistedCanvasBlock {
  id: string
  type: CanvasBlockType | "legacy"
  x: number
  y: number
  w: number
  h: number
  z: number
}

interface PersistedDiskState {
  blocks: (PersistedCanvasBlock | LegacyPersistedCanvasBlock)[]
  camera?: Camera
  editing?: boolean
}

function defaultCamera(): Camera {
  return { x: 0, y: 0, scale: 1 }
}

function legacyBlock(panel: Size): CanvasBlock {
  const rect = fitDefaultLayout({ w: panel.w, h: panel.h }, legacyConstraints)
  return {
    id: LEGACY_BLOCK_ID,
    type: "legacy",
    functionalityID: "builtin:chat",
    ...rect,
    z: 0,
    collapsed: false,
    defaultRect: true,
  }
}

function blockOf(functionalityID: string, center: Point, z: number, panel: Size): CanvasBlock {
  const type = TYPE_BY_FUNCTIONALITY[functionalityID] ?? "error"
  const module = type === "error" ? ERROR_MODULE : MODULES[type]
  const side = initialSquareSize(Math.max(module.w, module.h), panel, blockConstraints)
  return {
    id: uid(),
    type,
    functionalityID,
    x: Math.round(snap(center.x - side / 2, DEFAULT_CELL)),
    y: Math.round(snap(center.y - side / 2, DEFAULT_CELL)),
    w: side,
    h: side,
    z,
    collapsed: false,
    defaultRect: false,
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

// The camera stored in Solid state is a LIVE store proxy: setState("camera",
// next) shallow-merges into the same object, so any reference captured from
// state.camera keeps reading the latest values. Gesture bases MUST be plain
// frozen snapshots, otherwise each pan move integrates the displacement
// (Cᵢ = Cᵢ₋₁ + Dᵢ) instead of applying it to the gesture-start camera.
function snapshotCamera(camera: Camera): Camera {
  return Object.freeze({ x: camera.x, y: camera.y, scale: camera.scale })
}

// Live drags stay unsnapped so the block follows the cursor 1:1. Grid
// snapping happens once on release, without imposing canvas boundaries.
function moveContinuous(rect: GridRect, delta: { dx: number; dy: number }): GridRect {
  return { ...rect, x: rect.x + delta.dx, y: rect.y + delta.dy }
}

export function CanvasWorkspace(props: ParentProps) {
  const theme = useTheme()
  const [size, setSize] = createSignal<Size>({ w: 0, h: 0 })
  const [zoomValue, setZoomValue] = createSignal("100%")
  const [toast, setToast] = createSignal<string>()
  const [draggingId, setDraggingId] = createSignal<string>()
  const [resizingId, setResizingId] = createSignal<string>()
  const [selectedFunctionalityID, setSelectedFunctionalityID] = createSignal("builtin:notes")
  const [paletteOpen, setPaletteOpen] = createSignal(false)
  const [statsVisible, setStatsVisible] = createSignal(false)
  const layoutCtx = useLayout()
  const isMobile = createMediaQuery("(max-width: 767px)")
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
  let rightPanActive = false
  let applying = false
  // Layout authority identity: the server hands over authority to the last
  // client that pulled the layout tuple. Fresh per mount, so a page reload
  // claims authority again.
  const clientID = crypto.randomUUID()

  const projectDirectory = () => layoutCtx.projects.list()[0]?.worktree
  const providers = useProviders(projectDirectory)
  const modelCatalog = createMemo(() => {
    const connected = new Set(providers.connected().map((provider) => provider.id))
    return [...providers.all()]
      .filter(([providerID]) => connected.has(providerID))
      .flatMap(([providerID, provider]) =>
        Object.entries(provider.models).map(([modelID, model]) => ({
          key: `${providerID}:${modelID}`,
          providerID,
          modelID,
          providerName: provider.name,
          modelName: model.name ?? modelID,
        })),
      )
      .sort((a, b) => a.modelName.localeCompare(b.modelName) || a.providerName.localeCompare(b.providerName))
  })
  const panel = (): Size => ({ w: size().w, h: size().h })

  function readPersistedLayout() {
    let saved: PersistedDiskState | undefined
    let view: PersistedViewState | undefined
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) saved = JSON.parse(raw) as PersistedDiskState
      const rawView = localStorage.getItem(VIEW_STORAGE_KEY)
      if (rawView) view = JSON.parse(rawView) as PersistedViewState
    } catch {
      saved = undefined
    }
    const loadedBlocks = (saved?.blocks ?? [])
      .map((block) => persistedToBlock(block))
      .filter((block): block is CanvasBlock => block !== undefined)
    return {
      camera: view?.camera ?? saved?.camera ?? defaultCamera(),
      editing: view?.editing ?? saved?.editing ?? true,
      blocks: [
        ...loadedBlocks,
        ...(loadedBlocks.some((block) => block.type === "legacy") ? [] : [legacyBlock(panel())]),
      ],
      zCounter: Math.max(10, ...loadedBlocks.map((block) => block.z)) + 1,
    }
  }

  const initialLayout = readPersistedLayout()
  const [state, setState] = createStore<CanvasState>({
    camera: initialLayout.camera,
    editing: initialLayout.editing,
    selectedId: null,
    zCounter: initialLayout.zCounter,
    blocks: initialLayout.blocks,
  })
  if (
    typeof globalThis === "object" &&
    (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__
  ) {
    console.log("workspace-render", state.blocks.length)
  }
  if (
    typeof globalThis === "object" &&
    (globalThis as { __CANVAS_INTEGRATION_STATE__?: typeof state }).__CANVAS_INTEGRATION_STATE__
  ) {
    ;(globalThis as { __CANVAS_INTEGRATION_STATE__?: typeof state }).__CANVAS_INTEGRATION_STATE__ = state
  }

  // The communication manager owns everything backend-authoritative (layout,
  // revision/authority, OperatingAgent model, permission config). The canvas
  // UI itself is standalone: it only renders local state and reports edits.
  const manager = createCanvasManager({
    clientID,
    directory: projectDirectory,
    isMobile,
    getRecords: () => toRecords(state.blocks),
    onServerLayout: (layout) => applyServerLayout(layout),
    hasLocalBlocks: () => state.blocks.some((block) => block.type !== "legacy"),
    notify: showToast,
    onWorkspaceInvalidated: () => showToast("Workspace changed; reconnecting blocks"),
    runtimeHostBindings: BLOCK_RUNTIME_V3,
  })
  const paletteItems = () =>
    (manager.connected()
      ? manager.functionalities()
      : Object.entries(FUNCTIONALITY_BY_TYPE).map(([type, id]) => ({
          id,
          label: MODULES[type as CanvasBlockType].title,
        }))
    )
      .filter((item) => item.id !== "builtin:chat")
      .map((item) => ({
        id: item.id,
        label: item.label,
        module: functionalityModule(item.id),
      }))
  createEffect(() => {
    const items = paletteItems()
    if (items.some((item) => item.id === selectedFunctionalityID())) return
    setSelectedFunctionalityID(items[0]?.id ?? "")
  })
  if (
    typeof globalThis === "object" &&
    (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__
  ) {
    ;(globalThis as { __CANVAS_MANAGER__?: { masterAgent: unknown } }).__CANVAS_MANAGER__ = manager
  }

  // Diagnostics source (L integration action): the dev overlay/console can
  // collect per-block registration mode + workspace state from the live
  // manager and registration table.
  if (typeof globalThis === "object" && import.meta.env.DEV) {
    const source: CanvasDiagnosticsSource = {
      blocks: () => state.blocks.map((block) => ({ id: block.id, type: block.type })),
      functionalityIDFor: (type) =>
        type === "legacy" ? "builtin:chat" : (FUNCTIONALITY_BY_TYPE[type as CanvasBlockType] ?? type),
      registrationModeFor: (_blockID, functionalityID) => {
        if (!BLOCK_RUNTIME_V3) return "none"
        const registration = registrationFor(functionalityID)
        if (!registration) return "none"
        return registration.mode === "native" || registration.mode === "local" ? registration.mode : "none"
      },
      localViewKeysFor: (blockID) => Object.keys(localViewStore.read<Record<string, unknown>>(blockID) ?? {}),
      workspace: {
        id: manager.workspaceID,
        epoch: manager.workspaceEpoch,
        connected: manager.connected,
        dirty: manager.dirty,
      },
    }
    ;(globalThis as { __CANVAS_DIAGNOSTICS_SOURCE__?: CanvasDiagnosticsSource }).__CANVAS_DIAGNOSTICS_SOURCE__ = source
  }
  trackCleanup(() => manager.dispose())

  function persist() {
    const payload: PersistedState = {
      blocks: state.blocks.map((block) => toPersistedBlock(block)),
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      localStorage.setItem(
        VIEW_STORAGE_KEY,
        JSON.stringify({ camera: state.camera, editing: state.editing } satisfies PersistedViewState),
      )
    } catch {
      /* localStorage can be unavailable in private contexts */
    }
  }

  function saveSoon() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      persist()
      void manager.sync()
    }, 160)
  }

  // Camera changes stream in during pan/zoom; localStorage writes are slow,
  // so persist them on a much longer debounce than block edits.
  let cameraSaveTimer: ReturnType<typeof setTimeout> | undefined
  function saveSoonCamera() {
    clearTimeout(cameraSaveTimer)
    cameraSaveTimer = setTimeout(() => persist(), 800)
  }

  function load() {
    let saved: PersistedDiskState | undefined
    let viewState: PersistedViewState | undefined
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) saved = JSON.parse(raw) as PersistedDiskState
      const rawView = localStorage.getItem(VIEW_STORAGE_KEY)
      if (rawView) viewState = JSON.parse(rawView) as PersistedViewState
    } catch {
      saved = undefined
    }
    if (
      typeof globalThis === "object" &&
      (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__
    ) {
      console.log("load::raw", saved)
    }
    setState("camera", viewState?.camera ?? saved?.camera ?? defaultCamera())
    setState("editing", viewState?.editing ?? saved?.editing ?? true)
    const loadedBlocks = (saved?.blocks ?? [])
      .map((block) => persistedToBlock(block))
      .filter((block): block is CanvasBlock => block !== undefined)
    if (
      typeof globalThis === "object" &&
      (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__
    ) {
      console.log("load::count", loadedBlocks.length)
    }
    setState("blocks", [
      ...loadedBlocks,
      ...(loadedBlocks.some((block) => block.type === "legacy") ? [] : [legacyBlock(panel())]),
    ])
    setState("zCounter", Math.max(10, ...loadedBlocks.map((block) => block.z)) + 1)
  }

  function showToast(message: string) {
    setToast(message)
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => setToast(undefined), 1700)
  }

  function canEditLayout() {
    if (manager.connected()) return true
    showToast("Canvas is read-only while offline")
    return false
  }

  function select(id: string | null) {
    setState("selectedId", id)
    worldRef?.querySelectorAll(".canvas-card.selected").forEach((element) => element.classList.remove("selected"))
    if (id) worldRef?.querySelector(`[data-card-id="${CSS.escape(id)}"]`)?.classList.add("selected")
  }

  function bringToFront(id: string) {
    select(id)
    if (!state.editing || !manager.connected()) return
    const block = state.blocks.find((item) => item.id === id)
    if (!block || block.type === "legacy") return
    const z = state.zCounter + 1
    setState("zCounter", z)
    const index = state.blocks.findIndex((item) => item.id === id)
    if (index >= 0) setState("blocks", index, "z", z)
    saveSoon()
    manager.noteLocalEdit()
    applyRectDirect(id, { x: block.x, y: block.y, w: block.w, h: block.h, z })
  }

  // Rect updates mutate the block IN PLACE (path-based store writes) so the
  // block's object reference never changes. This keeps the render loop from
  // re-rendering the whole card — critically the legacy card, whose body hosts
  // the entire routed session UI — on every pointermove. The DOM is still
  // updated by the transform-sync effect below.
  function setRect(id: string, rect: GridRect) {
    if (!manager.connected()) return
    const index = state.blocks.findIndex((block) => block.id === id)
    if (index < 0) return
    setState("blocks", index, "x", rect.x)
    setState("blocks", index, "y", rect.y)
    setState("blocks", index, "w", rect.w)
    setState("blocks", index, "h", rect.h)
    if (rect.z !== undefined) setState("blocks", index, "z", rect.z)
    saveSoon()
    manager.noteLocalEdit()
  }

  // The reactive render loop alone has proven unreliable for mid-gesture
  // updates in some environments; apply the rect straight onto the DOM node
  // synchronously inside the pointermove handler so the card always follows
  // the cursor 1:1. The store update above remains the source of truth for
  // persistence and reconciliation.
  function applyRectDirect(id: string, rect: GridRect) {
    const element = worldRef?.querySelector(`[data-card-id="${CSS.escape(id)}"]`)
    if (!(element instanceof HTMLElement)) return
    element.style.left = `${rect.x}px`
    element.style.top = `${rect.y}px`
    element.style.width = `${rect.w}px`
    element.style.height = `${rect.h}px`
    element.style.zIndex = String(rect.z)
  }

  // The store is the single source of truth for transforms; this re-applies
  // every stored rect to the DOM so rendered positions can never drift from
  // the store after programmatic mutations (server pulls, tidy, reset).
  function syncAllBlocksDOM() {
    for (const block of state.blocks) {
      applyRectDirect(block.id, { x: block.x, y: block.y, w: block.w, h: block.h, z: block.z })
    }
  }

  // Removes DOM cards that no longer exist in the store (the render loop may
  // lag behind store mutations).
  function pruneCardDOM() {
    const world = worldRef
    if (!world) return
    const ids = new Set(state.blocks.map((block) => block.id))
    for (const element of world.querySelectorAll<HTMLElement>("[data-card-id]")) {
      const id = element.dataset.cardId
      if (id && !ids.has(id)) element.remove()
    }
  }

  function applyCamera(camera: Camera) {
    setState("camera", clampCamera(camera, size()))
  }

  function resetView() {
    if (!canEditLayout()) return
    applyCamera({ x: 0, y: 0, scale: 1 })
    setState("blocks", (blocks) =>
      blocks.map((block) =>
        block.type === "legacy"
          ? { ...block, ...fitDefaultLayout(panel(), legacyConstraints), defaultRect: true }
          : block,
      ),
    )
    syncAllBlocksDOM()
    saveSoon()
    manager.noteLocalEdit()
    showToast("View reset")
  }

  function addBlock(functionalityID: string, worldPoint?: Point) {
    if (!canEditLayout()) return
    if (!paletteItems().some((item) => item.id === functionalityID)) return
    const type = TYPE_BY_FUNCTIONALITY[functionalityID]
    const module = type ? MODULES[type] : ERROR_MODULE
    const center = worldPoint ?? screenToWorld(state.camera, { x: size().w / 2, y: size().h / 2 })
    const z = state.zCounter + 1
    setState("zCounter", z)
    const created = blockOf(functionalityID, center, z, panel())
    const block = { ...created, ...clampInitialSquare(created, panel(), blockConstraints) }
    setState("blocks", (blocks) => [...blocks, block])
    select(block.id)
    saveSoon()
    manager.noteLocalEdit()
    showToast(`${module.title} added`)
  }

  function removeBlock(id: string) {
    if (!canEditLayout()) return
    const block = state.blocks.find((item) => item.id === id)
    if (!block || block.type === "legacy") return
    setState("blocks", (blocks) => blocks.filter((item) => item.id !== id))
    worldRef?.querySelector(`[data-card-id="${CSS.escape(id)}"]`)?.remove()
    if (state.selectedId === id) select(null)
    saveSoon()
    manager.noteLocalEdit()
    showToast("Block removed")
  }

  function tidyBlocks() {
    if (!canEditLayout()) return
    const area = packedPanel(panel())
    const cursor = { x: area.x, y: area.y, rowHeight: 0 }
    setState("blocks", (blocks) =>
      blocks.map((block) => {
        if (block.type === "legacy") return block
        const width = block.collapsed ? 62 : block.w
        const height = block.collapsed ? 62 : block.h
        if (cursor.x > area.x && cursor.x + width > area.x + area.w) {
          cursor.x = area.x
          cursor.y += cursor.rowHeight + DEFAULT_CELL
          cursor.rowHeight = 0
        }
        const next = clampBlockSize({ ...block, x: cursor.x, y: cursor.y }, blockConstraints)
        cursor.x = next.x + width + DEFAULT_CELL
        cursor.y = next.y
        cursor.rowHeight = Math.max(cursor.rowHeight, height)
        return { ...block, ...next }
      }),
    )
    syncAllBlocksDOM()
    saveSoon()
    manager.noteLocalEdit()
    showToast("Board tidied")
  }

  function setEditingMode(editing: boolean) {
    if (!canEditLayout()) return
    if (editing) {
      setState("editing", editing)
      persist()
      return
    }
    const ordered = [...state.blocks].sort((a, b) => a.z - b.z)
    const settled = normalizeZOrder(
      resolveOverlap(
        ordered.map((block) =>
          clampBlockSize(block, block.type === "legacy" ? legacyConstraints : blockConstraints),
        ),
      ),
    )
    const byID = new Map(ordered.map((block, index) => [block.id, settled[index]]))
    setState("blocks", (blocks) => blocks.map((block) => ({ ...block, ...(byID.get(block.id) ?? {}) })))
    setState("zCounter", settled.length + 1)
    setState("editing", false)
    syncAllBlocksDOM()
    saveSoon()
    manager.noteLocalEdit()
  }

  function toggleTheme() {
    theme.setColorScheme(theme.mode() === "dark" ? "light" : "dark")
  }

  function toRecords(blocks: readonly CanvasBlock[]): WorkspaceBlockRecord[] {
    return blocks.map((block) => ({
      id: block.id,
      functionality: block.functionalityID,
      transform: {
        x: Math.round(block.x),
        y: Math.round(block.y),
        w: Math.round(block.w),
        h: Math.round(block.h),
        z: block.z,
      },
    }))
  }

  function toPersistedBlock(block: CanvasBlock): PersistedCanvasBlock {
    return {
      id: block.id,
      functionalityID: block.functionalityID,
      transform: { x: block.x, y: block.y, w: block.w, h: block.h, z: block.z },
    }
  }

  function persistedToBlock(block: PersistedCanvasBlock | LegacyPersistedCanvasBlock): CanvasBlock | undefined {
    if (!("functionalityID" in block)) {
      const functionalityID = block.type === "legacy" ? "builtin:chat" : FUNCTIONALITY_BY_TYPE[block.type]
      if (!functionalityID) return
      return recordToBlock({
        id: block.id,
        functionality: functionalityID,
        transform: { x: block.x, y: block.y, w: block.w, h: block.h, z: block.z },
      })
    }
    return recordToBlock({ id: block.id, functionality: block.functionalityID, transform: block.transform })
  }

  function recordToBlock(record: WorkspaceBlockRecord, hostAuthoritative = false): CanvasBlock {
    const enabled =
      !hostAuthoritative || manager.functionalities().some((functionality) => functionality.id === record.functionality)
    if (enabled && record.functionality === "builtin:chat") {
      // The canonical pristine 4x4 server default means "fill the panel";
      // every other transform is a deliberate chat resize and stays intact.
      const pristine = record.transform.w === 4 && record.transform.h === 4
      if (pristine) return legacyBlock(panel())
      return {
        ...legacyBlock(panel()),
        x: record.transform.x,
        y: record.transform.y,
        w: record.transform.w,
        h: record.transform.h,
        z: 0,
        defaultRect: false,
      }
    }
    const type = enabled ? TYPE_BY_FUNCTIONALITY[record.functionality] : undefined
    const transform = clampBlockSize(record.transform, hydratedBlockConstraints)
    return {
      id: record.id,
      type: type ?? "error",
      functionalityID: record.functionality,
      ...transform,
      collapsed: localViewStore.read<{ collapsed?: boolean }>(`${record.id}:frame`)?.collapsed ?? false,
      defaultRect: false,
    }
  }

  // Server-authoritative hydration: replaces the client block set with the
  // layout the server resolves for our tuple. Camera/editing stay local.
  function applyServerLayout(layout: WorkspaceLayoutInfo) {
    if (
      typeof globalThis === "object" &&
      (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__
    ) {
      console.log("applyServerLayout", layout.blocks.length, "records", layout.blocks)
    }
    applying = true
    const existingByID = new Map(state.blocks.map((block) => [block.id, block]))
    const blocks: CanvasBlock[] = []
    for (const record of layout.blocks) {
      const block = recordToBlock(record, true)
      if (!block) continue
      const existing = existingByID.get(block.id)
      // Descriptor-only merge: layout replacement touches identity + transform
      // (and collapsed view-state). Runtime and local view state live outside
      // the descriptor (C1).
      blocks.push({ ...block, collapsed: existing?.collapsed ?? block.collapsed })
    }
    const legacy = blocks.find((block) => block.type === "legacy")
    if (!legacy) blocks.unshift(legacyBlock(panel()))
    setState("blocks", blocks)
    setState("zCounter", Math.max(10, ...blocks.map((block) => block.z)) + 1)
    select(null)
    applying = false
    syncAllBlocksDOM()
    pruneCardDOM()
    persist()
  }

  let debugBlocks = 0

  createEffect(() => {
    if (
      typeof globalThis === "object" &&
      (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__
    ) {
      console.log("state-length", state.blocks.length)
      console.log("state-blocks-is-array", Array.isArray(state.blocks))
    }
    if (
      typeof globalThis === "object" &&
      (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__
    ) {
      const nextLength = state.blocks.length
      console.log("state-length-change", debugBlocks, "->", nextLength)
      debugBlocks = nextLength
    }
    const bounds = panel()
    if (bounds.w <= 0 || bounds.h <= 0) return
    const blocks = state.blocks.map((block) => {
      const rect =
        block.type === "legacy" && block.defaultRect
          ? fitDefaultLayout(bounds, legacyConstraints)
          : clampBlockSize(block, block.type === "legacy" ? hydratedLegacyConstraints : hydratedBlockConstraints)
      if (block.x === rect.x && block.y === rect.y && block.w === rect.w && block.h === rect.h) return block
      return { ...block, ...rect }
    })
    if (blocks.every((block, index) => block === state.blocks[index])) return
    setState("blocks", blocks)
  })

  // Applies the camera verbatim. Zoom paths clamp before writing state, and
  // panning must never be re-clamped here — re-clamping (centering the world
  // at low zoom, freezing at edges) made the rendered canvas drift from the
  // cursor even though the store tracked the pan correctly.
  createEffect(() => {
    const camera = state.camera
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
    saveSoonCamera()
  })

  // Transforms are owned by this effect: every store change re-applies each
  // block's rect to its DOM node. This runs after the render flush (so newly
  // added cards exist) and is the ONLY writer of left/top/width/height, which
  // keeps rendered positions consistent with the store after clicks, drags,
  // snaps, server pulls, tidy, and reset. Mutations report edits explicitly
  // (saveSoon + manager.noteLocalEdit) so this effect stays pure.
  createEffect(() => {
    state.blocks
    syncAllBlocksDOM()
  })

  onMount(() => {
    if (
      typeof globalThis === "object" &&
      (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__
    ) {
      console.log("onMount")
    }
    load()
    const resize = makeResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    resize.observe(viewportRef!)
    trackCleanup(makeEventListener(window, "pagehide", () => persist()))
    trackCleanup(makeEventListener(window, "blur", () => resetPointerState()))
    manager.start()
  })

  onCleanup(() => {
    clearTimeout(saveTimer)
    clearTimeout(cameraSaveTimer)
    clearTimeout(toastTimer)
    manager.dispose()
  })

  const onViewportPointerDown = (event: PointerEvent) => {
    if (event.button > 2) return
    if (interaction) return
    const target = event.target as HTMLElement
    if (
      target.closest(
        ".canvas-toolbar, .canvas-block-bar-wrap, .canvas-stats-overlay, .canvas-bottom-left, .canvas-bottom-right",
      )
    )
      return
    // Right-drag pans the canvas everywhere — including over cards — without
    // triggering the browser context menu (suppressed at the canvas root).
    if (target.closest(".canvas-card") && event.button !== 2) return
    event.preventDefault()
    rightPanActive = event.button === 2
    select(null)
    viewportRef?.classList.add("is-panning")
    viewportRef?.setPointerCapture(event.pointerId)
    panPointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (panPointers.size === 1) {
      const baseCamera = snapshotCamera(state.camera)
      panSession = {
        start: { x: event.clientX, y: event.clientY },
        camera: baseCamera,
        moved: false,
        startTime: performance.now(),
      }
      panSamples = []
      recordPanSample(baseCamera)
      return
    }
    if (panPointers.size === 2) {
      const [a, b] = [...panPointers.values()]
      const baseCamera = snapshotCamera(state.camera)
      pinch = { camera: baseCamera, scale: baseCamera.scale, distance: Math.max(pointerDistance(a, b), 1) }
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
    addBlock("builtin:notes", { x: point.x - MODULES.notes.w / 2, y: point.y - 50 })
  }

  function onViewportTap(point: Point) {
    const now = performance.now()
    const previous = lastTap
    lastTap = undefined
    if (!state.editing) return
    if (previous && now - previous.time < 420 && pointerDistance(point, previous.point) < 44) {
      ignoreDblClickUntil = performance.now() + 600
      const world = screenToWorld(state.camera, point)
      addBlock("builtin:notes", { x: world.x - MODULES.notes.w / 2, y: world.y - 50 })
      return
    }
    lastTap = { time: now, point }
  }

  // The card's rendered closure can hold a stale block object when the render
  // loop is behind; always take the drag-start rect from the live store.
  function liveRect(block: CanvasBlock): GridRect {
    const current = state.blocks.find((item) => item.id === block.id)
    return current
      ? { x: current.x, y: current.y, w: current.w, h: current.h, z: current.z }
      : { x: block.x, y: block.y, w: block.w, h: block.h, z: block.z }
  }

  // A click anywhere on a card behaves like the header interaction: it selects
  // the block and — in editing mode — starts the same drag-to-move gesture.
  // Interactive content (buttons, inputs, editable text) and the legacy block
  // (which hosts the live opencode UI) are excluded from body drags.
  const onCardPointerDown = (event: PointerEvent, block: CanvasBlock) => {
    bringToFront(block.id)
    if (event.button !== 0 || !state.editing || block.type === "legacy") return
    if (!canEditLayout()) return
    if (interaction || panPointers.size > 0) return
    const target = event.target as HTMLElement
    if (
      target.closest(
        "button, input, textarea, select, a, [contenteditable=''], [contenteditable='true'], .canvas-resize-handle, .canvas-session-surface",
      )
    )
      return
    event.preventDefault()
    event.stopPropagation()
    const card = event.currentTarget as HTMLElement
    card.setPointerCapture(event.pointerId)
    setDraggingId(block.id)
    interaction = {
      type: "move",
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      rect: liveRect(block),
      blockId: block.id,
      legacy: false,
    }
  }

  const onHeaderPointerDown = (event: PointerEvent, block: CanvasBlock) => {
    if (event.button !== 0 || !state.editing) return
    if (!canEditLayout()) return
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
      rect: liveRect(block),
      blockId: block.id,
      legacy: block.type === "legacy",
    }
  }

  const onResizePointerDown = (event: PointerEvent, block: CanvasBlock) => {
    if (event.button !== 0 || !state.editing) return
    if (!canEditLayout()) return
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
      rect: liveRect(block),
      blockId: block.id,
      legacy: block.type === "legacy",
    }
  }

  function endInteraction() {
    if (!interaction) return
    if (!manager.connected()) {
      resetPointerState()
      canEditLayout()
      return
    }
    setDraggingId(undefined)
    setResizingId(undefined)
    const index = state.blocks.findIndex((block) => block.id === interaction!.blockId)
    if (index >= 0) {
      const block = state.blocks[index]
      const constraints = interaction.legacy ? legacyConstraints : blockConstraints
      const settled = clampBlockSize(
        {
          x: snap(block.x, DEFAULT_CELL),
          y: snap(block.y, DEFAULT_CELL),
          w: snap(block.w, DEFAULT_CELL),
          h: snap(block.h, DEFAULT_CELL),
          z: block.z,
        },
        constraints,
      )
      setState("blocks", index, { ...block, ...settled })
      applyRectDirect(interaction.blockId, settled)
      saveSoon()
      manager.noteLocalEdit()
    }
    if (interaction.legacy) {
      const index = state.blocks.findIndex((block) => block.id === LEGACY_BLOCK_ID)
      if (index >= 0) setState("blocks", index, "defaultRect", false)
    }
    interaction = undefined
  }

  // Pan writes the camera directly per pointermove event — the browser
  // already throttles pointermove to its frame cadence, and any extra
  // coalescing layer adds a timing dependency that can lag behind the mouse
  // on some machines.
  function schedulePanUpdate(camera: Camera) {
    setState("camera", camera)
    recordPanSample(camera)
  }

  // DEV-only movement capture: samples are collected ONLY while a pan
  // gesture is active and uploaded to the dev server, which appends them to
  // the project's .test-data/canvas-pan-debug.jsonl for offline analysis.
  interface PanSample {
    t: number
    px: number
    py: number
    cx: number
    cy: number
    scale: number
    startX: number
    startY: number
    startCx: number
    startCy: number
    startScale: number
  }

  let panSamples: PanSample[] = []

  function recordPanSample(camera: Camera) {
    if (!import.meta.env.DEV) return
    const session = panSession
    if (!session) return
    const pointer = [...panPointers.values()].at(-1)
    if (!pointer) return
    if (panSamples.length >= 2000) return
    panSamples.push({
      t: Math.round(performance.now()),
      px: Math.round(pointer.x),
      py: Math.round(pointer.y),
      cx: Math.round(camera.x),
      cy: Math.round(camera.y),
      scale: camera.scale,
      startX: Math.round(session.start.x),
      startY: Math.round(session.start.y),
      startCx: Math.round(session.camera.x),
      startCy: Math.round(session.camera.y),
      startScale: session.camera.scale,
    })
  }

  function uploadPanSamples() {
    if (!import.meta.env.DEV || panSamples.length === 0) return
    const batch = panSamples
    panSamples = []
    const env = {
      screenW: window.screen.width,
      screenH: window.screen.height,
      dpr: window.devicePixelRatio,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      visualViewportScale: window.visualViewport?.scale ?? 1,
      platform: navigator.platform,
      userAgent: navigator.userAgent.slice(0, 240),
      pointerType: "mouse",
    }
    void fetch("/__canvas-pan-debug", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: crypto.randomUUID(), env, samples: batch }),
    }).catch(() => {
      /* dev-only diagnostics; never block the UI on upload failures */
    })
  }

  // Resets every in-flight pointer gesture (stale entries otherwise turn the
  // next drag into an accidental two-finger pinch = wrong pan amount).
  function resetPointerState() {
    uploadPanSamples()
    interaction = undefined
    pinch = undefined
    panSession = undefined
    panPointers.clear()
    rightPanActive = false
    setDraggingId(undefined)
    setResizingId(undefined)
    viewportRef?.classList.remove("is-panning")
  }

  // Pointer handlers are bound to the VIEWPORT ELEMENT (in onMount), not
  // window: pointer capture retargets events to the capture element, which
  // always bubbles through the viewport. Element-bound listeners die with
  // their DOM node, so hot reloads can never stack them — eliminating the
  // pan-moves-N-times-faster-than-the-cursor failure mode by construction.
  const onPointerMove = (event: PointerEvent) => {
    if (interaction) {
      if (!manager.connected()) {
        resetPointerState()
        canEditLayout()
        return
      }
      if (interaction.pointerId !== event.pointerId) return
      const dx = event.clientX - interaction.start.x
      const dy = event.clientY - interaction.start.y
      const delta = { dx: dx / state.camera.scale, dy: dy / state.camera.scale }
      if (interaction.type === "move") {
        const next = moveContinuous(interaction.rect, delta)
        setRect(interaction.blockId, next)
        applyRectDirect(interaction.blockId, next)
        return
      }
      const constraints = interaction.legacy ? legacyConstraints : blockConstraints
      const nextSize = resizeBlock(interaction.rect, delta, "se", constraints)
      setRect(interaction.blockId, nextSize)
      applyRectDirect(interaction.blockId, nextSize)
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
    schedulePanUpdate(
      panCameraFree(panSession.camera, {
        x: event.clientX - panSession.start.x,
        y: event.clientY - panSession.start.y,
      }),
    )
  }

  const onPointerUp = (event: PointerEvent) => {
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
    rightPanActive = false
    if (panPointers.size === 0) {
      uploadPanSamples()
      viewportRef?.classList.remove("is-panning")
      pinch = undefined
      panSession = undefined
    } else if (panPointers.size === 1 && pinch) {
      const [, point] = [...panPointers.entries()][0]
      panSession = { start: point, camera: snapshotCamera(state.camera), moved: true, startTime: performance.now() }
      pinch = undefined
    }
    if (wasTap) onViewportTap(tapPoint)
  }

  const onPointerCancel = (event: PointerEvent) => {
    if (interaction && interaction.pointerId === event.pointerId) endInteraction()
    if (!panPointers.has(event.pointerId)) return
    panPointers.delete(event.pointerId)
    rightPanActive = false
    if (panPointers.size === 0) {
      uploadPanSamples()
      viewportRef?.classList.remove("is-panning")
      pinch = undefined
      panSession = undefined
    } else if (panPointers.size === 1 && pinch) {
      const [, point] = [...panPointers.entries()][0]
      panSession = { start: point, camera: snapshotCamera(state.camera), moved: true, startTime: performance.now() }
      pinch = undefined
    }
  }

  const onLostPointerCapture = (event: PointerEvent) => {
    if (interaction && interaction.pointerId === event.pointerId) endInteraction()
  }

  function onWheel(event: WheelEvent) {
    const target = event.target as HTMLElement
    // Mouse-wheel scroll stays available inside scrollable card content
    // (session UI, message lists, file tree, palette, textareas, embedded
    // session surfaces); anywhere else the wheel zooms the canvas in/out
    // towards the cursor.
    const scrollable = target.closest(
      ".canvas-legacy-body, .canvas-messages, .canvas-file-tree, .canvas-model-picker-list, .canvas-block-palette, .canvas-session-surface, .master-agent-body, textarea",
    )
    if (scrollable && !event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const viewport = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const sensitivity = event.ctrlKey || event.metaKey ? 0.006 : 0.0017
    const factor = Math.exp(-event.deltaY * sensitivity)
    setState("camera", (camera) =>
      zoomCamera(
        camera,
        camera.scale * factor,
        { x: event.clientX, y: event.clientY },
        size(),
        { x: viewport.left, y: viewport.top },
      ),
    )
  }

  trackCleanup(
    makeEventListener(window, "keydown", (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (event.key === "Escape") select(null)
      if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId) {
        removeBlock(state.selectedId)
      }
      if (event.key === "0") resetView()
      if (event.key.toLowerCase() === "n" && state.editing) addBlock("builtin:notes")
      if (
        state.editing &&
        state.selectedId &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        const block = state.blocks.find((item) => item.id === state.selectedId)
        if (block && canEditLayout()) {
          event.preventDefault()
          const horizontal = event.key === "ArrowLeft" ? -DEFAULT_CELL : event.key === "ArrowRight" ? DEFAULT_CELL : 0
          const vertical = event.key === "ArrowUp" ? -DEFAULT_CELL : event.key === "ArrowDown" ? DEFAULT_CELL : 0
          const rect = { x: block.x, y: block.y, w: block.w, h: block.h, z: block.z }
          const constraints = block.type === "legacy" ? legacyConstraints : blockConstraints
          const next = event.shiftKey
            ? resizeBlock(rect, { dx: horizontal, dy: vertical }, "se", constraints)
            : moveBlock(rect, { dx: horizontal, dy: vertical }, panel())
          setRect(block.id, next)
          applyRectDirect(block.id, next)
        }
      }
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
    }),
  )

  function cardStyle(block: CanvasBlock) {
    const accent = moduleOf(block).accent
    // Transforms are NOT rendered here: the render loop has proven to lag
    // behind the store in some environments, so position/rect ownership lives
    // in the DOM-sync effect (createEffect below). This only sets the accent.
    return {
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
    if (block.type === "legacy") return LEGACY_MODULE
    if (block.type === "error") return ERROR_MODULE
    return MODULES[block.type]
  }

  function functionalityModule(functionalityID: string) {
    const type = TYPE_BY_FUNCTIONALITY[functionalityID]
    return type ? MODULES[type] : ERROR_MODULE
  }

  function toggleCollapse(block: CanvasBlock) {
    if (block.type === "legacy") return
    const collapsed = !block.collapsed
    setState("blocks", (blocks) => blocks.map((item) => (item.id === block.id ? { ...item, collapsed } : item)))
    localViewStore.write(`${block.id}:frame`, { collapsed })
  }

  const awaitDescriptorPersisted = (blockID: string, signal: AbortSignal) =>
    manager.awaitDescriptorPersisted(blockID, signal)

  return (
    <BlockRuntimeProvider
      workspaceID={manager.workspaceID}
      workspaceEpoch={manager.workspaceEpoch}
      connected={manager.connected}
      awaitDescriptorPersisted={awaitDescriptorPersisted}
      localView={localViewStore}
    >
      <div
        class="canvas-app"
        onContextMenu={(event) => {
          if (!isTypingTarget(event.target)) event.preventDefault()
        }}
      >
        <div
          ref={(element) => (viewportRef = element)}
          class="canvas-viewport"
          classList={{ "canvas-editing": state.editing }}
          onPointerDown={onViewportPointerDown}
          onDblClick={onViewportDoubleClick}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onLostPointerCapture={onLostPointerCapture}
          onWheel={onWheel}
        >
          <div ref={(element) => (worldRef = element)} class="canvas-world">
            <div class="canvas-ambient-blob one" />
            <div class="canvas-ambient-blob two" />
            <Index each={state.blocks}>
              {(block) => {
                const item = block()
                if (
                  typeof globalThis === "object" &&
                  (globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__
                ) {
                  console.log("render::block", item.id, item.type)
                  if (item.type === "legacy") console.error("branch legacy", item.id)
                  if (item.type === "master-agent") console.error("branch master-agent", item.id)
                }
                return (
                  <section
                    class="canvas-card"
                    classList={cardClass(item)}
                    style={cardStyle(item)}
                    data-card-id={item.id}
                    role="group"
                    aria-label={`${moduleOf(item).title} block`}
                    tabIndex={0}
                    onFocus={() => select(item.id)}
                    onPointerDown={(event) => onCardPointerDown(event, item)}
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
                      <BlockRuntimeHost
                        blockID={item.id}
                        functionalityID={item.functionalityID}
                        transform={{ x: item.x, y: item.y, w: item.w, h: item.h, z: item.z }}
                        registration={BLOCK_RUNTIME_V3 ? registrationFor(item.functionalityID) : undefined}
                        workspaceID={manager.workspaceID() ?? undefined}
                        workspaceEpoch={manager.workspaceEpoch()}
                      >
                        <Show when={item.type === "legacy"}>
                          <div class="canvas-legacy-body">{props.children}</div>
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
                        <Show when={item.type === "chat-relay"}>
                          <ChatRelayBody
                            block={item}
                            permissions={manager.configPermission()}
                            workspaceID={manager.workspaceID() ?? ""}
                            focused={state.selectedId === item.id}
                            onFocus={() => bringToFront(item.id)}
                          />
                        </Show>
                        <Show when={item.type === "operating-chat"}>
                          <OperatingChatBody
                            block={item}
                            setState={setState}
                            permissions={manager.configPermission()}
                            agentKey={manager.operatingAgentKey()}
                          />
                        </Show>
                        <Show when={item.type === "master-agent"}>
                          {/* B3's block renderer reads binding and actions through
                          manager.masterAgent; the canvas passes block identity,
                          focus state, the manager, the shared model catalog,
                          and its own focus/selection callback. Session IDs and
                          binding revisions never enter canvas state or layout. */}
                          <MasterAgentBlock
                            blockID={item.id}
                            focused={state.selectedId === item.id}
                            manager={manager.masterAgent}
                            models={modelCatalog()}
                            onFocus={() => bringToFront(item.id)}
                          />
                        </Show>
                        <Show when={item.type === "error"}>
                          <div class="canvas-relay-state error" role="alert">
                            <div class="canvas-relay-state-icon" aria-hidden="true">
                              {iconClose()}
                            </div>
                            <div class="canvas-relay-state-title">Unavailable block</div>
                            <div class="canvas-relay-state-note">
                              {item.functionalityID} is unavailable in this client or no longer enabled for this
                              workspace.
                            </div>
                          </div>
                        </Show>
                      </BlockRuntimeHost>
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
          <details
            class="canvas-workspace-menu"
            onFocusOut={(event) => {
              if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
              event.currentTarget.removeAttribute("open")
            }}
          >
            <summary class="canvas-workspace-trigger" aria-label="Switch or edit workspace">
              <span class="canvas-workspace-mark" aria-hidden="true" />
              <span class="canvas-workspace-trigger-copy">
                <span class="canvas-workspace-kicker">Workspace</span>
                <span class="canvas-workspace-current">
                  {manager.workspaces().find((workspace) => workspace.id === manager.workspaceID())?.name ?? "Loading"}
                </span>
              </span>
              <span class="canvas-workspace-chevron" aria-hidden="true">
                &#8964;
              </span>
            </summary>
            <div class="canvas-workspace-popover">
              <div class="canvas-workspace-popover-title">
                <span>Your workspaces</span>
                <span>{manager.workspaces().length}</span>
              </div>
              <div class="canvas-workspace-list" role="menu" aria-label="Switch workspace">
                <For each={manager.workspaces()}>
                  {(workspace) => (
                    <button
                      type="button"
                      class="canvas-workspace-option"
                      classList={{ active: workspace.id === manager.workspaceID() }}
                      role="menuitem"
                      onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open")
                        void manager.switchWorkspace(workspace.id)
                      }}
                    >
                      <span class="canvas-workspace-option-mark" aria-hidden="true" />
                      <span>{workspace.name}</span>
                      <Show when={workspace.id === manager.workspaceID()}>
                        <span class="canvas-workspace-option-current">Current</span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
              <div class="canvas-workspace-editor">
                <label class="canvas-workspace-form-label" for="canvas-workspace-create">
                  Add workspace
                </label>
                <form
                  class="canvas-workspace-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const name = new FormData(event.currentTarget).get("name")
                    if (typeof name !== "string" || !name.trim()) return
                    void manager.createWorkspace(name)
                    event.currentTarget.reset()
                  }}
                >
                  <input
                    id="canvas-workspace-create"
                    class="canvas-workspace-input"
                    name="name"
                    maxlength={64}
                    placeholder="Workspace name"
                    autocomplete="off"
                    required
                  />
                  <button type="submit" class="canvas-workspace-form-button">
                    Add
                  </button>
                </form>
                <label class="canvas-workspace-form-label" for="canvas-workspace-rename">
                  Edit active workspace
                </label>
                <form
                  class="canvas-workspace-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const name = new FormData(event.currentTarget).get("name")
                    if (typeof name !== "string" || !name.trim()) return
                    void manager.renameWorkspace(name)
                  }}
                >
                  <input
                    id="canvas-workspace-rename"
                    class="canvas-workspace-input"
                    name="name"
                    maxlength={64}
                    value={
                      manager.workspaces().find((workspace) => workspace.id === manager.workspaceID())?.name ?? ""
                    }
                    autocomplete="off"
                    required
                  />
                  <button type="submit" class="canvas-workspace-form-button">
                    Save
                  </button>
                </form>
              </div>
            </div>
          </details>
          <div class="canvas-brand" aria-label="Agent Canvas">
            <div class="canvas-brand-mark" aria-hidden="true" />
            <div class="canvas-brand-copy">
              <div class="canvas-brand-name">Agent Canvas</div>
              <div class="canvas-brand-tag">A quieter place to think</div>
            </div>
          </div>
          <div class="canvas-toolbar-group">
            <div class="canvas-toolbar-picker">
              <DirectoryPicker
                directories={() => manager.directories()}
                onUpdate={(directories) => void manager.updateDirectories(directories)}
              />
            </div>
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
              onClick={() => setEditingMode(!state.editing)}
            >
              {iconContext()}
              <span class="label">Edit</span>
            </button>
            <div class="canvas-toolbar-picker">
              <ModelPicker
                label="Model"
                current={manager.modelKey()}
                models={modelCatalog}
                onSelect={(key) => void manager.selectModel(key)}
                onRefresh={() => providers.refresh()}
              />
            </div>
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
          <TitlebarSettingsButton />
        </header>

        <Show when={state.editing}>
          <div class="canvas-block-bar-wrap">
            <Show when={paletteOpen()}>
              <div class="canvas-block-palette" role="listbox" aria-label="Select a block">
                <For each={paletteItems()}>
                  {(item) => (
                    <button
                      type="button"
                      class="canvas-palette-item"
                      classList={{ active: selectedFunctionalityID() === item.id }}
                      style={{ "--button-accent": item.module.accent }}
                      role="option"
                      aria-selected={selectedFunctionalityID() === item.id}
                      title={item.label}
                      onClick={() => {
                        setSelectedFunctionalityID(item.id)
                        setPaletteOpen(false)
                      }}
                    >
                      <span class="canvas-palette-icon">{item.module.icon()}</span>
                      <span class="canvas-palette-label">{item.label}</span>
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
                {functionalityModule(selectedFunctionalityID()).icon()}
                <span class="canvas-block-bar-chevron">{iconCollapse()}</span>
              </button>
              <button
                type="button"
                class="canvas-block-bar-button add"
                data-tip="Add block"
                title="Add block"
                onClick={() => addBlock(selectedFunctionalityID())}
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
            <span class="canvas-status-dot" classList={{ "is-dirty": manager.dirty() }} />
            Canvas workspace · {manager.connected() ? (manager.dirty() ? "syncing" : "synced") : "local"}
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
    </BlockRuntimeProvider>
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
      value={localViewStore.read<{ text?: string }>(props.block.id)?.text ?? ""}
      onInput={(event) => {
        localViewStore.write(props.block.id, { text: event.currentTarget.value })
      }}
    />
  )
}

function VoiceBody(props: { block: CanvasBlock; setState: SetStoreFunction<CanvasState> }) {
  return (
    <div class="canvas-voice-content">
      <button
        class="canvas-orb"
        classList={{ listening: localViewStore.read<{ listening?: boolean }>(props.block.id)?.listening ?? false }}
        type="button"
        aria-label="Toggle listening"
        onClick={() => {
          const current = localViewStore.read<{ listening?: boolean }>(props.block.id)?.listening ?? false
          localViewStore.write(props.block.id, { listening: !current })
        }}
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
        <div class="canvas-voice-title">
          {localViewStore.read<{ listening?: boolean }>(props.block.id)?.listening ? "Listening…" : "Tap to speak"}
        </div>
        <div class="canvas-voice-note">Local voice capture can live here as a modular input surface.</div>
      </div>
    </div>
  )
}

export { LEGACY_BLOCK_ID }

const OPERATING_LAYER_LABELS: Record<OperatingLayer["layer"], string> = {
  workspace: "WorkspaceContext",
  block: "BlockContext",
  operational: "OperationalContext",
  custom: "CustomContext",
}

// Model picker. Lists the models of the connected providers and reports the
// selected `providerID:modelID` key. The popup is portaled to the body so it
// escapes the toolbar's overflow clipping.
export function createModelRefreshState(onRefresh: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = createSignal(false)
  const [refreshError, setRefreshError] = createSignal(false)
  const refresh = () => {
    if (refreshing()) return Promise.resolve()
    setRefreshError(false)
    setRefreshing(true)
    return onRefresh()
      .then(
        () => undefined,
        () => setRefreshError(true),
      )
      .finally(() => setRefreshing(false))
  }
  return { refreshing, refreshError, refresh }
}

function ModelPicker(props: {
  label: string
  current?: string
  models: () => readonly CanvasModelCatalogItem[]
  onSelect: (key: string) => void
  onRefresh: () => Promise<unknown>
}) {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const refreshState = createModelRefreshState(props.onRefresh)
  const [pop, setPop] = createSignal<{ top: number; left: number }>()
  let rootRef: HTMLDivElement | undefined
  let popRef: HTMLDivElement | undefined
  const items = createMemo(() => {
    const query = search().trim().toLowerCase()
    if (!query) return props.models()
    return props.models().filter((item) =>
      `${item.providerName} ${item.modelName} ${item.providerID} ${item.modelID}`.toLowerCase().includes(query),
    )
  })

  const toggle = () => {
    if (open()) {
      setOpen(false)
      return
    }
    const trigger = rootRef?.querySelector(".canvas-model-picker-trigger")
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    setPop({ top: rect.bottom + 8, left: rect.left })
    setSearch("")
    setOpen(true)
  }

  trackCleanup(
    makeEventListener(window, "pointerdown", (event: PointerEvent) => {
      if (!open()) return
      const target = event.target as HTMLElement
      if (rootRef?.contains(target) || popRef?.contains(target)) return
      setOpen(false)
    }),
  )

  // Close on scrolls OUTSIDE the popup only: the model list itself is
  // scrollable, and its scroll events (including scrollbar drags/clicks)
  // reach this capture-phase listener — closing then made the expanded
  // menu collapse on the first scroll or scrollbar interaction.
  trackCleanup(
    makeEventListener(
      window,
      "scroll",
      (event: Event) => {
        if (!open()) return
        const target = event.target as HTMLElement | null
        if (target && popRef?.contains(target)) return
        setOpen(false)
      },
      { capture: true },
    ),
  )
  return (
    <div class="canvas-model-picker" ref={(element) => (rootRef = element)}>
      <button
        type="button"
        class="canvas-model-picker-trigger"
        classList={{ active: open() }}
        aria-expanded={open()}
        aria-haspopup="listbox"
        title={`Select the ${props.label} model`}
        onClick={toggle}
      >
        <span class="canvas-model-picker-label">{props.label}</span>
        <span class="canvas-model-picker-current">{props.current ?? "default"}</span>
        <span class="canvas-model-picker-chevron">{iconCollapse()}</span>
      </button>
      <Show when={open()}>
        <Portal>
          <div
            class="canvas-model-picker-pop"
            ref={(element) => (popRef = element)}
            style={{ top: `${pop()?.top ?? 0}px`, left: `${pop()?.left ?? 0}px` }}
          >
            <input
              class="canvas-model-picker-search"
              aria-label="Search models"
              placeholder="Search models…"
              value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)}
            />
            <div class="canvas-model-picker-list" role="listbox">
              <For each={items()}>
                {(item) => (
                  <button
                    type="button"
                    class="canvas-model-picker-item"
                    classList={{ active: item.key === props.current }}
                    role="option"
                    aria-selected={item.key === props.current}
                    onClick={() => {
                      setOpen(false)
                      props.onSelect(item.key)
                    }}
                  >
                    <span class="canvas-model-picker-name">{item.modelName}</span>
                    <span class="canvas-model-picker-provider">{item.providerName}</span>
                  </button>
                )}
              </For>
              <Show when={items().length === 0}>
                <div class="canvas-model-picker-empty">No models found</div>
              </Show>
            </div>
            <button
              type="button"
              class="canvas-model-picker-refresh"
              disabled={refreshState.refreshing()}
              onClick={() => void refreshState.refresh()}
            >
              {language.t(refreshState.refreshing() ? "canvas.model.refreshing" : "canvas.model.refresh")}
            </button>
            <Show when={refreshState.refreshError()}>
              <div class="canvas-model-picker-refresh-error" role="alert">
                {language.t("canvas.model.refresh.error")}
              </div>
            </Show>
          </div>
        </Portal>
      </Show>
    </div>
  )
}

// Working-directories picker: lists the workspace's project directories
// (FR-2) and supports adding/removing paths. The first directory is the
// workspace's primary directory (chat blocks bind to it). Updates flow
// through the manager's optimistic server patch; the popup keeps the same
// portal + outside-close semantics as the model picker, including the
// internal-scroll guard so scrolling its own list never collapses it.
function DirectoryPicker(props: {
  directories?: () => string[] | undefined
  onUpdate: (directories: string[]) => void
}) {
  const [open, setOpen] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [pop, setPop] = createSignal<{ top: number; left: number }>()
  let rootRef: HTMLDivElement | undefined
  let popRef: HTMLDivElement | undefined

  const directories = () => props.directories?.() ?? []

  const toggle = () => {
    if (open()) {
      setOpen(false)
      return
    }
    const trigger = rootRef?.querySelector(".canvas-directory-picker-trigger")
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    setPop({ top: rect.bottom + 8, left: rect.left })
    setOpen(true)
  }

  trackCleanup(
    makeEventListener(window, "pointerdown", (event: PointerEvent) => {
      if (!open()) return
      const target = event.target as HTMLElement
      if (rootRef?.contains(target) || popRef?.contains(target)) return
      setOpen(false)
    }),
  )

  trackCleanup(
    makeEventListener(
      window,
      "scroll",
      (event: Event) => {
        if (!open()) return
        const target = event.target as HTMLElement | null
        if (target && popRef?.contains(target)) return
        setOpen(false)
      },
      { capture: true },
    ),
  )

  const add = () => {
    const value = draft().trim()
    if (!value || directories().includes(value)) return
    props.onUpdate([...directories(), value])
    setDraft("")
  }

  return (
    <div class="canvas-directory-picker" ref={(element) => (rootRef = element)}>
      <button
        type="button"
        class="canvas-directory-picker-trigger"
        classList={{ active: open() }}
        aria-expanded={open()}
        aria-haspopup="dialog"
        title="Configure workspace working directories"
        onClick={toggle}
      >
        {iconFolder()}
        <span class="canvas-directory-picker-label">Directories</span>
        <span class="canvas-directory-picker-count">{directories().length}</span>
        <span class="canvas-model-picker-chevron">{iconCollapse()}</span>
      </button>
      <Show when={open()}>
        <Portal>
          <div
            class="canvas-directory-picker-pop"
            ref={(element) => (popRef = element)}
            style={{ top: `${pop()?.top ?? 0}px`, left: `${pop()?.left ?? 0}px` }}
          >
            <div class="canvas-directory-picker-head">Working directories · first is primary</div>
            <div class="canvas-directory-picker-list" role="list">
              <For each={directories()}>
                {(directory, index) => (
                  <div class="canvas-directory-picker-item" role="listitem">
                    <span class="canvas-directory-picker-path" title={directory}>
                      {index() === 0 ? `${directory} · primary` : directory}
                    </span>
                    <button
                      type="button"
                      class="canvas-directory-picker-remove"
                      aria-label={`Remove ${directory}`}
                      title={`Remove ${directory}`}
                      onClick={() => props.onUpdate(directories().filter((_, i) => i !== index()))}
                    >
                      {iconClose()}
                    </button>
                  </div>
                )}
              </For>
              <Show when={directories().length === 0}>
                <div class="canvas-directory-picker-empty">No directories yet</div>
              </Show>
            </div>
            <form
              class="canvas-directory-picker-add"
              onSubmit={(event) => {
                event.preventDefault()
                add()
              }}
            >
              <input
                class="canvas-directory-picker-input"
                aria-label="Add working directory path"
                placeholder="Add a directory path…"
                value={draft()}
                onInput={(event) => setDraft(event.currentTarget.value)}
              />
              <button type="submit" class="canvas-directory-picker-add-button" disabled={!draft().trim()}>
                Add
              </button>
            </form>
          </div>
        </Portal>
      </Show>
    </div>
  )
}

function OperatingChatBody(props: {
  block: CanvasBlock
  setState: SetStoreFunction<CanvasState>
  permissions?: PermissionConfig
  agentKey?: string
}) {
  const [stackOpen, setStackOpen] = createSignal(true)

  // Block-local view state (C1): the context stack lives in the local view
  // store, never in the layout descriptor. When the runtime registration is
  // mounted (BLOCK_RUNTIME_V3), the host handle owns reads/dispatch; the
  // store-direct path below is the legacy fallback.
  const handle = useBlockRuntimeHandle()
  const runtimeView = (): OperatingChatView | undefined => handle?.view() as OperatingChatView | undefined

  const viewLayers = () =>
    runtimeView()?.layers ??
    localViewStore.read<{ layers?: OperatingLayer[] }>(props.block.id)?.layers ??
    defaultOperatingLayers()
  const viewHistory = () =>
    runtimeView()?.history ?? localViewStore.read<{ history?: OperatingExchange[] }>(props.block.id)?.history ?? []

  const agentKey = () => props.agentKey ?? "workspace-default"

  const executionDenied = () => permissionDenied(props.permissions, "task")

  const commit = async (role: "user" | "assistant", text: string) => {
    if (runtimeView()) {
      await handle?.dispatch({ type: "append-exchange", role, text })
      return
    }
    const history = appendExchange(viewHistory(), { role, text })
    const layers = viewLayers().map((layer) => (layer.layer === "operational" ? { ...layer, text: tail(text) } : layer))
    localViewStore.write(props.block.id, { history })
    localViewStore.write(props.block.id, { layers })
  }

  const writeCustomLayer = (value: string) => {
    if (runtimeView()) {
      void handle?.dispatch({ type: "set-custom-layer", text: value })
      return
    }
    localViewStore.write(props.block.id, {
      layers: viewLayers().map((item) => (item.layer === "custom" ? { ...item, text: value } : item)),
    })
  }

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    if (executionDenied()) return
    const target = event.currentTarget
    if (!(target instanceof HTMLFormElement)) return
    const textarea = target.querySelector("textarea")
    if (!textarea) return
    const value = textarea.value.trim()
    if (!value) return
    // Honest local-prototype mode: submissions are recorded as local drafts.
    // OperatingAgent execution is unavailable in this build, so no synthetic
    // assistant reply is generated (Wave 2 gate item).
    void commit("user", value)
    textarea.value = ""
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
          context stack {viewHistory().length}/{OPERATING_CONTEXT_LIMIT}
        </button>
      </div>
      <Show when={stackOpen()}>
        <div class="canvas-operating-stack">
          <For each={viewLayers()}>
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
                        writeCustomLayer(event.currentTarget.value)
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
        <Show when={viewHistory().length === 0}>
          <div class="canvas-message">
            <div class="canvas-avatar">AGENT</div>
            <div class="canvas-bubble">
              Local prototype — OperatingAgent execution is not available in this build. Submissions are recorded as
              local drafts in the HistoricalContextStack.
            </div>
          </div>
        </Show>
        <For each={viewHistory()}>
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
        <Show
          when={!executionDenied()}
          fallback={
            <div class="canvas-operating-denied">
              Permission denied — the project config denies agent execution (task). Edit the project config to allow it.
            </div>
          }
        >
          <textarea rows={1} aria-label="Message" placeholder="Submit to the OperatingAgent…" />
          <button class="canvas-send-button" type="submit" title="Send">
            {iconSend()}
          </button>
        </Show>
      </form>
    </div>
  )
}
