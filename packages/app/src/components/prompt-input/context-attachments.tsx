/**
 * Context attachment chips for composers (U5, CtxPack).
 *
 * Renders one chip per committed context attachment (label + estimated
 * tokens + a CtxPack source icon) with a preview action and a remove button
 * per chip. Preview NEVER renders fragment text: it only forwards the
 * clientAttachmentID to `props.onPreview` — the authorized get/materialize
 * path is wired by M1. An `aria-live="polite"` region announces add/remove
 * events derived from the attachments prop.
 *
 * Built with plain DOM APIs + the Solid reactive core (no JSX syntax) so it
 * compiles and runs under BOTH the app's Vite build and the repo's bun test
 * setup (`--conditions=solid` resolves solid-js to its server build and
 * compiles JSX with the React classic transform — see HANDOFF-U3.md).
 */
import { createRenderEffect, createSignal, onCleanup, type JSX } from "solid-js"
import {
  MAX_CONTEXT_ATTACHMENTS,
  MAX_CONTEXT_ATTACHMENT_TOKENS,
  type ContextAttachmentDraft,
} from "@/context/ctxpack/attachment-store"

export interface ContextAttachmentChipsProps {
  attachments: readonly ContextAttachmentDraft[] | (() => readonly ContextAttachmentDraft[])
  totalEstimatedTokens: number | (() => number)
  onRemove(clientAttachmentID: string): void
  onPreview(clientAttachmentID: string): void
}

/**
 * True when the composer must stop accepting further CtxPack attachments:
 * the 8-attachment or the 6,000 aggregate-token budget is reached. The store
 * still rejects authoritatively — this only disables the drop affordance.
 */
export function contextAttachmentLimitReached(
  attachments: readonly ContextAttachmentDraft[],
  totalEstimatedTokens: number,
): boolean {
  return (
    attachments.length >= MAX_CONTEXT_ATTACHMENTS ||
    totalEstimatedTokens >= MAX_CONTEXT_ATTACHMENT_TOKENS
  )
}

export function ContextAttachmentChips(props: ContextAttachmentChipsProps): JSX.Element {
  const attachments = (): readonly ContextAttachmentDraft[] => {
    const value = props.attachments
    return typeof value === "function" ? value() : value
  }
  const totalEstimatedTokens = (): number => {
    const value = props.totalEstimatedTokens
    return typeof value === "function" ? value() : value
  }
  const onRemove = (clientAttachmentID: string) => props.onRemove(clientAttachmentID)
  const onPreview = (clientAttachmentID: string) => props.onPreview(clientAttachmentID)

  const root = document.createElement("div")
  root.setAttribute("data-component", "context-attachments")
  root.className = "w-full"

  const live = document.createElement("div")
  live.setAttribute("aria-live", "polite")
  live.className = "sr-only"
  root.appendChild(live)

  const row = document.createElement("div")
  row.className = "flex flex-wrap items-center gap-1.5 px-2 pt-1.5"
  root.appendChild(row)

  const [announcement, setAnnouncement] = createSignal<string | null>(null)
  let previousIDs = new Set<string>()
  let announceTimer: ReturnType<typeof setTimeout> | undefined

  const announce = (message: string) => {
    setAnnouncement(message)
    if (announceTimer !== undefined) clearTimeout(announceTimer)
    announceTimer = setTimeout(() => setAnnouncement(null), 3000)
  }
  onCleanup(() => {
    if (announceTimer !== undefined) clearTimeout(announceTimer)
  })

  // Announce adds/removes by diffing the attachment id set between renders.
  createRenderEffect(() => {
    const items = attachments()
    const ids = new Set(items.map((item) => item.clientAttachmentID))
    const added = items.filter((item) => !previousIDs.has(item.clientAttachmentID))
    const removed = Array.from(previousIDs).filter((id) => !ids.has(id))
    previousIDs = ids
    if (added.length > 0) {
      announce(`Added ${added.map((item) => item.label).join(", ")}`)
    } else if (removed.length > 0) {
      announce(`Removed ${removed.length} context attachment${removed.length === 1 ? "" : "s"}`)
    }
  })

  createRenderEffect(() => {
    live.textContent = announcement() ?? ""
  })

  createRenderEffect(() => {
    const items = attachments()
    void totalEstimatedTokens()
    row.replaceChildren(...items.map((item) => createChip(item, onRemove, onPreview)))
  })

  return root
}

function createChip(
  item: ContextAttachmentDraft,
  onRemove: (clientAttachmentID: string) => void,
  onPreview: (clientAttachmentID: string) => void,
): HTMLElement {
  const chip = document.createElement("div")
  chip.className =
    "group inline-flex shrink-0 items-center gap-1 rounded-full border border-border-base bg-surface-raised px-2 py-1"
  chip.setAttribute("data-attachment-id", item.clientAttachmentID)
  chip.dataset.status = item.status

  const preview = document.createElement("button")
  preview.type = "button"
  preview.className =
    "inline-flex items-center gap-1.5 text-12-regular text-text-strong focus:outline-none"
  preview.setAttribute("data-action", "ctxpack-attachment-preview")
  preview.setAttribute("aria-label", `Preview ${item.label}`)
  preview.appendChild(createCtxPackIcon())

  const label = document.createElement("span")
  label.className = "max-w-[180px] truncate"
  label.textContent = item.label
  preview.appendChild(label)

  const tokens = document.createElement("span")
  tokens.className = "shrink-0 text-12-regular text-text-weak"
  tokens.textContent = `${item.estimatedTokens} tokens`
  preview.appendChild(tokens)

  preview.addEventListener("click", () => onPreview(item.clientAttachmentID))
  chip.appendChild(preview)

  const remove = document.createElement("button")
  remove.type = "button"
  remove.className =
    "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-text-weak hover:text-text-strong focus:outline-none"
  remove.setAttribute("data-action", "ctxpack-attachment-remove")
  remove.setAttribute("aria-label", `Remove ${item.label}`)
  remove.textContent = "×"
  remove.addEventListener("click", () => onRemove(item.clientAttachmentID))
  chip.appendChild(remove)

  return chip
}

function createCtxPackIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 16 16")
  svg.setAttribute("class", "size-3.5 shrink-0")
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("data-ctxpack-icon", "true")

  const outline = document.createElementNS("http://www.w3.org/2000/svg", "path")
  outline.setAttribute(
    "d",
    "M8 1.5 14 4.5v7L8 14.5 2 11.5v-7L8 1.5Z",
  )
  outline.setAttribute("fill", "none")
  outline.setAttribute("stroke", "currentColor")
  outline.setAttribute("stroke-width", "1.5")
  outline.setAttribute("stroke-linejoin", "round")

  const seams = document.createElementNS("http://www.w3.org/2000/svg", "path")
  seams.setAttribute("d", "M2 4.5 8 7.5 14 4.5M8 7.5v7")
  seams.setAttribute("fill", "none")
  seams.setAttribute("stroke", "currentColor")
  seams.setAttribute("stroke-width", "1.5")
  seams.setAttribute("stroke-linejoin", "round")

  svg.appendChild(outline)
  svg.appendChild(seams)
  return svg
}
