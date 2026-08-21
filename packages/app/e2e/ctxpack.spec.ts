/**
 * CtxPack end-to-end (T1 verification lane).
 *
 * Authored for `playwright test` (see playwright.config.ts). The full user
 * journey needs a running host with the CtxPack v2 API (create / list / get /
 * materialize + session.prompt). CI without such a host runs the spec with
 * env-driven skips:
 *
 *   CTXPACK_E2E_HOST=1   run the host-dependent scenarios against a real host
 *                        (PLAYWRIGHT_BASE_URL / PLAYWRIGHT_SERVER_PORT).
 *
 * Without the env var, the host scenarios are skipped and the mock-server
 * scenario still verifies the drop -> materialize -> chip -> send transport
 * contract (exactly ONE session.prompt carrying capsule refs, never text) and
 * the failure-rollback draft preservation.
 */

import { expect, test, type Request } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const CTXPACK_DRAG_MIME = "application/x-opencode-ctxpack+json"
const HOSTED = process.env.CTXPACK_E2E_HOST === "1"

test.describe("ctxpack", () => {
  test.describe("host journey (requires CTXPACK_E2E_HOST=1)", () => {
    test("select text in a chat block -> Save as new CtxPack -> dialog defaults -> save -> browser detail shows fragments in order -> drag MIME -> drop on the v2 composer -> chip -> send", async ({
      page,
    }) => {
      // A live host with the ctxpack v2 API is required: the mock server does
      // not implement /api/workspace/*/ctxpack* create/list/get/materialize.
      test.skip(!HOSTED, "requires a running host with the ctxpack v2 API (set CTXPACK_E2E_HOST=1)")

      // Boot a session page with the canvas host + v2 composer.
      const directory = "C:/OpenCode/CtxPackJourney"
      const sessionID = "ses_ctxpack_journey"
      await mockOpenCodeServer(page, {
        directory,
        project: {
          id: "proj_ctxpack_journey",
          worktree: directory,
          vcs: "git",
          name: "ctxpack-journey",
          time: { created: 1700000000000, updated: 1700000000000 },
          sandboxes: [],
        },
        provider: { all: [], connected: [], default: {} },
        sessions: [
          {
            id: sessionID,
            slug: "ctxpack-journey",
            projectID: "proj_ctxpack_journey",
            directory,
            title: "CtxPack journey",
            version: "dev",
            time: { created: 1700000000000, updated: 1700000000000 },
          },
        ],
        pageMessages: () => ({
          items: [
            {
              info: {
                id: "msg_1",
                role: "assistant",
                agent: "build",
                model: { id: "model", providerID: "provider" },
                cost: { total: 0 },
                tokens: { total: 0 },
                time: { created: { ms: 1700000000000 } },
              },
              parts: [{ type: "text", text: "The pump cavitation threshold is 14 kPa post-pressure." }],
            },
          ],
        }),
      })
      await page.addInitScript(() => {
        localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      })
      await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)

      // 1. Select text inside a chat block (data-ctxpack-source-root host wraps
      //    every block body).
      const sourceRoot = page.locator('[data-ctxpack-source-root][data-workspace-id]').first()
      await expectAppVisible(sourceRoot)
      const messageText = sourceRoot.getByText(/pump cavitation threshold/i)
      await expect(messageText).toBeVisible()
      await messageText.selectText()
      // The selection overlay listens on selectionchange/pointerup/keyup.
      await page.evaluate(() => {
        document.dispatchEvent(new Event("selectionchange"))
        document.dispatchEvent(new PointerEvent("pointerup"))
      })

      // 2. Toolbar appears with the frozen actions; click "Save as new CtxPack".
      const toolbar = page.locator('[data-ctxpack-selection-toolbar]')
      await expect(toolbar).toBeVisible()
      await toolbar.getByRole("button", { name: "Save as new CtxPack" }).click()

      // 3. Create dialog: defaults derived from the captured fragment.
      const dialog = page.locator('[data-component="dialog-v2"]').filter({ hasText: "Create CtxPack" })
      await expect(dialog).toBeVisible()
      const titleInput = dialog.locator('[data-ctxpack-title-input]')
      await expect(titleInput).toBeVisible()
      // Default title is derived from the fragment text (create-dialog.tsx
      // defaultTitle memo) and the workspace sensitivity is preselected.
      await expect(titleInput).not.toHaveValue("")
      const defaultSensitivity = dialog.locator('[data-ctxpack-sensitivity="workspace"]')
      await expect(defaultSensitivity).toBeVisible()

      // 4. Save: the create facade posts to the host's v2 ctxpack API.
      const createRequest = page.waitForRequest((request) =>
        request.method() === "POST" && /\/api\/workspace\/[^/]+\/ctxpack$/.test(new URL(request.url()).pathname),
      )
      await dialog.locator('[data-ctxpack-save]').click()
      const created = await createRequest
      const createBody = created.postDataJSON()
      expect(createBody).toBeDefined()
      // The create payload carries fragments with normalized text — no secret
      // material beyond the user's own selection.
      expect(createBody.fragments.length).toBeGreaterThanOrEqual(1)
      const packID = "ctxpk_" + created.url().split("/").pop()

      // 5. Open the CtxPackBrowser block via the canvas module palette.
      //    (The palette entry was registered by M1 in workspace.tsx MODULES.)
      const palette = page.locator('.canvas-block-palette[role="listbox"]')
      await palette.locator('.canvas-palette-item', { hasText: "CtxPack Browser" }).click()
      const browserBlock = page.locator('[data-component="ctxpack-browser"]').first()
      await expect(browserBlock).toBeVisible()

      // 6. Detail shows fragments in request order (ordinal data attribute).
      const card = browserBlock.locator(`[data-ctxpack-id="${packID}"]`)
      await expect(card).toBeVisible()
      await card.click()
      const detail = browserBlock.locator(".ctxpack-browser-detail")
      await expect(detail).toBeVisible()
      const ordinals = await detail.locator(".ctxpack-browser-fragment").evaluateAll((nodes) =>
        nodes.map((node) => Number(node.getAttribute("data-ordinal"))),
      )
      expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b))

      // 7. The drag handle writes the frozen MIME payload (identity only).
      const dragHandle = detail.getByRole("button", { name: "Drag pack to attach" })
      await expect(dragHandle).toBeVisible()

      // 8. Drop on the v2 composer -> chip appears.
      const composer = page.locator('[data-component="prompt-input-v2"]')
      await expectAppVisible(composer)
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
      const packTitle = await detail.locator(".ctxpack-browser-detail-title").textContent()
      await dataTransfer.evaluate(
        (transfer: DataTransfer, payload: string) => {
          transfer.setData("application/x-opencode-ctxpack+json", payload)
          transfer.setData("text/plain", "ctxpk payload")
        },
        JSON.stringify({
          version: 1,
          workspaceID: "wrk_1",
          ctxPackID: packID,
          contentHash: "sha256:mock",
          label: packTitle?.trim() ?? packID,
          estimatedTokens: 42,
        }),
      )
      await composer.dispatchEvent("dragover", { dataTransfer })
      await composer.dispatchEvent("drop", { dataTransfer })
      const chips = page.locator('[data-component="prompt-input-v2-context-attachments"] [data-attachment-id]')
      await expect(chips.first()).toBeVisible()

      // 9. Send: EXACTLY ONE session.prompt carrying capsule refs (no text).
      const promptRequests: Request[] = []
      page.on("request", (request) => {
        if (request.method() !== "POST") return
        if (!/\/session\/[^/]+\/message$/.test(new URL(request.url()).pathname)) return
        promptRequests.push(request)
      })
      const input = composer.locator('[data-component="prompt-input"]')
      await input.fill("Summarize the attached pack")
      await input.press("Enter")
      await expect.poll(() => promptRequests.length).toBe(1)
      const body = promptRequests[0]!.postDataJSON()
      expect(body.contextAttachments).toHaveLength(1)
      expect(body.contextAttachments[0]).toMatchObject({
        contextCapsuleID: expect.any(String),
        label: expect.any(String),
        contentHash: expect.any(String),
        source: { kind: "ctxpack", ctxPackID: packID },
      })
      // Capsule refs, never fragment text.
      const serialized = JSON.stringify(body.contextAttachments)
      expect(serialized).not.toContain("fragment")
      expect(serialized).not.toContain("cavitation")
    })
  })

  test.describe("mock-server transport (runs in CI without a host)", () => {
    const directory = "C:/OpenCode/CtxPackTransport"
    const sessionID = "ses_ctxpack_transport"
    const workspaceID = "wrk_ctxpack_transport"
    const packID = "ctxpk_e2e_transport"
    const capsuleID = "ctxkpsl_e2e_transport_1"
    const packLabel = "Transport pack"

    const boot = async (page: import("@playwright/test").Page) => {
      await mockOpenCodeServer(page, {
        directory,
        project: {
          id: "proj_ctxpack_transport",
          worktree: directory,
          vcs: "git",
          name: "ctxpack-transport",
          time: { created: 1700000000000, updated: 1700000000000 },
          sandboxes: [],
        },
        provider: { all: [], connected: [], default: {} },
        sessions: [
          {
            id: sessionID,
            slug: "ctxpack-transport",
            projectID: "proj_ctxpack_transport",
            directory,
            title: "CtxPack transport",
            version: "dev",
            time: { created: 1700000000000, updated: 1700000000000 },
          },
        ],
        pageMessages: () => ({ items: [] }),
      })

      // In-spec route stubs for the CtxPack v2 API + session prompt. Registered
      // AFTER mockOpenCodeServer so they take precedence (Playwright matches
      // the most recently registered route first); unmatched requests fall
      // through to the mock server.
      const cors = {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      }
      await page.route("**/api/workspace/*/ctxpack/*/materialize", async (route) => {
        if (route.request().method() === "OPTIONS") {
          return route.fulfill({ status: 204, headers: cors })
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: cors,
          body: JSON.stringify({
            contextCapsuleID: capsuleID,
            sourceCtxPackID: packID,
            label: packLabel,
            contentHash: "sha256:transport",
            estimatedTokens: 42,
          }),
        })
      })
    }

    const dropPayload = async (page: import("@playwright/test").Page) => {
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
      await dataTransfer.evaluate(
        (transfer: DataTransfer, payload: string) => {
          transfer.setData("application/x-opencode-ctxpack+json", payload)
          transfer.setData("text/plain", "Transport pack")
        },
        JSON.stringify({
          version: 1,
          workspaceID,
          ctxPackID: packID,
          contentHash: "sha256:transport",
          label: packLabel,
          estimatedTokens: 42,
        }),
      )
      return dataTransfer
    }

    test("drop -> materialize -> chip; send fires EXACTLY ONE session.prompt carrying capsule refs, never text", async ({
      page,
    }) => {
      await boot(page)
      await page.addInitScript(() => {
        localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      })
      await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)

      const composer = page.locator('[data-component="prompt-input-v2"]')
      await expectAppVisible(composer)

      // Drop the frozen-MIME payload on the composer.
      const dataTransfer = await dropPayload(page)
      await composer.dispatchEvent("dragover", { dataTransfer })
      await composer.dispatchEvent("drop", { dataTransfer })

      // Chip appears with the pack label and the capsule id stamped on it.
      const chip = page.locator(
        `[data-component="prompt-input-v2-context-attachments"] [data-attachment-id]`,
      )
      await expect(chip.first()).toBeVisible()
      await expect(chip.first()).toContainText(packLabel)

      // Send: count prompt POSTs (register before the action).
      const promptRequests: Request[] = []
      page.on("request", (request) => {
        if (request.method() !== "POST") return
        if (!/\/session\/[^/]+\/message$/.test(new URL(request.url()).pathname)) return
        promptRequests.push(request)
      })
      await page.route("**/session/*/message", async (route) => {
        if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204 })
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ info: { id: "msg_transport", role: "user" }, parts: [] }),
        })
      })

      const input = composer.locator('[data-component="prompt-input"]')
      await input.fill("Summarize the attached pack")
      await input.press("Enter")

      // EXACTLY ONE prompt request, carrying the capsule reference.
      await expect.poll(() => promptRequests.length).toBe(1)
      const body = promptRequests[0]!.postDataJSON()
      expect(body.contextAttachments).toHaveLength(1)
      expect(body.contextAttachments[0]).toMatchObject({
        contextCapsuleID: capsuleID,
        label: packLabel,
        contentHash: "sha256:transport",
        source: { kind: "ctxpack", ctxPackID: packID },
      })
      const serialized = JSON.stringify(body.contextAttachments)
      expect(serialized).not.toContain("fragment")
      expect(serialized).not.toContain("cavitation")
    })

    test("a failed prompt keeps the draft text and the chip (rollback)", async ({ page }) => {
      await boot(page)
      await page.addInitScript(() => {
        localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      })
      await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)

      const composer = page.locator('[data-component="prompt-input-v2"]')
      await expectAppVisible(composer)
      const dataTransfer = await dropPayload(page)
      await composer.dispatchEvent("dragover", { dataTransfer })
      await composer.dispatchEvent("drop", { dataTransfer })
      const chip = page.locator(
        `[data-component="prompt-input-v2-context-attachments"] [data-attachment-id]`,
      )
      await expect(chip.first()).toBeVisible()

      // The prompt endpoint fails after admission: the draft must be restored.
      await page.route("**/session/*/message", async (route) => {
        await route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
      })

      const input = composer.locator('[data-component="prompt-input"]')
      await input.fill("keep this draft")
      await input.press("Enter")

      // Failure rollback: the typed text and the chip survive the failed send.
      await expect(input).toHaveText("keep this draft")
      await expect(chip.first()).toBeVisible()
    })
  })
})
