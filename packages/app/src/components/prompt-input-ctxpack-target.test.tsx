import { afterEach, describe, expect, mock, test } from "bun:test"

const clientSolid = import.meta.resolve("solid-js").replace("dist/server.js", "dist/solid.js")
mock.module("solid-js", () => require(clientSolid))

const { createRoot } = await import("solid-js")

const payload = {
  version: 1 as const,
  workspaceID: "workspace-1",
  ctxPackID: "pack-1",
  contentHash: "hash-1",
  label: "Pack 1",
  estimatedTokens: 10,
}
const materializations: Array<{ instanceID: string; functionalityID: string }> = []
let controllerInput: { view: { onDrop: (event: { dataTransfer?: unknown }) => boolean } } | undefined
type DropTargetProps = {
  targetID: string
  instanceID: string
  functionalityID: string
  addCtxPack: (input: typeof payload) => Promise<void>
  disabled: () => boolean
}
const dropTargets: DropTargetProps[] = []
const CapturingDropTarget = (props: DropTargetProps) => {
  dropTargets.push(props)
  return document.createElement("div")
}

const attachmentStore = {
  attachments: () => [],
  addCtxPack: async (_payload: unknown, target: { instanceID: string; functionalityID: string }) => {
    materializations.push(target)
  },
  remove() {},
  clearAfterAdmission() {},
  restoreAfterFailure() {},
  totalEstimatedTokens: () => 0,
  pendingCount: () => 0,
}

mock.module("@/context/ctxpack/attachment-store", () => ({
  useContextAttachmentStoreOrNull: () => attachmentStore,
  useOptionalContextAttachmentStore: () => attachmentStore,
}))
mock.module("@/context/ctxpack/drop-target", () => ({
  CtxPackDropTarget: CapturingDropTarget,
  useMessageContextTargetRegistry: () => ({ markFocused() {} }),
}))
mock.module("@/context/ctxpack/drag", () => ({
  parseCtxPackDragPayload: () => payload,
}))
mock.module("@/components/prompt-input/context-attachments", () => ({
  ContextAttachmentChips: () => document.createElement("div"),
  contextAttachmentLimitReached: () => false,
}))
mock.module("@opencode-ai/session-ui/v2/prompt-input/interaction", () => ({
  createPromptInputV2State: () => [{ mode: "normal" }, () => {}],
  createPromptInputV2Controller: (input: typeof controllerInput) => {
    controllerInput = input
    return {
      state: { mode: "normal" },
      addHistory() {},
      resetHistory() {},
      dispatch() {},
      attach() {},
      restoreFocus() {},
      contextItem: () => undefined,
    }
  },
}))
mock.module("@/components/prompt-input/submit", () => ({
  createPromptSubmit: () => ({
    handleSubmit() {},
    queueSubmit() {},
    abort() {},
  }),
}))
mock.module("@/components/prompt-input/history-store", () => ({
  createPersistedPromptInputHistory: () => ({ entries: () => [], add() {} }),
  createPromptInputHistory: () => ({ entries: () => [], add() {} }),
}))
mock.module("@/components/prompt-input/history", () => ({
  canNavigateHistoryAtCursor: () => false,
  navigatePromptHistory: () => ({ handled: false }),
  normalizePromptHistoryEntry: (value: unknown) => value,
  promptLength: () => 0,
}))
mock.module("@/components/prompt-input/placeholder", () => ({
  promptDesignPlaceholder: () => "",
  promptPlaceholder: () => "",
}))
mock.module("@/pages/session/helpers", () => ({
  createSessionTabs: () => ({ activeFileTab: () => undefined }),
}))
mock.module("@/context/file", () => ({
  selectionFromLines: (value: unknown) => value,
  useFile: () => ({
    pathFromTab: () => undefined,
    tab: (value: string) => value,
    searchFilesAndDirectories: async () => [],
  }),
}))
mock.module("@/context/comments", () => ({
  useComments: () => ({ all: () => [], replace() {}, remove() {} }),
}))
mock.module("@/context/command", () => ({
  useCommand: () => ({
    options: [],
    keybind: () => "",
    keybindParts: () => [],
    register() {},
    trigger() {},
  }),
}))
mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
mock.module("@/context/layout", () => ({ useLayout: () => ({}) }))
mock.module("@/context/permission", () => ({
  usePermission: () => ({ isAutoAccepting: () => false, isAutoAcceptingDirectory: () => false }),
}))
mock.module("@/context/platform", () => ({ usePlatform: () => ({}) }))
mock.module("@/context/sdk", () => ({ useSDK: () => () => ({ directory: "/repo" }) }))
mock.module("@/context/sync", () => ({
  useSync: () => () => ({
    session: { get: () => ({ workspaceID: "workspace-1" }) },
    data: {
      command: [],
      message: {},
      mcp_resource: {},
      reference: [],
      session_diff: {},
      session_working: () => false,
    },
  }),
}))
mock.module("@opencode-ai/ui/context/dialog", () => ({ useDialog: () => ({ active: false, show() {} }) }))
mock.module("@/utils/toast", () => ({ showToast() {} }))
mock.module("@opencode-ai/ui/hooks", () => ({
  useFilteredList: () => ({
    flat: () => [],
    active: () => undefined,
    setActive() {},
    onInput() {},
    onKeyDown() {},
  }),
}))
mock.module("@opencode-ai/ui/motion-spring", () => ({ useSpring: () => () => 1 }))
mock.module("@/context/prompt", () => ({
  ContentPart: {},
  DEFAULT_PROMPT: [],
  isCommentItem: () => false,
  isPromptEqual: () => true,
  usePrompt: () => prompt,
}))
mock.module("@/components/prompt-input/attachments", () => ({
  createPromptAttachments: () => ({
    addAttachment() {},
    addAttachments() {},
    removeAttachment() {},
    handlePaste() {},
  }),
}))
mock.module("@/components/prompt-input/slash-popover", () => ({
  PromptPopover: () => document.createElement("div"),
}))
mock.module("@opencode-ai/ui/dock-surface", () => ({
  DockShellForm: () => document.createElement("div"),
  DockTray: () => document.createElement("div"),
}))

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  if (tag === CapturingDropTarget) return CapturingDropTarget(next as DropTargetProps)
  return document.createElement("div")
}
const Fragment = (props: { children?: unknown }) => props.children
;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

