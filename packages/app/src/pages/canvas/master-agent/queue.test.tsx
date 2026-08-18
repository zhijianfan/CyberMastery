// Track Q1 — Queue integration tests. Drives the existing composer submission
// path (createPromptSubmit) and verifies that the MasterAgent session options
// enable its queue action: while busy the composer queue action submits through
// the existing handleSubmit(event, "queue") path, which immediately admits the
// input to the host with delivery: "queue". Steer stays the default, and the
// options keep no block-local or browser-held queue state.

import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createStore, type SetStoreFunction } from "solid-js/store"
import type { Prompt, PromptStore } from "@/context/prompt"
import { createMasterAgentSessionOptions } from "./session-options"

let createPromptSubmit: typeof import("@/components/prompt-input/submit").createPromptSubmit

type HostAdmission = { sessionID?: string; delivery?: "steer" | "queue"; id?: string }

const admitted: HostAdmission[] = []
const optimistic: unknown[] = []
const storedSessions: Record<string, Array<{ id: string }>> = {}
const syncedDirectories: string[] = []

let params: { id?: string } = {}

let promptValue: Prompt = [{ type: "text", content: "finish the review", start: 0, end: 17 }]
const [promptStore] = createStore<PromptStore>({
  prompt: promptValue,
  cursor: 0,
  context: { items: [] },
})
const prompt = {
  store: [() => promptStore, () => undefined] as [() => PromptStore, SetStoreFunction<PromptStore>],
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

const clientFor = (directory: string) => ({
  api: {
    session: {
      prompt: async (input: HostAdmission) => {
        admitted.push(input)
        return { data: undefined }
      },
      command: async () => undefined,
      shell: async () => undefined,
    },
  },
  session: {
    command: async () => ({ data: undefined }),
    abort: async () => ({ data: undefined }),
  },
  worktree: {
    create: async () => ({ data: { directory: `${directory}/new` } }),
  },
})

beforeAll(async () => {
  const rootClient = clientFor("/repo/main")

  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => params,
    useLocation: () => ({}),
    useSearchParams: () => [{}, () => undefined],
  }))

  mock.module("@opencode-ai/sdk/v2/client", () => ({
    createOpencodeClient: (input: { directory: string }) => clientFor(input.directory),
  }))

  mock.module("@/utils/toast", () => ({
    showToast: () => undefined,
  }))

  mock.module("@opencode-ai/ui/toast", () => ({
    Toast: { Region: () => null },
    showToast: () => 0,
  }))

  mock.module("@/context/local", () => ({
    useLocal: () => ({
      model: {
        current: () => ({ id: "model", provider: { id: "provider" } }),
        variant: { current: () => undefined },
      },
      agent: { current: () => ({ name: "agent" }) },
      session: { promote: () => undefined },
    }),
  }))

  mock.module("@/context/permission", () => ({
    usePermission: () => ({
      currentServerState: () => ({ enableAutoAccept: () => undefined }),
    }),
  }))

  mock.module("@/context/server", () => ({
    useServer: () => ({ key: "server-key" }),
  }))

  mock.module("@/context/tabs", () => ({
    useTabs: () => ({
      draft: () => ({ server: "project-server" }),
      promoteDraft: () => undefined,
    }),
  }))

  mock.module("@/context/prompt", () => ({
    usePrompt: () => prompt,
  }))

  mock.module("@/context/layout", () => ({
    useLayout: () => ({
      handoff: { setTabs: () => undefined },
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
        createClient: (opts: { directory: string }) => clientFor(opts.directory),
      }
      return () => sdk
    },
  }))

  mock.module("@/context/sync", () => ({
    useSync: () => () => ({
      data: { command: [] },
      session: {
        optimistic: {
          add: (value: unknown) => {
            optimistic.push(value)
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
        sync: async () => undefined,
      },
      child: (directory: string) => {
        syncedDirectories.push(directory)
        storedSessions[directory] ??= []
        return [{ session: storedSessions[directory] }, () => undefined]
      },
    }),
  }))

  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string) => key,
    }),
  }))

  const submit = await import("@/components/prompt-input/submit")
  createPromptSubmit = submit.createPromptSubmit
})

beforeEach(() => {
  admitted.length = 0
  optimistic.length = 0
  params = {}
  promptValue = [{ type: "text", content: "finish the review", start: 0, end: 17 }]
  for (const key of Object.keys(storedSessions)) delete storedSessions[key]
  syncedDirectories.length = 0
})

