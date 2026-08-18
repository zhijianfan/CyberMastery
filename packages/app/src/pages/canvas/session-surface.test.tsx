import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import { createComponent, onCleanup, type Component, type JSX } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import type { CanvasSessionSurfaceProps } from "./session-surface"
import type { SessionSurfaceTarget } from "./session-target"

// Bun's TSX transform emits classic React.createElement calls, so shim the
// React global with solid's hyperscript before any JSX runs. Run the suite
// with --conditions=browser (the browser export key precedes node in
// solid-js) so solid resolves its client builds. Bun's transform also
// evaluates JSX props eagerly, so props are static snapshots: tests remount
// surfaces to change focused state instead of updating signals.
function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

const Fragment = (props: { children?: unknown }) => props.children

;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

interface RecordedBaseProps {
  target: SessionSurfaceTarget
  surfaceID: string
  focused: boolean
  queueEnabled: boolean
  onFocus: () => void
  onRequestOpenFullPage?: () => void
}

const recordedBases: RecordedBaseProps[] = []
const keyEvents: string[] = []
let baseDisposals = 0

let CanvasSessionSurface: Component<CanvasSessionSurfaceProps>
let scopeModule: typeof import("./session-scope")

beforeAll(async () => {
  scopeModule = await import("./session-scope")

  // Track U2's base is exercised by its own suite; stand in with a minimal
  // recording shell so this suite can test the U3 adapter's delivery of
  // target, surface identity, focus, queue, and full-page props.
  mock.module("../session-surface-base", () => {
    const SessionSurfaceBase = (props: {
      target: SessionSurfaceTarget
      surfaceID?: string
      focused?: boolean
      queueEnabled?: boolean
      onFocus?: () => void
      onRequestOpenFullPage?: () => void
    }) => {
      const surfaceID = props.surfaceID ?? "unscoped"
      const focused = props.focused ?? true
      recordedBases.push({
        target: props.target,
        surfaceID,
        focused,
        queueEnabled: props.queueEnabled ?? false,
        onFocus: props.onFocus ?? (() => {}),
        onRequestOpenFullPage: props.onRequestOpenFullPage,
      })
      onCleanup(() => {
        baseDisposals += 1
      })
      return h("div", {
        "data-base-surface-id": surfaceID,
        "data-base-session-id": props.target.sessionID,
        "data-base-focused": focused,
        "data-base-queue": props.queueEnabled ?? false,
        "data-base-full-page": props.onRequestOpenFullPage ? "true" : "false",
        onKeyDown: (event: KeyboardEvent) => {
          if (!focused) return
          keyEvents.push(`${surfaceID}:${event.key}`)
        },
      })
    }
    return { SessionSurfaceBase }
  })

  CanvasSessionSurface = (await import("./session-surface")).CanvasSessionSurface
})

const disposers: (() => void)[] = []

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
  document.body.innerHTML = ""
  recordedBases.length = 0
  keyEvents.length = 0
  baseDisposals = 0
})

function mount(ui: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(ui, host)
  disposers.push(() => {
    dispose()
    host.remove()
  })
  return host
}

function createSurface(sessionID: string, surfaceID: string, focused: boolean) {
  let focusCalls = 0
  const onFocus = () => {
    focusCalls += 1
  }
  const props = (): CanvasSessionSurfaceProps => ({
    target: { sessionID },
    surfaceID,
    focused,
    queueEnabled: false,
    onFocus,
  })
  return { props, onFocus, focusCalls: () => focusCalls }
}

function dispatchKeydown(target: EventTarget, key: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true }))
}

