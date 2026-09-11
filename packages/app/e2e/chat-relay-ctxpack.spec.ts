import { expect, test } from "@playwright/test"
import { openCanvasBlockChats } from "./utils/canvas-block-chats"

for (const protocol of ["v1", "v2"] as const) {
  test(`${protocol}: ChatRelay keeps a rejected CtxPack-only message for an exact retry`, async ({
    page,
  }, testInfo) => {
    const fixture = await openCanvasBlockChats(page, protocol, {
      chatRoles: ["master", "relay"],
      chatRelayRejectFirstPrompt: true,
      waitForSse: false,
    })
    const relay = page.locator('[data-component="chat-relay"]')
    const master = page.getByRole("group", { name: "Master Agent block", exact: true })
    const browser = page.locator('[data-component="ctxpack-browser"]')
    const card = browser.getByRole("button", { name: `Open context pack ${fixture.pack.title}`, exact: true })
    const materialized = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith(`/ctxpack/${fixture.pack.id}/materialize`),
    )

    await card.dragTo(relay.locator(".canvas-relay-context-composer"))
    expect((await materialized).status()).toBe(200)

    const chips = relay.locator('[data-component="context-attachment-chips"] [data-attachment-id]')
    await expect(chips).toHaveCount(1)
    await expect(chips).toContainText(fixture.pack.title)
    await expect(chips.locator('[data-action="ctxpack-attachment-preview"]')).toHaveCount(1)
    await expect(chips.locator('[data-action="ctxpack-attachment-remove"]')).toHaveCount(1)
    await expect(master.locator("[data-attachment-id]")).toHaveCount(0)
    expect(fixture.materializations).toEqual([
      {
        expectedContentHash: fixture.pack.contentHash,
        targetInstanceID: "block-relay",
        targetFunctionalityID: "builtin:chat-relay",
      },
    ])

    await chips.locator('[data-action="ctxpack-attachment-remove"]').click()
    await expect(chips).toHaveCount(0)
    await relay.locator('[data-input="chat-relay-message"]').click()
    await card.click()
    const detail = browser.locator(`.ctxpack-browser-detail[data-ctxpack-id="${fixture.pack.id}"]`)
    await detail.getByRole("button", { name: /^(Attach to focused input|Send to message)$/ }).click()
    await expect.poll(() => fixture.materializations.length).toBe(2)
    await expect(chips).toHaveCount(1)
    expect(fixture.materializations).toEqual([
      {
        expectedContentHash: fixture.pack.contentHash,
        targetInstanceID: "block-relay",
        targetFunctionalityID: "builtin:chat-relay",
      },
      {
        expectedContentHash: fixture.pack.contentHash,
        targetInstanceID: "block-relay",
        targetFunctionalityID: "builtin:chat-relay",
      },
    ])
    await page.screenshot({ path: testInfo.outputPath("chat-relay-ctxpack-attached.png"), fullPage: true })

    const previewed = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname.endsWith(`/ctxpack/${fixture.pack.id}`),
    )
    await chips.locator('[data-action="ctxpack-attachment-preview"]').click()
    expect((await previewed).status()).toBe(200)
    const preview = page.locator('[data-component="dialog-v2"]')
    await expect(preview.getByRole("heading", { name: fixture.pack.title, exact: true })).toBeVisible()
    await preview.getByRole("button", { name: "Close", exact: true }).click()
    await expect(preview).toHaveCount(0)

    const send = relay.locator('[data-action="chat-relay-send"]')
    await expect(send).toBeEnabled()
    const rejected = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/chat-relay/block-relay/browser/prompt"),
    )
    await send.click()
    expect((await rejected).status()).toBe(409)
    await expect(chips).toHaveCount(1)
    await expect(relay.locator('[data-input="chat-relay-message"]')).toHaveValue("")
    await expect(relay.locator(".canvas-relay-delivery-error")).toContainText("ChatGPT rejected the message")

    const admitted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/chat-relay/block-relay/browser/prompt"),
    )
    await send.click()
    expect((await admitted).status()).toBe(200)
    await expect(chips).toHaveCount(0)

    expect(fixture.browserPrompts).toHaveLength(2)
    expect(fixture.browserPrompts[0]).toEqual(fixture.browserPrompts[1])
    expect(fixture.browserPrompts[0]).toEqual({
      tabID: "tab-relay-1",
      messageID: expect.any(String),
      text: "",
      contextAttachments: [
        {
          contextCapsuleID: "ctxkpsl_parallel_plan",
          contentHash: fixture.pack.contentHash,
          label: fixture.pack.title,
          source: { kind: "ctxpack", ctxPackID: fixture.pack.id },
        },
      ],
    })
    expect(JSON.stringify(fixture.browserPrompts)).not.toContain(fixture.pack.fragments[0].text)
    expect(JSON.stringify(fixture.browserPrompts)).not.toContain("ParallelPlan")
    expect(fixture.prompts).toEqual([])
    expect(fixture.legacyPrompts).toEqual([])
    expect(fixture.browserActions).toEqual([])
    expect(fixture.errors).toEqual([])
  })
}
