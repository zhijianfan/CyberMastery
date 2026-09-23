import { expect, test } from "@playwright/test"
import { openCanvasBlockChats } from "./utils/canvas-block-chats"

test("blocks may overlap and layer 0 sits on top", async ({ page }) => {
  const fixture = await openCanvasBlockChats(page, "v2", { waitForSse: false })
  const master = fixture.layout.blocks.find((block) => block.id === "block-master")!
  const packs = fixture.layout.blocks.find((block) => block.id === "block-packs")!
  fixture.layout.blocks = [master, packs]
  master.transform = { x: 120, y: 120, w: 450, h: 520, z: 0 }
  packs.transform = { x: 240, y: 200, w: 320, h: 420, z: 1 }
  await page.reload()

  const masterCard = page.locator('[data-card-id="block-master"]')
  const packsCard = page.locator('[data-card-id="block-packs"]')
  const overlap = async () => {
    const [a, b] = await Promise.all([masterCard.boundingBox(), packsCard.boundingBox()])
    if (!a || !b) throw new Error("both canvas cards must have bounds")
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  }

  await expect(masterCard).toBeVisible()
  await expect(packsCard).toBeVisible()
  await expect(packsCard).toHaveCSS("z-index", "1")
  await expect(masterCard).toHaveCSS("z-index", "0")
  expect(await overlap()).toBe(true)

  const masterLayer = masterCard.getByRole("spinbutton", { name: "Layer", exact: true })
  const packsLayer = packsCard.getByRole("spinbutton", { name: "Layer", exact: true })
  await expect(packsLayer).toHaveValue("0")
  await expect(masterLayer).toHaveValue("1")

  await masterLayer.fill("0")
  await masterLayer.press("Enter")
  await expect(masterLayer).toHaveValue("0")
  await expect(packsLayer).toHaveValue("1")
  await expect(masterCard).toHaveCSS("z-index", "2")
  await expect(packsCard).toHaveCSS("z-index", "1")

  await page.getByTitle("Leave editing mode").click()
  await expect(masterCard.getByRole("spinbutton", { name: "Layer", exact: true })).toHaveCount(0)
  expect(await overlap()).toBe(true)
})
