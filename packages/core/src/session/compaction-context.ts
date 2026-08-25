export * as SessionCompactionContext from "./compaction-context"

import { createHash } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import type { Database } from "../database/database"
import { SessionMessage } from "./message"
import { SessionMessageTable } from "./sql"

export const V1 = Schema.Struct({
  version: Schema.Literal(1),
  rendererVersion: Schema.Literal(1),
  summary: Schema.String,
  recent: Schema.String,
  contentHash: Schema.String,
  byteLength: NonNegativeInt,
  estimatedTokens: NonNegativeInt,
  createdAt: NonNegativeInt,
})
export type V1 = typeof V1.Type

export const sentinel = "[Private model context checkpoint v1]"

export class Corrupt extends Schema.TaggedErrorClass<Corrupt>()("SessionCompactionContext.Corrupt", {
  id: SessionMessage.ID,
}) {}

const decodeV1 = Schema.decodeUnknownOption(V1, { onExcessProperty: "error" })
const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const encoder = new TextEncoder()

export function make(input: { readonly summary: string; readonly recent: string; readonly createdAt: number }): V1 {
  const measured = measure(input.summary, input.recent)
  return {
    version: 1,
    rendererVersion: 1,
    summary: input.summary,
    recent: input.recent,
    contentHash: measured.contentHash,
    byteLength: measured.byteLength,
    estimatedTokens: measured.estimatedTokens,
    createdAt: input.createdAt,
  }
}

export function decode(id: SessionMessage.ID, input: unknown): Effect.Effect<V1, Corrupt> {
  const value = typeof input === "string" ? decodeJson(input) : Option.some(input)
  if (Option.isNone(value)) return Effect.fail(new Corrupt({ id }))
  const decoded = decodeV1(value.value)
  if (Option.isNone(decoded)) return Effect.fail(new Corrupt({ id }))
  const measured = measure(decoded.value.summary, decoded.value.recent)
  if (
    decoded.value.contentHash !== measured.contentHash ||
    decoded.value.byteLength !== measured.byteLength ||
    decoded.value.estimatedTokens !== measured.estimatedTokens
  )
    return Effect.fail(new Corrupt({ id }))
  return Effect.succeed(decoded.value)
}

export const read = Effect.fn("SessionCompactionContext.read")(function* (
  db: Database.Interface["db"],
  id: SessionMessage.ID,
) {
  const row = yield* db
    .select({ context: sql<string | null>`${SessionMessageTable.model_context_json}` })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.id, id), eq(SessionMessageTable.type, "compaction")))
    .get()
    .pipe(Effect.orDie)
  if (row?.context === null || row?.context === undefined) return
  return yield* decode(id, row.context)
})

export const readByMessageID = Effect.fn("SessionCompactionContext.readByMessageID")(function* (
  db: Database.Interface["db"],
  messages: readonly SessionMessage.Message[],
) {
  const compactions = messages.filter(
    (message): message is SessionMessage.Compaction => message.type === "compaction" && message.summary === sentinel,
  )
  if (compactions.length === 0) return new Map<SessionMessage.ID, V1>()
  const rows = yield* db
    .select({ id: SessionMessageTable.id, context: sql<string | null>`${SessionMessageTable.model_context_json}` })
    .from(SessionMessageTable)
    .where(
      inArray(
        SessionMessageTable.id,
        compactions.map((message) => message.id),
      ),
    )
    .all()
    .pipe(Effect.orDie)
  const byID = new Map(rows.map((row) => [row.id, row.context]))
  return new Map(
    yield* Effect.forEach(compactions, (message) =>
      Effect.gen(function* () {
        const context = byID.get(message.id)
        if (context === null || context === undefined) return yield* new Corrupt({ id: message.id })
        return [message.id, yield* decode(message.id, context)] as const
      }),
    ),
  )
})

export const write = Effect.fn("SessionCompactionContext.write")(function* (
  db: Database.Interface["db"],
  id: SessionMessage.ID,
  context: V1,
) {
  const row = yield* db
    .update(SessionMessageTable)
    .set({ model_context_json: context })
    .where(and(eq(SessionMessageTable.id, id), eq(SessionMessageTable.type, "compaction")))
    .returning({ id: SessionMessageTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!row) return yield* Effect.die(`Compaction message not found: ${id}`)
})

function measure(summary: string, recent: string) {
  const canonical = JSON.stringify({ version: 1, rendererVersion: 1, summary, recent })
  const byteLength = encoder.encode(canonical).length
  return {
    contentHash: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    byteLength,
    estimatedTokens: Math.ceil(byteLength / 4),
  }
}
