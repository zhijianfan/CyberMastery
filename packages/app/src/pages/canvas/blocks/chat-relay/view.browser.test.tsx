import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import type { PermissionConfig } from "@opencode-ai/sdk/v2/client"
import { createComponent, type Component } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import type { RuntimeBlockHandle, RuntimeStatus } from "../../runtime/contracts"
import type { ChatRelayView } from "./runtime"
import type { ChatRelayBodyProps } from "./types"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

const Fragment = (props: { children?: unknown }) => props.children
;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

let runtimeHandle: RuntimeBlockHandle
let ChatRelayBody: Component<ChatRelayBodyProps>

beforeAll(async () => {
  mock.module("../../runtime/block-runtime-host", () => ({
    useBlockRuntimeHandle: () => runtimeHandle,
  }))
  mock.module("../../session-surface-providers", () => ({
    CanvasSessionSurfaceProviders: (props: { directory: string; sessionID: string; children?: unknown }) =>
      h(
        "div",
        {
          "data-testid": "chat-relay-session-providers",
          "data-directory": props.directory,
          "data-session-id": props.sessionID,
        },
        props.children,
      ),
  }))
  mock.module("../../session-surface", () => ({
    CanvasSessionSurface: (props: {
      target: { sessionID: string; directory?: string; workspaceID?: string }
      surfaceID: string
      focused: boolean
      queueEnabled: boolean
    }) =>
      h("div", {
        "data-testid": "chat-relay-session",
        "data-session-id": props.target.sessionID,
        "data-directory": props.target.directory,
        "data-workspace-id": props.target.workspaceID,
        "data-surface-id": props.surfaceID,
        "data-focused": props.focused,
        "data-queue-enabled": props.queueEnabled,
      }),
  }))
  ChatRelayBody = (await import("./view")).ChatRelayBody
})

afterEach(() => {
  document.body.innerHTML = ""
})

function handle(status: RuntimeStatus, view?: ChatRelayView): RuntimeBlockHandle {
  return {
    status: () => status,
    view: () => view,
    error: () => undefined,
    refresh: async () => {},
    dispatch: async () => {},
    dispose: () => {},
  }
}

function props(permissions: PermissionConfig = { webfetch: "ask", websearch: "ask" }) {
  return {
    block: { id: "block-1" },
    permissions,
    workspaceID: "ws-1",
    focused: true,
    onFocus: () => {},
  } satisfies ChatRelayBodyProps
}

function mount(input: ChatRelayBodyProps) {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => h(ChatRelayBody as never, input as never) as never, host)
  return { host, dispose }
}

describe("ChatRelayBody", () => {
  test("renders permission denial from project policy or host access", () => {
    runtimeHandle = handle("ready", {
      workspaceID: "ws-1",
      sessionID: "session-1",
      directory: "/workspace",
      queueEnabled: true,
    })
    const policy = mount(props({ webfetch: "deny", websearch: "ask" }))
    expect(policy.host.querySelector(".canvas-relay-state-title")?.textContent).toBe("Permission denied")
    policy.dispose()

    runtimeHandle = handle("permission-denied")
    const access = mount(props())
    expect(access.host.querySelector(".canvas-relay-state-title")?.textContent).toBe("Permission denied")
    access.dispose()
  })

  test("renders explicit resolving, unavailable, and error states", () => {
    for (const [status, title] of [
      ["resolving", "Preparing chat relay"],
      ["unavailable", "Block needs a chat relay binding"],
      ["error", "Relay unavailable"],
    ] as const) {
      runtimeHandle = handle(status)
      const mounted = mount(props())
      expect(mounted.host.querySelector(".canvas-relay-state-title")?.textContent).toBe(title)
      mounted.dispose()
    }
  })

  test("mounts the bound session through the canonical surface", () => {
    runtimeHandle = handle("ready", {
      workspaceID: "ws-1",
      sessionID: "session-1",
      directory: "/workspace",
      queueEnabled: true,
    })
    const mounted = mount(props())
    const providers = mounted.host.querySelector('[data-testid="chat-relay-session-providers"]')
    const surface = mounted.host.querySelector('[data-testid="chat-relay-session"]')
    expect(providers?.getAttribute("data-directory")).toBe("/workspace")
    expect(providers?.getAttribute("data-session-id")).toBe("session-1")
    expect(surface?.getAttribute("data-session-id")).toBe("session-1")
    expect(surface?.getAttribute("data-directory")).toBe("/workspace")
    expect(surface?.getAttribute("data-workspace-id")).toBe("ws-1")
    expect(surface?.getAttribute("data-surface-id")).toBe("chat-relay-block-1")
    expect(surface?.getAttribute("data-focused")).toBe("true")
    expect(surface?.getAttribute("data-queue-enabled")).toBe("true")
    mounted.dispose()
  })

  test("preserves the canonical session surface while refresh is stale or transiently failing", () => {
    const view = {
      workspaceID: "ws-1",
      sessionID: "session-1",
      directory: "/workspace",
      queueEnabled: true as const,
    }
    for (const status of ["stale", "error"] as const) {
      runtimeHandle = handle(status, view)
      const mounted = mount(props())
      expect(mounted.host.querySelector('[data-testid="chat-relay-session"]')?.getAttribute("data-session-id")).toBe(
        "session-1",
      )
      mounted.dispose()
    }
  })
})
