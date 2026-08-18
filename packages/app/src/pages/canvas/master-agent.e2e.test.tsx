// Track V3 — App canvas integration tests (master-agent e2e). Mounts the REAL
// canvas renderer (workspace.tsx), the REAL manager (manager.ts), the REAL
// block composition (master-agent/block.tsx), and the REAL multi-instance
// surface adapter (session-surface.tsx) together, with only the transport and
// the heavy U2 base surface stood in:
//   - "@/context/server-sdk"      -> controllable fake SDK (v2 workspace
//     endpoints + G1 masterAgent endpoints + event emitter). The manager's
//     M5 sdk-port (post-rebase) consumes client.workspace.masterAgent.*;
//     the fake auto-ensures bindings so the exact ensure-vs-refetch timing of
//     the in-flight M6 manager does not matter.
//   - "@/context/layout"          -> static project
//   - "@/hooks/use-providers"     -> no providers
//   - "@opencode-ai/ui/theme/context" -> static dark theme
//   - "../session-surface-base"   -> recording shell (U2's routed-surface
//     internals are covered by its own suite; here it records what the real
//     adapter delivers: target, surface identity, focus, queue flag).
//
// Everything else is real: manager state machines (lifecycle controller,
// event reconciliation, coder controller), the B1 shell, B2 Coder selector,
// Q1 session options, U3 session-scope/target providers, and the canvas
// layout/persistence path.
//
// Run: bun test --conditions=browser packages/app/src/pages/canvas/master-agent.e2e.test.tsx
// (same React-global shim + conditions=browser convention as
// coder-selector.test.tsx / session-surface.test.tsx / master-agent.integration.test.tsx).
//
// Rebase notes (listed in the V3 completion note):
//   - Canvas suite needs M6 to finish wiring M5's sdk-port into manager.ts
//     (the landed manager still falls back to unavailableMasterAgentPort).
//   - Blocks mount before connect() sets workspaceID, so the controller's
//     ensure no-ops; tests drive readiness through the real reconnect-refetch
//     path (window "online" -> M3 reconciliation -> authoritative get), which
//     is also the acceptance path for "missed events recover through get".
//   - The coder controller snapshots coderModel at first access (pre-connect),
//     so connect-time workspace coderModel seeding is not asserted at canvas
//     level; set/clear through the real selector is covered in the block suite.
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createComponent, createSignal, onCleanup } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import type { CanvasSessionSurfaceProps, SessionSurfaceTarget } from "./session-target"
import type { MasterAgentBlockProps, MasterAgentManagerApi } from "./master-agent/block"
import type { BindingState, MasterAgent, ModelSelection } from "./master-agent/types"

// Bun's TSX transform emits classic React.createElement calls, so shim the
// React global with solid's hyperscript before any JSX runs. Bun's transform
// also evaluates JSX props eagerly, so props are static snapshots: tests
// remount to change focused/busy state instead of updating signals.
function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

const Fragment = (props: { children?: unknown }) => props.children

;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

const STORAGE_KEY = "opencode-canvas-v1"
const WORKSPACE_ID = "ws-1"

// ---- Fake SDK -------------------------------------------------------------

interface FakeBindingRecord {
  binding: MasterAgent.Binding
  generation: number
}

interface ResetCall {
  blockID: string
  expectedSessionID: string
  expectedRevision: number
}

