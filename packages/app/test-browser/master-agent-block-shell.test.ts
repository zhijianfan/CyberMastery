import { afterEach, expect, test } from "bun:test"
import { createComponent, createSignal } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import type { MasterAgentBindingStatus } from "../src/pages/canvas/master-agent/block-shell"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

const Fragment = (props: { children?: unknown }) => props.children

;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

afterEach(() => {
  document.body.innerHTML = ""
})

test("replaces the connecting status with the session when the binding becomes ready", async () => {
  const { MasterAgentBlockShell } = await import("../src/pages/canvas/master-agent/block-shell")
  const [status, setStatus] = createSignal<MasterAgentBindingStatus>("loading")
  const container = document.createElement("div")
  document.body.appendChild(container)
  const dispose = render(
    () =>
      createComponent(MasterAgentBlockShell, {
        get status() {
          return status()
        },
        focused: false,
        canReset: true,
        onFocus: () => {},
        onRetry: () => {},
        onReset: () => {},
        sessionSlot: h("div", { "data-testid": "session-slot" }),
      }),
    container,
  )

  expect(container.textContent).toContain("Connecting session")
  setStatus("ready")
  expect(container.querySelector('[data-testid="session-slot"]')).not.toBeNull()
  expect(container.querySelector(".master-agent-status")).toBeNull()
  dispose()
})
