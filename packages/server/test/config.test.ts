import { expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { Context, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"

// Isolate the real server's global configuration before loading its services.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "shell-route-test-"))
process.env.OPENCODE_CONFIG_DIR = path.join(directory, "global")
process.env.OPENCODE_DB = ":memory:"
process.env.OPENCODE_DISABLE_MODELS_FETCH = "true"
const { createRoutes } = await import("../src/routes")

test("shell routes enforce auth, resolve locations, persist changes, and sanitize errors", async () => {
  const server = HttpRouter.toWebHandler(createRoutes("secret").pipe(Layer.provide(HttpServer.layerServices)), {
    disableLogger: true,
  })
  const request = (input: Request) => server.handler(input, Context.empty() as Context.Context<unknown>)
  const filepath = path.join(directory, "global", "opencode.json")
  const headers = {
    authorization: `Basic ${Buffer.from("opencode:secret").toString("base64")}`,
    "content-type": "application/json",
  }
  const url = `http://localhost/api/config/shell?location[directory]=${encodeURIComponent(directory)}`
  try {
    expect((await request(new Request(url))).status).toBe(401)
    expect(
      (
        await request(
          new Request(url, {
            method: "PATCH",
            body: JSON.stringify({ shell: "new" }),
            headers: { "content-type": "application/json" },
          }),
        )
      ).status,
    ).toBe(401)
    expect(await Bun.file(filepath).exists()).toBe(false)
    const get = await request(new Request(url, { headers }))
    expect(get.status).toBe(200)
    expect(await get.json()).toMatchObject({ location: { directory }, data: { shell: expect.any(String) } })
    expect(
      (await request(new Request(url, { method: "PATCH", headers, body: JSON.stringify({ shell: process.execPath }) })))
        .status,
    ).toBe(204)
    expect(await Bun.file(filepath).json()).toEqual({ shell: process.execPath })
    expect(await (await request(new Request(url, { headers }))).json()).toMatchObject({
      data: { shell: process.execPath },
    })
    expect(
      (await request(new Request(url, { method: "PATCH", headers, body: JSON.stringify({ shell: null }) }))).status,
    ).toBe(204)
    expect(await Bun.file(filepath).json()).toEqual({})
    expect(
      (await request(new Request(url, { method: "PATCH", headers, body: JSON.stringify({ shell: 42 }) }))).status,
    ).toBe(400)
    await Bun.write(filepath, JSON.stringify({ shell: process.execPath }))
    await Bun.write(`${filepath}c`, JSON.stringify({ shell: "missing-shell" }))
    expect(
      (await request(new Request(url, { method: "PATCH", headers, body: JSON.stringify({ shell: null }) }))).status,
    ).toBe(204)
    expect(await (await request(new Request(url, { headers }))).json()).toMatchObject({
      data: { shell: process.execPath },
    })
    expect(await Bun.file(`${filepath}c`).json()).toEqual({})
    await fs.unlink(`${filepath}c`)
    await Bun.write(filepath, "{ broken private config")
    const failed = await request(new Request(url, { method: "PATCH", headers, body: JSON.stringify({ shell: "new" }) }))
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({
      name: "ConfigShellError",
      message: "Unable to update global shell configuration",
    })
    expect(await Bun.file(filepath).text()).toBe("{ broken private config")
  } finally {
    await server.dispose()
    await fs.rm(directory, { recursive: true, force: true })
  }
}, 30000)