function createFakeServerSDK() {
  const bindings = new Map<string, FakeBindingRecord>()
  const ensureCalls: string[] = []
  const getCalls: string[] = []
  const resetCalls: ResetCall[] = []
  const savedLayouts: Array<Array<Record<string, unknown>>> = []
  const workspacePatches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const listeners = new Set<(entry: { type: string; details?: { type: string; properties?: unknown } }) => void>()
  let layoutGets = 0

  function bindingFor(blockID: string): MasterAgent.Binding {
    const existing = bindings.get(blockID)
    if (existing) return existing.binding
    // Idempotent ensure semantics (spec 02 §5/§6): repeated ensure for one
    // block returns the same binding. `get` auto-ensures too so the suite is
    // independent of whether ensure-on-mount or reconnect-refetch drives the
    // first authoritative read.
    const record: FakeBindingRecord = {
      generation: 1,
      binding: {
        workspaceID: WORKSPACE_ID,
        blockID,
        functionalityInstanceID: `fi-${blockID}`,
        sessionID: `sess-${blockID}-1`,
        directory: "C:/test-project",
        generation: 1,
        revision: 1,
      },
    }
    bindings.set(blockID, record)
    return record.binding
  }

  const masterAgent = {
    ensure: async (parameters: { workspaceID: string; blockID: string }) => {
      ensureCalls.push(parameters.blockID)
      return { data: bindingFor(parameters.blockID) }
    },
    get: async (parameters: { workspaceID: string; blockID: string }) => {
      getCalls.push(parameters.blockID)
      return { data: { status: "bound" as const, binding: bindingFor(parameters.blockID) } }
    },
    reset: async (parameters: {
      workspaceID: string
      blockID: string
      masterAgentResetPayload: { expectedSessionID: string; expectedRevision: number }
    }) => {
      const { blockID, masterAgentResetPayload } = parameters
      resetCalls.push({
        blockID,
        expectedSessionID: masterAgentResetPayload.expectedSessionID,
        expectedRevision: masterAgentResetPayload.expectedRevision,
      })
      const current = bindings.get(blockID)
      if (!current || current.binding.sessionID !== masterAgentResetPayload.expectedSessionID) {
        return { data: { status: "stale" as const } }
      }
      if (current.binding.revision !== masterAgentResetPayload.expectedRevision) {
        return { data: { status: "stale" as const } }
      }
      current.generation += 1
      current.binding = {
        ...current.binding,
        sessionID: `sess-${blockID}-${current.generation}`,
        generation: current.generation,
        revision: current.binding.revision + 1,
      }
      return { data: { status: "reset" as const, binding: current.binding } }
    },
  }

  const workspace = {
    masterAgent,
    update: async (parameters: { workspaceUpdatePayload: { id: string; patch: Record<string, unknown> } }) => {
      const { id, patch } = parameters.workspaceUpdatePayload
      workspacePatches.push({ id, patch })
      return { data: { model: "acme:primary", operatingAgent: null, coderModel: patch.coderModel ?? null } }
    },
  }

  const fake = {
    client: {
      v2: {
        workspace: {
          list: async () => ({ data: [{ id: WORKSPACE_ID }] }),
          get: async () => ({ data: { model: "acme:primary", operatingAgent: null, coderModel: null } }),
          create: async () => ({ data: { id: WORKSPACE_ID } }),
          update: workspace.update,
          layout: {
            get: async () => {
              layoutGets += 1
              // Pristine default layout: the manager keeps the client's
              // seeded blocks and pushes them once connected.
              return {
                data: {
                  blocks: [
                    { id: "default-chat", functionality: "builtin:chat", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
                  ],
                  revision: 1,
                },
              }
            },
            save: async (parameters: { workspaceLayoutSavePayload: { blocks: Array<Record<string, unknown>> } }) => {
              const blocks = parameters.workspaceLayoutSavePayload.blocks
              savedLayouts.push(blocks)
              return { data: { status: "saved" as const, layout: { blocks, revision: 2 } } }
            },
          },
        },
        relay: {
          dispose: async () => ({}),
        },
      },
      workspace,
    },
    createClient: () => ({
      config: {
        get: async () => ({ data: { permission: "allow" } }),
        update: async () => ({}),
      },
    }),
    event: {
      start: () => {},
      listen: (listener: (entry: { type: string; details?: { type: string; properties?: unknown } }) => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    fire(entry: { type: string; details: { type: string; properties?: unknown } }) {
      for (const listener of listeners) listener(entry)
    },
    reset() {
      bindings.clear()
      ensureCalls.length = 0
      getCalls.length = 0
      resetCalls.length = 0
      savedLayouts.length = 0
      workspacePatches.length = 0
      listeners.clear()
      layoutGets = 0
    },
    ensureCalls,
    getCalls,
    resetCalls,
    savedLayouts,
    workspacePatches,
    layoutGets: () => layoutGets,
  }
  return fake
}

const fakeSDK = createFakeServerSDK()

mock.module("@/context/layout", () => ({
  useLayout: () => ({ projects: { list: () => [{ worktree: "C:/test-project" }] } }),
}))

mock.module("@/context/server-sdk", () => ({
  useServerSDK: () => fakeSDK,
}))

mock.module("@/hooks/use-providers", () => ({
  useProviders: () => ({ all: () => new Map(), connected: () => [] }),
}))

mock.module("@opencode-ai/ui/theme/context", () => ({
  useTheme: () => ({ mode: () => "dark", setColorScheme: () => {} }),
}))

// ---- Real surface adapter, recording base ---------------------------------

interface RecordedBase {
  target: SessionSurfaceTarget
  surfaceID: string
  focused: boolean
  queueEnabled: boolean
  onFocus: () => void
  onRequestOpenFullPage?: () => void
}

const recordedBases: RecordedBase[] = []
let baseDisposals = 0

// U2's routed surface is exercised by its own suite (and pulls in the whole
// Session stack); stand in with a recording shell so the e2e can assert what
// the real U3 adapter delivers into the base: target, scoped surface identity,
// focus, and the Q1 queue flag.
mock.module("../session-surface-base", () => {
  const SessionSurfaceBase = (props: CanvasSessionSurfaceProps) => {
    recordedBases.push({
      target: props.target,
      surfaceID: props.surfaceID,
      focused: props.focused,
      queueEnabled: props.queueEnabled,
      onFocus: props.onFocus,
      onRequestOpenFullPage: props.onRequestOpenFullPage,
    })
    onCleanup(() => {
      baseDisposals += 1
    })
    return h("div", {
      "data-base-surface-id": props.surfaceID,
      "data-base-session-id": props.target.sessionID,
      "data-base-focused": props.focused,
      "data-base-queue": props.queueEnabled,
    })
  }
  return { SessionSurfaceBase }
})

interface WorkspaceModule {
  CanvasWorkspace: (props: { children?: unknown }) => unknown
}

let workspaceModule: WorkspaceModule
let MasterAgentBlock: typeof import("./master-agent/block")["MasterAgentBlock"]

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
  MasterAgentBlock = (await import("./master-agent/block")).MasterAgentBlock
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
  // `h` returns a renderable thunk; render() evaluates the wrapper and insert
  // evaluates the thunk as an accessor inside the reactive root. The cast
  // reconciles hyperscript's opaque thunk type with render's `() => Element`.
  const dispose = render(() => h(workspaceModule.CanvasWorkspace as never, { children }) as never, host)
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

function shellIn(cardElement: HTMLElement): HTMLElement {
  const element = cardElement.querySelector(".master-agent-shell")
  if (!(element instanceof HTMLElement)) throw new Error("master-agent shell not found")
  return element
}

function surfaceRoot(host: HTMLElement, surfaceID: string): HTMLElement {
  const element = host.querySelector(`[data-surface-id="${surfaceID}"]`)
  if (!(element instanceof HTMLElement)) throw new Error(`surface ${surfaceID} not found`)
  return element
}

function resetButton(cardElement: HTMLElement): HTMLButtonElement {
  const button = cardElement.querySelector<HTMLButtonElement>(".master-agent-button.primary")
  if (!button) throw new Error("reset button not found")
  return button
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function fireBindingUpdated(blockID: string, sessionID: string, revision: number, workspaceID = WORKSPACE_ID) {
  // ServerSDK event wire shape: `details.type` + `details.properties` (the
  // manager's config/layout listeners read `entry.details.type` directly).
  const type = "workspace.master-agent.binding.updated"
  const properties = { workspaceID, blockID, sessionID, generation: 1, revision }
  fakeSDK.fire({ type, details: { type, properties } })
}

// Blocks mount before connect() resolves workspaceID, so the controller's
// ensure no-ops; readiness is driven through the real reconnect path: window
// "online" -> markConnected -> M3 reconciliation refetch -> authoritative get.
async function bringBlocksToReady(host: HTMLElement, blockIDs: string[]) {
  await waitFor(() => fakeSDK.layoutGets() >= 1)
  // Let connect() finish markConnected() before firing the reconnect path.
  await flush()
  window.dispatchEvent(new Event("online"))
  await waitFor(() =>
    blockIDs.every((id) => {
      const element = host.querySelector(`[data-card-id="${id}"] .master-agent-shell`)
      return element instanceof HTMLElement && element.dataset.status === "ready"
    }),
  )
}

function lastRecordFor(surfaceID: string): RecordedBase | undefined {
  let last: RecordedBase | undefined
  for (const entry of recordedBases) {
    if (entry.surfaceID === surfaceID) last = entry
  }
  return last
}

beforeEach(() => {
  fakeSDK.reset()
  recordedBases.length = 0
  baseDisposals = 0
  localStorage.clear()
})

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
  document.body.innerHTML = ""
  localStorage.clear()
})

// ---- Canvas-level e2e: real workspace + real manager + real block ---------

describe("master-agent canvas e2e (real renderer)", () => {
  test("renders two master-agent cards with the real shell and isolated scoped surfaces; legacy chat unaffected", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    const host = mountWorkspace("legacy session ui")
    await bringBlocksToReady(host, ["ma-1", "ma-2"])

    const cards = [...host.querySelectorAll(".canvas-card")]
    expect(cards).toHaveLength(3)

    const first = shellIn(card(host, "ma-1"))
    const second = shellIn(card(host, "ma-2"))
    expect(first.dataset.status).toBe("ready")
    expect(second.dataset.status).toBe("ready")
    expect(card(host, "ma-1").querySelector(".master-agent-session-slot")).not.toBeNull()

    // Distinct, scoped surfaces: unique surface ids, session ids, and DOM roots.
    const surfaceA = surfaceRoot(host, "master-agent-ma-1")
    const surfaceB = surfaceRoot(host, "master-agent-ma-2")
    expect(surfaceA.dataset.sessionId).toBe("sess-ma-1-1")
    expect(surfaceB.dataset.sessionId).toBe("sess-ma-2-1")
    expect(surfaceA.dataset.sessionId).not.toBe(surfaceB.dataset.sessionId)
    expect(document.getElementById("canvas-session-master-agent-ma-1-root")).toBe(surfaceA)
    expect(document.getElementById("canvas-session-master-agent-ma-2-root")).toBe(surfaceB)
    expect(surfaceA.dataset.focused).toBe("false")
    expect(surfaceB.dataset.focused).toBe("false")

    // The real block delivered the binding target into the real adapter.
    expect(recordedBases).toHaveLength(2)
    expect(recordedBases[0]?.target).toEqual({
      sessionID: "sess-ma-1-1",
      directory: "C:/test-project",
      workspaceID: WORKSPACE_ID,
    })
    expect(recordedBases[1]?.target.sessionID).toBe("sess-ma-2-1")
    expect(recordedBases[0]?.surfaceID).toBe("master-agent-ma-1")
    expect(recordedBases[1]?.surfaceID).toBe("master-agent-ma-2")
    // Idle host session: the Q1 queue action stays hidden.
    expect(recordedBases.every((entry) => entry.queueEnabled === false)).toBeTrue()

    // Card chrome comes from the I1 descriptor; the legacy routed slot is intact.
    const titles = [...host.querySelectorAll(".canvas-card-title")].map((node) => node.textContent)
    expect(titles).toContain("Master Agent")
    expect(titles).toContain("OpenCode")
    expect(host.querySelector(".canvas-legacy-body")?.textContent).toContain("legacy session ui")

    // Workspace-wide Coder selector: identical disabled view in every block.
    for (const id of ["ma-1", "ma-2"]) {
      const coder = card(host, id).querySelector(".master-agent-coder")
      expect(coder?.getAttribute("data-state")).toBe("disabled")
      expect(coder?.textContent).toContain("Workspace-wide")
      expect(coder?.textContent).toContain("Disabled — no Coder model selected")
    }
  })

  test("reconnect refetch recovers bindings authoritatively, exactly once per reconnect", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40)])
    const host = mountWorkspace("legacy session ui")
    await bringBlocksToReady(host, ["ma-1"])
    expect(fakeSDK.getCalls.filter((id) => id === "ma-1")).toHaveLength(1)

    window.dispatchEvent(new Event("online"))
    await waitFor(() => fakeSDK.getCalls.filter((id) => id === "ma-1").length >= 2)
    await flush()

    // Same binding, same session: the surface re-rendered in place, never
    // remounted (no base disposal) and no duplicate session was created.
    expect(surfaceRoot(host, "master-agent-ma-1").dataset.sessionId).toBe("sess-ma-1-1")
    expect(baseDisposals).toBe(0)
    expect(recordedBases.map((entry) => entry.target.sessionID)).toEqual(["sess-ma-1-1", "sess-ma-1-1"])
    // A ready block is never re-ensured (idempotent lifecycle).
    expect(fakeSDK.ensureCalls.filter((id) => id === "ma-1").length).toBeLessThanOrEqual(1)
  })

  test("binding events: newer revision re-targets, stale and foreign-workspace events are ignored", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    const host = mountWorkspace("legacy session ui")
    await bringBlocksToReady(host, ["ma-1", "ma-2"])

    fireBindingUpdated("ma-1", "sess-ma-1-e2", 2)
    await flush()
    expect(surfaceRoot(host, "master-agent-ma-1").dataset.sessionId).toBe("sess-ma-1-e2")
    expect(surfaceRoot(host, "master-agent-ma-2").dataset.sessionId).toBe("sess-ma-2-1")

    // Stale revision: ignored by the M3 reconciliation + M1 reducer.
    fireBindingUpdated("ma-1", "sess-stale", 1)
    await flush()
    expect(surfaceRoot(host, "master-agent-ma-1").dataset.sessionId).toBe("sess-ma-1-e2")

    // Event for another workspace: ignored by the manager.
    fireBindingUpdated("ma-1", "sess-other-ws", 9, "ws-other")
    await flush()
    expect(surfaceRoot(host, "master-agent-ma-1").dataset.sessionId).toBe("sess-ma-1-e2")

    // Event handling never issues lifecycle requests.
    const getsBefore = fakeSDK.getCalls.length
    const ensuresBefore = fakeSDK.ensureCalls.length
    expect(fakeSDK.getCalls.length).toBe(getsBefore)
    expect(fakeSDK.ensureCalls.length).toBe(ensuresBefore)
  })

  test("reset affects one block and forwards the expected binding values through the manager", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    const host = mountWorkspace("legacy session ui")
    await bringBlocksToReady(host, ["ma-1", "ma-2"])

    resetButton(card(host, "ma-1")).click()
    await waitFor(() => fakeSDK.resetCalls.length === 1)
    await flush()

    expect(fakeSDK.resetCalls).toEqual([
      { blockID: "ma-1", expectedSessionID: "sess-ma-1-1", expectedRevision: 1 },
    ])
    // Only the reset block re-targets; the sibling keeps its session and revision.
    expect(surfaceRoot(host, "master-agent-ma-1").dataset.sessionId).toBe("sess-ma-1-2")
    expect(surfaceRoot(host, "master-agent-ma-2").dataset.sessionId).toBe("sess-ma-2-1")
    expect(shellIn(card(host, "ma-2")).dataset.status).toBe("ready")
    expect(lastRecordFor("master-agent-ma-1")?.target.sessionID).toBe("sess-ma-1-2")
    expect(lastRecordFor("master-agent-ma-2")?.target.sessionID).toBe("sess-ma-2-1")
  })

  test("layout serialization and local persistence carry presentation only — never session binding or queue state", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40)])
    const host = mountWorkspace("legacy session ui")
    await bringBlocksToReady(host, ["ma-1"])

    // Focus the block via its shell (bringToFront -> saveSoon -> persist +
    // manager.sync); the card section itself has no click handler.
    shellIn(card(host, "ma-1")).click()
    await waitFor(() => fakeSDK.savedLayouts.length >= 1)

    const payload = fakeSDK.savedLayouts[fakeSDK.savedLayouts.length - 1]!
    const serialized = JSON.stringify(payload)
    for (const forbidden of [
      "sessionID",
      "sessionBinding",
      "functionalityInstanceID",
      "generation",
      "revision",
      "queue",
      "coderModel",
      "directory",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    const masterAgentRecord = payload.find((record) => record.functionality === "builtin:master-agent")
    expect(masterAgentRecord).toBeDefined()
    expect(masterAgentRecord!.id).toBe("ma-1")
    const transform = masterAgentRecord!.transform as Record<string, unknown>
    expect(typeof transform.x).toBe("number")
    expect(typeof transform.y).toBe("number")
    expect(typeof transform.w).toBe("number")
    expect(typeof transform.h).toBe("number")
    // The pinned legacy chat card still participates in the layout.
    expect(payload.some((record) => record.functionality === "builtin:chat")).toBeTrue()

    const local = JSON.stringify(JSON.parse(localStorage.getItem(STORAGE_KEY)!))
    for (const forbidden of ["sessionID", "sessionBinding", "functionalityInstanceID", "revision", "queue", "coderModel"]) {
      expect(local).not.toContain(forbidden)
    }
  })

  test("removing a block drops only its local projection; the sibling stays bound and the host session is untouched", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    const host = mountWorkspace("legacy session ui")
    await bringBlocksToReady(host, ["ma-1", "ma-2"])
    const getCallsBefore = fakeSDK.getCalls.length
    const ensureCallsBefore = fakeSDK.ensureCalls.length

    const remove = card(host, "ma-1").querySelector<HTMLButtonElement>('button[aria-label="Remove block"]')
    expect(remove).not.toBeNull()
    remove!.click()
    await flush()

    expect(host.querySelector('[data-card-id="ma-1"]')).toBeNull()
    expect(shellIn(card(host, "ma-2")).dataset.status).toBe("ready")
    expect(surfaceRoot(host, "master-agent-ma-2").dataset.sessionId).toBe("sess-ma-2-1")
    // No lifecycle or host calls fired for removal: projection-only cleanup.
    expect(fakeSDK.getCalls.length).toBe(getCallsBefore)
    expect(fakeSDK.ensureCalls.length).toBe(ensureCallsBefore)
    expect(fakeSDK.resetCalls).toEqual([])
    // The removed surface unmounted; the sibling's surface stayed bound.
    expect(baseDisposals).toBe(1)
    expect(lastRecordFor("master-agent-ma-2")?.target.sessionID).toBe("sess-ma-2-1")
  })

  test("remount (reload projection) preserves the host binding and session identity", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40)])
    const first = mountWorkspace("legacy session ui")
    await bringBlocksToReady(first, ["ma-1"])
    expect(surfaceRoot(first, "master-agent-ma-1").dataset.sessionId).toBe("sess-ma-1-1")

    // Full reload: dispose the workspace (manager disposal) and remount.
    while (disposers.length > 0) disposers.pop()?.()
    document.body.innerHTML = ""
    recordedBases.length = 0
    baseDisposals = 0

    const second = mountWorkspace("legacy session ui")
    await bringBlocksToReady(second, ["ma-1"])
    // The host binding survived: same session id, no second session created.
    expect(surfaceRoot(second, "master-agent-ma-1").dataset.sessionId).toBe("sess-ma-1-1")
    expect(recordedBases[0]?.target.sessionID).toBe("sess-ma-1-1")
  })

  test("focus handover flows through the real surface adapter into canvas selection", async () => {
    seedBlocks([masterAgentBlock("ma-1", 40, 40), masterAgentBlock("ma-2", 520, 40)])
    const host = mountWorkspace("legacy session ui")
    await bringBlocksToReady(host, ["ma-1", "ma-2"])

    expect(card(host, "ma-1").classList.contains("selected")).toBeFalse()
    expect(card(host, "ma-2").classList.contains("selected")).toBeFalse()

    surfaceRoot(host, "master-agent-ma-1").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    await flush()
    expect(card(host, "ma-1").classList.contains("selected")).toBeTrue()
    expect(card(host, "ma-2").classList.contains("selected")).toBeFalse()
    expect(surfaceRoot(host, "master-agent-ma-1").dataset.focused).toBe("true")

    surfaceRoot(host, "master-agent-ma-2").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    await flush()
    expect(card(host, "ma-2").classList.contains("selected")).toBeTrue()
    expect(card(host, "ma-1").classList.contains("selected")).toBeFalse()
    expect(surfaceRoot(host, "master-agent-ma-2").dataset.focused).toBe("true")
  })
})

