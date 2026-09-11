// Track I2 — Canvas renderer integration tests. These exercise the REAL
// workspace renderer (registration, block rendering, focus handover, fallback
// removal, presentation-only serialization) with the master-agent
// block renderer (B3) and the canvas contexts replaced by test doubles:
//   - "./master-agent/block"        -> recording fake (B3 in-flight)
//   - "@/context/layout"            -> static project
//   - "@/context/server-sdk"        -> controllable workspace stub
//   - "@/hooks/use-providers"       -> controllable connected catalog
//   - "@opencode-ai/ui/theme/context" -> static dark theme
// The manager itself is the REAL createCanvasManager. Tests opt into an online
// workspace when they need to exercise server-backed model state.
//
// Bun resolves solid-js to its server build unless the browser condition is
// applied; DOM tests in this canvas area therefore run with --conditions=browser.
//
// Bun compiles JSX in this package with the classic React.createElement
// factory, so the workspace's internal JSX needs the React global shimmed
// with solid's hyperscript before it is rendered (same pattern as
// coder-selector.browser.test.tsx / session-surface.browser.test.tsx).
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createComponent, createSignal, For } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import { createStore } from "solid-js/store"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next: Record<string, unknown> = { ...(props ?? {}) }
  if (children.length > 0) {
    const value = children.length > 1 ? children : children[0]
    next.children = typeof value === "function" ? value : () => value
  }
  return createComponent(tag as never, next)
}

;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment: "Fragment" }

const STORAGE_KEY = "opencode-canvas-v1"

interface RecordedBlockProps {
  blockID: string
  focused: boolean
  hasManager: boolean
  modelKeys: string[]
}

const blockRenders: RecordedBlockProps[] = []
let refreshResult: Promise<unknown> = Promise.resolve()
let openAIVariants = ["low", "medium", "high"]
let acmeVariants = ["low", "high"]
let colonModelEnabled = false
let onRefreshSuccess: (() => void) | undefined
const [providerCatalogVersion, setProviderCatalogVersion] = createSignal(0)
const refresh = mock(async () => {
  const result = await refreshResult
  onRefreshSuccess?.()
  setProviderCatalogVersion((version) => version + 1)
  return result
})

// B3's block renderer is still in-flight; stand in with a recording fake that
// renders block identity/focus/manager and forwards canvas focus on click.
mock.module("./master-agent/block", () => {
  const MasterAgentBlock = (props: {
    blockID: string
    focused: boolean
    manager: unknown
    onFocus: () => void
    models?: readonly { providerID: string; modelID: string }[]
  }) => {
    blockRenders.push({
      blockID: props.blockID,
      focused: props.focused,
      hasManager: props.manager !== undefined,
      modelKeys: props.models?.map((model) => `${model.providerID}:${model.modelID}`) ?? [],
    })
    return h("div", {
      class: "master-agent-block-mock",
      "data-block-id": props.blockID,
      "data-focused": String(props.focused),
      onClick: () => props.onFocus(),
    })
  }
  return { MasterAgentBlock }
})

mock.module("@/context/layout", () => ({
  useLayout: () => ({ projects: { list: () => [{ worktree: "C:/test-project" }] } }),
  getProjectAvatarVariant: () => "blue",
}))

mock.module("@/components/titlebar", () => ({
  TitlebarSettingsButton: () => null,
}))

interface OnlineWorkspaceBackend {
  workspace: {
    id: string
    name: string
    model: string
    operatingAgent: string | null
    coderModel: string | null
    directories: string[]
  }
  patches: Array<{ id: string; patch: Record<string, unknown> }>
  rejectNextUpdate?: Error
  revision: number
}

let onlineWorkspace: OnlineWorkspaceBackend | undefined

function useOnlineWorkspace(input: { model?: string; coderModel?: string | null } = {}) {
  const backend: OnlineWorkspaceBackend = {
    workspace: {
      id: "workspace-model-menu",
      name: "Default",
      model: input.model ?? "openai:gpt-5",
      operatingAgent: null,
      coderModel: input.coderModel ?? null,
      directories: ["C:/test-project"],
    },
    patches: [],
    revision: 1,
  }
  onlineWorkspace = backend
  return backend
}

function requireOnlineWorkspace() {
  if (!onlineWorkspace) throw new Error("offline")
  return onlineWorkspace
}

function workspaceSnapshot(backend = requireOnlineWorkspace()) {
  return { ...backend.workspace, directories: [...backend.workspace.directories] }
}

