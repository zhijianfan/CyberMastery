import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import type { RuntimeEventEnvelope, RuntimeResourceBinding } from "@opencode-ai/protocol/groups/block-runtime"
import { Effect, Option, Ref, Result, Scope, Stream } from "effect"

const CURSOR_PREFIX = "runtime"

// A live-only delta carries no durable seq; it inherits the aggregate's last
// durable position so the client can order it against the snapshot.
type NativeEvent = EventV2.Payload

// Translate one native EventV2 payload into a resource-oriented runtime
// envelope. The cursor is assigned by the stream pipeline (translation is
// pure); unknown event types are dropped rather than leaked to the client.
export const translateEvent = (event: NativeEvent): Option.Option<Omit<RuntimeEventEnvelope, "cursor">> => {
  const base = { timestamp: Date.now() }
  const data = (event.data ?? {}) as Record<string, unknown>
  const sessionID = String(data.sessionID ?? event.durable?.aggregateID ?? "")

  switch (event.type) {
    case "session.next.prompted":
    case "session.next.prompt.admitted": {
      const messageID = String(data.messageID ?? "")
      if (event.type === "session.next.prompted") {
        return Option.some({
          ...base,
          event: "session.status",
          resource: { type: "session", id: sessionID },
          data: { id: sessionID, status: "busy" },
        })
      }
      if (!messageID) return Option.none()
      return Option.some({
        ...base,
        event: "message.created",
        resource: { type: "message", id: messageID, parentID: sessionID },
        data: { id: messageID, sessionID, role: "user" },
      })
    }
    case "session.next.step.failed": {
      return Option.some({
        ...base,
        event: "session.status",
        resource: { type: "session", id: sessionID },
        data: { id: sessionID, status: "idle", error: "step failed" },
      })
    }
    case "session.next.text.started":
    case "session.next.text.delta":
    case "session.next.text.ended": {
      const partID = String(data.textID ?? "")
      const messageID = String(data.assistantMessageID ?? "")
      if (!partID || !messageID) return Option.none()
      const text = event.type === "session.next.text.delta" ? String(data.delta ?? "") : String(data.text ?? "")
      return Option.some({
        ...base,
        event: "message-part.updated",
        resource: { type: "message-part", id: partID, parentID: messageID },
        data: { id: partID, messageID, kind: "text", text },
      })
    }
    case "session.next.reasoning.started":
    case "session.next.reasoning.delta":
    case "session.next.reasoning.ended": {
      const partID = String(data.reasoningID ?? data.textID ?? "")
      const messageID = String(data.assistantMessageID ?? data.messageID ?? "")
      if (!partID || !messageID) return Option.none()
      const text = event.type === "session.next.reasoning.delta" ? String(data.delta ?? "") : String(data.text ?? "")
      return Option.some({
        ...base,
        event: "message-part.updated",
        resource: { type: "message-part", id: partID, parentID: messageID },
        data: { id: partID, messageID, kind: "reasoning", text },
      })
    }
    case "session.next.tool.called":
    case "session.next.tool.progress":
    case "session.next.tool.success":
    case "session.next.tool.failed": {
      const partID = String(data.callID ?? data.toolID ?? data.id ?? "")
      const messageID = String(data.assistantMessageID ?? data.messageID ?? "")
      if (!partID || !messageID) return Option.none()
      return Option.some({
        ...base,
        event: "message-part.updated",
        resource: { type: "message-part", id: partID, parentID: messageID },
        data: { id: partID, messageID, kind: "tool", state: data.state ?? data },
      })
    }
    case "permission.v2.asked": {
      const requestID = String(data.id ?? "")
      if (!requestID) return Option.none()
      return Option.some({
        ...base,
        event: "permission.requested",
        resource: { type: "permission", id: requestID, parentID: sessionID },
        data: { id: requestID, requestID, sessionID, status: "pending" },
      })
    }
    case "permission.v2.replied": {
      const requestID = String(data.requestID ?? "")
      const reply = String(data.reply ?? "")
      const response = reply === "always" ? "allow-always" : reply === "reject" ? "deny" : "allow-once"
      return Option.some({
        ...base,
        event: "permission.resolved",
        resource: { type: "permission", id: requestID, parentID: sessionID },
        data: { id: requestID, requestID, sessionID, status: "resolved", response },
      })
    }
    default:
      return Option.none()
  }
}

