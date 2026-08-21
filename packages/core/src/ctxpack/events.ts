// CtxPack change event publisher.
//
// The `workspace.ctxpack.changed` event is a TRANSIENT hint: EventV2 delivers
// it only to live subscribers and never replays it after a reconnect.
// Persisted ctxpack state (the ctx_pack tables) is authoritative.
//
// EventV2 is the ONLY transport — no custom stream, cursor, or polling loop.
// The event payload JSON keys are EXACTLY `type` + `properties.{workspaceID,
// ctxPackID, revision, change}`. No title/keyword/fragment/label/source/
// capsule/content keys, ever.

export * as CtxPackEvents from "./events"

import { Context, Effect, Layer, Schema } from "effect"
import { CtxPackChanged } from "@opencode-ai/schema/ctxpack"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"

// S1's definition, re-exported from @opencode-ai/schema/ctxpack.
export { CtxPackChanged }

export type CtxPackChangedEvent = {
  type: "workspace.ctxpack.changed"
  properties: {
    workspaceID: string
    ctxPackID: string
    revision: number
    change: "created" | "metadata-updated" | "deleted" | "restored" | "used"
  }
}

export class InvalidCtxPackChangedEventError extends Schema.TaggedErrorClass<InvalidCtxPackChangedEventError>()(
  "CtxPackEvents.InvalidCtxPackChangedEvent",
  { message: Schema.String },
) {}

// Small publisher port so non-runtime consumers can assert event payloads
// without booting the global event bus.
export interface CtxPackEventPublisher {
  readonly publish: (event: CtxPackChangedEvent) => Effect.Effect<void>
}

export class CtxPackEventPublisherService extends Context.Service<
  CtxPackEventPublisherService,
  CtxPackEventPublisher
>()("@opencode/v2/CtxPackEventPublisher") {}

export const make = (events: Pick<EventV2.Interface, "publish">): CtxPackEventPublisher =>
  CtxPackEventPublisherService.of({
    publish: (event) =>
      Effect.gen(function* () {
        const data = yield* Schema.decodeUnknownEffect(CtxPackChanged.data)(event.properties).pipe(
          Effect.mapError((error) => new InvalidCtxPackChangedEventError({ message: error.message })),
          Effect.orDie,
        )
        yield* events.publish(CtxPackChanged, data)
      }),
  })

export const layer = Layer.effect(
  CtxPackEventPublisherService,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    return make(events)
  }),
)

export const node = makeGlobalNode({
  service: CtxPackEventPublisherService,
  layer,
  deps: [EventV2.node],
})
