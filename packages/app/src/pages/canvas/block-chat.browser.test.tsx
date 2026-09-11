import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import { createComponent, createContext, type ParentProps, useContext } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import { createPromptState } from "@/context/prompt-state"
import type { CanvasSessionSurfaceProps } from "./session-target"
import type { BlockChatComposerProps } from "./block-chat-composer"
import type { CapturedCtxPackFragment } from "@/context/ctxpack/selection"
import type { CtxPackCreatePayload } from "@opencode-ai/sdk/v2/types"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length) next.children = children.length === 1 ? children[0] : children
  return () => createComponent(tag as never, next)
}

Object.assign(globalThis, { React: { createElement } })

type Session = {
  id: string
  agent: string
  model?: { providerID: string; id: string; variant?: string }
  working?: boolean
  empty?: boolean
  permission?: { id: string; sessionID: string }
  question?: { id: string; sessionID: string }
  todos?: { content: string; status: string }[]
}
const sessions = new Map<string, Session>()
const PromptContext = createContext<ReturnType<typeof createPromptState>>()
const timelines: {
  sessionID: () => string
  sessionKey: () => string
  header: boolean
  anchor: (id: string) => string
  onSaveResponse: (
    response: { text: string; messageID: string; timestamp: number },
    options: { details: boolean },
  ) => Promise<void> | void
}[] = []
const saved: CapturedCtxPackFragment[] = []
const opened: boolean[] = []
const composers: BlockChatComposerProps[] = []
const disposers: VoidFunction[] = []
const toasts: string[] = []
const createPack = mock(
  async (
    _input: { workspaceID: string; ctxPackCreatePayload: CtxPackCreatePayload },
    _options: { throwOnError: true },
  ) => ({
    data: { id: "ctxpk-created" },
  }),
)

mock.module("@opencode-ai/ui/hooks", () => ({
  createAutoScroll: () => ({
    resume: () => {},
    scrollRef: () => {},
    contentRef: () => {},
    handleScroll: () => {},
    handleInteraction: () => {},
    userScrolled: () => false,
  }),
}))
mock.module("@/context/ctxpack/attachment-store", () => ({
  ContextAttachmentStoreProvider: (props: ParentProps) => props.children,
}))
mock.module("@/context/ctxpack/draft", () => ({
  useCtxPackDraft: () => ({
    workspaceID: () => "workspace",
    add: (fragment: CapturedCtxPackFragment) => saved.push(fragment),
    openCreate: () => opened.push(true),
  }),
}))
mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
mock.module("@/utils/toast", () => ({ showToast: (message: string) => toasts.push(message) }))
mock.module("@/context/prompt", () => ({ usePrompt: () => useContext(PromptContext)! }))
mock.module("@/context/server-sdk", () => ({
  useServerSDK: () => () => ({
    scope: "local",
    client: { v2: { workspace: { ctxpack: { create: createPack } } } },
  }),
}))
mock.module("@/context/server-sync", () => ({ useServerSync: () => () => ({ queryOptions: {} }) }))
mock.module("@/context/sync", () => ({
  useSync: () => () => ({
    session: { get: (id: string) => sessions.get(id) },
    data: {
      config: { default_agent: "build" },
      agent: [{ name: "build" }],
      session_working: (id: string) => !!sessions.get(id)?.working,
    },
  }),
}))
mock.module("@/pages/session/composer", () => ({
  createSessionComposerController: (input: { sessionID: () => string }) => ({
    blocked: () => !!(sessions.get(input.sessionID())?.permission || sessions.get(input.sessionID())?.question),
    permissionRequest: () => sessions.get(input.sessionID())?.permission,
    questionRequest: () => sessions.get(input.sessionID())?.question,
    todos: () => sessions.get(input.sessionID())?.todos ?? [],
    permissionResponding: () => false,
    decide: () => {},
  }),
  createPromptInputController: (input: { sessionID: () => string; model: unknown }) => () => ({
    session: { id: input.sessionID() },
    model: { selection: input.model },
    agents: { current: "global-agent", visible: true },
  }),
}))
mock.module("@/pages/session/composer/prompt-model-selection", () => ({
  createPromptModelSelection: () => {
    const prompt = useContext(PromptContext)!
    return { current: prompt.model.current, set: prompt.model.set }
  },
}))
mock.module("@/pages/session/composer/session-permission-dock", () => ({
  SessionPermissionDock: (props: { request: { id: string } }) => h("div", { "data-permission": props.request.id }),
}))
mock.module("@/pages/session/composer/session-question-dock", () => ({
  SessionQuestionDock: (props: { request: { id: string } }) => h("div", { "data-question": props.request.id }),
}))
mock.module("@/pages/session/timeline/message-timeline", () => ({
  MessageTimeline: (props: (typeof timelines)[number]) => {
    timelines.push(props)
    return h("div", { "data-timeline-session": props.sessionID() })
  },
}))
mock.module("@/pages/session/timeline/model", () => ({
  createTimelineModel: (input: { sessionID: () => string }) => ({
    resource: () => true,
    ready: () => true,
    lastUserMessage: () => undefined,
    visibleUserMessages: () => (sessions.get(input.sessionID())?.empty ? [] : [{ id: `message-${input.sessionID()}` }]),
    history: { more: () => false, loading: () => false, loadOlder: async () => {} },
  }),
}))
mock.module("./block-chat-composer", () => ({
  BlockChatComposer: (props: BlockChatComposerProps) => {
    composers.push(props)
    return h("div", { "data-composer-session": props.controls.session.id })
  },
}))

