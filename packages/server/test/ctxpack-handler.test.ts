// Handler tests for the CtxPack group (Track P1, M1-reconciled wire shapes).
//
// The handler layer is exercised through the in-memory HttpApiTest client, so
// request encoding, routing, response encoding, and error decoding all run
// through the real HttpApi pipeline. The real core service tags are replaced
// with recording fakes: every endpoint must call exactly ONE service method
// with the decoded payload and an actor derived from the authenticated
// request context (requestUser) and the URL params — never raw headers or
// tokens. Unstubbed service methods die if invoked, proving no handler
// reaches beyond its single service seam (no search/permission/SQL/FTS/
// materialization logic lives in the handlers).
//
// Wire contracts (M1): create/patch payloads omit workspaceID/ctxPackID
// (they arrive in params; httpapi-codegen rejects the field collision), the
// list query is plain optional strings normalized by the handler, and the
// materialize payload carries only the non-URL fields of the frozen
// CtxPackMaterializeRequest.

import { describe, expect, it } from "bun:test"
import { Cause, Effect, Exit, FileSystem, Layer, Path, Schema, Scope } from "effect"
import { Etag, HttpPlatform } from "effect/unstable/http"
import { HttpApi, HttpApiTest } from "effect/unstable/httpapi"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import { Workspace } from "@opencode-ai/schema/workspace"
import { CtxPackGroup, CtxPackListQuery } from "@opencode-ai/protocol/groups/ctxpack"
import { CtxPackService, CtxPackMaterializer } from "@opencode-ai/core/ctxpack/index"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { SchemaErrorMiddleware } from "@opencode-ai/protocol/middleware/schema-error"
import { requestUser } from "../src/middleware/authorization"
import { CtxPackHandler } from "../src/handlers/ctxpack"

const workspaceID = Workspace.ID.make("wrk_test")
const ctxPackID = CtxPack.ID.ascending("ctxpk_test1")
const fragmentID = CtxPack.FragmentID.ascending("ctxpkf_test1")

const sampleFragmentInput: CtxPack.FragmentInput = {
  clientFragmentID: "frag-1",
  text: "some selected text",
  source: {
    workspaceID,
    blockID: "block-1",
    functionalityID: "func-1",
    kind: "message",
    direction: "sent",
    sourceTimestamp: 1000,
    capturedAt: 2000,
    entityRef: null,
    label: null,
    metadata: {},
    sensitivity: "workspace",
  },
}

// Wire payload: create (workspaceID comes from params).
const sampleCreatePayload = {
  title: "Test pack",
  keywords: ["alpha", "beta"],
  sensitivity: "workspace" as const,
  fragments: [sampleFragmentInput],
  idempotencyKey: "idem-1",
}

const sampleCreateRequest: CtxPack.CtxPackCreateRequest = {
  workspaceID,
  ...sampleCreatePayload,
}

const sampleInfo: CtxPack.Info = {
  id: ctxPackID,
  workspaceID,
  title: "Test pack",
  keywords: [],
  sensitivity: "workspace",
  revision: 1,
  contentHash: "sha256:abc",
  byteLength: 18,
  estimatedTokens: 5,
  fragments: [
    {
      id: fragmentID,
      ordinal: 0,
      contentHash: "sha256:abc",
      byteLength: 18,
      estimatedTokens: 5,
      clientFragmentID: "frag-1",
      text: "some selected text",
      source: sampleFragmentInput.source,
    },
  ],
  usage: { attachedCount: 0, lastAttachedAt: null },
  createdByUserID: "user-1",
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
}

const sampleListResult: CtxPack.CtxPackListResult = {
  items: [
    {
      id: ctxPackID,
      workspaceID,
      title: "Test pack",
      keywords: [],
      sensitivity: "workspace",
      revision: 1,
      contentHash: "sha256:abc",
      byteLength: 18,
      estimatedTokens: 5,
      fragmentCount: 1,
      sourceBlockIDs: ["block-1"],
      sourceFunctionalityIDs: ["func-1"],
      sourceKinds: ["message"],
      usage: { attachedCount: 0, lastAttachedAt: null },
      createdAt: 1000,
      updatedAt: 1000,
      deletedAt: null,
    },
  ],
  nextCursor: null,
  totalEstimate: 1,
}