function createSubmit() {
  return createPromptSubmit({
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
}

const submitEvent = { preventDefault: () => undefined } as unknown as Event

describe("createMasterAgentSessionOptions", () => {
  test("exposes queueEnabled and the explicit session target", () => {
    const options = createMasterAgentSessionOptions({
      sessionID: "session-1",
      directory: "/repo/main",
      workspaceID: "ws-1",
    })
    expect(options.queueEnabled).toBe(true)
    expect(options.target).toEqual({ sessionID: "session-1", directory: "/repo/main", workspaceID: "ws-1" })
  })

  test("omits optional target fields when absent", () => {
    const options = createMasterAgentSessionOptions({ sessionID: "session-2" })
    expect(options.target).toEqual({ sessionID: "session-2" })
  })

  test("exposes the queue action only while the session is busy", () => {
    const options = createMasterAgentSessionOptions({ sessionID: "session-1" })
    expect(options.queue(true)).toBe(true)
    expect(options.queue(false)).toBe(false)
  })

  test("is stateless: a remount builds equivalent options with no held inputs", () => {
    const first = createMasterAgentSessionOptions({ sessionID: "session-1" })
    const second = createMasterAgentSessionOptions({ sessionID: "session-1" })
    expect(second).not.toBe(first)
    expect(second.target).toEqual(first.target)
    expect(second.queueEnabled).toBe(first.queueEnabled)
    expect(second.queue(true)).toBe(first.queue(true))
    expect(second.queue(false)).toBe(first.queue(false))
    expect(Object.keys(first).sort()).toEqual(["queue", "queueEnabled", "target"])
  })

  test("source defines no browser or block-local holding queue", async () => {
    const source = await Bun.file(new URL("./session-options.ts", import.meta.url)).text()
    const forbidden = [
      "local" + "Storage",
      "indexed" + "DB",
      "session" + "Storage",
      "set" + "Timeout",
      "set" + "Interval",
      "followup" + "Queue",
      "client" + "Queue",
      "holding" + "Queue",
    ]
    for (const token of forbidden) expect(source).not.toContain(token)
  })
})

describe("queue admission through the existing composer path", () => {
  test("a busy embedded session sends delivery queue to the host immediately", async () => {
    params = { id: "session-1" }
    const options = createMasterAgentSessionOptions({ sessionID: "session-1", directory: "/repo/main" })
    const submit = createSubmit()

    if (options.queue(true)) await submit.queueSubmit(submitEvent)
    await Bun.sleep(0)

    expect(admitted).toHaveLength(1)
    expect(admitted[0]).toMatchObject({ sessionID: "session-1", delivery: "queue" })
  })

  test("the queue action stays hidden while the session is idle", () => {
    const options = createMasterAgentSessionOptions({ sessionID: "session-1" })
    expect(options.queue(false)).toBe(false)
  })

  test("steer submission remains unchanged", async () => {
    params = { id: "session-1" }
    const submit = createSubmit()

    await submit.handleSubmit(submitEvent)
    await Bun.sleep(0)

    expect(admitted).toHaveLength(1)
    expect(admitted[0]).toMatchObject({ sessionID: "session-1", delivery: "steer" })
  })

  test("remount with a pre-existing host-admitted input admits nothing new", async () => {
    params = { id: "session-1" }
    const submit = createSubmit()

    await submit.queueSubmit(submitEvent)
    await Bun.sleep(0)
    expect(admitted).toHaveLength(1)
    expect(admitted[0]).toMatchObject({ sessionID: "session-1", delivery: "queue" })

    const remounted = createMasterAgentSessionOptions({
      sessionID: "session-1",
      directory: "/repo/main",
      workspaceID: "ws-1",
    })
    expect(remounted.queueEnabled).toBe(true)
    expect(remounted.queue(true)).toBe(true)
    expect(admitted).toHaveLength(1)
    expect(admitted[0]).toMatchObject({ sessionID: "session-1", delivery: "queue" })
  })

  test("queued inputs project from host admission, not from the block options", async () => {
    params = { id: "session-1" }
    const options = createMasterAgentSessionOptions({ sessionID: "session-1" })
    const submit = createSubmit()

    expect(admitted).toHaveLength(0)
    await submit.queueSubmit(submitEvent)
    await Bun.sleep(0)

    expect(Object.keys(options).sort()).toEqual(["queue", "queueEnabled", "target"])
    expect(admitted).toHaveLength(1)
    expect(admitted[0]).toMatchObject({ delivery: "queue", id: expect.stringMatching(/^msg_/) })
  })
})