let BlockChat: (typeof import("./block-chat"))["BlockChat"]
beforeAll(async () => {
  BlockChat = (await import("./block-chat")).BlockChat
})
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  sessions.clear()
  timelines.splice(0)
  composers.splice(0)
  saved.splice(0)
  opened.splice(0)
  toasts.splice(0)
  createPack.mockReset()
  createPack.mockResolvedValue({ data: { id: "ctxpk-created" } })
  document.body.innerHTML = ""
})

function mount(
  role: NonNullable<CanvasSessionSurfaceProps["role"]>,
  session: Partial<Session> = {},
  queueEnabled = true,
) {
  const id = session.id ?? `session-${role}`
  sessions.set(id, { id, agent: `agent-${role}`, ...session })
  const host = document.createElement("div")
  host.setAttribute("data-ctxpack-source-root", "")
  host.dataset.workspaceId = "workspace"
  host.dataset.blockId = `source-${role}`
  host.dataset.functionalityId = `builtin:${role}`
  document.body.append(host)
  const prompt = createPromptState()
  const dispose = render(
    () =>
      createComponent(PromptContext.Provider, {
        value: prompt,
        get children() {
          return createComponent(BlockChat, {
            target: { sessionID: id, directory: "D:/workspace", workspaceID: "workspace" },
            surfaceID: `block-${role}`,
            role,
            focused: true,
            queueEnabled,
            onFocus: () => {},
          })
        },
      }),
    host,
  )
  disposers.push(dispose)
  return { host, prompt, dispose }
}

