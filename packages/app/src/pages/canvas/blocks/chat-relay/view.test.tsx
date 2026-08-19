import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createComponent, type Component, type JSX } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import type { PermissionConfig } from "@opencode-ai/sdk/v2/client"
import type { ChatRelayBodyProps } from "./types"
import type { ChatRelayRuntimeContext, RuntimeResourceState } from "./runtime"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

const Fragment = (props: { children?: unknown }) => props.children

;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

const wait = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

let ChatRelayBody: Component<ChatRelayBodyProps>
let runtimeContext: ChatRelayRuntimeContext
let RuntimeModule: typeof import("./runtime")

function setRuntimeContext(context: ChatRelayRuntimeContext) {
  runtimeContext = context
  ;(globalThis as unknown as { __CHAT_RELAY_RUNTIME_CONTEXT__?: ChatRelayRuntimeContext }).__CHAT_RELAY_RUNTIME_CONTEXT__ = context
  const defaultView = (document.defaultView as unknown as { __CHAT_RELAY_RUNTIME_CONTEXT__?: ChatRelayRuntimeContext })
  if (defaultView) {
    defaultView.__CHAT_RELAY_RUNTIME_CONTEXT__ = context
  }
}

beforeAll(async () => {
  RuntimeModule = await import("./runtime")
  mock.module("../../session-surface", () => {
    return {
      CanvasSessionSurface: (props: {
        target: { sessionID: string }
        surfaceID: string
        focused: boolean
        queueEnabled: boolean
        onFocus: () => void
      }) => {
        return h("div", {
          class: "canvas-session-surface",
          "data-surface-id": props.surfaceID,
          "data-session-id": props.target.sessionID,
          "data-focused": String(props.focused),
          "data-queue-enabled": String(props.queueEnabled),
          onPointerDown: () => props.onFocus(),
        })
      },
    }
  })

  ChatRelayBody = (await import("./view")).ChatRelayBody
})

beforeEach(() => {
  ;(globalThis as unknown as { __CHAT_RELAY_RUNTIME_V2__?: boolean }).__CHAT_RELAY_RUNTIME_V2__ = true
  runtimeContext = RuntimeModule.createMockChatRelayContext()
  setRuntimeContext(runtimeContext)
})

afterEach(() => {
  document.body.innerHTML = ""
  ;(globalThis as unknown as { __CHAT_RELAY_RUNTIME_V2__?: boolean }).__CHAT_RELAY_RUNTIME_V2__ = true
})

function mount(node: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(node, host)
  return {
    host,
    dispose: () => {
      dispose()
      host.remove()
    },
  }
}

function baseProps(permissions: PermissionConfig = { webfetch: "ask", websearch: "ask" }): ChatRelayBodyProps {
  return {
    block: { id: "block-1" },
    permissions,
    workspaceID: "ws-1",
    focused: true,
    onFocus: () => {},
  }
}

function createRuntimeState(overrides: Partial<RuntimeResourceState> = {}): RuntimeResourceState {
  return {
    connection: { status: "connected" },
    authByProvider: {
      opencode: {
        providerID: "opencode",
        status: "ready",
      },
    },
    sessionsByID: {
      "chat-relay-default-session": {
        id: "chat-relay-default-session",
        status: "idle",
      },
    },
    messagesByID: {
      m1: {
        id: "m1",
        sessionID: "chat-relay-default-session",
        role: "assistant",
        timeCreated: 1,
      },
    },
    partsByID: {
      p1: {
        id: "p1",
        messageID: "m1",
        kind: "text",
        text: "Hello",
      },
    },
    permissionsByID: {},
    ...overrides,
  }
}

