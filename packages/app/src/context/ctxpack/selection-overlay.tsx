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

import { createComponent, createEffect, createRenderEffect, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import h from "solid-js/h"
import { useLanguage } from "@/context/language"
import { ResponseSaveActions } from "@/pages/session/timeline/response-save-actions"
import { captureCtxPackSelection, type CapturedCtxPackFragment } from "./selection"
import { useCtxPackDraft } from "./draft"
import { suggestCtxPackKeywords } from "./keyword-suggest"
import { showToast } from "@/utils/toast"
import {
  CtxPackCreateDialog,
  DEFAULT_CTXPACK_TITLE_CODEPOINTS,
  MAX_CTXPACK_AGGREGATE_TOKENS,
  type CtxPackCreateRequestLocal,
  type CtxPackInfoLocal,
} from "./create-dialog"
import "./selection-overlay.css"

export interface CtxPackSelectionOverlayProps {
  workspaceID: Accessor<string | undefined>
  workspaceEpoch: Accessor<number>
  create(request: CtxPackCreateRequestLocal): Promise<CtxPackInfoLocal>
  onCreated?(pack: CtxPackInfoLocal): void
}

const TOOLBAR_EDGE_MARGIN = 8
const TOOLBAR_FALLBACK_WIDTH = 70
const TOOLBAR_FALLBACK_HEIGHT = 38

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
  const language = useLanguage()
  const [state, setState] = createStore({
    visible: false,
    menuOpen: false,
    position: { x: TOOLBAR_EDGE_MARGIN, y: TOOLBAR_EDGE_MARGIN },
  })
  let captured: CapturedCtxPackFragment | null = null
  let disposed = false
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
    captured = null
    setState({ visible: false, menuOpen: false })
  }

  /** ONE rAF per change: re-read the live selection rect and clamp to viewport. */
  function scheduleReposition() {
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      const selection = window.getSelection()
      if (state.menuOpen) return
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        hide()
        return
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      const width = toolbarRef?.offsetWidth || TOOLBAR_FALLBACK_WIDTH
      const height = toolbarRef?.offsetHeight || TOOLBAR_FALLBACK_HEIGHT
      const maxX = Math.max(TOOLBAR_EDGE_MARGIN, window.innerWidth - width - TOOLBAR_EDGE_MARGIN)
      const maxY = Math.max(TOOLBAR_EDGE_MARGIN, window.innerHeight - height - TOOLBAR_EDGE_MARGIN)
      setState("position", {
        x: clamp(rect.left, TOOLBAR_EDGE_MARGIN, maxX),
        y: clamp(rect.bottom + TOOLBAR_EDGE_MARGIN, TOOLBAR_EDGE_MARGIN, maxY),
      })
    })
  }

  function handleSelectionEvent(event?: Event) {
    if (state.menuOpen) return
    if (isEditableTarget(event?.target ?? null)) {
      hide()
      return
    }
    const selection = window.getSelection()
    if (!selection) {
      hide()
      return
    }
    captured = captureCtxPackSelection({ selection, now: Date.now() })
    if (!captured) {
      hide()
      return
    }
    setState("visible", true)
    scheduleReposition()
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && !event.defaultPrevented && !state.menuOpen) hide()
  }

  function captureLiveSelection(): CapturedCtxPackFragment | null {
    const selection = window.getSelection()
    if (!selection) return null
    return captureCtxPackSelection({ selection, now: Date.now() })
  }

  function handleAdd() {
    if (!captured || captured.source.workspaceID !== props.workspaceID()) return
    const result = draft.add(captured)
    if (result.status === "duplicate") {
      // Fixed, fragment-text-free notice (non-blocking toast).
      showToast(language.t("canvas.ctxpack.alreadyInDraft"))
    }
    window.getSelection()?.removeAllRanges()
    hide()
  }

  async function handleSave(options: { details: boolean }) {
    const fragment = captured
    if (!fragment) return
    const workspaceID = props.workspaceID()
    if (!workspaceID || fragment.source.workspaceID !== workspaceID || draft.workspaceID() !== workspaceID) return
    if (options.details) {
      draft.add(fragment)
      window.getSelection()?.removeAllRanges()
      hide()
      draft.openCreate()
      return
    }
    if (Math.ceil(new TextEncoder().encode(fragment.text).byteLength / 4) > MAX_CTXPACK_AGGREGATE_TOKENS) {
      showToast(language.t("canvas.ctxpack.captureFailed"))
      return
    }
    const epoch = props.workspaceEpoch()
    const current = () => !disposed && props.workspaceID() === workspaceID && props.workspaceEpoch() === epoch
    const title = Array.from(fragment.text.split("\n")[0]).slice(0, DEFAULT_CTXPACK_TITLE_CODEPOINTS).join("")
    await props
      .create({
        workspaceID,
        title,
        keywords: suggestCtxPackKeywords({ title, fragments: [fragment] }).filter(
          (keyword) => Array.from(keyword.normalize("NFKC")).length <= 48,
        ),
        sensitivity: fragment.source.sensitivity,
        fragments: [fragment],
        idempotencyKey: crypto.randomUUID(),
      })
      .then(
        (pack) => {
          if (!current()) return
          const selection = captureLiveSelection()
          if (selection?.text === fragment.text && selection.source.blockID === fragment.source.blockID) {
            window.getSelection()?.removeAllRanges()
            hide()
          }
          props.onCreated?.(pack)
        },
        () => {
          if (current()) showToast(language.t("canvas.ctxpack.saveFailed"))
        },
      )
  }

  // Hide when the workspace identity or epoch changes.
  createEffect(() => {
    void props.workspaceID()
    void props.workspaceEpoch()
    hide()
  })

  // Hide the toolbar while the create dialog is open.
  createEffect(() => {
    if (draft.createOpen()) hide()
  })

  // Apply position/visibility imperatively (reacts to `visible`/`position`).
  // The signals are read unconditionally so the effect subscribes from the
  // start; the ref callback applies the initial `display:none` on mount.
  createRenderEffect(() => {
    void state.visible
    void state.position.x
    void state.position.y
    const label = language.t("canvas.ctxpack.selectionActions")
    const el = toolbarRef
    if (!el) return
    el.setAttribute("aria-label", label)
    el.style.display = state.visible ? "" : "none"
    el.style.left = `${state.position.x}px`
    el.style.top = `${state.position.y}px`
  })

  document.addEventListener("selectionchange", handleSelectionEvent)
  document.addEventListener("pointerup", handleSelectionEvent)
  document.addEventListener("keyup", handleSelectionEvent)
  document.addEventListener("keydown", handleKeyDown)

  onCleanup(() => {
    disposed = true
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
        "aria-label": language.t("canvas.ctxpack.selectionActions"),
        "data-ctxpack-selection-toolbar": "",
        class: "ctxpack-selection-toolbar",
        style: { position: "fixed", "z-index": "49" },
        onMouseDown: (event: MouseEvent) => event.preventDefault(),
      },
      createComponent(ResponseSaveActions, {
        onSave: handleSave,
        onAddToDraft: handleAdd,
        get open() {
          return state.menuOpen
        },
        onOpenChange: (open) => {
          setState("menuOpen", open)
          // Menu focus may collapse the DOM range; keep its captured fragment until the menu closes.
          if (!open) scheduleReposition()
        },
      }),
    ),
    // Built with createComponent (not h) so the dialog receives raw props:
    // h's dynamicProperty would unwrap the accessor-valued props (`open`,
    // `workspaceID`) into their current values, breaking the prop contract.
    createComponent(CtxPackCreateDialog, {
      open: draft.createOpen,
      onClose: draft.closeCreate,
      workspaceID: props.workspaceID,
      create: props.create,
      onCreated: props.onCreated,
    }),
  ] as unknown as Element
}
