import { describe, expect, test } from "bun:test"
import type { BlockRuntimeServices } from "../../runtime/contracts"
import type { ServerSDK } from "@/context/server-sdk"
import { ChatRelayRuntimeAdapter, createMockChatRelayContext, type ChatRelayResolved } from "./runtime"
import type { ChatRelayBlockDescriptor, RuntimeResourceBinding, RuntimeResourceState } from "./types"

const RELAY_SESSION_ID = "relay-session-1"
const SESSION_ID = "chat-relay-default-session"

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function makeDescriptor(sessionID: string): ChatRelayBlockDescriptor {
  return {
    id: "block-1",
    functionalityID: "builtin:chat-relay",
    layout: { x: 0, y: 0, width: 0, height: 0 },
    bindings: { sessionID },
  }
}

function seedState(sessionID: string = RELAY_SESSION_ID): RuntimeResourceState {
  return {
    connection: { status: "connected" },
    authByProvider: {
      opencode: {
        providerID: "opencode",
        status: "ready",
      },
    },
    sessionsByID: {
      [sessionID]: { id: sessionID, status: "idle" },
    },
    messagesByID: {
      userMessage: {
        id: "userMessage",
        sessionID,
        role: "user",
        timeCreated: 101,
      },
      assistantMessage: {
        id: "assistantMessage",
        sessionID,
        role: "assistant",
        timeCreated: 102,
      },
    },
    partsByID: {
      partA: {
        id: "partA",
        messageID: "assistantMessage",
        kind: "text",
        text: "Hello",
      },
      partB: {
        id: "partB",
        messageID: "assistantMessage",
        kind: "text",
        text: " world",
      },
      partTool: {
        id: "partTool",
        messageID: "assistantMessage",
        kind: "tool",
        state: { call: "search" },
      },
    },
    permissionsByID: {
      waiting: {
        id: "waiting",
        requestID: "request-1",
        sessionID,
        status: "pending",
      },
      resolved: {
        id: "resolved",
        requestID: "request-2",
        sessionID,
        status: "resolved",
      },
    },
  }
}

interface FakeCall {
  method: string
  args: unknown
}

function makeFakeSDK(state: RuntimeResourceState) {
  const calls: FakeCall[] = []
  const client = {
    v2: {
      workspace: {
        chatRelay: {
          ensure: async (parameters: { workspaceID: string; blockID: string }) => {
            calls.push({ method: "workspace.chatRelay.ensure", args: parameters })
            return { data: { sessionID: RELAY_SESSION_ID } }
          },
        },
      },
      blockRuntime: {
        snapshot: async (parameters: { blockRuntimeSnapshotRequest: { bindings: RuntimeResourceBinding[] } }) => {
          calls.push({
            method: "blockRuntime.snapshot",
            args: { blockRuntimeSnapshotRequest: { bindings: parameters.blockRuntimeSnapshotRequest.bindings } },
          })
          return { data: { cursor: "3", state } }
        },
      },
      session: {
        prompt: async (args: unknown) => {
          calls.push({ method: "session.prompt", args })
        },
        abort: async (args: unknown) => {
          calls.push({ method: "session.abort", args })
        },
        create: async (args: unknown) => {
          calls.push({ method: "session.create", args })
        },
      },
      permission: {
        respond: async (args: unknown) => {
          calls.push({ method: "permission.respond", args })
        },
      },
      auth: {
        start: async (args: unknown) => {
          calls.push({ method: "auth.start", args })
        },
      },
    },
  }
  return { sdk: { client } as unknown as ServerSDK, calls }
}

function makeServices(sdk: ServerSDK): BlockRuntimeServices {
  return {
    serverSDK: () => sdk,
    eventRouter: {
      on: () => () => {},
      off: () => {},
      onReconnect: () => () => {},
    },
    workspace: {
      id: () => "ws-1",
      epoch: () => 0,
      connected: () => true,
      awaitDescriptorPersisted: async () => {},
    },
    localView: {
      read: () => undefined,
      write: () => {},
      delete: () => {},
      clearAll: () => {},
    },
  }
}

const makeResolved = (state: RuntimeResourceState): ChatRelayResolved => ({
  sessionID: RELAY_SESSION_ID,
  snapshot: { cursor: "3", state },
  dispose: () => undefined,
})

const abortSignal = () => new AbortController().signal

