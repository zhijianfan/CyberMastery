import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { CtxPackEvents } from "@opencode-ai/core/ctxpack/events"
import { CtxPackChanged } from "@opencode-ai/schema/ctxpack"
import type { EventV2 } from "@opencode-ai/core/event"

const CHANGE_TYPES = ["created", "metadata-updated", "deleted", "restored", "used"] as const

const FROZEN_PROPERTY_KEYS = ["change", "ctxPackID", "revision", "workspaceID"]

// Fake EventV2 publish: records the (definition, data) pair so tests can
// assert the exact wire payload and that EventV2 is the only transport used.
const fakeEvents = () => {
  const recorded: Array<{ definition: typeof CtxPackChanged; data: Record<string, unknown> }> = []
  const events: Pick<EventV2.Interface, "publish"> = {
    publish: <D extends EventV2.Definition>(definition: D, data: EventV2.Data<D>) =>
      Effect.sync(() => {
        recorded.push({
          definition: definition as unknown as typeof CtxPackChanged,
          data: data as unknown as Record<string, unknown>,
        })
        return { id: "evt_test" as EventV2.ID, type: definition.type, data }
      }),
  }
  return { recorded, events }
}

const eventFor = (change: (typeof CHANGE_TYPES)[number]): CtxPackEvents.CtxPackChangedEvent => ({
  type: "workspace.ctxpack.changed",
  properties: { workspaceID: "ws-1", ctxPackID: "ctxpk_test_1", revision: 3, change },
})

describe("CtxPack events publisher", () => {
  test("emitted events serialize to exactly the frozen key set for every change type", async () => {
    for (const change of CHANGE_TYPES) {
      const { recorded, events } = fakeEvents()
      const publisher = CtxPackEvents.make(events)
      await Effect.runPromise(publisher.publish(eventFor(change)))

      expect(recorded).toHaveLength(1)
      const wire = { type: recorded[0]!.definition.type, properties: recorded[0]!.data }
      // Complete JSON keys are exactly `type` + `properties.{workspaceID,
      // ctxPackID, revision, change}`.
      expect(Object.keys(wire).sort()).toEqual(["properties", "type"])
      expect(Object.keys(wire.properties).sort()).toEqual(FROZEN_PROPERTY_KEYS)
      expect(wire.type).toBe("workspace.ctxpack.changed")
      expect(wire.properties).toEqual({ workspaceID: "ws-1", ctxPackID: "ctxpk_test_1", revision: 3, change })

      // Round-trips through JSON with the exact frozen key set.
      const roundTripped: { type: string; properties: Record<string, unknown> } = JSON.parse(JSON.stringify(wire))
      expect(Object.keys(roundTripped).sort()).toEqual(["properties", "type"])
      expect(Object.keys(roundTripped.properties).sort()).toEqual(FROZEN_PROPERTY_KEYS)
    }
  })

  test("invalid payloads die with the typed InvalidCtxPackChangedEventError", async () => {
    const { events, recorded } = fakeEvents()
    const publisher = CtxPackEvents.make(events)
    const invalid: unknown[] = [
      // Unknown change value.
      { type: "workspace.ctxpack.changed", properties: { workspaceID: "ws-1", ctxPackID: "ctxpk_1", revision: 1, change: "exploded" } },
      // Missing revision.
      { type: "workspace.ctxpack.changed", properties: { workspaceID: "ws-1", ctxPackID: "ctxpk_1", change: "used" } },
      // Non-integer revision.
      { type: "workspace.ctxpack.changed", properties: { workspaceID: "ws-1", ctxPackID: "ctxpk_1", revision: "nope", change: "used" } },
      // Missing properties entirely.
      { type: "workspace.ctxpack.changed" },
    ]
    for (const payload of invalid) {
      const exit = await Effect.runPromise(
        Effect.exit(publisher.publish(payload as unknown as CtxPackEvents.CtxPackChangedEvent)),
      )
      if (Exit.isFailure(exit)) {
        const dies = exit.cause.reasons.filter(Cause.isDieReason)
        expect(dies).toHaveLength(1)
        expect(dies[0]!.defect).toBeInstanceOf(CtxPackEvents.InvalidCtxPackChangedEventError)
      } else {
        expect.unreachable("invalid payload must fail")
      }
      // Nothing reached the EventV2 transport.
      expect(recorded).toHaveLength(0)
    }
  })

  test("publisher routes through EventV2 publish with the exact S1 definition", async () => {
    const { recorded, events } = fakeEvents()
    const publisher = CtxPackEvents.make(events)
    await Effect.runPromise(publisher.publish(eventFor("used")))

    expect(recorded).toHaveLength(1)
    // The identical definition object from @opencode-ai/schema/ctxpack.
    expect(recorded[0]!.definition).toBe(CtxPackChanged)
    expect(recorded[0]!.definition.type).toBe("workspace.ctxpack.changed")
    // No second transport objects: the fake only exposes `publish`.
    expect(Object.keys(events).sort()).toEqual(["publish"])
  })
})
