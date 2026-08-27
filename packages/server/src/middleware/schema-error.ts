import { Effect } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { SchemaErrorMiddleware } from "@opencode-ai/protocol/middleware/schema-error"
export { SchemaErrorMiddleware } from "@opencode-ai/protocol/middleware/schema-error"

const REASON_LIMIT = 1024
const PRIVATE_PROMPT_PATH = "/api/session/:sessionID/prompt"
const PRIVATE_PROMPT_INVALID = "private_prompt_invalid"

function truncateReason(reason: string) {
  if (reason.length <= REASON_LIMIT) return reason
  return reason.slice(0, REASON_LIMIT) + `... (${reason.length - REASON_LIMIT} more chars)`
}

export const schemaErrorLayer = HttpApiMiddleware.layerSchemaErrorTransform(SchemaErrorMiddleware, (error, context) => {
  if (context.endpoint.path === PRIVATE_PROMPT_PATH) {
    const ref = `err_${crypto.randomUUID().slice(0, 8)}`
    return Effect.logWarning("private prompt schema rejection").pipe(
      Effect.annotateLogs({ kind: PRIVATE_PROMPT_INVALID, ref }),
      Effect.andThen(
        Effect.fail(
          new InvalidRequestError({
            message: `Private prompt request is invalid. Reference: ${ref}`,
            kind: PRIVATE_PROMPT_INVALID,
          }),
        ),
      ),
    )
  }
  const reason = truncateReason(error.cause.message)
  return Effect.logWarning("schema rejection").pipe(
    Effect.annotateLogs({ kind: error.kind, reason }),
    Effect.andThen(Effect.fail(new InvalidRequestError({ message: reason, kind: error.kind }))),
  )
})
