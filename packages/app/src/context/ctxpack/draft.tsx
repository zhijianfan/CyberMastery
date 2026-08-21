/**
 * CtxPack draft controller (U1).
 *
 * App-memory-only draft store for captured CtxPack fragments. The workspace
 * shell mounts exactly ONE provider; blocks never mount their own. The draft
 * is never persisted (no localStorage, IndexedDB, or server calls) and is
 * discarded whenever the workspace identity or workspace epoch changes.
 *
 * The controller enforces ONLY dedupe + clear-on-epoch-change; the create
 * dialog enforces the 1-32 fragment budget and capture enforces the 32 KiB
 * per-fragment limit.
 */
// NOTE: we import the reactive core from the public client-build subpath
// (`solid-js/dist/solid.js`) rather than the bare `solid-js` specifier.
// Under the repo's bun test invocation (`bun test --conditions=solid`),
// bun's default `node` export condition makes the bare specifier resolve to
// the SSR entry (`dist/server.js`), where `createEffect` is a no-op stub —
// which would silently disable auto-clear-on-epoch semantics in tests.
// `solid-js/dist/solid.js` is the exact client runtime the app bundles in
// production; both resolve to the same code outside that test setup.
// @ts-ignore solid-js/dist has no declaration file (tsgo ignores the ambient decl)
import { createContext, createEffect, createSignal, useContext, type Accessor, type JSX } from "solid-js/dist/solid.js"
import { normalizeSelectedText, type CapturedCtxPackFragment } from "./selection"

export interface CtxPackDraftController {
  workspaceID(): string | undefined
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
  const [fragments, setFragments] = createSignal<CapturedCtxPackFragment[]>([])

  createEffect(() => {
    void workspaceID()
    void workspaceEpoch()
    setFragments([])
  })

  const controller: CtxPackDraftController = {
    workspaceID: () => workspaceID(),
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
      setFragments((prev: CapturedCtxPackFragment[]) => [...prev, fragment])
      return { status: "added" }
    },
    remove(clientFragmentID) {
      setFragments((prev: CapturedCtxPackFragment[]) =>
        prev.filter((fragment: CapturedCtxPackFragment) => fragment.clientFragmentID !== clientFragmentID))
    },
    move(clientFragmentID, targetOrdinal) {
      setFragments((prev: CapturedCtxPackFragment[]) => {
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
      setFragments([])
    },
    byteLength() {
      return fragments().reduce(
        (total: number, fragment: CapturedCtxPackFragment) => total + new TextEncoder().encode(fragment.text).byteLength,
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
