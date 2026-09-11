import { randomUUID } from "node:crypto"
import { expect, type Page, type Response } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import { Schema } from "effect"
import type { WorkspaceBlockRecord } from "@opencode-ai/sdk/v2/client"
import { mockOpenCodeServer } from "./mock-server"
import { expectAppVisible } from "./waits"
import { installSseTransport } from "./sse-transport"

export async function ctxPackFixture(page: Page, options: { rejectFirstPrompt?: boolean } = {}) {
  const directory = "C:/OpenCode/CtxPackAcceptance"
  const sessionID = `ses_${randomUUID()}`
  const workspaceID = `wrk_${randomUUID()}`
  const blockID = "operating-chat"
  const functionalityID = "builtin:operating-chat-session"
  const functionalityInstanceID = `fn_${randomUUID()}`
  const capsuleID = `ctxkpsl_${randomUUID()}`
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  const authorization = `Basic ${Buffer.from("ctxpack-test:fixture-password").toString("base64")}`
  const fragmentText = "The pump cavitation threshold is 14 kPa post-pressure."
  const prompts: Array<{
    headers: Record<string, string>
    body: {
      id: string
      prompt: { text: string }
      delivery: string
      contextAttachments: unknown[]
    }
  }> = []
  const legacyPrompts: string[] = []
  const packs: CtxPack.Info[] = []
  const layout = {
    revision: 1,
    blocks: [
      {
        id: blockID,
        functionality: functionalityID,
        transform: { x: 20, y: 70, w: 1050, h: 700, z: 0 },
      },
    ] as WorkspaceBlockRecord[],
  }
  const workspace = {
    id: workspaceID,
    name: "Default",
    model: "opencode:test-model",
    directories: [directory],
    coderModel: null,
  }
  const location = { directory, workspaceID, project: { id: "proj_ctxpack", directory } }
  const transport = await installSseTransport(page, { server })

  await mockOpenCodeServer(page, {
    protocol: "v2",
    directory,
    project: {
      id: "proj_ctxpack",
      worktree: directory,
      vcs: "git",
      name: "CtxPack acceptance",
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
    sessions: [
      {
        id: sessionID,
        projectID: "proj_ctxpack",
        directory,
        workspaceID,
        title: "CtxPack acceptance",
        version: "dev",
        agent: "build",
        model: { id: "test-model", providerID: "opencode" },
        time: { created: 1, updated: 1 },
      },
    ],
    pageMessages: () => ({
      items: [
        {
          info: { id: "msg_ctxpack_question", role: "user", time: { created: 0 } },
          parts: [{ type: "text", text: "What is the pump cavitation threshold?" }],
        },
        {
          info: {
            id: "msg_ctxpack_source",
            role: "assistant",
            agent: "build",
            modelID: "test-model",
            providerID: "opencode",
            time: { created: 1, completed: 2 },
            cost: 0,
            tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          parts: [{ type: "text", text: fragmentText }],
        },
      ],
    }),
  })
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (value: unknown, status = 200) =>
      route.fulfill({
        status,
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
        { id: functionalityID, kind: "builtin", label: "Operating Chat", minW: 4, minH: 4, maxW: null, maxH: null },
        {
          id: "builtin:ctxpack-browser",
          kind: "builtin",
          label: "Context Packs",
          minW: 5,
          minH: 4,
          maxW: null,
          maxH: null,
        },
      ])
    if (path === "/api/workspace/layout") return json({ ...layout, workspaceID })
    if (path === "/api/workspace/layout/save") {
      layout.blocks = request.postDataJSON().blocks
      layout.revision += 1
      return json({ status: "saved", layout: { ...layout, workspaceID } })
    }
    if (path === `/api/workspace/${workspaceID}/operating-chat/${blockID}/ensure`)
      return json({
        workspaceID,
        blockID,
        functionalityInstanceID,
        sessionID,
        directory,
        generation: 0,
        revision: 0,
      })
    if (path === `/api/workspace/${workspaceID}/ctxpack` && request.method() === "POST") {
      expect(request.headers().authorization).toBe(authorization)
      const body = Schema.decodeUnknownSync(CtxPack.CreateRequest)({ ...request.postDataJSON(), workspaceID })
      const pack: CtxPack.Info = {
        id: CtxPack.ID.create(),
        workspaceID,
        title: body.title,
        keywords: body.keywords,
        sensitivity: body.sensitivity,
        revision: 1,
        contentHash: "sha256:fixture-pack",
        byteLength: fragmentText.length,
        estimatedTokens: 16,
        fragments: body.fragments.map((fragment, ordinal) => ({
          ...fragment,
          id: CtxPack.FragmentID.create(),
          ordinal,
          contentHash: "sha256:fixture-fragment",
          byteLength: fragment.text.length,
          estimatedTokens: 16,
        })),
        usage: { attachedCount: 0, lastAttachedAt: null },
        createdByUserID: "ctxpack-test",
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      }
      packs.push(pack)
      return json(pack)
    }
    if (path === `/api/workspace/${workspaceID}/ctxpack`)
      return json({
        items: packs.map((pack) => ({
          ...pack,
          fragments: undefined,
          fragmentCount: pack.fragments.length,
          sourceBlockIDs: [blockID],
          sourceFunctionalityIDs: [functionalityID],
          sourceKinds: ["block-text"],
        })),
        nextCursor: null,
        totalEstimate: packs.length,
      })
    const pack = packs.find(
      (pack) =>
        path === `/api/workspace/${workspaceID}/ctxpack/${pack.id}` ||
        path === `/api/workspace/${workspaceID}/ctxpack/${pack.id}/materialize`,
    )
    if (pack && path.endsWith("/materialize")) {
      expect(request.headers().authorization).toBe(authorization)
      expect(request.postDataJSON()).toEqual({
        expectedContentHash: pack.contentHash,
        targetInstanceID: functionalityInstanceID,
        targetFunctionalityID: functionalityID,
      })
      return json({
        contextCapsuleID: capsuleID,
        sourceCtxPackID: pack.id,
        label: pack.title,
        contentHash: pack.contentHash,
        estimatedTokens: pack.estimatedTokens,
      })
    }
    if (pack) {
      expect(request.headers().authorization).toBe(authorization)
      return json(pack)
    }
    if (path === `/api/session/${sessionID}/prompt`) {
      const body = request.postDataJSON()
      prompts.push({ body, headers: request.headers() })
      if (options.rejectFirstPrompt && prompts.length === 1) return json({ _tag: "InternalServerError" }, 500)
      return json({
        data: {
          admittedSeq: prompts.length,
          id: body.id,
          sessionID,
          prompt: body.prompt,
          delivery: body.delivery,
          timeCreated: 3,
        },
      })
    }
    return route.fallback()
  })
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /^\/session\/[^/]+\/(message|prompt_async)$/.test(new URL(request.url()).pathname)
    )
      legacyPrompts.push(request.url())
  })
  await page.addInitScript(
    ({ server, directory, workspaceID }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "en" }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          list: [{ type: "http", http: { url: server, username: "ctxpack-test", password: "fixture-password" } }],
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem("opencode.canvas.workspaceID.v1", workspaceID)
    },
    { server, directory, workspaceID },
  )
  await page.setViewportSize({ width: 1600, height: 1100 })
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await transport.waitForConnection()
  const source = page.locator(`[data-ctxpack-source-root][data-block-id="${blockID}"]`)
  await expect(source).toHaveAttribute("data-workspace-id", workspaceID)
  await expect(source).toHaveAttribute("data-functionality-id", functionalityID)
  const composer = source.locator('[data-component="prompt-input-v2"]')
  const input = composer.locator('[data-component="prompt-input"]')
  const chips = composer.locator('[data-component="prompt-input-v2-context-attachments"] [data-attachment-id]')
  await expectAppVisible(input)
  await expect(page.getByText("Canvas workspace · synced", { exact: true })).toBeVisible()

  return {
    authorization,
    capsuleID,
    fragmentText,
    prompts,
    legacyPrompts,
    input,
    chips,
    isPromptResponse: (response: Response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === `/api/session/${sessionID}/prompt`,
    async createFromSelection() {
      // Markdown replaces its initial text node after parsing; select the settled paragraph.
      const text = source.locator('[data-component="markdown"] p').filter({ hasText: fragmentText })
      await expect(text).toBeVisible()
      await expect(text).toHaveText(fragmentText)
      await text.click({ clickCount: 3 })
      expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe(fragmentText)
      const toolbar = page.locator("[data-ctxpack-selection-toolbar]")
      await expect(toolbar).toBeVisible()
      await toolbar.locator('[data-action="save-response-options"]').click()
      await page.getByRole("menuitem", { name: "Save with details…", exact: true }).click()
      const dialog = page.locator('[data-component="dialog-v2"]').filter({ hasText: "Create CtxPack" })
      await expect(dialog.locator("[data-ctxpack-title-input]")).toHaveValue(fragmentText)
      await expect(dialog.locator('[data-ctxpack-sensitivity="workspace"]')).toBeChecked()
      await dialog.locator("[data-ctxpack-title-input]").fill("Pump cavitation reference")
      const created = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/api/workspace/${workspaceID}/ctxpack`,
      )
      await dialog.locator("[data-ctxpack-save]").click()
      const response = await created
      expect(response.status()).toBe(200)
      const pack = Schema.decodeUnknownSync(CtxPack.Info)(await response.json())
      expect(pack.fragments.map((fragment) => fragment.text)).toEqual([fragmentText])
      await expect(dialog).toHaveCount(0)
      return pack
    },
    async openAndAttach(pack: CtxPack.Info) {
      await page.getByRole("button", { name: "Blocks", exact: true }).click()
      await page.getByRole("option", { name: "Context Packs", exact: true }).click()
      await page.getByRole("button", { name: "Add block", exact: true }).click()
      const browser = page.locator('[data-component="ctxpack-browser"]')
      const card = browser.locator(`.ctxpack-browser-card[data-ctxpack-id="${pack.id}"]`)
      await expect(card).toBeVisible()
      await card.click()
      const detail = browser.locator(`.ctxpack-browser-detail[data-ctxpack-id="${pack.id}"]`)
      await expect(detail.locator(".ctxpack-browser-fragment")).toHaveCount(pack.fragments.length)
      await expect(detail.locator(".ctxpack-browser-fragment")).toContainText([fragmentText])
      expect(
        await detail
          .locator(".ctxpack-browser-fragment")
          .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-ordinal")))),
      ).toEqual(pack.fragments.map((fragment) => fragment.ordinal))
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
      await detail
        .getByRole("button", { name: "Drag pack to attach", exact: true })
        .dispatchEvent("dragstart", { dataTransfer })
      expect(
        await dataTransfer.evaluate((transfer) => JSON.parse(transfer.getData("application/x-opencode-ctxpack+json"))),
      ).toEqual({
        version: 1,
        workspaceID,
        ctxPackID: pack.id,
        contentHash: pack.contentHash,
        label: pack.title,
        estimatedTokens: pack.estimatedTokens,
      })
      const materialized = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/api/workspace/${workspaceID}/ctxpack/${pack.id}/materialize`,
      )
      await composer.dispatchEvent("dragover", { dataTransfer })
      await composer.dispatchEvent("drop", { dataTransfer })
      expect((await materialized).status()).toBe(200)
      await expect(chips).toHaveCount(1)
      await expect(chips).toContainText(pack.title)
      await browser.getByRole("button", { name: "Close", exact: true }).click()
      await page
        .getByRole("group", { name: "Context Packs block", exact: true })
        .getByRole("button", { name: "Remove block", exact: true })
        .click()
      await expect(browser).toHaveCount(0)
      const previewed = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          new URL(response.url()).pathname === `/api/workspace/${workspaceID}/ctxpack/${pack.id}`,
      )
      await chips.locator('[data-action="ctxpack-attachment-preview"]').click()
      expect((await previewed).status()).toBe(200)
      const preview = page.locator('[data-component="dialog-v2"]')
      await expect(preview.getByRole("heading", { name: pack.title, exact: true })).toBeVisible()
      await expect(preview.locator("pre")).toHaveText([fragmentText])
      await preview.getByRole("button", { name: "Close", exact: true }).click()
      await expect(preview).toHaveCount(0)
    },
  }
}
