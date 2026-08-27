export * as SessionContextTransferReadiness from "./context-transfer-readiness"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode, tags } from "../effect/app-node"
import { LayerNode } from "../effect/layer-node"
import { SessionSchema } from "./schema"

export type Mode = "v1-local-explicit" | "v1-clean-only" | "v2-enriched"

export type RequestProof = {
  readonly topologyRevision: string
  readonly requestToken: string
}

export interface Interface {
  readonly withPermit: <A, E, R>(
    input: { readonly sessionID: SessionSchema.ID; readonly proof?: RequestProof },
    run: (mode: Mode) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionContextTransferReadiness") {}

export const node = LayerNode.unbound(Service, tags.values.global)

const modeLayer = (mode: Mode) => Layer.succeed(Service, Service.of({ withPermit: (_input, run) => run(mode) }))

export const localOnlyLayer = modeLayer("v1-local-explicit")
export const localEnrichedLayer = modeLayer("v2-enriched")
export const v2EnrichedLayer = localEnrichedLayer
export const managedNotReadyLayer = modeLayer("v1-clean-only")

export const localOnlyNode = makeGlobalNode({ service: Service, layer: localOnlyLayer, deps: [] })
export const localEnrichedNode = makeGlobalNode({ service: Service, layer: localEnrichedLayer, deps: [] })
export const v2EnrichedNode = localEnrichedNode
export const managedNotReadyNode = makeGlobalNode({ service: Service, layer: managedNotReadyLayer, deps: [] })
