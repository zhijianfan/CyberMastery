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
import { render } from "solid-js/web"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next: Record<string, unknown> = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

;(globalThis as unknown as { React: unknown }).React = { createElement }

const STORAGE_KEY = "opencode-canvas-v1"

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
}))

mock.module("@/context/server-sdk", () => ({
  useServerSDK: () => ({
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
  }),
}))

mock.module("@/hooks/use-providers", () => ({
  useProviders: () => ({ all: () => new Map(), connected: () => [] }),
}))

mock.module("@opencode-ai/ui/theme/context", () => ({
  useTheme: () => ({ mode: () => "dark", setColorScheme: () => {} }),
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
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => h(workspaceModule.CanvasWorkspace as never, { children }), host)
  disposers.push(() => {
    dispose()
    host.remove()
  })
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
  test("renders two master-agent blocks with distinct identity and keeps the legacy chat card", () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    const host = mountWorkspace("legacy session ui")

    const cards = [...host.querySelectorAll(".canvas-card")]
    expect(cards).toHaveLength(3)
    expect(blockMock(host, "ma-1")).not.toBeNull()
    expect(blockMock(host, "ma-2")).not.toBeNull()

    const rendered = [...blockRenders]
    expect(rendered).toHaveLength(2)
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
    const host = mountWorkspace("legacy session ui")

    // Trigger a canvas save by focusing the block (bringToFront -> saveSoon).
    blockMock(host, "ma-1").click()
    await new Promise((resolve) => setTimeout(resolve, 250))

    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw!) as { blocks: Record<string, unknown>[] }
    const block = payload.blocks.find((entry) => entry.type === "master-agent")
    expect(block).toBeDefined()

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
    // Presentation fields are present and numeric.
    expect(block!.id).toBe("ma-1")
    expect(typeof block!.x).toBe("number")
    expect(typeof block!.y).toBe("number")
    expect(typeof block!.w).toBe("number")
    expect(typeof block!.h).toBe("number")
    expect(typeof block!.z).toBe("number")
    // The pinned legacy chat card never enters the serialized layout.
    expect(payload.blocks.some((entry) => entry.type === "legacy")).toBeFalse()
  })
})
