export * as SessionContextSlot from "./context-slot"

import { Effect, Schema } from "effect"
import { SessionContextSnapshot } from "@opencode-ai/schema/session-input"
import { SessionContextSidecar } from "./context-sidecar"
import { SessionMessage } from "./message"

export const Pending = Schema.Struct({ state: Schema.Literal("pending"), version: Schema.Literal(2) })
export type Pending = typeof Pending.Type
export const isPending = Schema.is(Pending)
export const Stored = Schema.Union([SessionContextSnapshot, Pending])
export type Stored = typeof Stored.Type

export class MissingPrivateContext extends Schema.TaggedErrorClass<MissingPrivateContext>()(
  "SessionInput.MissingPrivateContext",
  { id: SessionMessage.ID },
) {}

export const decodeStored = Schema.decodeUnknownSync(Stored)
export const decodePublic = Schema.decodeUnknownSync(SessionContextSnapshot)
const decodeStoredEffect = Schema.decodeUnknownEffect(Stored)

export function requireComplete(
  id: SessionMessage.ID,
  input: unknown,
  cleanText: string,
): Effect.Effect<SessionContextSnapshot, MissingPrivateContext | SessionContextSidecar.Corrupt> {
  return Effect.gen(function* () {
    const stored = yield* decodeStoredEffect(input).pipe(Effect.mapError(() => new SessionContextSidecar.Corrupt()))
    if ("state" in stored) return yield* new MissingPrivateContext({ id })
    if (stored.version === 2) return yield* SessionContextSidecar.decode(stored, cleanText)
    return stored
  })
}
