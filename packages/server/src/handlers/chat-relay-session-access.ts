// ChatRelay caller-access validation port (Track S1).
//
// The ChatRelay handler layer calls requireAccess before invoking any
// lifecycle operation, so an access failure can never reach the F4 service.
// The live implementation is permissive because this fork's Authorization
// middleware already gates every route (401) and workspaces are global rows
// with no per-caller ownership model; the port exists so a per-workspace
// policy can be injected at composition time without touching the handlers
//.

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
  readonly requireAccess: (workspaceID: WorkspaceV2.ID, blockID: string) => Effect.Effect<void, AccessDeniedError>
}

export class ChatRelaySessionAccessService extends Context.Service<ChatRelaySessionAccessService, ChatRelaySessionAccess>()(
  "@opencode/v2/ChatRelaySessionAccess",
) {}

export const chatRelaySessionAccessLive = Layer.succeed(
  ChatRelaySessionAccessService,
  ChatRelaySessionAccessService.of({
    requireAccess: () => Effect.void,
  }),
)
