// Workspace ownership is checked before lifecycle operations reach Core.
// Block functionality validation remains owned by the lifecycle service.

import { Context, Effect, Layer, Schema } from "effect"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"

export * as ChatRelaySessionAccess from "./chat-relay-session-access"

export class AccessDeniedError extends Schema.TaggedErrorClass<AccessDeniedError>()(
  "ChatRelaySession.AccessDeniedError",
  {
    workspaceID: WorkspaceV2.ID,
    blockID: Schema.String,
  },
) {}

export interface ChatRelaySessionAccess {
  readonly requireAccess: (
    workspaceID: WorkspaceV2.ID,
    blockID: string,
    user: string,
  ) => Effect.Effect<void, AccessDeniedError>
}

export class ChatRelaySessionAccessService extends Context.Service<
  ChatRelaySessionAccessService,
  ChatRelaySessionAccess
>()("@opencode/v2/ChatRelaySessionAccess") {}

export const chatRelaySessionAccessLive = Layer.effect(
  ChatRelaySessionAccessService,
  WorkspaceV2.Service.use((workspace) =>
    Effect.succeed(
      ChatRelaySessionAccessService.of({
        requireAccess: (workspaceID, blockID, user) =>
          workspace.get(workspaceID, user).pipe(
            Effect.asVoid,
            Effect.mapError(() => new AccessDeniedError({ workspaceID, blockID })),
          ),
      }),
    ),
  ),
)
