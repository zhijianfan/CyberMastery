import { expect, test } from "@playwright/test"
import { openCanvasBlockChats } from "./utils/canvas-block-chats"

test("archives an inactive session tab after confirmation and restores it", async ({ page }) => {
  const fixture = await openCanvasBlockChats(page, "v2", { chatRoles: ["master"], sessionTabs: true })
  const layout = fixture.layout.blocks.find((block) => block.id === "block-master")!
  layout.transform = { ...layout.transform, x: 20, w: 900 }
  await page.reload()

  const master = page.locator('[data-card-id="block-master"]')
  const strip = master.locator(".canvas-tab-strip")
  const confirm = strip.locator(".canvas-tab-confirm")
  await expect(strip.getByRole("tab", { name: "master conversation", exact: true })).toBeVisible()
  // A block with one tab keeps it; there is nothing to archive yet.
  await expect(strip.locator(".canvas-tab-close")).toHaveCount(0)

  await strip.getByRole("button", { name: "New session", exact: true }).click()
  await expect(strip.getByRole("tab", { name: "Fresh master conversation", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  const firstItem = strip
    .locator(".canvas-tab-item")
    .filter({ has: page.getByRole("tab", { name: "master conversation", exact: true }) })

  await firstItem.locator(".canvas-tab-close").click()
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText("Archive this session?")
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await expect(strip.getByRole("tab", { name: "master conversation", exact: true })).toBeVisible()

  await firstItem.locator(".canvas-tab-close").click()
  await confirm.getByRole("button", { name: "Archive", exact: true }).click()
  await expect(strip.getByRole("tab", { name: "master conversation", exact: true })).toHaveCount(0)
  await expect(strip.getByRole("tab", { name: "Fresh master conversation", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )

  await strip.getByRole("button", { name: "Session history", exact: true }).click()
  const archived = strip.locator('[role="option"]').filter({ hasText: /^master conversation$/ })
  await expect(archived).toBeVisible()
  await archived.click()
  await expect(strip.getByRole("tab", { name: "master conversation", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  expect(fixture.errors).toEqual([])
})