const workspaceAPI = {
  list: async () => ({ data: [workspaceSnapshot()] }),
  get: async () => ({ data: workspaceSnapshot() }),
  create: async () => ({ data: workspaceSnapshot() }),
  update: async (parameters: { workspaceUpdatePayload: { id: string; patch: Record<string, unknown> } }) => {
    const backend = requireOnlineWorkspace()
    const input = parameters.workspaceUpdatePayload
    backend.patches.push({ id: input.id, patch: { ...input.patch } })
    const failure = backend.rejectNextUpdate
    backend.rejectNextUpdate = undefined
    if (failure) throw failure
    if (typeof input.patch.model === "string") backend.workspace.model = input.patch.model
    if ("coderModel" in input.patch) backend.workspace.coderModel = (input.patch.coderModel as string | null) ?? null
    return { data: workspaceSnapshot(backend) }
  },
  functionality: {
    list: async () => ({ data: [] }),
  },
  layout: {
    get: async () => ({ data: { blocks: [], revision: requireOnlineWorkspace().revision } }),
    save: async (parameters: { workspaceLayoutSavePayload: { blocks: Record<string, unknown>[] } }) => {
      const backend = requireOnlineWorkspace()
      backend.revision += 1
      return {
        data: {
          status: "saved" as const,
          layout: { blocks: parameters.workspaceLayoutSavePayload.blocks, revision: backend.revision },
        },
      }
    },
  },
}

const offlineSDKContext = {
  protocol: Promise.resolve("legacy"),
  protocolKind: () => "legacy",
  client: {
    v2: {
      workspace: {
        ...workspaceAPI,
      },
    },
  },
  createClient: () => ({
    config: {
      get: async () => ({ data: { permission: onlineWorkspace ? "allow" : "deny" } }),
      update: async () => ({}),
    },
  }),
  event: { start: () => {}, listen: () => () => {} },
  createServerSdkContext() {
    return {
      server: { http: { url: "https://fake.local" } },
      scope: "local",
      protocol: Promise.resolve("legacy"),
      protocolKind() {
        return "legacy"
      },
      url: "https://fake.local",
      client: {
        v2: {
          workspace: workspaceAPI,
        },
      },
      api: {
        v2: {
          workspace: workspaceAPI,
        },
      },
      currentApi: {
        v2: {
          workspace: workspaceAPI,
        },
      },
      event: { start: () => {}, listen: () => () => {} },
      createClient: () => ({
        config: {
          get: async () => ({ data: { permission: onlineWorkspace ? "allow" : "deny" } }),
          update: async () => ({}),
        },
      }),
    }
  },
}

mock.module("@/context/server-sdk", () => ({
  useServerSDK: () => () => offlineSDKContext,
}))

mock.module("@/context/server-sdk.tsx", () => ({
  useServerSDK: () => () => offlineSDKContext,
  createServerSdkContext: offlineSDKContext.createServerSdkContext,
}))

mock.module("@/hooks/use-providers", () => ({
  useProviders: () => ({
    all: () => {
      providerCatalogVersion()
      return new Map([
        [
          "openai",
          {
            name: "OpenAI",
            models: {
              "gpt-5": { name: "GPT-5", variants: Object.fromEntries(openAIVariants.map((variant) => [variant, {}])) },
              ...(colonModelEnabled ? { "gpt-5:high": { name: "GPT-5 High Model", variants: {} } } : {}),
            },
          },
        ],
        [
          "acme",
          {
            name: "Acme",
            models: {
              "coder-mini": {
                name: "Coder Mini",
                variants: Object.fromEntries(acmeVariants.map((variant) => [variant, {}])),
              },
              ...(colonModelEnabled
                ? { "gpt-oss:120b": { name: "GPT OSS 120B", variants: { low: {}, high: {} } } }
                : {}),
            },
          },
        ],
        ["offline", { name: "Offline", models: { hidden: { name: "Aardvark" } } }],
      ])
    },
    connected: () => [{ id: "acme" }, { id: "openai" }],
    refresh,
  }),
}))

mock.module("@opencode-ai/ui/theme/context", () => ({
  useTheme: () => ({ mode: () => "dark", setColorScheme: () => {} }),
}))

mock.module("@pierre/diffs/worker/worker.js?worker&url", () => ({
  default: "",
}))

mock.module("@opencode-ai/session-ui/src/components/markdown.worker.ts?worker&url", () => ({
  default: "",
}))

mock.module("@/context/ctxpack/selection-overlay", () => ({
  CtxPackSelectionOverlay: () => null,
}))

mock.module("./blocks/chat-relay/view", () => ({
  ChatRelayBody: () => null,
  iconClose: () => null,
  iconRelay: () => null,
  iconSpin: () => null,
}))

mock.module("./block-chat", () => ({
  BlockChat: (props: {
    target: { sessionID?: string }
    surfaceID?: string
    focused?: boolean
    queueEnabled?: boolean
    children?: unknown
  }) =>
    h("div", {
      "data-base-surface-id": props.surfaceID,
      "data-base-session-id": props.target.sessionID,
      "data-base-focused": props.focused,
      "data-base-queue": props.queueEnabled,
      children: props.children,
    }),
}))

mock.module("@/components/debug-bar", () => ({
  DebugBar: () => null,
}))

mock.module("@/context/language", () => ({
  useLanguage: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === "canvas.model.picker.ariaLabel") return `${params?.label} model picker`
      if (key === "settings.models.title") return "Models"
      if (key === "canvas.model.main") return "Main"
      if (key === "canvas.model.subagent") return "Subagent"
      if (key === "canvas.chat.relay.effort") return "Reasoning effort"
      if (key === "common.default") return "Default"
      if (key === "mcp.status.disabled") return "disabled"
      if (key === "dialog.model.search.placeholder") return "Search models"
      if (key === "canvas.operatingAgent.unconfigured") return "Select an OperatingAgent model to start this session."
      if (key === "canvas.operatingAgent.starting") return "Starting OperatingAgent session..."
      if (key === "canvas.operatingAgent.unavailable") return "Session unavailable"
      if (key === "canvas.operatingAgent.retry") return "Retry"
      return key
    },
    plural: (key: string, count: number) => `${key}.${count}`,
    locale: () => "en",
  }),
  LanguageProvider: (props: { children?: unknown }) => props.children,
}))

