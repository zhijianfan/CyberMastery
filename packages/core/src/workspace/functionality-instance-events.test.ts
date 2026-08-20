import { describe, expect, it } from "bun:test"
import { Effect, Layer, Schema, Stream } from "effect"

import { Workspace } from "@opencode-ai/schema/workspace"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { WorkspaceV2Table } from "./sql"
import * as FunctionalityInstance from "./functionality-instance"
import * as FunctionalityInstanceEvents from "./functionality-instance-events"

type CapturedEvent = {
  readonly type: string
  readonly data: FunctionalityInstanceEvents.InstanceChangedEvent
}

const makeEventCaptureLayer = (captured: Array<CapturedEvent>) =>
  Layer.succeed(
    EventV2.Service,
    EventV2.Service.of({
      publish: (_definition, data) =>
        Effect.sync(() => {
          const payload = { id: EventV2.ID.make(`evt_${crypto.randomUUID()}`), type: _definition.type, data }
          captured.push({
            type: _definition.type,
            data: data as FunctionalityInstanceEvents.InstanceChangedEvent,
          })
          return payload
        }),
      subscribe: () => Stream.empty,
      all: () => Stream.empty,
      durable: () => Stream.empty,
      listen: () => Effect.succeed(Effect.void),
      project: () => Effect.void,
      replay: () => Effect.void,
      replayAll: () => Effect.succeed(undefined),
      remove: () => Effect.void,
      claim: () => Effect.void,
    }),
  )

const makeTestLayer = (captured: Array<CapturedEvent>) => {
  const databaseLayer = Database.layerFromPath(":memory:")
  const functionalityLayer = FunctionalityInstance.node.implementation! as Layer.Layer<FunctionalityInstance.Service>
  const eventLayer = makeEventCaptureLayer(captured)
  const preparedFunctionalityLayer = functionalityLayer
    .pipe(Layer.provide(databaseLayer))
    .pipe(Layer.provide(eventLayer))
  return Layer.merge(preparedFunctionalityLayer, databaseLayer)
}

const runWithLayer = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  captured: Array<CapturedEvent>,
) => Effect.runPromise(Effect.provide(effect, makeTestLayer(captured)) as Effect.Effect<A, E>)

const seedWorkspace = (workspaceID: Workspace.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const now = Date.now()
    yield* db
      .insert(WorkspaceV2Table)
      .values({
        id: workspaceID,
        name: "test",
        style: "default",
        directories: [],
        plugin_ids: [],
        skill_ids: [],
        operating_agent: null,
        model: null,
        coder_model: null,
        user: "",
        time_created: now,
        time_updated: now,
      })
      .run()
      .pipe(Effect.orDie)
  })

