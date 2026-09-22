import { afterEach, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { CanvasTab } from "@opencode-ai/schema/canvas-tab"
import { Workspace } from "@opencode-ai/schema/workspace"
import { createCanvasTabController, type CanvasTabClient } from "./canvas-tab-controller"

const disposers: VoidFunction[] = []
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()))
const entry = (id: string, createdAt = 1): CanvasTab.Entry => ({
  id,
  workspaceID: Workspace.ID.make("wrk_test"),
  kind: "master-agent",
  blockID: "block",
  conversationID: `session-${id}`,
  title: id,
  createdAt,
  writable: true,
})

function setup() {
  const [view, setView] = createSignal({ workspaceID: "wrk_test", blockID: "block" })
  let selected = entry("original")
  let items = [selected]
  let revision = 1
  let failCreate = false
  let failSelect = false
  const requests: string[] = []
  const client: CanvasTabClient = {
    listOwned: async () => ({ items, selectedTabID: selected.id, revision, bindingRevision: revision, next: null }),
    listArchived: async () => ({ items: [entry("archived", 0)], next: null }),
    create: async (input) => {
      requests.push(input.requestID)
      selected = entry(input.requestID, 2)
      items = [selected, ...items]
      revision++
      if (failCreate) throw new TypeError("response lost")
      return { selected, revision, bindingRevision: revision }
    },
    select: async (input) => {
      if (failSelect) throw new Error("busy")
      selected = items.find((item) => item.id === input.tabID)!
      return { selected, revision: ++revision, bindingRevision: revision }
    },
    restore: async (input) => {
      selected = entry(input.tabID)
      items = [selected, ...items]
      return { selected, revision: ++revision, bindingRevision: revision }
    },
  }
  const tabs = createRoot((dispose) => {
    disposers.push(dispose)
    return createCanvasTabController(
      () => view().workspaceID,
      "master-agent",
      () => view().blockID,
      () => client,
    )
  })
  return {
    tabs,
    client,
    requests,
    setView,
    failCreate: () => {
      failCreate = true
    },
    failSelect: () => {
      failSelect = true
    },
  }
}

test("same-identity runtime refresh preserves selection, pending mutation and request identity", async () => {
  const { tabs, client, setView } = setup()
  await tabs.retry()
  const attempts: string[] = []
  const gate = Promise.withResolvers<void>()
  client.create = async (input) => {
    attempts.push(input.requestID)
    await gate.promise
    throw new Error("response lost")
  }
  const pending = tabs.create()
  setView({ workspaceID: "wrk_test", blockID: "block" })
  expect(tabs.selected()?.conversationID).toBe("session-original")
  expect(tabs.pending()).toBe(true)
  expect(tabs.loading()).toBe(false)
  await tabs.create()
  expect(attempts).toHaveLength(1)
  gate.resolve()
  await pending
  setView({ workspaceID: "wrk_test", blockID: "block" })
  await tabs.create()
  expect(attempts).toHaveLength(2)
  expect(attempts[1]).toBe(attempts[0])
})

test("a different block clears the previous selection until its own list arrives", async () => {
  const { tabs, client, setView } = setup()
  await tabs.retry()
  const gate = Promise.withResolvers<Awaited<ReturnType<CanvasTabClient["listOwned"]>>>()
  client.listOwned = () => gate.promise
  setView({ workspaceID: "wrk_test", blockID: "other" })
  expect(tabs.selectedID()).toBeUndefined()
  expect(tabs.owned()).toEqual([])
  gate.resolve({ items: [], next: null, selectedTabID: null, revision: 0, bindingRevision: 0 })
  await tabs.retry()
  expect(tabs.loading()).toBe(false)
})

test("creates with a UUID request identity, selects older writable sessions, and restores archives", async () => {
  const { tabs, requests } = setup()
  await tabs.retry()
  await tabs.create()
  expect(requests[0]).toMatch(/^[0-9a-f-]{36}$/)
  expect(tabs.selected()?.conversationID).toBe(`session-${requests[0]}`)
  await tabs.select(entry("original"))
  expect(tabs.selected()?.conversationID).toBe("session-original")
  expect(tabs.selected()?.writable).toBe(true)
  await tabs.restore(entry("archived"))
  expect(tabs.selectedID()).toBe("archived")
  expect(tabs.owned().some((item) => item.id === "original")).toBe(true)
})

test("reconciles a lost create response by its request identity without creating twice", async () => {
  const { tabs, requests, failCreate } = setup()
  await tabs.retry()
  failCreate()
  await tabs.create()
  expect(tabs.selectedID()).toBe(requests[0])
  expect(tabs.error()).toBeUndefined()
  await tabs.retry()
  expect(requests).toHaveLength(1)
})

test("a failed selection keeps the previous conversation mounted and reports the error", async () => {
  const { tabs, failSelect } = setup()
  await tabs.retry()
  failSelect()
  await tabs.select(entry("other"))
  expect(tabs.selected()?.conversationID).toBe("session-original")
  expect(tabs.error()).toBeDefined()
})

test("reload resolves an older selected tab without consuming the history pagination cursor", async () => {
  const { tabs, client } = setup()
  await tabs.retry()
  const cursor = { createdAt: 2, id: "newest" }
  client.listOwned = async (input) =>
    input.cursor
      ? { items: [entry("older")], selectedTabID: "older", revision: 2, next: null }
      : { items: [entry("newest", 2)], selectedTabID: "older", revision: 2, next: cursor }
  await tabs.retry()
  expect(tabs.selected()?.conversationID).toBe("session-older")
  expect(tabs.owned().map((item) => item.id)).toEqual(["newest", "older"])
  await tabs.loadMore()
  expect(tabs.owned()).toHaveLength(2)
})

test("failed history queries keep the visible tabs and active conversation", async () => {
  const { tabs, client } = setup()
  await tabs.retry()
  client.listArchived = async () => {
    throw new Error("offline")
  }
  await tabs.retry()
  expect(tabs.selected()?.conversationID).toBe("session-original")
  expect(tabs.owned()).toHaveLength(1)
  expect(tabs.error()).toBeDefined()
})
