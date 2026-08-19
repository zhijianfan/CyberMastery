import { describe, expect, test } from "bun:test"
import {
  ChatRelayRuntimeAdapter,
  CHAT_RELAY_DEFAULT_SESSION_ID,
  createMockChatRelayContext,
  type ChatRelayRuntimeContext,
  type RuntimeResourceBinding,
  type RuntimeResourceState,
} from "./runtime"

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const makeDescriptor = () => ({
  id: "block-1",
  functionalityID: "builtin:chat-relay" as const,
  layout: { x: 0, y: 0, width: 0, height: 0 },
  bindings: { sessionID: CHAT_RELAY_DEFAULT_SESSION_ID },
})

describe("ChatRelayRuntimeAdapter", () => {
  test("collects all runtime bindings", () => {
    const descriptor = makeDescriptor()
    const bindings = ChatRelayRuntimeAdapter.getBindings(descriptor)
    expect(bindings).toEqual([
      { type: "auth", id: "opencode" },
      { type: "session", id: CHAT_RELAY_DEFAULT_SESSION_ID },
      { type: "message", id: CHAT_RELAY_DEFAULT_SESSION_ID },
      { type: "message-part", id: CHAT_RELAY_DEFAULT_SESSION_ID },
      { type: "permission", id: CHAT_RELAY_DEFAULT_SESSION_ID },
    ])
  })

  test("select merges message text and pending permissions", () => {
    const descriptor = makeDescriptor()
    const state: RuntimeResourceState = {
      connection: { status: "connected" },
      authByProvider: {
        opencode: {
          providerID: "opencode",
          status: "ready",
        },
      },
      sessionsByID: {
      "chat-relay-default-session": {
        id: CHAT_RELAY_DEFAULT_SESSION_ID,
        status: "idle",
      },
      },
      messagesByID: {
        userMessage: {
          id: "userMessage",
          sessionID: CHAT_RELAY_DEFAULT_SESSION_ID,
          role: "user",
          timeCreated: 101,
        },
        assistantMessage: {
          id: "assistantMessage",
          sessionID: CHAT_RELAY_DEFAULT_SESSION_ID,
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
          sessionID: CHAT_RELAY_DEFAULT_SESSION_ID,
          status: "pending",
        },
        resolved: {
          id: "resolved",
          requestID: "request-2",
          sessionID: CHAT_RELAY_DEFAULT_SESSION_ID,
          status: "resolved",
        },
      },
    }

    const view = ChatRelayRuntimeAdapter.select(descriptor, state)
    expect(view.session?.id).toBe(CHAT_RELAY_DEFAULT_SESSION_ID)
    expect(view.messages).toHaveLength(2)
    expect(view.messages[1]?.text).toBe("Hello world")
    expect(view.pendingPermissions[0]?.requestID).toBe("request-1")
    expect(view.errors).toEqual([])
  })

  test("dispatch passes command to context", async () => {
    const descriptor = makeDescriptor()
    let commandType = ""
    const context: ChatRelayRuntimeContext = {
      async snapshot() {
        return {
          cursor: "0",
          state: {
            connection: { status: "connected" },
            authByProvider: {
              opencode: { providerID: "opencode", status: "ready" },
            },
            sessionsByID: {},
            messagesByID: {},
            partsByID: {},
            permissionsByID: {},
          },
        }
      },
      subscribe: () => () => {},
      async sendCommand(command) {
        commandType = command.type
      },
    }

    await ChatRelayRuntimeAdapter.dispatch(descriptor, { type: "session.create" }, context)
    expect(commandType).toBe("session.create")
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
          resource: { type: "session", id: CHAT_RELAY_DEFAULT_SESSION_ID },
          apply: (state) => {
            state.sessionsByID[CHAT_RELAY_DEFAULT_SESSION_ID] = {
              id: CHAT_RELAY_DEFAULT_SESSION_ID,
              status: "idle",
            }
          },
        },
        {
          cursor: "2",
          delayMs: 10,
          resource: { type: "session", id: CHAT_RELAY_DEFAULT_SESSION_ID },
          apply: (state) => {
            state.connection = { status: "connected" }
          },
        },
        {
          cursor: "2",
          delayMs: 16,
          resource: { type: "session", id: CHAT_RELAY_DEFAULT_SESSION_ID },
          apply: (state) => {
            state.connection = { status: "disconnected" }
          },
        },
        {
          cursor: "1",
          delayMs: 22,
          resource: { type: "session", id: CHAT_RELAY_DEFAULT_SESSION_ID },
          apply: (state) => {
            state.connection = { status: "disconnected" }
          },
        },
      ],
    })
    const bindings: RuntimeResourceBinding[] = [{ type: "session", id: CHAT_RELAY_DEFAULT_SESSION_ID }]
    const cursors: string[] = []

    const unsubscribe = context.subscribe(bindings, "0", (event) => {
      cursors.push(event.cursor)
    })

    await delay(250)
    unsubscribe()

    expect(cursors).toEqual(["1", "2"])
  })
})
