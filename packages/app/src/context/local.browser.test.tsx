import { afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test"
import { createComponent, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import h from "solid-js/h"
import { render } from "solid-js/web"
import type { Session } from "@opencode-ai/sdk/v2/client"

// Bun's JSX transform needs the same Solid hyperscript bridge as the canvas suites.
;(globalThis as unknown as { React: unknown }).React = {
  createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
    if (typeof tag === "string") return h(tag as never, props as never, ...children)
    return createComponent(tag as never, { ...props, children: children.length === 1 ? children[0] : children })
  },
}

const [route, setRoute] = createStore<{ id?: string }>({})
const [sessions, setSessions] = createStore<Record<string, Session>>({})
const workspaceSelections: Array<string | undefined> = []
const provider = {
  id: "test",
  models: {
    qwen: { id: "qwen", name: "Qwen", variants: {} },
    terra: { id: "terra", name: "Terra", variants: { high: {}, low: {} } },
    coder: { id: "coder", name: "Coder", variants: {} },
  },
}
const available = Object.values(provider.models).map((model) => ({ ...model, provider }))
const disposers: Array<() => void> = []
let localModule: typeof import("./local")

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({ useParams: () => route }))
  mock.module("./sdk", () => ({ useSDK: () => () => ({ directory: "/repo" }) }))
  mock.module("./server-sdk", () => ({ useServerSDK: () => () => ({ scope: "local" }) }))
  mock.module("./sync", () => ({
    useSync: () => () => ({
      data: {
        agent: [
          { name: "build", mode: "primary", native: true },
          { name: "parallel-master", mode: "primary", native: true, hidden: true },
        ],
        config: {},
      },
      session: { get: (id: string) => sessions[id] },
    }),
  }))
  mock.module("./settings", () => ({ useSettings: () => ({ visibility: { customAgents: () => false } }) }))
  mock.module("./workspace", () => ({
    useWorkspace: () => ({
      operatingAgent: () => "test/qwen",
      setOperatingAgent: (value: string | undefined) => workspaceSelections.push(value),
    }),
  }))
  mock.module("@/hooks/use-providers", () => ({
    useProviders: () => ({
      all: () => new Map([[provider.id, provider]]),
      connected: () => [provider],
      default: () => ({ test: "qwen" }),
      defaultModel: () => undefined,
    }),
  }))
  mock.module("./models", () => ({
    useModels: () => ({
      ready: () => true,
      find: (key: { providerID: string; modelID: string }) =>
        available.find((model) => model.id === key.modelID && model.provider.id === key.providerID),
      list: () => available,
      recent: { list: () => [], push: () => {} },
      variant: { get: () => undefined, set: () => {} },
      setVisibility: () => {},
    }),
  }))
  mock.module("@/utils/persist", () => ({
    Persist: { serverWorkspace: () => ({}) },
    persisted: (_target: unknown, store: unknown[]) => [...store, undefined, () => true],
  }))
  localModule = await import("./local")
})

beforeEach(() => {
  setRoute("id", undefined)
  workspaceSelections.length = 0
})

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
})

function session(id: string, agent: string, modelID: string): Session {
  return {
    id,
    agent,
    model: { providerID: "test", id: modelID, variant: modelID === "terra" ? "high" : undefined },
    slug: id,
    projectID: "project",
    directory: "/repo",
    title: id,
    version: "1",
    time: { created: 1, updated: 1 },
  }
}

function mount(sessionID?: Accessor<string | undefined>) {
  let local: ReturnType<typeof localModule.useLocal> | undefined
  disposers.push(
    render(
      () =>
        createComponent(localModule.LocalProvider, {
          sessionID,
          children: (() => {
            local = localModule.useLocal()
            return null
          }) as unknown as JSX.Element,
        }),
      document.createElement("div"),
    ),
  )
  if (!local) throw new Error("Local provider did not initialize")
  return local
}

test("bound canvas sessions display their own stored agent, model and variant", async () => {
  setRoute("id", "unrelated-route")
  setSessions("master", session("master", "parallel-master", "terra"))
  setSessions("coder", session("coder", "build", "coder"))
  const master = mount(() => "master")
  const coder = mount(() => "coder")

  expect(master.session.bound?.()).toBeTrue()
  expect(master.agent.current()?.name).toBe("parallel-master")
  expect(master.agent.list().map((agent) => agent.name)).toEqual(["build"])
  expect(master.model.current()?.id).toBe("terra")
  expect(master.model.variant.current()).toBe("high")
  expect(coder.agent.current()?.name).toBe("build")
  expect(coder.model.current()?.id).toBe("coder")

  master.model.set({ providerID: "test", modelID: "qwen" })
  master.model.variant.set("low")
  master.agent.set("build")
  await Promise.resolve()
  expect(master.model.current()?.id).toBe("terra")
  expect(master.agent.current()?.name).toBe("parallel-master")
  expect(master.model.variant.current()).toBe("high")
  expect(workspaceSelections).toEqual([])

  setSessions("master", "model", { providerID: "test", id: "coder" })
  expect(master.model.current()?.id).toBe("coder")
})

test("unbound local selection still restores the route session", () => {
  setRoute("id", "route-session")
  const local = mount(() => undefined)
  expect(local.session.bound?.()).toBeFalse()
  local.session.restore({
    sessionID: "route-session",
    agent: "build",
    model: { providerID: "test", modelID: "terra" },
  })
  expect(local.model.current()?.id).toBe("terra")
  local.session.restore({
    sessionID: "another-session",
    agent: "build",
    model: { providerID: "test", modelID: "coder" },
  })
  expect(local.model.current()?.id).toBe("terra")
})

test("a new-session selection still updates the workspace default", async () => {
  const local = mount()
  expect(local.model.current()?.id).toBe("qwen")
  local.model.set({ providerID: "test", modelID: "terra" })
  await Promise.resolve()
  expect(local.model.current()?.id).toBe("terra")
  expect(workspaceSelections).toEqual(["test/terra"])
})
