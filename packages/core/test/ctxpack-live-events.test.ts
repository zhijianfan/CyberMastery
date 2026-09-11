import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CtxPackChanged } from "@opencode-ai/schema/ctxpack"
import { Capability } from "@opencode-ai/core/capability/service"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Service, node } from "@opencode-ai/core/ctxpack/service"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, node]), [
    [Database.node, Database.layerFromPath(":memory:")],
    [
      Capability.workspaceMembershipLive,
      Layer.succeed(Capability.WorkspaceMembershipService, { isMember: () => Effect.succeed(true) }),
    ],
  ]),
)

describe("CtxPack live invalidation", () => {
  it.effect("the production service publishes committed changes without a sibling event-port layer", () =>
    Effect.gen(function* () {
      const service = yield* Service
      const events = yield* EventV2.Service
      const received: EventV2.Payload[] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === CtxPackChanged.type) received.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const actor = { userID: "user-live", workspaceID: "workspace-live" }
      const request = {
        workspaceID: actor.workspaceID,
        title: "Saved response",
        keywords: [],
        sensitivity: "workspace" as const,
        idempotencyKey: "save-response",
        fragments: [
          {
            clientFragmentID: "selection-1",
            text: "Selected response content",
            source: {
              workspaceID: actor.workspaceID,
              blockID: "chat-block",
              functionalityID: "builtin:chat",
              kind: "message" as const,
              direction: "received" as const,
              sourceTimestamp: 1,
              capturedAt: 2,
              entityRef: { type: "message", id: "message-1" },
              label: "Response",
              metadata: {},
              sensitivity: "workspace" as const,
            },
          },
        ],
      }
      const created = yield* service.create(actor, request)
      expect((yield* service.get(actor, created.id)).fragments[0]?.text).toBe("Selected response content")
      expect(received.map((event) => event.data)).toEqual([
        { workspaceID: actor.workspaceID, ctxPackID: created.id, revision: 1, change: "created" },
      ])

      expect((yield* service.create(actor, request)).id).toBe(created.id)
      expect(received).toHaveLength(1)
      const patched = yield* service.patch(actor, {
        workspaceID: actor.workspaceID,
        ctxPackID: created.id,
        expectedRevision: created.revision,
        patch: { title: "Updated response" },
        idempotencyKey: "rename-response",
      })
      const deleted = yield* service.remove(actor, { ctxPackID: patched.id, expectedRevision: patched.revision })
      const restored = yield* service.restore(actor, { ctxPackID: deleted.id, expectedRevision: deleted.revision })
      expect(received.map((event) => event.data)).toEqual([
        { workspaceID: actor.workspaceID, ctxPackID: created.id, revision: created.revision, change: "created" },
        {
          workspaceID: actor.workspaceID,
          ctxPackID: patched.id,
          revision: patched.revision,
          change: "metadata-updated",
        },
        { workspaceID: actor.workspaceID, ctxPackID: deleted.id, revision: deleted.revision, change: "deleted" },
        { workspaceID: actor.workspaceID, ctxPackID: restored.id, revision: restored.revision, change: "restored" },
      ])
      expect(received.every((event) => event.durable === undefined)).toBe(true)
      expect(new Set(received.map((event) => event.id)).size).toBe(4)
      expect((yield* service.get(actor, restored.id)).title).toBe("Updated response")
    }),
  )
})