describe("ChatRelayBody runtime-v2", () => {
  test("renders denied block when permissions block network actions", () => {
    const host = mount(() => <ChatRelayBody {...baseProps({ webfetch: "deny", websearch: "ask" })} />)
    expect(host.host.querySelector(".canvas-relay-state-title")?.textContent).toBe("Permission denied")
    host.dispose()
  })

  test("renders sign-in and permission request controls from runtime state", async () => {
    const commands: string[] = []
    setRuntimeContext(
      RuntimeModule.createMockChatRelayContext({
      initialState: createRuntimeState({
        authByProvider: {
          opencode: {
            providerID: "opencode",
            status: "awaiting-login",
            loginURL: "https://example/login",
            userCode: "ABC-123",
          },
        },
      }),
      onCommand: (command) => {
        commands.push(command.type)
      },
      }),
    )
    const host = mount(() => <ChatRelayBody {...baseProps()} />)
    await wait(50)
    expect(host.host.querySelector(".canvas-relay-state-title")?.textContent).toBe("Waiting for sign-in")

    const button = host.host.querySelector("button") as HTMLButtonElement
    button.click()
    await flush()
    expect(commands).toEqual(["auth.start"])

    await wait(1)
    host.dispose()
  })

  test("appends message parts from cursor updates and keeps text stable on stale duplicate cursors", async () => {
    setRuntimeContext(
      RuntimeModule.createMockChatRelayContext({
      initialState: createRuntimeState({
        partsByID: {
          p1: {
            id: "p1",
            messageID: "m1",
            kind: "text",
            text: "Hello",
          },
          p2: {
            id: "p2",
            messageID: "m1",
            kind: "text",
            text: " there",
          },
        },
      }),
      }),
    )

    const host = mount(() => <ChatRelayBody {...baseProps()} />)
    await wait(40)
    expect(host.host.querySelector(".canvas-relay-message-text")?.textContent).toBe("Hello there")
    host.dispose()
  })

  test("shows and resolves permission prompts", async () => {
    setRuntimeContext(
      RuntimeModule.createMockChatRelayContext({
      initialState: createRuntimeState({
        permissionsByID: {
          p1: {
            id: "p1",
            requestID: "req-1",
            sessionID: "chat-relay-default-session",
            status: "pending",
          },
        },
      }),
      onCommand: (command) => {
        if (command.type === "permission.respond") {
          expect(command.response).toBe("allow-once")
        }
      },
      }),
    )

    const host = mount(() => <ChatRelayBody {...baseProps()} />)
    await wait(30)
    const panel = host.host.querySelector("[data-testid=\"chat-relay-permissions\"]")
    expect(panel).not.toBeNull()
    const allow = host.host.querySelector("button") as HTMLButtonElement
    expect(allow?.textContent).toBe("Allow once")
    allow.click()
    await wait(20)
    host.dispose()
  })

  test("keeps prior messages when submitting a prompt fails", async () => {
    const commands: Array<Record<string, unknown>> = []
    setRuntimeContext({
      state: createRuntimeState({
        connection: { status: "connected", lastError: "Submit failed" },
      }),
      async sendCommand(command) {
        commands.push(command)
        if (command.type === "session.prompt") {
          throw new Error("prompt failed")
        }
      },
      async snapshot() {
        return {
          cursor: "0",
          state: createRuntimeState({
            connection: { status: "connected", lastError: "Submit failed" },
          }),
        }
      },
      subscribe: () => () => {},
    })

    const host = mount(() => <ChatRelayBody {...baseProps()} />)
    await wait(10)
    const textarea = host.host.querySelector("textarea") as HTMLTextAreaElement
    textarea.value = "extra text"
    textarea.dispatchEvent(new Event("input", { bubbles: true }))

    const submit = host.host.querySelector("form button") as HTMLButtonElement
    submit.click()
    await wait(20)

    expect(host.host.querySelector(".canvas-relay-message-text")?.textContent).toBe("Hello")
    expect(commands).toEqual([
      {
        type: "session.prompt",
        text: "extra text",
        delivery: "queue",
      },
    ])
    host.dispose()
  })

  test("renders disconnected banner from runtime updates", async () => {
    setRuntimeContext(
      RuntimeModule.createMockChatRelayContext({
      initialState: createRuntimeState({ connection: { status: "disconnected" } }),
      }),
    )

    const host = mount(() => <ChatRelayBody {...baseProps()} />)
    await wait(30)
    expect(host.host.querySelector(".canvas-relay-banner")?.textContent).toBe("Disconnected from relay")
    host.dispose()
  })
})
