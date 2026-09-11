import { expect, test } from "@playwright/test"
import { openCanvasBlockChats } from "./utils/canvas-block-chats"

const blocks = [
  { id: "block-context", functionality: "builtin:context", title: "Project Context" },
  { id: "block-tools", functionality: "builtin:tools", title: "Tool Activity" },
  { id: "block-files", functionality: "builtin:files", title: "Workspace Files" },
  { id: "block-notes", functionality: "builtin:notes", title: "Scratchpad" },
  { id: "block-voice", functionality: "builtin:voice", title: "Voice Input" },
  { id: "block-packs", functionality: "builtin:ctxpack-browser", title: "Context Packs" },
  { id: "block-operating", functionality: "builtin:operating-chat-session", title: "Operating Chat Session" },
  { id: "block-master", functionality: "builtin:master-agent", title: "Master Agent" },
  { id: "block-relay", functionality: "builtin:chat-relay", title: "ChatRelay" },
] as const

for (const theme of ["dark", "light"] as const) {
  for (const size of [
    { width: 440, height: 476 },
    { width: 248, height: 476 },
    { width: 248, height: 124 },
  ]) {
    test(`${theme}: all canvas blocks fit ${size.width}x${size.height}px cards`, async ({ page }, testInfo) => {
      const fixture = await openCanvasBlockChats(page, "v2", { waitForSse: false, chatRelayControls: true })
      const layout = {
        workspaceID: fixture.workspaceID,
        revision: 2,
        blocks: blocks.map((block, index) => ({
          id: block.id,
          functionality: block.functionality,
          transform: {
            x: 28 + (index % 3) * (size.width + 24),
            y: 90 + Math.floor(index / 3) * (size.height + 24),
            w: size.width,
            h: size.height,
            z: index,
          },
          configuration: { version: 1, directoryBinding: { mode: "workspace-primary" }, sessionBinding: null },
        })),
      }
      await page.route(`**/api/workspace/${fixture.workspaceID}/functionality`, (route) =>
        route.fulfill({
          headers: { "access-control-allow-origin": "*" },
          json: blocks.map((block) => ({
            id: block.functionality,
            kind: "builtin",
            label: block.title,
            minW: 248,
            minH: 124,
            maxW: null,
            maxH: null,
          })),
        }),
      )
      await page.route("**/api/workspace/layout**", (route) =>
        route.fulfill({
          headers: { "access-control-allow-origin": "*" },
          json: new URL(route.request().url()).pathname.endsWith("/save") ? { status: "saved", layout } : layout,
        }),
      )
      await page.addInitScript((theme) => {
        localStorage.setItem("opencode-color-scheme", theme)
        localStorage.setItem(
          "opencode.canvas.frame.v1",
          JSON.stringify({ camera: { x: 0, y: 0, scale: 1 }, editing: false }),
        )
      }, theme)
      await page.setViewportSize({
        width: Math.max(1440, size.width * 3 + 160),
        height: Math.max(900, size.height * 3 + 272),
      })
      await page.reload()
      await expect(page.locator("html")).toHaveAttribute("data-color-scheme", theme)
      await expect(page.locator(".canvas-card")).toHaveCount(blocks.length)
      await expect(page.getByRole("group", { name: "Master Agent block", exact: true })).toContainText(
        size.height > 124 ? "independent previous answer" : "Ready",
      )
      await expect(page.locator('[data-input="chat-relay-message"]')).toBeEnabled()
      await expect(page.locator('[data-component="ctxpack-browser"]')).toContainText(fixture.pack.title)
      await expect(page.getByRole("textbox", { name: "Scratchpad", exact: true })).toBeEnabled()
      await testInfo.attach("context-pack-layout", {
        body: JSON.stringify({
          search: await page.locator(".ctxpack-browser-search").boundingBox(),
          sort: await page.locator(".ctxpack-browser-sort").boundingBox(),
        }),
        contentType: "application/json",
      })

      await page.screenshot({ path: testInfo.outputPath("all-blocks.png"), fullPage: true })
      if (size.height === 124) {
        const relay = page.getByRole("group", { name: "ChatRelay block", exact: true })
        const body = relay.locator(".canvas-card-body")
        const camera = await page.locator(".canvas-world").evaluate((element) => getComputedStyle(element).transform)
        await relay.locator(".canvas-relay-auth-status").hover()
        const scroll = await body.evaluate((element) => element.scrollTop)
        await page.mouse.wheel(0, 120)
        await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(scroll)
        await expect(page.locator(".canvas-world")).toHaveCSS("transform", camera)
      }
      for (const block of blocks) {
        const card = page.getByRole("group", { name: `${block.title} block`, exact: true })
        await expect(card.getByRole("heading", { name: block.title, exact: true })).toBeVisible()
        await card.screenshot({ path: testInfo.outputPath(`${block.id}.png`) })
        const overflow = await card.evaluate((card) => {
          const outer = card.getBoundingClientRect()
          return Array.from(
            card.querySelectorAll<HTMLElement>(
              ".canvas-card-header, .canvas-card-body, button, input, select, textarea, [contenteditable=true]",
            ),
          )
            .filter((element) => element.checkVisibility() && element.getBoundingClientRect().width > 0)
            .flatMap((element) => {
              const box = element.getBoundingClientRect()
              const frame =
                element.classList.contains("canvas-card-header") || element.classList.contains("canvas-card-body")
              if (
                box.left >= outer.left - 1 &&
                box.right <= outer.right + 1 &&
                (!frame || (box.top >= outer.top - 1 && box.bottom <= outer.bottom + 1))
              )
                return []
              return [
                {
                  label:
                    element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 70) ?? element.tagName,
                  left: Math.round(box.left - outer.left),
                  right: Math.round(box.right - outer.right),
                  top: Math.round(box.top - outer.top),
                  bottom: Math.round(box.bottom - outer.bottom),
                },
              ]
            })
        })
        expect.soft(overflow, `${block.title} has controls outside its card`).toEqual([])
        if (size.height === 124) {
          const controls = card.locator(
            'input:not([type="hidden"]):not([type="file"]), select, textarea, [contenteditable="true"], [data-action="scratchpad-submit"], [data-action="chat-relay-send"], button[aria-label="Toggle listening"]',
          )
          for (const control of await controls.all()) {
            await control.scrollIntoViewIfNeeded()
            await expect
              .configure({ soft: true })
              .poll(
                () =>
                  control.evaluate((element) => {
                    const box = element.getBoundingClientRect()
                    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
                    return hit === element || element.contains(hit)
                  }),
                { message: `${block.title} control center should be reachable by scrolling` },
              )
              .toBe(true)
          }
        }
      }
      expect(fixture.errors).toEqual([])
      expect(fixture.browserPrompts).toEqual([])
      expect(fixture.prompts).toEqual([])
      expect(fixture.browserActions).toEqual([])
    })
  }
}
