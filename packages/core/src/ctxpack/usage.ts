// CtxPack usage accounting: durable admission ledger + attached-count
// increments + transient "used" change events.
//
// Idempotent by construction: recording the same sessionInputID twice counts
// once (INSERT ... ON CONFLICT DO NOTHING), and after-commit "used" events are
// NOT re-emitted for already-recorded admissions. Event publish failures never
// roll back the durable ledger/count — events are hints, the DB is
// authoritative.

export * as CtxPackUsage from "./usage"

import { Context, Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { Cause } from "effect"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { CtxPackEvents } from "./events"
import { CtxPackRepositoryService, node as repositoryNode, type CtxPackRepository } from "./sql"
import {
  CtxPackObservabilityService,
  node as observabilityNode,
  type CtxPackObservability,
} from "./observability"

export interface CtxPackUsagePort {
  recordAdmittedUse(input: {
    workspaceID: string
    userID: string
    ctxPackIDs: readonly string[]
    sessionInputID: string
    admittedAt: number
  }): Effect.Effect<void>
}

export class Service extends Context.Service<Service, CtxPackUsagePort>()("@opencode/v2/CtxPackUsage") {}

export interface CtxPackUsageDeps {
  readonly db: Database.Interface["db"]
  readonly repository: CtxPackRepository
  readonly publisher: CtxPackEvents.CtxPackEventPublisher
  readonly observability: CtxPackObservability
}

export const make = (deps: CtxPackUsageDeps): CtxPackUsagePort => {
  const recordAdmittedUse: CtxPackUsagePort["recordAdmittedUse"] = (input) =>
    Effect.gen(function* () {
      const distinct = [...new Set(input.ctxPackIDs)]
      const newlyCounted: Array<{ ctxPackID: string; revision: number }> = []
      let duplicated = 0

      // One transaction for all packs in the input. recordUse runs on the same
      // connection inside the transaction, so a failure rolls everything back.
      yield* deps.db.transaction((tx) =>
        Effect.gen(function* () {
          for (const ctxPackID of distinct) {
            const inserted = yield* tx.get<{ ctx_pack_id: string }>(
              sql`INSERT INTO ctx_pack_usage_admission (ctx_pack_id, session_input_id, time_recorded) VALUES (${ctxPackID}, ${input.sessionInputID}, ${input.admittedAt}) ON CONFLICT DO NOTHING RETURNING ctx_pack_id`,
            )
            if (!inserted) {
              duplicated += 1
              continue
            }
            // Capture the pack's current revision for the "used" hint; the
            // pack row is stable inside this transaction.
            const row = yield* tx.get<{ revision: number }>(
              sql`SELECT revision FROM ctx_pack WHERE id = ${ctxPackID} AND workspace_id = ${input.workspaceID}`,
            )
            yield* deps.repository.recordUse(input.workspaceID, ctxPackID as CtxPack.ID, input.admittedAt)
            newlyCounted.push({ ctxPackID, revision: row?.revision ?? 0 })
          }
        }),
      )

      // After commit: observability + one transient "used" event per newly
      // counted pack. Publish failures (typed or defects) are counted and
      // swallowed — the ledger already committed.
      for (const counted of newlyCounted) {
        deps.observability.metrics.attachmentAdmissionTotal({ status: "counted" })
        deps.observability.audit.record({
          correlationId: null,
          workspaceID: input.workspaceID,
          ctxPackID: counted.ctxPackID,
          userID: input.userID,
          operation: "admitted-use",
          result: "ok",
        })
        yield* deps.publisher
          .publish({
            type: "workspace.ctxpack.changed",
            properties: {
              workspaceID: input.workspaceID,
              ctxPackID: counted.ctxPackID,
              revision: counted.revision,
              change: "used",
            },
          })
          .pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterrupts(cause)
                ? Effect.interrupt
                : Effect.sync(() => deps.observability.metrics.eventPublishFailuresTotal()),
            ),
          )
      }
      if (duplicated > 0) {
        deps.observability.metrics.attachmentAdmissionTotal({ status: "duplicate" })
      }
    }).pipe(Effect.orDie)
  return { recordAdmittedUse }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const repository = yield* CtxPackRepositoryService
    const publisher = yield* CtxPackEvents.CtxPackEventPublisherService
    const observability = yield* CtxPackObservabilityService
    return make({ db, repository, publisher, observability })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, repositoryNode, CtxPackEvents.node, observabilityNode],
})
