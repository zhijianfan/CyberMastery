import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test"
import { createComponent, type JSX } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"

let SettingsChatProxyV2: typeof import("./chat-proxy").SettingsChatProxyV2
let ChatProxyRelaySurface: typeof import("../../pages/canvas/blocks/chat-relay/proxy-surface").ChatProxyRelaySurface
const requests: string[] = []
const disposers: Array<() => void> = []
const originalFetch = globalThis.fetch

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

const Fragment = (props: { children?: unknown }) => props.children
;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

beforeAll(async () => {
  mock.module("@/context/server-sdk", () => ({
    useServerSDK: () => () => ({ url: "http://127.0.0.1:3154" }),
  }))
  SettingsChatProxyV2 = (await import("./chat-proxy")).SettingsChatProxyV2
  ChatProxyRelaySurface = (await import("../../pages/canvas/blocks/chat-relay/proxy-surface")).ChatProxyRelaySurface
})

beforeEach(() => {
  requests.length = 0
  globalThis.fetch = (async (input) => {
    const url = String(input)
    requests.push(url)
    const payload = url.includes("/relay/")
      ? { providerID: "chatgpt", relayID: "ws-1:block-1", status: "disconnected", messages: [] }
      : [{ id: "chatgpt", name: "ChatGPT", status: "disconnected" }]
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } })
  }) as typeof fetch
})

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
  document.body.innerHTML = ""
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

function mount(ui: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(ui, host)
  disposers.push(() => {
    dispose()
    host.remove()
  })
}

test("Chat Proxy settings request the active server instead of the Vite origin", async () => {
  mount(() => <SettingsChatProxyV2 />)
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(requests[0]).toBe("http://127.0.0.1:3154/api/chat-proxy")
})

test("Chat Relay polling requests the active server instead of the Vite origin", async () => {
  const queueMicrotask = globalThis.queueMicrotask
  globalThis.queueMicrotask = () => {}
  try {
    mount(() => <ChatProxyRelaySurface relayID="ws-1:block-1" />)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(requests[0]).toBe("http://127.0.0.1:3154/api/chat-proxy/chatgpt/relay/ws-1%3Ablock-1")
  } finally {
    globalThis.queueMicrotask = queueMicrotask
  }
})
