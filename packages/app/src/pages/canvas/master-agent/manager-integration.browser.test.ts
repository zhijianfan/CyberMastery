// Track M6 — Canvas Manager integration tests. Exercises the composed
// MasterAgent surface on createCanvasManager: per-block lifecycle controllers,
// binding-event reconciliation (buffering, staleness, reconnect), workspace
// switch isolation, the workspace-wide shared Coder controller, and disposal.
// The fake SDK is injected through the manager's serverSDK seam; the fake port
// stands in for M5's sdk-port factory.

import { describe, expect, test } from "bun:test"
import { createComponent, createSignal } from "solid-js"
import h from "solid-js/h"
import type { ServerSDK } from "@/context/server-sdk"
import type { WorkspaceBlockRecord, WorkspaceFunctionalityInfo } from "@opencode-ai/sdk/v2/client"
import { createCanvasManager, isPristineDefault, type CanvasManager, type CanvasManagerInput } from "../manager"
import { ChatRelayRuntimeAdapter } from "../blocks/chat-relay/runtime"
import type { BlockRuntimeServices } from "../runtime/contracts"
import type { BindingState, MasterAgent, MasterAgentPort, ModelSelection, WorkspaceInfo } from "./types"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

const Fragment = (props: { children?: unknown }) => props.children
;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

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
  method: "list" | "get" | "create" | "update" | "layout-get" | "layout-save" | "functionality-list"
  workspaceID?: string
  blockID?: string
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
  data:
    | { status: "saved"; layout: { blocks: WorkspaceBlockRecord[]; revision: number } }
    | { status: "handed-over" | "conflict"; currentRevision: number }
}

function workspaceRow(id: string): WorkspaceRecord {
  return { id, name: "Default", style: "default", directories: [], pluginIDs: [], skillIDs: [] }
}