mock.module("@/context/platform", () => ({
  usePlatform: () => ({
    platform: "web",
    version: undefined,
    fetch: undefined,
    revealPath: undefined,
    openDirectory: undefined,
    openExternal: undefined,
    openPath: undefined,
    notify: undefined,
    getDefaultServer: undefined,
    setDefaultServer: undefined,
    wslServers: undefined,
    setForceFocus: undefined,
    exportDebugLogs: undefined,
    setWindowTitle: undefined,
  }),
}))

mock.module("@solidjs/router", () => ({
  A: (props: { href?: string; children?: unknown }) => h("a", { href: props.href, children: props.children }),
  Link: (props: { href?: string; children?: unknown }) => h("a", { href: props.href, children: props.children }),
  useNavigate: () => () => undefined,
  useParams: () => ({}),
  useLocation: () => ({ pathname: "/", search: "", hash: "" }),
  useSearchParams: () => [Object.create(null), () => undefined],
  useIsRouting: () => false,
}))

interface WorkspaceModule {
  CanvasWorkspace: () => unknown
  FUNCTIONALITY_BY_TYPE: Record<string, string>
  TYPE_BY_FUNCTIONALITY: Record<string, string>
  createModelRefreshState: (onRefresh: () => Promise<unknown>) => {
    refreshing: () => boolean
    refreshError: () => boolean
    refresh: () => Promise<void>
  }
}

let workspaceModule: WorkspaceModule
let CtxPackDraftProvider: (typeof import("@/context/ctxpack/draft"))["CtxPackDraftProvider"]

beforeAll(async () => {
  // happy-dom provides both; guards keep the suite runnable on leaner DOMs.
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false
      },
    })) as unknown as typeof window.matchMedia
  }
  workspaceModule = (await import("./workspace")) as unknown as WorkspaceModule
  CtxPackDraftProvider = (await import("@/context/ctxpack/draft")).CtxPackDraftProvider
})

const disposers: (() => void)[] = []

function seedBlocks(blocks: Record<string, unknown>[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ camera: { x: 0, y: 0, scale: 1 }, editing: true, blocks }))
}

function masterAgentBlock(id: string, x: number, y: number): Record<string, unknown> {
  return {
    id,
    type: "master-agent",
    x,
    y,
    w: 440,
    h: 500,
    z: 10,
    collapsed: false,
    text: "",
    listening: false,
    messages: [],
    relay: "uninitialized",
    agentKey: "inherit",
    layers: [],
    history: [],
  }
}

function operatingChatBlock(id: string): Record<string, unknown> {
  return {
    id,
    functionalityID: "builtin:operating-chat-session",
    transform: { x: 40, y: 40, w: 440, h: 500, z: 10 },
  }
}

function mountWorkspace(children: unknown) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  ;(globalThis as { __CANVAS_INTEGRATION_STATE__?: { blocks: unknown[] } }).__CANVAS_INTEGRATION_STATE__ = {
    blocks: [],
  }
  // `h` returns a renderable thunk; render() evaluates the wrapper and insert
  // evaluates the thunk as an accessor inside the reactive root. The cast
  // reconciles hyperscript's opaque thunk type with render's `() => Element`.
  const dispose = render(
    () =>
      createComponent(CtxPackDraftProvider, {
        workspaceID: () => undefined,
        workspaceEpoch: () => 0,
        get children() {
          return h(workspaceModule.CanvasWorkspace as never, { children }) as never
        },
      }),
    host,
  )
  disposers.push(() => {
    dispose()
    host.remove()
  })
  return host
}

interface TestCanvasManager {
  connected: () => boolean
  modelKey: () => string | undefined
  masterAgent: {
    coder: {
      model: () => { providerID: string; modelID: string; variant?: string } | null
      pending: () => boolean
    }
  }
}

function canvasManager() {
  const manager = (globalThis as { __CANVAS_MANAGER__?: TestCanvasManager }).__CANVAS_MANAGER__
  if (!manager) throw new Error("canvas manager not found")
  return manager
}

