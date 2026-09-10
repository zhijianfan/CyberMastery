import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import type { PermissionConfig } from "@opencode-ai/sdk/v2/client"
import { createComponent, type Component } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import type { RuntimeBlockHandle, RuntimeStatus } from "../../runtime/contracts"
import type { ChatRelayCommand, ChatRelayView } from "./runtime"
import type { ChatRelayBodyProps } from "./types"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

const Fragment = (props: { children?: unknown }) => props.children
;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

const commands: ChatRelayCommand[] = []
const captures: Record<string, unknown>[] = []
const creates: Record<string, unknown>[] = []
const draftAdds: unknown[] = []
let draftOpens = 0
let createPending: Promise<void> | undefined
let dispatchCommand: (command: ChatRelayCommand) => Promise<void>
let runtimeHandle: RuntimeBlockHandle
let ChatRelayBody: Component<ChatRelayBodyProps>

const captured = {
  clientFragmentID: "fragment-relay-1",
  text: "Hi there",
  source: {
    workspaceID: "workspace-1",
    blockID: "block-1",
    functionalityID: "builtin:chat-relay",
    kind: "block-text",
    direction: "received",
    sourceTimestamp: 2,
    capturedAt: 3,
    entityRef: { type: "message", id: "assistant-1" },
    label: null,
    metadata: { tabID: "tab-1" },
    sensitivity: "workspace",
  },
}

beforeAll(async () => {
  mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
  mock.module("@/context/server-sdk", () => ({ useServerSDK: () => () => ({ scope: "local" }) }))
  mock.module("@opencode-ai/ui/context/dialog", () => ({ useDialog: () => ({ show: () => {} }) }))
  mock.module("@/context/ctxpack/draft", () => ({
    useCtxPackDraft: () => ({
      workspaceID: () => "workspace-1",
      add: (fragment: unknown) => draftAdds.push(fragment),
      openCreate: () => {
        draftOpens += 1
      },
    }),
  }))
  mock.module("@/context/ctxpack/selection", () => ({
    captureCtxPackResponse: (input: Record<string, unknown>) => {
      captures.push(input)
      return captured
    },
  }))
  mock.module("@/context/ctxpack/sdk-facade", () => ({
    attachmentStoreMaterializeFacade: () => async () => {
      throw new Error("Unexpected materialization")
    },
    createCtxPackSdkFacade: () => ({
      create: async (input: Record<string, unknown>) => {
        creates.push(input)
        await createPending
      },
    }),
  }))
  mock.module("@/context/ctxpack/keyword-suggest", () => ({
    suggestCtxPackKeywords: () => ["relay", "x".repeat(49)],
  }))
  mock.module("@/pages/session/timeline/response-save-actions", () => ({
    ResponseSaveActions: (input: { onSave(options: { details: boolean }): Promise<void> | void }) =>
      h(
        "div",
        {},
        h("button", { "data-action": "save-response-ctxpack", onClick: () => input.onSave({ details: false }) }),
        h("button", { "data-action": "save-response-options", onClick: () => input.onSave({ details: true }) }),
      ),
  }))
  mock.module("@/utils/toast", () => ({ showToast: () => {} }))
  mock.module("@/utils/uuid", () => ({ uuid: () => "message-1" }))
  mock.module("../../runtime/block-runtime-host", () => ({ useBlockRuntimeHandle: () => runtimeHandle }))
  ChatRelayBody = (await import("./view")).ChatRelayBody
})

afterEach(() => {
  document.body.innerHTML = ""
  commands.length = 0
  captures.length = 0
  creates.length = 0
  draftAdds.length = 0
  draftOpens = 0
  createPending = undefined
  dispatchCommand = async (command) => {
    commands.push(command)
  }
})

const view = (status: ChatRelayView["relay"]["status"] = "idle", draft = ""): ChatRelayView => ({
  draft,
  relay: {
    providerID: "chatgpt",
    workspaceID: "workspace-1",
    blockID: "block-1",
    tabID: "tab-1",
    status,
    messages: [
      { id: "user-1", role: "user", text: "Hello", createdAt: 1 },
      { id: "assistant-1", role: "assistant", text: "Hi there", createdAt: 2 },
    ],
  },
})

const viewWithControls = (status: ChatRelayView["relay"]["status"] = "idle") => {
  const current = view(status)
  Object.assign(current.relay, {
    controls: {
      model: {
        value: "gpt-5",
        label: "GPT-5",
        options: [
          { id: "gpt-5", label: "GPT-5" },
          { id: "gpt-4o", label: "GPT-4o" },
        ],
      },
      effort: {
        value: "auto",
        label: "Auto",
        options: [
          { id: "auto", label: "Auto" },
          { id: "high", label: "High", disabled: true },
        ],
      },
    } satisfies NonNullable<ChatRelayView["relay"]["controls"]>,
  })
  return current
}

