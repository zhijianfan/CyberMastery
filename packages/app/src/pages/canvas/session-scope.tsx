// Per-surface scope primitives. Each mounted Session surface owns a scope
// created once per mount: a stable surface ID plus a focused accessor. The
// scope derives unique, non-colliding DOM IDs for its root, messages,
// composer, terminal, review, and file-tree mounts, and gates keyboard
// ownership to the focused surface so several sessions can mount without
// singleton collisions. Scopes are pure identity helpers — they never create
// session stores or call the SDK.

import { createContext, useContext, type JSX } from "solid-js"

export interface SessionScope {
  surfaceID: () => string
  focused: () => boolean
  id: (part: string) => string
  contains: (target: EventTarget | null) => boolean
  keyboardOwned: (event: KeyboardEvent) => boolean
  setRoot: (element: HTMLDivElement | undefined) => void
  setComposer: (element: HTMLTextAreaElement | undefined) => void
  composer: () => HTMLTextAreaElement | undefined
}

export function scopedSurfaceId(surfaceID: string, part: string): string {
  return `canvas-session-${surfaceID}-${part}`
}

let surfaceCounter = 0

export function createSurfaceID(): string {
  surfaceCounter += 1
  return `surface-${surfaceCounter}-${Math.random().toString(36).slice(2, 8)}`
}

export function createSessionScope(surfaceID: () => string, focused: () => boolean): SessionScope {
  let rootElement: HTMLDivElement | undefined
  let composerElement: HTMLTextAreaElement | undefined
  const id = (part: string) => scopedSurfaceId(surfaceID(), part)
  const contains = (target: EventTarget | null) => {
    const root = rootElement
    if (!root || !target || !(target instanceof Node)) return false
    return root.contains(target)
  }
  const keyboardOwned = (event: KeyboardEvent) => {
    if (!focused()) return false
    const root = rootElement
    if (!root) return false
    return event.composedPath().some((element) => element === root) || contains(event.target)
  }
  return {
    surfaceID,
    focused,
    id,
    contains,
    keyboardOwned,
    setRoot(element) {
      rootElement = element
    },
    setComposer(element) {
      composerElement = element
    },
    composer: () => composerElement,
  }
}

const SessionScopeContext = createContext<SessionScope>()

export function SessionScopeProvider(props: { scope: SessionScope; children: JSX.Element }) {
  return <SessionScopeContext.Provider value={props.scope}>{props.children}</SessionScopeContext.Provider>
}

export function useSessionScope(): SessionScope {
  const scope = useContext(SessionScopeContext)
  if (!scope) throw new Error("useSessionScope must be used within a SessionScopeProvider")
  return scope
}

export function surfacePortalID(scope: SessionScope, part: string): string {
  return scope.id(`portal-${part}`)
}

export function surfacePortalMount(scope: SessionScope, part: string): HTMLElement | null {
  return document.getElementById(surfacePortalID(scope, part))
}

export function surfaceTerminalMountID(scope: SessionScope): string {
  return scope.id("terminal")
}

export function surfaceReviewPanelID(scope: SessionScope): string {
  return scope.id("review")
}

export function surfaceFileTreePanelID(scope: SessionScope): string {
  return scope.id("files")
}

export function focusSurfaceComposer(scope: SessionScope): boolean {
  const composer = scope.composer()
  if (!composer) return false
  composer.focus()
  return true
}

// Keyboard ownership: attach surface commands here so only the focused
// surface's handler fires for key events originating inside its root.
export function createScopedKeyHandler(scope: SessionScope, handler: (event: KeyboardEvent) => void): () => void {
  const listener = (event: KeyboardEvent) => {
    if (!scope.keyboardOwned(event)) return
    handler(event)
  }
  document.addEventListener("keydown", listener)
  return () => document.removeEventListener("keydown", listener)
}
