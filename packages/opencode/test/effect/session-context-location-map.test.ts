import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionContextTransferReadiness } from "@opencode-ai/core/session/context-transfer-readiness"
import { sessionContextLocationServiceMapLayer, sessionContextReplacements } from "@/effect/session-context"
import { testEffect } from "../lib/effect"

const it = testEffect(sessionContextLocationServiceMapLayer)
const readinessIt = testEffect(
  LayerNode.compile(LayerNode.group([SessionContextTransferReadiness.node]), sessionContextReplacements),
)

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

  readinessIt.effect("selects context transfer readiness for the process role", () =>
    Effect.gen(function* () {
      const readiness = yield* SessionContextTransferReadiness.Service
      const mode = yield* readiness.withPermit({ sessionID: SessionV2.ID.make("ses_context_composition") }, (mode) =>
        Effect.succeed(mode),
      )
      expect(mode).toBe(Flag.OPENCODE_WORKSPACE_ID ? "v1-clean-only" : "v1-local-explicit")
    }),
  )
})
