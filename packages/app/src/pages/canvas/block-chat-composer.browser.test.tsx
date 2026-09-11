import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { createComponent, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { createPromptState, type Prompt } from "@/context/prompt-state"
import type { ContextAttachmentDraft } from "@/context/ctxpack/attachment-store"
import type { BlockChatComposerProps } from "./block-chat-composer"
import { dict } from "@/i18n/en"

const pluginRequire = createRequire(import.meta.resolve("vite-plugin-solid"))
const babel = pluginRequire("@babel/core") as {
  transformSync(source: string, options: Record<string, unknown>): { code: string }
}
await Bun.plugin({
  name: "block-plan-composer-solid-test",
  setup(build) {
    build.onLoad({ filter: /block-chat-composer\.tsx$/ }, async (args) => ({
      contents: babel.transformSync(await Bun.file(args.path).text(), {
        filename: args.path,
        presets: [
          [pluginRequire("babel-preset-solid"), { generate: "dom" }],
          pluginRequire("@babel/preset-typescript"),
        ],
      }).code,
      loader: "js",
    }))
  },
})

function fixture() {
  const prompt = createPromptState()
  const [state, setState] = createStore({ working: false, pending: 0, attachments: [] as ContextAttachmentDraft[] })
  return { prompt, state, setState, calls: 0, submitted: [] as Prompt[] }
}
let active: ReturnType<typeof fixture>
mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (key: keyof typeof dict) => dict[key] }) }))
mock.module("@/context/prompt", () => ({ usePrompt: () => active.prompt }))
mock.module("@/context/ctxpack/attachment-store", () => ({
  useContextAttachmentStore: () => {
    const current = active
    return { attachments: () => current.state.attachments, pendingCount: () => current.state.pending }
  },
}))
mock.module("@/context/sync", () => ({
  useSync: () => {
    const current = active
    return () => ({ data: { session_working: () => current.state.working } })
  },
}))
mock.module("@/components/prompt-input-v2", () => ({
  PromptInputV2Composer: () => document.createElement("textarea"),
  usePromptInputV2Controller: (props: { beforeSubmit?: () => Promise<void> }) => {
    const current = active
    return {
      submit: () => {
        current.calls += 1
        const snapshot = current.prompt.current()
        void Promise.resolve(props.beforeSubmit?.()).then(
          () => current.submitted.push(snapshot),
          () => {},
        )
      },
    }
  },
}))

const plan: ContextAttachmentDraft = {
  clientAttachmentID: "attachment",
  kind: "context-capsule",
  contextCapsuleID: "capsule",
  source: { kind: "ctxpack", ctxPackID: "pack", contentHash: "hash" },
  label: "Plan",
  contentHash: "hash",
  estimatedTokens: 100,
  status: "ready",
  errorCode: null,
  tags: ["ParallelPlan"],
}
const disposers: VoidFunction[] = []
let BlockChatComposer: (typeof import("./block-chat-composer"))["BlockChatComposer"]
beforeAll(async () => {
  BlockChatComposer = (await import("./block-chat-composer")).BlockChatComposer
})
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  document.body.innerHTML = ""
})

function mount(role: BlockChatComposerProps["role"], beforeSubmit?: () => Promise<void>) {
  const host = document.createElement("div")
  document.body.append(host)
  const current = createRoot((dispose) => {
    disposers.push(dispose)
    return fixture()
  })
  active = current
  disposers.push(
    render(
      () =>
        createComponent(BlockChatComposer, {
          role,
          controls: { session: { id: `session-${role}` } } as BlockChatComposerProps["controls"],
          beforeSubmit,
        }),
      host,
    ),
  )
  return { ...current, host, button: () => host.querySelector<HTMLButtonElement>('[data-action="execute-plan"]') }
}

describe("MasterAgent Execute plan", () => {
  test("offers execution only for MasterAgent after a tagged attachment is ready", () => {
    const operating = mount("operating")
    const master = mount("master")
    const relay = mount("relay")
    expect(master.button() === null).toBe(true)
    operating.setState("attachments", [plan])
    master.setState("attachments", [plan])
    relay.setState("attachments", [plan])
    expect(master.button() !== null).toBe(true)
    expect(operating.button() === null).toBe(true)
    expect(relay.button() === null).toBe(true)
    expect(master.submitted).toEqual([])
  })

  test("preserves draft mentions, images, file context and offsets when explicitly executing", async () => {
    const beforeSubmit = mock(async () => {})
    const master = mount("master", beforeSubmit)
    master.setState("attachments", [plan])
    const draft: Prompt = [
      { type: "text", content: "Use ", start: 0, end: 4 },
      { type: "agent", name: "build", content: "@build", start: 4, end: 10 },
      { type: "file", path: "/plan.ts", content: "@plan.ts", start: 10, end: 18 },
      { type: "image", id: "image", filename: "design.png", mime: "image/png", blob: { id: "blob" } as never },
    ]
    master.prompt.set(draft, 18)
    master.prompt.context.add({ type: "file", path: "/context.ts", comment: "Keep this context" })
    master.button()!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const prefix = `${dict["canvas.chat.master.executePrompt"]}\n\n`
    expect(beforeSubmit).toHaveBeenCalledTimes(1)
    expect(master.submitted).toHaveLength(1)
    expect(master.submitted[0][0]).toEqual({ type: "text", content: prefix, start: 0, end: prefix.length })
    expect(master.submitted[0].slice(1)).toEqual(
      draft.map((part) =>
        part.type === "image" ? part : { ...part, start: part.start + prefix.length, end: part.end + prefix.length },
      ),
    )
    expect(master.prompt.context.items()[0]?.comment).toBe("Keep this context")
    expect(master.state.attachments).toHaveLength(1)
  })

  test("blocks execution while its chat is working or an attachment is still preparing", () => {
    const master = mount("master")
    master.setState("attachments", [plan])
    master.setState("pending", 1)
    expect(master.button()?.disabled).toBe(true)
    master.button()!.click()
    master.setState({ pending: 0, working: true })
    expect(master.button()?.disabled).toBe(true)
    master.button()!.click()
    expect(master.submitted).toEqual([])
    master.setState("working", false)
    expect(master.button()?.disabled).toBe(false)
  })

  test("does not duplicate the execution prefix on rapid clicks or retry after synchronization fails", async () => {
    let reject: (error: Error) => void = () => {}
    const failure = new Promise<void>((_resolve, next) => {
      reject = next
    })
    let attempts = 0
    const master = mount("master", () => (attempts++ === 0 ? failure : Promise.resolve()))
    master.setState("attachments", [plan])
    master.button()!.click()
    master.button()!.click()
    expect(attempts).toBe(1)
    expect(master.button()?.disabled).toBe(true)
    reject(new Error("Retry synchronization"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(master.button()?.disabled).toBe(false)
    master.button()!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(master.submitted).toHaveLength(1)
    expect(
      master.submitted[0].filter(
        (part) => part.type === "text" && part.content.includes(dict["canvas.chat.master.executePrompt"]),
      ),
    ).toHaveLength(1)
  })
})
