import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createComponent, type ParentProps } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import { ThemeProvider, useTheme } from "@opencode-ai/ui/theme"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length) next.children = children.length === 1 ? children[0] : children
  return () => createComponent(tag as never, next)
}

// Bun's classic JSX transform needs Solid's component creation at this boundary.
Object.assign(globalThis, { React: { createElement } })

const disposers: VoidFunction[] = []

beforeEach(() => {
  localStorage.clear()
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("data-color-scheme")
})

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  document.body.innerHTML = ""
})

function mount() {
  const host = document.createElement("div")
  document.body.append(host)
  const observed: ReturnType<typeof useTheme>[] = []
  const capture = () => {
    observed.push(useTheme())
    return null
  }
  disposers.push(
    render(
      () =>
        createComponent(ThemeProvider, {
          children: capture as unknown as ParentProps["children"],
        }),
      host,
    ),
  )
  return observed[0]
}

describe("global color scheme", () => {
  test("starts dark and switches the entire document to a persisted light choice", async () => {
    const theme = mount()
    expect(theme.colorScheme()).toBe("dark")
    expect(theme.mode()).toBe("dark")
    expect(document.documentElement.dataset.colorScheme).toBe("dark")

    theme.setColorScheme("light")
    await Promise.resolve()
    expect(document.documentElement.dataset.colorScheme).toBe("light")
    expect(localStorage.getItem("opencode-color-scheme")).toBe("light")
    expect(document.getElementById("oc-theme")?.textContent).toContain("color-scheme: light")

    disposers.splice(0).forEach((dispose) => dispose())
    expect(mount().mode()).toBe("light")
  })

  test("keeps an explicit system preference and follows settings changes from another window", async () => {
    localStorage.setItem("opencode-color-scheme", "system")
    const theme = mount()
    expect(theme.colorScheme()).toBe("system")
    expect(theme.mode()).toBe(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")

    window.dispatchEvent(new StorageEvent("storage", { key: "opencode-color-scheme", newValue: "dark" }))
    await Promise.resolve()
    expect(theme.colorScheme()).toBe("dark")
    expect(document.documentElement.dataset.colorScheme).toBe("dark")
  })
})
