/** @jsxImportSource solid-js */
import { afterEach, expect, spyOn, test } from "bun:test"
import { createComponent } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import { CoderSelector, type CoderSelectorProps, type ModelSelection } from "./coder-selector"

// Bun compiles JSX in this package with the classic React.createElement
// factory and resolves solid-js to its server build unless the browser
// condition is applied, so tests must run with `--conditions=browser`. The
// React global is shimmed with solid's hyperscript below; bun evaluates JSX
// props eagerly, so prop-driven states are static snapshots: tests mount a
// fresh selector per state and drive picker visibility through the
// controlled `pickerOpen` prop.
function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next: Record<string, unknown> = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  return createComponent(tag as never, next)
}

;(globalThis as unknown as { React: unknown }).React = { createElement }

const coderMini: ModelSelection = { providerID: "acme", modelID: "coder-mini" }
const coderPro: ModelSelection = { providerID: "acme", modelID: "coder-pro", variant: "beta" }
const primary: ModelSelection = { providerID: "acme", modelID: "primary" }

interface CallCounts {
  set: ModelSelection[]
  clear: number
  retry: number
  openPicker: number
  pickerOpenChanges: boolean[]
}

const disposers: (() => void)[] = []

function mountSelector(overrides: Partial<CoderSelectorProps> = {}) {
  const calls: CallCounts = { set: [], clear: 0, retry: 0, openPicker: 0, pickerOpenChanges: [] }
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () => (
      <CoderSelector
        model={null}
        primaryModel={null}
        pending={false}
        error={null}
        permission="allow"
        onSet={(model) => calls.set.push(model)}
        onClear={() => calls.clear++}
        onRetry={() => calls.retry++}
        onOpenPicker={() => calls.openPicker++}
        onPickerOpenChange={(open) => calls.pickerOpenChanges.push(open)}
        {...overrides}
      />
    ),
    host,
  )
  disposers.push(() => {
    dispose()
    host.remove()
  })
  return { container: host, calls }
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === text,
  )
  if (!button) throw new Error(`button "${text}" not found`)
  return button
}

function keydown(target: HTMLElement, key: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true }))
}

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
  document.body.innerHTML = ""
})

test("labels the control Workspace Coder with explicit workspace-wide scope", () => {
  const mounted = mountSelector()
  expect(mounted.container.textContent).toContain("Workspace Coder")
  const scope = mounted.container.querySelector(".master-agent-coder-scope")
  expect(scope?.textContent).toContain("Workspace-wide")
  expect(scope?.getAttribute("title")).toContain("every MasterAgent block")
})

test("renders the disabled state when no Coder model is selected", () => {
  const mounted = mountSelector()
  const root = mounted.container.querySelector(".master-agent-coder")
  expect(root?.getAttribute("data-state")).toBe("disabled")
  expect(mounted.container.textContent).toContain("Disabled")
  expect(mounted.container.textContent).toContain("primary model is not used for Coder tasks")
  expect(mounted.container.querySelector('[aria-label="Clear Coder model"]')).toBeNull()
})

test("renders the selected model with change and clear controls", () => {
  const mounted = mountSelector({ model: coderMini })
  const root = mounted.container.querySelector(".master-agent-coder")
  expect(root?.getAttribute("data-state")).toBe("selected")
  expect(mounted.container.textContent).toContain("acme/coder-mini")
  expect(buttonByText(mounted.container, "Change model")).toBeTruthy()
  expect(mounted.container.querySelector('[aria-label="Clear Coder model"]')).not.toBeNull()
  expect(mounted.container.textContent).not.toContain("Disabled")
})

test("calls onClear when the clear button is clicked", () => {
  const mounted = mountSelector({ model: coderMini })
  const clear = mounted.container.querySelector<HTMLButtonElement>('[aria-label="Clear Coder model"]')
  clear!.click()
  expect(mounted.calls.clear).toBe(1)
})

test("calls onOpenPicker when no inline candidates are provided", () => {
  const mounted = mountSelector()
  buttonByText(mounted.container, "Choose model").click()
  expect(mounted.calls.openPicker).toBe(1)
  expect(mounted.calls.set).toEqual([])
})

