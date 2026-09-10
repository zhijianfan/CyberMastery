import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createComponent, type JSX, type ParentProps } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import { dict } from "@/i18n/en"
import { chatRelayError } from "@/pages/canvas/blocks/chat-relay/types"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length) next.children = children.length === 1 ? children[0] : children
  return () => createComponent(tag as never, next)
}

// Bun's classic JSX transform needs Solid's component creation at this boundary.
Object.assign(globalThis, { React: { createElement }, Fragment_8vg9x3sq: (props: ParentProps) => props.children })

const passthrough = (props: ParentProps) => props.children
const button = (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => h("button", props)
const disposers: VoidFunction[] = []
const requests: string[] = []
const catalog = new Map([["openai", { id: "openai", name: "OpenAI", models: {} }]])
let providerStatus: "disconnected" | "opening" | "login-required" | "ready" | "error" = "disconnected"
let protocol: "v1" | "v2" = "v1"
let statusError: unknown
let component: typeof import("./providers")

mock.module("@solidjs/router", () => ({ useParams: () => ({}) }))
mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (key: keyof typeof dict) => dict[key] ?? key }) }))
mock.module("@/context/settings", () => ({ useSettings: () => ({ general: { newLayoutDesigns: () => true } }) }))
mock.module("@/utils/toast", () => ({ showToast: () => {} }))
mock.module("@/hooks/use-providers", () => ({
  popularProviders: ["openai"],
  useProviders: () => ({
    all: () => catalog,
    connected: () => [...catalog.values()],
    popular: () => [],
    refresh: async () => {},
  }),
}))
mock.module("@/context/server-sync", () => ({
  useServerSync: () => () => ({
    data: { provider: { all: catalog, connection: new Map() }, config: {} },
  }),
}))
mock.module("@/context/server-sdk", () => ({
  useServerProtocol: () => () => protocol,
  useServerSDK: () => {
    const sdk = {
      client: {
        v2: {
          chatProxy: {
            status: async () => {
              requests.push("status")
              if (statusError !== undefined) throw statusError
              return { data: { id: "chatgpt", name: "ChatGPT", status: providerStatus } }
            },
            connect: async () => {
              requests.push("connect")
              providerStatus = "login-required"
              return { data: { id: "chatgpt", name: "ChatGPT", status: providerStatus } }
            },
            open: async () => {
              requests.push("open")
              return { data: { id: "chatgpt", name: "ChatGPT", status: providerStatus } }
            },
          },
        },
      },
    }
    return () => sdk
  },
}))
mock.module("@opencode-ai/ui/context/dialog", () => ({
  useDialog: () => ({
    close: () => {},
    show: (content: () => JSX.Element) => {
      const host = document.createElement("div")
      host.dataset.testDialog = ""
      document.body.append(host)
      disposers.push(render(content, host))
      return Promise.resolve()
    },
  }),
}))
mock.module("@opencode-ai/ui/v2/button-v2", () => ({ ButtonV2: button }))
mock.module("@opencode-ai/ui/v2/badge-v2", () => ({ Tag: passthrough }))
mock.module("@opencode-ai/ui/v2/dialog-v2", () => ({
  DialogV2: passthrough,
  DialogBody: passthrough,
  DialogHeader: passthrough,
  DialogTitle: passthrough,
}))
mock.module("@opencode-ai/ui/dialog", () => ({ Dialog: passthrough }))
mock.module("@opencode-ai/ui/provider-icon", () => ({ ProviderIcon: () => null }))
mock.module("@opencode-ai/ui/icon", () => ({ Icon: () => null }))
mock.module("@opencode-ai/ui/spinner", () => ({ Spinner: () => null }))
mock.module("@opencode-ai/ui/text-field", () => ({
  TextField: (props: { value?: string }) => h("input", { value: props.value }),
}))
mock.module("@/components/external-link", () => ({
  ExternalLink: (props: JSX.AnchorHTMLAttributes<HTMLAnchorElement>) => h("a", props),
}))
mock.module("../dialog-custom-provider", () => ({ DialogCustomProvider: () => null, CustomProviderForm: () => null }))

beforeAll(async () => {
  component = await import("./providers")
})

beforeEach(() => {
  requests.length = 0
  catalog.set("openai", { id: "openai", name: "OpenAI", models: {} })
  providerStatus = "disconnected"
  protocol = "v1"
  statusError = undefined
})

afterEach(() => {
  disposers
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose())
  document.body.innerHTML = ""
})

function mount() {
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(render(() => createComponent(component.SettingsProvidersV2, { directory: () => undefined }), host))
  return host
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("ChatRelay website sign-in settings", () => {
  test("connects the managed ChatGPT browser without using OpenAI provider OAuth", async () => {
    const host = mount()
    await settle()
    const action = host.querySelector<HTMLButtonElement>('[data-action="settings-chat-relay-connect"]')
    expect(action).not.toBeNull()
    action!.click()
    await settle()

    expect(requests).toEqual(["status", "connect"])
    expect(host.textContent).toContain("OpenCode does not send these messages through Codex or the OpenAI API")
  })

  test("keeps ChatRelay website login independent from the OpenAI model provider", async () => {
    catalog.clear()
    const host = mount()
    await settle()
    const action = host.querySelector<HTMLButtonElement>('[data-action="settings-chat-relay-connect"]')!
    expect(action.disabled).toBe(false)
    action.click()
    await settle()

    expect(requests).toEqual(["status", "connect"])
  })

  test("stops automatic status retries after an unavailable endpoint fails", async () => {
    statusError = { name: "ChatProxyRequestError", data: { message: "Close the login browser first" } }
    mount()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(requests).toEqual(["status"])
    expect(chatRelayError(statusError)).toBe("Close the login browser first")
  })

  test("continues polling while an unchanged sign-in status needs attention", async () => {
    providerStatus = "login-required"
    mount()
    await new Promise((resolve) => setTimeout(resolve, 3250))

    expect(requests.filter((request) => request === "status").length).toBeGreaterThanOrEqual(4)
  })
})
