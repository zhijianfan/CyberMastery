// M1 integration wiring (integration owner). Adapts the CtxPack lane services
// into the ports the Session lane declared locally, so the composition roots
// provide each real service exactly once. The three adapter nodes below are
// added to the same LayerNode.group as the lane nodes.

import { Effect, Layer } from "effect"
import { LayerNode } from "../effect/layer-node"
import { tags } from "../effect/app-node"
import { EventV2 } from "../event"
import { Database } from "../database/database"
import { WorkspaceV2 } from "../workspace"
import { Capability } from "../capability/service"
import { CtxPackUsagePortService, SessionContextAssemblyPortService } from "../session/input"
import { CtxPackEvents, CtxPackMaterializer, CtxPackRecall, CtxPackSessionContext, CtxPackUsage } from "./index"
import { CtxPackRepositoryService, node as CtxPackRepositoryNode } from "./sql"
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

// Session-owned assembly backed by the explicit materializer and internal
// recall reader. Orchestration stays in session-context.ts.
export const sessionContextAssemblyPortLayer = Layer.effect(
  SessionContextAssemblyPortService,
  Effect.gen(function* () {
    const materializer = yield* CtxPackMaterializer.Service
    const database = yield* Database.Service
    const repository = yield* CtxPackRepositoryService
    const capability = yield* Capability.Service
    return CtxPackSessionContext.make({
      materializer,
      recall: {
        search: (input) => CtxPackRecall.searchForRecall(input).pipe(Effect.provideService(Database.Service, database)),
        snapshotCandidate: (input) =>
          CtxPackRecall.snapshotCandidate(input).pipe(
            Effect.provideService(Database.Service, database),
            Effect.provideService(CtxPackRepositoryService, repository),
            Effect.provideService(Capability.Service, capability),
          ),
        terms: CtxPackRecall.buildRecallTerms,
        trivial: CtxPackRecall.isTrivialRecallTurn,
      },
    })
  }),
)
export const sessionContextAssemblyPortNode = LayerNode.make({
  service: SessionContextAssemblyPortService,
  layer: sessionContextAssemblyPortLayer,
  deps: [CtxPackMaterializer.node, Database.node, CtxPackRepositoryNode, Capability.node],
  tag: tags.values.global,
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
