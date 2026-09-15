import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Git } from "@opencode-ai/core/git"
import { Project } from "@opencode-ai/core/project"
import { ProjectDirectories } from "@opencode-ai/core/project/directories"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      MoveSession.node,
      Database.node,
      EventV2.node,
      Git.node,
      ProjectDirectories.node,
      Project.node,
      SessionProjector.node,
      SessionStore.node,
    ]),
  ),
)

describe("Session warp", () => {
  it.effect("rejects unconditionally before even querying the Session", () =>
    Effect.gen(function* () {
      const exit = yield* MoveSession.Service.use((service) =>
        service.moveSession({
          sessionID: SessionV2.ID.make("ses_warp_missing"),
          destination: { directory: AbsolutePath.make("/must-not-be-resolved") },
          moveChanges: true,
        }),
      ).pipe(Effect.exit)

      expect(String(exit)).toContain("SessionWarpContextAssemblyUnsupported")
      expect(String(exit)).not.toContain("Session.NotFoundError")
    }),
  )
})
