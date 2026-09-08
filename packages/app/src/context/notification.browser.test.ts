import { afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { ServerEvent } from "./server-sdk"
import { ServerScope } from "@/utils/server-scope"

const toasts: unknown[] = []
const disposers: Array<() => void> = []
let notification: typeof import("./notification")

beforeAll(async () => {
  mock.module("@/utils/toast", () => ({ showToast: (options: unknown) => toasts.push(options) }))
  const persist = await import("@/utils/persist")
  mock.module("@/utils/persist", () => ({
    ...persist,
    persisted: (_target: unknown, store: unknown[]) => [...store, undefined, () => true],
  }))
  notification = await import("./notification")
})

beforeEach(() => {
  toasts.length = 0
})

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
})

function setup(input: { active?: boolean; route?: string; parentID?: string } = {}) {
  return createRoot((dispose) => {
    disposers.push(dispose)
    const events = createGlobalEmitter<{ [key: string]: ServerEvent }>()
    const session: Session = {
      id: "master",
      parentID: input.parentID,
      slug: "master",
      projectID: "project",
      directory: "/repo",
      title: "MasterAgent",
      version: "1",
      time: { created: 1, updated: 1 },
    }
    type Input = Parameters<typeof notification.createServerNotificationState>[0]
    const state = notification.createServerNotificationState({
      sdk: { scope: ServerScope.local, event: events } as unknown as Input["sdk"],
      sync: {
        ensureDirSyncContext: () => ({ session: { get: () => session } }),
      } as unknown as Input["sync"],
      active: () => input.active ?? true,
      directory: () => (input.route ? "/repo" : undefined),
      sessionID: () => input.route,
      platform: { notify: async () => {} } as unknown as Input["platform"],
      settings: {
        sounds: { errorsEnabled: () => false },
        notifications: { errors: () => false },
      } as unknown as Input["settings"],
      language: { t: (key: string) => `localized:${key}` } as Input["language"],
      navigate: () => {},
    })
    return { events, state }
  })
}

test.each(["master", undefined])("shows a preflight error for a route or bound canvas session (%s)", async (route) => {
  const context = setup({ route })
  context.events.emit("/repo", {
    id: "error-event",
    type: "session.error",
    properties: {
      sessionID: "master",
      error: { name: "UnknownError", data: { message: "Model unavailable: test/test-model" } },
    },
  })
  await Promise.resolve()
  expect(toasts).toEqual([
    {
      variant: "error",
      title: "localized:notification.session.error.title",
      description: "Model unavailable: test/test-model",
    },
  ])
  expect(context.state.session.all("master")).toHaveLength(1)
})

test.each([{ active: false }, { parentID: "parent" }])(
  "does not add a toast for inactive servers or child sessions (%j)",
  async (input) => {
    const context = setup(input)
    context.events.emit("/repo", {
      id: "error-event",
      type: "session.error",
      properties: {
        sessionID: "master",
        error: { name: "UnknownError", data: { message: "Model unavailable" } },
      },
    })
    await Promise.resolve()
    expect(toasts).toEqual([])
  },
)

test("uses the existing localized fallback when an error has no message", async () => {
  const context = setup()
  context.events.emit("/repo", {
    id: "error-event",
    type: "session.error",
    properties: { sessionID: "master", error: { name: "MessageOutputLengthError", data: {} } },
  })
  await Promise.resolve()
  expect(toasts).toEqual([
    {
      variant: "error",
      title: "localized:notification.session.error.title",
      description: "localized:notification.session.error.fallbackDescription",
    },
  ])
})
