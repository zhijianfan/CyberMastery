// MasterAgent binding-update event publisher.
//
// The `workspace.master-agent.binding.updated` event is a TRANSIENT hint:
// EventV2 delivers it only to live subscribers and never replays it after a
// reconnect. Persisted functionality-instance state is authoritative. Clients
// must refetch the binding through MasterAgentService.get/ensure after
// reconnect instead of trusting events they may have missed
// (specs/master-agent-max-parallel-plan/01-architecture-decisions.md §6).
//
// This publisher performs no persistence of its own. The lifecycle service
// must publish only after the transition has been persisted, and must not
// publish for idempotent ensure or stale CAS results
// (specs/master-agent-max-parallel-plan/02-contracts-and-data-model.md §8).

export * as MasterAgentEvents from "./master-agent-events"

import { Context, Effect, Layer, Schema } from "effect"
import { MasterAgent } from "@opencode-ai/schema/master-agent"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"

export type BindingUpdatedEvent = EventV2.Data<typeof MasterAgent.BindingUpdated>

export class InvalidBindingUpdatedEventError extends Schema.TaggedErrorClass<InvalidBindingUpdatedEventError>()(
  "MasterAgentEvents.InvalidBindingUpdatedEvent",
  { message: Schema.String },
) {}

// Small publisher port (contract §8) so consumers — including the F4 client
// manager — can test against a fake without booting the global event bus.
export interface MasterAgentEventPublisher {
  readonly bindingUpdated: (event: BindingUpdatedEvent) => Effect.Effect<void>
}

export class MasterAgentEventPublisherService extends Context.Service<
  MasterAgentEventPublisherService,
  MasterAgentEventPublisher
>()("@opencode/v2/MasterAgentEventPublisher") {}

// Constructs a publisher from any event source exposing `publish`. Every
// payload is validated against the frozen BindingUpdated schema (workspace
// ID, block ID, session ID, generation, revision) before it is published, so
// an invalid event fails loudly instead of being silently dropped.
export const make = (events: Pick<EventV2.Interface, "publish">): MasterAgentEventPublisher =>
  MasterAgentEventPublisherService.of({
    bindingUpdated: (event) =>
      Effect.gen(function* () {
        const data = yield* Schema.decodeUnknownEffect(MasterAgent.BindingUpdated.data)(event).pipe(
          Effect.mapError((error) => new InvalidBindingUpdatedEventError({ message: error.message })),
          Effect.orDie,
        )
        yield* events.publish(MasterAgent.BindingUpdated, data)
      }),
  })

export const layer = Layer.effect(
  MasterAgentEventPublisherService,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    return make(events)
  }),
)

export const node = makeGlobalNode({
  service: MasterAgentEventPublisherService,
  layer,
  deps: [EventV2.node],
})
