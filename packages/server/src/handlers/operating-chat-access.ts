import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Context, Effect, Layer, Schema } from "effect"

export class AccessDeniedError extends Schema.TaggedErrorClass<AccessDeniedError>()(
  "OperatingChatSession.AccessDeniedError",
  { workspaceID: WorkspaceV2.ID, blockID: Schema.String },
) {}

export interface OperatingChatAccess {
  readonly requireAccess: (
    workspaceID: WorkspaceV2.ID,
    blockID: string,
    user: string,
  ) => Effect.Effect<void, AccessDeniedError>
}

export class OperatingChatAccessService extends Context.Service<OperatingChatAccessService, OperatingChatAccess>()(
  "@opencode/v2/OperatingChatAccess",
) {}

export const operatingChatAccessLive = Layer.effect(
  OperatingChatAccessService,
  WorkspaceV2.Service.use((workspace) =>
    Effect.succeed(
      OperatingChatAccessService.of({
        requireAccess: (workspaceID, blockID, user) =>
          workspace.get(workspaceID, user).pipe(
            Effect.asVoid,
            Effect.mapError(() => new AccessDeniedError({ workspaceID, blockID })),
          ),
      }),
    ),
  ),
)
