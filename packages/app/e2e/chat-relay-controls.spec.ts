import { expect, test } from "@playwright/test"
import { openCanvasBlockChats } from "./utils/canvas-block-chats"

for (const protocol of ["v1", "v2"] as const) {
  test(`${protocol}: canvas refresh rejoins the backend-owned ChatRelay page`, async ({ page }) => {
    const fixture = await openCanvasBlockChats(page, protocol, { chatRoles: ["relay"], waitForSse: false })
    const relay = page.locator('[data-component="chat-relay"]')
    const tabID = fixture.relayTab()
    const reads = fixture.relayReads()

    await page.reload()

    await expect(relay).toContainText("ChatGPT ready")
    await expect(relay.getByText("ChatGPT independent previous answer", { exact: true })).toBeVisible()
    expect(fixture.relayReads()).toBeGreaterThan(reads)
    expect(fixture.relayTab()).toBe(tabID)
    expect(fixture.requests.filter((request) => request.endsWith("/browser/ensure"))).toEqual([])
    expect(fixture.browserResets).toEqual([])
    expect(fixture.browserActions).toEqual([])
  })

  test(`${protocol}: ChatRelay discovers missing options only after manual refresh`, async ({ page }) => {
    await page.clock.install()
    const fixture = await openCanvasBlockChats(page, protocol, { chatRoles: ["relay"], waitForSse: false })
    const relay = page.locator('[data-component="chat-relay"]')
    const refresh = relay.getByRole("button", { name: "Refresh options", exact: true })
    await expect(relay.getByRole("combobox")).toHaveCount(0)
    await expect(relay.locator(".canvas-relay-options-note")).toHaveText("Refresh options when ChatGPT is ready.")
    await expect(refresh).toBeEnabled()
    await page.clock.fastForward(30_000)
    expect(fixture.browserOptionReads).toEqual([])

    const optionsResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/chat-relay/block-relay/browser/options"),
    )
    await refresh.click()
    expect((await optionsResponse).status()).toBe(200)
    await expect(relay.getByRole("combobox", { name: "Model", exact: true })).toHaveValue("gpt-5")
    await expect(relay.locator(".canvas-relay-options-note")).toHaveCount(0)
    expect(fixture.browserOptionReads).toEqual([{ tabID: "tab-relay-1" }])
    expect(fixture.browserPrompts).toEqual([])
    expect(fixture.browserActions).toEqual([])
    expect(fixture.errors).toEqual([])
  })

  test(`${protocol}: ChatRelay refreshes webpage choices and configures its owned tab`, async ({ page }, testInfo) => {
    await page.clock.install()
    const fixture = await openCanvasBlockChats(page, protocol, {
      chatRoles: ["relay"],
      chatRelayControls: true,
      waitForSse: false,
    })
    const relay = page.locator('[data-component="chat-relay"]')
    const model = relay.getByRole("combobox", { name: "Model", exact: true })
    const effort = relay.getByRole("combobox", { name: "Reasoning effort", exact: true })
    const refresh = relay.getByRole("button", { name: "Refresh options", exact: true })

    await expect(model).toHaveValue("gpt-5")
    await expect(model.locator("option")).toHaveText(["GPT-5"])
    await expect(effort).toHaveValue("auto")
    await expect(effort.locator("option")).toHaveText(["Auto", "Fast"])
    await expect(effort.locator('option[value="fast"]')).toHaveAttribute("disabled", "")

    const optionsResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/chat-relay/block-relay/browser/options"),
    )
    await page.clock.fastForward(30_000)
    expect(fixture.browserOptionReads).toEqual([])
    await refresh.click()
    expect((await optionsResponse).status()).toBe(200)
    await expect(model.locator("option")).toHaveText(["GPT-5", "GPT-4o"])
    await expect(effort.locator("option")).toHaveText(["Auto", "High"])

    const modelResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/chat-relay/block-relay/browser/configure"),
    )
    await model.selectOption("gpt-4o")
    expect((await modelResponse).status()).toBe(200)
    await expect(model).toHaveValue("gpt-4o")

    const effortResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/chat-relay/block-relay/browser/configure"),
    )
    await effort.selectOption("high")
    expect((await effortResponse).status()).toBe(200)
    await expect(effort).toHaveValue("high")
    await page.screenshot({ path: testInfo.outputPath("chat-relay-webpage-controls.png"), fullPage: true })

    expect(fixture.browserOptionReads).toEqual([{ tabID: "tab-relay-1" }])
    expect(fixture.browserConfigurations).toEqual([
      { tabID: "tab-relay-1", model: "gpt-4o" },
      { tabID: "tab-relay-1", effort: "high" },
    ])
    expect(fixture.prompts).toEqual([])
    expect(fixture.browserPrompts).toEqual([])
    expect(fixture.browserActions).toEqual([])
    expect(fixture.errors).toEqual([])
  })

  test(`${protocol}: ChatRelay restores webpage choices after rejected configuration`, async ({ page }) => {
    await page.clock.install()
    const fixture = await openCanvasBlockChats(page, protocol, {
      chatRoles: ["relay"],
      chatRelayControls: true,
      chatRelayConfigureError: "The webpage rejected this choice",
      waitForSse: false,
    })
    const relay = page.locator('[data-component="chat-relay"]')
    const model = relay.getByRole("combobox", { name: "Model", exact: true })
    const draft = relay.locator('[data-input="chat-relay-message"]')
    const refresh = relay.getByRole("button", { name: "Refresh options", exact: true })

    await draft.fill("Keep this unsent draft")
    await refresh.click()
    await expect(model.locator("option")).toHaveText(["GPT-5", "GPT-4o"])
    await model.selectOption("gpt-4o")

    await expect(model).toHaveValue("gpt-5")
    await expect(relay.locator(".canvas-relay-options-note")).toHaveText("The webpage rejected this choice")
    await expect(relay.locator(".canvas-relay-delivery-error")).toHaveCount(0)
    await expect(relay.locator('[data-component="chat-relay-transcript"]')).toContainText(
      "ChatGPT independent previous answer",
    )
    await expect(draft).toHaveValue("Keep this unsent draft")
    await page.clock.fastForward(5_000)
    await expect(relay.locator(".canvas-relay-options-note")).toHaveText("The webpage rejected this choice")
    await refresh.click()
    await expect(relay.locator(".canvas-relay-options-note")).toHaveCount(0)
    await expect(draft).toHaveValue("Keep this unsent draft")
    await relay.getByRole("button", { name: "New chat", exact: true }).click()
    await expect(relay.locator(".canvas-relay-options-note")).toHaveCount(0)

    expect(fixture.browserConfigurations).toEqual([{ tabID: "tab-relay-1", model: "gpt-4o" }])
    expect(fixture.prompts).toEqual([])
    expect(fixture.browserPrompts).toEqual([])
    expect(fixture.browserActions).toEqual([])
    expect(fixture.errors).toEqual([])
  })
}
