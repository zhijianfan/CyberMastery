import { expect, test, type Locator } from "@playwright/test"
import { Workspace } from "@opencode-ai/schema/workspace"
import type { WorkspaceLayoutInfo } from "@opencode-ai/sdk/v2/client"
import { Schema } from "effect"
import { openCanvasBlockChats } from "./utils/canvas-block-chats"
import { ctxPackFixture } from "./utils/ctxpack"

test("right-button panning preserves card stacking without saving the layout", async ({ page }) => {
  await page.clock.install()
  const fixture = await openCanvasBlockChats(page, "v2", { chatRoles: ["operating"] })
  const viewport = page.locator(".canvas-viewport")
  const world = viewport.locator(".canvas-world")
  const cards = viewport.locator(".canvas-card")
  const card = page.getByRole("group", { name: "Operating Chat Session block", exact: true })
  await expect(cards).toHaveCount(2)
  await expect(card).toHaveAttribute("data-card-id", "block-operating")
  await expect(card.locator('[data-component="prompt-input"]')).toBeEditable()
  await expect(page.getByText("Canvas workspace · synced", { exact: true })).toBeVisible()
  const stacking = await cards.evaluateAll((elements) =>
    elements.map((element) => ({ id: element.getAttribute("data-card-id"), z: getComputedStyle(element).zIndex })),
  )

  for (const target of [card.locator(".canvas-card-header"), card.locator(".canvas-session-surface")]) {
    await target.hover({ position: { x: 50, y: 50 } })
    const bounds = await target.boundingBox()
    if (!bounds) throw new Error("The pan target has no bounds")
    const start = { x: Math.round(bounds.x + 50), y: Math.round(bounds.y + 50) }
    await page.mouse.move(start.x, start.y)
    const camera = await world.evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
      return { scale: matrix.a, x: matrix.e, y: matrix.f }
    })
    await page.mouse.down({ button: "right" })
    await page.mouse.move(start.x + 37, start.y + 29)
    await expect(world).toHaveCSS(
      "transform",
      `matrix(${camera.scale}, 0, 0, ${camera.scale}, ${camera.x + 37}, ${camera.y + 29})`,
    )
    await page.mouse.up({ button: "right" })
    await expect(viewport).not.toHaveClass(/is-panning/)
    // Advance virtual time past layout persistence; do not hide a debounced save.
    await page.clock.fastForward(1000)
    expect
      .soft(
        await cards.evaluateAll((elements) =>
          elements.map((element) => ({
            id: element.getAttribute("data-card-id"),
            z: getComputedStyle(element).zIndex,
          })),
        ),
      )
      .toEqual(stacking)
    expect.soft(fixture.requests.filter((path) => path === "POST /api/workspace/layout/save")).toEqual([])
  }
})

