import { afterEach, expect, spyOn, test } from "bun:test"
import { MasterAgentBlockShell, type MasterAgentBindingStatus, type MasterAgentBlockShellProps } from "./block-shell"

// Bun compiles JSX in this package with the classic factory (tsconfig jsx
// is "preserve", which Bun falls back to `React.createElement`), and plain
// `bun test` resolves solid-js to its server build. These components use no
// solid runtime APIs, so the tests render them through a tiny JSX factory
// instead of solid's client renderer.
function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Node {
  if (typeof tag === "function") {
    const next: Record<string, unknown> = { ...(props ?? {}) }
    if (children.length > 0) next.children = children.length > 1 ? children : children[0]
    return wrap((tag as (nextProps: Record<string, unknown>) => unknown)(next))
  }
  const element = document.createElement(tag as string)
  applyProps(element, props)
  appendChildren(element, children)
  return element
}

function applyProps(element: Element, props: Record<string, unknown> | null) {
  if (!props) return
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || key === "children") continue
    if (key === "class") {
      element.setAttribute("class", String(value))
      continue
    }
    if (key === "classList") {
      for (const [name, active] of Object.entries(value as Record<string, boolean>)) {
        if (active) element.classList.add(name)
      }
      continue
    }
    if (key.startsWith("on")) {
      element.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
      continue
    }
    if (key.startsWith("aria-")) {
      element.setAttribute(key, String(value))
      continue
    }
    if (typeof value === "boolean") {
      if (value) element.setAttribute(key, "")
      else element.removeAttribute(key)
      continue
    }
    element.setAttribute(key, String(value))
  }
}

function appendChildren(parent: Node, children: unknown[]) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false || child === true) continue
    parent.appendChild(wrap(child))
  }
}

function wrap(value: unknown): Node {
  if (typeof value === "function") return wrap(value())
  if (value instanceof Node) return value
  if (Array.isArray(value)) {
    const fragment = document.createDocumentFragment()
    for (const item of value) fragment.appendChild(wrap(item))
    return fragment
  }
  return document.createTextNode(String(value ?? ""))
}

Object.assign(globalThis, { React: { createElement } })

const sessionMarker = <div data-testid="session-slot" />
const coderMarker = <div data-testid="coder-slot" />

interface CallCounts {
  focus: number
  retry: number
  reset: number
  openFullPage: number
}

function mountShell(overrides: Partial<MasterAgentBlockShellProps> = {}) {
  const calls: CallCounts = { focus: 0, retry: 0, reset: 0, openFullPage: 0 }
  const container = document.createElement("div")
  document.body.appendChild(container)
  container.appendChild(
    createElement(MasterAgentBlockShell, {
      status: "ready",
      focused: false,
      canReset: true,
      onFocus: () => calls.focus++,
      onRetry: () => calls.retry++,
      onReset: () => calls.reset++,
      onOpenFullPage: () => calls.openFullPage++,
      ...overrides,
    }),
  )
  return { container, calls }
}

afterEach(() => {
  document.body.innerHTML = ""
})

test("renders the session and coder slots when ready", () => {
  const mounted = mountShell({ sessionSlot: sessionMarker, coderSlot: coderMarker })
  expect(mounted.container.querySelector('[data-testid="session-slot"]')).not.toBeNull()
  expect(mounted.container.querySelector('[data-testid="coder-slot"]')).not.toBeNull()
  expect(mounted.container.querySelector(".master-agent-status")).toBeNull()
})

test("hides the slots while the session is not ready", () => {
  const mounted = mountShell({ status: "loading", sessionSlot: sessionMarker, coderSlot: coderMarker })
  expect(mounted.container.querySelector('[data-testid="session-slot"]')).toBeNull()
  expect(mounted.container.querySelector('[data-testid="coder-slot"]')).toBeNull()
  expect(mounted.container.querySelector(".master-agent-status")).not.toBeNull()
})

