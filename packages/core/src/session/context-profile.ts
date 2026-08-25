export * as SessionContextProfile from "./context-profile"

import { Context, Effect, Schema } from "effect"
import { tags } from "../effect/app-node"
import { LayerNode } from "../effect/layer-node"
import { SessionSchema } from "./schema"

export type Profile =
  | { readonly kind: "generic" }
  | {
      readonly kind: "operating-chat"
      readonly workspaceID: string
      readonly workspaceName: string
      readonly blockID: string
      readonly functionalityID: "builtin:operating-chat-session"
      readonly functionalityInstanceID: string
      readonly generation: number
      readonly revision: number
      readonly location: string
      readonly directory: string
      readonly operatingAgent: string
    }

export class AmbiguousError extends Schema.TaggedErrorClass<AmbiguousError>()("SessionContextProfile.AmbiguousError", {
  sessionID: SessionSchema.ID,
  matches: Schema.Number,
}) {}

export class StaleError extends Schema.TaggedErrorClass<StaleError>()("SessionContextProfile.StaleError", {
  sessionID: SessionSchema.ID,
}) {}

export interface Interface {
  readonly resolve: (sessionID: SessionSchema.ID) => Effect.Effect<Profile, AmbiguousError>
  readonly revalidate: (
    sessionID: SessionSchema.ID,
    profile: Profile,
  ) => Effect.Effect<void, AmbiguousError | StaleError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionContextProfile") {}

export const node = LayerNode.unbound(Service, tags.values.global)
