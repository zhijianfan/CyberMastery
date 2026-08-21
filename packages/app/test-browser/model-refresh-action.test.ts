import { afterEach, expect, test } from "bun:test"
import { createComponent } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"

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

test("renders the model refresh lifecycle", async () => {
  const { createModelRefreshState, ModelRefreshAction } = await import("../src/pages/canvas/model-refresh-action")
  let resolveRefresh: ((value: unknown) => void) | undefined
  let rejectRefresh: ((reason?: unknown) => void) | undefined
  let refreshResult: Promise<unknown> = Promise.resolve()
  const state = createModelRefreshState(() => refreshResult)
  const container = document.createElement("div")
  document.body.appendChild(container)
  const dispose = render(
    () =>
      createComponent(ModelRefreshAction, {
        refreshing: state.refreshing,
        refreshError: state.refreshError,
        onRefresh: state.refresh,
        t: (key) => key,
      }),
    container,
  )

  const button = () => {
    const element = container.querySelector(".canvas-model-picker-refresh")
    if (!(element instanceof HTMLButtonElement)) throw new Error("refresh button not found")
    return element
  }
  expect(button().disabled).toBeFalse()
  expect(button().textContent).toBe("canvas.model.refresh")
  expect(container.querySelector('[role="alert"]')).toBeNull()

  refreshResult = new Promise((resolve) => {
    resolveRefresh = resolve
  })
  button().click()
  expect(button().disabled).toBeTrue()
  expect(button().textContent).toBe("canvas.model.refreshing")
  resolveRefresh?.(undefined)
  await Promise.resolve()
  await Promise.resolve()
  expect(button().disabled).toBeFalse()
  expect(container.querySelector('[role="alert"]')).toBeNull()

  refreshResult = new Promise((_, reject) => {
    rejectRefresh = reject
  })
  button().click()
  rejectRefresh?.(new Error("offline"))
  await Promise.resolve()
  await Promise.resolve()
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("canvas.model.refresh.error")

  refreshResult = new Promise((resolve) => {
    resolveRefresh = resolve
  })
  button().click()
  expect(container.querySelector('[role="alert"]')).toBeNull()
  resolveRefresh?.(undefined)
  await Promise.resolve()
  await Promise.resolve()
  expect(button().disabled).toBeFalse()
  expect(container.querySelector('[role="alert"]')).toBeNull()
  dispose()
})
