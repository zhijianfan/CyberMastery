// Context capsule store: durable, workspace-scoped storage for context
// capsules (CtxPack slices). The schema-typed capsule body lives in
// capsule_json; createdBy and budget are frozen OUT-OF-SCHEMA in their own
// JSON columns (the Functionality.Capsule schema has no room for them).
//
// This store is mechanical: NO capability checks happen here (X1 performs
// them). Redaction contract: errors and logs carry IDs, hashes, counts and
// sizes ONLY — never facts, references, summaries, or other content.

export * as ContextCapsule from "./capsule"

import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Functionality } from "@opencode-ai/schema/functionality"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { create as createID } from "../id/id"
import { ContextCapsuleTable } from "./sql"

// --- Frozen types -----------------------------------------------------------

export interface ContextBudget {
  maximumBytes: number
  maximumEstimatedTokens: number
  maximumFacts: number
  maximumReferences: number
  maximumArtifacts: number
  maximumRecentEvents: number
}

export const DefaultInteractiveContextBudget: ContextBudget = {
  maximumBytes: 32 * 1024,
  maximumEstimatedTokens: 6_000,
  maximumFacts: 32,
  maximumReferences: 16,
  maximumArtifacts: 8,
  maximumRecentEvents: 8,
}

export interface StoredCapsule extends Functionality.Capsule {
  createdBy: { userId: string; instanceId: string; operationId?: string }
  budget: ContextBudget
}

// --- Durable table ----------------------------------------------------------
// The Drizzle definition lives in ./sql.ts (drizzle schema glob requires a
// sql.ts-named module so fresh databases include the table); the raw SQL
// migration `20260821_capsule.ts` must agree exactly with it.
export { ContextCapsuleTable } from "./sql"

// --- Typed errors ------------------------------------------------------------

// Corrupt stored JSON (capsule body, createdBy, or budget). Never silently
// skipped: callers decide between failing and re-creating the capsule.
export class CapsuleCorruptError extends Schema.TaggedErrorClass<CapsuleCorruptError>()(
  "ContextCapsule.Corrupt",
  { capsuleID: Schema.String, workspaceID: Schema.String },
) {}

// A capsule id already exists: capsules are immutable after their first write.
export class CapsuleConflictError extends Schema.TaggedErrorClass<CapsuleConflictError>()(
  "ContextCapsule.Conflict",
  { capsuleID: Schema.String, workspaceID: Schema.String },
) {}

// --- Store interface ---------------------------------------------------------

export interface ContextCapsuleStore {
  /** Assigns an id when empty ("ctxkpsl_" + ascending pattern); workspace-scoped; immutable after write. */
  store(capsule: StoredCapsule): Effect.Effect<StoredCapsule, CapsuleConflictError>
  get(workspaceID: string, capsuleID: string): Effect.Effect<StoredCapsule | undefined, CapsuleCorruptError>
  materialize(input: {
    workspaceID: string
    capsuleID: string
    requestedRefs: string[]
    budget: ContextBudget
  }): Effect.Effect<
    | {
        status: "ok"
        capsule: StoredCapsule
        content: { facts: unknown[]; references: unknown[]; artifactRefs: unknown[] }
        unresolvedRefs: string[]
        byteLength: number
        estimatedTokens: number
      }
    | { status: "not-found" }
    | { status: "expired"; expiresAt: number }
    | { status: "over-budget"; limit: "bytes" | "tokens"; current: number; maximum: number },
    CapsuleCorruptError
  >
}

export class Service extends Context.Service<Service, ContextCapsuleStore>()(
  "@opencode/v2/ContextCapsuleStore",
) {}

// --- Implementation ------------------------------------------------------------

interface CapsuleRow {
  id: string
  workspace_id: string
  purpose: string
  content_hash: string
  capsule_json: string
  created_by_json: string
  budget_json: string
  created_at: number
  expires_at: number | null
}

const decodeRow = (row: CapsuleRow): Effect.Effect<StoredCapsule, CapsuleCorruptError> =>
  Effect.try({
    try: () => {
      const capsule = Schema.decodeSync(Functionality.Capsule)(JSON.parse(row.capsule_json) as Functionality.Capsule)
      const createdBy = JSON.parse(row.created_by_json) as StoredCapsule["createdBy"]
      const budget = JSON.parse(row.budget_json) as ContextBudget
      return { ...capsule, createdBy, budget }
    },
    catch: () => new CapsuleCorruptError({ capsuleID: row.id, workspaceID: row.workspace_id }),
  })

