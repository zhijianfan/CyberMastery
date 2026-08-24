// Subprocess integration tests for `opencode serve`. Spawns the real CLI in
// headless mode and exercises it over HTTP — this is the only test tier that
// catches bugs spanning argv → server boot → routing → instance loading.
//
// `serve` is long-lived: the harness returns a handle (url/port/kill/exited)
// and kills the process when the test scope closes. The OS-assigned port is
// parsed off the "listening on http://..." line.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { cliIt } from "../../lib/cli-process"

describe("opencode serve (subprocess)", () => {
  // Smoke test: one real listener serves legacy health, V2 health, and UI.
  // If this fails, all other serve tests likely will too — debug here first.
  cliIt.live(
    "serves V1, V2, and configured UI from one listener",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const marker = "opencode-native-combined-listener"
        yield* Effect.promise(() => Bun.write(`${home}/index.html`, `<html>${marker}</html>`))
        const server = yield* opencode.serve({ env: { OPENCODE_WEB_UI_DIR: home } })
        expect(server.port).toBeGreaterThan(0)
        expect(server.url).toMatch(/^http:\/\//)

        const client = yield* HttpClient.HttpClient
        const globalHealth = yield* client.get(`${server.url}/global/health`)
        expect(globalHealth.status).toBe(200)
        expect(yield* globalHealth.json).toMatchObject({ healthy: true })

        const v2Health = yield* client.get(`${server.url}/api/health`)
        expect(v2Health.status).toBe(200)
        expect(yield* v2Health.json).toEqual({ healthy: true })

        const ui = yield* client.get(`${server.url}/`)
        expect(ui.status).toBe(200)
        expect(yield* ui.text).toContain(marker)
      }),
    60_000,
  )

  // The scope-close finalizer must actually terminate the child. Without this
  // test a regression in the kill path (e.g. a future refactor that forgets
  // to wire the finalizer) would leak processes on every test run.
  cliIt.live(
    "kills the subprocess on scope close",
    ({ opencode }) =>
      Effect.gen(function* () {
        // Inner scope so we can observe `.exited` resolving after it closes.
        const exitedPromise = yield* Effect.scoped(
          Effect.gen(function* () {
            const server = yield* opencode.serve()
            // Capture the Promise, not the resolved value — scope closes after
            // this gen returns, at which point the finalizer kills the child.
            return server.exited
          }),
        )
        // After scope close: finalizer fired, process must have exited.
        const code = yield* Effect.promise(() => exitedPromise)
        // Bun reports the exit code; SIGTERM-killed processes return non-null
        // (typically 143 on POSIX). We just require resolution within a sane
        // window — anything else means the kill didn't take.
        expect(typeof code === "number" || code === null).toBe(true)
      }),
    60_000,
  )
})