test("shows a saving indicator and disables actions while pending", () => {
  const mounted = mountSelector({ model: coderMini, pending: true })
  const root = mounted.container.querySelector(".master-agent-coder")
  expect(root?.getAttribute("data-state")).toBe("pending")
  expect(mounted.container.textContent).toContain("Saving Coder model")
  const clear = mounted.container.querySelector<HTMLButtonElement>('[aria-label="Clear Coder model"]')
  expect(clear?.disabled).toBeTrue()
  clear?.click()
  expect(mounted.calls.clear).toBe(0)
  const change = buttonByText(mounted.container, "Change model")
  expect(change.disabled).toBeTrue()
  change.click()
  expect(mounted.calls.openPicker).toBe(0)
})

test("shows a load error visibly with a retry action", () => {
  const mounted = mountSelector({ error: { type: "patch-failed", cause: "network down" } })
  const banner = mounted.container.querySelector(".master-agent-coder-error")
  expect(banner).not.toBeNull()
  expect(banner?.getAttribute("data-error")).toBe("patch-failed")
  expect(banner?.textContent).toContain("Couldn't save the Workspace Coder model")
  expect(banner?.textContent).toContain("network down")
  buttonByText(mounted.container, "Retry").click()
  expect(mounted.calls.retry).toBe(1)
})

test("renders a generic visible error for unrecognized failures", () => {
  const mounted = mountSelector({ error: new Error("boom") })
  const banner = mounted.container.querySelector(".master-agent-coder-error")
  expect(banner?.getAttribute("data-error")).toBe("unknown")
  expect(banner?.textContent).toContain("Couldn't save the Workspace Coder model")
  expect(banner?.textContent).not.toContain("boom")
  buttonByText(mounted.container, "Retry").click()
  expect(mounted.calls.retry).toBe(1)
})

test("shows the unavailable model error with no silent fallback", () => {
  const mounted = mountSelector({ model: coderMini, error: { type: "model-unavailable", model: coderMini } })
  const root = mounted.container.querySelector(".master-agent-coder")
  expect(root?.getAttribute("data-state")).toBe("unavailable")
  const banner = mounted.container.querySelector(".master-agent-coder-error")
  expect(banner?.getAttribute("data-error")).toBe("model-unavailable")
  expect(banner?.textContent).toContain("acme/coder-mini")
  expect(banner?.textContent).toContain("not available")
  expect(banner?.textContent).toContain("No model was applied")
  buttonByText(mounted.container, "Choose model").click()
  expect(mounted.calls.openPicker).toBe(1)
  buttonByText(mounted.container, "Retry").click()
  expect(mounted.calls.retry).toBe(1)
})

test("shows a visible denial for permission-denied errors without a retry action", () => {
  const mounted = mountSelector({ error: { type: "permission-denied" } })
  const root = mounted.container.querySelector(".master-agent-coder")
  expect(root?.getAttribute("data-state")).toBe("denied")
  expect(mounted.container.textContent).toContain("Task permission denied")
  expect([...mounted.container.querySelectorAll("button")].map((item) => item.textContent)).not.toContain("Retry")
})

test("blocks selection and clearing when the task permission is denied", () => {
  const mounted = mountSelector({ model: coderMini, permission: "deny", models: [coderPro] })
  const root = mounted.container.querySelector(".master-agent-coder")
  expect(root?.getAttribute("data-state")).toBe("denied")
  expect(root?.classList.contains("is-denied")).toBeTrue()
  expect(mounted.container.textContent).toContain("Task permission denied")
  expect(mounted.container.querySelector('[aria-label="Clear Coder model"]')).toBeNull()
  expect([...mounted.container.querySelectorAll("button")].map((item) => item.textContent)).not.toContain(
    "Change model",
  )
  expect(mounted.container.querySelector('[role="listbox"]')).toBeNull()
  expect(mounted.calls.clear).toBe(0)
  expect(mounted.calls.openPicker).toBe(0)
})

test("warns softly when the Coder model matches the primary model", () => {
  const same = mountSelector({ model: primary, primaryModel: primary })
  expect(same.container.querySelector('[data-warning="same-as-primary"]')).not.toBeNull()

  const different = mountSelector({ model: coderMini, primaryModel: primary })
  expect(different.container.querySelector('[data-warning="same-as-primary"]')).toBeNull()
})

