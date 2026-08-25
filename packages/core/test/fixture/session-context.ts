import { Layer } from "effect"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionContextProfile } from "@opencode-ai/core/session/context-profile"
import { SessionContextTransferReadiness } from "@opencode-ai/core/session/context-transfer-readiness"

export const cleanAssemblyLayer = SessionInput.SessionContextAssemblyPort.cleanLayer
export const cleanAssemblyNode = SessionInput.cleanContextAssemblyNode

export const managedNotReadySessionContextLayer = Layer.mergeAll(
  cleanAssemblyLayer,
  SessionContextProfile.genericLayer,
  SessionContextTransferReadiness.managedNotReadyLayer,
)

export const managedNotReadySessionContext = [
  [SessionInput.SessionContextAssemblyPort.node, cleanAssemblyNode],
  [SessionContextProfile.node, SessionContextProfile.genericNode],
  [SessionContextTransferReadiness.node, SessionContextTransferReadiness.managedNotReadyNode],
] as const

export const localOnlySessionContext = [
  [SessionInput.SessionContextAssemblyPort.node, cleanAssemblyNode],
  [SessionContextProfile.node, SessionContextProfile.genericNode],
  [SessionContextTransferReadiness.node, SessionContextTransferReadiness.localOnlyNode],
] as const