describe("ChatRelayRuntimeAdapter", () => {
  test("is a native chat-relay registration", () => {
    expect(ChatRelayRuntimeAdapter.functionalityID).toBe("builtin:chat-relay")
    expect(ChatRelayRuntimeAdapter.mode).toBe("native")
  })

  test("getBindings maps sessionID to auth/session/message/part/permission bindings", () => {
    const bindings = ChatRelayRuntimeAdapter.getBindings(makeDescriptor(RELAY_SESSION_ID))
    expect(bindings).toEqual([
      { type: "auth", id: "opencode" },
      { type: "session", id: RELAY_SESSION_ID },
      { type: "message", id: RELAY_SESSION_ID },
      { type: "message-part", id: RELAY_SESSION_ID },
      { type: "permission", id: RELAY_SESSION_ID },
    ])
  })

  test("resolve snapshots through the server SDK and carries the host session id", async () => {
    const state = seedState()
    const { sdk, calls } = makeFakeSDK(state)
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: "ws-1",
      block: {
        id: "block-1",
        functionalityID: "builtin:chat-relay",
        transform: { x: 0, y: 0, w: 0, h: 0, z: 0 },
      },
      services: makeServices(sdk),
      signal: abortSignal(),
    })

    expect(resolved.sessionID).toBe(RELAY_SESSION_ID)
    expect(resolved.snapshot.state).toBe(state)
    expect(calls.find((call) => call.method === "workspace.chatRelay.ensure")?.args).toEqual({
      workspaceID: "ws-1",
      blockID: "block-1",
    })
    expect(calls.find((call) => call.method === "blockRuntime.snapshot")?.args).toEqual({
      blockRuntimeSnapshotRequest: {
        bindings: [
          { type: "auth", id: "opencode" },
          { type: "session", id: RELAY_SESSION_ID },
          { type: "message", id: RELAY_SESSION_ID },
          { type: "message-part", id: RELAY_SESSION_ID },
          { type: "permission", id: RELAY_SESSION_ID },
        ],
      },
    })
  })

  test("select projects the view from the snapshot state", () => {
    const view = ChatRelayRuntimeAdapter.select({
      resolved: makeResolved(seedState()),
      projection: undefined,
      localView: undefined,
    })

    expect(view.sessionID).toBe(RELAY_SESSION_ID)
    expect(view.session?.id).toBe(RELAY_SESSION_ID)
    expect(view.auth?.status).toBe("ready")
    expect(view.messages).toHaveLength(2)
    expect(view.messages[1]?.text).toBe("Hello world")
    expect(view.pendingPermissions[0]?.requestID).toBe("request-1")
    expect(view.errors).toEqual([])
  })

  test("dispatch routes prompt/abort/permission/auth commands to the SDK", async () => {
    const { sdk, calls } = makeFakeSDK(seedState())
    const services = makeServices(sdk)
    const resolved = makeResolved(seedState())

    await ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "session.prompt", text: "hi", delivery: "queue" },
      services,
      signal: abortSignal(),
    })
    await ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "session.abort" },
      services,
      signal: abortSignal(),
    })
    await ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "permission.respond", requestID: "request-1", response: "allow-always" },
      services,
      signal: abortSignal(),
    })
    await ChatRelayRuntimeAdapter.dispatch?.({
      resolved,
      command: { type: "auth.start", providerID: "opencode" },
      services,
      signal: abortSignal(),
    })

    expect(calls.find((call) => call.method === "session.prompt")?.args).toEqual({
      sessionID: RELAY_SESSION_ID,
      prompt: { text: "hi" },
      delivery: "queue",
      resume: true,
    })
    expect(calls.find((call) => call.method === "session.abort")?.args).toEqual({
      sessionID: RELAY_SESSION_ID,
    })
    expect(calls.find((call) => call.method === "permission.respond")?.args).toEqual({
      requestID: "request-1",
      response: "always",
    })
    expect(calls.find((call) => call.method === "auth.start")?.args).toEqual({
      providerID: "opencode",
    })
  })

  test("script events preserve duplicate and stale cursor values", async () => {
    const context = createMockChatRelayContext({
      initialState: {
        connection: { status: "disconnected" },
        authByProvider: {
          opencode: {
            providerID: "opencode",
            status: "ready",
          },
        },
        sessionsByID: {},
        messagesByID: {},
        partsByID: {},
        permissionsByID: {},
      },
      script: [
        {
          cursor: "1",
          delayMs: 5,
          resource: { type: "session", id: SESSION_ID },
          apply: (state) => {
            state.sessionsByID[SESSION_ID] = {
              id: SESSION_ID,
              status: "idle",
            }
          },
        },
        {
          cursor: "2",
          delayMs: 10,
          resource: { type: "session", id: SESSION_ID },
          apply: (state) => {
            state.connection = { status: "connected" }
          },
        },
        {
          cursor: "2",
          delayMs: 16,
          resource: { type: "session", id: SESSION_ID },
          apply: (state) => {
            state.connection = { status: "disconnected" }
          },
        },
        {
          cursor: "1",
          delayMs: 22,
          resource: { type: "session", id: SESSION_ID },
          apply: (state) => {
            state.connection = { status: "disconnected" }
          },
        },
      ],
    })
    const bindings: RuntimeResourceBinding[] = [{ type: "session", id: SESSION_ID }]
    const cursors: string[] = []

    const unsubscribe = context.subscribe(bindings, "0", (event) => {
      cursors.push(event.cursor)
    })

    await delay(250)
    unsubscribe()

    expect(cursors).toEqual(["1", "2"])
  })
})