test("warns about known tool-incompatible models", () => {
  const warned = mountSelector({ model: coderMini, toolCompatible: false })
  expect(warned.container.querySelector('[data-warning="tool-incompatible"]')).not.toBeNull()

  const compatible = mountSelector({ model: coderMini })
  expect(compatible.container.querySelector('[data-warning="tool-incompatible"]')).toBeNull()
})

test("emits onSet for the picked candidate without reordering models", () => {
  const mounted = mountSelector({ models: [coderPro, coderMini], pickerOpen: true })
  const options = [...mounted.container.querySelectorAll<HTMLButtonElement>('[role="option"]')]
  expect(options.map((option) => option.textContent)).toEqual(["acme/coder-pro (beta)", "acme/coder-mini"])
  options[1].click()
  expect(mounted.calls.set).toEqual([coderMini])
  expect(mounted.calls.pickerOpenChanges).toContain(false)
})

test("marks the current model as selected in the candidate list", () => {
  const mounted = mountSelector({ model: coderMini, models: [coderMini, coderPro], pickerOpen: true })
  const options = [...mounted.container.querySelectorAll<HTMLButtonElement>('[role="option"]')]
  expect(options[0].getAttribute("aria-selected")).toBe("true")
  expect(options[1].getAttribute("aria-selected")).toBe("false")
})

test("offers the full model picker from the candidate list", () => {
  const mounted = mountSelector({ models: [coderMini], pickerOpen: true })
  const more = buttonByText(mounted.container, "More models…")
  more.click()
  expect(mounted.calls.openPicker).toBe(1)
  expect(mounted.calls.pickerOpenChanges).toContain(false)
})

test("supports arrow-key navigation and Enter activation in the candidate list", () => {
  const mounted = mountSelector({ models: [coderMini, coderPro], pickerOpen: true })
  const options = [...mounted.container.querySelectorAll<HTMLButtonElement>('[role="option"]')]
  options[0].focus()
  keydown(options[0], "ArrowDown")
  expect(document.activeElement).toBe(options[1])
  keydown(options[1], "Enter")
  expect(mounted.calls.set).toEqual([coderPro])
  expect(mounted.calls.set).toHaveLength(1)
})

test("activates a candidate once with the space key", () => {
  const mounted = mountSelector({ models: [coderMini, coderPro], pickerOpen: true })
  const options = [...mounted.container.querySelectorAll<HTMLButtonElement>('[role="option"]')]
  options[0].focus()
  keydown(options[0], " ")
  expect(mounted.calls.set).toHaveLength(1)
  expect(mounted.calls.set).toEqual([coderMini])
})

test("closes the candidate list with Escape and refocuses the trigger", () => {
  const mounted = mountSelector({ models: [coderMini], pickerOpen: true })
  const trigger = buttonByText(mounted.container, "Choose model")
  const option = mounted.container.querySelector<HTMLButtonElement>('[role="option"]')
  option!.focus()
  keydown(option!, "Escape")
  expect(mounted.calls.pickerOpenChanges).toContain(false)
  expect(document.activeElement).toBe(trigger)
})

test("exposes an expanded trigger for the candidate listbox", () => {
  const closed = mountSelector({ models: [coderMini], pickerOpen: false })
  const closedTrigger = buttonByText(closed.container, "Choose model")
  expect(closedTrigger.getAttribute("aria-haspopup")).toBe("listbox")
  expect(closedTrigger.getAttribute("aria-expanded")).toBe("false")
  expect(closed.container.querySelector('[role="listbox"]')).toBeNull()

  const open = mountSelector({ models: [coderMini], pickerOpen: true })
  const openTrigger = buttonByText(open.container, "Choose model")
  expect(openTrigger.getAttribute("aria-expanded")).toBe("true")
  expect(open.container.querySelector('[role="listbox"]')).not.toBeNull()
})

test("keeps selection internal when candidates exist and the picker is uncontrolled", () => {
  const mounted = mountSelector({ models: [coderMini] })
  buttonByText(mounted.container, "Choose model").click()
  expect(mounted.calls.openPicker).toBe(0)
  expect(mounted.calls.set).toEqual([])
})

test("never issues backend calls on its own", () => {
  const fetchSpy = spyOn(globalThis, "fetch")
  const mounted = mountSelector({
    model: coderMini,
    models: [coderPro],
    pickerOpen: true,
  })
  buttonByText(mounted.container, "Change model").click()
  expect(fetchSpy).not.toHaveBeenCalled()
})