test("right-button pan stays local and keeps card effects stable through every gesture ending", async ({ page }) => {
  const fixture = await ctxPackFixture(page)
  const viewport = page.locator(".canvas-viewport")
  const world = viewport.locator(".canvas-world")
  const card = page.getByRole("group", { name: "Operating Chat Session block", exact: true })
  const paragraph = card.locator('[data-component="markdown"] p').filter({ hasText: fixture.fragmentText })
  const actions = card.locator(".canvas-header-actions")
  await expect(card).toHaveAttribute("data-card-id", "operating-chat")
  await expect(paragraph).toHaveText(fixture.fragmentText)
  await expect(card).toHaveCSS("backdrop-filter", "none")
  await expect(card).toHaveCSS("transition-duration", "0s")
  await expect(actions).toHaveCSS("transition-duration", "0s")
  const surfaces = page.locator(".canvas-app *")
  const expectFlatSurfaces = () =>
    expect
      .poll(() =>
        surfaces.evaluateAll((elements) =>
          elements.flatMap((element) => {
            const style = getComputedStyle(element)
            return style.backdropFilter !== "none" || style.boxShadow !== "none" || style.filter !== "none"
              ? [
                  {
                    class: element.className,
                    blur: style.backdropFilter,
                    shadow: style.boxShadow,
                    filter: style.filter,
                  },
                ]
              : []
          }),
        ),
      )
      .toEqual([])
  await expectFlatSurfaces()
  await paragraph.click()
  await expect(card).toHaveClass(/selected/)
  await expectFlatSurfaces()
  const position = await card.evaluate((element) => ({ left: element.style.left, top: element.style.top }))
  const pointer = await viewport.evaluateHandle((element) => {
    const state = { id: 0 }
    element.addEventListener("pointerdown", (event) => {
      if (event instanceof PointerEvent) state.id = event.pointerId
    })
    return state
  })

  // The loaded workspace must remain pannable without any further API response.
  await page.route("**/api/**", (route) => route.abort())

  for (const ending of ["release", "cancel", "blur"] as const) {
    await paragraph.hover()
    const bounds = await paragraph.boundingBox()
    if (!bounds) throw new Error("The canvas paragraph has no bounds")
    const start = { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
    await page.mouse.move(start.x, start.y)
    const camera = await world.evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
      return { scale: matrix.a, x: matrix.e, y: matrix.f }
    })
    await page.mouse.down({ button: "right" })
    await expect(viewport).toHaveClass(/is-panning/)
    await expect(card).toHaveCSS("backdrop-filter", "none")
    await expect(card).toHaveCSS("transition-duration", "0s")
    await expect(actions).toHaveCSS("transition-duration", "0s")
    await expectFlatSurfaces()
    await page.mouse.move(start.x + 72, start.y + 48)
    await expect(world).toHaveCSS(
      "transform",
      `matrix(${camera.scale}, 0, 0, ${camera.scale}, ${camera.x + 72}, ${camera.y + 48})`,
    )
    expect(await card.evaluate((element) => ({ left: element.style.left, top: element.style.top }))).toEqual(position)

    if (ending === "release") await page.mouse.up({ button: "right" })
    if (ending === "cancel")
      await viewport.dispatchEvent("pointercancel", {
        pointerId: await pointer.evaluate((state) => state.id),
        pointerType: "mouse",
      })
    if (ending === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")))

    await expect(viewport).not.toHaveClass(/is-panning/)
    await expect(card).toHaveCSS("backdrop-filter", "none")
    await expect(card).toHaveCSS("transition-duration", "0s")
    await expect(actions).toHaveCSS("transition-duration", "0s")
    await expectFlatSurfaces()
    await page.mouse.move(start.x + 96, start.y + 64)
    await expect(world).toHaveCSS(
      "transform",
      `matrix(${camera.scale}, 0, 0, ${camera.scale}, ${camera.x + 72}, ${camera.y + 48})`,
    )
    if (ending !== "release") await page.mouse.up({ button: "right" })
  }
})

test("left-button block dragging still moves only the selected card", async ({ page }) => {
  await ctxPackFixture(page)
  const viewport = page.locator(".canvas-viewport")
  const world = viewport.locator(".canvas-world")
  const card = page.getByRole("group", { name: "Operating Chat Session block", exact: true })
  const header = card.locator(".canvas-card-header")
  await expect(viewport).toHaveClass(/canvas-editing/)
  await expect(card).toHaveAttribute("data-card-id", "operating-chat")
  await expect(card).toHaveCSS("backdrop-filter", "none")
  const camera = await world.evaluate((element) => getComputedStyle(element).transform)
  const position = await card.evaluate((element) => ({
    x: parseFloat(element.style.left),
    y: parseFloat(element.style.top),
  }))
  await header.hover({ position: { x: 10, y: 10 } })
  const bounds = await header.boundingBox()
  if (!bounds) throw new Error("The canvas header has no bounds")
  await page.mouse.down({ button: "left" })
  await expect(card).toHaveClass(/dragging/)
  await expect(viewport).not.toHaveClass(/is-panning/)
  await expect(card).toHaveCSS("backdrop-filter", "none")
  await page.mouse.move(bounds.x + 82, bounds.y + 58)
  const scale = await world.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a)
  await expect(card).toHaveCSS("left", `${position.x + 72 / scale}px`)
  await expect(card).toHaveCSS("top", `${position.y + 48 / scale}px`)
  await expect(world).toHaveCSS("transform", camera)
  await page.mouse.up({ button: "left" })
  await expect(card).not.toHaveClass(/dragging/)
  await expect(card).toHaveCSS("backdrop-filter", "none")
})

