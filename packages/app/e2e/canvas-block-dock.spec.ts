import { expect, test } from "@playwright/test"
import { openCanvasBlockChats } from "./utils/canvas-block-chats"

test("the block dock toggles with + and creates blocks by drag and drop", async ({ page }) => {
  await openCanvasBlockChats(page, "v2", { waitForSse: false })
  const dock = page.locator(".canvas-block-dock")
  const list = dock.locator(".canvas-block-dock-list")
  const toggle = dock.locator(".canvas-block-dock-toggle")
  const cards = page.locator(".canvas-card")
  const viewport = page.locator(".canvas-viewport")

  await expect(list).toBeHidden()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(dock.getByRole("button", { name: "Expand block menu", exact: true })).toBeVisible()

  await toggle.click()
  await expect(list).toBeVisible()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(dock.getByRole("button", { name: "Collapse block menu", exact: true })).toBeVisible()

  await toggle.click()
  await expect(list).toBeHidden()
  await toggle.click()

  const known = await cards.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.cardId!),
  )
  const bounds = await viewport.boundingBox()
  if (!bounds) throw new Error("The canvas viewport has no bounds")
  const drop = { x: 760, y: 420 }
  await dock
    .getByRole("button", { name: "builtin:master-agent", exact: true })
    .dragTo(viewport, { targetPosition: drop })
  await expect(cards).toHaveCount(known.length + 1)
  await expect(list).toBeVisible()

  // The block is created where it was dropped, not at a default spot.
  const addedID = await cards.evaluateAll(
    (elements, previous) =>
      elements.map((element) => (element as HTMLElement).dataset.cardId!).find((id) => !previous.includes(id)),
    known,
  )
  const box = await page.locator(`[data-card-id="${addedID}"]`).boundingBox()
  if (!box) throw new Error("The created block has no bounds")
  expect(Math.abs(box.x + box.width / 2 - (bounds.x + drop.x))).toBeLessThan(40)
  expect(Math.abs(box.y + box.height / 2 - (bounds.y + drop.y))).toBeLessThan(40)
})

test("a dragged block starts without a session and prompts for one", async ({ page }) => {
  await openCanvasBlockChats(page, "v2", { waitForSse: false })
  await page.route("**/api/workspace/*/master-agent/*", (route) => route.fulfill({ json: { status: "unbound" } }))
  const dock = page.locator(".canvas-block-dock")
  const viewport = page.locator(".canvas-viewport")
  const cards = page.locator(".canvas-card")
  const known = await cards.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.cardId!),
  )

  await dock.getByRole("button", { name: "Expand block menu", exact: true }).click()
  await dock
    .getByRole("button", { name: "builtin:master-agent", exact: true })
    .dragTo(viewport, { targetPosition: { x: 700, y: 420 } })
  await expect(cards).toHaveCount(known.length + 1)

  const addedID = await cards.evaluateAll(
    (elements, previous) =>
      elements.map((element) => (element as HTMLElement).dataset.cardId!).find((id) => !previous.includes(id)),
    known,
  )
  const block = page.locator(`[data-card-id="${addedID}"]`)
  await expect(block).toContainText("Session not initialized")
  await expect(block.getByRole("button", { name: "New session", exact: true })).toBeVisible()
  // No session exists yet, so there is nothing to create a second tab from.
  await expect(block.locator(".canvas-tab-new")).toHaveCount(0)
})