describe("FunctionalityInstance.changed event", () => {
  it("publishes on create only when getOrCreate creates a row", async () => {
    const workspaceID = Workspace.ID.create()
    const captured: Array<CapturedEvent> = []
    await runWithLayer(
      Effect.gen(function* () {
        yield* seedWorkspace(workspaceID)
        const instances = yield* FunctionalityInstance.Service
        const input = {
          workspaceID,
          blockID: "b1",
          functionalityID: "builtin:chat",
          configuration: { version: 1 },
        }
        const first = yield* instances.getOrCreate(input)
        const second = yield* instances.getOrCreate(input)
        expect(first.type).toBe("created")
        expect(second.type).toBe("existing")
        expect(captured).toEqual([
          {
            type: "workspace.functionality.instance.changed",
            data: {
              workspaceID,
              blockID: "b1",
              functionalityID: "builtin:chat",
              instanceID: first.instance.id,
              revision: 0,
              change: "created",
            },
          },
        ])
      }),
      captured,
    )
  })

  it("publishes created and then updated for upsert", async () => {
    const workspaceID = Workspace.ID.create()
    const captured: Array<CapturedEvent> = []
    await runWithLayer(
      Effect.gen(function* () {
        yield* seedWorkspace(workspaceID)
        const instances = yield* FunctionalityInstance.Service
        const created = yield* instances.upsert({
          workspaceID,
          blockID: "b2",
          functionalityID: "builtin:chat",
          configuration: { value: 1 },
        })
        const updated = yield* instances.upsert({
          workspaceID,
          blockID: "b2",
          functionalityID: "builtin:chat",
          configuration: { value: 2 },
        })
        expect(created.revision).toBe(0)
        expect(updated.revision).toBe(1)
        expect(captured.map((event) => event.data.change)).toEqual(["created", "updated"])
        expect(captured[0].data.instanceID).toBe(created.id)
        expect(captured[1].data.instanceID).toBe(updated.id)
        expect(captured[1].data.revision).toBe(updated.revision)
      }),
      captured,
    )
  })

  it("does not publish on CAS conflict", async () => {
    const workspaceID = Workspace.ID.create()
    const captured: Array<CapturedEvent> = []
    await runWithLayer(
      Effect.gen(function* () {
        yield* seedWorkspace(workspaceID)
        const instances = yield* FunctionalityInstance.Service
        const created = yield* instances.getOrCreate({
          workspaceID,
          blockID: "b3",
          functionalityID: "builtin:chat",
          configuration: { value: 1 },
        })
        yield* instances.compareAndSwapConfiguration({
          instanceID: created.instance.id,
          expectedRevision: created.instance.revision,
          nextConfiguration: { value: 2 },
        })
        captured.length = 0
        const conflict = yield* instances.compareAndSwapConfiguration({
          instanceID: created.instance.id,
          expectedRevision: created.instance.revision,
          nextConfiguration: { value: 3 },
        })
        expect(conflict.type).toBe("conflict")
        expect(captured).toEqual([])
      }),
      captured,
    )
  })

  it("publishes on tombstone", async () => {
    const workspaceID = Workspace.ID.create()
    const captured: Array<CapturedEvent> = []
    await runWithLayer(
      Effect.gen(function* () {
        yield* seedWorkspace(workspaceID)
        const instances = yield* FunctionalityInstance.Service
        const created = yield* instances.upsert({
          workspaceID,
          blockID: "b4",
          functionalityID: "builtin:chat",
          configuration: { value: 1 },
        })
        captured.length = 0
        const tombstoned = yield* instances.tombstone({
          instanceID: created.id,
          expectedRevision: created.revision,
        })
        expect(tombstoned.type).toBe("tombstoned")
        expect(captured.map((event) => event.data.change)).toEqual(["tombstoned"])
        expect(captured[0].data.instanceID).toBe(created.id)
      }),
      captured,
    )
  })

  it("event payload contains no configuration field", async () => {
    const workspaceID = Workspace.ID.create()
    const captured: Array<CapturedEvent> = []
    await runWithLayer(
      Effect.gen(function* () {
        yield* seedWorkspace(workspaceID)
        const instances = yield* FunctionalityInstance.Service
        yield* instances.upsert({
          workspaceID,
          blockID: "b5",
          functionalityID: "builtin:chat",
          configuration: { secret: "token", uiState: { visible: true } },
        })
        expect(Object.hasOwn(captured[0].data, "configuration")).toBe(false)
        expect("sessionID" in captured[0].data).toBe(false)
      }),
      captured,
    )
  })

  it("round-trips FunctionalityInstanceEvents.InstanceChanged schema", () => {
    const payload: FunctionalityInstanceEvents.InstanceChangedEvent = {
      workspaceID: Workspace.ID.create(),
      blockID: "b6",
      functionalityID: "builtin:chat",
      instanceID: "i6",
      revision: 3,
      change: "updated",
    }
    const encoded = Schema.encodeUnknownSync(FunctionalityInstanceEvents.InstanceChanged.data)(payload)
    const decoded = Schema.decodeUnknownSync(FunctionalityInstanceEvents.InstanceChanged.data)(encoded)
    expect(decoded).toEqual(payload)
  })
})