// ---- Block-level e2e: real block + real surface adapter + local fake manager
//
// The canvas does not inject a busy signal, so queue gating, ensure-on-mount,
// projection-only unmount, and Coder set/clear are verified here through the
// REAL block renderer, REAL session options, REAL Coder selector, and REAL U3
// surface adapter, with only the manager stood in (per plan §16 — manager.ts
// is M6's in-flight file). These tests run against today's landed shape.

const coderMini: ModelSelection = { providerID: "acme", modelID: "coder-mini" }
const coderPro: ModelSelection = { providerID: "acme", modelID: "coder-pro" }

function binding(blockID: string, sessionID: string, revision = 1): MasterAgent.Binding {
  return {
    workspaceID: WORKSPACE_ID,
    blockID,
    functionalityInstanceID: `fi-${blockID}`,
    sessionID,
    directory: "/repo/main",
    generation: 1,
    revision,
  }
}

type StateSignal = ReturnType<typeof createSignal<BindingState>>

interface FakeManager {
  manager: MasterAgentManagerApi
  setState(blockID: string, next: BindingState): void
  setCoderModel(model: ModelSelection | null): void
  ensureCalls: string[]
  resetCalls: string[]
  removalCalls: string[]
  coderSet: ModelSelection[]
  coderClearCalls: () => number
}

