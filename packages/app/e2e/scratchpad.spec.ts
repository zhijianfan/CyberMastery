import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "./utils/mock-server"
import { installSseTransport } from "./utils/sse-transport"

test("Scratchpad submits monologue messages and saves only the chosen message as CtxPack", async ({ page }) => {
  const fixture = await openScratchpad(page)
  let scratchpad = page.getByRole("group", { name: "Scratchpad block", exact: true })
  let input = scratchpad.getByRole("textbox", { name: "Scratchpad", exact: true })
  let submit = scratchpad.locator('[data-action="scratchpad-submit"]')

  await input.fill("First thought")
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(input).toHaveValue("")

  await input.fill("Second thought")
  await input.press("Enter")
  await expect(input).toHaveValue("")

  let messages = scratchpad.locator("[data-scratchpad-message]")
  await expect(messages).toHaveCount(2)
  await expect(messages).toContainText(["First thought", "Second thought"])
  expect(fixture.created).toEqual([])
  expect(fixture.mutations).toEqual([])

  await expect
    .poll(() =>
      page.evaluate((workspaceID) => {
        const entries = JSON.parse(localStorage.getItem("opencode.canvas.local-view.v1") ?? "[]") as Array<{
          blockID?: string
          view?: { messages?: unknown[] }
        }>
        const key = `notes:${encodeURIComponent(workspaceID)}:${encodeURIComponent("block-notes")}`
        return entries.find((entry) => entry.blockID === key)?.view?.messages?.length ?? 0
      }, fixture.workspaceID),
    )
    .toBe(2)
  const persistedMessages = await page.evaluate((workspaceID) => {
    const entries = JSON.parse(localStorage.getItem("opencode.canvas.local-view.v1") ?? "[]") as Array<{
      blockID?: string
      view?: { messages?: Array<{ id: string; text: string; createdAt: number }> }
    }>
    const key = `notes:${encodeURIComponent(workspaceID)}:${encodeURIComponent("block-notes")}`
    return entries.find((entry) => entry.blockID === key)?.view?.messages ?? []
  }, fixture.workspaceID)
  expect(persistedMessages).toEqual([
    { id: expect.any(String), text: "First thought", createdAt: expect.any(Number) },
    { id: expect.any(String), text: "Second thought", createdAt: expect.any(Number) },
  ])
  await page.reload()
  scratchpad = page.getByRole("group", { name: "Scratchpad block", exact: true })
  input = scratchpad.getByRole("textbox", { name: "Scratchpad", exact: true })
  submit = scratchpad.locator('[data-action="scratchpad-submit"]')
  await expect(input).toHaveValue("")
  await expect(submit).toBeDisabled()
  messages = scratchpad.locator("[data-scratchpad-message]")
  await expect(messages).toHaveCount(2)

  const first = messages.filter({ hasText: "First thought" })
  const second = messages.filter({ hasText: "Second thought" })
  await expect(first).toHaveCount(1)
  await expect(second).toHaveCount(1)
  await first.hover()
  await expect(first.getByRole("button", { name: "Copy message", exact: true })).toBeVisible()
  await expect(second.getByRole("button", { name: "Copy message", exact: true })).toBeVisible()

  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/workspace/${fixture.workspaceID}/ctxpack`,
  )
  await first.getByRole("button", { name: "Save as CtxPack", exact: true }).click()
  expect((await created).ok()).toBe(true)

  expect(fixture.created).toEqual([
    {
      title: "First thought",
      keywords: ["First", "thought"],
      sensitivity: "workspace",
      fragments: [
        {
          clientFragmentID: expect.any(String),
          text: "First thought",
          source: {
            workspaceID: fixture.workspaceID,
            blockID: "block-notes",
            functionalityID: "builtin:notes",
            kind: "block-text",
            direction: "sent",
            sourceTimestamp: expect.any(Number),
            capturedAt: expect.any(Number),
            entityRef: { type: "message", id: expect.any(String) },
            label: null,
            metadata: {},
            sensitivity: "workspace",
          },
        },
      ],
      idempotencyKey: expect.any(String),
    },
  ])

  await second.getByRole("button", { name: "More save options", exact: true }).click()
  await page.getByRole("menuitem", { name: "Save with details…", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Create CtxPack", exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator("[data-ctxpack-title-input]")).toHaveValue("Second thought")
  await expect(dialog.locator("[data-ctxpack-fragment]")).toHaveCount(1)
  await expect(dialog.locator("[data-ctxpack-fragment-source]")).toHaveText("block-notes · builtin:notes")
  expect(fixture.created).toHaveLength(1)
  const detailed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/workspace/${fixture.workspaceID}/ctxpack`,
  )
  await dialog.getByRole("button", { name: "Create CtxPack", exact: true }).click()
  expect((await detailed).ok()).toBe(true)
  await expect(dialog).toHaveCount(0)
  expect(fixture.created[1]).toEqual({
    title: "Second thought",
    keywords: ["Second", "thought"],
    sensitivity: "workspace",
    fragments: [
      {
        clientFragmentID: expect.any(String),
        text: "Second thought",
        source: {
          workspaceID: fixture.workspaceID,
          blockID: "block-notes",
          functionalityID: "builtin:notes",
          kind: "block-text",
          direction: "sent",
          sourceTimestamp: persistedMessages[1]!.createdAt,
          capturedAt: expect.any(Number),
          entityRef: { type: "message", id: persistedMessages[1]!.id },
          label: null,
          metadata: {},
          sensitivity: "workspace",
        },
      },
    ],
    idempotencyKey: expect.any(String),
  })
  expect(fixture.errors).toEqual([])
})

