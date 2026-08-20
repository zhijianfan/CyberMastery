// Generic functionality-instance change event publisher.
//
// The `workspace.functionality.instance.changed` event is a TRANSIENT hint:
// EventV2 delivers it only to live subscribers and never replays it after a
// reconnect. Persisted functionality-instance state is authoritative.

export * as FunctionalityInstanceEvents from "./functionality-instance-events"

import { Context, Effect, Layer, Schema } from "effect"
import { Workspace } from "@opencode-ai/schema/workspace"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"

export const InstanceChanged = EventV2.define({
  type: "workspace.functionality.instance.changed",
  schema: {
    workspaceID: Workspace.ID,
    blockID: Schema.String,
    functionalityID: Schema.String,
    instanceID: Schema.String,
    revision: Schema.Int,
    change: Schema.Union([Schema.Literal("created"), Schema.Literal("updated"), Schema.Literal("tombstoned")]),
  },
})

export type InstanceChangedEvent = EventV2.Data<typeof InstanceChanged>

export class InvalidInstanceChangedEventError extends Schema.TaggedErrorClass<InvalidInstanceChangedEventError>()(
  "FunctionalityInstanceEvents.InvalidInstanceChangedEvent",
  { message: Schema.String },
) {}

// Small publisher port so non-runtime consumers can assert event payloads
// without booting the global event bus.
export interface FunctionalityInstanceEventPublisher {
  readonly instanceChanged: (event: InstanceChangedEvent) => Effect.Effect<void>
}

export class FunctionalityInstanceEventPublisherService extends Context.Service<
  FunctionalityInstanceEventPublisherService,
  FunctionalityInstanceEventPublisher
>()("@opencode/v2/FunctionalityInstanceEventPublisher") {}

export const make = (
  events: Pick<EventV2.Interface, "publish">,
): FunctionalityInstanceEventPublisher =>
  FunctionalityInstanceEventPublisherService.of({
    instanceChanged: (event) =>
      Effect.gen(function* () {
        const data = yield* Schema.decodeUnknownEffect(InstanceChanged.data)(event).pipe(
          Effect.mapError((error) => new InvalidInstanceChangedEventError({ message: error.message })),
          Effect.orDie,
        )
        yield* events.publish(InstanceChanged, data)
      }),
  })

export const layer = Layer.effect(
  FunctionalityInstanceEventPublisherService,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    return make(events)
  }),
)

export const node = makeGlobalNode({
  service: FunctionalityInstanceEventPublisherService,
  layer,
  deps: [EventV2.node],
})
