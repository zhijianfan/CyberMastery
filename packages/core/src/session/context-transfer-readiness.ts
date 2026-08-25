export * as SessionContextTransferReadiness from "./context-transfer-readiness"

import { Context, Effect, Layer, Scope } from "effect"
import { tags } from "../effect/app-node"
import { LayerNode } from "../effect/layer-node"
import { SessionSchema } from "./schema"

const proofBrand = Symbol()
export interface RequestProof {
  readonly [proofBrand]: true
}

export type Mode = "v1-local-explicit" | "v1-clean-only" | "v2-enriched"

export interface Interface {
  readonly acquire: (input: {
    readonly sessionID: SessionSchema.ID
    readonly proof?: RequestProof
  }) => Effect.Effect<Mode, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionContextTransferReadiness") {}

export const node = LayerNode.unbound(Service, tags.values.global)

export const localOnlyNode = LayerNode.make({
  service: Service,
  layer: Layer.succeed(Service, Service.of({ acquire: () => Effect.succeed("v1-local-explicit") })),
  deps: [],
  tag: tags.values.global,
})

export const managedNotReadyNode = LayerNode.make({
  service: Service,
  layer: Layer.succeed(Service, Service.of({ acquire: () => Effect.succeed("v1-clean-only") })),
  deps: [],
  tag: tags.values.global,
})

export function makeRequestProof(): RequestProof {
  return { [proofBrand]: true }
}