const sampleMaterializeResult = {
  contextCapsuleID: "capsule_1",
  sourceCtxPackID: ctxPackID,
  label: "Capsule label",
  contentHash: "sha256:abc",
  estimatedTokens: 12,
}

const actor = { userID: "user-1", workspaceID }

// Recording fakes over the REAL core service tags: every method dies unless
// overridden, so a request that unexpectedly touches an unstubbed seam
// surfaces as a test failure.
const fakeService = (overrides: Partial<CtxPackService.CtxPackService> = {}) =>
  Layer.succeed(
    CtxPackService.Service,
    {
      create: () => Effect.die("CtxPackService.create must not be called"),
      get: () => Effect.die("CtxPackService.get must not be called"),
      list: () => Effect.die("CtxPackService.list must not be called"),
      patch: () => Effect.die("CtxPackService.patch must not be called"),
      remove: () => Effect.die("CtxPackService.remove must not be called"),
      restore: () => Effect.die("CtxPackService.restore must not be called"),
      ...overrides,
    },
  )

const fakeMaterializer = (overrides: Partial<CtxPackMaterializer.CtxPackMaterializer> = {}) =>
  Layer.succeed(
    CtxPackMaterializer.Service,
    {
      materialize: () => Effect.die("CtxPackMaterializer.materialize must not be called"),
      snapshotForSessionInput: () => Effect.die("CtxPackMaterializer.snapshotForSessionInput must not be called"),
      ...overrides,
    },
  )

const testApi = HttpApi.make("server").add(CtxPackGroup)

// Self-contained layer: the handler requires the two real core service tags;
// HttpPlatform's FileSystem requirement is wired internally, and the composed
// Api's middleware keys are passed through as no-ops (the same pattern as the
// master-agent handler tests).
const testLayer = (
  service: Layer.Layer<CtxPackService.Service, never, never>,
  materializer: Layer.Layer<CtxPackMaterializer.Service, never, never> = fakeMaterializer(),
) =>
  CtxPackHandler.pipe(
    Layer.provideMerge(service),
    Layer.provideMerge(materializer),
    Layer.provideMerge(HttpPlatform.layer.pipe(Layer.provideMerge(FileSystem.layerNoop({})))),
    Layer.provideMerge(Path.layer),
    Layer.provideMerge(Etag.layer),
    Layer.provideMerge(
      Layer.succeed(
        Authorization,
        Authorization.of((effect) => effect),
      ),
    ),
    Layer.provideMerge(
      Layer.succeed(
        SchemaErrorMiddleware,
        SchemaErrorMiddleware.of((effect) => effect),
      ),
    ),
  )

