import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { tags } from "@opencode-ai/core/effect/app-node"
import { SessionContextProfile } from "@opencode-ai/core/session/context-profile"
import { SessionContextTransferReadiness } from "@opencode-ai/core/session/context-transfer-readiness"
import { SessionInput } from "@opencode-ai/core/session/input"

export const emptyAssemblyNode = LayerNode.make({
  service: SessionInput.SessionContextAssemblyPortService,
  layer: Layer.succeed(
    SessionInput.SessionContextAssemblyPortService,
    SessionInput.SessionContextAssemblyPortService.of({
      assemble: (input) =>
        input.explicitAttachments.length === 0
          ? Effect.succeed({ usageCtxPackIDs: [] })
          : Effect.fail(new SessionInput.SessionContextAssemblyError({ code: "unexpected-context-attachment" })),
    }),
  ),
  deps: [],
  tag: tags.values.global,
})

export const genericProfileReplacement = [SessionContextProfile.node, SessionInput.genericContextProfileNode] as const
export const localOnlyReadinessReplacement = [
  SessionContextTransferReadiness.node,
  SessionContextTransferReadiness.localOnlyNode,
] as const
export const managedNotReadyReadinessReplacement = [
  SessionContextTransferReadiness.node,
  SessionContextTransferReadiness.managedNotReadyNode,
] as const
export const emptyAssemblyReplacement = [SessionInput.sessionContextAssemblyPortNode, emptyAssemblyNode] as const

export const localSessionContextReplacements = [
  genericProfileReplacement,
  localOnlyReadinessReplacement,
  emptyAssemblyReplacement,
] as const
