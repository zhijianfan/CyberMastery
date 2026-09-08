import { createContext, createRenderEffect, createSignal, onCleanup, useContext } from "solid-js"
import type { JSX } from "solid-js"
import { CTXPACK_DRAG_MIME, parseCtxPackDragPayload, type CtxPackDragPayloadV1 } from "./drag"

export interface MessageContextTargetRegistration {
  targetID: string
  workspaceID: string
  instanceID: string
  functionalityID: string
  disabled(): boolean
  addCtxPack(payload: CtxPackDragPayloadV1): Promise<void>
}

export interface MessageContextTargetRegistry {
  register(target: MessageContextTargetRegistration): () => void
  markFocused(targetID: string): void
  focused(): MessageContextTargetRegistration | null
  attachToFocused(payload: CtxPackDragPayloadV1): Promise<void>
}

/** Class applied to a drop target wrapper while a valid CtxPack payload hovers it. */
export const CTXPACK_DROP_RING_CLASS = "ctxpack-drop-ring"

const NO_FOCUSED_TARGET_CODE = "no-focused-target"

function noFocusedTargetError(): Error {
  const error = new Error(NO_FOCUSED_TARGET_CODE)
  ;(error as Error & { code?: string }).code = NO_FOCUSED_TARGET_CODE
  return error
}

export function createMessageContextTargetRegistry(): MessageContextTargetRegistry {
  const targets = new Map<string, Array<{ target: MessageContextTargetRegistration }>>()
  let focusedTargetID: string | null = null

  const focused = (): MessageContextTargetRegistration | null => {
    if (focusedTargetID === null) return null
    const target = targets.get(focusedTargetID)?.at(-1)?.target
    if (target === undefined || target.disabled()) return null
    return target
  }

  return {
    register(target) {
      const registration = { target }
      const registrations = targets.get(target.targetID) ?? []
      registrations.push(registration)
      targets.set(target.targetID, registrations)
      return () => {
        const current = targets.get(target.targetID)
        if (current === undefined) return
        const index = current.indexOf(registration)
        if (index === -1) return
        current.splice(index, 1)
        if (current.length > 0) return
        targets.delete(target.targetID)
        if (focusedTargetID === target.targetID) focusedTargetID = null
      }
    },
    markFocused(targetID) {
      focusedTargetID = targetID
    },
    focused,
    attachToFocused(payload) {
      const target = focused()
      if (target === null) return Promise.reject(noFocusedTargetError())
      return target.addCtxPack(payload)
    },
  }
}

/** App-memory singleton registry — never persisted. */
export const messageContextTargetRegistry = createMessageContextTargetRegistry()

export const MessageContextTargetRegistryContext = createContext<MessageContextTargetRegistry>(
  messageContextTargetRegistry,
)

export function useMessageContextTargetRegistry(): MessageContextTargetRegistry {
  return useContext(MessageContextTargetRegistryContext)
}

export interface CtxPackDropTargetProps {
  targetID: string
  workspaceID: string
  instanceID: string
  functionalityID: string
  addCtxPack: (payload: CtxPackDragPayloadV1) => Promise<void>
  disabled?: () => boolean
  children: JSX.Element
  class?: string
}

/**
 * Wraps a composer input as a CtxPack drop target. Registers itself in the
 * registry, unregisters on cleanup, and guards only the MIME, the drop effect
 * and the visual ring — workspace/duplicate/limit validation belongs to the
 * attachment store.
 *
 * The wrapper element is built with plain DOM APIs and the reactive core
 * instead of JSX syntax because bun test's JSX transform is React-classic
 * under this repo's tsconfig ("jsx": "preserve"); see HANDOFF-U3.md.
 */
export function CtxPackDropTarget(props: CtxPackDropTargetProps): JSX.Element {
  const registry = useMessageContextTargetRegistry()
  const [dragOver, setDragOver] = createSignal(false)
  const disabled = () => (props.disabled ?? (() => false))()

  createRenderEffect(() => {
    const registration: MessageContextTargetRegistration = {
      targetID: props.targetID,
      workspaceID: props.workspaceID,
      instanceID: props.instanceID,
      functionalityID: props.functionalityID,
      disabled: props.disabled ?? (() => false),
      addCtxPack: props.addCtxPack,
    }
    const unregister = registry.register(registration)
    onCleanup(unregister)
  })

  const element = document.createElement("div")
  createRenderEffect(() => {
    if (disabled()) setDragOver(false)
    element.className = dragOver()
      ? [props.class, CTXPACK_DROP_RING_CLASS].filter(Boolean).join(" ")
      : (props.class ?? "")
  })

  element.addEventListener("dragover", (event: DragEvent) => {
    if (disabled()) return
    if (event.dataTransfer === null) return
    // Browsers expose MIME types during dragover, but protect the payload until drop.
    if (!Array.from(event.dataTransfer.types).includes(CTXPACK_DRAG_MIME)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setDragOver(true)
  })

  element.addEventListener("dragleave", () => {
    setDragOver(false)
  })

  element.addEventListener("drop", (event: DragEvent) => {
    if (disabled()) return
    setDragOver(false)
    if (event.dataTransfer === null) return
    const payload = parseCtxPackDragPayload(event.dataTransfer)
    if (payload === null) return
    event.preventDefault()
    void props.addCtxPack(payload)
  })

  const rawChildren =
    typeof props.children === "function" ? (props.children as () => unknown)() : props.children
  const childList = Array.isArray(rawChildren) ? rawChildren : [rawChildren]
  for (const child of childList) {
    if (child != null) element.appendChild(child as Node)
  }
  return element
}
