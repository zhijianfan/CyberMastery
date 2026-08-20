// Workspace ownership is checked before lifecycle operations reach Core.
// Block functionality validation remains owned by the lifecycle service.

import { Context, Effect, Layer, Schema } from "effect"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"

export * as MasterAgentAccess from "./workspace-master-agent-access"

export class AccessDeniedError extends Schema.TaggedErrorClass<AccessDeniedError>()("MasterAgent.AccessDeniedError", {
  workspaceID: WorkspaceV2.ID,
  blockID: Schema.String,
}) {}

export interface MasterAgentAccess {
  readonly requireAccess: (
    workspaceID: WorkspaceV2.ID,
    blockID: string,
    user: string,
  ) => Effect.Effect<void, AccessDeniedError>
}

export class MasterAgentAccessService extends Context.Service<MasterAgentAccessService, MasterAgentAccess>()(
  "@opencode/v2/MasterAgentAccess",
) {}

export const masterAgentAccessLive = Layer.effect(
  MasterAgentAccessService,
  WorkspaceV2.Service.use((workspace) =>
    Effect.succeed(
      MasterAgentAccessService.of({
        requireAccess: (workspaceID, blockID, user) =>
          workspace.get(workspaceID, user).pipe(
            Effect.asVoid,
            Effect.mapError(() => new AccessDeniedError({ workspaceID, blockID })),
          ),
      }),
    ),
  ),
)
