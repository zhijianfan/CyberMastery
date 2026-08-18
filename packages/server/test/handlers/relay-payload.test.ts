// Handler tests for the ChatRelay payload endpoints (relay.payload.list and
// relay.payload.markImportant) through the in-memory HttpApiTest client.
//
// The real ChatRelayPayload service runs against the real test Database, so
// seeding happens directly through the service interface; relay.submit needs a
// live authenticated chat account and is intentionally not exercised.
// RelayError is declared with httpApiStatus 400, so the unknown-payload case
// surfaces as a decoded RelayError failure from the client.

import { describe, expect, it } from "bun:test"
import { Cause, Effect, Exit, FileSystem, Layer, Path, Scope } from "effect"
import { Etag, HttpPlatform } from "effect/unstable/http"
import { HttpApi, HttpApiTest } from "effect/unstable/httpapi"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { ChatRelayPayload } from "@opencode-ai/core/workspace/chat-relay-payload"
import { RelayError, RelayGroup } from "@opencode-ai/protocol/groups/relay"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { SchemaErrorMiddleware } from "@opencode-ai/protocol/middleware/schema-error"
import { RelayHandler } from "../../src/handlers/relay"

// Workspace ids must start with "wrk" (the WorkspaceID schema check runs when
// the client encodes path params). Payload rows reference the workspace table
// (chat_relay_payload.workspace_id -> workspace_v2.id), so each test creates a
// real workspace through WorkspaceService and seeds against its id; a fresh
// id per test keeps the shared test database file free of cross-test rows and
// per-workspace seq indexes deterministic.
const createWorkspace = () =>
  Effect.gen(function* () {
    const workspaces = yield* WorkspaceService.Service
    const info = yield* workspaces.create({ name: "relay-payload-test" })
    return info.id
  })

// The real ChatRelayPayload service over the real test Database.
const payloadStack = () =>
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, WorkspaceService.node, ChatRelayPayload.node]),
  )

const testApi = HttpApi.make("server").add(RelayGroup)

const relayLayer = () =>
  RelayHandler.pipe(
    Layer.provideMerge(payloadStack()),
    Layer.provideMerge(HttpPlatform.layer.pipe(Layer.provideMerge(FileSystem.layerNoop({})))),
    Layer.provideMerge(Path.layer),
    Layer.provideMerge(Etag.layer),
    // The handler group is built against the P3-composed server Api, so its
    // layer carries the Api-level middleware keys; pass them through no-op.
    Layer.provideMerge(Layer.succeed(Authorization, Authorization.of((effect) => effect))),
    Layer.provideMerge(Layer.succeed(SchemaErrorMiddleware, SchemaErrorMiddleware.of((effect) => effect))),
  )

const relayClient = () =>
  Effect.gen(function* () {
    const client = yield* HttpApiTest.groups(testApi, ["server.relay"])
    return client["server.relay"]
  })

const run = <A, E, R>(value: Effect.Effect<A, E, R | Scope.Scope>, layer: Layer.Layer<R, never>) =>
  Effect.gen(function* () {
    const exit = yield* value.pipe(Effect.scoped, Effect.provide(layer), Effect.exit)
    if (Exit.isFailure(exit)) {
      for (const err of Cause.prettyErrors(exit.cause)) {
        yield* Effect.logError(err)
      }
    }
    return yield* exit
  }).pipe(Effect.runPromise)

describe("relay payload handlers", () => {
  it("lists no payloads for a fresh workspace", async () => {
    const result = await run(
      Effect.gen(function* () {
        const workspaceID = yield* createWorkspace()
        const relay = yield* relayClient()
        return yield* relay["relay.payload.list"]({ params: { workspaceID } })
      }),
      relayLayer(),
    )
    expect(result).toEqual([])
  })

  it("lists seeded payloads newest first with index and timestamps populated", async () => {
    const result = await run(
      Effect.gen(function* () {
        const workspaceID = yield* createWorkspace()
        const store = yield* ChatRelayPayload.Service
        const first = yield* store.append({
          workspaceID,
          conversationId: "conv-1",
          text: "first reply",
          files: [{ name: "diagram.png", url: "https://example.com/diagram.png" }],
        })
        const second = yield* store.append({
          workspaceID,
          conversationId: "conv-2",
          text: "second reply",
          files: [],
        })
        const relay = yield* relayClient()
        const payloads = yield* relay["relay.payload.list"]({ params: { workspaceID } })
        return { first, second, payloads }
      }),
      relayLayer(),
    )
    expect(result.payloads).toHaveLength(2)
    const [newest, oldest] = result.payloads
    expect(newest?.id).toBe(result.second.id)
    expect(newest?.index).toBe(2)
    expect(newest?.important).toBe(false)
    expect(newest?.timeCreated).toBe(result.second.timeCreated)
    expect(newest?.conversationId).toBe("conv-2")
    expect(newest?.text).toBe("second reply")
    expect(newest?.files).toEqual([])
    expect(oldest?.id).toBe(result.first.id)
    expect(oldest?.index).toBe(1)
    expect(oldest?.important).toBe(false)
    expect(oldest?.timeCreated).toBe(result.first.timeCreated)
    expect(oldest?.conversationId).toBe("conv-1")
    expect(oldest?.text).toBe("first reply")
    expect(oldest?.files).toEqual([{ name: "diagram.png", url: "https://example.com/diagram.png" }])
  })

  it("marks a seeded payload important through HTTP and the list reflects it", async () => {
    const result = await run(
      Effect.gen(function* () {
        const workspaceID = yield* createWorkspace()
        const store = yield* ChatRelayPayload.Service
        const seeded = yield* store.append({
          workspaceID,
          conversationId: "conv-1",
          text: "hello",
          files: [],
        })
        const relay = yield* relayClient()
        const updated = yield* relay["relay.payload.markImportant"]({
          params: { workspaceID, payloadID: seeded.id },
          payload: { important: true },
        })
        const payloads = yield* relay["relay.payload.list"]({ params: { workspaceID } })
        return { seeded, updated, payloads }
      }),
      relayLayer(),
    )
    expect(result.updated.id).toBe(result.seeded.id)
    expect(result.updated.important).toBe(true)
    expect(result.updated.index).toBe(result.seeded.index)
    expect(result.updated.timeCreated).toBe(result.seeded.timeCreated)
    const [listed] = result.payloads
    expect(listed?.id).toBe(result.seeded.id)
    expect(listed?.important).toBe(true)
  })

  it("returns a RelayError for markImportant on an unknown payload id", async () => {
    const error = await run(
      Effect.gen(function* () {
        const workspaceID = yield* createWorkspace()
        const relay = yield* relayClient()
        return yield* relay["relay.payload.markImportant"]({
          params: { workspaceID, payloadID: "missing-payload" },
          payload: { important: true },
        }).pipe(Effect.flip)
      }),
      relayLayer(),
    )
    // The client failure channel also carries HttpClientError/SchemaError, so
    // narrow to the declared endpoint error before reading its fields.
    if (!(error instanceof RelayError)) throw new Error("expected a RelayError")
    expect(error.name).toBe("RelayError")
    expect(error.data.message).toContain("payload not found: missing-payload")
  })
})
