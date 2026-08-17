export * as FunctionalityInstance from "./functionality-instance"

import { and, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { FunctionalityInstanceTable } from "./sql"

export interface Instance {
  readonly id: string
  readonly workspaceID: Workspace.ID
  readonly blockID: string
  readonly functionalityID: string
  readonly revision: number
  readonly configuration: unknown
}

export interface Interface {
  readonly get: (
    workspaceID: Workspace.ID,
    blockID: string,
    functionalityID: string,
  ) => Effect.Effect<Instance | undefined>
  readonly upsert: (input: {
    workspaceID: Workspace.ID
    blockID: string
    functionalityID: string
    configuration: unknown
  }) => Effect.Effect<Instance>
  readonly tombstone: (workspaceID: Workspace.ID, blockID: string, functionalityID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FunctionalityInstance") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

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
        return { ...fromRow(existing), revision, configuration: input.configuration }
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
      return fromRow(row)
    })

    const tombstone: Interface["tombstone"] = Effect.fn("FunctionalityInstance.tombstone")(function* (
      workspaceID,
      blockID,
      functionalityID,
    ) {
      yield* db
        .update(FunctionalityInstanceTable)
        .set({ deleted_at: Date.now(), time_updated: Date.now() })
        .where(
          and(
            eq(FunctionalityInstanceTable.workspace_id, workspaceID),
            eq(FunctionalityInstanceTable.block_id, blockID),
            eq(FunctionalityInstanceTable.functionality_id, functionalityID),
          ),
        )
        .run()
        .pipe(Effect.orDie)
    })

    return Service.of({ get, upsert, tombstone })
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
  }
}

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