async function openScratchpad(page: Page) {
  const directory = "C:/OpenCode/ScratchpadAcceptance"
  const workspaceID = "wrk_scratchpad_acceptance"
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  const location = { directory, workspaceID, project: { id: "proj_scratchpad", directory } }
  const workspace = {
    id: workspaceID,
    name: "Scratchpad workspace",
    directories: [directory],
    model: "opencode:test-model",
    coderModel: null,
  }
  const session = {
    id: "ses_scratchpad",
    projectID: "proj_scratchpad",
    directory,
    workspaceID,
    title: "Scratchpad acceptance",
    version: "dev",
    agent: "build",
    model: { id: "test-model", providerID: "opencode" },
    time: { created: 1, updated: 1 },
  }
  const layout = {
    workspaceID,
    revision: 1,
    blocks: [
      {
        id: "block-notes",
        functionality: "builtin:notes",
        transform: { x: 40, y: 90, w: 560, h: 620, z: 0 },
      },
    ],
  }
  const created: unknown[] = []
  const mutations: string[] = []
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method()))
      mutations.push(`${request.method()} ${pathname}`)
  })
  await installSseTransport(page, { server })

  await mockOpenCodeServer(page, {
    protocol: "v2",
    directory,
    project: {
      id: "proj_scratchpad",
      worktree: directory,
      vcs: "git",
      name: "Scratchpad acceptance",
      time: { created: 1, updated: 1 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "test-model": {
              id: "test-model",
              name: "Test Model",
              limit: { context: 200000 },
              cost: { input: 0, output: 0 },
            },
          },
        },
      ],
      connected: ["opencode"],
      default: { opencode: "test-model" },
    },
    sessions: [session],
    pageMessages: () => ({ items: [] }),
  })

  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (value: unknown) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(value),
        headers: { "access-control-allow-origin": "*" },
      })
    if (request.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "access-control-allow-headers": "*",
        },
      })
    if (path === "/api/provider")
      return json({ location, data: [{ id: "opencode", name: "OpenCode", integrationID: "opencode", settings: {} }] })
    if (path === "/api/model")
      return json({
        location,
        data: [
          {
            id: "test-model",
            providerID: "opencode",
            modelID: "test-model",
            name: "Test Model",
            capabilities: { input: ["text"], output: ["text"], tools: true },
            cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
            variants: [],
            time: { released: 1 },
            enabled: true,
            limit: { context: 200000, output: 8192 },
            status: "active",
          },
        ],
      })
    if (path === "/api/model/default") return json({ location, data: { id: "test-model", providerID: "opencode" } })
    if (path === "/api/integration")
      return json({
        location,
        data: [
          { id: "opencode", name: "OpenCode", connections: [{ type: "env", name: "FIXTURE_MODEL" }], methods: [] },
        ],
      })
    if (path === "/api/workspace") return json([workspace])
    if (path === `/api/workspace/${workspaceID}`) return json(workspace)
    if (path === `/api/workspace/${workspaceID}/functionality`)
      return json([
        {
          id: "builtin:notes",
          kind: "builtin",
          label: "Scratchpad",
          minW: 4,
          minH: 4,
          maxW: null,
          maxH: null,
        },
      ])
    if (path === "/api/workspace/layout") return json(layout)
    if (path === "/api/workspace/layout/save") return json({ status: "saved", layout })
    if (path === `/api/workspace/${workspaceID}/ctxpack` && request.method() === "POST") {
      const body = request.postDataJSON() as {
        title: string
        keywords: string[]
        sensitivity: "workspace"
        fragments: Array<{ clientFragmentID: string; text: string; source: Record<string, unknown> }>
        idempotencyKey: string
      }
      created.push(body)
      return json({
        id: "ctxpk_scratchpad",
        workspaceID,
        title: body.title,
        keywords: body.keywords,
        sensitivity: body.sensitivity,
        revision: 1,
        contentHash: "sha256:scratchpad",
        byteLength: body.fragments[0]?.text.length ?? 0,
        estimatedTokens: 3,
        fragments: body.fragments.map((fragment, ordinal) => ({
          ...fragment,
          id: `ctxpkf_scratchpad_${ordinal}`,
          ordinal,
          contentHash: `sha256:scratchpad-${ordinal}`,
          byteLength: fragment.text.length,
          estimatedTokens: 3,
        })),
        usage: { attachedCount: 0, lastAttachedAt: null },
        createdByUserID: "scratchpad-test",
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      })
    }
    if (path === `/api/workspace/${workspaceID}/ctxpack`) return json({ items: [], nextCursor: null, totalEstimate: 0 })
    return route.fallback()
  })

  await page.addInitScript(
    ({ directory, workspaceID }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "en" }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem("opencode.canvas.workspaceID.v1", workspaceID)
    },
    { directory, workspaceID },
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/server/${base64Encode(server)}/session/${session.id}`)
  const scratchpad = page.getByRole("group", { name: "Scratchpad block", exact: true })
  await expect(scratchpad).toHaveAttribute("data-card-id", "block-notes")
  await expect(scratchpad.locator("[data-ctxpack-source-root]")).toHaveAttribute(
    "data-functionality-id",
    "builtin:notes",
  )
  await expect(page.getByText("Canvas workspace · synced", { exact: true })).toBeVisible()
  mutations.length = 0

  return { created, mutations, errors, workspaceID }
}
