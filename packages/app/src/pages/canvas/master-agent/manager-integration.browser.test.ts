// Track M6 — Canvas Manager integration tests. Exercises the composed
// MasterAgent surface on createCanvasManager: per-block lifecycle controllers,
// binding-event reconciliation (buffering, staleness, reconnect), workspace
// switch isolation, the workspace-wide shared Coder controller, and disposal.
// The fake SDK is injected through the manager's serverSDK seam; the fake port
// stands in for M5's sdk-port factory.

import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import type { ServerSDK } from "@/context/server-sdk"
import type { WorkspaceBlockRecord, WorkspaceFunctionalityInfo } from "@opencode-ai/sdk/v2/client"
import { createCanvasManager, isPristineDefault, type CanvasManager, type CanvasManagerInput } from "../manager"
import type { BindingState, MasterAgent, MasterAgentPort, ModelSelection, WorkspaceInfo } from "./types"

function binding(
  workspaceID: string,
  blockID: string,
  overrides: Partial<MasterAgent.Binding> = {},
): MasterAgent.Binding {
  return {
    workspaceID,
    blockID,
    functionalityInstanceID: `fi-${blockID}`,
    sessionID: `session-${blockID}`,
    directory: "/repo",
    generation: 1,
    revision: 1,
    ...overrides,
  }
}

function record(blockID: string, functionality = "builtin:master-agent"): WorkspaceBlockRecord {
  return { id: blockID, functionality, transform: { x: 0, y: 0, w: 440, h: 500, z: 1 } }
}

interface PortCall {
  method: "get" | "ensure" | "reset" | "patchCoderModel"
  workspaceID: string
  blockID?: string
  model?: ModelSelection | null
}

interface WorkspaceCall {
  method:
    | "list"
    | "get"
    | "create"
    | "update"
    | "layout-get"
    | "layout-save"
    | "functionality-list"
    | "chatRelay-get"
  workspaceID?: string
}

type WorkspaceRecord = {
  id: string
  name: string
  style: string
  directories: string[]
  pluginIDs: string[]
  skillIDs: string[]
}

type WorkspaceInfoResponse = {
  data: {
    id: string
    name: string
    style: string
    directories: string[]
    pluginIDs: string[]
    skillIDs: string[]
    operatingAgent: string | null
    model: string | null
    coderModel: string | null
    git: []
    time: { created: number; updated: number }
  }
}

type WorkspaceUpdatePayload = {
  workspaceUpdatePayload: { id: string; patch: { operatingAgent?: string; model?: string; directories?: string[] } }
}
type LayoutResponse = { data: { blocks: WorkspaceBlockRecord[]; revision: number } }
type LayoutSaveResponse = {
  data: { status: "saved" | "handed-over" | "conflict"; layout: { blocks: WorkspaceBlockRecord[]; revision: number } }
}

function workspaceRow(id: string): WorkspaceRecord {
  return { id, name: "Default", style: "default", directories: [], pluginIDs: [], skillIDs: [] }
}

function workspaceInfo(
  id: string,
  overrides: Partial<WorkspaceInfoResponse["data"]> = {},
): WorkspaceInfoResponse {
  return {
    data: {
      ...workspaceRow(id),
      operatingAgent: null,
      model: null,
      coderModel: null,
      git: [],
      time: { created: 0, updated: 0 },
      ...overrides,
    },
  }
}

interface WorkspaceHandlers {
  list?: () => Promise<{ data: WorkspaceRecord[] }>
  get?: (input: { id: string }) => Promise<WorkspaceInfoResponse>
  create?: () => Promise<{ data: { id: string } }>
  update?: (input: WorkspaceUpdatePayload) => Promise<{ data: {} }>
  layoutGet?: (input: { workspaceID: string }) => Promise<LayoutResponse>
  layoutSave?: (input: { workspaceID: string; blocks: WorkspaceBlockRecord[] }) => Promise<LayoutSaveResponse>
  functionalityList?: (input: { workspaceID: string }) => Promise<{ data: WorkspaceFunctionalityInfo[] }>
  chatRelayGet?: () => Promise<{
    data: { status: "bound" | "unbound"; binding?: { revision: number; sessionID: string } }
  }>
}

