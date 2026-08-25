import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { sessionContextLocationServiceMapLayer } from "@/effect/session-context"
import { testEffect } from "../lib/effect"

const it = testEffect(sessionContextLocationServiceMapLayer)

describe("OpenCode Session context location composition", () => {
  it.effect("acquires a real location without an unbound Session context port", () =>
    Effect.gen(function* () {
      const filesystem = yield* FileSystem.Service.pipe(
        Effect.provide(
          LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(process.cwd()) })),
        ),
      )
      expect(filesystem).toBeDefined()
    }),
  )
})
