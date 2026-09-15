import { afterEach, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { createComponent, createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { Platform } from "@/context/platform"
import { applyCtxPackDrag } from "@/context/ctxpack/drag"
import { dict } from "@/i18n/en"
import type { ChatRelayCommand, ChatRelayView } from "./runtime"

// Compile the real composer, shared input, and cards with the same Solid transform as the app.
const pluginRequire = createRequire(import.meta.resolve("vite-plugin-solid"))
const babel = pluginRequire("@babel/core") as {
  transformSync(source: string, options: Record<string, unknown>): { code: string }
}
await Bun.plugin({
  name: "chat-relay-real-composer-test",
  setup(build) {
    build.onLoad(
      { filter: /(?:session-ui[\\/]src[\\/].*|ui[\\/]src[\\/].*|chat-relay[\\/]composer|context[\\/]platform)\.tsx$/ },
      async (args) => ({
        contents: babel.transformSync(await Bun.file(args.path).text(), {
          filename: args.path,
          presets: [
            [pluginRequire("babel-preset-solid"), { generate: "dom" }],
            pluginRequire("@babel/preset-typescript"),
          ],
        }).code,
        loader: "js",
      }),
    )
  },
})

const notices: unknown[] = []
mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (key: keyof typeof dict) => dict[key] }) }))
mock.module("@/utils/toast", () => ({ showToast: (notice: unknown) => notices.push(notice) }))
mock.module("@opencode-ai/ui/context/dialog", () => ({ useDialog: () => ({ active: undefined, show: () => {} }) }))
mock.module("@/context/ctxpack/attachment-preview", () => ({ CtxPackAttachmentPreview: () => null }))
mock.module("@/context/server-sdk", () => ({
  useServerSDK: () => () => ({
    scope: "local",
    client: {
      v2: {
        chatProxy: { skills: async () => ({ data: [] }) },
        workspace: {
          ctxpack: {
            materialize: async () => ({
              data: {
                contextCapsuleID: "capsule-1",
                sourceCtxPackID: "pack-1",
                label: "Reference",
                contentHash: "materialized-hash",
                estimatedTokens: 20,
              },
            }),
          },
        },
      },
    },
  }),
}))

const { ChatRelayComposer } = await import("./composer")
const { PlatformProvider } = await import("@/context/platform")
const disposers: VoidFunction[] = []
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  document.body.replaceChildren()
  notices.length = 0
})

