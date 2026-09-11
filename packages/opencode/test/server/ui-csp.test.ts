import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cspForHtml } from "../../src/server/shared/ui"

test.each([
  ["LF", "\n"],
  ["CRLF", "\r\n"],
  ["CR", "\r"],
])("theme CSP matches browser-parsed %s HTML", (_name, newline) => {
  const lines = [
    'document.documentElement.dataset.theme = "dark"',
    'document.documentElement.dataset.colorScheme = "dark"',
  ]
  const hash = createHash("sha256").update(lines.join("\n")).digest("base64")
  const html = `<script id="oc-theme-preload-script">${lines.join(newline)}</script>`

  expect(cspForHtml(html)).toContain(`'sha256-${hash}'`)
  expect(cspForHtml(html, true)).toContain(`'sha256-${hash}'`)
  expect(cspForHtml(html).split(";")[1]).not.toContain("'unsafe-inline'")
})
