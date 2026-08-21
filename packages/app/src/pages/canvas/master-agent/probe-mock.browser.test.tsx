import { expect, test } from "bun:test"
import { render } from "solid-js/web"

test("browser Solid renders", () => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const dispose = render(() => {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = "hi"
    return button
  }, container)
  expect(container.textContent).toContain("hi")
  dispose()
})