function handle(status: RuntimeStatus, value?: ChatRelayView): RuntimeBlockHandle {
  return {
    status: () => status,
    view: () => value,
    error: () => undefined,
    refresh: async () => {},
    dispatch: (command: unknown) => dispatchCommand(command as ChatRelayCommand),
    dispose: () => {},
  }
}

function props(permissions: PermissionConfig = { webfetch: "ask", websearch: "ask" }) {
  return {
    block: { id: "block-1" },
    permissions,
    focused: true,
    onFocus: () => {},
  } satisfies ChatRelayBodyProps
}

function mount(input: ChatRelayBodyProps) {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => createComponent(ChatRelayBody, input), host)
  return { host, dispose }
}

function mountWithParent(input: ChatRelayBodyProps, onPointerDown: () => void) {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () => h("div", { onPointerDown }, createComponent(ChatRelayBody, input)) as unknown as HTMLElement,
    host,
  )
  return { host, dispose }
}

describe("ChatRelayBody", () => {
  test("renders the owned ChatGPT transcript and keeps non-primary pointers available for panning", () => {
    runtimeHandle = handle("ready", view("idle", "saved draft"))
    const focus = mock(() => {})
    const mounted = mount({ ...props(), onFocus: focus })

    expect(mounted.host.textContent).toContain("Hello")
    expect(mounted.host.textContent).toContain("Hi there")
    expect(mounted.host.querySelector<HTMLTextAreaElement>('[data-input="chat-relay-message"]')?.value).toBe(
      "saved draft",
    )
    const layout = mounted.host.querySelector<HTMLElement>(".canvas-relay-layout")!
    layout.dispatchEvent(new PointerEvent("pointerdown", { button: 2, bubbles: true }))
    expect(focus).not.toHaveBeenCalled()
    layout.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }))
    expect(focus).toHaveBeenCalledTimes(1)
    mounted.dispose()
  })

  test("renders only webpage-derived model controls and dispatches owned option changes", async () => {
    runtimeHandle = handle("ready", viewWithControls())
    const mounted = mount(props())
    const model = mounted.host.querySelector<HTMLSelectElement>('select[aria-label="canvas.chat.relay.model"]')!
    const effort = mounted.host.querySelector<HTMLSelectElement>('select[aria-label="canvas.chat.relay.effort"]')!

    expect(Array.from(model.options).map((option) => [option.value, option.text])).toEqual([
      ["gpt-5", "GPT-5"],
      ["gpt-4o", "GPT-4o"],
    ])
    expect(model.value).toBe("gpt-5")
    expect(Array.from(effort.options).map((option) => [option.value, option.text, option.disabled])).toEqual([
      ["auto", "Auto", false],
      ["high", "High", true],
    ])
    expect(effort.value).toBe("auto")

    model.value = "gpt-4o"
    model.dispatchEvent(new Event("change", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    effort.options[1].disabled = false
    effort.value = "high"
    effort.dispatchEvent(new Event("change", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(commands).toEqual([
      { type: "configure", model: "gpt-4o" },
      { type: "configure", effort: "high" },
    ])
    mounted.dispose()
  })

  test("does not invent unavailable controls and disables page choices and refresh while ChatGPT is thinking", () => {
    const current = viewWithControls("thinking")
    Object.assign(current.relay, { controls: { effort: current.relay.controls?.effort } })
    runtimeHandle = handle("ready", current)
    const mounted = mount(props())

    expect(mounted.host.querySelector('select[aria-label="canvas.chat.relay.model"]')).toBeNull()
    expect(
      mounted.host.querySelector<HTMLSelectElement>('select[aria-label="canvas.chat.relay.effort"]')?.disabled,
    ).toBe(true)
    expect(
      Array.from(mounted.host.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent === "canvas.chat.relay.refreshOptions",
      )?.disabled,
    ).toBe(true)
    mounted.dispose()
  })

  test("restores the confirmed page choice and preserves the conversation after rejected configuration", async () => {
    dispatchCommand = async (command) => {
      commands.push(command)
      if (command.type === "configure") throw new Error("The webpage rejected this choice")
    }
    runtimeHandle = handle("ready", viewWithControls("idle"))
    const mounted = mount(props())
    const model = mounted.host.querySelector<HTMLSelectElement>('select[aria-label="canvas.chat.relay.model"]')!

    model.value = "gpt-4o"
    model.dispatchEvent(new Event("change", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(commands).toEqual([{ type: "configure", model: "gpt-4o" }])
    expect(model.value).toBe("gpt-5")
    expect(mounted.host.querySelector(".canvas-relay-delivery-error")).toBeNull()
    expect(mounted.host.querySelector('[data-component="chat-relay-transcript"]')?.textContent).toContain("Hi there")
    expect(mounted.host.querySelector<HTMLTextAreaElement>('[data-input="chat-relay-message"]')?.value).toBe("")
    mounted.dispose()
  })

  test("waits for a manual refresh before discovering webpage options", async () => {
    const current = view()
    Object.assign(current.relay, { controls: {} })
    runtimeHandle = handle("ready", current)
    const mounted = mount(props())

    expect(mounted.host.querySelector('select[aria-label="canvas.chat.relay.model"]')).toBeNull()
    expect(mounted.host.querySelector('select[aria-label="canvas.chat.relay.effort"]')).toBeNull()
    expect(mounted.host.textContent).toContain("canvas.chat.relay.optionsPending")
    expect(commands).toEqual([])
    const refresh = Array.from(mounted.host.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "canvas.chat.relay.refreshOptions",
    )!
    expect(refresh.disabled).toBe(false)
    refresh.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(commands).toEqual([{ type: "refresh-options" }])
    mounted.dispose()
  })

  test("offers CtxPack actions only for completed assistant responses and preserves relay identity", async () => {
    runtimeHandle = handle("ready", view())
    const mounted = mount(props())
    const user = mounted.host.querySelector('[data-message-id="user-1"]')!
    const assistant = mounted.host.querySelector('[data-message-id="assistant-1"]')!

    expect(user.querySelector('[data-action="save-response-ctxpack"]')).toBeNull()
    expect(assistant.querySelector('[data-action="save-response-ctxpack"]')).not.toBeNull()
    expect(assistant.querySelector('[data-action="save-response-options"]')).not.toBeNull()

    assistant.querySelector<HTMLButtonElement>('[data-action="save-response-ctxpack"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(captures).toHaveLength(1)
    expect(captures[0]).toMatchObject({
      text: "Hi there",
      messageID: "assistant-1",
      timestamp: 2,
      tabID: "tab-1",
    })
    expect(captures[0].element).toBeInstanceOf(Element)
    expect(captures[0].now).toBeNumber()
    expect(creates).toEqual([
      {
        workspaceID: "workspace-1",
        title: "Hi there",
        keywords: ["relay"],
        sensitivity: "workspace",
        fragments: [captured],
        idempotencyKey: expect.any(String),
      },
    ])
    expect(draftAdds).toEqual([])
    expect(draftOpens).toBe(0)

    assistant.querySelector<HTMLButtonElement>('[data-action="save-response-options"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(captures).toHaveLength(2)
    expect(creates).toHaveLength(1)
    expect(draftAdds).toEqual([captured])
    expect(draftOpens).toBe(1)
    mounted.dispose()
  })

  test("hides save actions for an active trailing response while retaining earlier assistant actions", () => {
    const current = view("thinking")
    current.relay.messages = [
      { id: "assistant-complete", role: "assistant", text: "Earlier response", createdAt: 1 },
      { id: "assistant-active", role: "assistant", text: "Still replying", createdAt: 2 },
    ]
    runtimeHandle = handle("ready", current)
    const mounted = mount(props())

    expect(
      mounted.host.querySelector('[data-message-id="assistant-complete"] [data-action="save-response-ctxpack"]'),
    ).not.toBeNull()
    expect(
      mounted.host.querySelector('[data-message-id="assistant-active"] [data-action="save-response-ctxpack"]'),
    ).toBeNull()
    mounted.dispose()

    const empty = view()
    empty.relay.messages = [{ id: "assistant-empty", role: "assistant", text: "  ", createdAt: 3 }]
    runtimeHandle = handle("ready", empty)
    const emptyMounted = mount(props())
    expect(
      emptyMounted.host.querySelector('[data-message-id="assistant-empty"] [data-action="save-response-ctxpack"]'),
    ).toBeNull()
    emptyMounted.dispose()
  })

  test("coalesces duplicate quick saves while the first save is pending", async () => {
    const pending = Promise.withResolvers<void>()
    createPending = pending.promise
    runtimeHandle = handle("ready", view())
    const mounted = mount(props())
    const save = mounted.host.querySelector<HTMLButtonElement>(
      '[data-message-id="assistant-1"] [data-action="save-response-ctxpack"]',
    )!

    save.click()
    save.click()
    await Promise.resolve()
    expect(creates).toHaveLength(1)

    pending.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    mounted.dispose()
  })

  test("keeps primary save pointer events inside the response actions", () => {
    runtimeHandle = handle("ready", view())
    const focus = mock(() => {})
    const parentPointerDown = mock(() => {})
    const mounted = mountWithParent({ ...props(), onFocus: focus }, parentPointerDown)
    const assistant = mounted.host.querySelector('[data-message-id="assistant-1"]')!

    for (const action of ["save-response-ctxpack", "save-response-options"]) {
      assistant
        .querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!
        .dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }))
    }
    expect(focus).not.toHaveBeenCalled()
    expect(parentPointerDown).not.toHaveBeenCalled()

    assistant
      .querySelector<HTMLButtonElement>('[data-action="save-response-options"]')!
      .dispatchEvent(new PointerEvent("pointerdown", { button: 2, bubbles: true }))
    expect(focus).not.toHaveBeenCalled()
    expect(parentPointerDown).toHaveBeenCalledTimes(1)
    mounted.dispose()
  })

  test("keeps the last relay view mounted while a refresh is stale", () => {
    runtimeHandle = handle("stale", view("thinking", "next message"))
    const mounted = mount(props())

    expect(mounted.host.querySelector('[data-component="chat-relay-transcript"]')).not.toBeNull()
    expect(mounted.host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("next message")
    expect(mounted.host.textContent).not.toContain("canvas.chat.relay.loading.title")
    mounted.dispose()
  })

  test("formats a generated request error while preserving the last relay view", () => {
    runtimeHandle = {
      ...handle("error", view()),
      error: () => ({ name: "ChatProxyRequestError", data: { message: "Close the login browser first" } }),
    }
    const mounted = mount(props())

    expect(mounted.host.querySelector('[data-component="chat-relay-transcript"]')).not.toBeNull()
    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain("Close the login browser first")
    expect(mounted.host.querySelector('[data-action="chat-relay-refresh"]')).not.toBeNull()
    mounted.dispose()
  })

  test("submits Enter once, preserves Shift+Enter, and persists draft edits", async () => {
    runtimeHandle = handle("ready", view())
    const mounted = mount(props())
    const textarea = mounted.host.querySelector<HTMLTextAreaElement>('[data-input="chat-relay-message"]')!
    textarea.value = "Send this"
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }))
    expect(commands).toEqual([{ type: "set-draft", draft: "Send this" }])
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    await Promise.resolve()

    expect(commands).toEqual([
      { type: "set-draft", draft: "Send this" },
      { type: "prompt", messageID: "message-1", text: "Send this" },
    ])
    mounted.dispose()
  })

  test("retains text and reuses the message id when acknowledgement fails", async () => {
    let attempts = 0
    dispatchCommand = async (command) => {
      commands.push(command)
      if (command.type !== "prompt") return
      attempts += 1
      throw { name: "ChatProxyRequestError", data: { message: "connection lost" } }
    }
    runtimeHandle = handle("ready", view("idle", "Retry this"))
    const mounted = mount(props())
    const send = mounted.host.querySelector<HTMLButtonElement>('[data-action="chat-relay-send"]')!
    send.click()
    send.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(attempts).toBe(1)
    expect(mounted.host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Retry this")

    send.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(commands.filter((command) => command.type === "prompt")).toEqual([
      { type: "prompt", messageID: "message-1", text: "Retry this" },
      { type: "prompt", messageID: "message-1", text: "Retry this" },
    ])
    mounted.dispose()
  })

  test("opens the owned tab, reinitializes it, and explains login attention", async () => {
    runtimeHandle = handle("ready", view("login-required"))
    const mounted = mount(props())
    expect(mounted.host.textContent).toContain("canvas.chat.relay.loginRequired.description")
    mounted.host.querySelector<HTMLButtonElement>('[data-action="chat-relay-open"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    mounted.host.querySelector<HTMLButtonElement>('[data-action="chat-relay-reset"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(commands).toEqual([{ type: "open-relay" }, { type: "reset" }])
    mounted.dispose()
  })

  test("does not offer reset before the backend assigns a page incarnation", () => {
    const current = view("disconnected")
    current.relay.tabID = undefined
    runtimeHandle = handle("ready", current)
    const mounted = mount(props())
    const reset = mounted.host.querySelector<HTMLButtonElement>('[data-action="chat-relay-reset"]')!

    expect(reset.disabled).toBe(true)
    reset.click()
    expect(commands).toEqual([])
    mounted.dispose()
  })

  test("renders a runtime access denial without treating agent web-tool policy as ChatRelay policy", () => {
    runtimeHandle = handle("permission-denied", view())
    const mounted = mount(props({ webfetch: "allow", websearch: "allow" }))
    expect(mounted.host.textContent).toContain("canvas.chat.relay.handoff.denied.title")
    expect(mounted.host.querySelector('[data-component="chat-relay"]')).toBeNull()
    mounted.dispose()
  })
})
