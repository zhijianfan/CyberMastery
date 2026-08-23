// Track I2 — Canvas renderer integration tests. These exercise the REAL
// workspace renderer (registration, block rendering, focus handover, legacy
// chat regression, presentation-only serialization) with the master-agent
// block renderer (B3) and the canvas contexts replaced by test doubles:
//   - "./master-agent/block"        -> recording fake (B3 in-flight)
//   - "@/context/layout"            -> static project
//   - "@/context/server-sdk"        -> offline stub (manager stays "local")
//   - "@/hooks/use-providers"       -> no providers
//   - "@opencode-ai/ui/theme/context" -> static dark theme
// The manager itself is the REAL createCanvasManager; it just never connects.
//
// Bun resolves solid-js to its server build unless the browser condition is
// applied; DOM tests in this canvas area therefore run with --conditions=browser.
//
// Bun compiles JSX in this package with the classic React.createElement
// factory, so the workspace's internal JSX needs the React global shimmed
// with solid's hyperscript before it is rendered (same pattern as
// coder-selector.browser.test.tsx / session-surface.browser.test.tsx).
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createComponent } from "solid-js"
import h from "solid-js/h"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { For } from "solid-js"
import { createStore } from "solid-js/store"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown {
  if (typeof tag === "function" && (tag.name === "Index" || tag.name === "Show" || tag.name === "For")) {
    console.log("createElement:component", tag.name, Object.keys(props ?? {}))
  }
  if (typeof tag === "string" && tag === "section") {
    const className = typeof props?.class === "string" ? props.class : ""
    if (className.includes("canvas-card") || className.includes("canvas-world")) {
      console.log("createElement:string", tag, className, props)
    }
  }
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

;(globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__ = true

interface RecordedBlockProps {
  blockID: string
  focused: boolean
  hasManager: boolean
  modelKeys: string[]
}

const blockRenders: RecordedBlockProps[] = []
let refreshResult: Promise<unknown> = Promise.resolve()
const refresh = mock(() => refreshResult)

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

const offlineSDKContext = {
  protocol: Promise.resolve("legacy"),
  protocolKind: () => "legacy",
  client: {
    v2: {
      workspace: {
        list: async () => {
          throw new Error("offline")
        },
      },
    },
  },
  createClient: () => ({
    config: {
      get: async () => ({ data: { permission: "deny" } }),
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
          workspace: {
            list: async () => {
              throw new Error("offline")
            },
          },
        },
      },
      api: {
        v2: {
          workspace: {
            list: async () => {
              throw new Error("offline")
            },
          },
        },
      },
      currentApi: {
        v2: {
          workspace: {
            list: async () => {
              throw new Error("offline")
            },
          },
        },
      },
      event: { start: () => {}, listen: () => () => {} },
      createClient: () => ({
        config: {
          get: async () => ({ data: { permission: "deny" } }),
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
    all: () =>
      new Map([
        ["openai", { name: "OpenAI", models: { "gpt-5": { name: "GPT-5" } } }],
        ["acme", { name: "Acme", models: { "coder-mini": { name: "Coder Mini" } } }],
        ["offline", { name: "Offline", models: { hidden: { name: "Aardvark" } } }],
      ]),
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

mock.module("./blocks/chat-relay/proxy-surface", () => ({
  ChatProxyRelaySurface: () => null,
}))

mock.module("../session-surface-base", () => ({
  SessionSurfaceBase: (props: { target: { sessionID?: string }; surfaceID?: string; focused?: boolean; queueEnabled?: boolean; children?: unknown }) =>
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
      if (key === "canvas.operatingAgent.label") return "OperatingAgent"
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
  CanvasWorkspace: (props: { children?: unknown }) => unknown
  FUNCTIONALITY_BY_TYPE: Record<string, string>
  TYPE_BY_FUNCTIONALITY: Record<string, string>
  createModelRefreshState: (onRefresh: () => Promise<unknown>) => {
    refreshing: () => boolean
    refreshError: () => boolean
    refresh: () => Promise<void>
  }
}

let workspaceModule: WorkspaceModule

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
    defaultRect: false,
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
  const renderErrors: string[] = []
  const previousConsoleError = console.error
  console.error = (...args: unknown[]) => {
    renderErrors.push(args.map((entry) => String(entry)).join(" "))
    previousConsoleError(...args)
  }
  const host = document.createElement("div")
  document.body.appendChild(host)
  // `h` returns a renderable thunk; render() evaluates the wrapper and insert
  // evaluates the thunk as an accessor inside the reactive root. The cast
  // reconciles hyperscript's opaque thunk type with render's `() => Element`.
  const dispose = render(() => h(workspaceModule.CanvasWorkspace as never, { children }) as never, host)
  disposers.push(() => {
    console.error = previousConsoleError
    dispose()
    host.remove()
  })
  ;(globalThis as { __CANVAS_INTEGRATION_RENDER_ERRORS__?: string[] }).__CANVAS_INTEGRATION_RENDER_ERRORS__ = renderErrors
  return host
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
    const modelName = item.querySelector(".canvas-model-picker-name")?.textContent
    const providerName = item.querySelector(".canvas-model-picker-provider")?.textContent
    if (modelName === "Disabled") return []
    if (modelName === "Aardvark" && providerName === "Offline") return "offline:hidden"
    if (modelName === "Coder Mini" && providerName === "Acme") return "acme:coder-mini"
    if (modelName === "GPT-5" && providerName === "OpenAI") return "openai:gpt-5"
    throw new Error(`unexpected toolbar model ${providerName}:${modelName}`)
  })
}

beforeEach(() => {
  blockRenders.length = 0
  refresh.mockClear()
  refreshResult = Promise.resolve()
  localStorage.clear()
})

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
  document.body.innerHTML = ""
  localStorage.clear()
})

describe("master-agent registration", () => {
  test("maps the block type to builtin:master-agent with no collisions", () => {
    expect(workspaceModule.FUNCTIONALITY_BY_TYPE["master-agent"]).toBe("builtin:master-agent")
    expect(workspaceModule.TYPE_BY_FUNCTIONALITY["builtin:master-agent"]).toBe("master-agent")
    // The legacy block keeps exclusive ownership of builtin:chat.
    expect(Object.values(workspaceModule.FUNCTIONALITY_BY_TYPE)).not.toContain("builtin:chat")
    // Every block type maps to a distinct functionality ID.
    const ids = Object.values(workspaceModule.FUNCTIONALITY_BY_TYPE)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("master-agent canvas integration", () => {
  test("renders OperatingChat as a Session shell with its own model picker", () => {
    seedBlocks([operatingChatBlock("operating-1")])
    const host = mountWorkspace("legacy session ui")
    const operating = card(host, "operating-1")

    expect(operating.querySelector(".canvas-model-picker-label")?.textContent).toBe("OperatingAgent")
    expect(operating.querySelector(".canvas-operating-denied")?.textContent).toBe(
      "Select an OperatingAgent model to start this session.",
    )
    expect(operating.querySelector(".canvas-composer")).toBeNull()
    expect(operating.querySelector(".canvas-operating-stack")).toBeNull()
  })

  test("renders a separate Subagent picker with a disabled option", () => {
    const host = mountWorkspace("legacy session ui")

    expect(host.querySelectorAll(".canvas-model-picker-trigger")).toHaveLength(2)
    expect([...host.querySelectorAll(".canvas-model-picker-label")].map((item) => item.textContent)).toEqual([
      "Model",
      "Subagent",
    ])

    const subagent = [...host.querySelectorAll(".canvas-model-picker-trigger")][1]
    if (!(subagent instanceof HTMLButtonElement)) throw new Error("subagent picker not found")
    subagent.click()

    expect(document.querySelector(".canvas-model-picker-disabled")?.textContent).toContain("Disabled")
  })

  test("keeps Subagent selection, clearing, primary selection, and refresh shared but independent", () => {
    const host = mountWorkspace("legacy session ui")
    const manager = (globalThis as { __CANVAS_MANAGER__?: {
      selectModel: (key: string) => Promise<void>
      masterAgent: { coder: { set: (model: unknown) => Promise<void>; clear: () => Promise<void> } }
    } }).__CANVAS_MANAGER__
    if (!manager) throw new Error("canvas manager not found")

    const selectModel = mock(() => Promise.resolve())
    const setCoder = mock(() => Promise.resolve())
    const clearCoder = mock(() => Promise.resolve())
    manager.selectModel = selectModel
    manager.masterAgent.coder.set = setCoder
    manager.masterAgent.coder.clear = clearCoder

    const pickers = [...host.querySelectorAll(".canvas-model-picker-trigger")]
    const primary = pickers[0]
    const subagent = pickers[1]
    if (!(primary instanceof HTMLButtonElement) || !(subagent instanceof HTMLButtonElement)) {
      throw new Error("model pickers not found")
    }

    primary.click()
    expect(toolbarModelKeys()).toEqual(["acme:coder-mini", "openai:gpt-5"])
    document.querySelector<HTMLButtonElement>(".canvas-model-picker-pop .canvas-model-picker-refresh")?.click()
    primary.click()
    subagent.click()
    expect(document.querySelector(".canvas-model-picker-disabled")?.textContent).toContain("Disabled")
    expect(toolbarModelKeys()).toEqual(["acme:coder-mini", "openai:gpt-5"])
    const subagentPopup = [...document.querySelectorAll(".canvas-model-picker-pop")].find((pop) =>
      pop.querySelector(".canvas-model-picker-disabled"),
    )
    subagentPopup?.querySelector<HTMLButtonElement>(".canvas-model-picker-refresh")?.click()
    expect(refresh).toHaveBeenCalledTimes(2)
    ;[...(subagentPopup?.querySelectorAll<HTMLButtonElement>(".canvas-model-picker-item") ?? [])]
      .find((item) => item.textContent?.includes("Coder Mini"))
      ?.click()
    expect(setCoder).toHaveBeenCalledWith({ providerID: "acme", modelID: "coder-mini" })
    expect(selectModel).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledTimes(2)

    subagent.click()
    document.querySelector<HTMLButtonElement>(".canvas-model-picker-disabled")?.click()
    expect(clearCoder).toHaveBeenCalledTimes(1)
    expect(selectModel).not.toHaveBeenCalled()

    primary.click()
    const primaryPopup = document.querySelector('[aria-label="Model model picker"]')
    if (!(primaryPopup instanceof HTMLElement)) throw new Error("primary model popup not found")
    const primaryItem = [...primaryPopup.querySelectorAll<HTMLButtonElement>(".canvas-model-picker-item")].find(
      (item) => item.textContent?.includes("Coder Mini"),
    )
    if (!primaryItem) throw new Error("primary model item not found")
    primaryItem.click()
    expect(selectModel).toHaveBeenCalledWith("acme:coder-mini")
    expect(setCoder).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  test("handles a Subagent model save failure without an unhandled rejection", async () => {
    const host = mountWorkspace("legacy session ui")
    const manager = (globalThis as { __CANVAS_MANAGER__?: {
      masterAgent: { coder: { set: (model: unknown) => Promise<void> } }
    } }).__CANVAS_MANAGER__
    if (!manager) throw new Error("canvas manager not found")
    const setCoder = mock(() => Promise.reject(new Error("offline")))
    manager.masterAgent.coder.set = setCoder

    const subagent = [...host.querySelectorAll(".canvas-model-picker-trigger")][1]
    if (!(subagent instanceof HTMLButtonElement)) throw new Error("subagent picker not found")
    subagent.click()
    const popup = [...document.querySelectorAll(".canvas-model-picker-pop")].find((item) =>
      item.querySelector(".canvas-model-picker-disabled"),
    )
    const item = [...(popup?.querySelectorAll<HTMLButtonElement>(".canvas-model-picker-item") ?? [])].find((entry) =>
      entry.textContent?.includes("Coder Mini"),
    )
    if (!item) throw new Error("subagent model not found")
    item.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setCoder).toHaveBeenCalledTimes(1)
  })

  test("shares the connected model catalog with the toolbar and master-agent blocks", () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    const host = mountWorkspace("legacy session ui")

    const picker = host.querySelector(".canvas-model-picker-trigger")
    if (!(picker instanceof HTMLButtonElement)) throw new Error("model picker not found")
    picker.click()

    expect(toolbarModelKeys()).toEqual(["acme:coder-mini", "openai:gpt-5"])
    expect(blockRenders.filter((entry) => entry.blockID !== "canvas-legacy").map((entry) => entry.modelKeys)).toEqual([
      ["acme:coder-mini", "openai:gpt-5"],
      ["acme:coder-mini", "openai:gpt-5"],
    ])
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

  test("renders two master-agent blocks with distinct identity and keeps the legacy chat card", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    console.log("STORAGE_BEFORE", localStorage.getItem(STORAGE_KEY))
    const host = mountWorkspace("legacy session ui")

    await new Promise((resolve) => setTimeout(resolve, 100))
    console.log("HOST_HTML_AFTER_TICK", host.innerHTML)
    console.log("RENDER_ERRORS", (globalThis as { __CANVAS_INTEGRATION_RENDER_ERRORS__?: string[] }).__CANVAS_INTEGRATION_RENDER_ERRORS__)
    const worldElement = host.querySelector(".canvas-world")
    console.log("WORLD_HTML", worldElement ? worldElement.innerHTML : "<no-world>")

    const cards = [...host.querySelectorAll(".canvas-card")]
    console.log("DOC_CARDS", [...document.querySelectorAll(".canvas-card")].length)
    const tracedState = (globalThis as { __CANVAS_INTEGRATION_STATE__?: { blocks: Array<unknown> } }).__CANVAS_INTEGRATION_STATE__
    console.log("STATE_BLOCKS", tracedState ? tracedState.blocks?.length : undefined, tracedState?.blocks)
    expect(cards).toHaveLength(3)
    expect(blockMock(host, "ma-1")).not.toBeNull()
    expect(blockMock(host, "ma-2")).not.toBeNull()

    const rendered = [...blockRenders].filter((entry) => entry.blockID !== "canvas-legacy")
    expect(rendered).toHaveLength(2)
    expect(rendered.map((entry) => entry.blockID).sort()).toEqual(["ma-1", "ma-2"])
    expect(rendered.map((entry) => entry.blockID).sort()).toEqual(["ma-1", "ma-2"])
    expect(rendered.every((entry) => entry.hasManager)).toBeTrue()
    // Nothing is focused at mount.
    expect(rendered.every((entry) => entry.focused === false)).toBeTrue()

    // Legacy chat regression: the routed session UI still renders in the
    // pinned legacy card, and the canvas still titles it "OpenCode".
    const legacyBody = host.querySelector(".canvas-legacy-body")
    expect(legacyBody?.textContent).toContain("legacy session ui")
    const titles = [...host.querySelectorAll(".canvas-card-title")].map((node) => node.textContent)
    expect(titles).toContain("OpenCode")
  })

  test("for loop shim sanity", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const Demo = () =>
      (
      <For each={[1, 2, 3]}>
          {(value) => <div class="mini-item" data-mini={value} />}
        </For>
      )
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
      blocks: [
        { id: "a" },
        { id: "b" },
        { id: "c" },
      ],
    })
    const Demo = () => (
      <For each={state.blocks}>
        {(value) => <div class="mini-item" data-mini={value.id} />}
      </For>
    )
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
    expect(payload.blocks.find((entry) => entry.id === "canvas-legacy")?.functionalityID).toBe("builtin:chat")
  })
})