test("blocks moved above and left of the origin stay connected and survive reload", async ({ page }) => {
  const fixture = await openCanvasBlockChats(page, "v2", { chatRoles: ["operating"] })
  const card = page.getByRole("group", { name: "Operating Chat Session block", exact: true })
  const header = card.locator(".canvas-card-header")
  const world = page.locator(".canvas-world")
  await expect(card).toHaveAttribute("data-card-id", "block-operating")
  await expect(page.getByText("Canvas workspace · synced", { exact: true })).toBeVisible()
  let savedLayout: WorkspaceLayoutInfo | undefined
  await page.route("**/api/workspace/layout/save", async (route) => {
    const body = route.request().postDataJSON()
    // Exercise the server's actual coordinate contract instead of accepting every save.
    if (!Schema.is(Schema.Array(Workspace.Block.Record))(body.blocks))
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "Invalid layout" }),
      })
    savedLayout = {
      id: "layout-negative-coordinates",
      workspaceID: fixture.workspaceID,
      revision: body.expectedRevision + 1,
      blocks: body.blocks,
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ status: "saved", layout: savedLayout }),
    })
  })
  await page.route("**/api/workspace/layout", (route) =>
    savedLayout
      ? route.fulfill({ contentType: "application/json", body: JSON.stringify(savedLayout) })
      : route.fallback(),
  )

  await header.hover({ position: { x: 10, y: 10 } })
  const origin = await header.boundingBox()
  if (!origin) throw new Error("The canvas header has no bounds")
  await page.mouse.down({ button: "right" })
  await page.mouse.move(origin.x + 310, origin.y + 230)
  await page.mouse.up({ button: "right" })
  await expect(page.locator(".canvas-viewport")).not.toHaveClass(/is-panning/)
  const bounds = await header.boundingBox()
  if (!bounds) throw new Error("The panned canvas header has no bounds")
  const position = await card.evaluate((element) => ({
    x: parseFloat(element.style.left),
    y: parseFloat(element.style.top),
  }))
  const scale = await world.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a)
  const saved = page.waitForResponse((response) => {
    if (!response.url().endsWith("/api/workspace/layout/save") || response.request().method() !== "POST") return false
    const blocks: WorkspaceLayoutInfo["blocks"] = response.request().postDataJSON().blocks
    return blocks.some(
      (block) => block.id === "block-operating" && block.transform.x === -64 && block.transform.y === -48,
    )
  })
  await page.mouse.move(bounds.x + 10, bounds.y + 10)
  await page.mouse.down({ button: "left" })
  await page.mouse.move(bounds.x + 10 + (-64 - position.x) * scale, bounds.y + 10 + (-48 - position.y) * scale)
  await page.mouse.up({ button: "left" })
  expect((await saved).status()).toBe(200)
  await expect(page.getByText("Canvas workspace · synced", { exact: true })).toBeVisible()
  await expect(card).toHaveCSS("left", "-64px")
  await expect(card).toHaveCSS("top", "-48px")
  await page.reload()
  await expect(page.getByText("Canvas workspace · synced", { exact: true })).toBeVisible()
  await expect(card).toHaveCSS("left", "-64px")
  await expect(card).toHaveCSS("top", "-48px")
  expect(fixture.errors).toEqual([])
})

test("block dragging preserves its draft and CtxPack through layout reconciliation", async ({ page }) => {
  const fixture = await openCanvasBlockChats(page, "v2", { chatRoles: ["operating"] })
  const operating = page.locator('.block-chat[data-chat-role="operating"]')
  const editor = operating.locator('[data-component="prompt-input"]')
  const browser = page.locator('[data-component="ctxpack-browser"]')
  const pack = browser.getByRole("button", { name: `Open context pack ${fixture.pack.title}`, exact: true })
  const materialized = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith(`/ctxpack/${fixture.pack.id}/materialize`),
  )
  await pack.dragTo(editor)
  expect((await materialized).status()).toBe(200)

  const chips = operating.locator('[data-component="prompt-input-v2-context-attachments"] [data-attachment-id]')
  await expect(chips).toHaveCount(1)
  await editor.fill("Keep this draft while the block moves")
  const card = page.getByRole("group", { name: "Operating Chat Session block", exact: true })
  const header = card.locator(".canvas-card-header")
  const bounds = await header.boundingBox()
  if (!bounds) throw new Error("The canvas header has no bounds")
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/workspace/layout/save",
  )
  await page.mouse.move(bounds.x + 10, bounds.y + 10)
  await page.mouse.down({ button: "left" })
  await page.mouse.move(bounds.x + 82, bounds.y + 58)
  await page.mouse.up({ button: "left" })
  expect((await saved).status()).toBe(200)

  await page.getByTitle("Tidy the board").click()
  await expect(editor).toHaveText("Keep this draft while the block moves")
  await expect(chips).toHaveCount(1)
  await expect(chips).toContainText(fixture.pack.title)
})