describe("CanvasSessionSurface", () => {
  test("renders two simultaneous surfaces with isolated scoped identities", () => {
    const a = createSurface("sess-a", "block-a", false)
    const b = createSurface("sess-b", "block-b", false)

    const host = mount(() => (
      <div>
        <CanvasSessionSurface {...a.props()} queueEnabled={true} />
        <CanvasSessionSurface {...b.props()} />
      </div>
    ))

    expect(recordedBases.length).toBe(2)
    expect(recordedBases[0]?.target.sessionID).toBe("sess-a")
    expect(recordedBases[1]?.target.sessionID).toBe("sess-b")
    expect(recordedBases[0]?.surfaceID).toBe("block-a")
    expect(recordedBases[1]?.surfaceID).toBe("block-b")

    const roots = host.querySelectorAll("[data-surface-id]")
    expect(roots.length).toBe(2)
    expect(roots[0]?.getAttribute("data-session-id")).toBe("sess-a")
    expect(roots[1]?.getAttribute("data-session-id")).toBe("sess-b")
    expect(roots[0]).not.toBe(roots[1])

    expect(document.getElementById(scopeModule.scopedSurfaceId("block-a", "root"))).toBe(roots[0])
    expect(document.getElementById(scopeModule.scopedSurfaceId("block-b", "root"))).toBe(roots[1])

    expect(recordedBases[0]?.queueEnabled).toBe(true)
    expect(recordedBases[1]?.queueEnabled).toBe(false)
  })

  test("supports two instances of the same session without collisions", () => {
    const a = createSurface("sess-shared", "block-a", false)
    const b = createSurface("sess-shared", "block-b", true)

    const host = mount(() => (
      <div>
        <CanvasSessionSurface {...a.props()} />
        <CanvasSessionSurface {...b.props()} />
      </div>
    ))

    expect(host.querySelectorAll("[data-surface-id]").length).toBe(2)
    expect(recordedBases[0]?.target.sessionID).toBe("sess-shared")
    expect(recordedBases[1]?.target.sessionID).toBe("sess-shared")
    expect(scopeModule.scopedSurfaceId("block-a", "root")).not.toBe(scopeModule.scopedSurfaceId("block-b", "root"))
    expect(host.querySelector('[data-surface-id="block-b"]')?.getAttribute("data-focused")).toBe("true")
  })

  test("propagates focus only from unfocused surfaces", () => {
    const a = createSurface("sess-a", "block-a", true)
    const b = createSurface("sess-b", "block-b", false)
    const host = mount(() => (
      <div>
        <CanvasSessionSurface {...a.props()} />
        <CanvasSessionSurface {...b.props()} />
      </div>
    ))
    const rootA = host.querySelector('[data-surface-id="block-a"]') as HTMLElement
    const rootB = host.querySelector('[data-surface-id="block-b"]') as HTMLElement

    rootB.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    expect(b.focusCalls()).toBe(1)
    expect(a.focusCalls()).toBe(0)

    rootA.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    expect(a.focusCalls()).toBe(0)
    expect(b.focusCalls()).toBe(1)

    expect(recordedBases[0]?.onFocus).toBe(a.onFocus)
    expect(recordedBases[1]?.onFocus).toBe(b.onFocus)
  })

  test("delivers focus-scoped key handling per surface", () => {
    const a = createSurface("sess-a", "block-a", true)
    const b = createSurface("sess-b", "block-b", false)
    const host = mount(() => (
      <div>
        <CanvasSessionSurface {...a.props()} />
        <CanvasSessionSurface {...b.props()} />
      </div>
    ))
    const baseA = host.querySelector('[data-base-surface-id="block-a"]') as HTMLElement
    const baseB = host.querySelector('[data-base-surface-id="block-b"]') as HTMLElement

    dispatchKeydown(baseA, "x")
    expect(keyEvents).toEqual(["block-a:x"])

    dispatchKeydown(baseB, "y")
    expect(keyEvents).toEqual(["block-a:x"])

    while (disposers.length > 0) disposers.pop()?.()
    document.body.innerHTML = ""
    keyEvents.length = 0

    const a2 = createSurface("sess-a", "block-a", false)
    const b2 = createSurface("sess-b", "block-b", true)
    const host2 = mount(() => (
      <div>
        <CanvasSessionSurface {...a2.props()} />
        <CanvasSessionSurface {...b2.props()} />
      </div>
    ))
    const baseA2 = host2.querySelector('[data-base-surface-id="block-a"]') as HTMLElement
    const baseB2 = host2.querySelector('[data-base-surface-id="block-b"]') as HTMLElement

    dispatchKeydown(baseB2, "z")
    expect(keyEvents).toEqual(["block-b:z"])

    dispatchKeydown(baseA2, "k")
    expect(keyEvents).toEqual(["block-b:z"])
  })

  test("remounting preserves the session target without stale handlers", () => {
    const a = createSurface("sess-a", "block-a", false)

    const first = mount(() => <CanvasSessionSurface {...a.props()} />)
    expect(first.querySelector('[data-surface-id="block-a"]')?.getAttribute("data-session-id")).toBe("sess-a")

    while (disposers.length > 0) disposers.pop()?.()
    document.body.innerHTML = ""

    const a2 = createSurface("sess-a", "block-a", true)
    const second = mount(() => <CanvasSessionSurface {...a2.props()} />)
    expect(second.querySelector('[data-surface-id="block-a"]')?.getAttribute("data-session-id")).toBe("sess-a")
    expect(baseDisposals).toBe(1)

    expect(recordedBases.length).toBe(2)
    expect(recordedBases[0]?.target.sessionID).toBe("sess-a")
    expect(recordedBases[1]?.target.sessionID).toBe("sess-a")

    const base = second.querySelector('[data-base-surface-id="block-a"]') as HTMLElement
    dispatchKeydown(base, "k")
    expect(keyEvents).toEqual(["block-a:k"])
  })

  test("exposes queue and full-page capabilities per surface", () => {
    const opened: string[] = []
    const a = createSurface("sess-a", "block-a", false)
    const b = createSurface("sess-b", "block-b", false)

    const host = mount(() => (
      <div>
        <CanvasSessionSurface {...a.props()} queueEnabled={true} onRequestOpenFullPage={() => opened.push("block-a")} />
        <CanvasSessionSurface {...b.props()} />
      </div>
    ))

    expect(recordedBases[0]?.queueEnabled).toBe(true)
    expect(recordedBases[0]?.onRequestOpenFullPage).toBeTruthy()
    expect(recordedBases[1]?.queueEnabled).toBe(false)
    expect(recordedBases[1]?.onRequestOpenFullPage).toBeUndefined()

    expect(host.querySelector('[data-base-surface-id="block-a"]')?.getAttribute("data-base-queue")).toBe("true")
    expect(host.querySelector('[data-base-surface-id="block-b"]')?.getAttribute("data-base-queue")).toBe("false")
    expect(host.querySelector('[data-base-surface-id="block-a"]')?.getAttribute("data-base-full-page")).toBe("true")

    recordedBases[0]?.onRequestOpenFullPage?.()
    expect(opened).toEqual(["block-a"])
  })
})
