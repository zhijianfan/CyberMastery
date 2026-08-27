export * as SessionProcessRole from "./process-role"

import { Context, Effect, Layer, Schema } from "effect"
import { makeGlobalNode, tags } from "../effect/app-node"
import { LayerNode } from "../effect/layer-node"

export const Role = Schema.Literals(["combined", "standalone", "managed-child"])
export type Role = typeof Role.Type

export class ManagedChildUnavailableError extends Schema.TaggedErrorClass<ManagedChildUnavailableError>()(
  "SessionProcessRole.ManagedChildUnavailableError",
  {
    operation: Schema.String,
    retryable: Schema.Literal(true),
  },
) {}

export interface Interface {
  readonly role: Role
  readonly requireV2: (operation: string) => Effect.Effect<void, ManagedChildUnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionProcessRole") {}

export const node = LayerNode.unbound(Service, tags.values.global)

const roleLayer = (role: Role) =>
  Layer.succeed(
    Service,
    Service.of({
      role,
      requireV2: (operation) =>
        role === "managed-child"
          ? Effect.fail(new ManagedChildUnavailableError({ operation, retryable: true }))
          : Effect.void,
    }),
  )

export const combinedLayer = roleLayer("combined")
export const standaloneLayer = roleLayer("standalone")
export const managedChildLayer = roleLayer("managed-child")
export const v2LocalLayer = combinedLayer

export const combinedNode = makeGlobalNode({ service: Service, layer: combinedLayer, deps: [] })
export const standaloneNode = makeGlobalNode({ service: Service, layer: standaloneLayer, deps: [] })
export const managedChildNode = makeGlobalNode({ service: Service, layer: managedChildLayer, deps: [] })
export const v2LocalNode = combinedNode

export function requireV2(operation: string) {
  return Effect.flatMap(Service, (service) => service.requireV2(operation))
}
