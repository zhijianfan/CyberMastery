import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Effect, Layer, Scope, Context } from "effect"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ShareNext } from "./share-next"
import { EventV2 } from "@opencode-ai/core/event"

export interface Interface {
  readonly create: (input?: Session.CreateInput) => Effect.Effect<Session.Info>
  readonly share: (sessionID: SessionID) => Effect.Effect<{ url: string }, unknown>
  readonly unshare: (sessionID: SessionID) => Effect.Effect<void, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionShare") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const session = yield* Session.Service
    const shareNext = yield* ShareNext.Service
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service

    const share = Effect.fn("SessionShare.share")(function* (sessionID: SessionID) {
      const conf = yield* cfg.get()
      if (conf.share === "disabled") throw new Error("Sharing is disabled in configuration")
      const result = yield* shareNext.create(sessionID)
      yield* session.setShare({ sessionID, share: { url: result.url } })
      return result
    })

    const unshare = Effect.fn("SessionShare.unshare")(function* (sessionID: SessionID) {
      const revoked = yield* shareNext.remove(sessionID)
      if (!revoked) {
        if ((yield* session.get(sessionID)).share) return yield* Effect.die(new Error(`Share credentials unavailable for ${sessionID}`))
        return
      }
      // The remote share is revoked and its local URL was cleared atomically. A fenced Session rejects Updated events.
      yield* session.setShare({ sessionID, share: undefined }).pipe(Effect.catchDefect((defect) =>
        defect instanceof EventV2.DurableAggregateClosedError ? Effect.void : Effect.die(defect),
      ))
    })

    const create = Effect.fn("SessionShare.create")(function* (input?: Session.CreateInput) {
      const result = yield* session.create(input)
      if (result.parentID) return result
      const conf = yield* cfg.get()
      if (!(flags.autoShare || conf.share === "auto")) return result
      yield* share(result.id).pipe(Effect.ignore, Effect.forkIn(scope))
      return result
    })

    return Service.of({ create, share, unshare })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, Session.node, ShareNext.node, RuntimeFlags.node],
})

export * as SessionShare from "./session"
