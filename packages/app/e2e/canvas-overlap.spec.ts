import { expect, test } from "@playwright/test"
import { openCanvasBlockChats } from "./utils/canvas-block-chats"

test("overlapping blocks stay overlapped and clicking raises a block", async ({ page }) => {
  const fixture = await openCanvasBlockChats(page, "v2", { waitForSse: false })
  const master = fixture.layout.blocks.find((block) => block.id === "block-master")!
  const packs = fixture.layout.blocks.find((block) => block.id === "block-packs")!
  fixture.layout.blocks = [master, packs]
  master.transform = { x: 128, y: 128, w: 448, h: 512, z: 0 }
  packs.transform = { x: 256, y: 192, w: 320, h: 416, z: 1 }
  await page.reload()

  const masterCard = page.locator('[data-card-id="block-master"]')
  const packsCard = page.locator('[data-card-id="block-packs"]')
  const overlap = async () => {
    const [a, b] = await Promise.all([masterCard.boundingBox(), packsCard.boundingBox()])
    if (!a || !b) throw new Error("both canvas cards must have bounds")
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  }
  const zIndex = (locator: typeof masterCard) => locator.evaluate((element) => Number(element.style.zIndex))
  const position = (locator: typeof masterCard) =>
    locator.evaluate((element) => ({ left: element.style.left, top: element.style.top }))

  await expect(masterCard).toBeVisible()
  await expect(packsCard).toBeVisible()
  await expect(masterCard).toHaveCSS("z-index", "0")
  await expect(packsCard).toHaveCSS("z-index", "1")
  expect(await overlap()).toBe(true)

  const before = await position(masterCard)
  const packsZ = await zIndex(packsCard)
  await masterCard.locator(".canvas-card-header").click({ position: { x: 120, y: 14 } })

  await expect.poll(() => zIndex(masterCard)).toBeGreaterThan(packsZ)
  expect(await position(masterCard)).toEqual(before)
  expect(await overlap()).toBe(true)
})
