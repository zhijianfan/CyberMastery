import { afterEach, beforeAll, expect, mock, test } from "bun:test"
import { createComponent, type ParentProps } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length) next.children = children.length === 1 ? children[0] : children
  return () => createComponent(tag as never, next)
}

Object.assign(globalThis, { React: { createElement } })

mock.module("@opencode-ai/ui/context/dialog", () => ({ useDialog: () => ({ active: false }) }))
mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
mock.module("@/context/settings", () => ({ useSettings: () => ({ keybinds: { get: () => undefined } }) }))
mock.module("@/context/platform", () => ({ usePlatform: () => ({ platform: "web" }) }))

let command: typeof import("./command")
let dispose: VoidFunction | undefined

beforeAll(async () => {
  command = await import("./command")
})

afterEach(() => {
  dispose?.()
  document.body.innerHTML = ""
})

test("local chat shortcuts bypass global capture without changing other page shortcuts", () => {
  const host = document.createElement("div")
  document.body.append(host)
  const globalActions: string[] = []
  const localActions: string[] = []
  const shortcuts = [
    { id: "file.attach", keybind: "ctrl+u", key: "u", ctrlKey: true },
    { id: "session.interrupt", keybind: "escape", key: "Escape", ctrlKey: false },
    { id: "session.submit", keybind: "ctrl+enter", key: "Enter", ctrlKey: true },
  ]
  const first = document.createElement("section")
  first.dataset.commandScope = "local"
  const editor = document.createElement("textarea")
  first.append(editor)
  editor.addEventListener("keydown", (event) => {
    localActions.push(event.key)
    event.preventDefault()
  })
  const outside = document.createElement("button")
  const capture = () => {
    const actions = command.useCommand()
    actions.register(() =>
      shortcuts.map((shortcut) => ({
        id: shortcut.id,
        title: shortcut.id,
        keybind: shortcut.keybind,
        onSelect: () => globalActions.push(shortcut.id),
      })),
    )
    return [first, outside]
  }
  dispose = render(
    () =>
      createComponent(command.CommandProvider, {
        children: capture as unknown as ParentProps["children"],
      }),
    host,
  )

  shortcuts.forEach((shortcut) => {
    const event = new KeyboardEvent("keydown", { ...shortcut, bubbles: true, cancelable: true, composed: true })
    editor.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
  expect(localActions).toEqual(["u", "Escape", "Enter"])
  expect(globalActions).toEqual([])

  shortcuts.forEach((shortcut) => {
    const event = new KeyboardEvent("keydown", { ...shortcut, bubbles: true, cancelable: true, composed: true })
    outside.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
  expect(globalActions).toEqual(["file.attach", "session.interrupt", "session.submit"])
})
