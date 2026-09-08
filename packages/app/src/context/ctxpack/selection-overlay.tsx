/**
 * CtxPack selection overlay (U4).
 *
 * A compact floating toolbar shown next to a user selection inside a Block
 * Runtime source root (`data-ctxpack-source-root`). Mounted ONCE at
 * workspace-shell scope by the host (M1); consumes the U1 draft controller
 * from Solid context so the host mounts a single provider.
 *
 * Behavior:
 * - Listens for `selectionchange`, `pointerup`, and `keyup` (shift+arrow
 *   selection completion) on `document`; listeners are disposed on cleanup.
 * - On each event, runs `captureCtxPackSelection`; a non-null result shows
 *   the toolbar near `range.getBoundingClientRect()` (clamped to the
 *   viewport). Repositioning is throttled with ONE `requestAnimationFrame`
 *   per change — never a poll loop.
 * - Hides when the selection collapses, when `workspaceID()`/`workspaceEpoch()`
 *   changes, when Escape is pressed, or when the user starts editing
 *   (editable event target).
 * - `mousedown` on the toolbar calls `preventDefault()` so the captured Range
 *   survives until the action runs.
 *
 * Privacy: the selected text never appears in data-* attributes, URLs,
 * toasts, or console output — the toolbar renders only fixed labels, and the
 * duplicate notice is a fixed toast string.
 *
 * NOTE ON STYLE: the dynamic UI is built with `h` (solid-js/h, Solid's
 * official hyperscript) rather than JSX — see create-dialog.tsx for the
 * rationale (reactive accessor values work under both vite and the repo's
 * bun test setup, where JSX props would freeze at mount time).
 */

