import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionV2 } from "@opencode-ai/core/session"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { RuntimeEventEnvelope, type RuntimeResourceBinding } from "@opencode-ai/protocol/groups/block-runtime"
import { Effect, Schema, Stream } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import * as Sse from "effect/unstable/encoding/Sse"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { blockRuntimeStream } from "../runtime/block-runtime-gateway"
import { resourceSnapshot } from "../runtime/resource-snapshot"

const toInvalidRequest = (error: unknown) => new InvalidRequestError({ message: String(error) })

function eventData(data: RuntimeEventEnvelope): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(Schema.encodeUnknownSync(RuntimeEventEnvelope)(data)),
  }
}

// SSE query params: bindings as either a URL-encoded JSON array (manual
// clients) or the generated SDK's nested `bindings[0][type]=...` encoding.
// cursor = optional resume cursor. Malformed input degrades to an empty
// binding set (stream stays open and valid) rather than crashing the route.
function parseSubscriptionQuery(url: string): { bindings: RuntimeResourceBinding[]; cursor?: string } {
  try {
    const params = new URL(url, "http://localhost").searchParams
    const raw = params.get("bindings")
    const bindings = raw ? (JSON.parse(raw) as RuntimeResourceBinding[]) : parseNestedBindings(params)
    const cursor = params.get("cursor") ?? undefined
    return { bindings, cursor }
  } catch {
    return { bindings: [] }
  }
}

// Reconstructs [{type, id, parentID?}] from `bindings[0][type]=session`-style
// query entries produced by the generated SDK's appendQuery.
function parseNestedBindings(params: URLSearchParams): RuntimeResourceBinding[] {
  const groups = new Map<number, Record<string, string>>()
  for (const [key, value] of params) {
    const match = /^bindings\[(\d+)\]\[(\w+)\]$/.exec(key)
    if (!match) continue
    const index = Number(match[1])
    const field = match[2]
    const group = groups.get(index) ?? {}
    group[field] = value
    groups.set(index, group)
  }
  return [...groups.values()].flatMap((group) => {
    if (typeof group.type !== "string" || typeof group.id !== "string") return []
    return [
      {
        type: group.type as RuntimeResourceBinding["type"],
        id: group.id,
        ...(group.parentID ? { parentID: group.parentID } : {}),
      } as RuntimeResourceBinding,
    ]
  })
}

// Global services (EventV2, Database, SessionV2, Credential) are resolved once
// at group-build time and captured — the same pattern as handlers/event.ts.
// Location-scoped services (permissions) stay inside the endpoint callbacks
// where the location middleware provides them per request.
export const BlockRuntimeHandler = HttpApiBuilder.group(Api, "server.blockRuntime", (handlers) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const database = yield* Database.Service
    const sessions = yield* SessionV2.Service
    const credentials = yield* Credential.Service
    return handlers
      .handle("block-runtime.snapshot", ({ payload }) =>
        resourceSnapshot(payload.bindings).pipe(
          Effect.provideService(EventV2.Service, events),
          Effect.provideService(Database.Service, database),
          Effect.provideService(SessionV2.Service, sessions),
          Effect.provideService(Credential.Service, credentials),
          Effect.mapError(toInvalidRequest),
        ),
      )
      .handleRaw("block-runtime.subscribe", (ctx) =>
        Effect.gen(function* () {
          const { bindings, cursor } = parseSubscriptionQuery(ctx.request.url)
          const stream = yield* blockRuntimeStream(bindings, cursor).pipe(
            Effect.provideService(EventV2.Service, events),
            Effect.provideService(Database.Service, database),
          )
          const output = stream.pipe(Stream.map(eventData), Stream.pipeThroughChannel(Sse.encode()))
          const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
          return HttpServerResponse.stream(
            output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText),
            {
              contentType: "text/event-stream",
              headers: {
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
                "X-Content-Type-Options": "nosniff",
              },
            },
          )
        }).pipe(Effect.mapError(toInvalidRequest)),
      )
  }),
)