// References are unknown-typed at the schema level; at runtime CtxPack
// references carry { ref: { type: "ctxpack-fragment", id } }. Entries with a
// ref.id are filtered by requestedRefs (all kept when requestedRefs is
// empty); entries without one are always kept.
const filterRefs = (refs: readonly unknown[], requested: ReadonlySet<string>): unknown[] =>
  [...refs].filter((entry) => {
    const id = (entry as { ref?: { id?: string } } | null)?.ref?.id
    if (id === undefined || id === null) return true
    return requested.size === 0 || requested.has(id)
  })

const collectRefIDs = (refs: readonly unknown[]) => {
  const ids = new Set<string>()
  for (const entry of refs) {
    const id = (entry as { ref?: { id?: string } } | null)?.ref?.id
    if (id !== undefined && id !== null) ids.add(id)
  }
  return ids
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const store: ContextCapsuleStore["store"] = Effect.fn("ContextCapsuleStore.store")(function* (capsule) {
      const id = capsule.id || createID("ctxkpsl", "ascending")
      // Strip the out-of-schema extensions before encoding the schema body.
      const body: Functionality.Capsule = {
        id,
        version: capsule.version,
        workspaceId: capsule.workspaceId,
        purpose: capsule.purpose,
        audience: capsule.audience,
        summary: capsule.summary,
        facts: capsule.facts,
        references: capsule.references,
        artifactRefs: capsule.artifactRefs,
        recentEvents: capsule.recentEvents,
        contentHash: capsule.contentHash,
        createdAt: capsule.createdAt,
        expiresAt: capsule.expiresAt,
      }
      const capsuleJson = Schema.encodeSync(Functionality.Capsule)(body)
      const inserted = yield* db
        .insert(ContextCapsuleTable)
        .values({
          id,
          workspace_id: capsule.workspaceId,
          purpose: capsule.purpose,
          content_hash: capsule.contentHash,
          capsule_json: capsuleJson,
          created_by_json: capsule.createdBy,
          budget_json: capsule.budget,
          created_at: capsule.createdAt,
          expires_at: capsule.expiresAt ?? null,
        })
        .onConflictDoNothing()
        .returning()
        .pipe(Effect.orDie)
      if (inserted.length === 0) {
        return yield* new CapsuleConflictError({ capsuleID: id, workspaceID: capsule.workspaceId })
      }
      return { ...capsule, id }
    })

    const get: ContextCapsuleStore["get"] = Effect.fn("ContextCapsuleStore.get")(function* (workspaceID, capsuleID) {
      // Raw SQL so corrupt JSON surfaces as a typed CapsuleCorruptError
      // instead of a driver-level parse throw.
      const row = yield* db
        .get<CapsuleRow>(
          sql`SELECT * FROM context_capsule WHERE id = ${capsuleID} AND workspace_id = ${workspaceID}`,
        )
        .pipe(Effect.orDie)
      if (!row) return undefined
      return yield* decodeRow(row)
    })

    const materialize: ContextCapsuleStore["materialize"] = Effect.fn("ContextCapsuleStore.materialize")(
      function* (input) {
        const capsule = yield* get(input.workspaceID, input.capsuleID)
        if (!capsule) return { status: "not-found" }
        if (capsule.expiresAt !== undefined && capsule.expiresAt !== null && capsule.expiresAt <= Date.now()) {
          return { status: "expired", expiresAt: capsule.expiresAt }
        }
        const requested = new Set(input.requestedRefs)
        const references = filterRefs(capsule.references, requested)
        const artifactRefs = filterRefs(capsule.artifactRefs, requested)
        const content = { facts: [...capsule.facts], references, artifactRefs }

        const found = collectRefIDs(capsule.references)
        for (const id of collectRefIDs(capsule.artifactRefs)) found.add(id)
        const unresolvedRefs = input.requestedRefs.filter((id) => !found.has(id))

        const json = JSON.stringify(content)
        const byteLength = new TextEncoder().encode(json).length
        const estimatedTokens = Math.ceil(byteLength / 4)
        if (byteLength > input.budget.maximumBytes) {
          return {
            status: "over-budget",
            limit: "bytes",
            current: byteLength,
            maximum: input.budget.maximumBytes,
          }
        }
        if (estimatedTokens > input.budget.maximumEstimatedTokens) {
          return {
            status: "over-budget",
            limit: "tokens",
            current: estimatedTokens,
            maximum: input.budget.maximumEstimatedTokens,
          }
        }
        return { status: "ok", capsule, content, unresolvedRefs, byteLength, estimatedTokens }
      },
    )

    return Service.of({ store, get, materialize })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