function createFakePort() {
  const calls: PortCall[] = []
  const bindings = new Map<string, MasterAgent.Binding>()
  let nextRevision = 1
  let coderModel: ModelSelection | null = null
  let failNextPatch = false
  let pendingPatch: PromiseWithResolvers<WorkspaceInfo> | undefined

  const port: MasterAgentPort = {
    get: async (workspaceID, blockID) => {
      calls.push({ method: "get", workspaceID, blockID })
      return bindings.get(blockID) ?? null
    },
    ensure: async (workspaceID, blockID) => {
      calls.push({ method: "ensure", workspaceID, blockID })
      const existing = bindings.get(blockID)
      if (existing) return existing
      const created = binding(workspaceID, blockID, { revision: nextRevision++ })
      bindings.set(blockID, created)
      return created
    },
    reset: async (input) => {
      calls.push({ method: "reset", workspaceID: input.workspaceID, blockID: input.blockID })
      const current = bindings.get(input.blockID)
      if (!current || current.sessionID !== input.expectedSessionID || current.revision !== input.expectedRevision) {
        throw Object.assign(new Error("stale binding"), { type: "stale-binding", current })
      }
      const fresh = binding(input.workspaceID, input.blockID, {
        sessionID: `session-${input.blockID}-fresh`,
        revision: nextRevision++,
      })
      bindings.set(input.blockID, fresh)
      return fresh
    },
    patchCoderModel: async (workspaceID, model) => {
      calls.push({ method: "patchCoderModel", workspaceID, model })
      if (pendingPatch) {
        const pending = pendingPatch
        pendingPatch = undefined
        return pending.promise
      }
      if (failNextPatch) {
        failNextPatch = false
        throw new Error("patch failed")
      }
      coderModel = model
      const info: WorkspaceInfo = { model: coderModel, operatingAgent: null, coderModel }
      return info
    },
  }

  return {
    port,
    calls,
    bindings,
    setCoderModel: (model: ModelSelection | null) => {
      coderModel = model
    },
    failNextPatch() {
      failNextPatch = true
    },
    deferNextPatch() {
      pendingPatch = Promise.withResolvers<WorkspaceInfo>()
      return pendingPatch
    },
  }
}

