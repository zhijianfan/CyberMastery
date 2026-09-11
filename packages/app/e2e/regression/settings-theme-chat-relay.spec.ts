import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

test("settings change the entire canvas and Context Packs between dark and light and persist the choice", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" })
  await setup(page)
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  const packs = page.locator('[data-component="ctxpack-browser"]')
  const packSurface = packs.locator(".ctxpack-browser-search")
  const dark = await packSurface.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    color: getComputedStyle(element).color,
  }))

  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const scheme = page.locator('[data-action="settings-color-scheme"]')
  await expect(scheme).toContainText("Dark")
  await page.screenshot({ path: test.info().outputPath("settings-dark.png") })
  await scheme.locator('[data-component="select-v2"]').click()
  await page.locator('[data-slot="select-v2-content"]').getByText("Light", { exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  const light = await packSurface.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    color: getComputedStyle(element).color,
  }))
  expect(light.background).not.toBe(dark.background)
  expect(light.color).not.toBe(dark.color)
  await expect(page.locator(".canvas-app")).toHaveCSS("background-color", "rgb(247, 246, 242)")
  await page.screenshot({ path: test.info().outputPath("settings-light.png") })

  await page.reload()
  await expect(packs).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await expect(scheme).toContainText("Light")
  await scheme.locator('[data-component="select-v2"]').click()
  await page.locator('[data-slot="select-v2-content"]').getByText("Dark", { exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  await expect(packSurface).toHaveCSS("background-color", dark.background)
  await page.keyboard.press("Escape")
  await page.screenshot({ path: test.info().outputPath("ctxpack-dark.png") })
})

test("ChatRelay settings connect and reopen one shared ChatGPT browser session without OAuth", async ({ page }) => {
  const fixture = await setup(page)
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByRole("tab", { name: "Providers", exact: true }).click()
  const handoff = page.locator('[data-component="chat-relay-handoff-section"]')
  await expect(handoff).toContainText("Sign in to the regular ChatGPT website once.")
  await expect(handoff).toContainText("OpenCode does not send these messages through Codex or the OpenAI API.")
  await expect(handoff).toContainText("Not connected")

  const connected = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/chat-proxy/connect",
  )
  await handoff.locator('[data-action="settings-chat-relay-connect"]').click()
  expect((await connected).status()).toBe(200)
  await expect(handoff).toContainText("Sign-in required")
  await expect(handoff).toContainText("Sign in in the browser window, then close that window to connect ChatRelay.")

  const opened = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/chat-proxy/open",
  )
  await handoff.locator('[data-action="settings-chat-relay-open"]').click()
  expect((await opened).status()).toBe(200)
  await expect(handoff).toContainText("Ready")
  expect(fixture.chatProxyRequests).toEqual(
    expect.arrayContaining(["GET /api/chat-proxy", "POST /api/chat-proxy/connect", "POST /api/chat-proxy/open"]),
  )
  expect(fixture.oauthRequests).toEqual([])
  await page.screenshot({ path: test.info().outputPath("chat-relay-browser-session.png") })
})

async function setup(page: Page) {
  const directory = "C:/OpenCode/Settings"
  const workspaceID = "wrk_settings"
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  const location = { directory, workspaceID, project: { id: "proj_settings", directory } }
  const workspace = {
    id: workspaceID,
    name: "Settings workspace",
    directories: [directory],
    model: "openai:test-model",
    coderModel: null,
  }
  const methods = [{ id: "chatgpt-headless", type: "oauth", label: "ChatGPT Pro/Plus (headless)" }]
  const integration = { id: "openai", name: "OpenAI", methods, connections: [{ type: "env", name: "TEST_PROVIDER" }] }
  const oauthRequests: unknown[] = []
  const chatProxyRequests: string[] = []
  let chatRelayProvider = { id: "chatgpt", name: "ChatGPT", status: "disconnected" }
  await mockOpenCodeServer(page, {
    protocol: "v2",
    directory,
    project: {
      id: "proj_settings",
      worktree: directory,
      name: "Settings",
      vcs: "git",
      time: { created: 1, updated: 1 },
      sandboxes: [],
    },
    provider: { all: [{ id: "openai", name: "OpenAI", models: {} }], connected: ["openai"], default: {} },
    sessions: [
      {
        id: "ses_settings",
        title: "Settings",
        directory,
        projectID: "proj_settings",
        workspaceID,
        time: { created: 1, updated: 1 },
      },
    ],
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
    if (path === "/api/provider")
      return json({ location, data: [{ id: "openai", name: "OpenAI", integrationID: "openai", settings: {} }] })
    if (path === "/api/model") return json({ location, data: [] })
    if (path === "/api/model/default") return json({ location, data: null })
    if (path === "/api/integration") return json({ location, data: [integration] })
    if (path === "/api/integration/openai") return json({ location, data: integration })
    if (path === "/api/integration/openai/connect/oauth") {
      oauthRequests.push(request.postDataJSON())
      return json({
        location,
        data: {
          attemptID: "attempt-settings",
          mode: "auto",
          url: "https://example.test/browser-sign-in",
          instructions: "Continue in your browser.",
          time: { created: 1, expires: 2 },
        },
      })
    }
    if (path === "/api/chat-proxy") {
      chatProxyRequests.push(`${request.method()} ${path}`)
      if (chatRelayProvider.status === "opening") chatRelayProvider = { ...chatRelayProvider, status: "ready" }
      return json(chatRelayProvider)
    }
    if (path === "/api/chat-proxy/connect") {
      chatProxyRequests.push(`${request.method()} ${path}`)
      chatRelayProvider = { ...chatRelayProvider, status: "login-required" }
      return json(chatRelayProvider)
    }
    if (path === "/api/chat-proxy/open") {
      chatProxyRequests.push(`${request.method()} ${path}`)
      chatRelayProvider = { ...chatRelayProvider, status: "opening" }
      return json(chatRelayProvider)
    }
    if (path === "/api/workspace") return json([workspace])
    if (path === `/api/workspace/${workspaceID}`) return json(workspace)
    if (path === `/api/workspace/${workspaceID}/functionality`)
      return json([
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
    if (path === "/api/workspace/layout")
      return json({
        workspaceID,
        revision: 1,
        blocks: [
          {
            id: "settings-packs",
            functionality: "builtin:ctxpack-browser",
            transform: { x: 50, y: 80, w: 900, h: 650, z: 0 },
          },
        ],
      })
    if (path === `/api/workspace/${workspaceID}/ctxpack`) return json({ items: [], nextCursor: null, totalEstimate: 0 })
    return route.fallback()
  })
  await page.addInitScript(
    ({ workspaceID }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "en" }))
      localStorage.setItem("opencode.canvas.workspaceID.v1", workspaceID)
    },
    { workspaceID },
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/server/${Buffer.from(server).toString("base64url")}/session/ses_settings`)
  await expect(page.locator('[data-component="ctxpack-browser"]')).toBeVisible()
  return { oauthRequests, chatProxyRequests }
}