function workspaceInfo(id: string, overrides: Partial<WorkspaceInfoResponse["data"]> = {}): WorkspaceInfoResponse {
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
            save: async (input: {
              workspaceLayoutSavePayload: { workspaceID: string; blocks: WorkspaceBlockRecord[] }
            }) =>
              workspaceAPI.layoutSave({
                workspaceID: input.workspaceLayoutSavePayload.workspaceID,
                blocks: input.workspaceLayoutSavePayload.blocks,
              }),
          },
          functionality: {
            list: async (input: { workspaceID: string }) => workspaceAPI.functionalityList(input),
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
  test("reconciles a stale local layout projection to the newer server revision", async () => {
    const applied: Array<{ blocks: WorkspaceBlockRecord[]; revision: number }> = []
    const { manager, fakeSDK, setRecords } = createEnv({
      workspace: {
        layoutGet: async () => ({ data: { blocks: [record("server-newer")], revision: 9 } }),
      },
      onServerLayout: (layout) => applied.push(layout),
    })
    setRecords([record("cached-stale")])

    await manager.connect()

    expect(applied).toEqual([{ blocks: [record("server-newer")], revision: 9 }])
    expect(manager.revision()).toBe(9)
    expect(manager.dirty()).toBe(false)
    expect(fakeSDK.calls.filter((call) => call.method === "layout-save")).toEqual([])
    manager.dispose()
  })

  test("shares one workspace hydration across concurrent connect attempts", async () => {
    localStorage.clear()
    const pending = Promise.withResolvers<LayoutResponse>()
    const started = Promise.withResolvers<void>()
    const { manager, fakeSDK } = createEnv({
      workspace: {
        layoutGet: async () => {
          started.resolve()
          return pending.promise
        },
      },
    })

    const first = manager.connect()
    await started.promise
    const second = manager.connect()
    await flush()

    try {
      expect(fakeSDK.calls.filter((call) => call.method === "layout-get")).toHaveLength(1)
      pending.resolve({ data: { blocks: [record("server")], revision: 1 } })
      await Promise.all([first, second])
    } finally {
      pending.resolve({ data: { blocks: [record("server")], revision: 1 } })
      await Promise.allSettled([first, second])
      manager.dispose()
    }
  })

  test("an obsolete connect hydration cannot overwrite a switched workspace", async () => {
    localStorage.clear()
    const stale = Promise.withResolvers<LayoutResponse>()
    const staleStarted = Promise.withResolvers<void>()
    const applied: WorkspaceBlockRecord[][] = []
    const { manager } = createEnv({
      workspace: {
        list: async () => ({ data: [workspaceRow("ws-1"), workspaceRow("ws-2")] }),
        get: async ({ id }) => workspaceInfo(id, { directories: [`/${id}`] }),
        layoutGet: async ({ workspaceID }) => {
          if (workspaceID === "ws-1") {
            staleStarted.resolve()
            return stale.promise
          }
          return { data: { blocks: [record("server-b")], revision: 20 } }
        },
      },
      onServerLayout: (layout) => applied.push(layout.blocks),
    })

    const connecting = manager.connect()
    await staleStarted.promise
    const switching = manager.switchWorkspace("ws-2")
    await switching

    try {
      stale.resolve({ data: { blocks: [record("stale-a")], revision: 1 } })
      await connecting

      expect(manager.workspaceID()).toBe("ws-2")
      expect(manager.revision()).toBe(20)
      expect(manager.directories()).toEqual(["/ws-2"])
      expect(applied).toEqual([[record("server-b")]])
    } finally {
      stale.resolve({ data: { blocks: [record("stale-a")], revision: 1 } })
      await Promise.allSettled([connecting, switching])
      manager.dispose()
    }
  })

  test("a reconnect during workspace switching joins the target hydration", async () => {
    localStorage.clear()
    const pending = Promise.withResolvers<LayoutResponse>()
    const started = Promise.withResolvers<void>()
    let targetReads = 0
    const { manager } = createEnv({
      workspace: {
        list: async () => ({ data: [workspaceRow("ws-1"), workspaceRow("ws-2")] }),
        get: async ({ id }) => workspaceInfo(id),
        layoutGet: async ({ workspaceID }) => {
          if (workspaceID === "ws-1") return { data: { blocks: [record("server-a")], revision: 1 } }
          targetReads += 1
          if (targetReads === 1) {
            started.resolve()
            return pending.promise
          }
          return { data: { blocks: [record("duplicate-b")], revision: 21 } }
        },
      },
    })
    await manager.connect()
    const switching = manager.switchWorkspace("ws-2")
    await started.promise
    const reconnecting = manager.connect()
    await flush()

    try {
      expect(targetReads).toBe(1)
      expect(manager.connected()).toBe(false)
      pending.resolve({ data: { blocks: [record("server-b")], revision: 20 } })
      await Promise.all([switching, reconnecting])
      expect(manager.revision()).toBe(20)
    } finally {
      pending.resolve({ data: { blocks: [record("server-b")], revision: 20 } })
      await Promise.allSettled([switching, reconnecting])
      manager.dispose()
    }
  })

  test("a reconnect after switching does not join an obsolete connect", async () => {
    localStorage.clear()
    const stale = Promise.withResolvers<LayoutResponse>()
    const staleStarted = Promise.withResolvers<void>()
    let targetReads = 0
    const { manager } = createEnv({
      workspace: {
        list: async () => ({ data: [workspaceRow("ws-1"), workspaceRow("ws-2")] }),
        get: async ({ id }) => workspaceInfo(id),
        layoutGet: async ({ workspaceID }) => {
          if (workspaceID === "ws-1") {
            staleStarted.resolve()
            return stale.promise
          }
          targetReads += 1
          return { data: { blocks: [record(`server-b-${targetReads}`)], revision: 19 + targetReads } }
        },
      },
    })
    const obsoleteConnect = manager.connect()
    await staleStarted.promise
    await manager.switchWorkspace("ws-2")
    manager.start()
    window.dispatchEvent(new Event("offline"))
    const reconnecting = manager.connect()
    await flush()

    try {
      expect(targetReads).toBe(2)
      expect(manager.connected()).toBe(true)
      expect(manager.revision()).toBe(21)
    } finally {
      stale.resolve({ data: { blocks: [record("stale-a")], revision: 1 } })
      await Promise.allSettled([obsoleteConnect, reconnecting])
      manager.dispose()
    }
  })

  test("a stale switch failure cannot recover over a newer workspace choice", async () => {
    localStorage.clear()
    const stale = Promise.withResolvers<LayoutResponse>()
    const staleStarted = Promise.withResolvers<void>()
    let lists = 0
    const applied: WorkspaceBlockRecord[][] = []
    const { manager } = createEnv({
      workspace: {
        list: async () => {
          lists += 1
          return { data: [workspaceRow("ws-1"), workspaceRow("ws-2"), workspaceRow("ws-3")] }
        },
        get: async ({ id }) => workspaceInfo(id),
        layoutGet: async ({ workspaceID }) => {
          if (workspaceID === "ws-2") {
            staleStarted.resolve()
            return stale.promise
          }
          return {
            data: {
              blocks: [record(workspaceID === "ws-3" ? "server-c" : "server-a")],
              revision: workspaceID === "ws-3" ? 30 : 1,
            },
          }
        },
      },
      onServerLayout: (layout) => applied.push(layout.blocks),
    })
    await manager.connect()
    const staleSwitch = manager.switchWorkspace("ws-2")
    await staleStarted.promise
    await manager.switchWorkspace("ws-3")
    stale.reject(serverError(404, "WorkspaceNotFoundError"))
    await Promise.allSettled([staleSwitch])

    try {
      expect(lists).toBe(1)
      expect(manager.workspaceID()).toBe("ws-3")
      expect(manager.revision()).toBe(30)
      expect(applied).toEqual([[record("server-a")], [record("server-c")]])
    } finally {
      manager.dispose()
    }
  })

  test("contains a current workspace switch transport failure", async () => {
    localStorage.clear()
    const { manager } = createEnv({
      workspace: {
        list: async () => ({ data: [workspaceRow("ws-1"), workspaceRow("ws-2")] }),
        get: async ({ id }) => workspaceInfo(id),
        layoutGet: async ({ workspaceID }) => {
          if (workspaceID === "ws-2") throw new Error("switch transport unavailable")
          return { data: { blocks: [record("server-a")], revision: 1 } }
        },
      },
    })

    try {
      await manager.connect()
      await manager.switchWorkspace("ws-2")
      expect(manager.workspaceID()).toBe("ws-2")
      expect(manager.connected()).toBe(false)
    } finally {
      manager.dispose()
    }
  })

  test("late recovery workspace discovery cannot overwrite a newer switch", async () => {
    localStorage.clear()
    const recoveryList = Promise.withResolvers<{ data: WorkspaceRecord[] }>()
    const recoveryStarted = Promise.withResolvers<void>()
    let lists = 0
    let targetReads = 0
    const { manager } = createEnv({
      workspace: {
        list: async () => {
          if (++lists === 1) return { data: [workspaceRow("ws-1"), workspaceRow("ws-2")] }
          recoveryStarted.resolve()
          return recoveryList.promise
        },
        get: async ({ id }) => workspaceInfo(id),
        layoutGet: async ({ workspaceID }) => {
          if (workspaceID === "ws-2") targetReads += 1
          return {
            data: {
              blocks: [record(workspaceID === "ws-2" ? "server-b" : "server-a")],
              revision: workspaceID === "ws-2" ? 20 : 1,
            },
          }
        },
      },
    })
    await manager.connect()
    const switching = manager.switchWorkspace("ws-2")
    const recovering = manager.recoverWorkspace(serverError(404, "WorkspaceNotFoundError"))
    await recoveryStarted.promise
    await switching

    try {
      recoveryList.resolve({ data: [workspaceRow("ws-1"), workspaceRow("ws-2")] })
      await recovering

      expect(manager.workspaceID()).toBe("ws-2")
      expect(manager.revision()).toBe(20)
      expect(targetReads).toBe(1)
    } finally {
      recoveryList.resolve({ data: [workspaceRow("ws-1"), workspaceRow("ws-2")] })
      await Promise.allSettled([switching, recovering])
      manager.dispose()
    }
  })

  test("a current recovery does not join recovery superseded by a workspace switch", async () => {
    localStorage.clear()
    const staleList = Promise.withResolvers<{ data: WorkspaceRecord[] }>()
    const staleRecoveryStarted = Promise.withResolvers<void>()
    const currentHydration = Promise.withResolvers<LayoutResponse>()
    let lists = 0
    const { manager } = createEnv({
      workspace: {
        list: async () => {
          lists += 1
          if (lists === 1) return { data: [workspaceRow("ws-1"), workspaceRow("ws-2")] }
          if (lists === 2) {
            staleRecoveryStarted.resolve()
            return staleList.promise
          }
          return { data: [workspaceRow("ws-3")] }
        },
        get: async ({ id }) => workspaceInfo(id),
        layoutGet: async ({ workspaceID }) => {
          if (workspaceID === "ws-3") return currentHydration.promise
          return {
            data: {
              blocks: [record(workspaceID === "ws-2" ? "server-b" : "server-a")],
              revision: workspaceID === "ws-2" ? 20 : 1,
            },
          }
        },
      },
    })
    await manager.connect()
    const switching = manager.switchWorkspace("ws-2")
    const staleRecovery = manager.recoverWorkspace(serverError(404, "WorkspaceNotFoundError"))
    await staleRecoveryStarted.promise
    await switching
    const currentRecovery = manager.recoverWorkspace(serverError(404, "WorkspaceNotFoundError"))
    await flush()

    try {
      expect(lists).toBe(3)
      staleList.resolve({ data: [workspaceRow("ws-1"), workspaceRow("ws-2")] })
      await staleRecovery
      const joinedRecovery = manager.recoverWorkspace(serverError(404, "WorkspaceNotFoundError"))
      await flush()
      expect(lists).toBe(3)
      currentHydration.resolve({ data: { blocks: [record("server-c")], revision: 30 } })
      await Promise.all([currentRecovery, joinedRecovery])
      expect(manager.workspaceID()).toBe("ws-3")
      expect(manager.revision()).toBe(30)
    } finally {
      staleList.resolve({ data: [workspaceRow("ws-1"), workspaceRow("ws-2")] })
      currentHydration.resolve({ data: { blocks: [record("server-c")], revision: 30 } })
      await Promise.allSettled([switching, staleRecovery, currentRecovery])
      manager.dispose()
    }
  })

  test("resolves ChatRelay through its persisted block descriptor and block-owned browser tab", async () => {
    const relay = record("relay", "builtin:chat-relay")
    const { manager, setRecords } = createEnv({
      workspace: {
        layoutGet: async () => ({ data: { blocks: [relay], revision: 1 } }),
      },
    })
    setRecords([relay])

    await manager.connect()
    let descriptorWaits = 0
    const relayCalls: unknown[] = []
    const relayState = {
      providerID: "chatgpt" as const,
      workspaceID: "ws-1",
      blockID: "relay",
      tabID: "tab-relay",
      status: "idle" as const,
      messages: [],
    }
    const sdk = {
      client: {
        v2: {
          chatProxy: {
            relay: async (input: unknown) => {
              relayCalls.push(input)
              return { data: relayState }
            },
          },
        },
      },
    } as unknown as ServerSDK
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "ws-1",
      block: { id: relay.id, functionalityID: relay.functionality, transform: relay.transform },
      services: {
        serverSDK: () => sdk,
        eventRouter: {
          on: () => () => {},
          off: () => {},
          onReconnect: () => () => {},
        },
        workspace: {
          id: manager.workspaceID,
          epoch: manager.workspaceEpoch,
          connected: manager.connected,
          awaitDescriptorPersisted: async () => {
            descriptorWaits += 1
          },
        },
        localView: {
          read: <T>() => ({ draft: "Message for ChatGPT" }) as T,
          write: () => {},
          delete: () => {},
          clearAll: () => {},
        },
      } satisfies BlockRuntimeServices,
      signal: new AbortController().signal,
    })

    expect(resolved).toEqual({
      storageKey: JSON.stringify(["chat-relay", "ws-1", "relay"]),
      workspaceID: "ws-1",
      blockID: "relay",
      draft: "Message for ChatGPT",
      relay: relayState,
    })
    expect(descriptorWaits).toBe(1)
    expect(relayCalls).toEqual([{ workspaceID: "ws-1", blockID: "relay" }])
  })

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
    expect(manager.directories()).toEqual(["/recovered"])
    expect(manager.functionalities().map((item) => item.id)).toEqual(["plugin:recovered"])
    expect(fakeSDK.calls.filter((call) => call.method === "layout-save").map((call) => call.workspaceID)).toEqual([
      "ws-1",
      "ws-2",
    ])
  })

  test("publishes only confirmed Main model changes to mounted agent blocks", async () => {
    const pending = Promise.withResolvers<WorkspaceInfoResponse>()
    const { manager } = createEnv({
      workspace: {
        get: async ({ id }) => workspaceInfo(id, { model: "provider:old", operatingAgent: "ignored:model" }),
        update: () => pending.promise,
      },
    })
    await manager.connect()
    const version = manager.modelVersion()
    const intent = manager.modelIntent()
    const saving = manager.selectModel("provider:new")
    let submitted = false
    const submission = manager.waitForModelSelection().then(() => {
      submitted = true
    })
    expect(manager.modelKey()).toBe("provider:new")
    expect(manager.modelVersion()).toBe(version)
    expect(manager.modelIntent()).toBeGreaterThan(intent)
    await flush()
    expect(submitted).toBe(false)
    pending.resolve(workspaceInfo("ws-1", { model: "provider:confirmed" }))
    await saving
    await submission
    expect(manager.modelKey()).toBe("provider:confirmed")
    expect(manager.modelVersion()).toBe(version + 1)
  })

  test("rolls back a rejected Main model without refreshing sessions", async () => {
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
    const version = manager.modelVersion()
    await manager.selectModel("provider:new")
    expect(manager.modelVersion()).toBe(version)
    expect(manager.modelKey()).toBe("provider:old")
    expect(notifications).toEqual(["Failed to save workspace model"])
  })

  test("serializes Main model writes and waits for the latest intent", async () => {
    const first = Promise.withResolvers<{ data: { model: string } }>()
    const second = Promise.withResolvers<{ data: { model: string } }>()
    const calls: string[] = []
    const { manager } = createEnv({
      workspace: {
        update: async ({ workspaceUpdatePayload }) => {
          calls.push(workspaceUpdatePayload.patch.model!)
          return calls.length === 1 ? first.promise : second.promise
        },
      },
    })
    await manager.connect()
    const version = manager.modelVersion()
    const older = manager.selectModel("provider:first")
    await flush()
    let submitted = false
    const submission = manager.waitForModelSelection().then(() => {
      submitted = true
    })
    const skipped = manager.selectModel("provider:skipped")
    const newer = manager.selectModel("provider:second")
    await flush()
    expect(calls).toEqual(["provider:first"])
    expect(submitted).toBe(false)
    first.resolve({ data: { model: "provider:first-normalized" } })
    await older
    await skipped
    await flush()
    expect(calls).toEqual(["provider:first", "provider:second"])
    expect(submitted).toBe(false)
    second.resolve({ data: { model: "provider:second-normalized" } })
    await newer
    await submission

    expect(manager.modelKey()).toBe("provider:second-normalized")
    expect(manager.modelVersion()).toBe(version + 1)
  })

  test("rejects a waiting submit on save failure and rolls back to the last confirmed Main model", async () => {
    const first = Promise.withResolvers<WorkspaceInfoResponse>()
    const second = Promise.withResolvers<WorkspaceInfoResponse>()
    let calls = 0
    const { manager } = createEnv({
      workspace: {
        get: async ({ id }) => workspaceInfo(id, { model: "provider:initial" }),
        update: () => (++calls === 1 ? first.promise : second.promise),
      },
    })
    await manager.connect()
    const older = manager.selectModel("provider:first")
    await flush()
    const submitted = manager.waitForModelSelection().then(
      () => undefined,
      (error: unknown) => error,
    )
    const newer = manager.selectModel("provider:second")
    first.resolve(workspaceInfo("ws-1", { model: "provider:first-confirmed" }))
    await older
    await flush()
    second.reject(new Error("save failed"))
    await newer
    expect(await submitted).toEqual(new Error("save failed"))
    expect(manager.modelKey()).toBe("provider:first-confirmed")
    await manager.waitForModelSelection()
    manager.dispose()
  })

  test("rejects a waiting submit when the workspace changes", async () => {
    localStorage.clear()
    const pending = Promise.withResolvers<WorkspaceInfoResponse>()
    const { manager } = createEnv({
      workspace: {
        list: async () => ({ data: [workspaceRow("ws-1"), workspaceRow("ws-2")] }),
        get: async ({ id }) => workspaceInfo(id),
        update: () => pending.promise,
      },
    })
    await manager.connect()
    const saving = manager.selectModel("provider:new")
    await flush()
    const submitted = manager.waitForModelSelection().then(
      () => undefined,
      (error: unknown) => error,
    )
    await manager.switchWorkspace("ws-2")
    pending.resolve(workspaceInfo("ws-1", { model: "provider:new" }))
    await saving
    expect(await submitted).toBeInstanceOf(Error)
    expect(manager.modelKey()).toBeNull()
    manager.dispose()
    localStorage.clear()
  })

  test("waits for the topbar Subagent selection and includes it in model intent", async () => {
    const { manager, fakePort } = createEnv()
    await manager.connect()
    const intent = manager.modelIntent()
    const pending = fakePort.deferNextPatch()
    const saving = manager.masterAgent.coder.set({ providerID: "provider", modelID: "worker" })
    let submitted = false
    const submission = manager.waitForModelSelection().then(() => {
      submitted = true
    })
    expect(manager.modelIntent()).toBeGreaterThan(intent)
    await flush()
    expect(submitted).toBe(false)
    pending.resolve({ model: null, operatingAgent: null, coderModel: { providerID: "provider", modelID: "worker" } })
    await saving
    await submission
    expect(submitted).toBe(true)
    manager.dispose()
  })

  test("rejects a waiting submit on Subagent save failure and permits the restored selection afterward", async () => {
    const { manager, fakePort } = createEnv({ coderModel: "provider:initial" })
    await manager.connect()
    const pending = fakePort.deferNextPatch()
    const saving = manager.masterAgent.coder.set({ providerID: "provider", modelID: "worker" })
    const submitted = manager.waitForModelSelection().then(
      () => undefined,
      (error: unknown) => error,
    )
    pending.reject(new Error("worker save failed"))
    await expect(saving).rejects.toThrow("worker save failed")
    expect(await submitted).toEqual(new Error("worker save failed"))
    expect(manager.masterAgent.coder.model()).toEqual({ providerID: "provider", modelID: "initial" })
    await manager.waitForModelSelection()
    manager.dispose()
  })

  test("does not lose a Main save failure when the Subagent choice changes during the same wait", async () => {
    const pending = Promise.withResolvers<WorkspaceInfoResponse>()
    const { manager } = createEnv({ workspace: { update: () => pending.promise } })
    await manager.connect()
    const saving = manager.selectModel("provider:new")
    const submitted = manager.waitForModelSelection().then(
      () => undefined,
      (error: unknown) => error,
    )
    await manager.masterAgent.coder.set({ providerID: "provider", modelID: "worker" })
    pending.reject(new Error("main save failed"))
    await saving
    expect(await submitted).toEqual(new Error("main save failed"))
    await manager.waitForModelSelection()
    manager.dispose()
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
    await manager.selectModel("provider:new")
    hydration.resolve(
      workspaceInfo("ws-2", {
        operatingAgent: "agent:stale-hydration",
        model: "provider:stale-hydration",
      }),
    )
    await switching

    expect(manager.modelKey()).toBe("provider:authoritative")
  })

  for (const mutation of [
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

  for (const mutation of [
    {
      name: "model",
      run: (manager: CanvasManager) => manager.selectModel("provider:next"),
    },
    {
      name: "directories",
      run: (manager: CanvasManager) => manager.updateDirectories(["/next"]),
    },
  ]) {
    test(`does not recover an obsolete ${mutation.name} mutation over the selected workspace`, async () => {
      localStorage.clear()
      const pending = Promise.withResolvers<WorkspaceInfoResponse>()
      const updateStarted = Promise.withResolvers<void>()
      let lists = 0
      const { manager } = createEnv({
        workspace: {
          list: async () => {
            lists += 1
            return { data: [workspaceRow("ws-1"), workspaceRow("ws-2")] }
          },
          get: async ({ id }) => workspaceInfo(id),
          layoutGet: async ({ workspaceID }) => ({
            data: {
              blocks: [record(workspaceID === "ws-2" ? "server-b" : "server-a")],
              revision: workspaceID === "ws-2" ? 20 : 1,
            },
          }),
          update: () => {
            updateStarted.resolve()
            return pending.promise
          },
        },
      })
      await manager.connect()
      const mutating = mutation.run(manager)
      await updateStarted.promise
      await manager.switchWorkspace("ws-2")
      pending.reject(serverError(404, "WorkspaceNotFoundError"))
      await mutating

      try {
        expect(lists).toBe(1)
        expect(manager.workspaceID()).toBe("ws-2")
        expect(manager.revision()).toBe(20)
      } finally {
        manager.dispose()
      }
    })
  }

  test("does not redirect a directory mutation after its recovery is superseded", async () => {
    localStorage.clear()
    const staleRefresh = Promise.withResolvers<LayoutResponse>()
    const refreshStarted = Promise.withResolvers<void>()
    const recoveryList = Promise.withResolvers<{ data: WorkspaceRecord[] }>()
    const recoveryStarted = Promise.withResolvers<void>()
    const updates: string[] = []
    let lists = 0
    let sourceReads = 0
    const { manager } = createEnv({
      workspace: {
        list: async () => {
          lists += 1
          if (lists === 1) return { data: [workspaceRow("ws-1"), workspaceRow("ws-2")] }
          recoveryStarted.resolve()
          return recoveryList.promise
        },
        get: async ({ id }) => workspaceInfo(id),
        layoutGet: async ({ workspaceID }) => {
          if (workspaceID === "ws-2") return { data: { blocks: [record("server-b")], revision: 20 } }
          sourceReads += 1
          if (sourceReads === 1) return { data: { blocks: [record("server-a")], revision: 1 } }
          refreshStarted.resolve()
          return staleRefresh.promise
        },
        update: async ({ workspaceUpdatePayload }) => {
          updates.push(workspaceUpdatePayload.id)
          if (updates.length === 1) throw serverError(404, "WorkspaceNotFoundError")
          return { data: {} }
        },
      },
    })
    await manager.connect()
    const refreshing = manager.refresh()
    await refreshStarted.promise
    const switching = manager.switchWorkspace("ws-2")
    const mutation = manager.updateDirectories(["/source-intent"])
    await recoveryStarted.promise
    staleRefresh.resolve({ data: { blocks: [record("stale-a")], revision: 1 } })
    await switching

    try {
      recoveryList.resolve({ data: [workspaceRow("ws-1"), workspaceRow("ws-2")] })
      await Promise.all([refreshing, mutation])
      expect(updates).toEqual(["ws-1"])
      expect(manager.workspaceID()).toBe("ws-2")
      expect(manager.directories()).toEqual([])
    } finally {
      staleRefresh.resolve({ data: { blocks: [record("stale-a")], revision: 1 } })
      recoveryList.resolve({ data: [workspaceRow("ws-1"), workspaceRow("ws-2")] })
      await Promise.allSettled([refreshing, switching, mutation])
      manager.dispose()
    }
  })

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

  test("HTTP save rejection keeps the canvas connected without automatic retries", async () => {
    const notifications: string[] = []
    const { manager, fakeSDK } = createEnv({
      workspace: {
        layoutSave: async () => {
          throw new Error("Invalid layout coordinate", { cause: { status: 400, body: { _tag: "HttpApiDecodeError" } } })
        },
      },
      notify: (message) => notifications.push(message),
    })
    try {
      await manager.connect()
      manager.noteLocalEdit()
      await manager.sync()

      expect(manager.connected()).toBe(true)
      expect(manager.dirty()).toBe(true)
      expect(notifications).toEqual(["Invalid layout coordinate"])
      await new Promise((resolve) => setTimeout(resolve, 3100))
      expect(fakeSDK.calls.filter((call) => call.method === "layout-save")).toHaveLength(1)
      expect(fakeSDK.calls.filter((call) => call.method === "layout-get")).toHaveLength(1)
    } finally {
      manager.dispose()
    }
  })

  test("HTTP refresh rejection keeps the canvas connected and preserves unsaved edits", async () => {
    let reads = 0
    const notifications: string[] = []
    const { manager } = createEnv({
      workspace: {
        layoutGet: async () => {
          if (++reads > 1) throw serverError(403, "AccessDeniedError")
          return { data: { blocks: [], revision: 1 } }
        },
      },
      notify: (message) => notifications.push(message),
    })
    try {
      await manager.connect()
      manager.noteLocalEdit()
      expect(await manager.refresh()).toBeUndefined()
      expect(manager.connected()).toBe(true)
      expect(manager.dirty()).toBe(true)
      expect(notifications).toEqual(["opencode server 403"])
    } finally {
      manager.dispose()
    }
  })

  test("edits queued during a successful save are persisted after that save completes", async () => {
    const pending = Promise.withResolvers<LayoutSaveResponse>()
    const saved: WorkspaceBlockRecord[][] = []
    const { manager, setRecords } = createEnv({
      workspace: {
        layoutSave: async ({ blocks }) => {
          saved.push(blocks)
          if (saved.length === 1) return pending.promise
          return { data: { status: "saved", layout: { blocks, revision: 3 } } }
        },
      },
    })
    try {
      await manager.connect()
      manager.noteLocalEdit()
      const saving = manager.sync()
      setRecords([record("newer-local")])
      manager.noteLocalEdit()
      const queued = manager.sync()
      pending.resolve({ data: { status: "saved", layout: { blocks: saved[0], revision: 2 } } })
      await Promise.all([saving, queued])
      await flush()

      expect(saved).toEqual([[record("block-a"), record("block-b")], [record("newer-local")]])
      expect(manager.revision()).toBe(3)
      expect(manager.dirty()).toBe(false)
    } finally {
      manager.dispose()
    }
  })

  test("workspace switching waits for every queued layout save", async () => {
    const firstSave = Promise.withResolvers<LayoutSaveResponse>()
    const secondSave = Promise.withResolvers<LayoutSaveResponse>()
    const secondStarted = Promise.withResolvers<void>()
    let saves = 0
    const { manager, setRecords } = createEnv({
      workspace: {
        list: async () => ({ data: [workspaceRow("ws-1"), workspaceRow("ws-2")] }),
        get: async ({ id }) => workspaceInfo(id),
        layoutGet: async ({ workspaceID }) => ({
          data: { blocks: [record(`server-${workspaceID}`)], revision: workspaceID === "ws-1" ? 1 : 20 },
        }),
        layoutSave: async () => {
          saves += 1
          if (saves === 1) return firstSave.promise
          secondStarted.resolve()
          return secondSave.promise
        },
      },
    })
    await manager.connect()
    manager.noteLocalEdit()
    const draining = manager.sync()
    setRecords([record("newer-local")])
    manager.noteLocalEdit()
    firstSave.resolve({ data: { status: "saved", layout: { blocks: [record("initial-local")], revision: 2 } } })
    await secondStarted.promise

    let switched = false
    const switching = manager.switchWorkspace("ws-2").then(() => {
      switched = true
    })
    await flush()

    try {
      expect(switched).toBe(false)
      expect(manager.workspaceID()).toBe("ws-1")
      secondSave.resolve({ data: { status: "saved", layout: { blocks: [record("newer-local")], revision: 3 } } })
      await Promise.all([draining, switching])
      expect(manager.workspaceID()).toBe("ws-2")
      expect(manager.revision()).toBe(20)
    } finally {
      secondSave.resolve({ data: { status: "saved", layout: { blocks: [record("newer-local")], revision: 3 } } })
      await Promise.allSettled([draining, switching])
      manager.dispose()
    }
  })

  test("disposing during a save does not persist queued edits through the retired manager", async () => {
    const pending = Promise.withResolvers<LayoutSaveResponse>()
    const saved: WorkspaceBlockRecord[][] = []
    const { manager, setRecords } = createEnv({
      workspace: {
        layoutSave: async ({ blocks }) => {
          saved.push(blocks)
          if (saved.length === 1) return pending.promise
          return { data: { status: "saved", layout: { blocks, revision: 3 } } }
        },
      },
    })
    await manager.connect()
    manager.noteLocalEdit()
    const saving = manager.sync()
    setRecords([record("newer-local")])
    manager.noteLocalEdit()
    manager.dispose()
    pending.resolve({ data: { status: "saved", layout: { blocks: saved[0], revision: 2 } } })
    await saving
    await flush()

    expect(saved).toEqual([[record("block-a"), record("block-b")]])
  })

  test("a rejected save cannot reconnect a disposed manager", async () => {
    const pending = Promise.withResolvers<LayoutSaveResponse>()
    const { manager, fakeSDK } = createEnv({
      workspace: { layoutSave: async () => pending.promise },
    })
    await manager.connect()
    manager.noteLocalEdit()
    const saving = manager.sync()
    await flush()
    manager.dispose()
    pending.reject(serverError(500, "InternalServerError"))
    await saving
    await new Promise((resolve) => setTimeout(resolve, 3100))

    expect(fakeSDK.calls.filter((call) => call.method === "layout-get")).toHaveLength(1)
  })

  test("edits made during a conflict refresh are persisted after the refresh completes", async () => {
    const pending = Promise.withResolvers<LayoutResponse>()
    const saved: WorkspaceBlockRecord[][] = []
    const serverLayouts: WorkspaceBlockRecord[][] = []
    let reads = 0
    const { manager, setRecords } = createEnv({
      workspace: {
        layoutGet: async () => {
          if (++reads > 1) return pending.promise
          return { data: { blocks: [record("remote")], revision: 1 } }
        },
        layoutSave: async ({ blocks }) => {
          saved.push(blocks)
          if (saved.length === 1) return { data: { status: "conflict", currentRevision: 2 } }
          return { data: { status: "saved", layout: { blocks, revision: 3 } } }
        },
      },
      onServerLayout: (layout) => serverLayouts.push(layout.blocks),
    })
    try {
      await manager.connect()
      manager.noteLocalEdit()
      const syncing = manager.sync()
      await flush()
      setRecords([record("newer-local")])
      manager.noteLocalEdit()
      pending.resolve({ data: { blocks: [record("remote-newer")], revision: 2 } })
      await syncing
      await flush()

      expect(serverLayouts).toEqual([[record("remote")]])
      expect(saved).toEqual([[record("block-a"), record("block-b")], [record("newer-local")]])
      expect(manager.dirty()).toBe(false)
    } finally {
      manager.dispose()
    }
  })

  test("authority handover reclaims authority and persists the pending local layout", async () => {
    const saved: WorkspaceBlockRecord[][] = []
    const serverLayouts: WorkspaceBlockRecord[][] = []
    const { manager, setRecords } = createEnv({
      workspace: {
        layoutGet: async () => ({ data: { blocks: [record("remote")], revision: 2 } }),
        layoutSave: async ({ blocks }) => {
          saved.push(blocks)
          if (saved.length === 1) return { data: { status: "handed-over", currentRevision: 2 } }
          return { data: { status: "saved", layout: { blocks, revision: 3 } } }
        },
      },
      onServerLayout: (layout) => serverLayouts.push(layout.blocks),
    })
    try {
      await manager.connect()
      setRecords([record("local")])
      manager.noteLocalEdit()
      await manager.sync()
      await flush()

      expect(serverLayouts).toEqual([[record("remote")]])
      expect(saved).toEqual([[record("local")], [record("local")]])
      expect(manager.dirty()).toBe(false)
      expect(manager.connected()).toBe(true)
    } finally {
      manager.dispose()
    }
  })

  test.each(["conflict", "handed-over"] as const)(
    "restarts a stale concurrent refresh while resolving a %s save",
    async (status) => {
      const firstSave = Promise.withResolvers<LayoutSaveResponse>()
      const staleRefresh = Promise.withResolvers<LayoutResponse>()
      const saveStarted = Promise.withResolvers<void>()
      const refreshStarted = Promise.withResolvers<void>()
      const serverLayouts: WorkspaceBlockRecord[][] = []
      let reads = 0
      let saves = 0
      const { manager } = createEnv({
        workspace: {
          layoutGet: async () => {
            reads += 1
            if (reads === 1) return { data: { blocks: [record("initial")], revision: 1 } }
            if (reads === 2) {
              refreshStarted.resolve()
              return staleRefresh.promise
            }
            return {
              data: { blocks: [record("remote-newer")], revision: status === "handed-over" ? 1 : 2 },
            }
          },
          layoutSave: async ({ blocks }) => {
            saves += 1
            if (saves === 1) {
              saveStarted.resolve()
              return firstSave.promise
            }
            return { data: { status: "saved", layout: { blocks, revision: 3 } } }
          },
        },
        onServerLayout: (layout) => serverLayouts.push(layout.blocks),
      })
      try {
        await manager.connect()
        manager.noteLocalEdit()
        const draining = manager.sync()
        await saveStarted.promise
        const refreshing = manager.refresh()
        await refreshStarted.promise
        firstSave.resolve({ data: { status, currentRevision: status === "handed-over" ? 1 : 2 } })
        await flush()
        staleRefresh.resolve({ data: { blocks: [record("stale")], revision: 1 } })
        await Promise.all([draining, refreshing])

        expect(reads).toBe(3)
        expect(saves).toBe(status === "handed-over" ? 2 : 1)
        expect(serverLayouts).toEqual(
          status === "conflict" ? [[record("initial")], [record("remote-newer")]] : [[record("initial")]],
        )
        expect(manager.dirty()).toBe(false)
        expect(manager.connected()).toBe(true)
      } finally {
        manager.dispose()
      }
    },
  )

  test("a realtime event queues a fresh pull after an in-flight refresh", async () => {
    const staleRefresh = Promise.withResolvers<LayoutResponse>()
    const refreshStarted = Promise.withResolvers<void>()
    const serverLayouts: WorkspaceBlockRecord[][] = []
    let reads = 0
    const { manager, fakeSDK } = createEnv({
      workspace: {
        layoutGet: async () => {
          reads += 1
          if (reads === 1) return { data: { blocks: [record("initial")], revision: 1 } }
          if (reads === 2) {
            refreshStarted.resolve()
            return staleRefresh.promise
          }
          return { data: { blocks: [record("remote-newer")], revision: 2 } }
        },
      },
      onServerLayout: (layout) => serverLayouts.push(layout.blocks),
    })
    try {
      await manager.connect()
      manager.start()
      const refreshing = manager.refresh()
      await refreshStarted.promise
      // Event revisions span device-class tuples; this unrelated high value
      // must trigger one pull rather than becoming an unreachable local floor.
      fakeSDK.emit({ type: "workspace.layout.updated", properties: { workspaceID: "ws-1", revision: 100 } })
      staleRefresh.resolve({ data: { blocks: [record("stale")], revision: 1 } })
      await refreshing
      await flush()

      expect(reads).toBe(3)
      expect(serverLayouts).toEqual([[record("initial")], [record("remote-newer")]])
      expect(manager.revision()).toBe(2)
    } finally {
      manager.dispose()
    }
  })

  test("a successful save advances an in-flight refresh past a stale response", async () => {
    const staleRefresh = Promise.withResolvers<LayoutResponse>()
    const refreshStarted = Promise.withResolvers<void>()
    const serverLayouts: WorkspaceBlockRecord[][] = []
    let reads = 0
    const { manager } = createEnv({
      workspace: {
        layoutGet: async () => {
          reads += 1
          if (reads === 1) return { data: { blocks: [record("initial")], revision: 1 } }
          if (reads === 2) {
            refreshStarted.resolve()
            return staleRefresh.promise
          }
          return { data: { blocks: [record("saved-layout")], revision: 2 } }
        },
        layoutSave: async ({ blocks }) => ({ data: { status: "saved", layout: { blocks, revision: 2 } } }),
      },
      onServerLayout: (layout) => serverLayouts.push(layout.blocks),
    })
    try {
      await manager.connect()
      const refreshing = manager.refresh()
      await refreshStarted.promise
      manager.noteLocalEdit()
      await manager.sync()
      staleRefresh.resolve({ data: { blocks: [record("stale")], revision: 1 } })
      await refreshing

      expect(reads).toBe(2)
      expect(serverLayouts).toEqual([[record("initial")]])
      expect(manager.revision()).toBe(2)
    } finally {
      manager.dispose()
    }
  })

  test("an obsolete refresh failure cannot disconnect a newer successful save", async () => {
    const staleRefresh = Promise.withResolvers<LayoutResponse>()
    const refreshStarted = Promise.withResolvers<void>()
    const notifications: string[] = []
    let reads = 0
    const { manager } = createEnv({
      workspace: {
        layoutGet: async () => {
          reads += 1
          if (reads === 1) return { data: { blocks: [record("initial")], revision: 1 } }
          refreshStarted.resolve()
          return staleRefresh.promise
        },
        layoutSave: async ({ blocks }) => ({ data: { status: "saved", layout: { blocks, revision: 2 } } }),
      },
      notify: (message) => notifications.push(message),
    })
    try {
      await manager.connect()
      const refreshing = manager.refresh()
      await refreshStarted.promise
      manager.noteLocalEdit()
      await manager.sync()
      staleRefresh.reject(serverError(500, "InternalServerError"))
      await refreshing

      expect(manager.connected()).toBe(true)
      expect(manager.revision()).toBe(2)
      expect(manager.dirty()).toBe(false)
      expect(notifications).not.toContain("Canvas is read-only while offline")
    } finally {
      manager.dispose()
    }
  })

  test("an obsolete save failure cannot disconnect a recovered workspace", async () => {
    const staleSave = Promise.withResolvers<LayoutSaveResponse>()
    const saveStarted = Promise.withResolvers<void>()
    const notifications: string[] = []
    let lists = 0
    let reads = 0
    const { manager } = createEnv({
      workspace: {
        list: async () => ({ data: [workspaceRow(++lists === 1 ? "ws-1" : "ws-2")] }),
        get: async ({ id }) => workspaceInfo(id),
        layoutGet: async ({ workspaceID }) => {
          reads += 1
          if (workspaceID === "ws-1" && reads > 1) throw serverError(404, "WorkspaceNotFoundError")
          return { data: { blocks: [record(`server-${workspaceID}`)], revision: workspaceID === "ws-1" ? 1 : 10 } }
        },
        layoutSave: async () => {
          saveStarted.resolve()
          return staleSave.promise
        },
      },
      notify: (message) => notifications.push(message),
    })
    try {
      await manager.connect()
      manager.noteLocalEdit()
      const syncing = manager.sync()
      await saveStarted.promise
      await manager.refresh()
      expect(manager.workspaceID()).toBe("ws-2")
      staleSave.reject(new Error("old transport failed"))
      await syncing

      expect(manager.workspaceID()).toBe("ws-2")
      expect(manager.connected()).toBe(true)
      expect(manager.revision()).toBe(10)
      expect(manager.dirty()).toBe(true)
      expect(notifications).not.toContain("Canvas is read-only while offline")
    } finally {
      manager.dispose()
    }
  })

  test("a realtime event received during a successful save is pulled after the sync", async () => {
    const pendingSave = Promise.withResolvers<LayoutSaveResponse>()
    const saveStarted = Promise.withResolvers<void>()
    const serverLayouts: WorkspaceBlockRecord[][] = []
    let reads = 0
    const { manager, fakeSDK } = createEnv({
      workspace: {
        layoutGet: async () => {
          reads += 1
          if (reads === 1) return { data: { blocks: [record("initial")], revision: 1 } }
          return { data: { blocks: [record("remote-newer")], revision: 3 } }
        },
        layoutSave: async () => {
          saveStarted.resolve()
          return pendingSave.promise
        },
      },
      onServerLayout: (layout) => serverLayouts.push(layout.blocks),
    })
    try {
      await manager.connect()
      manager.start()
      manager.noteLocalEdit()
      const syncing = manager.sync()
      await saveStarted.promise
      fakeSDK.emit({ type: "workspace.layout.updated", properties: { workspaceID: "ws-1", revision: 3 } })
      pendingSave.resolve({ data: { status: "saved", layout: { blocks: [record("local")], revision: 2 } } })
      await syncing
      await flush()

      expect(reads).toBe(2)
      expect(serverLayouts).toEqual([[record("initial")], [record("remote-newer")]])
      expect(manager.revision()).toBe(3)
      expect(manager.dirty()).toBe(false)
    } finally {
      manager.dispose()
    }
  })

  test("a queued event from the old workspace cannot refresh the newly switched workspace", async () => {
    const pendingSave = Promise.withResolvers<LayoutSaveResponse>()
    const saveStarted = Promise.withResolvers<void>()
    const bHydration = Promise.withResolvers<LayoutResponse>()
    const bHydrationStarted = Promise.withResolvers<void>()
    let bReads = 0
    const { manager, fakeSDK } = createEnv({
      workspace: {
        list: async () => ({ data: [workspaceRow("ws-1"), workspaceRow("ws-2")] }),
        get: async ({ id }) => workspaceInfo(id),
        layoutGet: async ({ workspaceID }) => {
          if (workspaceID === "ws-1") return { data: { blocks: [record("server-a")], revision: 1 } }
          bReads += 1
          if (bReads === 1) {
            bHydrationStarted.resolve()
            return bHydration.promise
          }
          return { data: { blocks: [record("server-b-newer")], revision: 21 } }
        },
        layoutSave: async () => {
          saveStarted.resolve()
          return pendingSave.promise
        },
      },
    })
    try {
      await manager.connect()
      manager.start()
      manager.noteLocalEdit()
      const syncing = manager.sync()
      await saveStarted.promise
      const switching = manager.switchWorkspace("ws-2")
      fakeSDK.emit({ type: "workspace.layout.updated", properties: { workspaceID: "ws-1", revision: 2 } })
      pendingSave.resolve({ data: { status: "saved", layout: { blocks: [record("local-a")], revision: 2 } } })
      await bHydrationStarted.promise
      await flush()

      expect(bReads).toBe(1)
      bHydration.resolve({ data: { blocks: [record("server-b")], revision: 20 } })
      await Promise.all([syncing, switching])
      expect(manager.workspaceID()).toBe("ws-2")
      expect(manager.revision()).toBe(20)
    } finally {
      bHydration.resolve({ data: { blocks: [record("server-b")], revision: 20 } })
      manager.dispose()
    }
  })

  test("contains a failed background layout refresh without an unhandled rejection", async () => {
    const recoveryAttempted = Promise.withResolvers<void>()
    let lists = 0
    let reads = 0
    const { manager, fakeSDK } = createEnv({
      workspace: {
        list: async () => {
          if (++lists === 1) return { data: [workspaceRow("ws-1")] }
          recoveryAttempted.resolve()
          throw new Error("workspace recovery unavailable")
        },
        layoutGet: async () => {
          if (++reads === 1) return { data: { blocks: [record("initial")], revision: 1 } }
          throw serverError(404, "WorkspaceNotFoundError")
        },
      },
    })

    try {
      await manager.connect()
      manager.start()
      fakeSDK.emit({ type: "workspace.layout.updated", properties: { workspaceID: "ws-1", revision: 2 } })
      await recoveryAttempted.promise
      await flush()

      expect(manager.connected()).toBe(false)
    } finally {
      manager.dispose()
    }
  })

  test("contains failed workspace recovery from a fire-and-forget connect", async () => {
    localStorage.clear()
    const recoveryAttempted = Promise.withResolvers<void>()
    let lists = 0
    const { manager } = createEnv({
      workspace: {
        list: async () => {
          if (++lists === 1) return { data: [workspaceRow("ws-1")] }
          recoveryAttempted.resolve()
          throw new Error("workspace recovery unavailable")
        },
        layoutGet: async () => {
          throw serverError(404, "WorkspaceNotFoundError")
        },
      },
    })

    try {
      manager.start()
      await recoveryAttempted.promise
      await flush()

      expect(manager.connected()).toBe(false)
    } finally {
      manager.dispose()
    }
  })

  test("repeated authority handover leaves edits pending after one reclaim attempt", async () => {
    let saves = 0
    const { manager, fakeSDK } = createEnv({
      workspace: {
        layoutGet: async () => ({ data: { blocks: [], revision: 2 } }),
        layoutSave: async ({ blocks }) => {
          if (++saves > 3) throw serverError(409, "ConflictError")
          return { data: { status: "handed-over", currentRevision: 2 } }
        },
      },
    })
    try {
      await manager.connect()
      manager.noteLocalEdit()
      await manager.sync()
      await flush()

      expect(saves).toBe(2)
      expect(fakeSDK.calls.filter((call) => call.method === "layout-get")).toHaveLength(2)
      expect(manager.dirty()).toBe(true)
      expect(manager.connected()).toBe(true)
    } finally {
      manager.dispose()
    }
  })

  test("retryable HTTP save failure marks the canvas offline and preserves dirty layout through reconnect", async () => {
    let saveCount = 0
    const notifications: string[] = []
    const serverLayouts: WorkspaceBlockRecord[][] = []
    const { manager } = createEnv({
      workspace: {
        layoutGet: async () => ({ data: { blocks: [record("server")], revision: 1 } }),
        layoutSave: async ({ blocks }) => {
          saveCount += 1
          if (saveCount === 1) throw serverError(500, "InternalServerError")
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
            return { data: { status: "conflict", currentRevision: 2 } }
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