async function waitFor(condition: () => boolean, message: string) {
  for (let attempts = 0; attempts < 50; attempts += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(message)
}

async function mountOnlineWorkspace(input: { model?: string; coderModel?: string | null } = {}) {
  const backend = useOnlineWorkspace(input)
  const host = mountWorkspace("legacy session ui")
  const manager = canvasManager()
  await waitFor(manager.connected, "canvas manager did not connect")
  return { backend, host, manager }
}

function card(host: HTMLElement, id: string): HTMLElement {
  const element = host.querySelector(`[data-card-id="${id}"]`)
  if (!(element instanceof HTMLElement)) throw new Error(`card ${id} not found`)
  return element
}

function blockMock(host: HTMLElement, id: string): HTMLElement {
  const matches = host.querySelectorAll(`.master-agent-block-mock[data-block-id="${id}"]`)
  if (matches.length !== 1) throw new Error(`expected one block mock for ${id}, found ${matches.length}`)
  const element = matches[0]
  if (!(element instanceof HTMLElement)) throw new Error(`block mock ${id} not found`)
  return element
}

function toolbarModelKeys() {
  const popup = document.querySelector(".canvas-model-picker-pop")
  return [...(popup?.querySelectorAll(".canvas-model-picker-item") ?? [])].flatMap((item) => {
    if (item.classList.contains("canvas-model-picker-disabled")) return []
    const modelName = item.querySelector(".canvas-model-picker-name")?.textContent
    const providerName = item.querySelector(".canvas-model-picker-provider")?.textContent
    if (modelName === "Aardvark" && providerName === "Offline") return "offline:hidden"
    if (modelName === "Coder Mini" && providerName === "Acme") return "acme:coder-mini"
    if (modelName === "GPT-5" && providerName === "OpenAI") return "openai:gpt-5"
    throw new Error(`unexpected toolbar model ${providerName}:${modelName}`)
  })
}

function modelsMenu(host: HTMLElement) {
  const trigger = host.querySelector(".canvas-model-picker-trigger")
  if (!(trigger instanceof HTMLButtonElement)) throw new Error("Models menu trigger not found")
  const current = document.querySelector(".canvas-model-picker-pop")
  if (current instanceof HTMLElement) return current
  trigger.click()
  const popup = document.querySelector(".canvas-model-picker-pop")
  if (!(popup instanceof HTMLElement)) throw new Error("Models menu not found")
  return popup
}

function modelRole(popup: HTMLElement, role: "main" | "subagent") {
  const section = popup.querySelector(`[data-model-role="${role}"]`)
  if (!(section instanceof HTMLElement)) throw new Error(`${role} model section not found`)
  return section
}

function expandModelRole(section: HTMLElement) {
  const trigger = section.querySelector(".canvas-model-picker-role-trigger")
  if (!(trigger instanceof HTMLButtonElement)) throw new Error("Model role trigger not found")
  if (trigger.getAttribute("aria-expanded") !== "true") trigger.click()
}

function chooseModel(popup: HTMLElement, name: string) {
  const item = [...popup.querySelectorAll<HTMLButtonElement>(".canvas-model-picker-item")].find((entry) =>
    entry.textContent?.includes(name),
  )
  if (!item) throw new Error(`${name} model not found`)
  item.click()
}

function effortSelect(section: HTMLElement) {
  const select = section.querySelector(".canvas-model-effort")
  if (!(select instanceof HTMLSelectElement)) throw new Error("Reasoning effort select not found")
  return select
}

function selectEffort(section: HTMLElement, value: string) {
  const select = effortSelect(section)
  // Bun's classic JSX shim does not reconcile dynamic <option> children;
  // supply the selected value so the native change handler can still run.
  if (value && ![...select.options].some((option) => option.value === value)) {
    const option = document.createElement("option")
    option.value = value
    select.add(option)
  }
  select.value = value
  select.dispatchEvent(new Event("change", { bubbles: true }))
}

beforeEach(() => {
  blockRenders.length = 0
  refresh.mockClear()
  refreshResult = Promise.resolve()
  openAIVariants = ["low", "medium", "high"]
  acmeVariants = ["low", "high"]
  colonModelEnabled = false
  onRefreshSuccess = undefined
  setProviderCatalogVersion((version) => version + 1)
  onlineWorkspace = undefined
  localStorage.clear()
})

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
  document.body.innerHTML = ""
  localStorage.clear()
  ;(globalThis as { __CANVAS_INTEGRATION_STATE__?: unknown }).__CANVAS_INTEGRATION_STATE__ = undefined
})

