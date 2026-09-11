import { sessionContextAssemblyPortNode } from "@opencode-ai/core/ctxpack/index"
import { Flag } from "@opencode-ai/core/flag/flag"
import { buildLocationServiceMap } from "@opencode-ai/core/location-services"
import { SessionContextProfile } from "@opencode-ai/core/session/context-profile"
import { SessionContextTransferReadiness } from "@opencode-ai/core/session/context-transfer-readiness"
import { SessionInput } from "@opencode-ai/core/session/input"
import { OperatingChatContext } from "@opencode-ai/core/workspace/operating-chat-context"
import { AuthCredential } from "../auth/credential"

export const sessionContextReplacements = [
  AuthCredential.replacement,
  [SessionInput.SessionContextAssemblyPort.node, sessionContextAssemblyPortNode],
  [SessionContextProfile.node, OperatingChatContext.node],
  [
    SessionContextTransferReadiness.node,
    Flag.OPENCODE_WORKSPACE_ID
      ? SessionContextTransferReadiness.managedNotReadyNode
      : SessionContextTransferReadiness.localOnlyNode,
  ],
] as const

export const sessionContextLocationServiceMapLayer = buildLocationServiceMap(sessionContextReplacements)