import { createComponent, createEffect, createRenderEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import h from "solid-js/h"
import { captureCtxPackSelection, type CapturedCtxPackFragment } from "./selection"
import { useCtxPackDraft } from "./draft"
import { showToast } from "@/utils/toast"
import { CtxPackCreateDialog, type CtxPackCreateRequestLocal, type CtxPackInfoLocal } from "./create-dialog"

export interface CtxPackSelectionOverlayProps {
  workspaceID: Accessor<string | undefined>
  workspaceEpoch: Accessor<number>
  create(request: CtxPackCreateRequestLocal): Promise<CtxPackInfoLocal>
  onCreated?(pack: CtxPackInfoLocal): void
}

const TOOLBAR_EDGE_MARGIN = 8
const TOOLBAR_FALLBACK_WIDTH = 260
const TOOLBAR_FALLBACK_HEIGHT = 44

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return target.getAttribute("contenteditable") === "true"
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function CtxPackSelectionOverlay(props: CtxPackSelectionOverlayProps) {
  const draft = useCtxPackDraft()
  const [visible, setVisible] = createSignal(false)
  const [position, setPosition] = createSignal<{ x: number; y: number }>({
    x: TOOLBAR_EDGE_MARGIN,
    y: TOOLBAR_EDGE_MARGIN,
  })
  const [createOpen, setCreateOpen] = createSignal(false)
  let rafId: number | null = null
  let toolbarRef: HTMLDivElement | undefined

  function cancelScheduledReposition() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function hide() {
    cancelScheduledReposition()
    setVisible(false)
  }

  /** ONE rAF per change: re-read the live selection rect and clamp to viewport. */
  function scheduleReposition() {
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setVisible(false)
        return
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      const width = toolbarRef?.offsetWidth || TOOLBAR_FALLBACK_WIDTH
      const height = toolbarRef?.offsetHeight || TOOLBAR_FALLBACK_HEIGHT
      const maxX = Math.max(TOOLBAR_EDGE_MARGIN, window.innerWidth - width - TOOLBAR_EDGE_MARGIN)
      const maxY = Math.max(TOOLBAR_EDGE_MARGIN, window.innerHeight - height - TOOLBAR_EDGE_MARGIN)
      setPosition({
        x: clamp(rect.left, TOOLBAR_EDGE_MARGIN, maxX),
        y: clamp(rect.bottom + TOOLBAR_EDGE_MARGIN, TOOLBAR_EDGE_MARGIN, maxY),
      })
    })
  }

  function handleSelectionEvent(event: Event) {
    if (isEditableTarget(event.target)) {
      hide()
      return
    }
    const selection = window.getSelection()
    if (!selection) {
      hide()
      return
    }
    const captured = captureCtxPackSelection({ selection, now: Date.now() })
    if (!captured) {
      hide()
      return
    }
    setVisible(true)
    scheduleReposition()
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") hide()
  }

  function captureLiveSelection(): CapturedCtxPackFragment | null {
    const selection = window.getSelection()
    if (!selection) return null
    return captureCtxPackSelection({ selection, now: Date.now() })
  }

  function handleAdd() {
    const captured = captureLiveSelection()
    if (!captured) return
    const result = draft.add(captured)
    if (result.status === "duplicate") {
      // Fixed, fragment-text-free notice (non-blocking toast).
      showToast("Already in draft")
    }
    window.getSelection()?.removeAllRanges()
    hide()
  }

  function handleSaveAsNew() {
    const captured = captureLiveSelection()
    if (!captured) return
    draft.add(captured)
    window.getSelection()?.removeAllRanges()
    hide()
    setCreateOpen(true)
  }

  // Hide when the workspace identity or epoch changes.
  createEffect(() => {
    void props.workspaceID()
    void props.workspaceEpoch()
    hide()
  })

  // Hide the toolbar while the create dialog is open.
  createEffect(() => {
    if (createOpen()) hide()
  })

  // Apply position/visibility imperatively (reacts to `visible`/`position`).
  // The signals are read unconditionally so the effect subscribes from the
  // start; the ref callback applies the initial `display:none` on mount.
  createRenderEffect(() => {
    void visible()
    void position()
    const el = toolbarRef
    if (!el) return
    el.style.display = visible() ? "" : "none"
    el.style.left = `${position().x}px`
    el.style.top = `${position().y}px`
  })

  document.addEventListener("selectionchange", handleSelectionEvent)
  document.addEventListener("pointerup", handleSelectionEvent)
  document.addEventListener("keyup", handleSelectionEvent)
  document.addEventListener("keydown", handleKeyDown)

  onCleanup(() => {
    document.removeEventListener("selectionchange", handleSelectionEvent)
    document.removeEventListener("pointerup", handleSelectionEvent)
    document.removeEventListener("keyup", handleSelectionEvent)
    document.removeEventListener("keydown", handleKeyDown)
    cancelScheduledReposition()
  })

  // The toolbar is mounted once and shown/hidden via `display` (imperative
  // effect above). h() with accessor-valued props is NOT used here — Solid's
  // dynamicProperty/getter props make the provider's children memo re-resolve
  // the whole subtree on every signal write, re-creating this component and
  // its document listeners (see U4 HANDOFF). Static props + imperative style
  // keep the tree stable while remaining fully reactive.
  // Solid renders component arrays fine at runtime; the cast reconciles the
  // repo's single-Element JSX typing with the two-node return (M1 fix).
  return [
    h(
      "div",
      {
        ref: (el: HTMLDivElement) => {
          toolbarRef = el
          el.style.display = "none"
        },
        role: "toolbar",
        "aria-label": "CtxPack selection actions",
        "data-ctxpack-selection-toolbar": "",
        class: "ctxpack-selection-toolbar",
        style: { position: "fixed", "z-index": "2147483000" },
        onMouseDown: (event: MouseEvent) => event.preventDefault(),
      },
      h("button", { type: "button", "data-ctxpack-action": "add", onClick: handleAdd }, "Add to CtxPack draft"),
      h("button", { type: "button", "data-ctxpack-action": "save", onClick: handleSaveAsNew }, "Save as new CtxPack"),
    ),
    // Built with createComponent (not h) so the dialog receives raw props:
    // h's dynamicProperty would unwrap the accessor-valued props (`open`,
    // `workspaceID`) into their current values, breaking the prop contract.
    createComponent(CtxPackCreateDialog, {
      open: () => createOpen(),
      onClose: () => setCreateOpen(false),
      workspaceID: props.workspaceID,
      create: props.create,
      onCreated: props.onCreated,
    }),
  ] as unknown as Element
}
