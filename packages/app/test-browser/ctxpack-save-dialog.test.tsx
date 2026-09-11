import { expect, mock, test } from "bun:test"
import { createComponent, startTransition } from "solid-js"
import { render } from "solid-js/web"
import type { CtxPackCreateRequestLocal } from "../src/context/ctxpack/create-dialog"

mock.module("@/utils/toast", () => ({ showToast: () => {} }))
const { DialogProvider } = await import("@opencode-ai/ui/context/dialog")
const { LanguageProvider } = await import("../src/context/language")
const { PlatformProvider } = await import("../src/context/platform")
const { CtxPackDraftProvider } = await import("../src/context/ctxpack/draft")
const { CtxPackSelectionOverlay } = await import("../src/context/ctxpack/selection-overlay")

test("selection Save with details opens the actual dialog provider and creates the captured pack", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const source = document.createElement("article")
  source.setAttribute("data-ctxpack-source-root", "")
  source.dataset.workspaceId = "workspace"
  source.dataset.blockId = "operating"
  source.dataset.functionalityId = "builtin:operating-chat-session"
  const response = document.createElement("p")
  response.textContent = "A response worth saving."
  source.append(response)
  const requests: CtxPackCreateRequestLocal[] = []
  const dispose = render(
    () =>
      createComponent(PlatformProvider, {
        value: {
          platform: "web",
          openExternal: () => {},
          restart: async () => {},
          notify: async () => {},
        },
        get children() {
          return createComponent(LanguageProvider, {
            locale: "en",
            get children() {
              return createComponent(DialogProvider, {
                get children() {
                  return createComponent(CtxPackDraftProvider, {
                    workspaceID: () => "workspace",
                    workspaceEpoch: () => 1,
                    get children() {
                      return [
                        source,
                        createComponent(CtxPackSelectionOverlay, {
                          workspaceID: () => "workspace",
                          workspaceEpoch: () => 1,
                          create: async (request) => {
                            requests.push(request)
                            return {
                              id: "ctxpk_saved",
                              title: request.title,
                              keywords: request.keywords,
                              sensitivity: request.sensitivity,
                              revision: 1,
                              contentHash: "hash",
                              byteLength: 24,
                              estimatedTokens: 6,
                              fragments: [],
                              usage: { attachedCount: 0, lastAttachedAt: null },
                              createdAt: 1,
                              updatedAt: 1,
                              deletedAt: null,
                              createdByUserID: "user",
                            }
                          },
                        }),
                      ]
                    },
                  })
                },
              })
            },
          })
        },
      }),
    host,
  )
  try {
    await startTransition(() => {})
    const range = document.createRange()
    range.selectNodeContents(response)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    document.dispatchEvent(new Event("selectionchange"))
    const options = host.querySelector<HTMLButtonElement>('[data-action="save-response-options"]')!
    expect(options.closest<HTMLElement>("[data-ctxpack-selection-toolbar]")!.style.display).not.toBe("none")
    options.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true, pointerType: "mouse" }))
    await startTransition(() => {})
    expect(options.getAttribute("aria-expanded")).toBe("true")
    await new Promise((resolve) => setTimeout(resolve, 20))
    const details = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) =>
      item.textContent?.startsWith("Save with details"),
    )!
    details.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true, pointerType: "mouse" }))
    await startTransition(() => {})
    const title = document.querySelector<HTMLInputElement>("[data-ctxpack-title-input]")
    expect(title?.value).toBe("A response worth saving.")
    const create = document.querySelector<HTMLButtonElement>("[data-ctxpack-save]")!
    expect(create.disabled).toBe(false)
    create.click()
    await startTransition(() => {})
    expect(requests).toHaveLength(1)
    expect(requests[0].fragments.map((fragment) => fragment.text)).toEqual([response.textContent!])
  } finally {
    dispose()
    host.remove()
    window.getSelection()?.removeAllRanges()
  }
})
