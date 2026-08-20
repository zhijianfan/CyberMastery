import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createComponent, type Component } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import type { PermissionConfig } from "@opencode-ai/sdk/v2/client"
import type { BlockRuntimeServices } from "../../runtime/contracts"
import { BlockRuntimeHost } from "../../runtime/block-runtime-host"
import type { ServerSDK } from "@/context/server-sdk"
import { ChatRelayRuntimeAdapter } from "./runtime"
import type { ChatRelayBodyProps, RuntimeResourceState, RuntimeSnapshot } from "./types"

const RELAY_SESSION_ID = "relay-session-1"

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

interface FakeCall {
  method: string
  args: unknown
}

function createFakeSdk(snapshot: RuntimeSnapshot<RuntimeResourceState>) {
  const calls: FakeCall[] = []
  const client = {
    v2: {
      workspace: {
        chatRelay: {
          ensure: async () => {
            return { data: { sessionID: RELAY_SESSION_ID } }
          },
        },
      },
      blockRuntime: {
        snapshot: async () => {
          return { data: { cursor: snapshot.cursor, state: snapshot.state } }
        },
      },
      session: {
        prompt: async (args: unknown) => {
          calls.push({ method: "session.prompt", args })
        },
        abort: async () => {},
        create: async () => {},
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

function createSeedState(overrides: Partial<RuntimeResourceState> = {}): RuntimeResourceState {
  return {
    connection: { status: "connected" },
    authByProvider: {
      opencode: {
        providerID: "opencode",
        status: "ready",
      },
    },
    sessionsByID: {
      [RELAY_SESSION_ID]: { id: RELAY_SESSION_ID, status: "idle" },
    },
    messagesByID: {
      m1: {
        id: "m1",
        sessionID: RELAY_SESSION_ID,
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

beforeAll(async () => {
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
  ;(globalThis as unknown as { __CYBERMASTER_BLOCK_RUNTIME_V2__?: boolean }).__CYBERMASTER_BLOCK_RUNTIME_V2__ = true
})

afterEach(() => {
  document.body.innerHTML = ""
  ;(globalThis as unknown as { __CYBERMASTER_BLOCK_RUNTIME_V2__?: boolean }).__CYBERMASTER_BLOCK_RUNTIME_V2__ = false
})

function baseProps(permissions: PermissionConfig = { webfetch: "ask", websearch: "ask" }): ChatRelayBodyProps {
  return {
    block: { id: "block-1" },
    permissions,
    workspaceID: "ws-1",
    focused: true,
    onFocus: () => {},
  }
}

function mountRelay(
  props: ChatRelayBodyProps,
  snapshot: RuntimeSnapshot<RuntimeResourceState>,
) {
  const { sdk, calls } = createFakeSdk(snapshot)
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () =>
      (h(BlockRuntimeHost as never, {
        blockID: props.block.id,
        functionalityID: "builtin:chat-relay",
        registration: ChatRelayRuntimeAdapter,
        services: makeServices(sdk),
        workspaceID: props.workspaceID,
        children: h(ChatRelayBody as never, props),
      }) as never),
    host,
  )
  return {
    host,
    calls,
    dispose: () => {
      dispose()
      host.remove()
    },
  }
}

// HARNESS-ARTIFACT (classified by master, Gate 2): bun test compiles the host
// TSX with the solid jsx transform (tsconfig jsxImportSource) while this test
// file uses the React.createElement shim; the host provider chain never bridges
// into the shim-rendered child (verified: the shim observed only ONE tag,
// RuntimeChatRelayBody). The same host/provider chain renders correctly in the
// real app (canvas mounts exercise it). Adapter behavior is fully covered by
// runtime.test.ts (7/7). Re-enable with a solid-native mount helper in Task N.
describe("ChatRelayBody runtime-v2 via BlockRuntimeHost", () => {
  test.skip("renders denied block when permissions block network actions", async () => {
    const mounted = mountRelay(baseProps({ webfetch: "deny", websearch: "ask" }), {
      cursor: "1",
      state: createSeedState(),
    })
    await wait(20)
    expect(mounted.host.querySelector(".canvas-relay-state-title")?.textContent).toBe("Permission denied")
    mounted.dispose()
  })

  test.skip("renders messages from the seeded snapshot inside BlockRuntimeHost", async () => {
    const mounted = mountRelay(baseProps(), { cursor: "1", state: createSeedState() })
    await wait(20)
    expect(mounted.host.querySelector(".canvas-relay-message-text")?.textContent).toBe("Hello")
    mounted.dispose()
  })

  test.skip("renders sign-in state and dispatches auth.start", async () => {
    const mounted = mountRelay(baseProps(), {
      cursor: "1",
      state: createSeedState({
        authByProvider: {
          opencode: {
            providerID: "opencode",
            status: "awaiting-login",
            loginURL: "https://example/login",
            userCode: "ABC-123",
          },
        },
      }),
    })
    await wait(20)
    expect(mounted.host.querySelector(".canvas-relay-state-title")?.textContent).toBe("Waiting for sign-in")

    const button = mounted.host.querySelector("button") as HTMLButtonElement
    button.click()
    await flush()
    expect(mounted.calls.find((call) => call.method === "auth.start")?.args).toEqual({
      providerID: "opencode",
    })
    mounted.dispose()
  })

  test.skip("dispatches session.prompt on submit", async () => {
    const mounted = mountRelay(baseProps(), { cursor: "1", state: createSeedState() })
    await wait(20)

    const textarea = mounted.host.querySelector("textarea") as HTMLTextAreaElement
    textarea.value = "extra text"
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
    await flush()

    const submit = mounted.host.querySelector("form button") as HTMLButtonElement
    submit.click()
    await wait(10)

    expect(mounted.calls.find((call) => call.method === "session.prompt")?.args).toEqual({
      sessionID: RELAY_SESSION_ID,
      prompt: { text: "extra text" },
      delivery: "queue",
      resume: true,
    })
    mounted.dispose()
  })

  test.skip("shows permission prompts and dispatches permission.respond", async () => {
    const mounted = mountRelay(baseProps(), {
      cursor: "1",
      state: createSeedState({
        permissionsByID: {
          p1: {
            id: "p1",
            requestID: "req-1",
            sessionID: RELAY_SESSION_ID,
            status: "pending",
          },
        },
      }),
    })
    await wait(20)
    const panel = mounted.host.querySelector("[data-testid=\"chat-relay-permissions\"]")
    expect(panel).not.toBeNull()

    const allow = mounted.host.querySelector("button") as HTMLButtonElement
    expect(allow?.textContent).toBe("Allow once")
    allow.click()
    await wait(10)

    expect(mounted.calls.find((call) => call.method === "permission.respond")?.args).toEqual({
      requestID: "req-1",
      response: "once",
    })
    mounted.dispose()
  })

  test.skip("renders disconnected banner from the seeded snapshot", async () => {
    const mounted = mountRelay(baseProps(), {
      cursor: "1",
      state: createSeedState({ connection: { status: "disconnected" } }),
    })
    await wait(20)
    expect(mounted.host.querySelector(".canvas-relay-banner")?.textContent).toBe("Disconnected from relay")
    mounted.dispose()
  })
})