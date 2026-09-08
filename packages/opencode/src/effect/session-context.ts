import { sessionContextAssemblyPortNode } from "@opencode-ai/core/ctxpack/index"
import { buildLocationServiceMap } from "@opencode-ai/core/location-services"
import { SessionContextProfile } from "@opencode-ai/core/session/context-profile"
import { SessionContextTransferReadiness } from "@opencode-ai/core/session/context-transfer-readiness"
import { SessionInput } from "@opencode-ai/core/session/input"
import { OperatingChatContext } from "@opencode-ai/core/workspace/operating-chat-context"
import { CredentialCompat } from "@/auth/credential-compat"

export const sessionContextReplacements = [
  CredentialCompat.replacement,
  [SessionInput.SessionContextAssemblyPort.node, sessionContextAssemblyPortNode],
  [SessionContextProfile.node, OperatingChatContext.node],
  [SessionContextTransferReadiness.node, SessionContextTransferReadiness.managedNotReadyNode],
] as const

export const sessionContextLocationServiceMapLayer = buildLocationServiceMap(sessionContextReplacements)
