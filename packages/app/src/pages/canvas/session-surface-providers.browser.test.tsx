import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import { createComponent, createSignal, type ParentProps } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import { createTabMemory } from "@/context/tab-memory"
import type { Tab } from "@/context/tabs"
import type { usePrompt } from "@/context/prompt"
import type { useComments } from "@/context/comments"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length) next.children = children.length === 1 ? children[0] : children
  return () => createComponent(tag as never, next)
}

// Bun's classic JSX transform needs Solid's component creation at this boundary.
Object.assign(globalThis, { React: { createElement } })

let newLayout = false
let draftID = ""
const memory = createTabMemory(null)
const directory = "D:/canvas-drafts"
const passthrough = (props: ParentProps) => props.children

mock.module("@solidjs/router", () => ({
  useParams: () => ({ id: "route-session" }),
  useSearchParams: () => [
    {
      get draftId() {
        return draftID
      },
    },
    () => {},
  ],
}))
mock.module("@/context/server", () => ({
  useServer: () => ({ key: "local" }),
  ServerConnection: { key: () => "local" },
}))
mock.module("@/context/server-sync", () => ({
  useServerSync: () => () => ({ session: { bindV2: () => {} } }),
}))
mock.module("@/context/server-sdk", () => ({
  useServerSDK: () => () => ({
    scope: "local",
    server: { type: "http", http: { url: "http://localhost:4096" } },
    ensureDirSdkContext: (directory: string) => ({ directory }),
  }),
}))
mock.module("@/context/platform", () => ({ usePlatform: () => ({ platform: "web" }) }))
mock.module("@/context/settings", () => ({
  useSettings: () => ({ general: { newLayoutDesigns: () => newLayout } }),
}))
mock.module("@/context/tabs", () => ({
  useTabs: () => ({
    store: [],
    state: <T,>(tab: Tab, name: string, init: () => T) => memory.ensure(JSON.stringify(tab), name, init),
  }),
}))
mock.module("@/pages/directory-layout", () => ({ DirectoryDataProvider: passthrough }))
mock.module("@/context/file", () => ({ FileProvider: passthrough }))

let providers: typeof import("./session-surface-providers")
let prompt: typeof import("@/context/prompt")
let comments: typeof import("@/context/comments")
const disposers: VoidFunction[] = []

beforeAll(async () => {
  prompt = await import("@/context/prompt")
  comments = await import("@/context/comments")
  providers = await import("./session-surface-providers")
})

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  memory.dispose()
  document.body.innerHTML = ""
})

function mount(binding: string | (() => { directory: string; sessionID: string })) {
  const host = document.createElement("div")
  document.body.append(host)
  const observed: ReturnType<typeof usePrompt>[] = []
  const annotations: ReturnType<typeof useComments>[] = []
  const capture = () => {
    observed.push(prompt.usePrompt())
    annotations.push(comments.useComments())
    return null
  }
  const dispose = render(
    () =>
      createComponent(providers.CanvasSessionSurfaceProviders, {
        get directory() {
          return typeof binding === "string" ? directory : binding().directory
        },
        get sessionID() {
          return typeof binding === "string" ? binding : binding().sessionID
        },
        children: capture as unknown as ParentProps["children"],
      }),
    host,
  )
  disposers.push(dispose)
  return { current: () => observed.at(-1)!, comments: () => annotations.at(-1)!, dispose }
}

function text(value: string) {
  return [{ type: "text" as const, content: value, start: 0, end: value.length }]
}

describe("canvas session drafts", () => {
  test.each([false, true])(
    "restores each bound session's own draft in one directory (new layout: %s)",
    async (layout) => {
      newLayout = layout
      draftID = `route-independent-${layout}`
      const first = mount(`session-first-${layout}`)
      const second = mount(`session-second-${layout}`)
      await Promise.all([first.current().ready.promise, second.current().ready.promise])
      first.current().set(text("Operating draft"))
      first.current().model.set({ providerID: "provider", modelID: "operating" })
      first.current().context.add({ type: "file", path: "/operating.ts" })
      second.current().set(text("Master draft"))
      await Promise.resolve()
      first.dispose()
      second.dispose()
      memory.dispose()

      const restored = mount(`session-first-${layout}`)
      const sibling = mount(`session-second-${layout}`)
      await Promise.all([restored.current().ready.promise, sibling.current().ready.promise])
      expect(restored.current().capture().current()).toEqual(text("Operating draft"))
      expect(restored.current().capture().model.current()?.modelID).toBe("operating")
      expect(
        restored
          .current()
          .capture()
          .context.items()
          .map((item) => item.path),
      ).toEqual(["/operating.ts"])
      expect(sibling.current().capture().current()).toEqual(text("Master draft"))
      expect(sibling.current().capture().context.items()).toEqual([])
    },
  )

  test("refreshing the same binding preserves the mounted composer", async () => {
    newLayout = false
    draftID = "route-refresh"
    const [view, setView] = createSignal({ directory, sessionID: "session-refresh", revision: 0 })
    const first = mount(view)
    await first.current().ready.promise
    const current = first.current()
    first.current().set(text("Draft during model synchronization"))

    setView({ ...view(), revision: 1 })

    expect(first.current()).toBe(current)
    expect(first.current().capture().current()).toEqual(text("Draft during model synchronization"))
  })

  test("replacing one binding starts a fresh draft and preserves the sibling", async () => {
    newLayout = false
    draftID = "route-reset"
    const [view, setView] = createSignal({ directory, sessionID: "session-before-reset" })
    const first = mount(view)
    const sibling = mount("session-reset-sibling")
    await Promise.all([first.current().ready.promise, sibling.current().ready.promise])
    first.current().set(text("Old conversation draft"))
    sibling.current().set(text("Keep sibling draft"))
    setView({ directory, sessionID: "session-after-reset" })
    await first.current().ready.promise

    expect(first.current().capture().current()).toEqual(text(""))
    expect(sibling.current().capture().current()).toEqual(text("Keep sibling draft"))
  })

  test("restores each bound session's own file comments", async () => {
    newLayout = false
    draftID = "route-comments"
    const first = mount("session-comments-operating")
    const sibling = mount("session-comments-master")
    await Promise.all([first.current().ready.promise, sibling.current().ready.promise])
    first.comments().add({ file: "/operating.ts", selection: { start: 1, end: 2 }, comment: "Operating context" })
    sibling.comments().add({ file: "/master.ts", selection: { start: 3, end: 4 }, comment: "Master context" })
    await Promise.resolve()
    first.dispose()
    sibling.dispose()

    const restored = mount("session-comments-operating")
    const other = mount("session-comments-master")
    const replacement = mount("session-comments-after-reset")
    await Promise.all([
      restored.current().ready.promise,
      other.current().ready.promise,
      replacement.current().ready.promise,
    ])
    expect(
      restored
        .comments()
        .all()
        .map((comment) => [comment.file, comment.comment]),
    ).toEqual([["/operating.ts", "Operating context"]])
    expect(
      other
        .comments()
        .all()
        .map((comment) => [comment.file, comment.comment]),
    ).toEqual([["/master.ts", "Master context"]])
    expect(replacement.comments().all()).toEqual([])
  })
})
