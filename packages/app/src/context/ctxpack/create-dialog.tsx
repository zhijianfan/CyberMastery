/**
 * CtxPack create dialog (U4).
 *
 * Controlled by an `open` accessor + `onClose` callback (the host owns the
 * signal; M1 decides the portal layer). The dialog portals itself through
 * `useDialog().show(...)` — the repo's dialog-v2 idiom (see
 * `components/dialog-select-directory-v2.tsx`) — and calls `dialog.close()`
 * to dismiss, which routes through `onClose` back to the host signal.
 *
 * All draft mutations go through the U1 draft controller context
 * (`useCtxPackDraft()`); the dialog never persists anything to storage and
 * never writes list state directly — the browser refreshes via EventV2/refetch
 * (M1/R1).
 *
 * Privacy: fragment text is never rendered in this dialog and never appears
 * in data-* attributes, URLs, toasts, or console output. Error messages are
 * built from the facade's `errorCode` only — never from the rejection value's
 * message, which could echo fragment text back.
 *
 * NOTE ON STYLE: the dynamic UI is built with `h` (solid-js/h, Solid's
 * official hyperscript) rather than JSX. Dynamic values are passed as
 * zero-argument accessors (`value: () => title()`), which `h` turns into
 * reactive bindings via `dynamicProperty`/`spread`. This renders correctly
 * under vite AND under the repo's bun test setup, where JSX is compiled to
 * eager `React.createElement` calls (see U4 HANDOFF) that would freeze every
 * prop at mount time and silently disable all post-mount updates.
 */

import h from "solid-js/h"
import { batch, createEffect, createMemo, createSignal, onCleanup, type Accessor, type JSX } from "solid-js"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useCtxPackDraft } from "./draft"
import { suggestCtxPackKeywords } from "./keyword-suggest"
import type { CapturedCtxPackFragment, CapturedSource, CtxPackSensitivity } from "./selection"
import "./create-dialog.css"

/** Max draft fragments the create dialog will submit (controller's budget). */
export const MAX_CTXPACK_FRAGMENTS = 32
/** Max aggregate draft size in UTF-8 bytes. */
export const MAX_CTXPACK_AGGREGATE_BYTES = 32 * 1024
/** Max aggregate draft size in estimated tokens. */
export const MAX_CTXPACK_AGGREGATE_TOKENS = 6000
/** Max editable title length in code points. */
export const MAX_CTXPACK_TITLE_CODEPOINTS = 120
/** Default title truncation in display code points. */
export const DEFAULT_CTXPACK_TITLE_CODEPOINTS = 80
/** Max keyword chips. */
export const MAX_CTXPACK_KEYWORDS = 12

/**
 * Local create request shape (frozen by the plan; M1 aligns field names to
 * the S1 SDK schema).
 */
export interface CtxPackCreateRequestLocal {
  workspaceID: string
  title: string
  keywords: string[]
  sensitivity: CtxPackSensitivity
  fragments: CapturedCtxPackFragment[]
  idempotencyKey: string
}

/** Local fragment shape inside the Info returned by the create facade. */
export interface CtxPackInfoFragmentLocal {
  id: string
  clientFragmentID: string
  text: string
  ordinal: number
  source: CapturedSource
  contentHash: string
  byteLength: number
  estimatedTokens: number
}

/** Local Info shape frozen by U1/U2; M1 aligns to the SDK schema. */
export interface CtxPackInfoLocal {
  id: string
  title: string
  keywords: string[]
  sensitivity: CtxPackSensitivity
  revision: number
  contentHash: string
  byteLength: number
  estimatedTokens: number
  fragments: CtxPackInfoFragmentLocal[]
  usage: { attachedCount: number; lastAttachedAt: number | null }
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  createdByUserID: string | null
}

export interface CtxPackCreateDialogProps {
  open: Accessor<boolean>
  onClose(): void
  workspaceID: Accessor<string | undefined>
  create(request: CtxPackCreateRequestLocal): Promise<CtxPackInfoLocal>
  onCreated?(pack: CtxPackInfoLocal): void
}

