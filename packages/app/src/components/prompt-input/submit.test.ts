import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createStore } from "solid-js/store"
import type { Prompt, PromptStore } from "@/context/prompt"
import type { ModelSelection } from "@/context/local"
import type { ContextAttachmentDraft, ContextAttachmentStore } from "@/context/ctxpack/attachment-store"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { ServerScope } from "@/utils/server-scope"

let createPromptSubmit: typeof import("./submit").createPromptSubmit

const createdClients: string[] = []
const createdSessions: string[] = []
const sessionCreateInputs: Array<{
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  location?: { directory: string }
}> = []
const enabledAutoAccept: Array<{ server: string; sessionID: string; directory: string }> = []
const optimistic: Array<{
  directory?: string
  sessionID?: string
  message: {
    agent: string
    model: { providerID: string; modelID: string }
    variant?: string
  }
}> = []
const optimisticSeeded: boolean[] = []
const storedSessions: Record<string, Array<{ id: string; title?: string }>> = {}
const promoted: Array<{ directory: string; sessionID: string }> = []
const sentShell: Array<{ sessionID: string; id?: string; command: string }> = []
const syncedDirectories: string[] = []
const promotedDrafts: Array<{ draftID: string; server: string; sessionId: string }> = []
const sentPrompts: string[] = []
const promptInputs: unknown[] = []
const sentCommands: unknown[] = []
const commands: Array<{ name: string }> = []
let serverSessionSyncs = 0
let failPrompt = false
let failInterrupt = false
const interruptCalls: string[] = []
const toastCalls: Array<{ title?: string; description?: string }> = []

let params: { id?: string } = {}
let search: { draftId?: string } = {}
let selected = "/repo/worktree-a"
let variant: string | undefined
let permissionServer = "server-a"
let createSessionGate: Promise<void> | undefined

let promptValue: Prompt = [{ type: "text", content: "ls", start: 0, end: 2 }]
const [promptStore, setPromptStore] = createStore<PromptStore>({
  prompt: promptValue,
  cursor: 0,
  context: { items: [] },
})
const prompt = {
  store: [() => promptStore, setPromptStore] as [() => PromptStore, typeof setPromptStore],
  ready: Object.assign(() => true, { promise: Promise.resolve(true) }),
  current: () => promptValue,
  cursor: () => 0,
  dirty: () => true,
  model: {
    current: () => undefined,
    set: () => undefined,
  },
  reset: () => undefined,
  set: () => undefined,
  context: {
    add: () => undefined,
    remove: () => undefined,
    removeComment: () => undefined,
    updateComment: () => undefined,
    replaceComments: () => undefined,
    items: () => [],
  },
  capture: () => prompt,
}

const clientFor = (directory: string) => {
  createdClients.push(directory)
  return {
    api: {
      session: {
        create: async (input: (typeof sessionCreateInputs)[number]) => {
          await createSessionGate
          const location = input.location?.directory ?? directory
          createdSessions.push(location)
          sessionCreateInputs.push(input)
          return {
            id: `session-${createdSessions.length}`,
            projectID: "project",
            agent: input.agent,
            model: input.model,
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1 },
            title: `New session ${createdSessions.length}`,
            location: { directory: location },
          }
        },
        prompt: async (input: unknown) => {
          sentPrompts.push(directory)
          promptInputs.push(input)
          if (failPrompt) throw new Error("admission-failed")
          return { data: undefined }
        },
        interrupt: async (input: { sessionID: string }) => {
          interruptCalls.push(input.sessionID)
          if (failInterrupt) throw new Error("interrupt-invalid")
        },
        command: async (input: unknown) => {
          sentCommands.push(input)
        },
        shell: async (input: { sessionID: string; id?: string; command: string }) => {
          sentShell.push(input)
        },
      },
    },
    session: {
      command: async () => ({ data: undefined }),
      abort: async () => ({ data: undefined }),
    },
    worktree: {
      create: async () => ({ data: { directory: `${directory}/new` } }),
    },
  }
}