function mount() {
  const commands: Extract<ChatRelayCommand, { type: "prompt" }>[] = []
  const [current, setCurrent] = createSignal<ChatRelayView>({
    draft: { prompt: [{ type: "text", content: "", start: 0, end: 0 }], context: { items: [] } },
    draftRevision: 0,
    relay: {
      providerID: "chatgpt",
      workspaceID: "workspace-1",
      blockID: "block-1",
      tabID: "tab-1",
      status: "idle",
      messages: [],
    },
  })
  const [busy, setBusy] = createSignal(false)
  const delivery = { result: Promise.resolve(false) }
  const platform: Platform = {
    platform: "web",
    openExternal: () => {},
    restart: async () => {},
    notify: async () => {},
    draftStore: {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
      putBlob: async (file) => ({ id: `blob-${await file.text()}`, url: `blob:relay-${await file.text()}` }),
    },
  }
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(
    render(
      () =>
        createComponent(PlatformProvider, {
          value: platform,
          get children() {
            return createComponent(ChatRelayComposer, {
              blockID: "block-1",
              current,
              busy,
              onDraft: async (command) => {
                setCurrent({ ...current(), draft: command.draft, draftRevision: command.revision })
              },
              onPrompt: async (command) => {
                commands.push(command)
                setBusy(true)
                const accepted = await delivery.result
                if (accepted && command.draftRevision === current().draftRevision) {
                  setCurrent({
                    ...current(),
                    draft: { prompt: [{ type: "text", content: "", start: 0, end: 0 }], context: { items: [] } },
                    draftRevision: command.draftRevision + 1,
                  })
                }
                setBusy(false)
                return accepted
              },
            })
          },
        }),
      host,
    ),
  )
  return {
    host,
    current,
    commands,
    delivery,
    editor: host.querySelector<HTMLElement>('[data-input="chat-relay-message"]')!,
    send: () => host.querySelector<HTMLButtonElement>('[data-action="prompt-submit"]')!,
    cards: () =>
      Array.from(host.querySelectorAll('[data-slot="attachment-card-v2-title"]')).map((card) => card.textContent),
    files: () => current().draft.prompt.filter((part) => part.type === "image"),
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
async function drop(editor: HTMLElement, files: File[], ctxpack = false) {
  const transfer = new DataTransfer()
  // Happy DOM otherwise returns the text/plain File from getData instead of an empty string.
  transfer.setData("text/plain", "")
  files.forEach((file) => transfer.items.add(file))
  if (ctxpack) {
    applyCtxPackDrag(transfer, {
      version: 1,
      workspaceID: "workspace-1",
      ctxPackID: "pack-1",
      contentHash: "source-hash",
      label: "Reference",
      estimatedTokens: 20,
    })
  }
  const event = new Event("drop", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: transfer })
  editor.dispatchEvent(event)
  await settle()
}

test("drops notes.txt as one named card and submits its stored file without text", async () => {
  const mounted = mount()
  expect(mounted.send().disabled).toBe(true)
  await drop(mounted.editor, [new File(["hello"], "notes.txt", { type: "text/plain" })])

  expect(mounted.files()).toEqual([
    {
      type: "image",
      id: expect.any(String),
      filename: "notes.txt",
      sourcePath: undefined,
      mime: "text/plain",
      blob: { id: "blob-hello", url: "blob:relay-hello" },
    },
  ])
  expect(mounted.cards()).toEqual(["notes.txt"])
  expect(mounted.editor.textContent).toBe("")
  expect(mounted.send().disabled).toBe(false)
  mounted.send().click()
  await settle()
  expect(mounted.commands).toEqual([
    {
      type: "prompt",
      messageID: expect.any(String),
      text: "",
      draftRevision: 1,
      files: [{ filename: "notes.txt", mime: "text/plain", blob: { id: "blob-hello", url: "blob:relay-hello" } }],
    },
  ])
})

test("consumes a mixed CtxPack and file drop before the shared file handler", async () => {
  const mounted = mount()
  await drop(mounted.editor, [new File(["hello"], "notes.txt", { type: "text/plain" })], true)
  expect(mounted.cards()).toEqual([])
  expect(mounted.files()).toEqual([])
  expect(mounted.host.querySelectorAll('[data-action="ctxpack-attachment-preview"]')).toHaveLength(1)
  mounted.send().click()
  await settle()
  expect(mounted.commands).toEqual([
    {
      type: "prompt",
      messageID: expect.any(String),
      text: "",
      draftRevision: 0,
      contextAttachments: [
        {
          contextCapsuleID: "capsule-1",
          label: "Reference",
          contentHash: "materialized-hash",
          source: { kind: "ctxpack", ctxPackID: "pack-1" },
        },
      ],
    },
  ])
})

test("warns for unsupported binary files and duplicate drops without adding cards", async () => {
  const mounted = mount()
  await drop(mounted.editor, [
    new File([new Uint8Array([0, 255, 0])], "binary.exe", { type: "application/octet-stream" }),
  ])
  expect(mounted.cards()).toEqual([])
  expect(mounted.send().disabled).toBe(true)
  expect(notices).toEqual([
    {
      title: dict["prompt.toast.pasteUnsupported.title"],
      description: dict["prompt.toast.pasteUnsupported.description"],
    },
  ])
  await drop(mounted.editor, [new File(["hello"], "notes.txt", { type: "text/plain" })])
  await drop(mounted.editor, [new File(["hello"], "notes.txt", { type: "text/plain" })])
  expect(mounted.cards()).toEqual(["notes.txt"])
  expect(mounted.files()).toHaveLength(1)
  expect(notices.at(-1)).toEqual({ title: dict["prompt.toast.attachmentDuplicate.title"] })
})

test("retains attachments after failed delivery and retries the same ID until the acknowledged draft clears", async () => {
  const mounted = mount()
  await drop(mounted.editor, [new File(["hello"], "notes.txt", { type: "text/plain" })])
  mounted.send().click()
  await settle()
  expect(mounted.cards()).toEqual(["notes.txt"])
  const pending = Promise.withResolvers<boolean>()
  mounted.delivery.result = pending.promise
  mounted.send().click()
  await settle()
  expect(mounted.cards()).toEqual(["notes.txt"])
  expect(mounted.commands).toHaveLength(2)
  expect(mounted.commands[1]).toEqual(mounted.commands[0])
  pending.resolve(true)
  await settle()
  expect(mounted.cards()).toEqual([])
  expect(mounted.files()).toEqual([])
  expect(mounted.send().disabled).toBe(true)
})

test("captures the submitted file set and preserves a newer attachment revision after acknowledgement", async () => {
  const mounted = mount()
  await drop(mounted.editor, [new File(["hello"], "notes.txt", { type: "text/plain" })])
  const pending = Promise.withResolvers<boolean>()
  mounted.delivery.result = pending.promise
  mounted.send().click()
  await settle()
  await drop(mounted.editor, [new File(["next"], "next.txt", { type: "text/plain" })])
  mounted.send().click()
  expect(mounted.commands).toHaveLength(1)
  expect(mounted.commands[0].files).toEqual([
    { filename: "notes.txt", mime: "text/plain", blob: { id: "blob-hello", url: "blob:relay-hello" } },
  ])
  pending.resolve(true)
  await settle()
  expect(mounted.cards()).toEqual(["notes.txt", "next.txt"])
  expect(mounted.current().draftRevision).toBe(2)
  mounted.delivery.result = Promise.resolve(false)
  mounted.send().click()
  await settle()
  expect(mounted.commands[1].messageID).not.toBe(mounted.commands[0].messageID)
  expect(mounted.commands[1].files).toEqual([
    { filename: "notes.txt", mime: "text/plain", blob: { id: "blob-hello", url: "blob:relay-hello" } },
    { filename: "next.txt", mime: "text/plain", blob: { id: "blob-next", url: "blob:relay-next" } },
  ])
})