function createFakeManager(initial: Record<string, BindingState> = {}): FakeManager {
  const ensureCalls: string[] = []
  const resetCalls: string[] = []
  const removalCalls: string[] = []
  const coderSet: ModelSelection[] = []
  let coderClearCount = 0
  const [coderModel, setCoderModel] = createSignal<ModelSelection | null>(null)
  const [coderPending, setCoderPending] = createSignal(false)
  const [coderError, setCoderError] = createSignal<unknown | null>(null)
  const states = new Map<string, StateSignal>()
  for (const [blockID, value] of Object.entries(initial)) states.set(blockID, createSignal(value))

  const manager: MasterAgentManagerApi = {
    state(blockID) {
      let entry = states.get(blockID)
      if (!entry) {
        entry = createSignal<BindingState>({ status: "uninitialized" })
        states.set(blockID, entry)
      }
      return entry[0]
    },
    ensure: (blockID) => {
      ensureCalls.push(blockID)
      return Promise.resolve()
    },
    retry: (blockID) => {
      ensureCalls.push(blockID)
      return Promise.resolve()
    },
    reset: (blockID) => {
      resetCalls.push(blockID)
      return Promise.resolve()
    },
    removeLocalProjection: (blockID) => {
      removalCalls.push(blockID)
    },
    coder: {
      model: coderModel,
      pending: coderPending,
      error: coderError,
      set: (model) => {
        coderSet.push(model)
        // Mirror the real controller's optimistic model update.
        setCoderModel(model)
        return Promise.resolve()
      },
      clear: () => {
        coderClearCount += 1
        setCoderModel(null)
        return Promise.resolve()
      },
      retry: () => Promise.resolve(),
    },
  }

  return {
    manager,
    setState(blockID, next) {
      const entry = states.get(blockID)
      if (entry) entry[1](next)
    },
    setCoderModel,
    ensureCalls,
    resetCalls,
    removalCalls,
    coderSet,
    coderClearCalls: () => coderClearCount,
  }
}

