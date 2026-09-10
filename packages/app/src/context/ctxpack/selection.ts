/**
 * CtxPack selection capture (U1).
 *
 * Captures user-selected text from a single Block Runtime source root into a
 * `CapturedCtxPackFragment`. The Block Runtime host wraps each block's
 * rendered content in:
 *
 *   <article data-ctxpack-source-root
 *            data-workspace-id="ws-1"
 *            data-block-id="block-1"
 *            data-functionality-id="builtin:chat">...</article>
 *
 * Capture is deliberately conservative: collapsed selections, multi-block
 * selections, editable regions, and oversized text are all rejected. The
 * implementation never reads innerHTML, whole-root textContent, clipboard
 * data, or offscreen siblings — only the two range boundary roots and the
 * selection text itself.
 */

export interface CtxPackSourceRootDataset {
  workspaceID: string
  blockID: string
  functionalityID: string
}

export type CtxPackSourceKind = "block-text"

export type CtxPackDirection = "sent" | "received" | "generated" | "unknown"

export type CtxPackSensitivity = "public" | "workspace" | "private"

export interface CapturedSource {
  workspaceID: string
  blockID: string
  functionalityID: string
  kind: CtxPackSourceKind
  direction: CtxPackDirection
  sourceTimestamp: number | null
  capturedAt: number
  entityRef: { type: string; id: string } | null
  label: string | null
  metadata: Record<string, string | number | boolean | null>
  sensitivity: CtxPackSensitivity
}

export interface CapturedCtxPackFragment {
  clientFragmentID: string
  text: string
  source: CapturedSource
}

/** Maximum captured fragment size in UTF-8 bytes (32 KiB). */
export const MAX_CTXPACK_FRAGMENT_BYTES = 32 * 1024

/** Normalizes raw selected text: CRLF -> LF, strip trailing spaces/tabs per line, trim. */
export function normalizeSelectedText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim()
}

export function captureCtxPackResponse(input: {
  element: Element
  text: string
  sessionID?: string
  tabID?: string
  direction?: CtxPackDirection
  messageID: string
  timestamp: number
  now: number
}): CapturedCtxPackFragment | null {
  const root = resolveSourceRoot(input.element)
  const text = normalizeSelectedText(input.text)
  if (!root || !text || new TextEncoder().encode(text).byteLength > MAX_CTXPACK_FRAGMENT_BYTES) return null
  const source = readRootDataset(root)
  if (!source.workspaceID || !source.blockID || !source.functionalityID) return null
  return {
    clientFragmentID: crypto.randomUUID(),
    text,
    source: {
      ...source,
      kind: "block-text",
      direction: input.direction ?? "received",
      sourceTimestamp: input.timestamp,
      capturedAt: input.now,
      entityRef: { type: "message", id: input.messageID },
      label: null,
      metadata: {
        ...(input.sessionID ? { sessionID: input.sessionID } : {}),
        ...(input.tabID ? { tabID: input.tabID } : {}),
      },
      sensitivity: "workspace",
    },
  }
}

function resolveSourceRoot(node: Node): Element | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.parentElement?.closest("[data-ctxpack-source-root]") ?? null
  }
  return node instanceof Element ? node.closest("[data-ctxpack-source-root]") : null
}

/**
 * Walks ancestors from `node` up to (and excluding) `root`, returning true
 * when any of them is an editable region (input, textarea, or
 * contenteditable).
 */
function hasEditableAncestor(node: Node, root: Element): boolean {
  let current: Node | null = node
  while (current !== null && current !== root) {
    if (current instanceof HTMLElement) {
      if (
        current.tagName === "INPUT" ||
        current.tagName === "TEXTAREA" ||
        current.getAttribute("contenteditable") === "true" ||
        current.isContentEditable
      ) {
        return true
      }
    }
    current = current.parentNode
  }
  return false
}

function readRootDataset(root: Element): CtxPackSourceRootDataset {
  const dataset = (root as HTMLElement).dataset
  return {
    workspaceID: dataset.workspaceId ?? "",
    blockID: dataset.blockId ?? "",
    functionalityID: dataset.functionalityId ?? "",
  }
}

/**
 * Captures the current selection as a CtxPack fragment, or returns null when
 * the selection is not capturable (collapsed, empty, multi-block, inside an
 * editable region, outside any source root, whitespace-only, or > 32 KiB).
 */
export function captureCtxPackSelection(input: { selection: Selection; now: number }): CapturedCtxPackFragment | null {
  const { selection, now } = input

  if (selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (range.collapsed) return null

  // Both range boundary containers must resolve to the SAME source root;
  // multi-block selections are rejected.
  const startRoot = resolveSourceRoot(range.startContainer)
  const endRoot = resolveSourceRoot(range.endContainer)
  if (startRoot === null || endRoot === null || startRoot !== endRoot) return null

  // Reject selections anchored inside editable regions.
  if (hasEditableAncestor(range.startContainer, startRoot)) return null
  if (hasEditableAncestor(range.endContainer, startRoot)) return null

  const text = normalizeSelectedText(selection.toString())
  if (text.length === 0) return null
  if (new TextEncoder().encode(text).byteLength > MAX_CTXPACK_FRAGMENT_BYTES) return null

  const dataset = readRootDataset(startRoot)

  return {
    clientFragmentID: crypto.randomUUID(),
    text,
    source: {
      workspaceID: dataset.workspaceID,
      blockID: dataset.blockID,
      functionalityID: dataset.functionalityID,
      kind: "block-text",
      direction: "unknown",
      sourceTimestamp: null,
      capturedAt: now,
      entityRef: null,
      label: null,
      metadata: {},
      sensitivity: "workspace",
    },
  }
}