const groupClient = () =>
  Effect.gen(function* () {
    const client = yield* HttpApiTest.groups(testApi, ["server.workspace.ctxpack"])
    return client["server.workspace.ctxpack"]
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

const runAsUser = <A, E, R>(
  value: Effect.Effect<A, E, R | Scope.Scope>,
  layer: Layer.Layer<R, never>,
  userID = "user-1",
) => run(value.pipe(Effect.provideService(requestUser, { id: userID })), layer)

describe("workspace.ctxpack handlers", () => {
  it("create calls service.create once with the actor and params-merged payload", async () => {
    const calls: Array<{ actor: { userID: string; workspaceID: string }; request: unknown }> = []
    await runAsUser(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.ctxpack.create"]({ params: { workspaceID }, payload: sampleCreatePayload })
      }),
      testLayer(
        fakeService({
          create: (a, request) => {
            calls.push({ actor: a, request })
            return Effect.succeed(sampleInfo)
          },
        }),
      ),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.actor).toEqual(actor)
    expect(calls[0]?.request).toEqual(sampleCreateRequest)
  })

  it("get calls service.get once with includeDeleted=false", async () => {
    const calls: Array<{ actor: { userID: string; workspaceID: string }; ctxPackID: string; includeDeleted?: boolean }> =
      []
    const result = await runAsUser(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.ctxpack.get"]({ params: { workspaceID, ctxPackID } })
      }),
      testLayer(
        fakeService({
          get: (a, id, includeDeleted) => {
            calls.push({ actor: a, ctxPackID: id, includeDeleted })
            return Effect.succeed(sampleInfo)
          },
        }),
      ),
    )
    expect(result).toEqual(sampleInfo)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.actor).toEqual(actor)
    expect(calls[0]?.ctxPackID).toBe(ctxPackID)
    expect(calls[0]?.includeDeleted).toBe(false)
  })

  it("list normalizes an absent wire query to the frozen defaults", async () => {
    const calls: Array<{ actor: { userID: string; workspaceID: string }; request: unknown }> = []
    const defaults = {
      workspaceID,
      query: "",
      keyword: null,
      sourceBlockID: null,
      sourceFunctionalityID: null,
      sourceKind: null,
      sensitivity: null,
      createdAfter: null,
      createdBefore: null,
      includeDeleted: false,
      sort: "created-desc",
      cursor: null,
      limit: 30,
    }
    const result = await runAsUser(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.ctxpack.list"]({
          params: { workspaceID },
          query: {} as Schema.Schema.Type<typeof CtxPackListQuery>,
        })
      }),
      testLayer(
        fakeService({
          list: (a, request) => {
            calls.push({ actor: a, request })
            return Effect.succeed(sampleListResult)
          },
        }),
      ),
    )
    expect(result).toEqual(sampleListResult)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.actor).toEqual(actor)
    expect(calls[0]?.request).toEqual(defaults)
  })

  it("list normalizes provided string query fields", async () => {
    const calls: Array<unknown> = []
    await runAsUser(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.ctxpack.list"]({
          params: { workspaceID },
          query: {
            query: "needle",
            keyword: "k",
            sourceBlockID: "block-1",
            sourceFunctionalityID: "func-1",
            sourceKind: "message",
            sensitivity: "workspace",
            createdAfter: "1000",
            createdBefore: "2000",
            includeDeleted: "true",
            sort: "tokens-desc",
            cursor: "e30",
            limit: "25",
          },
        })
      }),
      testLayer(
        fakeService({
          list: (_a, request) => {
            calls.push(request)
            return Effect.succeed(sampleListResult)
          },
        }),
      ),
    )
    expect(calls).toEqual([
      {
        workspaceID,
        query: "needle",
        keyword: "k",
        sourceBlockID: "block-1",
        sourceFunctionalityID: "func-1",
        sourceKind: "message",
        sensitivity: "workspace",
        createdAfter: 1000,
        createdBefore: 2000,
        includeDeleted: true,
        sort: "tokens-desc",
        cursor: "e30",
        limit: 25,
      },
    ])
  })

  it("list rejects a malformed limit with the typed 400 error", async () => {
    const error = await runAsUser(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.ctxpack.list"]({
          params: { workspaceID },
          query: { limit: "not-a-number" } as Schema.Schema.Type<typeof CtxPackListQuery>,
        }).pipe(Effect.flip)
      }),
      testLayer(fakeService()),
    )
    expect(error._tag).toBe("CtxPackInvalidSelectionError")
  })

  it("patch calls service.patch once with params-merged payload", async () => {
    const calls: Array<{ actor: { userID: string; workspaceID: string }; request: unknown }> = []
    await runAsUser(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.ctxpack.patch"]({
          params: { workspaceID, ctxPackID },
          payload: { expectedRevision: 1, patch: { title: "Renamed pack" }, idempotencyKey: "idem-2" },
        })
      }),
      testLayer(
        fakeService({
          patch: (a, request) => {
            calls.push({ actor: a, request })
            return Effect.succeed(sampleInfo)
          },
        }),
      ),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.actor).toEqual(actor)
    expect(calls[0]?.request).toEqual({
      workspaceID,
      ctxPackID,
      expectedRevision: 1,
      patch: { title: "Renamed pack" },
      idempotencyKey: "idem-2",
    })
  })

  it("remove calls service.remove once with ctxPackID and expectedRevision", async () => {
    const calls: Array<{
      actor: { userID: string; workspaceID: string }
      input: { ctxPackID: string; expectedRevision: number }
    }> = []
    const result = await runAsUser(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.ctxpack.remove"]({
          params: { workspaceID, ctxPackID },
          payload: { expectedRevision: 2 },
        })
      }),
      testLayer(
        fakeService({
          remove: (a, input) => {
            calls.push({ actor: a, input })
            return Effect.succeed(sampleInfo)
          },
        }),
      ),
    )
    expect(result).toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.actor).toEqual(actor)
    expect(calls[0]?.input).toEqual({ ctxPackID, expectedRevision: 2 })
  })

  it("restore calls service.restore once with ctxPackID and expectedRevision", async () => {
    const calls: Array<{
      actor: { userID: string; workspaceID: string }
      input: { ctxPackID: string; expectedRevision: number }
    }> = []
    await runAsUser(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.ctxpack.restore"]({
          params: { workspaceID, ctxPackID },
          payload: { expectedRevision: 1 },
        })
      }),
      testLayer(
        fakeService({
          restore: (a, input) => {
            calls.push({ actor: a, input })
            return Effect.succeed(sampleInfo)
          },
        }),
      ),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.actor).toEqual(actor)
    expect(calls[0]?.input).toEqual({ ctxPackID, expectedRevision: 1 })
  })

  it("materialize calls the materializer once with the params-merged frozen request", async () => {
    const calls: Array<{ actor: { userID: string; workspaceID: string }; request: unknown }> = []
    const payload = {
      expectedContentHash: "sha256:abc",
      targetInstanceID: "chat-instance:1",
      targetFunctionalityID: "builtin:chat",
    }
    const result = await runAsUser(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.ctxpack.materialize"]({ params: { workspaceID, ctxPackID }, payload })
      }),
      testLayer(
        fakeService(), // every pack-service method dies if touched
        fakeMaterializer({
          materialize: (a, request) => {
            calls.push({ actor: a, request })
            return Effect.succeed(sampleMaterializeResult)
          },
        }),
      ),
    )
    expect(result).toEqual(sampleMaterializeResult)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.actor).toEqual(actor)
    expect(calls[0]?.request).toEqual({ workspaceID, ctxPackID, ...payload })
  })

  it("derives the userID from the authenticated request context", async () => {
    const users: string[] = []
    await runAsUser(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.ctxpack.get"]({ params: { workspaceID, ctxPackID } })
      }),
      testLayer(
        fakeService({
          get: (a) => {
            users.push(a.userID)
            return Effect.succeed(sampleInfo)
          },
        }),
      ),
      "alice",
    )
    expect(users).toEqual(["alice"])
  })

  it("maps a revision-conflict domain error to the 409 protocol error", async () => {
    const error = await runAsUser(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.ctxpack.patch"]({
          params: { workspaceID, ctxPackID },
          payload: { expectedRevision: 1, patch: { title: "Renamed pack" }, idempotencyKey: "idem-2" },
        }).pipe(Effect.flip)
      }),
      testLayer(
        fakeService({
          patch: () => Effect.fail({ _tag: "CtxPackRevisionConflict", currentRevision: 3 }),
        }),
      ),
    )
    expect(error._tag).toBe("CtxPackRevisionConflictError")
    if (error._tag !== "CtxPackRevisionConflictError") throw new Error("unreachable")
    expect(error.currentRevision).toBe(3)
  })

  it("maps a not-found domain error to the 404 protocol error", async () => {
    const error = await runAsUser(
      Effect.gen(function* () {
        const group = yield* groupClient()
        return yield* group["workspace.ctxpack.get"]({ params: { workspaceID, ctxPackID } }).pipe(Effect.flip)
      }),
      testLayer(
        fakeService({
          get: () => Effect.fail({ _tag: "CtxPackNotFound", ctxPackID }),
        }),
      ),
    )
    expect(error._tag).toBe("CtxPackNotFoundError")
    if (error._tag !== "CtxPackNotFoundError") throw new Error("unreachable")
    expect(error.ctxPackID).toBe(ctxPackID)
  })
})
