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
// Bun compiles JSX in this package with the classic React.createElement
// factory, so the workspace's internal JSX needs the React global shimmed
// with solid's hyperscript before it is rendered (same pattern as
// coder-selector.test.tsx / session-surface.test.tsx).
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
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment: "Fragment" }

const STORAGE_KEY = "opencode-canvas-v1"

;(globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__ = true

interface RecordedBlockProps {
  blockID: string
  focused: boolean
  hasManager: boolean
}

const blockRenders: RecordedBlockProps[] = []

// B3's block renderer is still in-flight; stand in with a recording fake that
// renders block identity/focus/manager and forwards canvas focus on click.
mock.module("./master-agent/block", () => {
  const MasterAgentBlock = (props: {
    blockID: string
    focused: boolean
    manager: unknown
    onFocus: () => void
  }) => {
    blockRenders.push({ blockID: props.blockID, focused: props.focused, hasManager: props.manager !== undefined })
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
  useProviders: () => ({ all: () => new Map(), connected: () => [] }),
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
    t: (key: string) => key,
    plural: (key: string, count: number) => `${key}.${count}`,
    language: "en",
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
  const element = host.querySelector(`[data-block-id="${id}"]`)
  if (!(element instanceof HTMLElement)) throw new Error(`block mock ${id} not found`)
  return element
}

beforeEach(() => {
  blockRenders.length = 0
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