describe("master-agent registration", () => {
  test("maps the block type to builtin:master-agent with no collisions", () => {
    expect(workspaceModule.FUNCTIONALITY_BY_TYPE["master-agent"]).toBe("builtin:master-agent")
    expect(workspaceModule.TYPE_BY_FUNCTIONALITY["builtin:master-agent"]).toBe("master-agent")
    expect(Object.values(workspaceModule.FUNCTIONALITY_BY_TYPE)).not.toContain("builtin:chat")
    // Every block type maps to a distinct functionality ID.
    const ids = Object.values(workspaceModule.FUNCTIONALITY_BY_TYPE)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("master-agent canvas integration", () => {
  test("leaves an empty canvas empty and does not render routed children", () => {
    const host = mountWorkspace("legacy session ui")

    expect(host.querySelectorAll(".canvas-card")).toHaveLength(0)
    expect(host.textContent).not.toContain("legacy session ui")
  })

  test("keeps model selection in the top bar for OperatingChat", () => {
    seedBlocks([operatingChatBlock("operating-1")])
    const host = mountWorkspace("legacy session ui")
    const operating = card(host, "operating-1")

    expect(operating.querySelector(".canvas-model-picker") === null).toBe(true)
    expect(host.querySelectorAll(".canvas-model-picker-trigger")).toHaveLength(1)
    expect(operating.querySelector(".canvas-operating-denied") === null).toBe(true)
    expect(operating.querySelector(".canvas-composer")).toBeNull()
    expect(operating.querySelector(".canvas-operating-stack")).toBeNull()
  })

  test("groups Main and Subagent model and effort configuration in one expanding menu", async () => {
    const { host } = await mountOnlineWorkspace()

    const trigger = host.querySelector(".canvas-model-picker-trigger")
    if (!(trigger instanceof HTMLButtonElement)) throw new Error("Models menu trigger not found")
    expect(host.querySelectorAll(".canvas-model-picker-trigger")).toHaveLength(1)
    expect(trigger.querySelector(".canvas-model-picker-label")?.textContent).toBe("Models")

    const popup = modelsMenu(host)
    const main = modelRole(popup, "main")
    const subagent = modelRole(popup, "subagent")
    expect(main.textContent).toContain("Main")
    expect(subagent.textContent).toContain("Subagent")
    expect(main.textContent).toContain("Reasoning effort")
    expect(subagent.textContent).toContain("Reasoning effort")
    expect(popup.querySelectorAll(".canvas-model-picker-refresh")).toHaveLength(1)

    expandModelRole(subagent)
    expect(popup.querySelector(".canvas-model-picker-disabled")?.textContent?.toLowerCase()).toContain("disabled")
  })

  test("keeps Main and Subagent model and effort selection independent with one manual refresh", async () => {
    const { backend, host, manager } = await mountOnlineWorkspace()
    const popup = modelsMenu(host)
    const main = modelRole(popup, "main")

    expandModelRole(main)
    expect(toolbarModelKeys()).toEqual(["acme:coder-mini", "openai:gpt-5"])
    chooseModel(popup, "Coder Mini")
    await waitFor(() => backend.patches.length === 1, "Main model patch was not saved")
    expect(backend.patches[0]).toEqual({ id: backend.workspace.id, patch: { model: "acme:coder-mini" } })
    expect(manager.modelKey()).toBe("acme:coder-mini")
    expect(manager.masterAgent.coder.model()).toBeNull()

    selectEffort(main, "high")
    await waitFor(() => backend.patches.length === 2, "Main effort patch was not saved")
    expect(backend.patches[1]?.patch).toEqual({ model: "acme:coder-mini:high" })
    expect(manager.modelKey()).toBe("acme:coder-mini:high")

    selectEffort(main, "")
    await waitFor(() => backend.patches.length === 3, "Default Main effort patch was not saved")
    expect(backend.patches[2]?.patch).toEqual({ model: "acme:coder-mini" })

    const subagent = modelRole(popup, "subagent")
    expandModelRole(subagent)
    expect(popup.querySelector(".canvas-model-picker-disabled")?.textContent?.toLowerCase()).toContain("disabled")
    expect(toolbarModelKeys()).toEqual(["acme:coder-mini", "openai:gpt-5"])
    chooseModel(popup, "GPT-5")
    await waitFor(() => backend.patches.length === 4, "Subagent model patch was not saved")
    expect(backend.patches[3]?.patch).toEqual({ coderModel: "openai:gpt-5" })
    expect(manager.masterAgent.coder.model()).toEqual({ providerID: "openai", modelID: "gpt-5" })

    selectEffort(subagent, "medium")
    await waitFor(() => backend.patches.length === 5, "Subagent effort patch was not saved")
    expect(backend.patches[4]?.patch).toEqual({ coderModel: "openai:gpt-5:medium" })

    selectEffort(subagent, "")
    await waitFor(() => backend.patches.length === 6, "Default Subagent effort patch was not saved")
    expect(backend.patches[5]?.patch).toEqual({ coderModel: "openai:gpt-5" })

    popup.querySelector<HTMLButtonElement>(".canvas-model-picker-refresh")?.click()
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledTimes(1)

    popup.querySelector<HTMLButtonElement>(".canvas-model-picker-disabled")?.click()
    await waitFor(() => backend.patches.length === 7, "Subagent clear patch was not saved")
    expect(backend.patches[6]?.patch).toEqual({ coderModel: null })
    expect(manager.masterAgent.coder.model()).toBeNull()
    expect(backend.workspace.model).toBe("acme:coder-mini")
  })

  test("retains supported effort and resets unsupported effort when switching models", async () => {
    const { backend, host, manager } = await mountOnlineWorkspace()
    const popup = modelsMenu(host)
    const main = modelRole(popup, "main")
    selectEffort(main, "high")
    await waitFor(() => backend.patches.length === 1, "Initial effort patch was not saved")
    expect(backend.patches[0]?.patch).toEqual({ model: "openai:gpt-5:high" })
    chooseModel(popup, "Coder Mini")
    await waitFor(() => backend.patches.length === 2, "Supported effort was not retained")
    expect(backend.patches[1]?.patch).toEqual({ model: "acme:coder-mini:high" })
    expect(manager.modelKey()).toBe("acme:coder-mini:high")

    chooseModel(popup, "GPT-5")
    await waitFor(() => backend.patches.length === 3, "Main model was not switched back")
    expect(backend.patches[2]?.patch).toEqual({ model: "openai:gpt-5:high" })

    selectEffort(main, "medium")
    await waitFor(() => backend.patches.length === 4, "Medium effort patch was not saved")
    expect(backend.patches[3]?.patch).toEqual({ model: "openai:gpt-5:medium" })

    chooseModel(popup, "Coder Mini")
    await waitFor(() => backend.patches.length === 5, "Unsupported effort was not reset")
    expect(backend.patches[4]?.patch).toEqual({ model: "acme:coder-mini" })
    expect(manager.modelKey()).toBe("acme:coder-mini")
  })

  test("preserves colons in Main and Subagent model IDs when saving effort", async () => {
    colonModelEnabled = true
    setProviderCatalogVersion((version) => version + 1)
    const { backend, host, manager } = await mountOnlineWorkspace()
    const popup = modelsMenu(host)

    chooseModel(popup, "GPT OSS 120B")
    await waitFor(() => backend.patches.length === 1, "colon Main model patch was not saved")
    expect(backend.patches[0]?.patch).toEqual({ model: "acme:gpt-oss%3A120b" })
    expect(manager.modelKey()).toBe("acme:gpt-oss%3A120b")

    const subagent = modelRole(popup, "subagent")
    expandModelRole(subagent)
    chooseModel(popup, "GPT OSS 120B")
    await waitFor(() => backend.patches.length === 2, "colon Subagent model patch was not saved")
    expect(backend.patches[1]?.patch).toEqual({ coderModel: "acme:gpt-oss%3A120b" })
    expect(manager.masterAgent.coder.model()).toEqual({ providerID: "acme", modelID: "gpt-oss:120b" })

    selectEffort(subagent, "high")
    await waitFor(() => backend.patches.length === 3, "colon Subagent effort patch was not saved")
    expect(backend.patches[2]?.patch).toEqual({ coderModel: "acme:gpt-oss%3A120b:high" })
    expect(manager.masterAgent.coder.model()).toEqual({ providerID: "acme", modelID: "gpt-oss:120b", variant: "high" })
  })

  test("manual refresh migrates legacy raw colon model IDs using the live catalog", async () => {
    colonModelEnabled = true
    setProviderCatalogVersion((version) => version + 1)
    const { backend, host, manager } = await mountOnlineWorkspace({
      model: "acme:gpt-oss:120b",
      coderModel: "acme:gpt-oss:120b",
    })
    const popup = modelsMenu(host)

    expect(manager.modelKey()).toBe("acme:gpt-oss:120b")
    popup.querySelector<HTMLButtonElement>(".canvas-model-picker-refresh")?.click()
    await waitFor(() => backend.patches.length === 2, "legacy colon model IDs were not migrated")

    expect(backend.patches).toContainEqual({
      id: backend.workspace.id,
      patch: { model: "acme:gpt-oss%3A120b" },
    })
    expect(backend.patches).toContainEqual({
      id: backend.workspace.id,
      patch: { coderModel: "acme:gpt-oss%3A120b" },
    })
    expect(manager.modelKey()).toBe("acme:gpt-oss%3A120b")
    expect(manager.masterAgent.coder.model()).toEqual({ providerID: "acme", modelID: "gpt-oss:120b" })
  })

  test("canonical model effort wins when its key also names a colon model", async () => {
    colonModelEnabled = true
    setProviderCatalogVersion((version) => version + 1)
    const { backend, host } = await mountOnlineWorkspace({ model: "openai:gpt-5:high" })
    const popup = modelsMenu(host)

    popup.querySelector<HTMLButtonElement>(".canvas-model-picker-refresh")?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(backend.patches).toHaveLength(0)
  })

  test("manual refresh clears a removed effort variant once while preserving the base model", async () => {
    const { backend, host, manager } = await mountOnlineWorkspace({
      model: "openai:gpt-5:medium",
      coderModel: "acme:coder-mini:high",
    })
    onRefreshSuccess = () => {
      openAIVariants = ["low", "high"]
    }

    const popup = modelsMenu(host)
    popup.querySelector<HTMLButtonElement>(".canvas-model-picker-refresh")?.click()
    await waitFor(() => backend.patches.length === 1, "removed effort variant was not cleared")

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(backend.patches[0]).toEqual({ id: backend.workspace.id, patch: { model: "openai:gpt-5" } })
    expect(manager.modelKey()).toBe("openai:gpt-5")
    expect(manager.masterAgent.coder.model()).toEqual({ providerID: "acme", modelID: "coder-mini", variant: "high" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(backend.patches).toHaveLength(1)
  })

  test("failed manual refresh keeps the selected effort variant", async () => {
    let rejectRefresh: ((reason?: unknown) => void) | undefined
    refreshResult = new Promise((_, reject) => {
      rejectRefresh = reject
    })
    const { backend, host, manager } = await mountOnlineWorkspace({ model: "openai:gpt-5:medium" })
    openAIVariants = ["low", "high"]
    setProviderCatalogVersion((version) => version + 1)

    const popup = modelsMenu(host)
    popup.querySelector<HTMLButtonElement>(".canvas-model-picker-refresh")?.click()
    rejectRefresh?.(new Error("offline"))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(backend.patches).toHaveLength(0)
    expect(manager.modelKey()).toBe("openai:gpt-5:medium")
  })

  test("supports keyboard focus navigation", async () => {
    const { host } = await mountOnlineWorkspace()
    const trigger = host.querySelector(".canvas-model-picker-trigger")
    if (!(trigger instanceof HTMLButtonElement)) throw new Error("Models menu trigger not found")
    trigger.focus()
    const popup = modelsMenu(host)
    const options = [...popup.querySelectorAll<HTMLButtonElement>("[data-model-key]")]
    options[0]?.focus()
    options[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    expect(document.activeElement).toBe(options[1])
  })

  test("handles a Subagent model save failure without an unhandled rejection", async () => {
    const { backend, host, manager } = await mountOnlineWorkspace({ coderModel: "acme:coder-mini:high" })
    backend.rejectNextUpdate = new Error("offline")

    const popup = modelsMenu(host)
    expandModelRole(modelRole(popup, "subagent"))
    chooseModel(popup, "GPT-5")
    await waitFor(
      () => backend.patches.length === 1 && !manager.masterAgent.coder.pending(),
      "failed Subagent model patch did not settle",
    )

    expect(backend.patches[0]?.patch).toEqual({ coderModel: "openai:gpt-5:high" })
    expect(backend.workspace.coderModel).toBe("acme:coder-mini:high")
    expect(manager.masterAgent.coder.model()).toEqual({ providerID: "acme", modelID: "coder-mini", variant: "high" })
  })

  test("keeps the connected model catalog in the toolbar", () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    const host = mountWorkspace("legacy session ui")

    const picker = host.querySelector(".canvas-model-picker-trigger")
    if (!(picker instanceof HTMLButtonElement)) throw new Error("model picker not found")
    picker.click()

    expect(toolbarModelKeys()).toEqual(["acme:coder-mini", "openai:gpt-5"])
    expect(blockRenders.map((entry) => entry.modelKeys)).toEqual([[], []])
  })

  test("wires the model refresh button to the provider", async () => {
    const host = mountWorkspace("legacy session ui")

    const picker = host.querySelector(".canvas-model-picker-trigger")
    if (!(picker instanceof HTMLButtonElement)) throw new Error("model picker not found")
    picker.click()

    const button = document.querySelector(".canvas-model-picker-refresh")
    if (!(button instanceof HTMLButtonElement)) throw new Error("refresh button not found")
    button.click()
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  test("keeps models visible when refresh fails", async () => {
    let rejectRefresh: ((reason?: unknown) => void) | undefined
    refreshResult = new Promise((_, reject) => {
      rejectRefresh = reject
    })
    const host = mountWorkspace("legacy session ui")

    const picker = host.querySelector(".canvas-model-picker-trigger")
    if (!(picker instanceof HTMLButtonElement)) throw new Error("model picker not found")
    picker.click()
    expect(toolbarModelKeys()).toEqual(["acme:coder-mini", "openai:gpt-5"])

    const button = document.querySelector(".canvas-model-picker-refresh")
    if (!(button instanceof HTMLButtonElement)) throw new Error("refresh button not found")
    button.click()
    rejectRefresh?.(new Error("offline"))
    await Promise.resolve()

    expect(toolbarModelKeys()).toEqual(["acme:coder-mini", "openai:gpt-5"])
  })

  test("tracks refresh pending, deduplication, failure, and retry state", async () => {
    let resolveRefresh: ((value: unknown) => void) | undefined
    let rejectRefresh: ((reason?: unknown) => void) | undefined
    const onRefresh = mock(() => refreshResult)
    const state = workspaceModule.createModelRefreshState(onRefresh)

    expect(state.refreshing()).toBeFalse()
    expect(state.refreshError()).toBeFalse()

    refreshResult = new Promise((resolve) => {
      resolveRefresh = resolve
    })
    const pending = state.refresh()
    const duplicate = state.refresh()
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(state.refreshing()).toBeTrue()
    expect(state.refreshError()).toBeFalse()
    resolveRefresh?.(undefined)
    await pending
    await duplicate
    expect(state.refreshing()).toBeFalse()
    expect(state.refreshError()).toBeFalse()

    refreshResult = new Promise((_, reject) => {
      rejectRefresh = reject
    })
    const failed = state.refresh()
    rejectRefresh?.(new Error("offline"))
    await failed
    expect(state.refreshing()).toBeFalse()
    expect(state.refreshError()).toBeTrue()

    refreshResult = new Promise((resolve) => {
      resolveRefresh = resolve
    })
    const retry = state.refresh()
    expect(state.refreshing()).toBeTrue()
    expect(state.refreshError()).toBeFalse()
    resolveRefresh?.(undefined)
    await retry
    expect(state.refreshing()).toBeFalse()
    expect(state.refreshError()).toBeFalse()
  })

  test("renders an explicit error block for an unknown functionality reference", () => {
    seedBlocks([
      {
        id: "missing-plugin",
        functionalityID: "plugin:removed",
        transform: { x: 40, y: 40, w: 320, h: 320, z: 1 },
      },
    ])
    const host = mountWorkspace("legacy session ui")

    expect(card(host, "missing-plugin").getAttribute("aria-label")).toBe("Unavailable block block")
    expect(card(host, "missing-plugin").querySelector('[role="alert"]')?.textContent).toContain("plugin:removed")
  })

  test("renders two master-agent blocks with distinct identity and no fallback chat card", () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    const host = mountWorkspace("legacy session ui")

    const cards = [...host.querySelectorAll(".canvas-card")]
    expect(cards).toHaveLength(2)
    expect(blockMock(host, "ma-1")).not.toBeNull()
    expect(blockMock(host, "ma-2")).not.toBeNull()

    const rendered = [...blockRenders]
    expect(rendered).toHaveLength(2)
    expect(rendered.map((entry) => entry.blockID).sort()).toEqual(["ma-1", "ma-2"])
    expect(rendered.every((entry) => entry.hasManager)).toBeTrue()
    // Nothing is focused at mount.
    expect(rendered.every((entry) => entry.focused === false)).toBeTrue()

    expect(host.querySelector('[data-card-id="canvas-legacy"]')).toBeNull()
    expect(host.textContent).not.toContain("legacy session ui")
    const titles = [...host.querySelectorAll(".canvas-card-title")].map((node) => node.textContent)
    expect(titles).not.toContain("OpenCode")
  })

  test("drops legacy local cache records while preserving supported blocks", async () => {
    seedBlocks([
      {
        id: "legacy-type",
        type: "legacy",
        x: 0,
        y: 0,
        w: 896,
        h: 800,
        z: 0,
      },
      {
        id: "legacy-functionality",
        functionalityID: "builtin:chat",
        transform: { x: 40, y: 40, w: 400, h: 300, z: 1 },
      },
      masterAgentBlock("ma-1", 80, 80),
    ])
    const host = mountWorkspace("legacy session ui")

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect([...host.querySelectorAll(".canvas-card")].map((entry) => (entry as HTMLElement).dataset.cardId)).toEqual([
      "ma-1",
    ])
    expect(host.textContent).not.toContain("legacy session ui")

    window.dispatchEvent(new Event("pagehide"))
    const payload = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as {
      blocks: Array<{ id: string; functionalityID: string }>
    }
    expect(payload.blocks.map((block) => block.id)).toEqual(["ma-1"])
    expect(payload.blocks.some((block) => block.functionalityID === "builtin:chat")).toBeFalse()
  })

  test("for loop shim sanity", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const Demo = () => <For each={[1, 2, 3]}>{(value) => <div class="mini-item" data-mini={value} />}</For>
    const dispose = render(() => h(Demo as never, {}) as never, host)
    const count = [...host.querySelectorAll(".mini-item")].length
    dispose()
    host.remove()
    expect(count).toBe(3)
  })

  test("for loop with createStore array", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const [state] = createStore({
      blocks: [{ id: "a" }, { id: "b" }, { id: "c" }],
    })
    const Demo = () => <For each={state.blocks}>{(value) => <div class="mini-item" data-mini={value.id} />}</For>
    const dispose = render(() => h(Demo as never, {}) as never, host)
    const count = [...host.querySelectorAll(".mini-item")].length
    dispose()
    host.remove()
    expect(count).toBe(3)
  })

  test("focus handover: clicking a master-agent block selects it and deselects the other", () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    const host = mountWorkspace("legacy session ui")

    const first = card(host, "ma-1")
    const second = card(host, "ma-2")
    expect(first.classList.contains("selected")).toBeFalse()
    expect(second.classList.contains("selected")).toBeFalse()

    blockMock(host, "ma-1").click()
    expect(first.classList.contains("selected")).toBeTrue()
    expect(second.classList.contains("selected")).toBeFalse()

    blockMock(host, "ma-2").click()
    expect(second.classList.contains("selected")).toBeTrue()
    expect(first.classList.contains("selected")).toBeFalse()
  })

  test("serialized layout carries presentation only — never session binding", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40)])
    mountWorkspace("legacy session ui")

    await new Promise((resolve) => setTimeout(resolve, 0))
    window.dispatchEvent(new Event("pagehide"))

    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw!) as { blocks: Record<string, unknown>[] }
    const block = payload.blocks.find((entry) => entry.id === "ma-1")
    expect(block).toEqual({
      id: "ma-1",
      functionalityID: "builtin:master-agent",
      transform: { x: 40, y: 40, w: 440, h: 500, z: 10 },
    })

    const serialized = JSON.stringify(block)
    for (const forbidden of [
      "sessionID",
      "sessionBinding",
      "functionalityInstanceID",
      "generation",
      "revision",
      "queue",
      "coderModel",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    for (const entry of payload.blocks) {
      expect(Object.keys(entry).sort()).toEqual(["functionalityID", "id", "transform"])
      expect(Object.keys(entry.transform as Record<string, unknown>).sort()).toEqual(["h", "w", "x", "y", "z"])
    }
    expect(payload.blocks.some((entry) => entry.functionalityID === "builtin:chat")).toBeFalse()
  })
})
