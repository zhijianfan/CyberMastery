// M1 integration wiring (integration owner). Adapts the CtxPack lane services
// into the ports the Session lane declared locally, so the composition roots
// provide each real service exactly once. The three adapter nodes below are
// added to the same LayerNode.group as the lane nodes.

import { Effect, Layer } from "effect"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { WorkspaceV2 } from "../workspace"
import { Capability } from "../capability/service"
import { CtxPackUsagePortService, SessionCtxSnapshotPortService } from "../session/input"
import { CtxPackEvents, CtxPackMaterializer, CtxPackUsage } from "./index"
import { CtxPackEventPortService } from "./service"

// Real workspace membership for the capability service: a user is a member of
// a workspace when the core workspace service can resolve it for that user
// (the same check MasterAgentAccess uses in the server layer). Declared as a
// LayerNode (name @opencode/v2/WorkspaceMembership) so composition roots can
// replace X0's deny-by-default node without leaking the workspace layer's
// error channel into the final composition.
export const workspaceMembershipLive = LayerNode.make({
  service: Capability.WorkspaceMembershipService,
  deps: [WorkspaceV2.node],
  layer: Layer.effect(
    Capability.WorkspaceMembershipService,
    Effect.gen(function* () {
      const workspace = yield* WorkspaceV2.Service
      return Capability.WorkspaceMembershipService.of({
        isMember: (userID, workspaceID) =>
          workspace.get(WorkspaceV2.ID.make(workspaceID), userID).pipe(
            Effect.match({ onSuccess: () => true, onFailure: () => false }),
          ),
      })
    }),
  ),
})

// C1's event port backed by C2's EventV2 publisher. C1 reads the port through
// Context.getOption at layer build time, so providing this node anywhere in
// the compiled graph is sufficient.
export const ctxPackEventPortLayer = Layer.effect(
  CtxPackEventPortService,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const publisher = CtxPackEvents.make(events)
    return CtxPackEventPortService.of({ publish: publisher.publish })
  }),
)
export const ctxPackEventPortNode = LayerNode.make({
  service: CtxPackEventPortService,
  layer: ctxPackEventPortLayer,
  deps: [EventV2.node],
})

// Q1's admission snapshot port backed by X1's materializer. The method
// signature is structurally identical (SessionSnapshotError === CtxPackError |
// MaterializeError); the core snapshot type is a subtype of the schema-layer
// one Q1's port returns.
export const sessionCtxSnapshotPortLayer = Layer.effect(
  SessionCtxSnapshotPortService,
  Effect.gen(function* () {
    const materializer = yield* CtxPackMaterializer.Service
    return SessionCtxSnapshotPortService.of({
      snapshotForSessionInput: (input) => materializer.snapshotForSessionInput(input),
    })
  }),
)
export const sessionCtxSnapshotPortNode = LayerNode.make({
  service: SessionCtxSnapshotPortService,
  layer: sessionCtxSnapshotPortLayer,
  deps: [CtxPackMaterializer.node],
})

// Q1's usage port backed by C2's ledger.
export const ctxPackUsagePortLayer = Layer.effect(
  CtxPackUsagePortService,
  Effect.gen(function* () {
    const usage = yield* CtxPackUsage.Service
    return CtxPackUsagePortService.of({
      recordAdmittedUse: (input) => usage.recordAdmittedUse(input),
    })
  }),
)
export const ctxPackUsagePortNode = LayerNode.make({
  service: CtxPackUsagePortService,
  layer: ctxPackUsagePortLayer,
  deps: [CtxPackUsage.node],
})
