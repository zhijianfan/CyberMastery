import { afterEach, beforeAll, describe, expect, mock, spyOn, test } from "bun:test"
import { createComponent, type ComponentProps, type ParentProps } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length) next.children = children.length === 1 ? children[0] : children
  return () => createComponent(tag as never, next)
}

Object.assign(globalThis, {
  React: { createElement },
  Fragment_8vg9x3sq: (props: ParentProps) => props.children,
})

mock.module("@tanstack/solid-query", () => ({
  useMutation: () => ({ isPending: false, mutateAsync: async () => {} }),
}))
mock.module("@opencode-ai/ui/button", () => ({
  Button: (props: ParentProps) => h("button", {}, props.children),
}))
mock.module("@opencode-ai/ui/icon", () => ({ Icon: () => null }))
mock.module("@opencode-ai/ui/motion-spring", () => ({ useSpring: (value: () => number) => value }))
mock.module("@opencode-ai/session-ui/dock-prompt", () => ({
  DockPrompt: (props: ParentProps<{ ref: (element: HTMLDivElement) => void }>) =>
    h("div", { ref: props.ref, "data-dock": "question" }, props.children),
}))
mock.module("@/utils/toast", () => ({ showToast: () => {} }))
mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
mock.module("@/context/sdk", () => ({ useSDK: () => () => ({ api: {} }) }))
mock.module("@/context/server-sdk", () => ({ useServerSDK: () => () => ({ scope: "local" }) }))

let SessionQuestionDock: (typeof import("./session-question-dock"))["SessionQuestionDock"]
const disposers: VoidFunction[] = []
let sequence = 0

beforeAll(async () => {
  SessionQuestionDock = (await import("./session-question-dock")).SessionQuestionDock
})
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  mock.restore()
  document.body.innerHTML = ""
})

function mount(props: Partial<ComponentProps<typeof SessionQuestionDock>> = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () =>
      createComponent(SessionQuestionDock, {
        request: {
          id: `question-focus-${sequence++}`,
          sessionID: "session-question",
          questions: [
            { header: "Choose", question: "Which option?", options: [{ label: "First", description: "First option" }] },
          ],
        },
        onSubmit: () => {},
        ...props,
      }),
    host,
  )
  disposers.push(dispose)
  return host
}

function frame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

describe("SessionQuestionDock embedding", () => {
  test("does not take keyboard focus when mounted in a background block", async () => {
    const input = document.createElement("input")
    document.body.append(input)
    input.focus()
    mount({ autofocus: false })
    await frame()
    expect(document.activeElement === input).toBe(true)
  })

  test.each([undefined, true])("retains initial question focus when autofocus is %s", async (autofocus) => {
    const host = mount({ autofocus })
    await frame()
    expect(document.activeElement === host.querySelector('[data-slot="question-option"]')).toBe(true)
  })

  test("measures available question height from the owning block without a global viewport", async () => {
    const container = document.createElement("section")
    document.body.append(container)
    container.getBoundingClientRect = () => new DOMRect(0, 100, 400, 220)
    const query = spyOn(document, "querySelector")
    const host = mount({ autofocus: false, container: () => container })
    const root = host.querySelector<HTMLDivElement>('[data-dock="question"]')!
    container.append(host)
    root.getBoundingClientRect = () => new DOMRect(0, 160, 400, 300)
    await frame()

    expect(root.style.getPropertyValue("--question-prompt-max-height")).toBe("212px")
    expect(query.mock.calls.some(([selector]) => selector === ".scroll-view__viewport")).toBe(false)
  })
})
