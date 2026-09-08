/** @jsxImportSource solid-js */
/**
 * CtxPack create dialog tests (U4).
 *
 * Renders the dialog with the real U1 draft provider (controller grabbed via
 * a Probe child so tests can seed/assert the draft), the real solid client
 * runtime, and a fake dialog context that mimics the repo's portal mount
 * (Kobalte Root + Portal into document.body).
 */
import { afterEach, describe, expect, it, mock } from "bun:test"

import type { CtxPackDraftController } from "./draft"
import type { CapturedCtxPackFragment, CtxPackSensitivity } from "./selection"
import type { CtxPackCreateRequestLocal, CtxPackInfoLocal } from "./create-dialog"

const clientSolid = import.meta.resolve("solid-js").replace("dist/server.js", "dist/dev.js")
const clientWeb = import.meta.resolve("solid-js/web").replace("dist/server.js", "dist/web.js")

if (import.meta.resolve("solid-js").includes("dist/server.js")) mock.module("solid-js", () => require(clientSolid))
if (import.meta.resolve("solid-js/web").includes("dist/server.js"))
  mock.module("solid-js/web", () => require(clientWeb))

const dialogState: {
  open: boolean
  onClose: (() => void) | undefined
  dispose: (() => void) | undefined
} = { open: false, onClose: undefined, dispose: undefined }

function closeFakeDialog() {
  if (!dialogState.open) return
  dialogState.open = false
  const callback = dialogState.onClose
  dialogState.onClose = undefined
  dialogState.dispose?.()
  dialogState.dispose = undefined
  callback?.()
}

mock.module("@opencode-ai/ui/context/dialog", () => ({
  DialogProvider: (props: { children?: unknown }) => props.children,
  useDialog: () => ({
    get active() {
      return dialogState.open ? ({ id: "fake" } as never) : undefined
    },
    show: (element: () => unknown, onClose?: () => void) => {
      closeFakeDialog()
      // render() returns the root's dispose, which removes the portaled DOM.
      const dispose = render(
        () =>
          createComponent(KobalteDialog, {
            modal: true,
            open: true,
            onOpenChange: (isOpen: boolean) => {
              if (!isOpen) closeFakeDialog()
            },
            // Lazy child: the Portal must be created inside the Root's render
            // scope so Kobalte's dialog context is available to the content.
            children: (() =>
              createComponent(KobalteDialog.Portal, {
                children: element() as unknown as Element,
              })) as unknown as Element,
          }),
        document.body,
      )
      dialogState.onClose = onClose
      dialogState.dispose = dispose
      dialogState.open = true
    },
    close: () => closeFakeDialog(),
    push: () => {},
  }),
}))

const { createSignal, createComponent, createEffect, untrack } = await import("solid-js")
const { render } = await import("solid-js/web")
const { default: h } = await import("solid-js/h")

// React classic-JSX shim (repo convention): bun compiles JSX to
// React.createElement regardless of the solid pragma, so route it into
// solid's createComponent / h. Static element children are wrapped in a lazy
// accessor (as the solid compiler does) so they evaluate inside the parent's
// render scope — required for context propagation and reactivity; children
// that are already functions (e.g. `For` render props) pass through raw.
function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) {
    const value = children.length > 1 ? children : children[0]
    next.children = typeof value === "function" ? value : () => value
  }
  return createComponent(tag as never, next)
}
const Fragment = (props: { children?: unknown }) => props.children
;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

const { Dialog: KobalteDialog } = await import("@kobalte/core/dialog")
const { CtxPackCreateDialog } = await import("./create-dialog")
const { CtxPackDraftProvider, useCtxPackDraft } = await import("./draft")

const DIALOG_SENTINEL = "CTXPACK_SECRET_SENTINEL_7812"

function makeInfo(): CtxPackInfoLocal {
  return {
    id: "pack-1",
    title: "Pack",
    keywords: [],
    sensitivity: "workspace",
    revision: 1,
    contentHash: "h",
    byteLength: 10,
    estimatedTokens: 3,
    fragments: [],
    usage: { attachedCount: 0, lastAttachedAt: null },
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    createdByUserID: "u-1",
  }
}

function makeFragment(
  id: string,
  text: string,
  sensitivity: CtxPackSensitivity = "workspace",
): CapturedCtxPackFragment {
  return {
    clientFragmentID: id,
    text,
    source: {
      workspaceID: "ws-1",
      blockID: `block-${id}`,
      functionalityID: "builtin:chat",
      kind: "block-text",
      direction: "unknown",
      sourceTimestamp: null,
      capturedAt: 1718000000000,
      entityRef: null,
      label: null,
      metadata: {},
      sensitivity,
    },
  }
}

