import { expect, test } from "@playwright/test"
import { openCanvasBlockChats } from "./utils/canvas-block-chats"

for (const role of ["master", "operating", "relay"] as const) {
  test(`${role} removal confirms and archives before hiding the block`, async ({ page }) => {
    const fixture = await openCanvasBlockChats(page, "v2", { chatRoles: [role], sessionTabs: true })
    const kind = role === "master" ? "master-agent" : role === "operating" ? "operating-chat" : "chat-relay"
    const label = role === "master" ? "Master Agent" : role === "operating" ? "Operating Chat" : "Chat Relay"
    const tabCount = role === "relay" ? 1 : 2
    const block = page.locator(`[data-card-id="block-${role}"]`)
    const requests: Record<string, unknown>[] = []
    const saves: { blocks: { id: string }[] }[] = []
    let fail = true
    await page.route(`**/canvas-tab/${kind}/owned/block-${role}**`, (route) =>
      route.fulfill({
        json: {
          items: Array.from({ length: tabCount }, (_, index) => ({
            id: `remove-${index}`,
            workspaceID: fixture.workspaceID,
            kind,
            blockID: `block-${role}`,
            title: `Saved ${index}`,
            createdAt: index,
            conversationID: `ses_${role}`,
            writable: true,
          })),
          next: null,
          selectedTabID: null,
          revision: 4,
          bindingRevision: 1,
        },
      }),
    )
    await page.route("**/api/workspace/layout/save", async (route) => {
      saves.push(route.request().postDataJSON())
      await route.fulfill({ json: { status: "saved", layout: fixture.layout } })
    })
    await page.route(`**/canvas-tab/${kind}/owned/block-${role}/archive-and-remove`, async (route) => {
      requests.push(route.request().postDataJSON())
      if (fail) return route.fulfill({ status: 409, json: { _tag: "CanvasTabStaleRevisionError", message: "Changed" } })
      fixture.layout.blocks = fixture.layout.blocks.filter((item) => item.id !== `block-${role}`)
      fixture.layout.revision = 2
      await route.fulfill({ json: { archivedCount: tabCount, layoutRevision: 2, tabRevision: 5 } })
    })
    await expect(block.getByRole("button", { name: "Remove block", exact: true })).toBeEnabled()
    await block.getByRole("button", { name: "Remove block", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Remove block?", exact: true })
    const confirm = dialog.getByRole("button", { name: "Archive sessions and remove block", exact: true })
    await expect(confirm).toBeEnabled()
    await expect(dialog.getByText(`Sessions to archive: ${tabCount}`, { exact: true })).toBeVisible()
    await expect(
      dialog.getByText(
        `This removes the block. Its sessions remain in the archive and can be restored from other ${label} blocks in this workspace.`,
        { exact: true },
      ),
    ).toBeVisible()
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(block).toBeVisible()
    expect(requests).toEqual([])

    await block.locator(".canvas-card-header").click({ position: { x: 120, y: 14 } })
    await page.keyboard.press(role === "operating" ? "Backspace" : "Delete")
    await expect(confirm).toBeEnabled()
    await confirm.click()
    await expect(dialog.getByRole("alert")).toHaveText(
      "Unable to remove the block. Your session history has been kept. Please try again.",
    )
    await expect(block).toBeVisible()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      expectedRevision: 4,
      expectedLayoutRevision: 1,
      tuple: { user: "", style: "default", deviceClass: "desktop" },
    })
    expect(requests[0].clientID).toEqual(expect.any(String))
    fail = false
    const savesBeforeSuccess = saves.length
    await expect(confirm).toBeEnabled()
    await confirm.click()
    await expect(dialog).toHaveCount(0)
    await expect(block).toHaveCount(0)
    expect(requests).toHaveLength(2)
    // A pending local edit may flush before the archive runs, but no layout
    // save after the authoritative removal may carry the removed block.
    expect(
      saves.slice(savesBeforeSuccess).every((save) => !save.blocks.some((item) => item.id === `block-${role}`)),
    ).toBe(true)
    await page.reload()
    await expect(page.locator('[data-card-id="block-packs"]')).toBeVisible()
    await expect(block).toHaveCount(0)
  })
}

test("ordinary block removal remains immediate", async ({ page }) => {
  await openCanvasBlockChats(page, "v2", { chatRoles: ["master"], sessionTabs: true })
  const block = page.locator('[data-card-id="block-packs"]')
  await expect(block.getByRole("button", { name: "Remove block", exact: true })).toBeEnabled()
  await block.getByRole("button", { name: "Remove block", exact: true }).click()
  await expect(block).toHaveCount(0)
  await expect(page.getByRole("dialog", { name: "Remove block?", exact: true })).toHaveCount(0)
})

test("a session block without tabs is removed without the archive prompt", async ({ page }) => {
  const fixture = await openCanvasBlockChats(page, "v2", { chatRoles: ["master"], sessionTabs: true })
  const block = page.locator('[data-card-id="block-master"]')
  const requests: Record<string, unknown>[] = []
  await page.route("**/canvas-tab/master-agent/owned/block-master**", (route) =>
    route.fulfill({
      json: { items: [], next: null, selectedTabID: null, revision: 0, bindingRevision: undefined },
    }),
  )
  await page.route("**/canvas-tab/master-agent/owned/block-master/archive-and-remove", async (route) => {
    requests.push(route.request().postDataJSON())
    fixture.layout.blocks = fixture.layout.blocks.filter((item) => item.id !== "block-master")
    fixture.layout.revision = 2
    await route.fulfill({ json: { archivedCount: 0, layoutRevision: 2, tabRevision: 1 } })
  })
  await expect(block.getByRole("button", { name: "Remove block", exact: true })).toBeEnabled()
  await block.getByRole("button", { name: "Remove block", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Remove block?", exact: true })).toHaveCount(0)
  await expect(block).toHaveCount(0)
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ expectedRevision: 0, expectedLayoutRevision: 1 })
})
