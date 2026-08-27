import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SessionProcessRole } from "@opencode-ai/core/session/process-role"

describe("SessionProcessRole", () => {
  test("combined and standalone allow current work", async () => {
    await Effect.runPromise(SessionProcessRole.requireV2("prompt").pipe(Effect.provide(SessionProcessRole.combinedLayer)))
    await Effect.runPromise(SessionProcessRole.requireV2("prompt").pipe(Effect.provide(SessionProcessRole.standaloneLayer)))
  })

  test("managed children deny current work with one typed unavailable error", async () => {
    const error = await Effect.runPromise(
      SessionProcessRole.requireV2("prompt").pipe(
        Effect.provide(SessionProcessRole.managedChildLayer),
        Effect.flip,
      ),
    )
    expect(error).toMatchObject({ _tag: "SessionProcessRole.ManagedChildUnavailableError", operation: "prompt" })
  })
})