beforeAll(async () => {
  const rootClient = clientFor("/repo/main")

  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => params,
    useLocation: () => ({}),
    useSearchParams: () => [search, () => undefined],
  }))

  mock.module("@opencode-ai/sdk/v2/client", () => ({
    createOpencodeClient: (input: { directory: string }) => {
      createdClients.push(input.directory)
      return clientFor(input.directory)
    },
  }))

  mock.module("@opencode-ai/ui/toast", () => ({
    Toast: { Region: () => null },
    showToast: () => 0,
    toaster: { show: () => 0, dismiss: () => 0 },
  }))

  mock.module("@/utils/toast", () => ({
    showToast: (options: { title?: string; description?: string } | string) => {
      toastCalls.push(typeof options === "string" ? { title: options } : options)
    },
    ToastRegion: () => null,
    dismissToast: () => 0,
    setV2Toast: () => undefined,
  }))

  mock.module("@opencode-ai/core/util/encode", () => ({
    base64Encode: (value: string) => value,
  }))

  mock.module("@/context/local", () => ({
    useLocal: () => ({
      model: {
        current: () => ({ id: "model", provider: { id: "provider" } }),
        variant: { current: () => variant },
      },
      agent: {
        current: () => ({ name: "agent" }),
      },
      session: {
        promote(directory: string, sessionID: string) {
          promoted.push({ directory, sessionID })
        },
      },
    }),
  }))

  mock.module("@/context/permission", () => {
    const state = (server: string) => ({
      enableAutoAccept(sessionID: string, directory: string) {
        enabledAutoAccept.push({ server, sessionID, directory })
      },
    })
    return { usePermission: () => ({ currentServerState: () => state(permissionServer) }) }
  })

  mock.module("@/context/server", () => ({
    useServer: () => ({ key: "server-key" }),
  }))

  mock.module("@/context/tabs", () => ({
    useTabs: () => ({
      draft: () => ({ server: "project-server" }),
      promoteDraft: (draftID: string, session: { server: string; sessionId: string }) => {
        promotedDrafts.push({ draftID, ...session })
      },
    }),
  }))

  mock.module("@/context/prompt", () => ({
    usePrompt: () => prompt,
  }))

  mock.module("@/context/layout", () => ({
    useLayout: () => ({
      handoff: {
        setTabs: () => undefined,
      },
    }),
  }))

  mock.module("@/context/sdk", () => ({
    useSDK: () => {
      const sdk = {
        scope: "local",
        directory: "/repo/main",
        client: rootClient,
        api: rootClient.api,
        url: "http://localhost:4096",
        createClient(opts: any) {
          return clientFor(opts.directory)
        },
      }
      return () => sdk
    },
  }))

  mock.module("@/context/sync", () => ({
    useSync: () => () => ({
      data: { command: commands },
      session: {
        optimistic: {
          add: (value: {
            directory?: string
            sessionID?: string
            message: { agent: string; model: { providerID: string; modelID: string; variant?: string } }
          }) => {
            optimistic.push(value)
            optimisticSeeded.push(
              !!value.directory &&
                !!value.sessionID &&
                !!storedSessions[value.directory]?.find((item) => item.id === value.sessionID)?.title,
            )
          },
          remove: () => undefined,
        },
      },
      set: () => undefined,
    }),
  }))

  mock.module("@/context/server-sync", () => ({
    useServerSync: () => () => ({
      session: {
        remember: () => undefined,
        set: () => undefined,
        sync: async () => {
          serverSessionSyncs++
        },
      },
      child: (directory: string) => {
        syncedDirectories.push(directory)
        storedSessions[directory] ??= []
        return [
          { session: storedSessions[directory] },
          (...args: unknown[]) => {
            if (args[0] !== "session") return
            const next = args[1]
            if (typeof next === "function") {
              storedSessions[directory] = next(storedSessions[directory]) as Array<{ id: string; title?: string }>
              return
            }
            if (Array.isArray(next)) {
              storedSessions[directory] = next as Array<{ id: string; title?: string }>
            }
          },
        ]
      },
    }),
  }))

  mock.module("@/context/platform", () => ({
    usePlatform: () => ({
      fetch: fetch,
    }),
  }))

  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string) => key,
    }),
  }))

  const mod = await import("./submit")
  createPromptSubmit = mod.createPromptSubmit
})

