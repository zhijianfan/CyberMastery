// M1 integration wiring (integration owner). Adapts the CtxPack lane services
// into the ports the Session lane declared locally, so the composition roots
// provide each real service exactly once. The three adapter nodes below are
// added to the same LayerNode.group as the lane nodes.

import { Effect, Layer } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { WorkspaceV2 } from "../workspace"
import { Capability } from "../capability/service"
import { SessionInput } from "../session/input"
import {
  CtxPackEvents,
  CtxPackMaterializer,
  CtxPackRecall,
  CtxPackSQL,
  CtxPackSessionContext,
  CtxPackUsage,
} from "./index"
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
          workspace
            .get(WorkspaceV2.ID.make(workspaceID), userID)
            .pipe(Effect.match({ onSuccess: () => true, onFailure: () => false })),
      })
    }),
  ),
})

// Adapter for callers that provide the isolated service layer directly.
// The production CtxPackService node declares its own live publisher dependency;
// an optional port supplied by a later sibling cannot configure an earlier layer.
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

export const sessionContextAssemblyPortLayer = Layer.effect(
  SessionInput.SessionContextAssemblyPortService,
  Effect.gen(function* () {
    const materializer = yield* CtxPackMaterializer.Service
    const database = yield* Database.Service
    const repository = yield* CtxPackSQL.CtxPackRepositoryService
    const capability = yield* Capability.Service
    return CtxPackSessionContext.make({
      materializer,
      search: (input) => CtxPackRecall.searchForRecall(input).pipe(Effect.provideService(Database.Service, database)),
      snapshotCandidate: (input) =>
        CtxPackRecall.snapshotCandidate(input).pipe(
          Effect.provideService(CtxPackSQL.CtxPackRepositoryService, repository),
          Effect.provideService(Capability.Service, capability),
        ),
    })
  }),
)
export const sessionContextAssemblyPortNode = makeGlobalNode({
  service: SessionInput.SessionContextAssemblyPortService,
  layer: sessionContextAssemblyPortLayer,
  deps: [CtxPackMaterializer.node, Database.node, CtxPackSQL.node, Capability.node],
})

// Q1's usage port backed by C2's ledger.
export const ctxPackUsagePortLayer = Layer.effect(
  SessionInput.CtxPackUsagePortService,
  Effect.gen(function* () {
    const usage = yield* CtxPackUsage.Service
    return SessionInput.CtxPackUsagePortService.of({
      recordAdmittedUse: (input) => usage.recordAdmittedUse(input),
    })
  }),
)
export const ctxPackUsagePortNode = LayerNode.make({
  service: SessionInput.CtxPackUsagePortService,
  layer: ctxPackUsagePortLayer,
  deps: [CtxPackUsage.node],
})
