export * as SessionContextSlot from "./context-slot"

import { Effect, Schema } from "effect"
import {
  SessionContextSnapshot,
  SessionContextSnapshotV1,
  SessionContextSnapshotV2,
} from "@opencode-ai/schema/session-input"
import { Hash } from "../util/hash"
import {
  canonicalContextBody,
  contextProvenance,
  contextRequestHash,
  WORKSPACE_CONTEXT_PREFIX,
  WORKSPACE_CONTEXT_SUFFIX,
  WORKSPACE_CONTEXT_NOTICE,
  type ContextSidecarAttachment,
} from "./context-sidecar"
import { SessionMessage } from "./message"

export interface PendingV2 extends Schema.Schema.Type<typeof PendingV2> {}
export const PendingV2 = Schema.Struct({ state: Schema.Literal("pending"), version: Schema.Literal(2) }).annotate({
  identifier: "SessionInput.PendingContextV2",
})

export type Stored = PendingV2 | SessionContextSnapshot
export const Stored = Schema.Union([PendingV2, SessionContextSnapshot]).annotate({
  identifier: "SessionInput.StoredContextSlot",
})

export class MissingPrivateContext extends Schema.TaggedErrorClass<MissingPrivateContext>()(
  "SessionInput.MissingPrivateContext",
  { id: SessionMessage.ID },
) {}

export class CorruptContextSnapshot extends Schema.TaggedErrorClass<CorruptContextSnapshot>()(
  "SessionInput.CorruptContextSnapshot",
  { id: SessionMessage.ID },
) {}

export function isPendingV2(value: unknown): value is PendingV2 {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  return (
    record.state === "pending" &&
    record.version === 2 &&
    keys.length === 2 &&
    keys.includes("state") &&
    keys.includes("version")
  )
}

const BodyAttachment = Schema.Union([
  Schema.Struct({
    selection: Schema.Literal("explicit"),
    contextCapsuleID: Schema.String,
    sourceCtxPackID: Schema.String,
    label: Schema.String,
    contentHash: Schema.String,
    fragments: Schema.Array(Schema.Struct({ contentHash: Schema.String, text: Schema.String })),
  }),
  Schema.Struct({
    selection: Schema.Literal("automatic"),
    sourceCtxPackID: Schema.String,
    label: Schema.String,
    contentHash: Schema.String,
    fragments: Schema.Array(Schema.Struct({ contentHash: Schema.String, text: Schema.String })),
  }),
])
const Body = Schema.Struct({
  version: Schema.Literal(1),
  notice: Schema.Literal(WORKSPACE_CONTEXT_NOTICE),
  attachments: Schema.Array(BodyAttachment),
})
const decodeStored = Schema.decodeUnknownEffect(Stored)
const decodeV1 = Schema.decodeUnknownEffect(SessionContextSnapshotV1)
const decodeV2 = Schema.decodeUnknownEffect(SessionContextSnapshotV2)
const decodeJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)
const decodeBody = Schema.decodeUnknownEffect(Body)

export const decodeContextSlot = Effect.fn("SessionContextSlot.decode")(function* (
  value: unknown,
  promptText: string,
  id: SessionMessage.ID,
) {
  if (typeof value === "object" && value !== null && "state" in value) {
    if (isPendingV2(value)) return yield* new MissingPrivateContext({ id })
    return yield* new CorruptContextSnapshot({ id })
  }
  const stored = yield* decodeStored(value).pipe(Effect.mapError(() => new CorruptContextSnapshot({ id })))
  if ("state" in stored) return yield* new CorruptContextSnapshot({ id })
  if (stored.version === 1) {
    const snapshot = yield* decodeV1(stored).pipe(Effect.mapError(() => new CorruptContextSnapshot({ id })))
    return { snapshot, contextRequestHash: contextRequestHash(snapshot.attachments) }
  }
  const snapshot = yield* decodeV2(stored).pipe(Effect.mapError(() => new CorruptContextSnapshot({ id })))
  if (snapshot.rendererVersion !== 1) return yield* new CorruptContextSnapshot({ id })
  if (snapshot.contextRequestHash !== contextRequestHash(snapshot.attachments))
    return yield* new CorruptContextSnapshot({ id })
  if (snapshot.apiContentHash !== Hash.sha256(snapshot.apiContent)) return yield* new CorruptContextSnapshot({ id })

  if (snapshot.attachments.length === 0) {
    if (snapshot.apiContent !== promptText || snapshot.byteLength !== 0 || snapshot.estimatedTokens !== 0)
      return yield* new CorruptContextSnapshot({ id })
    return { snapshot, contextRequestHash: snapshot.contextRequestHash }
  }

  const prefix = `${promptText}${WORKSPACE_CONTEXT_PREFIX}`
  if (!snapshot.apiContent.startsWith(prefix) || !snapshot.apiContent.endsWith(WORKSPACE_CONTEXT_SUFFIX))
    return yield* new CorruptContextSnapshot({ id })
  const bodyText = snapshot.apiContent.slice(prefix.length, -WORKSPACE_CONTEXT_SUFFIX.length)
  const bodyUnknown = yield* decodeJson(bodyText).pipe(Effect.mapError(() => new CorruptContextSnapshot({ id })))
  const body = yield* decodeBody(bodyUnknown).pipe(Effect.mapError(() => new CorruptContextSnapshot({ id })))
  const attachments = body.attachments as readonly ContextSidecarAttachment[]
  if (canonicalContextBody(attachments) !== bodyText) return yield* new CorruptContextSnapshot({ id })
  if (JSON.stringify(contextProvenance(attachments)) !== JSON.stringify(snapshot.attachments))
    return yield* new CorruptContextSnapshot({ id })
  const envelope = snapshot.apiContent.slice(promptText.length)
  const byteLength = new TextEncoder().encode(envelope).length
  if (snapshot.byteLength !== byteLength || snapshot.estimatedTokens !== Math.ceil(byteLength / 4))
    return yield* new CorruptContextSnapshot({ id })
  return { snapshot, contextRequestHash: snapshot.contextRequestHash }
})
