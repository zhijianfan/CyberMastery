export * as SessionCompactionContext from "./compaction-context"

import { Effect, Schema } from "effect"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import type { Database } from "../database/database"
import { NonNegativeInt } from "../schema"
import { Hash } from "../util/hash"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionMessageTable } from "./sql"

export const SENTINEL = "[Private model context checkpoint v1]"

export interface V1 extends Schema.Schema.Type<typeof V1> {}
export const V1 = Schema.Struct({
  version: Schema.Literal(1),
  rendererVersion: Schema.Literal(1),
  summary: Schema.String,
  recent: Schema.String,
  contentHash: Schema.String,
  byteLength: NonNegativeInt,
  estimatedTokens: NonNegativeInt,
  createdAt: NonNegativeInt,
}).annotate({ identifier: "SessionCompactionContext.V1" })

export class Corrupt extends Schema.TaggedErrorClass<Corrupt>()("SessionCompactionContext.Corrupt", {
  id: SessionMessage.ID,
}) {}

const decoder = Schema.decodeUnknownEffect(V1)
const decodeJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)
const fields = new Set([
  "version",
  "rendererVersion",
  "summary",
  "recent",
  "contentHash",
  "byteLength",
  "estimatedTokens",
  "createdAt",
])
const canonical = (input: Pick<V1, "summary" | "recent">) =>
  JSON.stringify({ version: 1, rendererVersion: 1, summary: input.summary, recent: input.recent })

export function make(input: { readonly summary: string; readonly recent: string; readonly createdAt: number }): V1 {
  const content = canonical(input)
  const byteLength = new TextEncoder().encode(content).length
  return {
    version: 1,
    rendererVersion: 1,
    summary: input.summary,
    recent: input.recent,
    contentHash: Hash.sha256(content),
    byteLength,
    estimatedTokens: Math.ceil(byteLength / 4),
    createdAt: input.createdAt,
  }
}

export const decode = Effect.fn("SessionCompactionContext.decode")(function* (value: unknown, id: SessionMessage.ID) {
  const parsed =
    typeof value === "string" ? yield* decodeJson(value).pipe(Effect.mapError(() => new Corrupt({ id }))) : value
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Object.keys(parsed).length !== fields.size ||
    Object.keys(parsed).some((key) => !fields.has(key))
  )
    return yield* new Corrupt({ id })
  const context = yield* decoder(parsed).pipe(Effect.mapError(() => new Corrupt({ id })))
  const expected = make({ summary: context.summary, recent: context.recent, createdAt: context.createdAt })
  if (
    context.contentHash !== expected.contentHash ||
    context.byteLength !== expected.byteLength ||
    context.estimatedTokens !== expected.estimatedTokens
  )
    return yield* new Corrupt({ id })
  return context
})

export const byMessageID = Effect.fn("SessionCompactionContext.byMessageID")(function* (
  db: Database.Interface["db"],
  sessionID: SessionSchema.ID,
  messages: ReadonlyArray<SessionMessage.Compaction>,
) {
  if (messages.length === 0) return new Map<SessionMessage.ID, V1>()
  const rows = yield* db
    .select({ id: SessionMessageTable.id, modelContext: SessionMessageTable.model_context_json })
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        eq(SessionMessageTable.type, "compaction"),
        inArray(
          SessionMessageTable.id,
          messages.map((message) => message.id),
        ),
      ),
    )
    .all()
    .pipe(Effect.orDie)
  const rowByID = new Map(rows.map((row) => [row.id, row]))
  const result = new Map<SessionMessage.ID, V1>()
  for (const message of messages) {
    const value = rowByID.get(message.id)?.modelContext
    if (value === null || value === undefined) {
      if (message.summary === SENTINEL) return yield* new Corrupt({ id: message.id })
      continue
    }
    if (message.summary !== SENTINEL) return yield* new Corrupt({ id: message.id })
    result.set(message.id, yield* decode(value, message.id))
  }
  return result as ReadonlyMap<SessionMessage.ID, V1>
})

export const commit = Effect.fn("SessionCompactionContext.commit")(function* (
  db: Database.Interface["db"],
  input: {
    readonly sessionID: SessionSchema.ID
    readonly messageID: SessionMessage.ID
    readonly seq: number
    readonly context: V1
  },
) {
  const rows = yield* db
    .update(SessionMessageTable)
    .set({ model_context_json: JSON.stringify(input.context) })
    .where(
      and(
        eq(SessionMessageTable.session_id, input.sessionID),
        eq(SessionMessageTable.id, input.messageID),
        eq(SessionMessageTable.seq, input.seq),
        eq(SessionMessageTable.type, "compaction"),
        isNull(SessionMessageTable.model_context_json),
        sql`json_extract(${SessionMessageTable.data}, '$.summary') = ${SENTINEL}`,
      ),
    )
    .returning({ id: SessionMessageTable.id })
    .all()
    .pipe(Effect.orDie)
  if (rows.length !== 1) return yield* Effect.die(new Corrupt({ id: input.messageID }))
})
