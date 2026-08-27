export * as SessionRuntime from "./runtime"

import { sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../database/database"
import { SessionSchema } from "./schema"
import { SessionRuntime as RuntimeSchema, type SessionRuntime as Runtime } from "@opencode-ai/schema/session-runtime"

type SessionDatabase = Database.Interface["db"]
type SessionTransaction = Parameters<Parameters<SessionDatabase["transaction"]>[0]>[0]
export type DatabaseOrTransaction = SessionDatabase | SessionTransaction

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("SessionRuntime.ConflictError", {
  sessionID: SessionSchema.ID,
  expected: RuntimeSchema,
  actual: Schema.optional(RuntimeSchema),
}) {}

const decodeRuntime = Schema.decodeUnknownSync(RuntimeSchema)

/** Classifies a Session from projected child-table evidence only. */
export function classify(
  dbOrTx: DatabaseOrTransaction,
  sessionID: SessionSchema.ID,
): Effect.Effect<Runtime> {
  return Effect.gen(function* () {
    const row = yield* dbOrTx
      .get<{ runtime: string }>(sql`
        SELECT CASE
          WHEN (
            EXISTS (SELECT 1 FROM message WHERE message.session_id = ${sessionID})
            OR EXISTS (SELECT 1 FROM part WHERE part.session_id = ${sessionID})
          ) AND (
            EXISTS (SELECT 1 FROM session_input WHERE session_input.session_id = ${sessionID})
            OR EXISTS (SELECT 1 FROM session_message WHERE session_message.session_id = ${sessionID})
            OR EXISTS (SELECT 1 FROM session_context_epoch WHERE session_context_epoch.session_id = ${sessionID})
          ) THEN 'mixed'
          WHEN (
            EXISTS (SELECT 1 FROM session_input WHERE session_input.session_id = ${sessionID})
            OR EXISTS (SELECT 1 FROM session_message WHERE session_message.session_id = ${sessionID})
            OR EXISTS (SELECT 1 FROM session_context_epoch WHERE session_context_epoch.session_id = ${sessionID})
          ) THEN 'v2'
          ELSE 'legacy'
        END AS runtime
      `)
      .pipe(Effect.orDie)
    return decodeRuntime(row?.runtime ?? "legacy")
  })
}

/** Requires a concrete stored Session runtime before a mutation proceeds. */
export function require(
  sessionID: SessionSchema.ID,
  expected: Runtime,
  dbOrTx: DatabaseOrTransaction,
): Effect.Effect<void, ConflictError> {
  return Effect.gen(function* () {
    const row = yield* dbOrTx
      .get<{ runtime: string }>(sql`SELECT runtime FROM session WHERE id = ${sessionID}`)
      .pipe(Effect.orDie)
    const actual = row ? decodeRuntime(row.runtime) : undefined
    if (actual !== expected) return yield* Effect.fail(new ConflictError({ sessionID, expected, actual }))
  })
}

export const requireRuntime = require
