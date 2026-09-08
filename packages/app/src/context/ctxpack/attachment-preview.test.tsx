import { afterEach, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { dict } from "@/i18n/en"

const pluginRequire = createRequire(import.meta.resolve("vite-plugin-solid"))
const babel = pluginRequire("@babel/core") as {
  transformSync(source: string, options: Record<string, unknown>): { code: string }
}
await Bun.plugin({
  name: "ctxpack-preview-solid-test",
  setup(build) {
    build.onLoad({ filter: /([\\/](attachment-preview|dialog-v2)\.tsx$|\.jsx$)/ }, async (args) => ({
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
const clientSolid = import.meta.resolve("solid-js").replace("dist/server.js", "dist/solid.js")
const clientWeb = import.meta.resolve("solid-js/web").replace("dist/server.js", "dist/web.js")
mock.module("solid-js", () => require(clientSolid))
mock.module("solid-js/web", () => require(clientWeb))
mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (key: keyof typeof dict) => dict[key] }) }))
let client: ReturnType<typeof createOpencodeClient>
mock.module("@/context/server-sdk", () => ({ useServerSDK: () => () => ({ client }) }))

const { createComponent } = await import("solid-js")
const { render } = await import("solid-js/web")
const { Dialog } = await import("@kobalte/core/dialog")
const { CtxPackAttachmentPreview } = await import("./attachment-preview")
const mounted: Array<{ dispose(): void; element: HTMLElement }> = []
afterEach(() => {
  mounted.splice(0).forEach((item) => {
    item.dispose()
    item.element.remove()
  })
})

function mount(response: Promise<Response>) {
  const requests: Request[] = []
  client = createOpencodeClient({
    baseUrl: "http://ctxpack-preview.test",
    headers: { Authorization: "Bearer preview-test" },
    fetch: Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        requests.push(new Request(input))
        return response
      },
      { preconnect: fetch.preconnect },
    ),
  })
  const element = document.createElement("div")
  document.body.append(element)
  const dispose = render(
    () =>
      createComponent(Dialog, {
        open: true,
        get children() {
          return createComponent(CtxPackAttachmentPreview, { workspaceID: "workspace-1", ctxPackID: "pack-1" })
        },
      }),
    element,
  )
  mounted.push({ element, dispose })
  return { element, requests }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const pack = {
  id: "pack-1",
  workspaceID: "workspace-1",
  title: "Preview <b>title</b>",
  keywords: [],
  sensitivity: "workspace",
  revision: 1,
  contentHash: "sha256:preview",
  byteLength: 48,
  estimatedTokens: 12,
  createdByUserID: "user-1",
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  usage: { attachedCount: 0, lastAttachedAt: null },
  fragments: [
    { ordinal: 1, text: "Second fragment" },
    { ordinal: 0, text: '<img src="invalid" onerror="alert(1)"> First fragment' },
  ].map((fragment) => ({
    ...fragment,
    id: `fragment-${fragment.ordinal}`,
    clientFragmentID: `fragment-${fragment.ordinal}`,
    contentHash: `sha256:fragment-${fragment.ordinal}`,
    byteLength: 24,
    estimatedTokens: 6,
    source: {
      workspaceID: "workspace-1",
      blockID: "block-1",
      functionalityID: "builtin:chat",
      kind: "message",
      direction: "received",
      sourceTimestamp: null,
      capturedAt: 1,
      entityRef: null,
      label: null,
      metadata: {},
      sensitivity: "workspace",
    },
  })),
}

test("preview fetches authorized detail and renders ordered fragments as inert text", async () => {
  const response = Promise.withResolvers<Response>()
  const view = mount(response.promise)
  await tick()
  expect(view.requests).toHaveLength(1)
  expect(view.requests[0].method).toBe("GET")
  expect(new URL(view.requests[0].url).pathname).toBe("/api/workspace/workspace-1/ctxpack/pack-1")
  expect(view.requests[0].headers.get("authorization")).toBe("Bearer preview-test")
  expect(view.element.textContent).toContain(dict["prompt.ctxpack.preview.loading"])
  response.resolve(Response.json(pack))
  await tick()
  expect(view.element.textContent).toContain(pack.title)
  expect([...view.element.querySelectorAll("pre")].map((element) => element.textContent)).toEqual([
    '<img src="invalid" onerror="alert(1)"> First fragment',
    "Second fragment",
  ])
  expect(view.element.querySelector("img, script, b")).toBeNull()
  expect(view.element.textContent).not.toContain(dict["prompt.ctxpack.preview.loading"])
})

test("preview denies raw error text when the authorized detail request fails", async () => {
  const view = mount(Promise.resolve(Response.json({ message: "PRIVATE_SERVER_ERROR_SENTINEL" }, { status: 403 })))
  await tick()
  expect(view.element.querySelector('[role="alert"]')?.textContent).toBe(dict["prompt.ctxpack.preview.failed"])
  expect(view.element.textContent).not.toContain("PRIVATE_SERVER_ERROR_SENTINEL")
  expect(view.element.querySelector("pre")).toBeNull()
})
