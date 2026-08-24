import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import { createComponent } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import type { BlockRuntimeServices } from "./runtime/contracts"
import { BlockRuntimeHandleContext, BlockRuntimeHost } from "./runtime/block-runtime-host"
import { operatingChatRuntimeRegistration } from "./runtime/registrations/operating-chat"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) {
    const value = children.length > 1 ? children : children[0]
    next.children = typeof value === "function" ? value : () => value
  }
  return createComponent(tag as never, next)
}

;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment: "Fragment" }

mock.module("@/context/language", () => ({
  useLanguage: () => ({
    t: (key: string) =>
      ({
        "canvas.operatingAgent.label": "OperatingAgent",
        "canvas.operatingAgent.retry": "Retry",
        "canvas.operatingAgent.starting": "Starting",
        "canvas.operatingAgent.unavailable": "Unavailable",
        "canvas.operatingAgent.unconfigured": "Unconfigured",
      })[key] ?? key,
  }),
}))

mock.module("./session-surface-providers", () => ({
  CanvasSessionSurfaceProviders: (props: { children?: unknown }) => props.children,
}))

mock.module("./session-surface", () => ({
  CanvasSessionSurface: (props: { target: { sessionID: string } }) =>
    h("div", { "data-testid": "operating-session", "data-session-id": props.target.sessionID }),
}))

let OperatingChatBody: (props: Record<string, unknown>) => unknown

beforeAll(async () => {
  const workspace = await import("./workspace")
  OperatingChatBody = workspace.OperatingChatBody as typeof OperatingChatBody
})

afterEach(() => {
  document.body.innerHTML = ""
})

const binding = {
  workspaceID: "wrk_test",
  blockID: "block-1",
  sessionID: "ses_original",
  directory: "D:/workspace",
  revision: 1,
}

function services(reset: (signal: AbortSignal) => Promise<void>): BlockRuntimeServices {
  let ensures = 0
  return {
    serverSDK: () =>
      ({
        client: {
          v2: {
            workspace: {
              operatingChat: {
                ensure: async () => ({
                  data: {
                    ...binding,
                    sessionID: ensures++ === 0 ? "ses_original" : "ses_replacement",
                  },
                }),
                reset: async (_input: unknown, options: { signal: AbortSignal }) => reset(options.signal),
              },
            },
          },
        },
      }) as never,
    eventRouter: {
      on: () => () => {},
      off: () => {},
      onReconnect: () => () => {},
    },
    workspace: {
      id: () => binding.workspaceID,
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

function mount(reset: (signal: AbortSignal) => Promise<void>) {
  const host = document.createElement("div")
  document.body.append(host)
  let observed: unknown
  const App = () =>
    h(BlockRuntimeHost as never, {
      blockID: binding.blockID,
      functionalityID: "builtin:operating-chat-session",
      registration: operatingChatRuntimeRegistration,
      services: services(reset),
      workspaceID: binding.workspaceID,
      onHandle: (next: unknown) => {
        observed = next
      },
    })
  render(() => h(App as never, {}) as never, host)
  return { host, handle: () => observed }
}

function mountBody(host: HTMLElement, active: unknown) {
  render(
    () =>
      createComponent(BlockRuntimeHandleContext.Provider as never, {
        value: active,
        children: () =>
          createComponent(OperatingChatBody as never, {
            block: { id: binding.blockID },
            agentKey: "agent",
            agentVersion: 0,
            models: () => [],
            focused: true,
            onFocus: () => {},
            onRefresh: async () => {},
            onSelectAgent: async () => {},
          }),
      }) as never,
    host,
  )
}

function waitFor(check: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    const started = Date.now()
    const poll = () => {
      if (check()) return resolve()
      if (Date.now() - started > 2000) return reject(new Error("timed out waiting for browser state"))
      setTimeout(poll, 5)
    }
    poll()
  })
}

describe("OperatingChat reset", () => {
  test("renders the replacement session after reset succeeds", async () => {
    const mounted = mount(async () => {})
    await waitFor(() => mounted.handle() !== undefined)
    await new Promise((resolve) => setTimeout(resolve, 25))
    mountBody(mounted.host, mounted.handle())
    await waitFor(() => mounted.host.querySelector('[data-testid="operating-session"]') !== null)

    mounted.host.querySelector<HTMLButtonElement>('[aria-label="Reset OperatingChat session"]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 25))
    mountBody(mounted.host, mounted.handle())
    await waitFor(() => mounted.host.querySelector('[data-session-id="ses_replacement"]') !== null)

    expect(mounted.host.querySelector('[data-session-id="ses_replacement"]')).not.toBeNull()
  })

  test("keeps the original session and shows the reset error", async () => {
    const mounted = mount(async () => {
      throw new Error("409: binding revision is stale; refresh and try again")
    })
    await waitFor(() => mounted.handle() !== undefined)
    await new Promise((resolve) => setTimeout(resolve, 25))
    mountBody(mounted.host, mounted.handle())
    await waitFor(() => mounted.host.querySelector('[data-testid="operating-session"]') !== null)

    mounted.host.querySelector<HTMLButtonElement>('[aria-label="Reset OperatingChat session"]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(mounted.host.querySelector('[data-session-id="ses_original"]')).not.toBeNull()
  })
})
