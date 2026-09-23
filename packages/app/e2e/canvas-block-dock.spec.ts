import { expect, test } from "@playwright/test"
import { openCanvasBlockChats } from "./utils/canvas-block-chats"

test("the block dock stays collapsed until expanded", async ({ page }) => {
  await openCanvasBlockChats(page, "v2", { waitForSse: false })
  const dock = page.locator(".canvas-block-dock")
  const list = dock.locator(".canvas-block-dock-list")
  const cards = page.locator(".canvas-card")

  await expect(list).toBeHidden()
  const expand = dock.getByRole("button", { name: "Expand block panel", exact: true })
  await expect(expand).toHaveAttribute("aria-expanded", "false")

  await expand.click()
  await expect(list).toBeVisible()
  await expect(dock.getByRole("button", { name: "Collapse block panel", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  )

  const before = await cards.count()
  await dock.getByRole("button", { name: "builtin:master-agent", exact: true }).click()
  await expect(cards).toHaveCount(before + 1)
  await expect(list).toBeHidden()

  // The collapsed add button repeats the most recently chosen block type.
  await dock.getByRole("button", { name: "Add Master Agent", exact: true }).click()
  await expect(cards).toHaveCount(before + 2)
})
