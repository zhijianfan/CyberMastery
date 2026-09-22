import { expect, test } from "bun:test"
import { createCanvasTabClient } from "./canvas-tab-client"

test("canvas tabs use the configured platform transport and server credentials", async () => {
  const requests: Request[] = []
  const client = createCanvasTabClient({
    server: { url: "https://desktop.example", username: "desktop", password: "fixture-password" },
    fetch: (async (input, init) => {
      requests.push(new Request(input, init))
      return Response.json({ items: [], next: null, selectedTabID: null, revision: 0 })
    }) as typeof fetch,
  })
  await client.listOwned({ workspaceID: "wrk_1", kind: "master-agent", blockID: "block 1" })
  expect(requests).toHaveLength(1)
  expect(requests[0].url).toBe("https://desktop.example/api/workspace/wrk_1/canvas-tab/master-agent/owned/block%201")
  expect(requests[0].headers.get("Authorization")).toBe(`Basic ${btoa("desktop:fixture-password")}`)
})