beforeEach(() => {
  failInterrupt = false
  interruptCalls.length = 0
  createdClients.length = 0
  createdSessions.length = 0
  sessionCreateInputs.length = 0
  enabledAutoAccept.length = 0
  optimistic.length = 0
  optimisticSeeded.length = 0
  promoted.length = 0
  promotedDrafts.length = 0
  sentPrompts.length = 0
  promptInputs.length = 0
  sentCommands.length = 0
  commands.length = 0
  promptValue = [{ type: "text", content: "ls", start: 0, end: 2 }]
  params = {}
  search = {}
  sentShell.length = 0
  syncedDirectories.length = 0
  selected = "/repo/worktree-a"
  variant = undefined
  permissionServer = "server-a"
  createSessionGate = undefined
  serverSessionSyncs = 0
  failPrompt = false
  toastCalls.length = 0
  for (const key of Object.keys(storedSessions)) delete storedSessions[key]
})

let nextAttachmentID = 0

function makeAttachment(overrides: Partial<ContextAttachmentDraft> = {}): ContextAttachmentDraft {
  nextAttachmentID += 1
  return {
    clientAttachmentID: `attachment-${nextAttachmentID}`,
    kind: "context-capsule",
    contextCapsuleID: `capsule-${nextAttachmentID}`,
    source: {
      kind: "ctxpack",
      ctxPackID: `pack-${nextAttachmentID}`,
      contentHash: `hash-${nextAttachmentID}`,
    },
    label: `Pack ${nextAttachmentID}`,
    contentHash: `hash-${nextAttachmentID}`,
    estimatedTokens: 100,
    status: "ready",
    errorCode: null,
    ...overrides,
  }
}

type AttachmentStoreSpy = {
  store: ContextAttachmentStore
  cleared: number
  restored: Array<readonly ContextAttachmentDraft[]>
}

function createAttachmentStore(initial: ContextAttachmentDraft[] = []): AttachmentStoreSpy {
  let items: ContextAttachmentDraft[] = [...initial]
  const spy: AttachmentStoreSpy = {
    cleared: 0,
    restored: [],
    store: {
      attachments: () => items,
      addCtxPack: async () => undefined,
      remove: (clientAttachmentID) => {
        items = items.filter((item) => item.clientAttachmentID !== clientAttachmentID)
      },
      clearAfterAdmission: () => {
        spy.cleared += 1
        items = []
      },
      restoreAfterFailure: (snapshot) => {
        spy.restored.push(snapshot)
        items = [...snapshot]
      },
      totalEstimatedTokens: () => items.reduce((sum, item) => sum + item.estimatedTokens, 0),
      pendingCount: () => 0,
    },
  }
  return spy
}

function makeSubmitInput(
  overrides: Partial<Parameters<typeof createPromptSubmit>[0]> = {},
): Parameters<typeof createPromptSubmit>[0] {
  return {
    prompt,
    info: () => ({ id: "session-1" }),
    imageAttachments: () => [],
    commentCount: () => 0,
    autoAccept: () => false,
    mode: () => "normal",
    working: () => false,
    editor: () => undefined,
    queueScroll: () => undefined,
    promptLength: (value: Prompt) =>
      value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
    addToHistory: () => undefined,
    resetHistoryNavigation: () => undefined,
    setMode: () => undefined,
    setPopover: () => undefined,
    ...overrides,
  }
}

const submitEvent = { preventDefault: () => undefined } as unknown as Event

describe("prompt submit message scheduler", () => {
  test("forwards interrupt to the authoritative session endpoint", async () => {
    params = { id: "session-1" }
    const submit = createPromptSubmit(makeSubmitInput())

    expect(await submit.abort()).toBe(true)
    expect(interruptCalls).toEqual(["session-1"])
  })

  test("reports the server response when interrupt is rejected", async () => {
    params = { id: "session-1" }
    failInterrupt = true
    const submit = createPromptSubmit(makeSubmitInput())

    expect(await submit.abort()).toBe(false)
    expect(interruptCalls).toEqual(["session-1"])
    expect(toastCalls.at(-1)?.description).toBe("interrupt-invalid")
  })

  test("cancels a locally pending send without interrupting the server", async () => {
    params = { id: "session-1" }
    WorktreeState.pending(ServerScope.local, "/repo/main")
    const submit = createPromptSubmit(makeSubmitInput())
    const sending = submit.handleSubmit(submitEvent)

    while (optimistic.length === 0) await Promise.resolve()
    expect(await submit.abort()).toBe(true)
    expect(await sending).toBe(false)
    expect(interruptCalls).toHaveLength(0)
    WorktreeState.ready(ServerScope.local, "/repo/main")
  })
})