test("the dotted grid stays aligned while panning and zooming", async ({ page }) => {
  await ctxPackFixture(page)
  const viewport = page.locator(".canvas-viewport")
  const grid = viewport.locator(".canvas-grid")
  const world = viewport.locator(".canvas-world")
  await expect(grid).toHaveCSS("background-size", "24px 24px")
  await expectGridAligned(viewport)

  for (const zoom of ["Zoom in", "Zoom out"]) {
    await page.getByRole("button", { name: zoom, exact: true }).click()
    await expect(page.locator(".canvas-zoom-value")).toHaveText(zoom === "Zoom in" ? "112%" : "100%")
    await expectGridAligned(viewport)
    await viewport.hover({ position: { x: 1400, y: 800 } })
    const bounds = await viewport.boundingBox()
    if (!bounds) throw new Error("The canvas viewport has no bounds")
    const start = { x: Math.round(bounds.x + 1400), y: Math.round(bounds.y + 800) }
    await page.mouse.move(start.x, start.y)
    const camera = await world.evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
      return { x: matrix.e, y: matrix.f }
    })
    await page.mouse.down({ button: "right" })
    await expect(viewport).toHaveClass(/is-panning/)
    await page.mouse.move(start.x + 37, start.y - 29)
    await expect
      .poll(() =>
        world.evaluate((element, camera) => {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
          return { x: Number((matrix.e - camera.x).toFixed(2)), y: Number((matrix.f - camera.y).toFixed(2)) }
        }, camera),
      )
      .toEqual({ x: 37, y: -29 })
    await expectGridAligned(viewport)
    await page.mouse.up({ button: "right" })
    await expect(viewport).not.toHaveClass(/is-panning/)
  }
})

test("the canvas keeps panning composited while zoom rerasterizes its contents", async ({ page }) => {
  await openCanvasBlockChats(page, "v2", { chatRoles: ["operating"] })
  const viewport = page.locator(".canvas-viewport")
  const world = viewport.locator(".canvas-world")
  const grid = viewport.locator(".canvas-grid")
  const scaleLayer = viewport.locator(".canvas-world-scale")
  const card = page.getByRole("group", { name: "Operating Chat Session block", exact: true })
  const header = card.locator(".canvas-card-header")

  await expect(world).toHaveCSS("will-change", "transform")
  await expect(grid).toHaveCSS("will-change", "transform")
  await expect(scaleLayer).toHaveCSS("zoom", "1")
  await expect.poll(() => world.evaluate((element) => element.style.transform.startsWith("translate3d("))).toBe(true)
  const bounds = await header.boundingBox()
  if (!bounds) throw new Error("The canvas header has no bounds")
  await page.mouse.move(bounds.x + 10, bounds.y + 10)
  await page.mouse.down({ button: "right" })
  await expect(world).toHaveCSS("will-change", "transform")
  await page.mouse.move(bounds.x + 42, bounds.y + 34)
  await page.mouse.up({ button: "right" })
  await expect(world).toHaveCSS("will-change", "transform")
  await expect(grid).toHaveCSS("will-change", "transform")

  await page.getByRole("button", { name: "Zoom in", exact: true }).click()
  await expect(page.locator(".canvas-zoom-value")).toHaveText("112%")
  await expect(scaleLayer).toHaveCSS("zoom", "1.12")
  await expect(world).toHaveCSS("will-change", "transform")
})

async function expectGridAligned(viewport: Locator) {
  await expect(viewport.locator(".canvas-grid")).toHaveCSS("background-image", /radial-gradient\(/)
  await expect
    .poll(() =>
      viewport.evaluate((element) => {
        const world = element.querySelector(".canvas-world")
        const grid = element.querySelector(".canvas-grid")
        const scaleLayer = element.querySelector(".canvas-world-scale")
        if (!world || !grid || !scaleLayer) throw new Error("The canvas world is missing")
        const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform)
        const gridMatrix = new DOMMatrixReadOnly(getComputedStyle(grid).transform)
        const scale = parseFloat(getComputedStyle(scaleLayer).zoom)
        const style = getComputedStyle(grid)
        const spacing = style.backgroundSize.split(" ").map(parseFloat)
        const x = (gridMatrix.e - matrix.e) / spacing[0]
        const y = (gridMatrix.f - matrix.f) / spacing[1]
        return {
          spacingX: Number(Math.abs(spacing[0] - 24 * scale).toFixed(3)),
          spacingY: Number(Math.abs(spacing[1] - 24 * scale).toFixed(3)),
          offsetX: Number(Math.abs(x - Math.round(x)).toFixed(3)),
          offsetY: Number(Math.abs(y - Math.round(y)).toFixed(3)),
        }
      }),
    )
    .toEqual({ spacingX: 0, spacingY: 0, offsetX: 0, offsetY: 0 })
}
