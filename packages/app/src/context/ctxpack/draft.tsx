/**
 * CtxPack draft controller (U1).
 *
 * App-memory-only draft store for captured CtxPack fragments. The workspace
 * shell mounts exactly ONE provider; blocks never mount their own. The draft
 * is never persisted (no localStorage, IndexedDB, or server calls) and is
 * discarded whenever the workspace identity or workspace epoch changes.
 *
 * Selection actions and response buttons open the same create dialog through
 * this controller. It dedupes fragments and clears on epoch changes; the
 * dialog and capture boundary enforce the fragment and size budgets.
 */
import { createContext, createEffect, useContext, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { normalizeSelectedText, type CapturedCtxPackFragment } from "./selection"

export interface CtxPackDraftController {
  workspaceID(): string | undefined
  createOpen(): boolean
  openCreate(): void
  closeCreate(): void
  fragments(): readonly CapturedCtxPackFragment[]
  add(fragment: CapturedCtxPackFragment): { status: "added" | "duplicate" }
  remove(clientFragmentID: string): void
  move(clientFragmentID: string, targetOrdinal: number): void
  clear(): void
  byteLength(): number // sum of UTF-8 bytes over fragments
  estimatedTokens(): number // Math.ceil(byteLength() / 4)
}

export interface CtxPackDraftProviderProps {
  workspaceID: Accessor<string | undefined>
  workspaceEpoch: Accessor<number>
  children?: JSX.Element
}

const CtxPackDraftContext = createContext<CtxPackDraftController>()

/**
 * Creates an in-memory draft controller bound to the workspace identity and
 * epoch accessors. Any change to either accessor clears the draft. Exported
 * separately from the provider so the controller can be exercised directly
 * (the repo's test setup resolves solid-js/web to its server build under the
 * `solid` export condition, so component-rendering tests are avoided).
 */
export function createCtxPackDraftController(
  workspaceID: Accessor<string | undefined>,
  workspaceEpoch: Accessor<number>,
): CtxPackDraftController {
  const [state, setState] = createStore({ fragments: [] as CapturedCtxPackFragment[], createOpen: false })
  const fragments = () => state.fragments

  createEffect(() => {
    void workspaceID()
    void workspaceEpoch()
    setState({ fragments: [], createOpen: false })
  })

  const controller: CtxPackDraftController = {
    workspaceID: () => workspaceID(),
    createOpen: () => state.createOpen,
    openCreate: () => setState("createOpen", true),
    closeCreate: () => setState("createOpen", false),
    fragments,
    add(fragment) {
      const normalized = normalizeSelectedText(fragment.text)
      const duplicate = fragments().some(
        (existing: CapturedCtxPackFragment) =>
          normalizeSelectedText(existing.text) === normalized &&
          existing.source.workspaceID === fragment.source.workspaceID &&
          existing.source.blockID === fragment.source.blockID &&
          existing.source.functionalityID === fragment.source.functionalityID,
      )
      if (duplicate) return { status: "duplicate" }
      setState("fragments", (prev) => [...prev, fragment])
      return { status: "added" }
    },
    remove(clientFragmentID) {
      setState("fragments", (prev) =>
        prev.filter((fragment: CapturedCtxPackFragment) => fragment.clientFragmentID !== clientFragmentID),
      )
    },
    move(clientFragmentID, targetOrdinal) {
      setState("fragments", (prev) => {
        const from = prev.findIndex(
          (fragment: CapturedCtxPackFragment) => fragment.clientFragmentID === clientFragmentID,
        )
        if (from === -1 || !Number.isFinite(targetOrdinal)) return prev
        const to = Math.min(Math.max(targetOrdinal, 0), prev.length - 1)
        if (to === from) return prev
        const next = [...prev]
        const [fragment] = next.splice(from, 1)
        next.splice(to, 0, fragment)
        return next
      })
    },
    clear() {
      setState("fragments", [])
    },
    byteLength() {
      return fragments().reduce(
        (total: number, fragment: CapturedCtxPackFragment) =>
          total + new TextEncoder().encode(fragment.text).byteLength,
        0,
      )
    },
    estimatedTokens() {
      return Math.ceil(controller.byteLength() / 4)
    },
  }

  return controller
}

/**
 * One shared in-memory draft per workspace-shell mount (the host mounts ONE
 * provider; blocks never mount their own). Any change to the workspace
 * identity or workspace epoch clears the draft.
 */
export function CtxPackDraftProvider(props: CtxPackDraftProviderProps) {
  const controller = createCtxPackDraftController(props.workspaceID, props.workspaceEpoch)
  return <CtxPackDraftContext.Provider value={controller}>{props.children}</CtxPackDraftContext.Provider>
}

export function useCtxPackDraft(): CtxPackDraftController {
  const ctx = useContext(CtxPackDraftContext)
  if (!ctx) {
    throw new Error("useCtxPackDraft must be used within a CtxPackDraftProvider")
  }
  return ctx
}
