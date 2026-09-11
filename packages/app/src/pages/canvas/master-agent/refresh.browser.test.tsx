import { afterEach, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { createComponent, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import type { RuntimeBlockHandle } from "../runtime/contracts"
import type { CanvasSessionSurfaceProps } from "../session-target"
import type { MasterAgentManagerApi } from "./block"

const requirePlugin = createRequire(import.meta.resolve("vite-plugin-solid"))
const babel = requirePlugin("@babel/core") as {
  transformSync(source: string, options: Record<string, unknown>): { code: string }
}
await Bun.plugin({
  name: "master-refresh-solid-test",
  setup(build) {
    build.onLoad({ filter: /master-agent[\\/](block|block-shell|status-view)\.tsx$/ }, async (args) => ({
      contents: babel.transformSync(await Bun.file(args.path).text(), {
        filename: args.path,
        presets: [
          [requirePlugin("babel-preset-solid"), { generate: "dom" }],
          requirePlugin("@babel/preset-typescript"),
        ],
      }).code,
      loader: "js",
    }))
  },
})

let runtime: RuntimeBlockHandle
let mounts = 0
let disposals = 0
mock.module("../runtime/block-runtime-host", () => ({ useBlockRuntimeHandle: () => runtime }))
mock.module("../session-surface-providers", () => ({
  CanvasSessionSurfaceProviders: (props: { children: unknown }) => props.children,
}))
mock.module("@/context/server-sync", () => ({
  useServerSync: () => () => ({ session: { data: { session_working: () => false } } }),
}))
mock.module("../session-surface", () => ({
  CanvasSessionSurface: (props: CanvasSessionSurfaceProps) => {
    mounts += 1
    const element = document.createElement("textarea")
    element.value = "draft with attached plan"
    element.dataset.session = props.target.sessionID
    onCleanup(() => {
      disposals += 1
    })
    return element
  },
}))
const { MasterAgentBlock } = await import("./block")
const dispose: VoidFunction[] = []
afterEach(() => {
  dispose.splice(0).forEach((run) => run())
  document.body.replaceChildren()
  mounts = 0
  disposals = 0
})

test("keeps the mounted composer and attachments when a bound Master session refreshes before sending", () => {
  const [state, setState] = createStore({ status: "ready" as "ready" | "resolving", sessionID: "ses_master" })
  runtime = {
    status: () => state.status,
    view: () => ({
      status: "ready",
      workspaceID: "workspace",
      sessionID: state.sessionID,
      directory: "/repo",
      coder: null,
      queueEnabled: true,
    }),
  } as RuntimeBlockHandle
  const host = document.createElement("div")
  document.body.append(host)
  dispose.push(
    render(
      () =>
        createComponent(MasterAgentBlock, {
          blockID: "master",
          focused: true,
          onFocus: () => {},
          manager: {} as MasterAgentManagerApi,
        }),
      host,
    ),
  )
  const editor = host.querySelector("textarea")!
  expect(editor.value).toBe("draft with attached plan")
  setState("status", "resolving")
  expect(editor.isConnected).toBe(true)
  expect(host.querySelector(".master-agent-shell")?.getAttribute("data-status")).toBe("ready")
  setState("status", "ready")
  expect(host.querySelector("textarea") === editor).toBe(true)
  expect(mounts).toBe(1)
  expect(disposals).toBe(0)
})
