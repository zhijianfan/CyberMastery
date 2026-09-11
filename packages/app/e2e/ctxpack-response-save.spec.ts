import { expect, test } from "@playwright/test"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import { openCanvasBlockChats } from "./utils/canvas-block-chats"

for (const protocol of ["v1", "v2"] as const) {
  for (const capture of ["selection", "selection-details", "response", "details"] as const) {
    test(`${protocol}: save ${capture} as a CtxPack and refresh the browser from its workspace event`, async ({
      page,
    }, testInfo) => {
      const selection = capture === "selection" || capture === "selection-details"
      const details = capture === "details" || capture === "selection-details"
      const fixture = await openCanvasBlockChats(page, protocol, { chatRoles: ["master"] })
      const created: { request: Omit<CtxPack.CtxPackCreateRequest, "workspaceID">; pack: CtxPack.Info }[] = []
      const pending = Promise.withResolvers<void>()
      const path = `/api/workspace/${fixture.workspaceID}/ctxpack`
      await page.route("**/api/workspace/**/ctxpack**", async (route) => {
        const request = route.request()
        const pathname = new URL(request.url()).pathname
        const json = (value: unknown) =>
          route.fulfill({
            contentType: "application/json",
            body: JSON.stringify(value),
            headers: { "access-control-allow-origin": "*" },
          })
        if (pathname === path && request.method() === "POST") {
          const body: Omit<CtxPack.CtxPackCreateRequest, "workspaceID"> = request.postDataJSON()
          const pack: CtxPack.Info = {
            ...fixture.pack,
            ...body,
            id: CtxPack.ID.make(`ctxpk_saved_${created.length}`),
            tags: [],
            contentHash: "sha256:saved-response",
            fragments: body.fragments.map((fragment, ordinal) => ({
              ...fragment,
              id: CtxPack.FragmentID.make(`ctxpkf_saved_${ordinal}`),
              ordinal,
              contentHash: `sha256:saved-fragment-${ordinal}`,
              byteLength: Buffer.byteLength(fragment.text),
              estimatedTokens: Math.ceil(Buffer.byteLength(fragment.text) / 4),
            })),
          }
          created.push({ request: body, pack })
          if (!details) await pending.promise
          return json(pack)
        }
        if (pathname === path && request.method() === "GET")
          return json({
            items: [fixture.pack, ...created.map((item) => item.pack)].map((pack) => ({
              ...pack,
              workspaceID: fixture.workspaceID,
              fragments: undefined,
              fragmentCount: pack.fragments.length,
              sourceBlockIDs: [...new Set(pack.fragments.map((fragment) => fragment.source.blockID))],
              sourceFunctionalityIDs: [...new Set(pack.fragments.map((fragment) => fragment.source.functionalityID))],
              sourceKinds: ["block-text"],
            })),
            nextCursor: null,
            totalEstimate: created.length + 1,
          })
        const saved = created.find((item) => pathname === `${path}/${item.pack.id}`)
        if (saved && request.method() === "GET") return json(saved.pack)
        return route.fallback()
      })
      const master = page.locator('.block-chat[data-chat-role="master"]')
      const response = master.getByText("ses_master independent previous answer", { exact: true })
      await expect(response).toBeVisible()
      await master.locator('[data-component="prompt-input"]').fill("Do not include this unsent draft")
      const text = selection ? "independent previous" : "ses_master independent previous answer"
      const title = details ? `${selection ? "Selection" : "Response"} saved with details` : text
      const dialog = page.getByRole("dialog", { name: "Create CtxPack", exact: true })
      const saved = page.waitForResponse(
        (response) => response.request().method() === "POST" && new URL(response.url()).pathname === path,
      )
      if (selection) {
        await response.click()
        await response.evaluate((element, selected) => {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
          const nodes: Text[] = []
          while (walker.nextNode()) nodes.push(walker.currentNode as Text)
          const node = nodes.find((node) => node.data.includes(selected))
          if (!node) throw new Error("Expected response text node")
          const range = document.createRange()
          range.setStart(node, node.data.indexOf(selected))
          range.setEnd(node, node.data.indexOf(selected) + selected.length)
          window.getSelection()!.removeAllRanges()
          window.getSelection()!.addRange(range)
        }, text)
        const toolbar = page.getByRole("toolbar", { name: "CtxPack selection actions" })
        await expect(toolbar).toBeVisible()
        const save = toolbar.locator('[data-action="save-response-ctxpack"]')
        const options = toolbar.locator('[data-action="save-response-options"]')
        await expect(save).toBeVisible()
        await expect(options).toBeVisible()
        expect(
          await toolbar
            .getByRole("button")
            .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-action"))),
        ).toEqual(["save-response-ctxpack", "save-response-options"])
        for (const action of ["save-response-ctxpack", "save-response-options"]) {
          const styles = await master
            .locator(`[data-action="${action}"]`)
            .or(toolbar.locator(`[data-action="${action}"]`))
            .evaluateAll((buttons) =>
              buttons.map((button) => {
                const style = getComputedStyle(button)
                return {
                  width: style.width,
                  height: style.height,
                  padding: style.padding,
                  borderRadius: style.borderRadius,
                  color: style.color,
                  background: style.backgroundColor,
                }
              }),
            )
          expect(styles).toHaveLength(2)
          expect.soft(styles[1]).toEqual(styles[0])
        }
        await page.screenshot({ path: testInfo.outputPath(`ctxpack-actions-${capture}.png`), fullPage: true })
        if (!details) {
          await save.click()
          await expect(dialog).toHaveCount(0)
          await expect(save).toBeDisabled()
          await expect(options).toBeDisabled()
          await expect.poll(() => created.length).toBe(1)
          pending.resolve()
        }
        if (details) {
          await options.focus()
          await options.press("ArrowDown")
          const item = page.getByRole("menuitem", { name: "Save with details…", exact: true })
          await expect(item).toBeFocused()
          await expect(page.getByRole("menuitem", { name: "Add to CtxPack draft", exact: true })).toBeVisible()
          await page.evaluate(() => window.getSelection()?.removeAllRanges())
          await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("")
          await expect(item).toBeFocused()
          await item.press("Enter")
        }
      }
      if (!selection) {
        await response.hover()
        const actions = master.locator('[data-slot="text-part-copy-wrapper"]')
        const save = actions.locator('[data-action="save-response-ctxpack"]')
        const options = actions.locator('[data-action="save-response-options"]')
        await expect(save).toBeVisible()
        await expect(options).toBeVisible()
        expect(
          await actions
            .getByRole("button")
            .evaluateAll((buttons) =>
              buttons.map((button) => button.getAttribute("data-action") ?? button.getAttribute("aria-label")),
            ),
        ).toEqual(["Copy response", "save-response-ctxpack", "save-response-options"])
        const copy = await actions.getByRole("button", { name: "Copy response", exact: true }).boundingBox()
        const saveBox = await save.boundingBox()
        const optionsBox = await options.boundingBox()
        expect(saveBox?.width).toBe(copy?.width)
        expect(saveBox?.height).toBe(copy?.height)
        expect(saveBox?.y).toBe(copy?.y)
        expect(saveBox!.x).toBeGreaterThan(copy!.x)
        expect(optionsBox?.width).toBe(copy?.width)
        expect(optionsBox?.height).toBe(copy?.height)
        expect(optionsBox?.y).toBe(copy?.y)
        expect(optionsBox!.x).toBeGreaterThan(saveBox!.x)
        await page.screenshot({ path: testInfo.outputPath(`ctxpack-actions-${capture}.png`), fullPage: true })
        if (capture === "response") {
          await save.click()
          await expect(dialog).toHaveCount(0)
          await expect(save).toBeDisabled()
          await expect(options).toBeDisabled()
          await expect.poll(() => created.length).toBe(1)
          pending.resolve()
        }
        if (capture === "details") {
          await options.focus()
          await options.press("ArrowDown")
          const item = page.getByRole("menuitem", { name: "Save with details…", exact: true })
          await expect(item).toBeVisible()
          await expect(item).toBeFocused()
          await item.press("Escape")
          await expect(item).toHaveCount(0)
          await expect(options).toBeFocused()
          await options.press("Enter")
          await expect(item).toBeFocused()
          await item.press("Enter")
        }
      }

      if (details) {
        await expect(dialog).toBeVisible()
        await expect(page.locator('[data-component="menu-v2-content"]')).toBeHidden()
        await expect(dialog.locator("[data-ctxpack-title-input]")).toHaveValue(text)
        await expect(dialog.locator("[data-ctxpack-fragment]")).toHaveCount(1)
        await dialog.locator("[data-ctxpack-title-input]").fill(title)
        await dialog.locator("[data-ctxpack-keyword-input]").fill("reviewed")
        await dialog.locator("[data-ctxpack-keyword-input]").press("Enter")
        await expect(dialog.locator("[data-ctxpack-keyword-chip]").filter({ hasText: "reviewed" })).toBeVisible()
        await page.screenshot({ path: testInfo.outputPath(`ctxpack-create-${capture}.png`), fullPage: true })
        expect(created).toHaveLength(0)
        await dialog.getByRole("button", { name: "Create CtxPack", exact: true }).click()
      }
      expect((await saved).status()).toBe(200)
      await expect(dialog).toHaveCount(0)
      await expect(page.getByText("CtxPack saved", { exact: true })).toBeVisible()
      expect(created).toHaveLength(1)
      expect(created[0].request.title).toBe(title)
      if (details) expect(created[0].request.keywords).toContain("reviewed")
      expect(created[0].request.fragments).toEqual([
        {
          clientFragmentID: expect.any(String),
          text,
          source: {
            workspaceID: fixture.workspaceID,
            blockID: "block-master",
            functionalityID: "builtin:master-agent",
            kind: "block-text",
            direction: selection ? "unknown" : "received",
            sourceTimestamp: selection ? null : expect.any(Number),
            capturedAt: expect.any(Number),
            entityRef: selection ? null : { type: "message", id: "msg_ses_master_answer" },
            label: null,
            metadata: selection ? {} : { sessionID: "ses_master" },
            sensitivity: "workspace",
          },
        },
      ])

      const refreshed = page.waitForResponse(
        (response) => response.request().method() === "GET" && new URL(response.url()).pathname === path,
      )
      await fixture.transport.send({
        directory: "global",
        payload: {
          id: "evt_ctxpack_saved",
          type: "workspace.ctxpack.changed",
          properties: {
            workspaceID: fixture.workspaceID,
            ctxPackID: created[0].pack.id,
            revision: 1,
            change: "created",
          },
        },
      })
      expect((await refreshed).status()).toBe(200)
      const browser = page.locator('[data-component="ctxpack-browser"]')
      await browser.getByRole("button", { name: `Open context pack ${title}`, exact: true }).click()
      await expect(browser.locator(".ctxpack-browser-fragment-text")).toHaveText(text)
      if (details) await expect(browser.getByText("reviewed", { exact: true })).toBeVisible()
      await expect(master.locator('[data-component="prompt-input"]')).toHaveText("Do not include this unsent draft")
      expect(fixture.prompts).toEqual([])
      expect(fixture.errors).toEqual([])
      await page.screenshot({ path: testInfo.outputPath(`ctxpack-saved-${capture}.png`), fullPage: true })
    })
  }
}