describe("prompt submit worktree selection", () => {
  test("reads the latest worktree accessor value per submit", async () => {
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)
    selected = "/repo/worktree-b"
    await submit.handleSubmit(event)

    expect(createdClients).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(createdSessions).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(sessionCreateInputs).toEqual([
      {
        agent: "agent",
        model: { id: "model", providerID: "provider", variant: undefined },
        location: { directory: "/repo/worktree-a" },
      },
      {
        agent: "agent",
        model: { id: "model", providerID: "provider", variant: undefined },
        location: { directory: "/repo/worktree-b" },
      },
    ])
    expect(sentShell).toEqual([
      expect.objectContaining({ sessionID: "session-1", id: expect.stringMatching(/^evt_/), command: "ls" }),
      expect.objectContaining({ sessionID: "session-2", id: expect.stringMatching(/^evt_/), command: "ls" }),
    ])
    expect(syncedDirectories).toEqual(["/repo/worktree-a", "/repo/worktree-a", "/repo/worktree-b", "/repo/worktree-b"])
    expect(serverSessionSyncs).toBe(0)
    expect(promoted).toEqual([
      { directory: "/repo/worktree-a", sessionID: "session-1" },
      { directory: "/repo/worktree-b", sessionID: "session-2" },
    ])
    expect(syncedDirectories).toEqual(["/repo/worktree-a", "/repo/worktree-a", "/repo/worktree-b", "/repo/worktree-b"])
  })

  test("applies auto-accept to newly created sessions", async () => {
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => true,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(enabledAutoAccept).toEqual([{ server: "server-a", sessionID: "session-1", directory: "/repo/worktree-a" }])
  })

  test("keeps auto-accept bound to the submission server", async () => {
    let release = () => {}
    createSessionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => true,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const result = submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    permissionServer = "server-b"
    release()
    await result

    expect(enabledAutoAccept).toEqual([{ server: "server-a", sessionID: "session-1", directory: "/repo/worktree-a" }])
  })

  test("promotes drafts using the selected project's server", async () => {
    search = { draftId: "draft-1" }
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(promotedDrafts).toEqual([{ draftID: "draft-1", server: "project-server", sessionId: "session-1" }])
  })

  test("includes the selected variant on optimistic prompts", async () => {
    params = { id: "session-1" }
    variant = "high"

    const submit = createPromptSubmit({
      prompt,
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)
    await Bun.sleep(0)

    expect(optimistic).toHaveLength(1)
    expect(optimistic[0]).toMatchObject({
      message: {
        agent: "agent",
        model: { providerID: "provider", modelID: "model", variant: "high" },
      },
    })
    expect(sentPrompts).toEqual(["/repo/main"])
    expect(promptInputs[0]).toMatchObject({
      sessionID: "session-1",
      text: "ls",
      files: [],
      agents: [],
    })
    expect((promptInputs[0] as { id?: string }).id).toStartWith("msg_")
    expect((promptInputs[0] as { legacyParts?: { id: string; type: string; text?: string }[] }).legacyParts).toEqual([
      { id: expect.stringMatching(/^prt_/), type: "text", text: "ls" },
    ])
  })

  test("submits slash commands through the current session API", async () => {
    params = { id: "session-1" }
    variant = "high"
    commands.push({ name: "review" })
    promptValue = [{ type: "text", content: "/review staged changes", start: 0, end: 22 }]

    const submit = createPromptSubmit({
      prompt,
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(sentCommands).toEqual([
      {
        sessionID: "session-1",
        id: expect.stringMatching(/^msg_/),
        command: "review",
        arguments: "staged changes",
        agent: "agent",
        model: { id: "model", providerID: "provider", variant: "high" },
        files: [],
      },
    ])
    expect(serverSessionSyncs).toBe(0)
  })

  test("uses an injected model selection", async () => {
    params = { id: "session-1" }
    const model = {
      current: () => ({ id: "draft-model", provider: { id: "draft-provider" } }),
      variant: { current: () => "draft-variant" },
    } as unknown as ModelSelection
    const submit = createPromptSubmit({
      prompt,
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      model,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(optimistic[0]).toMatchObject({
      message: {
        model: { providerID: "draft-provider", modelID: "draft-model", variant: "draft-variant" },
      },
    })
  })

  test("seeds new sessions before optimistic prompts are added", async () => {
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(storedSessions["/repo/worktree-a"]).toHaveLength(1)
    expect(storedSessions["/repo/worktree-a"]?.[0]).toMatchObject({ id: "session-1", title: "New session 1" })
    expect(optimisticSeeded).toEqual([true])
  })
})

describe("prompt submit context attachments", () => {
  test("two ready attachments → request carries contextAttachments, no text concat, exactly one prompt call", async () => {
    params = { id: "session-1" }
    const first = makeAttachment({
      contextCapsuleID: "capsule-a",
      label: "Pack A",
      contentHash: "hash-a",
      estimatedTokens: 200,
    })
    const second = makeAttachment({
      contextCapsuleID: "capsule-b",
      label: "Pack B",
      contentHash: "hash-b",
      estimatedTokens: 400,
    })
    const spy = createAttachmentStore([first, second])
    const submit = createPromptSubmit(makeSubmitInput({ contextAttachmentStore: spy.store }))

    await submit.handleSubmit(submitEvent)
    await Bun.sleep(0)

    expect(sentPrompts).toEqual(["/repo/main"])
    expect(promptInputs).toHaveLength(1)
    const request = promptInputs[0] as Record<string, unknown>
    expect(request.text).toBe("ls")
    expect(request.contextAttachments).toEqual([
      {
        contextCapsuleID: "capsule-a",
        label: "Pack A",
        contentHash: "hash-a",
        source: { kind: "ctxpack", ctxPackID: first.source.ctxPackID },
      },
      {
        contextCapsuleID: "capsule-b",
        label: "Pack B",
        contentHash: "hash-b",
        source: { kind: "ctxpack", ctxPackID: second.source.ctxPackID },
      },
    ])
    expect(
      Object.keys((request.contextAttachments as Record<string, unknown>[])[0]!).sort(),
    ).toEqual(["contentHash", "contextCapsuleID", "label", "source"])
    // Success clears both the text (existing clearInput) and the attachments.
    expect(spy.cleared).toBe(1)
    expect(spy.restored).toHaveLength(0)
  })

  test("queue delivery carries the same contextAttachments array", async () => {
    params = { id: "session-1" }
    const first = makeAttachment({ contextCapsuleID: "capsule-a", label: "Pack A", contentHash: "hash-a" })
    const spy = createAttachmentStore([first])
    const submit = createPromptSubmit(makeSubmitInput({ contextAttachmentStore: spy.store }))

    await submit.queueSubmit(submitEvent)
    await Bun.sleep(0)

    expect(promptInputs).toHaveLength(1)
    const request = promptInputs[0] as Record<string, unknown>
    expect(request.delivery).toBe("queue")
    expect(request.contextAttachments).toEqual([
      {
        contextCapsuleID: "capsule-a",
        label: "Pack A",
        contentHash: "hash-a",
        source: { kind: "ctxpack", ctxPackID: first.source.ctxPackID },
      },
    ])
    expect(spy.cleared).toBe(1)
  })

  test("steer delivery carries the same contextAttachments array", async () => {
    params = { id: "session-1" }
    const first = makeAttachment({ contextCapsuleID: "capsule-a", label: "Pack A", contentHash: "hash-a" })
    const spy = createAttachmentStore([first])
    const submit = createPromptSubmit(makeSubmitInput({ contextAttachmentStore: spy.store }))

    await submit.handleSubmit(submitEvent)
    await Bun.sleep(0)

    const request = promptInputs[0] as Record<string, unknown>
    expect(request.delivery).toBe("steer")
    expect(request.contextAttachments).toEqual([
      {
        contextCapsuleID: "capsule-a",
        label: "Pack A",
        contentHash: "hash-a",
        source: { kind: "ctxpack", ctxPackID: first.source.ctxPackID },
      },
    ])
  })

  test("no attachments → the contextAttachments field is omitted entirely", async () => {
    params = { id: "session-1" }
    const submit = createPromptSubmit(makeSubmitInput())

    await submit.handleSubmit(submitEvent)
    await Bun.sleep(0)

    expect(promptInputs).toHaveLength(1)
    expect(promptInputs[0]).not.toHaveProperty("contextAttachments")
  })

  test("custom command path with ready attachments rejects without sending", async () => {
    params = { id: "session-1" }
    commands.push({ name: "review" })
    promptValue = [{ type: "text", content: "/review staged changes", start: 0, end: 22 }]
    const spy = createAttachmentStore([makeAttachment()])
    const submit = createPromptSubmit(makeSubmitInput({ contextAttachmentStore: spy.store }))

    await submit.handleSubmit(submitEvent)

    expect(sentCommands).toHaveLength(0)
    expect(promptInputs).toHaveLength(0)
    expect(spy.cleared).toBe(0)
    expect(spy.restored).toHaveLength(0)
    expect(toastCalls.some((call) => call.title === "Context attachments are not supported for this command")).toBe(
      true,
    )
  })

  test("shell mode with ready attachments rejects without sending", async () => {
    params = { id: "session-1" }
    const spy = createAttachmentStore([makeAttachment()])
    const submit = createPromptSubmit(
      makeSubmitInput({ mode: () => "shell", contextAttachmentStore: spy.store }),
    )

    await submit.handleSubmit(submitEvent)

    expect(sentShell).toHaveLength(0)
    expect(promptInputs).toHaveLength(0)
    expect(spy.cleared).toBe(0)
    expect(toastCalls.some((call) => call.title === "Context attachments are not supported for this command")).toBe(
      true,
    )
  })

  test("only ready attachments are serialized; error drafts are skipped", async () => {
    params = { id: "session-1" }
    const ready = makeAttachment({ contextCapsuleID: "capsule-a", label: "Pack A", contentHash: "hash-a" })
    const failed = makeAttachment({
      contextCapsuleID: "capsule-b",
      label: "Pack B",
      contentHash: "hash-b",
      status: "error",
      errorCode: "materialize-failed",
    })
    const spy = createAttachmentStore([ready, failed])
    const submit = createPromptSubmit(makeSubmitInput({ contextAttachmentStore: spy.store }))

    await submit.handleSubmit(submitEvent)
    await Bun.sleep(0)

    const request = promptInputs[0] as Record<string, unknown>
    expect(request.contextAttachments).toEqual([
      {
        contextCapsuleID: "capsule-a",
        label: "Pack A",
        contentHash: "hash-a",
        source: { kind: "ctxpack", ctxPackID: ready.source.ctxPackID },
      },
    ])
  })

  test("failure restores the send-time snapshot and clears nothing", async () => {
    params = { id: "session-1" }
    failPrompt = true
    const first = makeAttachment()
    const second = makeAttachment()
    const spy = createAttachmentStore([first, second])
    const submit = createPromptSubmit(makeSubmitInput({ contextAttachmentStore: spy.store }))

    await submit.handleSubmit(submitEvent)
    await Bun.sleep(0)

    expect(spy.restored).toHaveLength(1)
    expect(spy.restored[0]).toEqual([first, second])
    expect(spy.cleared).toBe(0)
    // Exactly one admission attempt was made.
    expect(promptInputs).toHaveLength(1)
  })

  test("successful admission after a failed one clears the attachments", async () => {
    params = { id: "session-1" }
    const spy = createAttachmentStore([makeAttachment()])
    const submit = createPromptSubmit(makeSubmitInput({ contextAttachmentStore: spy.store }))

    await submit.handleSubmit(submitEvent)
    await Bun.sleep(0)
    expect(spy.cleared).toBe(1)

    await submit.handleSubmit(submitEvent)
    await Bun.sleep(0)
    expect(promptInputs).toHaveLength(2)
    expect(spy.cleared).toBe(2)
  })
})