const [{ PromptInput }, { usePromptInputV2Controller }] = await Promise.all([
  import("./prompt-input"),
  import("./prompt-input-v2"),
])

afterEach(() => {
  materializations.splice(0)
  dropTargets.splice(0)
  controllerInput = undefined
})

function controls(sessionID: string | undefined) {
  return {
    agents: { available: [], options: [], current: "", loading: false, visible: false, select() {} },
    model: {
      selection: {
        current: () => undefined,
        variant: { current: () => undefined, list: () => [], set() {} },
      },
      paid: true,
      loading: false,
    },
    session: {
      id: sessionID,
      tabs: { active: () => undefined, all: () => [], open() {}, setActive() {} },
      reviewPanel: { opened: () => false, open() {} },
    },
  }
}

const prompt = {
  current: () => [],
  capture: () => ({ store: {}, current: () => [], set() {}, reset() {} }),
  context: { items: () => [], replaceComments() {}, remove() {}, add() {} },
  ready: { promise: Promise.resolve() },
  dirty: () => false,
  set() {},
}

function v1Target(sessionID: string | undefined, contextTarget?: unknown) {
  return createRoot((dispose) => {
    PromptInput({
      controls: controls(sessionID),
      state: prompt,
      contextTarget,
    } as never)
    const target = dropTargets.at(-1)
    dispose()
    return target
  })
}

function controller(sessionID: string | undefined, contextTarget?: unknown) {
  return createRoot((dispose) => {
    const value = usePromptInputV2Controller({
      controls: controls(sessionID),
      state: prompt,
      contextTarget,
    } as never)
    dispose()
    return value
  })
}

describe("V2 composer CtxPack target", () => {
  test("two composers for the same session register independent focused targets", () => {
    const first = v1Target("session-1")
    const second = v1Target("session-1")
    expect(first?.targetID).not.toBe(second?.targetID)
    expect(first?.instanceID).toBe(second?.instanceID)
  })
  test("materializes a generic Session capsule against its canonical chat target", async () => {
    const value = controller("session-1")

    expect(value.ctxpackTarget).toEqual({
      instanceID: "chat-instance:session-1",
      functionalityID: "builtin:chat",
    })
    await value.ctxpackAddCtxPack(payload)
    expect(materializations).toEqual([
      { instanceID: "chat-instance:session-1", functionalityID: "builtin:chat" },
    ])
  })

  test("materializes an OperatingChat capsule against the supplied live target", async () => {
    const value = controller("session-1", {
      instanceID: "instance-1",
      functionalityID: "builtin:operating-chat-session",
    })

    await value.ctxpackAddCtxPack(payload)
    expect(materializations).toEqual([
      { instanceID: "instance-1", functionalityID: "builtin:operating-chat-session" },
    ])
  })

  test("rejects direct and inner drops without a valid Session target", async () => {
    const value = controller(undefined)

    expect(value.ctxpackDropDisabled()).toBe(true)
    await value.ctxpackAddCtxPack(payload)
    expect(controllerInput?.view.onDrop({ dataTransfer: {} })).toBe(false)
    await Promise.resolve()
    expect(materializations).toEqual([])
  })

  test("does not replace an invalid explicit target with the generic fallback", async () => {
    const value = controller("session-1", { instanceID: "", functionalityID: "builtin:chat" })

    expect(value.ctxpackDropDisabled()).toBe(true)
    await value.ctxpackAddCtxPack(payload)
    expect(controllerInput?.view.onDrop({ dataTransfer: {} })).toBe(false)
    await Promise.resolve()
    expect(materializations).toEqual([])
  })
})

describe("V1 composer CtxPack target", () => {
  test("registers and materializes against the canonical generic Session target", async () => {
    const target = v1Target("session-1")

    expect(target?.targetID).toBeTruthy()
    expect(target?.instanceID).toBe("chat-instance:session-1")
    expect(target?.functionalityID).toBe("builtin:chat")
    expect(target?.disabled()).toBe(false)
    await target?.addCtxPack(payload)
    expect(materializations).toEqual([
      { instanceID: "chat-instance:session-1", functionalityID: "builtin:chat" },
    ])
  })

  test("fails closed through wrapper and direct add without a valid target", async () => {
    const noSession = v1Target(undefined)
    expect(noSession?.targetID).toBe("")
    expect(noSession?.instanceID).toBe("")
    expect(noSession?.functionalityID).toBe("")
    expect(noSession?.disabled()).toBe(true)
    await noSession?.addCtxPack(payload)

    const invalid = v1Target("session-1", { instanceID: "", functionalityID: "builtin:chat" })
    expect(invalid?.targetID).toBe("")
    expect(invalid?.disabled()).toBe(true)
    await invalid?.addCtxPack(payload)
    expect(materializations).toEqual([])
  })
})