test("marks the shell with the active status", () => {
  const statuses: MasterAgentBindingStatus[] = [
    "uninitialized",
    "loading",
    "ready",
    "permission-denied",
    "unavailable",
    "error",
  ]
  for (const status of statuses) {
    const mounted = mountShell({ status })
    expect(mounted.container.querySelector(".master-agent-shell")?.getAttribute("data-status")).toBe(status)
  }
})

test("renders the uninitialized status without a retry action", () => {
  const mounted = mountShell({ status: "uninitialized" })
  expect(mounted.container.textContent).toContain("Session not initialized")
  expect(mounted.container.querySelector(".master-agent-retry-button")).toBeNull()
})

test("renders the loading status without a retry action", () => {
  const mounted = mountShell({ status: "loading" })
  expect(mounted.container.textContent).toContain("Connecting session")
  expect(mounted.container.querySelector(".master-agent-status.is-loading")).not.toBeNull()
  expect(mounted.container.querySelector(".master-agent-retry-button")).toBeNull()
})

test("renders the permission denied status without a retry action", () => {
  const mounted = mountShell({ status: "permission-denied" })
  expect(mounted.container.textContent).toContain("Permission denied")
  expect(mounted.container.querySelector(".master-agent-retry-button")).toBeNull()
})

test("renders the unavailable status with a retry action that calls onRetry", () => {
  const mounted = mountShell({ status: "unavailable" })
  expect(mounted.container.textContent).toContain("Session unavailable")
  const retry = mounted.container.querySelector(".master-agent-retry-button")
  expect(retry).not.toBeNull()
  ;(retry as HTMLButtonElement).click()
  expect(mounted.calls.retry).toBe(1)
})

test("renders the error status with a retry action that calls onRetry", () => {
  const mounted = mountShell({ status: "error" })
  expect(mounted.container.textContent).toContain("Something went wrong")
  const retry = mounted.container.querySelector(".master-agent-retry-button")
  expect(retry).not.toBeNull()
  ;(retry as HTMLButtonElement).click()
  expect(mounted.calls.retry).toBe(1)
})

test("calls onFocus when the shell is clicked", () => {
  const mounted = mountShell({ status: "ready", sessionSlot: sessionMarker })
  const shell = mounted.container.querySelector(".master-agent-shell")
  expect(shell).not.toBeNull()
  ;(shell as HTMLElement).click()
  expect(mounted.calls.focus).toBe(1)
})

test("applies the focused modifier class", () => {
  const mounted = mountShell({ focused: true })
  expect(mounted.container.querySelector(".master-agent-shell")?.classList.contains("focused")).toBeTrue()
})

test("enabled reset button calls onReset", () => {
  const mounted = mountShell({ status: "ready" })
  const reset = mounted.container.querySelector<HTMLButtonElement>(".master-agent-button.primary")
  expect(reset).not.toBeNull()
  reset!.click()
  expect(mounted.calls.reset).toBe(1)
})

test("disabled reset shows the reason and never calls onReset", () => {
  const mounted = mountShell({ canReset: false, resetDisabledReason: "Session is busy" })
  const reset = mounted.container.querySelector<HTMLButtonElement>(".master-agent-button.primary")
  expect(reset?.disabled).toBeTrue()
  expect(reset?.getAttribute("aria-disabled")).toBe("true")
  expect(mounted.container.textContent).toContain("Session is busy")
  reset?.click()
  expect(mounted.calls.reset).toBe(0)
})

test("renders the full page action only when a handler is provided", () => {
  const without = mountShell({ onOpenFullPage: undefined })
  expect(without.container.textContent).not.toContain("Full page")

  const withHandler = mountShell()
  const button = withHandler.container.querySelector<HTMLButtonElement>(".master-agent-button:not(.primary)")
  expect(button).not.toBeNull()
  button!.click()
  expect(withHandler.calls.openFullPage).toBe(1)
})

test("never issues backend calls on its own", () => {
  const fetchSpy = spyOn(globalThis, "fetch")
  const mounted = mountShell({ status: "error" })
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(mounted.container.querySelector(".master-agent-status")).not.toBeNull()
})
