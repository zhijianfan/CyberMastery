export * as FunctionalityInstance from "./functionality-instance"

import { and, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"
import * as FunctionalityInstanceEvents from "./functionality-instance-events"
import { FunctionalityInstanceTable } from "./sql"

export interface Instance {
  readonly id: string
  readonly workspaceID: Workspace.ID
  readonly blockID: string
  readonly functionalityID: string
  readonly revision: number
  readonly configuration: unknown
  readonly deletedAt: number | null
}

// The instance row is gone. Nothing in the repository deletes rows, so this
// only happens when a workspace (and its instances via cascade) was removed
// concurrently with a revision-guarded operation.
export class InstanceNotFoundError extends Schema.TaggedErrorClass<InstanceNotFoundError>()(
  "FunctionalityInstance.InstanceNotFoundError",
  { instanceID: Schema.String },
) {}

export interface Interface {
  readonly get: (
    workspaceID: Workspace.ID,
    blockID: string,
    functionalityID: string,
  ) => Effect.Effect<Instance | undefined>
  readonly getOrCreate: (input: {
    workspaceID: Workspace.ID
    blockID: string
    functionalityID: string
    configuration: unknown
  }) => Effect.Effect<
    | { type: "created"; instance: Instance }
    | { type: "existing"; instance: Instance }
  >
  readonly upsert: (input: {
    workspaceID: Workspace.ID
    blockID: string
    functionalityID: string
    configuration: unknown
  }) => Effect.Effect<Instance>
  readonly compareAndSwapConfiguration: (input: {
    instanceID: string
    expectedRevision: number
    nextConfiguration: unknown
  }) => Effect.Effect<
    | { type: "updated"; instance: Instance }
    | { type: "conflict"; current: Instance },
    InstanceNotFoundError
  >
  readonly tombstone: (input: {
    instanceID: string
    expectedRevision: number
  }) => Effect.Effect<
    | { type: "tombstoned" }
    | { type: "conflict"; current: Instance },
    InstanceNotFoundError
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FunctionalityInstance") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    const eventPublisher = FunctionalityInstanceEvents.make(events)

    const get: Interface["get"] = Effect.fn("FunctionalityInstance.get")(function* (
      workspaceID,
      blockID,
      functionalityID,
    ) {
      const row = yield* db
        .select()
        .from(FunctionalityInstanceTable)
        .where(
          and(
            eq(FunctionalityInstanceTable.workspace_id, workspaceID),
            eq(FunctionalityInstanceTable.block_id, blockID),
            eq(FunctionalityInstanceTable.functionality_id, functionalityID),
            isNull(FunctionalityInstanceTable.deleted_at),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row ? fromRow(row) : undefined
    })

    // Idempotent create: the unique (workspace, block, functionality) index
    // decides the winner of a concurrent insert race. "created" means this
    // call owns the row; "existing" carries the row a concurrent writer
    // persisted first, live or tombstoned, so callers can decide between
    // treating it as a conflict and resurrecting it via compare-and-swap.
    const getOrCreate: Interface["getOrCreate"] = Effect.fn("FunctionalityInstance.getOrCreate")(function* (input) {
      const rows = yield* db
        .insert(FunctionalityInstanceTable)
        .values({
          id: crypto.randomUUID(),
          workspace_id: input.workspaceID,
          block_id: input.blockID,
          functionality_id: input.functionalityID,
          revision: 0,
          configuration: input.configuration,
          deleted_at: null,
          time_updated: Date.now(),
        })
        .onConflictDoNothing()
        .returning()
        .pipe(Effect.orDie)
      if (rows.length === 1) {
        const instance = fromRow(rows[0])
        yield* eventPublisher.instanceChanged({
          workspaceID: instance.workspaceID,
          blockID: instance.blockID,
          functionalityID: instance.functionalityID,
          instanceID: instance.id,
          revision: instance.revision,
          change: "created",
        })
        return { type: "created" as const, instance }
      }
      const row = yield* db
        .select()
        .from(FunctionalityInstanceTable)
        .where(
          and(
            eq(FunctionalityInstanceTable.workspace_id, input.workspaceID),
            eq(FunctionalityInstanceTable.block_id, input.blockID),
            eq(FunctionalityInstanceTable.functionality_id, input.functionalityID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* Effect.die(new Error("functionality instance vanished after an insert conflict"))
      return { type: "existing" as const, instance: fromRow(row) }
    })

    const upsert: Interface["upsert"] = Effect.fn("FunctionalityInstance.upsert")(function* (input) {
      const existing = yield* db
        .select()
        .from(FunctionalityInstanceTable)
        .where(
          and(
            eq(FunctionalityInstanceTable.workspace_id, input.workspaceID),
            eq(FunctionalityInstanceTable.block_id, input.blockID),
            eq(FunctionalityInstanceTable.functionality_id, input.functionalityID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (existing) {
        const revision = existing.revision + 1
        yield* db
          .update(FunctionalityInstanceTable)
          .set({ revision, configuration: input.configuration, deleted_at: null, time_updated: Date.now() })
          .where(eq(FunctionalityInstanceTable.id, existing.id))
          .run()
          .pipe(Effect.orDie)
        const instance = { ...fromRow(existing), revision, configuration: input.configuration, deletedAt: null }
        yield* eventPublisher.instanceChanged({
          workspaceID: instance.workspaceID,
          blockID: instance.blockID,
          functionalityID: instance.functionalityID,
          instanceID: instance.id,
          revision: instance.revision,
          change: "updated",
        })
        return instance
      }
      const row = {
        id: crypto.randomUUID(),
        workspace_id: input.workspaceID,
        block_id: input.blockID,
        functionality_id: input.functionalityID,
        revision: 0,
        configuration: input.configuration,
        deleted_at: null,
        time_updated: Date.now(),
      }
      yield* db.insert(FunctionalityInstanceTable).values(row).run().pipe(Effect.orDie)
      const instance = fromRow(row)
      yield* eventPublisher.instanceChanged({
        workspaceID: instance.workspaceID,
        blockID: instance.blockID,
        functionalityID: instance.functionalityID,
        instanceID: instance.id,
        revision: instance.revision,
        change: "created",
      })
      return instance
    })

    // Revision-guarded compare-and-swap: bumps the revision and replaces the
    // configuration only when the row still holds expectedRevision, so two
    // concurrent transitions cannot both persist. The loser receives the
    // winner's current row instead of overwriting it. A CAS on a tombstoned
    // row resurrects it with the next configuration.
    const compareAndSwapConfiguration: Interface["compareAndSwapConfiguration"] = Effect.fn(
      "FunctionalityInstance.compareAndSwapConfiguration",
    )(function* (input) {
      const rows = yield* db
        .update(FunctionalityInstanceTable)
        .set({
          revision: input.expectedRevision + 1,
          configuration: input.nextConfiguration,
          deleted_at: null,
          time_updated: Date.now(),
        })
        .where(
          and(
            eq(FunctionalityInstanceTable.id, input.instanceID),
            eq(FunctionalityInstanceTable.revision, input.expectedRevision),
          ),
        )
        .returning()
        .pipe(Effect.orDie)
      if (rows.length === 0) {
        const current = yield* db
          .select()
          .from(FunctionalityInstanceTable)
          .where(eq(FunctionalityInstanceTable.id, input.instanceID))
          .get()
          .pipe(Effect.orDie)
        if (!current) return yield* new InstanceNotFoundError({ instanceID: input.instanceID })
        return { type: "conflict" as const, current: fromRow(current) }
      }
      const instance = fromRow(rows[0])
      yield* eventPublisher.instanceChanged({
        workspaceID: instance.workspaceID,
        blockID: instance.blockID,
        functionalityID: instance.functionalityID,
        instanceID: instance.id,
        revision: instance.revision,
        change: "updated",
      })
      return { type: "updated" as const, instance }
    })

    // Revision-guarded tombstone: hides the row from get only when it still
    // holds expectedRevision, so a tombstone cannot clobber a concurrent
    // transition. The host Session record is never touched.
    const tombstone: Interface["tombstone"] = Effect.fn("FunctionalityInstance.tombstone")(function* (input) {
      const rows = yield* db
        .update(FunctionalityInstanceTable)
        .set({ deleted_at: Date.now(), time_updated: Date.now() })
        .where(
          and(
            eq(FunctionalityInstanceTable.id, input.instanceID),
            eq(FunctionalityInstanceTable.revision, input.expectedRevision),
          ),
        )
        .returning()
        .pipe(Effect.orDie)
      if (rows.length === 0) {
        const current = yield* db
          .select()
          .from(FunctionalityInstanceTable)
          .where(eq(FunctionalityInstanceTable.id, input.instanceID))
          .get()
          .pipe(Effect.orDie)
        if (!current) return yield* new InstanceNotFoundError({ instanceID: input.instanceID })
        return { type: "conflict" as const, current: fromRow(current) }
      }
      const instance = fromRow(rows[0])
      yield* eventPublisher.instanceChanged({
        workspaceID: instance.workspaceID,
        blockID: instance.blockID,
        functionalityID: instance.functionalityID,
        instanceID: instance.id,
        revision: instance.revision,
        change: "tombstoned",
      })
      return { type: "tombstoned" as const }
    })

    return Service.of({ get, getOrCreate, upsert, compareAndSwapConfiguration, tombstone })
  }),
)

function fromRow(row: typeof FunctionalityInstanceTable.$inferSelect): Instance {
  return {
    id: row.id,
    workspaceID: Workspace.ID.make(row.workspace_id),
    blockID: row.block_id,
    functionalityID: row.functionality_id,
    revision: row.revision,
    configuration: row.configuration,
    deletedAt: row.deleted_at,
  }
}

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, EventV2.node] })