const SENSITIVITY_RANK: Record<CtxPackSensitivity, number> = { public: 0, workspace: 1, private: 2 }
const SENSITIVITY_OPTIONS: CtxPackSensitivity[] = ["public", "workspace", "private"]

function truncateCodepoints(value: string, max: number): string {
  const points = Array.from(value)
  return points.length <= max ? value : points.slice(0, max).join("")
}

function fragmentByteLength(fragment: CapturedCtxPackFragment): number {
  return new TextEncoder().encode(fragment.text).byteLength
}

function fragmentEstimatedTokens(fragment: CapturedCtxPackFragment): number {
  return Math.ceil(fragmentByteLength(fragment) / 4)
}

function formatCaptureTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString()
}

/**
 * Stable, fragment-text-free error message. Only the facade's `errorCode` is
 * surfaced (when present); the rejection's message is never rendered because
 * it could echo captured fragment text back into the UI.
 */
function describeCreateError(error: unknown): string {
  const code = (error as { errorCode?: unknown } | null)?.errorCode
  const suffix = typeof code === "string" && code.length > 0 ? ` (${code})` : ""
  return `Failed to create CtxPack${suffix}`
}

export function CtxPackCreateDialog(props: CtxPackCreateDialogProps) {
  const dialog = useDialog()
  const draft = useCtxPackDraft()

  const [title, setTitle] = createSignal("")
  const [keywords, setKeywords] = createSignal<string[]>([])
  const [keywordInput, setKeywordInput] = createSignal("")
  const [sensitivity, setSensitivity] = createSignal<CtxPackSensitivity>("workspace")
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [confirmingDiscard, setConfirmingDiscard] = createSignal(false)
  const [mounted, setMounted] = createSignal(false)
  let opening: symbol | undefined
  onCleanup(() => {
    opening = undefined
  })

  const fragments = () => draft.fragments()

  /** rank of the most sensitive fragment in the draft; 0..2 (public..private). */
  const sensitivityFloorRank = createMemo(() =>
    fragments().reduce((floor, fragment) => Math.max(floor, SENSITIVITY_RANK[fragment.source.sensitivity]), 0),
  )
  const floorSensitivity = createMemo<CtxPackSensitivity>(() =>
    sensitivityFloorRank() >= 2 ? "private" : sensitivityFloorRank() === 1 ? "workspace" : "public",
  )

  /** First non-empty line of the first fragment, truncated to 80 code points. */
  const defaultTitle = createMemo(() => {
    const first = fragments()[0]
    if (!first) return ""
    const line = first.text.split("\n").find((candidate) => candidate.trim().length > 0)
    return line ? truncateCodepoints(line.trim(), DEFAULT_CTXPACK_TITLE_CODEPOINTS) : ""
  })

  const canSave = createMemo(() => {
    if (pending()) return false
    if (props.workspaceID() === undefined) return false
    const current = fragments()
    if (current.length === 0) return false
    if (current.length > MAX_CTXPACK_FRAGMENTS) return false
    const trimmed = title().trim()
    if (trimmed.length === 0) return false
    if (Array.from(trimmed).length > MAX_CTXPACK_TITLE_CODEPOINTS) return false
    if (draft.byteLength() > MAX_CTXPACK_AGGREGATE_BYTES) return false
    if (draft.estimatedTokens() > MAX_CTXPACK_AGGREGATE_TOKENS) return false
    if (SENSITIVITY_RANK[sensitivity() as CtxPackSensitivity] < sensitivityFloorRank()) return false
    return true
  })

  /** Reset fields on every open transition (draft itself is preserved). */
  function initializeFields() {
    const suggested = suggestCtxPackKeywords({ title: defaultTitle(), fragments: fragments() })
    setTitle(defaultTitle())
    setKeywords(suggested.slice(0, MAX_CTXPACK_KEYWORDS))
    setKeywordInput("")
    setSensitivity(floorSensitivity())
    setPending(false)
    setError(null)
    setConfirmingDiscard(false)
  }

  function commitKeywordInput() {
    const raw = keywordInput().trim()
    if (raw.length === 0) {
      setKeywordInput("")
      return
    }
    const tokens = raw
      .split(/[,;\s]+/)
      .map((token: string) => token.trim())
      .filter((token: string) => token.length > 0)
    setKeywords((current: string[]) => {
      const seen = new Set(current.map((keyword: string) => keyword.toLowerCase()))
      const next = [...current]
      for (const token of tokens) {
        if (next.length >= MAX_CTXPACK_KEYWORDS) break
        const key = token.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        next.push(token)
      }
      return next
    })
    setKeywordInput("")
  }

  function removeLastKeyword() {
    setKeywords((current: string[]) => current.slice(0, -1))
  }

  function handleKeywordKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault()
      commitKeywordInput()
      return
    }
    if (event.key === "," || event.key === " ") {
      event.preventDefault()
      commitKeywordInput()
      return
    }
    if (event.key === "Backspace" && keywordInput().length === 0) {
      removeLastKeyword()
    }
  }

  function handleDiscard() {
    if (!confirmingDiscard()) {
      setConfirmingDiscard(true)
      return
    }
    draft.clear()
    dialog.close()
  }

  function handleSave() {
    if (!canSave() || pending() || !opening) return
    const submittedOpening = opening
    const workspaceID = props.workspaceID()
    if (!workspaceID) return
    setPending(true)
    setError(null)
    // Fresh idempotency key per attempt: a retry after failure must not be
    // deduped by the server against the failed attempt.
    const idempotencyKey = crypto.randomUUID()
    const request: CtxPackCreateRequestLocal = {
      workspaceID,
      title: title().trim(),
      keywords: [...keywords()],
      sensitivity: sensitivity(),
      fragments: [...fragments()],
      idempotencyKey,
    }
    props.create(request).then(
      (pack) => {
        if (opening !== submittedOpening) return
        request.fragments.forEach((fragment) => draft.remove(fragment.clientFragmentID))
        setPending(false)
        dialog.close()
        props.onCreated?.(pack)
      },
      (reason: unknown) => {
        if (opening !== submittedOpening) return
        // Preserve the draft and every field; only the errorCode is surfaced.
        setPending(false)
        setError(describeCreateError(reason))
      },
    )
  }

  createEffect(() => {
    if (props.open() && !mounted()) {
      const currentOpening = Symbol()
      opening = currentOpening
      setMounted(true)
      initializeFields()
      dialog.show(
        () =>
          h(
            Dialog,
            { size: "large", fit: true, class: "ctxpack-create-dialog" },
            h(DialogHeader, {}, h(DialogTitle, {}, "Create CtxPack")),
            h(
              DialogBody,
              {},
              h(
                "form",
                { "data-ctxpack-form": "", onSubmit: (event: Event) => event.preventDefault() },
                h(
                  "label",
                  { "data-ctxpack-field": "title" },
                  h("span", {}, "Title"),
                  h("input", {
                    type: "text",
                    "data-ctxpack-title-input": "",
                    value: () => title(),
                    placeholder: "CtxPack title",
                    maxLength: MAX_CTXPACK_TITLE_CODEPOINTS,
                    onInput: (event: Event) =>
                      setTitle(
                        truncateCodepoints(
                          (event.currentTarget as HTMLInputElement).value,
                          MAX_CTXPACK_TITLE_CODEPOINTS,
                        ),
                      ),
                    onKeyDown: (event: KeyboardEvent) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        handleSave()
                      }
                    },
                  }),
                ),
                h(
                  "div",
                  { "data-ctxpack-field": "keywords" },
                  h("span", {}, "Keywords"),
                  h(
                    "div",
                    { "data-ctxpack-keyword-chips": "" },
                    () =>
                      keywords().map((keyword: string) =>
                        h(
                          "span",
                          { class: "ctxpack-keyword-chip", "data-ctxpack-keyword-chip": "" },
                          keyword,
                          h(
                            "button",
                            {
                              type: "button",
                              "aria-label": "Remove keyword",
                              "data-ctxpack-keyword-remove": "",
                              onClick: () => setKeywords(keywords().filter((existing: string) => existing !== keyword)),
                            },
                            "✕",
                          ),
                        ),
                      ),
                    h("input", {
                      type: "text",
                      "data-ctxpack-keyword-input": "",
                      value: () => keywordInput(),
                      placeholder: "Add keywords",
                      onInput: (event: Event) => setKeywordInput((event.currentTarget as HTMLInputElement).value),
                      onKeyDown: handleKeywordKeyDown,
                      onBlur: commitKeywordInput,
                    }),
                  ),
                ),
                h(
                  "div",
                  { "data-ctxpack-field": "fragments" },
                  h("span", {}, () => `Fragments (${fragments().length})`),
                  h("ul", { "data-ctxpack-fragment-list": "" }, () =>
                    fragments().map((fragment, index) =>
                      h(
                        "li",
                        { "data-ctxpack-fragment": fragment.clientFragmentID },
                        h(
                          "span",
                          { "data-ctxpack-fragment-source": "" },
                          fragment.source.blockID,
                          " · ",
                          fragment.source.functionalityID,
                        ),
                        h("span", { "data-ctxpack-fragment-time": "" }, formatCaptureTime(fragment.source.capturedAt)),
                        h("span", { "data-ctxpack-fragment-bytes": "" }, () => `${fragmentByteLength(fragment)} B`),
                        h(
                          "span",
                          { "data-ctxpack-fragment-tokens": "" },
                          () => `${fragmentEstimatedTokens(fragment)} tok`,
                        ),
                        h(
                          "button",
                          {
                            type: "button",
                            "aria-label": "Move fragment up",
                            "data-ctxpack-fragment-up": "",
                            disabled: () => index === 0,
                            onClick: () => draft.move(fragment.clientFragmentID, index - 1),
                          },
                          "↑",
                        ),
                        h(
                          "button",
                          {
                            type: "button",
                            "aria-label": "Move fragment down",
                            "data-ctxpack-fragment-down": "",
                            disabled: () => index === fragments().length - 1,
                            onClick: () => draft.move(fragment.clientFragmentID, index + 1),
                          },
                          "↓",
                        ),
                        h(
                          "button",
                          {
                            type: "button",
                            "aria-label": "Remove fragment",
                            "data-ctxpack-fragment-remove": "",
                            onClick: () => draft.remove(fragment.clientFragmentID),
                          },
                          "✕",
                        ),
                      ),
                    ),
                  ),
                ),
                h("fieldset", { "data-ctxpack-field": "sensitivity" }, h("legend", {}, "Sensitivity"), () =>
                  SENSITIVITY_OPTIONS.map((option) =>
                    h(
                      "label",
                      {},
                      h("input", {
                        type: "radio",
                        name: "ctxpack-sensitivity",
                        "data-ctxpack-sensitivity": option,
                        value: option,
                        checked: () => sensitivity() === option,
                        disabled: () => SENSITIVITY_RANK[option] < sensitivityFloorRank(),
                        onChange: () => setSensitivity(option),
                      }),
                      option,
                    ),
                  ),
                ),
                h(
                  "div",
                  { "data-ctxpack-field": "aggregate" },
                  h("span", {}, () => `${draft.byteLength()} bytes`),
                  h("span", {}, () => `${draft.estimatedTokens()} tokens`),
                ),
                h("div", { role: "alert", "data-ctxpack-error": "" }, () => error() ?? ""),
              ),
            ),
            h(
              DialogFooter,
              {},
              h("button", { type: "button", "data-ctxpack-discard": "", onClick: handleDiscard }, () =>
                confirmingDiscard() ? "Confirm discard draft" : "Discard draft",
              ),
              h("button", { type: "button", "data-ctxpack-cancel": "", onClick: () => dialog.close() }, "Cancel"),
              h(
                "button",
                { type: "submit", "data-ctxpack-save": "", disabled: () => !canSave(), onClick: handleSave },
                () => (pending() ? "Saving…" : "Create CtxPack"),
              ),
            ),
          ) as unknown as JSX.Element,
        () => {
          if (opening !== currentOpening) return
          opening = undefined
          batch(() => {
            setMounted(false)
            props.onClose()
          })
        },
      )
    } else if (!props.open() && mounted()) {
      dialog.close()
    }
  })

  return null
}