describe("BlockChat", () => {
  test("save with details captures only the chosen response and opens the shared pack dialog", async () => {
    mount("operating")
    mount("master")
    mount("relay")
    await timelines[1].onSaveResponse(
      { text: "Master response **only**", messageID: "msg-master", timestamp: 20 },
      { details: true },
    )
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      text: "Master response **only**",
      source: {
        workspaceID: "workspace",
        blockID: "source-master",
        functionalityID: "builtin:master",
        entityRef: { type: "message", id: "msg-master" },
        metadata: { sessionID: "session-master" },
      },
    })
    expect(opened).toEqual([true])
    expect(createPack).not.toHaveBeenCalled()
  })

  test("quick-save sends defaults through the SDK with bound source provenance and preserves the shared draft", async () => {
    mount("operating")
    mount("master")
    await timelines[0].onSaveResponse(
      { text: "Existing draft", messageID: "msg-draft", timestamp: 10 },
      { details: true },
    )
    const existing = saved[0]
    opened.splice(0)
    await timelines[1].onSaveResponse(
      { text: "  Master response\nOnly this answer  ", messageID: "msg-master", timestamp: 20 },
      { details: false },
    )
    expect(createPack).toHaveBeenCalledTimes(1)
    const request = createPack.mock.calls[0][0]
    expect(request).toMatchObject({
      workspaceID: "workspace",
      ctxPackCreatePayload: {
        title: "Master response",
        keywords: ["Master", "response", "answer"],
        sensitivity: "workspace",
        fragments: [
          {
            text: "Master response\nOnly this answer",
            source: {
              workspaceID: "workspace",
              blockID: "source-master",
              functionalityID: "builtin:master",
              direction: "received",
              entityRef: { type: "message", id: "msg-master" },
              metadata: { sessionID: "session-master" },
              sourceTimestamp: 20,
            },
          },
        ],
      },
    })
    expect(request.ctxPackCreatePayload.idempotencyKey).toBeTruthy()
    expect(createPack.mock.calls[0][1]).toEqual({ throwOnError: true })
    expect(saved).toEqual([existing])
    expect(opened).toEqual([])
    expect(toasts).toEqual(["canvas.ctxpack.saved"])
  })

  test("quick-save enforces the token budget and rejects a mismatched source workspace before saving", async () => {
    const mounted = mount("master")
    await timelines[0].onSaveResponse(
      { text: "x".repeat(24_001), messageID: "too-large", timestamp: 20 },
      { details: false },
    )
    mounted.host.dataset.workspaceId = "other-workspace"
    await timelines[0].onSaveResponse(
      { text: "Other workspace text", messageID: "other", timestamp: 20 },
      { details: false },
    )
    expect(createPack).not.toHaveBeenCalled()
    expect(saved).toEqual([])
    expect(opened).toEqual([])
    expect(toasts).toEqual(["canvas.ctxpack.captureFailed", "canvas.ctxpack.captureFailed"])
  })

  test("quick-save defaults keep unicode titles and suggested keywords within server limits", async () => {
    mount("relay")
    await timelines[0].onSaveResponse(
      { text: "测试".repeat(60), messageID: "long-title", timestamp: 20 },
      { details: false },
    )
    const payload = createPack.mock.calls[0][0].ctxPackCreatePayload
    expect(Array.from(payload.title)).toHaveLength(80)
    expect(payload.keywords.every((keyword) => Array.from(keyword).length <= 48)).toBe(true)
    expect(payload.fragments[0].text).toBe("测试".repeat(60))
    await timelines[0].onSaveResponse(
      { text: "ﬃ".repeat(20), messageID: "normalized-keyword", timestamp: 20 },
      { details: false },
    )
    expect(createPack.mock.calls[1][0].ctxPackCreatePayload.keywords).toEqual([])
  })

  test("quick-save failure preserves the existing draft and reports a localized message without response text", async () => {
    mount("master")
    await timelines[0].onSaveResponse({ text: "Existing draft", messageID: "draft", timestamp: 10 }, { details: true })
    const existing = saved[0]
    opened.splice(0)
    createPack.mockRejectedValueOnce(new Error("private response text from server"))
    await timelines[0].onSaveResponse(
      { text: "Response to save", messageID: "failed", timestamp: 20 },
      { details: false },
    )
    expect(createPack).toHaveBeenCalledTimes(1)
    expect(saved).toEqual([existing])
    expect(opened).toEqual([])
    expect(toasts).toEqual(["canvas.ctxpack.saveFailed"])
  })

  for (const result of ["success", "failure"] as const) {
    test(`a late quick-save ${result} does not notify or mutate a replacement block`, async () => {
      const pending = Promise.withResolvers<{ data: { id: string } }>()
      createPack.mockImplementationOnce(() => pending.promise)
      const previous = mount("master")
      const saving = timelines[0].onSaveResponse(
        { text: "Previous response", messageID: "previous", timestamp: 20 },
        { details: false },
      )
      previous.dispose()
      mount("master", { id: "replacement" })
      await timelines[1].onSaveResponse(
        { text: "Current draft", messageID: "current", timestamp: 30 },
        { details: true },
      )
      const current = saved[0]
      if (result === "success") pending.resolve({ data: { id: "previous-pack" } })
      if (result === "failure") pending.reject(new Error("Previous failure"))
      await saving
      expect(toasts).toEqual([])
      expect(saved).toEqual([current])
      expect(opened).toEqual([true])
    })
  }

  test("addresses each role's bound session and suppresses routed timeline headers", () => {
    mount("operating")
    mount("master")
    mount("relay")
    expect(timelines.map((timeline) => timeline.sessionID())).toEqual([
      "session-operating",
      "session-master",
      "session-relay",
    ])
    expect(timelines.map((timeline) => timeline.sessionKey())).toEqual([
      '["local","D:/workspace","session-operating","block-operating"]',
      '["local","D:/workspace","session-master","block-master"]',
      '["local","D:/workspace","session-relay","block-relay"]',
    ])
    expect(timelines.every((timeline) => timeline.header === false)).toBe(true)
    expect(new Set(timelines.map((timeline) => timeline.anchor("same-message"))).size).toBe(3)
    expect(composers.map((composer) => composer.controls.session.id)).toEqual([
      "session-operating",
      "session-master",
      "session-relay",
    ])
    expect(composers.map((composer) => composer.controls.agents.current)).toEqual([
      "agent-operating",
      "agent-master",
      "agent-relay",
    ])
    expect(composers.every((composer) => !composer.controls.agents.visible)).toBe(true)
  })

  test("keeps permission, question, and attention state within the bound block", () => {
    const operating = mount("operating", { permission: { id: "permission-operating", sessionID: "session-operating" } })
    const master = mount("master", { question: { id: "question-master", sessionID: "session-master" } })
    const relay = mount("relay", { working: true })
    expect(operating.host.querySelector('[data-permission="permission-operating"]')).not.toBeNull()
    expect(operating.host.querySelector("[data-question]")).toBeNull()
    expect(master.host.querySelector('[data-question="question-master"]')).not.toBeNull()
    expect(master.host.querySelector("[data-permission]")).toBeNull()
    expect(relay.host.querySelector("[data-question], [data-permission]")).toBeNull()
    expect(operating.host.querySelector("[data-state]")?.getAttribute("data-state")).toBe("attention")
    expect(master.host.querySelector("[data-state]")?.getAttribute("data-state")).toBe("attention")
    expect(relay.host.querySelector("[data-state]")?.getAttribute("data-state")).toBe("working")
    expect(composers.map((composer) => composer.role)).toEqual(["relay"])
  })

  test("enables queue only for its working session when that block permits queueing", () => {
    mount("operating")
    mount("master", { working: true })
    mount("relay", { working: true }, false)
    expect(composers.map((composer) => composer.queue?.())).toEqual([false, true, false])
    sessions.get("session-operating")!.working = true
    sessions.get("session-master")!.working = false
    expect(composers.map((composer) => composer.queue?.())).toEqual([true, false, false])
  })

  test("restores the relay model without overwriting workspace role drafts", () => {
    const operating = mount("operating", { model: { providerID: "provider", id: "main" } })
    const master = mount("master", { model: { providerID: "provider", id: "coder" } })
    const relay = mount("relay", { model: { providerID: "provider", id: "relay-model" } })
    expect(operating.prompt.model.current()).toBeUndefined()
    expect(master.prompt.model.current()).toBeUndefined()
    expect(relay.prompt.model.current()).toEqual({ providerID: "provider", modelID: "relay-model", variant: undefined })
    relay.prompt.model.set({ providerID: "provider", modelID: "relay-changed" })
    expect(operating.prompt.model.current()).toBeUndefined()
    expect(master.prompt.model.current()).toBeUndefined()
    expect(composers[0]?.controls.model.selection).not.toBe(composers[2]?.controls.model.selection)
  })

  test("shows each role's empty message and keeps task details exclusive to MasterAgent", () => {
    const todos = [{ content: "Implement the change", status: "pending" }]
    const operating = mount("operating", { empty: true, todos })
    const master = mount("master", { empty: true, todos })
    const relay = mount("relay", { empty: true, todos })
    expect(operating.host.textContent).toContain("canvas.chat.operating.empty")
    expect(master.host.textContent).toContain("canvas.chat.master.empty")
    expect(relay.host.textContent).toContain("canvas.chat.relay.empty")
    expect(operating.host.querySelector(".block-chat-tasks")).toBeNull()
    expect(master.host.querySelector(".block-chat-tasks")?.textContent).toContain("Implement the change")
    expect(relay.host.querySelector(".block-chat-tasks")).toBeNull()
    expect(timelines).toHaveLength(0)
    expect(composers).toHaveLength(3)
  })

  test("remounting a replacement binding leaves its sibling on the original conversation", () => {
    const operating = mount("operating")
    const master = mount("master")
    const sibling = master.host.querySelector(".block-chat")
    operating.dispose()
    const replacement = mount("operating", { id: "session-operating-reset", empty: true })

    expect(operating.host.querySelector(".block-chat")).toBeNull()
    expect(replacement.host.querySelector(".block-chat")?.getAttribute("data-chat-session")).toBe(
      "session-operating-reset",
    )
    expect(replacement.host.querySelector("[data-timeline-session]")).toBeNull()
    expect(composers.at(-1)?.controls.session.id).toBe("session-operating-reset")
    expect(master.host.querySelector(".block-chat")).toBe(sibling)
    expect(master.host.querySelector("[data-timeline-session]")?.getAttribute("data-timeline-session")).toBe(
      "session-master",
    )
  })
})