// Is this native event interesting for the active bindings? The gateway is a
// filtering adapter over the single existing event bus — it never creates a
// second transport.
export const isRelevant = (
  event: NativeEvent,
  sessionIDs: ReadonlySet<string>,
  permissionBound: boolean,
): boolean => {
  const data = (event.data ?? {}) as Record<string, unknown>
  const aggregate = event.durable?.aggregateID
  const sessionID = String(data.sessionID ?? "")
  if (aggregate && sessionIDs.has(aggregate)) return true
  if (sessionID && sessionIDs.has(sessionID)) return true
  if (permissionBound && (event.type === "permission.v2.asked" || event.type === "permission.v2.replied")) return true
  return false
}

export const resyncEnvelope = (cursor: string, reason: string): RuntimeEventEnvelope => ({
  cursor,
  timestamp: Date.now(),
  resource: { type: "session", id: "resync" },
  event: "resync.required",
  data: { cursor, reason },
})

export type BlockRuntimeStreamDeps = EventV2.Service | Database.Service | Scope.Scope

// Live subscription stream: adapts the existing EventV2 bus, translates
// events, deduplicates durable (aggregateID, seq) pairs, detects sequence
// gaps (→ resync.required), and assigns a monotonic instance cursor per
// emitted envelope. The stream's finalizer releases the bus listener.
export const blockRuntimeStream = (
  bindings: ReadonlyArray<RuntimeResourceBinding>,
  resume?: string,
): Effect.Effect<Stream.Stream<RuntimeEventEnvelope>, unknown, BlockRuntimeStreamDeps> =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const database = yield* Database.Service

    const sessionIDs = new Set(bindings.filter((binding) => binding.type === "session").map((binding) => binding.id))
    const permissionBound = bindings.some((binding) => binding.type === "permission")

    let seqBase = 0
    for (const id of sessionIDs) {
      const seq = yield* EventV2.latestSequence(database.db, id)
      if (seq > seqBase) seqBase = seq
    }

    const startedAt = Date.now()
    const counter = yield* Ref.make(0)
    const lastSeq = yield* Ref.make(new Map<string, number>())

    const nextCursor = (count: number) => `${CURSOR_PREFIX}:${startedAt + count}`

    const live = (yield* EventV2.allBounded(events, 512)) as Stream.Stream<NativeEvent>

    const output = live.pipe(
      Stream.filter((event) => isRelevant(event, sessionIDs, permissionBound)),
      Stream.mapEffect((event) =>
        Effect.gen(function* () {
          const translated = translateEvent(event)
          if (Option.isNone(translated)) return Option.none()
          const aggregate = event.durable?.aggregateID
          if (aggregate && event.durable) {
            const seen = yield* Ref.get(lastSeq)
            const last = seen.get(aggregate) ?? seqBase
            if (event.durable.seq <= last) return Option.none()
            if (event.durable.seq > last + 1) {
              const count = yield* Ref.getAndUpdate(counter, (n) => n + 1)
              return Option.some(resyncEnvelope(nextCursor(count), `sequence gap on ${aggregate}`))
            }
            yield* Ref.set(lastSeq, new Map(seen).set(aggregate, event.durable.seq))
          }
          const count = yield* Ref.getAndUpdate(counter, (n) => n + 1)
          return Option.some({ ...translated.value, cursor: nextCursor(count) })
        }),
      ),
      Stream.filterMap((option) => (Option.isSome(option) ? Result.succeed(option.value) : Result.fail(undefined))),
      // Batch bursts of high-frequency part events so the transport flushes
      // at most every 50ms (or 64 events, whichever comes first).
      Stream.groupedWithin(64, "50 millis"),
      Stream.flattenIterable,
    ) as Stream.Stream<RuntimeEventEnvelope>

    // A resume cursor that points past our fresh instance position cannot be
    // replayed; the client gets an explicit resync instruction instead of a
    // silently empty stream.
    if (resume && resume !== `${CURSOR_PREFIX}:${seqBase}`) {
      const resync = Stream.make(resyncEnvelope(`${CURSOR_PREFIX}:${seqBase + 1}`, "resume cursor outside replay window"))
      return Stream.concat(resync, output)
    }
    return output
  })
