/** @jsxImportSource solid-js */
import { expect, mock, test } from "bun:test"
import { render } from "solid-js/web"

const clientSolid = import.meta.resolve("solid-js").replace("dist/server.js", "dist/solid.js")
const clientWeb = import.meta.resolve("solid-js/web").replace("dist/server.js", "dist/web.js")

mock.module("solid-js", () => require(clientSolid))
mock.module("solid-js/web", () => require(clientWeb))

test("mocked client solid renders", () => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const dispose = render(() => <button type="button">hi</button> as never, container)
  expect(container.textContent).toContain("hi")
  dispose()
})