function mountBlock(fake: FakeManager, overrides: Partial<MasterAgentBlockProps> = {}) {
  const calls = { focus: 0 }
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () => (
      <MasterAgentBlock
        blockID="b1"
        focused={false}
        manager={fake.manager}
        onFocus={() => {
          calls.focus += 1
        }}
        {...overrides}
      />
    ),
    host,
  )
  disposers.push(() => {
    dispose()
    host.remove()
  })
  return { container: host, dispose, focusCalls: () => calls.focus }
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === text,
  )
  if (!button) throw new Error(`button "${text}" not found`)
  return button
}

describe("master-agent block e2e (real block renderer, local fake manager)", () => {
  test("ensure runs once per mount; queue gating follows host busy state through the real surface", async () => {
    const fake = createFakeManager({ b1: { status: "ready", binding: binding("b1", "sess-1") } })

    const busy = mountBlock(fake, { sessionBusy: () => true })
    await flush()
    expect(fake.ensureCalls).toEqual(["b1"])
    // Busy: the real Q1 options expose the queue action; reset is disabled.
    expect(recordedBases[0]?.queueEnabled).toBe(true)
    expect(recordedBases[0]?.target.sessionID).toBe("sess-1")
    expect(recordedBases[0]?.surfaceID).toBe("master-agent-b1")
    expect(resetButton(busy.container).disabled).toBeTrue()
    expect(busy.container.textContent).toContain("Session is busy")
    resetButton(busy.container).click()
    expect(fake.resetCalls).toEqual([])
    busy.dispose()

    const idle = mountBlock(fake, { sessionBusy: () => false })
    await flush()
    // Idle: queue hidden, reset enabled and routed through the manager.
    expect(recordedBases[1]?.queueEnabled).toBe(false)
    expect(resetButton(idle.container).disabled).toBeFalse()
    resetButton(idle.container).click()
    expect(fake.resetCalls).toEqual(["b1"])
  })

  test("unmount is projection-only: local projection dropped, no host session or queue call", async () => {
    const fake = createFakeManager({ b1: { status: "ready", binding: binding("b1", "sess-1") } })
    const mounted = mountBlock(fake)
    await flush()
    expect(fake.ensureCalls).toEqual(["b1"])
    expect(fake.removalCalls).toEqual([])

    mounted.dispose()
    expect(fake.removalCalls).toEqual(["b1"])
    // Nothing else touched the (fake) host: no reset, no retry, no second ensure.
    expect(fake.ensureCalls).toEqual(["b1"])
    expect(fake.resetCalls).toEqual([])
    expect(baseDisposals).toBe(1)
  })

  test("workspace-wide Coder selection updates every mounted block view through the manager", async () => {
    const fake = createFakeManager({
      A: { status: "ready", binding: binding("A", "sess-A") },
      B: { status: "ready", binding: binding("B", "sess-B") },
    })
    const a = mountBlock(fake, { blockID: "A", models: [coderMini, coderPro] })
    const b = mountBlock(fake, { blockID: "B", models: [coderMini, coderPro] })
    await flush()
    expect(recordedBases.map((entry) => entry.surfaceID)).toEqual(["master-agent-A", "master-agent-B"])

    // Set through block A's real selector; the manager view model fans out.
    buttonByText(a.container, "Choose model").click()
    buttonByText(a.container, "acme/coder-mini").click()
    expect(fake.coderSet).toEqual([coderMini])
    await flush()
    expect(a.container.querySelector(".master-agent-coder-current")?.textContent).toBe("acme/coder-mini")
    expect(b.container.querySelector(".master-agent-coder-current")?.textContent).toBe("acme/coder-mini")

    // Clear through block B's real selector; every block returns to disabled.
    const clear = b.container.querySelector<HTMLButtonElement>('[aria-label="Clear Coder model"]')
    expect(clear).not.toBeNull()
    clear!.click()
    expect(fake.coderClearCalls()).toBe(1)
    await flush()
    expect(a.container.querySelector(".master-agent-coder")?.getAttribute("data-state")).toBe("disabled")
    expect(b.container.querySelector(".master-agent-coder")?.getAttribute("data-state")).toBe("disabled")
  })

  test("focus reaches the real surface adapter and is not re-broadcast when already focused", async () => {
    const fake = createFakeManager({ b1: { status: "ready", binding: binding("b1", "sess-1") } })

    const focused = mountBlock(fake, { focused: true })
    await flush()
    expect(recordedBases[0]?.focused).toBe(true)
    expect(focused.container.querySelector(".canvas-session-surface")?.getAttribute("data-focused")).toBe("true")
    surfaceRoot(focused.container, "master-agent-b1").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    expect(focused.focusCalls()).toBe(0)
    focused.dispose()

    const unfocused = mountBlock(fake, { focused: false })
    await flush()
    expect(recordedBases[1]?.focused).toBe(false)
    surfaceRoot(unfocused.container, "master-agent-b1").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    expect(unfocused.focusCalls()).toBe(1)
  })
})
