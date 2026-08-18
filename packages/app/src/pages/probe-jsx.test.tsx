/** @jsx h */
import { expect, test } from "bun:test"
import h from "solid-js/h"
import { render } from "solid-js/web"

function Probe() {
  return <div data-probe="ok">probe</div>
}

test("inline JSX renders", () => {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(() => <Probe />, host)
  expect(host.querySelector("[data-probe]")?.getAttribute("data-probe")).toBe("ok")
  host.remove()
})
