import { expect, test } from "@playwright/test"
import { openCanvasBlockChats } from "./utils/canvas-block-chats"

for (const role of ["operating", "master", "relay"] as const) {
  test(`${role}: skill mentions select without sending and reach the correct transport`, async ({ page }) => {
    const fixture = await openCanvasBlockChats(page, "v2", { chatRoles: [role], waitForSse: false })
    await page.route("**/api/fs/find*", (route) =>
      route.fulfill({ json: { data: [] }, headers: { "access-control-allow-origin": "*" } }),
    )
    await page.route("**/api/skill/candidates*", (route) =>
      route.fulfill({
        json: {
          location: { directory: fixture.directory },
          data: [{ name: "review", description: "Review changes", contentHash: "review-v1" }],
        },
        headers: { "access-control-allow-origin": "*" },
      }),
    )
    await page.route("**/chat-relay/block-relay/browser/skills*", (route) =>
      route.fulfill({
        json: [{ name: "review", description: "Review changes", contentHash: "review-v1" }],
        headers: { "access-control-allow-origin": "*" },
      }),
    )
    await page.route("**/chat-relay/block-relay/browser/skill-preview*", (route) =>
      route.fulfill({
        json: {
          name: "review",
          description: "Review changes",
          contentHash: "review-v1",
          content: "Inspect the changed code and report concrete defects.",
        },
        headers: { "access-control-allow-origin": "*" },
      }),
    )
    const chat =
      role === "relay"
        ? page.locator('[data-component="chat-relay"]')
        : page.locator(`.block-chat[data-chat-role="${role}"]`)
    const editor = chat.locator('[data-component="prompt-input"]')
    await expect(editor).toBeEditable()
    await editor.fill("person@example.com")
    await expect(chat.locator('[data-suggestion-id="skill:review"]')).toHaveCount(0)
    await editor.fill("Before after")
    await editor.press("Home")
    for (let index = 0; index < "Before ".length; index++) await editor.press("ArrowRight")
    await editor.pressSequentially("@rev")
    await expect(chat.locator('[data-suggestion-id="skill:review"]')).toBeVisible()
    await editor.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true })
    await expect(editor.locator('[data-mention="skill"]')).toHaveCount(0)
    await expect(chat.locator('[data-suggestion-id="skill:review"]')).toBeVisible()
    expect(fixture.prompts).toHaveLength(0)
    expect(fixture.browserPrompts).toHaveLength(0)
    await editor.press("Enter")
    await expect(editor.locator('[data-mention="skill"]')).toHaveText("@review")
    await expect(editor).toHaveText("Before @review after")
    await expect(chat.locator('[data-suggestion-id="skill:review"]')).toHaveCount(0)
    expect(fixture.prompts).toHaveLength(0)
    expect(fixture.browserPrompts).toHaveLength(0)

    const sent = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname ===
          (role === "relay"
            ? `/api/workspace/${fixture.workspaceID}/chat-relay/block-relay/browser/prompt`
            : `/api/session/ses_${role}/prompt`),
    )
    await editor.press("Enter")
    const body = (await sent).postDataJSON()
    if (role === "relay") {
      expect(body.skills).toEqual([{ name: "review", contentHash: "review-v1" }])
      expect(body.text).toBe("Before @review after")
      expect(body).not.toHaveProperty("content")
      expect(fixture.prompts).toHaveLength(0)
    } else {
      expect(body.prompt.text).toContain('Selected skills: ["review"]')
      expect(body.prompt.text).toContain("Use the skill tool")
      expect(fixture.browserPrompts).toHaveLength(0)
    }
  })
}

test("two chat blocks retain separate skill selections and removal", async ({ page }) => {
  const fixture = await openCanvasBlockChats(page, "v2", { chatRoles: ["operating", "master"], waitForSse: false })
  const catalog = Promise.withResolvers<void>()
  await page.route("**/api/fs/find*", (route) =>
    route.fulfill({ json: { data: [] }, headers: { "access-control-allow-origin": "*" } }),
  )
  await page.route("**/api/skill/candidates*", async (route) => {
    await catalog.promise
    await route.fulfill({
      json: { location: { directory: fixture.directory }, data: [{ name: "review", contentHash: "review-v1" }] },
      headers: { "access-control-allow-origin": "*" },
    })
  })
  const operating = page.locator('.block-chat[data-chat-role="operating"] [data-component="prompt-input"]')
  const master = page.locator('.block-chat[data-chat-role="master"] [data-component="prompt-input"]')
  await expect(operating).toBeEditable()
  await expect(master).toBeEditable()
  await master.fill("Keep this draft")
  const requested = page.waitForRequest("**/api/skill/candidates*")
  await operating.fill("@rev")
  await requested
  await master.click()
  catalog.resolve()
  await expect(master).toHaveText("Keep this draft")
  await expect(page.locator('.block-chat[data-chat-role="master"] [data-suggestion-id="skill:review"]')).toHaveCount(0)
  await operating.click()
  await operating.press("End")
  await expect(
    page.locator('.block-chat[data-chat-role="operating"] [data-suggestion-id="skill:review"]'),
  ).toBeVisible()
  await operating.press("Tab")
  await expect(operating.locator('[data-mention="skill"]')).toHaveText("@review")
  await expect(master).toHaveText("Keep this draft")
  await operating.press("ControlOrMeta+A")
  await operating.press("Backspace")
  await expect(operating.locator('[data-mention="skill"]')).toHaveCount(0)
  await expect(master).toHaveText("Keep this draft")
  expect(fixture.prompts).toHaveLength(0)
})