interface Mounted {
  dispose: () => void
  container: HTMLElement
}

const mounted: Mounted[] = []

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!
    entry.dispose()
    entry.container.remove()
  }
  closeFakeDialog()
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function q<T extends Element = HTMLElement>(selector: string, root: ParentNode = document.body): T | null {
  return root.querySelector<T>(selector)
}

function qAll<T extends Element = HTMLElement>(selector: string, root: ParentNode = document.body): T[] {
  return [...root.querySelectorAll<T>(selector)]
}

function typeInto(el: HTMLInputElement, value: string): void {
  el.value = value
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

function pressKey(el: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  return event
}

function chooseRadio(value: CtxPackSensitivity): void {
  const radio = q<HTMLInputElement>(`[data-ctxpack-sensitivity="${value}"]`)!
  radio.checked = true
  radio.dispatchEvent(new Event("change", { bubbles: true }))
}

function Probe(props: {
  onController: (controller: CtxPackDraftController) => void
  seed?: (controller: CtxPackDraftController) => void
}) {
  const controller = useCtxPackDraft()
  props.onController(controller)
  // Seed in an untracked effect: it flushes after the controller's
  // clear-on-epoch effect (which would wipe a render-time seed) and before
  // the dialog's open effect (which initializes fields from the draft).
  createEffect(() => {
    untrack(() => props.seed?.(controller))
  })
  return null
}

/**
 * Mounts the dialog (open by default). `seed` runs during render (via the
 * Probe child) so the dialog initializes with the seeded draft.
 */
async function mountDialog(
  createImpl: (request: CtxPackCreateRequestLocal) => Promise<CtxPackInfoLocal>,
  seed?: (controller: CtxPackDraftController) => void,
) {
  const [open, setOpen] = createSignal(true)
  const [ws] = createSignal<string | undefined>("ws-1")
  let controller: CtxPackDraftController | undefined
  const created: CtxPackInfoLocal[] = []
  const requests: CtxPackCreateRequestLocal[] = []
  const container = document.createElement("div")
  document.body.appendChild(container)
  // Built with explicit createComponent + function children (JSX evaluates
  // children eagerly, which would run Probe before the provider mounts).
  const dispose = render(
    () =>
      createComponent(CtxPackDraftProvider, {
        workspaceID: ws,
        workspaceEpoch: () => 1,
        children: (() => [
          createComponent(Probe, { onController: (next) => (controller = next), seed }),
          createComponent(CtxPackCreateDialog, {
            open,
            onClose: () => setOpen(false),
            workspaceID: ws,
            create: async (request) => {
              requests.push(request)
              return createImpl(request)
            },
            onCreated: (pack) => created.push(pack),
          }),
        ]) as unknown as Element,
      }),
    container,
  )
  mounted.push({ dispose, container })
  await tick()
  return {
    controller: () => controller!,
    setOpen,
    created,
    requests,
    titleInput: () => q<HTMLInputElement>("[data-ctxpack-title-input]")!,
    keywordInput: () => q<HTMLInputElement>("[data-ctxpack-keyword-input]")!,
    save: () => q<HTMLButtonElement>("[data-ctxpack-save]")!,
    cancel: () => q<HTMLButtonElement>("[data-ctxpack-cancel]")!,
    discard: () => q<HTMLButtonElement>("[data-ctxpack-discard]")!,
    error: () => q<HTMLElement>("[data-ctxpack-error]"),
    chips: () => qAll<HTMLElement>("[data-ctxpack-keyword-chip]"),
    fragmentRows: () => qAll<HTMLElement>("[data-ctxpack-fragment]"),
  }
}

describe("CtxPackCreateDialog", () => {
  it("defaults the title to the first non-empty line, truncated to 80, editable to 120", async () => {
    const harness = await mountDialog(
      async () => makeInfo(),
      (ctl) => {
        ctl.add(makeFragment("f1", "First line of the pack\n\nSecond line here"))
      },
    )
    expect(harness.titleInput().value).toBe("First line of the pack")

    // Long first line is truncated to 80 display code points.
    const long = await mountDialog(
      async () => makeInfo(),
      (ctl) => {
        ctl.add(makeFragment("f2", "x".repeat(90)))
      },
    )
    expect(Array.from(long.titleInput().value)).toHaveLength(80)

    // Editable up to 120 code points.
    typeInto(long.titleInput(), "y".repeat(130))
    expect(Array.from(long.titleInput().value)).toHaveLength(120)
  })

  it("prefills keyword suggestions and keeps the chip list editable (add, remove, cap 12)", async () => {
    const harness = await mountDialog(
      async () => makeInfo(),
      (ctl) => {
        ctl.add(makeFragment("f1", "React hooks guide state management"))
      },
    )
    const chipTexts = () => harness.chips().map((chip) => (chip.childNodes[0]?.textContent ?? "").trim())
    expect(chipTexts()).toEqual(expect.arrayContaining(["React", "hooks", "guide"]))

    // Add via Enter.
    typeInto(harness.keywordInput(), "networking")
    pressKey(harness.keywordInput(), "Enter")
    expect(chipTexts()).toContain("networking")

    // Remove a chip.
    const reactChip = harness.chips().find((chip) => (chip.childNodes[0]?.textContent ?? "").trim() === "React")!
    reactChip.querySelector<HTMLButtonElement>("[data-ctxpack-keyword-remove]")!.click()
    expect(chipTexts()).not.toContain("react")

    // Cap at 12.
    typeInto(harness.keywordInput(), "one two three four five six seven eight nine ten eleven twelve thirteen")
    pressKey(harness.keywordInput(), "Enter")
    expect(harness.chips()).toHaveLength(12)
  })

  it("removes and reorders fragments through the draft controller", async () => {
    const harness = await mountDialog(
      async () => makeInfo(),
      (ctl) => {
        ctl.add(makeFragment("fA", "Alpha"))
        ctl.add(makeFragment("fB", "Beta"))
        ctl.add(makeFragment("fC", "Gamma"))
      },
    )
    const order = () => harness.fragmentRows().map((row) => row.getAttribute("data-ctxpack-fragment"))

    expect(order()).toEqual(["fA", "fB", "fC"])
    q<HTMLButtonElement>('[data-ctxpack-fragment="fB"] [data-ctxpack-fragment-up]')!.click()
    expect(order()).toEqual(["fB", "fA", "fC"])
    q<HTMLButtonElement>('[data-ctxpack-fragment="fC"] [data-ctxpack-fragment-remove]')!.click()
    expect(order()).toEqual(["fB", "fA"])
    expect(
      harness
        .controller()
        .fragments()
        .map((fragment) => fragment.clientFragmentID),
    ).toEqual(["fB", "fA"])
  })

  it("disables save for empty draft, invalid title, weaker sensitivity, oversize, over-token, and pending", async () => {
    // Empty draft.
    const empty = await mountDialog(async () => makeInfo())
    expect(empty.save().disabled).toBe(true)

    // Invalid (empty) title.
    const titled = await mountDialog(
      async () => makeInfo(),
      (ctl) => {
        ctl.add(makeFragment("f1", "Some useful text"))
      },
    )
    expect(titled.save().disabled).toBe(false)
    typeInto(titled.titleInput(), "")
    expect(titled.save().disabled).toBe(true)
    typeInto(titled.titleInput(), "My pack")
    expect(titled.save().disabled).toBe(false)

    // Weaker sensitivity than the floor (floor rises while the dialog is open).
    const floor = await mountDialog(
      async () => makeInfo(),
      (ctl) => {
        ctl.add(makeFragment("fPub", "Public text", "public"))
      },
    )
    expect(floor.save().disabled).toBe(false)
    floor.controller().add(makeFragment("fPriv", "Private text", "private"))
    await tick()
    expect(q<HTMLInputElement>('[data-ctxpack-sensitivity="public"]')!.disabled).toBe(true)
    expect(q<HTMLInputElement>('[data-ctxpack-sensitivity="workspace"]')!.disabled).toBe(true)
    expect(q<HTMLInputElement>('[data-ctxpack-sensitivity="private"]')!.disabled).toBe(false)
    expect(floor.save().disabled).toBe(true)
    chooseRadio("private")
    expect(floor.save().disabled).toBe(false)

    // Aggregate over 32 KiB.
    const big = await mountDialog(
      async () => makeInfo(),
      (ctl) => {
        ctl.add(makeFragment("fBig1", "a".repeat(20 * 1024)))
        ctl.add(makeFragment("fBig2", "b".repeat(20 * 1024)))
      },
    )
    expect(big.save().disabled).toBe(true)

    // Over 6,000 tokens while staying under 32 KiB.
    const tokens = await mountDialog(
      async () => makeInfo(),
      (ctl) => {
        ctl.add(makeFragment("fTok", "c".repeat(30_000)))
      },
    )
    expect(tokens.save().disabled).toBe(true)

    // Pending request.
    const pending = await mountDialog(
      () => new Promise<CtxPackInfoLocal>(() => {}),
      (ctl) => {
        ctl.add(makeFragment("fP", "Pending text"))
      },
    )
    pending.save().click()
    await tick()
    expect(pending.save().disabled).toBe(true)
    expect(pending.requests).toHaveLength(1)
  })

  it("preserves fragment order and regenerates the idempotency key per attempt", async () => {
    let attempt = 0
    const harness = await mountDialog(
      async (request) => {
        attempt += 1
        if (attempt === 1) {
          throw Object.assign(new Error("first attempt failed"), { errorCode: "E_AGAIN" })
        }
        return makeInfo()
      },
      (ctl) => {
        ctl.add(makeFragment("fA", "Alpha"))
        ctl.add(makeFragment("fB", "Beta"))
        ctl.add(makeFragment("fC", "Gamma"))
        ctl.move("fB", 0)
      },
    )
    harness.save().click()
    await tick()
    harness.save().click()
    await tick()

    expect(harness.requests).toHaveLength(2)
    const first = harness.requests[0]
    const second = harness.requests[1]
    expect(first.fragments.map((fragment) => fragment.clientFragmentID)).toEqual(["fB", "fA", "fC"])
    expect(second.fragments.map((fragment) => fragment.clientFragmentID)).toEqual(["fB", "fA", "fC"])
    expect(first.idempotencyKey).toBeTruthy()
    expect(second.idempotencyKey).toBeTruthy()
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey)
    expect(harness.created).toHaveLength(1)
  })

  it("issues exactly one request on double-click while pending", async () => {
    const harness = await mountDialog(
      () => new Promise<CtxPackInfoLocal>(() => {}),
      (ctl) => {
        ctl.add(makeFragment("f1", "Some text"))
      },
    )
    harness.save().click()
    harness.save().click()
    await tick()
    expect(harness.requests).toHaveLength(1)
  })

  it("clears the draft, closes the dialog, and calls onCreated on success", async () => {
    const harness = await mountDialog(
      async () => makeInfo(),
      (ctl) => {
        ctl.add(makeFragment("f1", "Some text"))
      },
    )
    harness.save().click()
    await tick()

    expect(harness.controller().fragments()).toHaveLength(0)
    expect(dialogState.open).toBe(false)
    expect(q("[data-ctxpack-save]")).toBeNull()
    expect(harness.created).toHaveLength(1)
    expect(harness.created[0].id).toBe("pack-1")
  })

  it("preserves the draft and fields on failure and shows an error without fragment text", async () => {
    const harness = await mountDialog(
      async () => {
        throw Object.assign(new Error(`${DIALOG_SENTINEL} leaked from the server`), { errorCode: "E_BAD" })
      },
      (ctl) => {
        ctl.add(makeFragment("f1", `${DIALOG_SENTINEL} is a secret`))
      },
    )
    typeInto(harness.titleInput(), "Custom title")
    harness.save().click()
    await tick()

    expect(harness.controller().fragments()).toHaveLength(1)
    expect(harness.titleInput().value).toBe("Custom title")
    expect(dialogState.open).toBe(true)

    const message = harness.error()!.textContent ?? ""
    expect(message).toContain("Failed to create CtxPack")
    expect(message).toContain("E_BAD")
    expect(message).not.toContain(DIALOG_SENTINEL)
    // The request itself carries the draft (server-bound); the UI error must not.
    expect(harness.requests[0].fragments[0].text).toContain(DIALOG_SENTINEL)
  })

  it("preserves the draft on close without save, and clears it via discard after a confirm step", async () => {
    const harness = await mountDialog(
      async () => makeInfo(),
      (ctl) => {
        ctl.add(makeFragment("f1", "Some text"))
      },
    )
    harness.cancel().click()
    await tick()
    expect(dialogState.open).toBe(false)
    expect(harness.controller().fragments()).toHaveLength(1)

    // Reopen: fields reset, draft preserved.
    harness.setOpen(true)
    await tick()
    expect(dialogState.open).toBe(true)
    expect(harness.fragmentRows()).toHaveLength(1)

    // Discard needs a confirm step, then clears and closes.
    harness.discard().click()
    expect(harness.discard().textContent).toContain("Confirm discard")
    expect(harness.controller().fragments()).toHaveLength(1)
    harness.discard().click()
    await tick()
    expect(harness.controller().fragments()).toHaveLength(0)
    expect(dialogState.open).toBe(false)
  })
})