for (const protocol of ["v1", "v2"] as const) {
  for (const capture of ["quick", "details"] as const) {
    test(`${protocol}: ${capture} save a ChatRelay reply without using a model or login endpoint`, async ({
      page,
    }, testInfo) => {
      const fixture = await openCanvasBlockChats(page, protocol, {
        chatRoles: ["relay"],
        waitForSse: false,
      })
      const created: Omit<CtxPack.CtxPackCreateRequest, "workspaceID">[] = []
      const path = `/api/workspace/${fixture.workspaceID}/ctxpack`
      await page.route("**/api/workspace/**/ctxpack**", async (route) => {
        const request = route.request()
        if (request.method() !== "POST" || new URL(request.url()).pathname !== path) return route.fallback()
        const body: Omit<CtxPack.CtxPackCreateRequest, "workspaceID"> = request.postDataJSON()
        created.push(body)
        return route.fulfill({
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({
            ...fixture.pack,
            ...body,
            id: CtxPack.ID.make("ctxpk_relay_saved"),
            contentHash: "sha256:relay-saved",
            fragments: body.fragments.map((fragment, ordinal) => ({
              ...fragment,
              id: CtxPack.FragmentID.make(`ctxpkf_relay_${ordinal}`),
              ordinal,
              contentHash: `sha256:relay-fragment-${ordinal}`,
              byteLength: Buffer.byteLength(fragment.text),
              estimatedTokens: Math.ceil(Buffer.byteLength(fragment.text) / 4),
            })),
          }),
        })
      })

      const relay = page.locator('[data-component="chat-relay"]')
      const response = relay.locator('[data-message-id="relay-previous-answer"]')
      const save = response.locator('[data-action="save-response-ctxpack"]')
      const options = response.locator('[data-action="save-response-options"]')
      await expect(response.getByText("ChatGPT independent previous answer", { exact: true })).toBeVisible()
      await response.hover()
      await expect(save).toBeVisible()
      await expect(options).toBeVisible()
      if (capture === "details")
        await page.screenshot({ path: testInfo.outputPath("chat-relay-ctxpack-actions.png"), fullPage: true })

      if (capture === "quick") {
        const quickCreate = page.waitForResponse(
          (response) => response.request().method() === "POST" && new URL(response.url()).pathname === path,
        )
        await save.click()
        expect((await quickCreate).status()).toBe(200)
        await expect(page.getByText("CtxPack saved", { exact: true })).toBeVisible()
      }
      if (capture === "details") {
        await options.focus()
        await options.press("ArrowDown")
        const item = page.getByRole("menuitem", { name: "Save with details…", exact: true })
        await expect(item).toBeFocused()
        await page.keyboard.press("Enter")
        const dialog = page.getByRole("dialog", { name: "Create CtxPack", exact: true })
        await expect(dialog).toBeVisible()
        await expect(dialog.locator("[data-ctxpack-title-input]")).toHaveValue("ChatGPT independent previous answer")
        await expect(dialog.locator("[data-ctxpack-fragment]")).toHaveCount(1)
        await dialog.locator("[data-ctxpack-title-input]").fill("Saved ChatGPT reply")
        const detailedCreate = page.waitForResponse(
          (response) => response.request().method() === "POST" && new URL(response.url()).pathname === path,
        )
        await dialog.getByRole("button", { name: "Create CtxPack", exact: true }).click()
        expect((await detailedCreate).status()).toBe(200)
        await expect(dialog).toHaveCount(0)
      }

      expect(created).toHaveLength(1)
      expect(created[0].title).toBe(
        capture === "details" ? "Saved ChatGPT reply" : "ChatGPT independent previous answer",
      )
      expect(created[0].fragments).toEqual([
        {
          clientFragmentID: expect.any(String),
          text: "ChatGPT independent previous answer",
          source: {
            workspaceID: fixture.workspaceID,
            blockID: "block-relay",
            functionalityID: "builtin:chat-relay",
            kind: "block-text",
            direction: "received",
            sourceTimestamp: 1,
            capturedAt: expect.any(Number),
            entityRef: { type: "message", id: "relay-previous-answer" },
            label: null,
            metadata: { tabID: "tab-relay-1" },
            sensitivity: "workspace",
          },
        },
      ])
      expect(fixture.prompts).toEqual([])
      expect(fixture.browserPrompts).toEqual([])
      expect(fixture.browserActions).toEqual([])
      expect(fixture.errors).toEqual([])
    })
  }
}