function createFakeSDK(workspace: { coderModel?: string | null }, handlers: WorkspaceHandlers = {}) {
  const listeners = new Set<(entry: unknown) => void>()
  const calls: WorkspaceCall[] = []
  const workspaceRecord: WorkspaceRecord = {
    id: "ws-1",
    name: "Default",
    style: "default",
    directories: [],
    pluginIDs: [],
    skillIDs: [],
  }
  const workspacePayload: WorkspaceInfoResponse["data"] = {
    ...workspaceRecord,
    operatingAgent: null,
    model: null,
    coderModel: workspace.coderModel ?? null,
    git: [],
    time: { created: 0, updated: 0 },
  }

  const workspaceAPI = {
    list: async () => {
      calls.push({ method: "list" })
      if (handlers.list) return handlers.list()
      return { data: [workspaceRecord] }
    },
    get: async (input: { id: string }) => {
      calls.push({ method: "get", workspaceID: input.id })
      if (handlers.get) return handlers.get(input)
      return { data: workspacePayload }
    },
    create: async () => {
      calls.push({ method: "create" })
      if (handlers.create) return handlers.create()
      return { data: { id: "ws-1" } }
    },
    update: async (input: WorkspaceUpdatePayload) => {
      calls.push({ method: "update", workspaceID: input.workspaceUpdatePayload.id })
      if (handlers.update) return handlers.update(input)
      return { data: {} }
    },
    layoutGet: async (input: { workspaceID: string }) => {
      calls.push({ method: "layout-get", workspaceID: input.workspaceID })
      if (handlers.layoutGet) return handlers.layoutGet(input)
      return { data: { blocks: [], revision: 1 } }
    },
    layoutSave: async (input: { workspaceID: string; blocks: WorkspaceBlockRecord[] }) => {
      calls.push({ method: "layout-save", workspaceID: input.workspaceID })
      if (handlers.layoutSave) return handlers.layoutSave(input)
      return { data: { status: "saved", layout: { blocks: [], revision: 1 } } }
    },
    functionalityList: async (input: { workspaceID: string }) => {
      calls.push({ method: "functionality-list", workspaceID: input.workspaceID })
      if (handlers.functionalityList) return handlers.functionalityList(input)
      return { data: [] }
    },
    chatRelayGet: async () => {
      calls.push({ method: "chatRelay-get" })
      if (handlers.chatRelayGet) return handlers.chatRelayGet()
      return { data: { status: "unbound" } }
    },
  }

  const sdk = {
    client: {
      v2: {
        workspace: {
          list: async () => workspaceAPI.list(),
          get: async (input: { id: string }) => workspaceAPI.get(input),
          create: async () => workspaceAPI.create(),
          update: async (input: WorkspaceUpdatePayload) => workspaceAPI.update(input),
          layout: {
            get: async (input: { workspaceLayoutGetPayload: { workspaceID: string } }) =>
              workspaceAPI.layoutGet({ workspaceID: input.workspaceLayoutGetPayload.workspaceID }),
            save: async (input: { workspaceLayoutSavePayload: { workspaceID: string; blocks: WorkspaceBlockRecord[] } }) =>
              workspaceAPI.layoutSave({
                workspaceID: input.workspaceLayoutSavePayload.workspaceID,
                blocks: input.workspaceLayoutSavePayload.blocks,
              }),
          },
          functionality: {
            list: async (input: { workspaceID: string }) => workspaceAPI.functionalityList(input),
          },
          chatRelay: {
            get: async () => workspaceAPI.chatRelayGet(),
          },
        },
        relay: { dispose: async () => ({ data: {} }) },
      },
    },
    event: {
      start: async () => undefined,
      listen: (listener: (entry: unknown) => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      on: () => () => {},
    },
    createClient: () => ({ config: { get: async () => ({ data: { permission: "deny" } }) } }),
  } as unknown as ServerSDK

  return {
    sdk,
    calls,
    workspace: workspaceAPI,
    emit(entry: { type: string; properties?: unknown }) {
      // The real ServerSDK emitter wraps every event as `{ name, details }`
      // with details carrying `type` + `properties`; deliver the same wire
      // shape the manager's reconciliation listener consumes.
      const payload = { name: entry.type, details: { type: entry.type, properties: entry.properties } }
      for (const listener of [...listeners]) listener(payload)
    },
  }
}

function bindingUpdated(
  workspaceID: string,
  blockID: string,
  overrides: Partial<MasterAgent.BindingUpdatedEvent> = {},
) {
  return {
    type: "workspace.master-agent.binding.updated",
    properties: {
      workspaceID,
      blockID,
      sessionID: `session-${blockID}-2`,
      generation: 2,
      revision: 2,
      ...overrides,
    },
  }
}

function createEnv({
  coderModel,
  workspace: workspaceHandlers,
  onWorkspaceInvalidated,
  onServerLayout,
  notify,
}: {
  coderModel?: string | null
  workspace?: WorkspaceHandlers
  onWorkspaceInvalidated?: () => void
  onServerLayout?: CanvasManagerInput["onServerLayout"]
  notify?: CanvasManagerInput["notify"]
} = {}) {
  const [records, setRecords] = createSignal<WorkspaceBlockRecord[]>([record("block-a"), record("block-b")])
  const fakeSDK = createFakeSDK({ coderModel: coderModel ?? null }, workspaceHandlers)
  const fakePort = createFakePort()
  const manager = createCanvasManager({
    clientID: "client-1",
    directory: () => "/repo",
    isMobile: () => false,
    getRecords: records,
    onServerLayout: onServerLayout ?? (() => {}),
    hasLocalBlocks: () => true,
    notify: notify ?? (() => {}),
    onWorkspaceInvalidated,
    masterAgentPort: () => fakePort.port,
    serverSDK: () => fakeSDK.sdk,
  } satisfies CanvasManagerInput)
  return { manager, fakeSDK, fakePort, setRecords }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function serverError(status: number, tag: string) {
  return new Error(`opencode server ${status}`, { cause: { status, body: { _tag: tag } } })
}

// BindingState is a discriminated union; every assertion here follows a
// successful ensure/reconnect, so narrow to the ready branch explicitly.
function readyBinding(state: () => BindingState): MasterAgent.Binding {
  const current = state()
  if (current.status !== "ready") throw new Error(`expected ready binding, got ${current.status}`)
  return current.binding
}

describe("manager masterAgent integration", () => {
  test("recognizes only the canonical 4x4 default chat layout as pristine", () => {
    expect(
      isPristineDefault({
        id: "layout-canonical",
        workspaceID: "ws-1",
        blocks: [
          {
            id: "default-chat",
            functionality: "builtin:chat",
            transform: { x: 0, y: 0, w: 4, h: 4, z: 0 },
          },
        ],
        revision: 1,
      }),
    ).toBeTrue()
    expect(
      isPristineDefault({
        id: "layout-legacy",
        workspaceID: "ws-1",
        blocks: [
          {
            id: "legacy-default-chat",
            functionality: "builtin:chat",
            transform: { x: 0, y: 0, w: 1, h: 1, z: 0 },
          },
        ],
        revision: 1,
      }),
    ).toBeFalse()
  })

  test("tracks two blocks independently and applies newer binding events per block", async () => {
    const { manager, fakeSDK, fakePort } = createEnv()
    await manager.connect()

    await manager.masterAgent.ensure("block-a")
    await manager.masterAgent.ensure("block-b")

    expect(fakePort.calls.filter((call) => call.method === "ensure").map((call) => call.blockID)).toEqual([
      "block-a",
      "block-b",
    ])
    const stateA = manager.masterAgent.state("block-a")
    const stateB = manager.masterAgent.state("block-b")
    expect(stateA().status).toBe("ready")
    expect(readyBinding(stateA).revision).toBe(1)
    expect(stateB().status).toBe("ready")
    expect(readyBinding(stateB).revision).toBe(2)

    // A newer binding event for block-a must not touch block-b.
    fakeSDK.emit(bindingUpdated("ws-1", "block-a"))
    expect(stateA().status).toBe("ready")
    expect(readyBinding(stateA).revision).toBe(2)
    expect(readyBinding(stateA).sessionID).toBe("session-block-a-2")
    expect(readyBinding(stateB).revision).toBe(2)

    // Stale events (revision <= current) are ignored.
    fakeSDK.emit(bindingUpdated("ws-1", "block-a", { revision: 1, sessionID: "session-block-a-3" }))
    expect(readyBinding(stateA).revision).toBe(2)
    expect(readyBinding(stateA).sessionID).toBe("session-block-a-2")
  })

  test("buffers binding events that arrive before a block mounts and drains them after ensure", async () => {
    const { manager, fakeSDK } = createEnv()
    await manager.connect()

    // block-b has no projection yet; the event must be buffered, not lost.
    fakeSDK.emit(bindingUpdated("ws-1", "block-b"))
    expect(manager.masterAgent.state("block-b")().status).toBe("uninitialized")

    await manager.masterAgent.ensure("block-b")
    const state = manager.masterAgent.state("block-b")
    expect(state().status).toBe("ready")
    expect(readyBinding(state).revision).toBe(2)
    expect(readyBinding(state).sessionID).toBe("session-block-b-2")
  })

  test("reconnect refetches known blocks and adopts the authoritative binding", async () => {
    const { manager, fakeSDK, fakePort } = createEnv()
    await manager.connect()
    manager.start()
    await manager.masterAgent.ensure("block-a")
    expect(readyBinding(manager.masterAgent.state("block-a")).revision).toBe(1)

    // The stream dropped while the server moved the binding forward.
    fakePort.bindings.set("block-a", binding("ws-1", "block-a", { sessionID: "session-block-a-2", revision: 2 }))
    const getsBefore = fakePort.calls.filter((call) => call.method === "get").length

    window.dispatchEvent(new Event("online"))
    await flush()
    await flush()

    expect(fakePort.calls.filter((call) => call.method === "get").length).toBeGreaterThan(getsBefore)
    expect(readyBinding(manager.masterAgent.state("block-a")).revision).toBe(2)
  })

  test("ignores foreign-workspace events and re-mounts cleanly after projection removal", async () => {
    const { manager, fakeSDK } = createEnv()
    await manager.connect()
    await manager.masterAgent.ensure("block-a")

    // A binding update for another workspace must not leak into this one.
    fakeSDK.emit(bindingUpdated("ws-other", "block-a", { revision: 9, sessionID: "session-other" }))
    expect(readyBinding(manager.masterAgent.state("block-a")).revision).toBe(1)

    manager.masterAgent.removeLocalProjection("block-a")
    expect(manager.masterAgent.state("block-a")().status).toBe("uninitialized")

    // Re-mount binds through the host again (no client-side queue or session).
    await manager.masterAgent.ensure("block-a")
    expect(manager.masterAgent.state("block-a")().status).toBe("ready")
    expect(readyBinding(manager.masterAgent.state("block-a")).revision).toBe(1)
  })

  test("drops projections when a master-agent block leaves the layout", async () => {
    const { manager, fakeSDK, setRecords } = createEnv()
    await manager.connect()
    await manager.masterAgent.ensure("block-b")
    expect(manager.masterAgent.state("block-b")().status).toBe("ready")

    setRecords([record("block-a")])
    await flush()

    // The removed block's projection resets and its binding events are no
    // longer applied (they are buffered for an unknown block instead).
    expect(manager.masterAgent.state("block-b")().status).toBe("uninitialized")
    fakeSDK.emit(bindingUpdated("ws-1", "block-b", { revision: 7 }))
    expect(manager.masterAgent.state("block-b")().status).toBe("uninitialized")
  })

  test("shares one workspace-wide Coder controller and patches through the port", async () => {
    const { manager, fakePort } = createEnv({ coderModel: "anthropic:claude-sonnet-4" })
    await manager.connect()

    const coder = manager.masterAgent.coder
    expect(coder.model()).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })
    expect(coder.enabled()).toBe(true)
    // Workspace-wide: every block observes the same controller instance.
    expect(manager.masterAgent.coder.model).toBe(coder.model)

    await coder.set({ providerID: "openai", modelID: "gpt-5" })
    expect(coder.model()).toEqual({ providerID: "openai", modelID: "gpt-5" })
    expect(fakePort.calls[fakePort.calls.length - 1]).toMatchObject({
      method: "patchCoderModel",
      workspaceID: "ws-1",
      model: { providerID: "openai", modelID: "gpt-5" },
    })

    await coder.clear()
    expect(coder.model()).toBeNull()
    expect(fakePort.calls[fakePort.calls.length - 1]?.model).toBeNull()
  })

  test("hydrates a Coder controller created before the workspace connects", async () => {
    const { manager } = createEnv({ coderModel: "anthropic:claude-sonnet-4" })
    const coder = manager.masterAgent.coder

    expect(coder.model()).toBeNull()
    await manager.connect()
    expect(coder.model()).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })
    expect(coder.enabled()).toBe(true)
  })

  test("rejects Coder changes until delayed workspace hydration completes", async () => {
    const pending = Promise.withResolvers<WorkspaceInfoResponse>()
    const { manager, fakePort } = createEnv({
      workspace: { get: () => pending.promise },
    })
    const coder = manager.masterAgent.coder
    const connecting = manager.connect()
    await flush()

    expect(manager.workspaceID()).toBe("ws-1")
    await expect(coder.set({ providerID: "openai", modelID: "gpt-5" })).rejects.toEqual({ type: "no-workspace" })
    expect(fakePort.calls.filter((call) => call.method === "patchCoderModel")).toEqual([])

    pending.resolve(workspaceInfo("ws-1", { coderModel: "anthropic:claude-sonnet-4" }))
    await connecting
    await coder.set({ providerID: "openai", modelID: "gpt-5" })
    expect(fakePort.calls.filter((call) => call.method === "patchCoderModel")).toHaveLength(1)
  })

  test("rolls back an in-flight Coder save that fails after disconnect", async () => {
    const { manager, fakePort } = createEnv({ coderModel: "anthropic:claude-sonnet-4" })
    await manager.connect()
    manager.start()
    const coder = manager.masterAgent.coder
    const pending = fakePort.deferNextPatch()
    const request = coder.set({ providerID: "openai", modelID: "gpt-5" })

    expect(coder.model()).toEqual({ providerID: "openai", modelID: "gpt-5" })
    window.dispatchEvent(new Event("offline"))
    pending.reject(new Error("offline"))
    await expect(request).rejects.toThrow("offline")
    expect(coder.model()).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })
    expect(coder.error()).not.toBeNull()
    manager.dispose()
  })

  test("Coder patch failure rolls back to the authoritative model and retry recovers", async () => {
    const { manager, fakePort } = createEnv({ coderModel: "anthropic:claude-sonnet-4" })
    await manager.connect()
    const coder = manager.masterAgent.coder
    expect(coder.model()?.modelID).toBe("claude-sonnet-4")

    fakePort.failNextPatch()
    await expect(coder.set({ providerID: "openai", modelID: "gpt-5" })).rejects.toThrow("patch failed")
    expect(coder.model()?.modelID).toBe("claude-sonnet-4")
    expect(coder.error()).not.toBeNull()

    await coder.retry()
    expect(coder.model()).toEqual({ providerID: "openai", modelID: "gpt-5" })
    expect(coder.error()).toBeNull()
  })

  test("disposal unsubscribes reconciliation and stops all master-agent requests", async () => {
    const { manager, fakeSDK, fakePort } = createEnv()
    await manager.connect()
    await manager.masterAgent.ensure("block-a")
    const callsBefore = fakePort.calls.length

    manager.dispose()
    manager.dispose() // idempotent

    await manager.masterAgent.ensure("block-a")
    expect(fakePort.calls.length).toBe(callsBefore)

    fakeSDK.emit(bindingUpdated("ws-1", "block-a", { revision: 5 }))
    await flush()
    expect(manager.masterAgent.state("block-a")().status).toBe("uninitialized")
  })

  test("restores and retries layout sync when workspace disappears (404)", async () => {
    let onWorkspaceInvalidatedCalled = 0
    let saveCount = 0
    const serverLayouts: WorkspaceBlockRecord[][] = []

    const { manager, fakeSDK } = createEnv({
      workspace: {
        layoutSave: async () => {
          saveCount += 1
          if (saveCount === 1) throw serverError(404, "WorkspaceNotFoundError")
          return {
            data: {
              status: "saved",
              layout: {
                blocks: [record("block-a"), record("block-b")],
                revision: 2,
              },
            },
          }
        },
      },
      onWorkspaceInvalidated: () => {
        onWorkspaceInvalidatedCalled += 1
      },
      onServerLayout: (layout) => serverLayouts.push(layout.blocks),
    })

    await manager.connect()
    manager.noteLocalEdit()
    await manager.sync()

    expect(onWorkspaceInvalidatedCalled).toBe(1)
    expect(manager.workspaceEpoch()).toBe(1)
    expect(fakeSDK.calls.filter((call) => call.method === "layout-save").length).toBe(2)
    expect(serverLayouts).toEqual([[]])
    expect(manager.connected()).toBe(true)
  })

  test("preserves a dirty local layout when refresh recovers a missing workspace", async () => {
    let layoutGetCount = 0
    const serverLayouts: WorkspaceBlockRecord[][] = []
    const { manager } = createEnv({
      workspace: {
        layoutGet: async () => {
          layoutGetCount += 1
          if (layoutGetCount === 2) throw serverError(404, "WorkspaceNotFoundError")
          return { data: { blocks: layoutGetCount === 1 ? [] : [record("server-block")], revision: layoutGetCount } }
        },
      },
      onServerLayout: (layout) => serverLayouts.push(layout.blocks),
    })

    await manager.connect()
    manager.noteLocalEdit()
    await manager.refresh()

    expect(manager.workspaceEpoch()).toBe(1)
    expect(manager.dirty()).toBe(true)
    expect(serverLayouts).toEqual([[]])
  })

  test("does not recover workspace on non-404 workspace errors", async () => {
    let onWorkspaceInvalidatedCalled = 0
    let saveCount = 0

    const { manager, fakeSDK } = createEnv({
      workspace: {
        layoutSave: async () => {
          saveCount += 1
          throw Object.assign(new Error("unavailable"), { status: 500 })
        },
      },
      onWorkspaceInvalidated: () => {
        onWorkspaceInvalidatedCalled += 1
      },
    })

    await manager.connect()
    manager.noteLocalEdit()
    await manager.sync()

    expect(onWorkspaceInvalidatedCalled).toBe(0)
    expect(manager.workspaceEpoch()).toBe(0)
    expect(fakeSDK.calls.filter((call) => call.method === "layout-save").length).toBe(1)
    expect(fakeSDK.calls.filter((call) => call.method === "layout-save").length).toBe(saveCount)
    expect(manager.connected()).toBe(false)
  })

  test("does not invalidate the workspace for a typed block-not-found 404", async () => {
    let onWorkspaceInvalidatedCalled = 0
    let chatRelayGetCount = 0
    const { manager, setRecords } = createEnv({
      workspace: {
        chatRelayGet: async () => {
          chatRelayGetCount += 1
          if (chatRelayGetCount > 1) return { data: { status: "unbound" } }
          throw serverError(404, "ChatRelayBlockNotFoundError")
        },
      },
      onWorkspaceInvalidated: () => {
        onWorkspaceInvalidatedCalled += 1
      },
    })
    setRecords([record("relay", "builtin:chat-relay")])

    await manager.connect()
    await flush()
    await flush()

    expect(onWorkspaceInvalidatedCalled).toBe(0)
    expect(manager.workspaceEpoch()).toBe(0)
    expect(manager.workspaceID()).toBe("ws-1")
  })

  test("fully hydrates metadata and functionality catalog after recovery selects a different workspace", async () => {
    localStorage.clear()
    let listCount = 0
    let saveCount = 0
    const { manager, fakeSDK } = createEnv({
      workspace: {
        list: async () => ({ data: [workspaceRow(++listCount === 1 ? "ws-1" : "ws-2")] }),
        get: async ({ id }) =>
          workspaceInfo(id, {
            model: id === "ws-2" ? "provider:recovered" : "provider:initial",
            operatingAgent: id === "ws-2" ? "agent-recovered" : "agent-initial",
            directories: id === "ws-2" ? ["/recovered"] : ["/initial"],
          }),
        functionalityList: async ({ workspaceID }) => ({
          data: [
            {
              id: workspaceID === "ws-2" ? "plugin:recovered" : "plugin:initial",
              kind: "plugin",
              label: workspaceID,
              minW: 4,
              minH: 4,
              maxW: 100,
              maxH: 100,
            },
          ],
        }),
        layoutGet: async ({ workspaceID }) => ({ data: { blocks: [], revision: workspaceID === "ws-2" ? 9 : 1 } }),
        layoutSave: async ({ workspaceID, blocks }) => {
          saveCount += 1
          if (saveCount === 1) throw serverError(404, "WorkspaceNotFoundError")
          return { data: { status: "saved", layout: { blocks, revision: workspaceID === "ws-2" ? 10 : 2 } } }
        },
      },
    })

    await manager.connect()
    manager.noteLocalEdit()
    await manager.sync()

    expect(manager.workspaceID()).toBe("ws-2")
    expect(manager.modelKey()).toBe("provider:recovered")
    expect(manager.operatingAgentKey()).toBe("agent-recovered")
    expect(manager.directories()).toEqual(["/recovered"])
    expect(manager.functionalities().map((item) => item.id)).toEqual(["plugin:recovered"])
    expect(fakeSDK.calls.filter((call) => call.method === "layout-save").map((call) => call.workspaceID)).toEqual([
      "ws-1",
      "ws-2",
    ])
  })

  test("rolls back rejected OperatingAgent and primary model mutations", async () => {
    const notifications: string[] = []
    const { manager } = createEnv({
      workspace: {
        get: async ({ id }) => workspaceInfo(id, { operatingAgent: "agent:old", model: "provider:old" }),
        update: async () => {
          throw new Error("rejected")
        },
      },
      notify: (message) => notifications.push(message),
    })
    await manager.connect()

    await manager.selectOperatingAgent("agent:new")
    await manager.selectModel("provider:new")

    expect(manager.operatingAgentKey()).toBe("agent:old")
    expect(manager.operatingAgentVersion()).toBe(0)
    expect(manager.modelKey()).toBe("provider:old")
    expect(notifications).toEqual(["Failed to save OperatingAgent model", "Failed to save workspace model"])
  })

  test("ignores an older OperatingAgent response that resolves after newer intent", async () => {
    const first = Promise.withResolvers<{ data: { operatingAgent: string } }>()
    const second = Promise.withResolvers<{ data: { operatingAgent: string } }>()
    let calls = 0
    const { manager } = createEnv({
      workspace: {
        update: async () => (++calls === 1 ? first.promise : second.promise),
      },
    })
    await manager.connect()

    const older = manager.selectOperatingAgent("agent:first")
    const newer = manager.selectOperatingAgent("agent:second")
    second.resolve({ data: { operatingAgent: "agent:second-normalized" } })
    await newer
    first.resolve({ data: { operatingAgent: "agent:first-normalized" } })
    await older

    expect(manager.operatingAgentKey()).toBe("agent:second-normalized")
    expect(manager.operatingAgentVersion()).toBe(1)
  })

  test("does not let workspace hydration overwrite newer model mutations", async () => {
    const hydration = Promise.withResolvers<WorkspaceInfoResponse>()
    const { manager } = createEnv({
      workspace: {
        list: async () => ({ data: [workspaceRow("ws-1"), workspaceRow("ws-2")] }),
        get: async ({ id }) => {
          if (id === "ws-2") return hydration.promise
          return workspaceInfo(id, { operatingAgent: "agent:initial", model: "provider:initial" })
        },
        update: async ({ workspaceUpdatePayload }) => ({
          data: {
            operatingAgent: workspaceUpdatePayload.patch.operatingAgent ? "agent:authoritative" : undefined,
            model: workspaceUpdatePayload.patch.model ? "provider:authoritative" : undefined,
          },
        }),
      },
    })
    await manager.connect()

    const switching = manager.switchWorkspace("ws-2")
    await flush()
    await Promise.all([manager.selectOperatingAgent("agent:new"), manager.selectModel("provider:new")])
    hydration.resolve(
      workspaceInfo("ws-2", {
        operatingAgent: "agent:stale-hydration",
        model: "provider:stale-hydration",
      }),
    )
    await switching

    expect(manager.operatingAgentKey()).toBe("agent:authoritative")
    expect(manager.modelKey()).toBe("provider:authoritative")
  })

  for (const mutation of [
    {
      name: "operating agent",
      run: (manager: CanvasManager) => manager.selectOperatingAgent("agent-next"),
      read: (manager: CanvasManager) => manager.operatingAgentKey(),
      expected: "agent-authoritative",
    },
    {
      name: "model",
      run: (manager: CanvasManager) => manager.selectModel("provider:next"),
      read: (manager: CanvasManager) => manager.modelKey(),
      expected: "provider:authoritative",
    },
    {
      name: "directories",
      run: (manager: CanvasManager) => manager.updateDirectories(["/next"]),
      read: (manager: CanvasManager) => manager.directories(),
      expected: ["/next"],
    },
  ]) {
    test(`retries ${mutation.name} mutation against the recovered workspace ID`, async () => {
      localStorage.clear()
      let listCount = 0
      let updateCount = 0
      const { manager, fakeSDK } = createEnv({
        workspace: {
          list: async () => ({ data: [workspaceRow(++listCount === 1 ? "ws-1" : "ws-2")] }),
          get: async ({ id }) => workspaceInfo(id),
          update: async () => {
            updateCount += 1
            if (updateCount === 1) throw serverError(404, "WorkspaceNotFoundError")
            return {
              data: {
                operatingAgent: "agent-authoritative",
                model: "provider:authoritative",
              },
            }
          },
        },
      })

      await manager.connect()
      await mutation.run(manager)

      expect(manager.workspaceID()).toBe("ws-2")
      expect(fakeSDK.calls.filter((call) => call.method === "update").map((call) => call.workspaceID)).toEqual([
        "ws-1",
        "ws-2",
      ])
      expect(mutation.read(manager)).toEqual(mutation.expected)
    })
  }

  test("descriptor persistence waits for the successful save containing the block", async () => {
    let releaseSave = () => {}
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    const { manager } = createEnv({
      workspace: {
        layoutSave: async ({ blocks }) => {
          await saveGate
          return { data: { status: "saved", layout: { blocks, revision: 2 } } }
        },
      },
    })
    await manager.connect()
    manager.noteLocalEdit()

    const syncing = manager.sync()
    let persisted = false
    const persistence = manager.awaitDescriptorPersisted("block-a", new AbortController().signal)
    void persistence.then(() => {
      persisted = true
    })
    await flush()

    expect(persisted).toBe(false)
    releaseSave()
    await syncing
    await persistence
    expect(persisted).toBe(true)
  })

  test("save transport loss marks the canvas offline and preserves dirty layout through reconnect", async () => {
    let saveCount = 0
    const notifications: string[] = []
    const serverLayouts: WorkspaceBlockRecord[][] = []
    const { manager } = createEnv({
      workspace: {
        layoutGet: async () => ({ data: { blocks: [record("server")], revision: 1 } }),
        layoutSave: async ({ blocks }) => {
          saveCount += 1
          if (saveCount === 1) throw new Error("transport lost")
          return { data: { status: "saved", layout: { blocks, revision: 2 } } }
        },
      },
      notify: (message) => notifications.push(message),
      onServerLayout: (layout) => serverLayouts.push(layout.blocks),
    })
    await manager.connect()
    manager.noteLocalEdit()
    await manager.sync()

    expect(manager.connected()).toBe(false)
    expect(manager.dirty()).toBe(true)
    expect(notifications).toContain("Canvas is read-only while offline")

    await manager.connect()
    expect(manager.connected()).toBe(true)
    expect(serverLayouts).toEqual([[record("server")]])
  })

  test("conflict refresh transport loss preserves the local layout through reconnect", async () => {
    let releaseConflict = () => {}
    const conflictGate = new Promise<void>((resolve) => {
      releaseConflict = resolve
    })
    let resolveReconnectSave = (_blocks: WorkspaceBlockRecord[]) => {}
    const reconnectSave = new Promise<WorkspaceBlockRecord[]>((resolve) => {
      resolveReconnectSave = resolve
    })
    let layoutGetCount = 0
    let saveCount = 0
    const notifications: string[] = []
    const serverLayouts: WorkspaceBlockRecord[][] = []
    const { manager } = createEnv({
      workspace: {
        layoutGet: async () => {
          layoutGetCount += 1
          if (layoutGetCount === 2) throw new Error("refresh transport lost")
          return {
            data: {
              blocks: [record(layoutGetCount === 1 ? "server-initial" : "server-stale")],
              revision: layoutGetCount,
            },
          }
        },
        layoutSave: async ({ blocks }) => {
          saveCount += 1
          if (saveCount === 1) {
            await conflictGate
            return { data: { status: "conflict", layout: { blocks: [record("server-conflict")], revision: 2 } } }
          }
          resolveReconnectSave(blocks)
          return { data: { status: "saved", layout: { blocks, revision: 3 } } }
        },
      },
      notify: (message) => notifications.push(message),
      onServerLayout: (layout) => serverLayouts.push(layout.blocks),
    })
    await manager.connect()
    manager.noteLocalEdit()

    const syncing = manager.sync()
    await flush()
    releaseConflict()
    await syncing

    expect(manager.connected()).toBe(false)
    expect(manager.dirty()).toBe(true)
    expect(notifications).not.toContain("Layout updated from server")
    expect(serverLayouts).toEqual([[record("server-initial")]])

    await manager.connect()
    expect(await reconnectSave).toEqual([record("block-a"), record("block-b")])
    expect(manager.connected()).toBe(true)
    expect(serverLayouts).toEqual([[record("server-initial")]])
    manager.dispose()
  })

  test("browser offline events mark the connected canvas read-only and notify explicitly", async () => {
    const notifications: string[] = []
    const { manager } = createEnv({ notify: (message) => notifications.push(message) })
    await manager.connect()
    manager.start()

    window.dispatchEvent(new Event("offline"))

    expect(manager.connected()).toBe(false)
    expect(notifications).toContain("Canvas is read-only while offline")
    manager.dispose()
  })
})
