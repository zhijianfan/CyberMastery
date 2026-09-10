import { describe, expect, test } from "bun:test"
import { WorkspaceService, WorkspaceV2 } from "@opencode-ai/core/workspace"
import { WorkspaceGroup } from "@opencode-ai/protocol/groups/workspace"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { SchemaErrorMiddleware } from "@opencode-ai/protocol/middleware/schema-error"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Cause, Effect, Exit, FileSystem, Layer, Logger, Path, Scope } from "effect"
import { Etag, HttpPlatform } from "effect/unstable/http"
import { HttpApi, HttpApiTest } from "effect/unstable/httpapi"
import { makeWorkspaceHandler } from "../src/handlers/workspace"

const workspaceID = WorkspaceV2.ID.make("wrk_chat_relay_cleanup")
const relayBlock = Workspace.Block.Record.make({
  id: "relay-a",
  functionality: "builtin:chat-relay",
  transform: { x: 0, y: 0, w: 4, h: 4, z: 0 },
})
const noteBlock = Workspace.Block.Record.make({
  id: "note-a",
  functionality: "builtin:notes",
  transform: { x: 4, y: 0, w: 4, h: 4, z: 0 },
})
const relayReplacement = Workspace.Block.Record.make({
  id: relayBlock.id,
  functionality: "builtin:notes",
  transform: relayBlock.transform,
})
const tuple = Workspace.Layout.Tuple.make({ user: "default", style: "default", deviceClass: "desktop" })

function layout(revision: number, blocks: readonly Workspace.Block.Record[]) {
  return Workspace.Layout.Info.make({ id: "layout-a", workspaceID, revision, blocks: [...blocks] })
}

function fakeWorkspace(overrides: {
  getLayout?: WorkspaceService.Interface["layout"]["get"]
  saveLayout?: WorkspaceService.Interface["layout"]["save"]
  getBlock?: WorkspaceService.Interface["block"]["get"]
  remove?: WorkspaceService.Interface["remove"]
}) {
  return Layer.succeed(
    WorkspaceService.Service,
    WorkspaceService.Service.of({
      list: () => Effect.die("WorkspaceService.list not stubbed"),
      get: () => Effect.die("WorkspaceService.get not stubbed"),
      create: () => Effect.die("WorkspaceService.create not stubbed"),
      rename: () => Effect.die("WorkspaceService.rename not stubbed"),
      remove: overrides.remove ?? (() => Effect.die("WorkspaceService.remove not stubbed")),
      duplicate: () => Effect.die("WorkspaceService.duplicate not stubbed"),
      update: () => Effect.die("WorkspaceService.update not stubbed"),
      layout: {
        get: overrides.getLayout ?? (() => Effect.die("WorkspaceService.layout.get not stubbed")),
        save: overrides.saveLayout ?? (() => Effect.die("WorkspaceService.layout.save not stubbed")),
      },
      block: {
        get: overrides.getBlock ?? (() => Effect.die("WorkspaceService.block.get not stubbed")),
      },
      functionality: { list: () => Effect.die("WorkspaceService.functionality.list not stubbed") },
    }),
  )
}

function fakeBackend(calls: unknown[][], failures: { close?: number; closeWorkspace?: number } = {}) {
  const remaining = { ...failures }
  return {
    close: async (...input: [string, string, string, string?]) => {
      calls.push(["close", ...input])
      if (remaining.close) {
        remaining.close--
        throw new Error("browser unavailable")
      }
    },
    closeWorkspace: async (...input: [string, string]) => {
      calls.push(["closeWorkspace", ...input])
      if (remaining.closeWorkspace) {
        remaining.closeWorkspace--
        throw new Error("browser unavailable")
      }
    },
  }
}

const Api = HttpApi.make("server").add(WorkspaceGroup)
const client = () =>
  Effect.gen(function* () {
    const groups = yield* HttpApiTest.groups(Api, ["server.workspace"])
    return groups["server.workspace"]
  })

function testLayer(backend: ReturnType<typeof fakeBackend>, workspace: Layer.Layer<WorkspaceService.Service>) {
  return makeWorkspaceHandler(backend).pipe(
    Layer.provideMerge(workspace),
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
    Layer.provideMerge(Logger.layer([Logger.make(() => undefined)])),
  )
}

const run = <A, E, R>(
  value: Effect.Effect<A, E, R | Scope.Scope>,
  layer: Layer.Layer<never, never, never> | Layer.Layer<R, never>,
) =>
  Effect.gen(function* () {
    const exit = yield* value.pipe(
      Effect.scoped,
      Effect.provide(layer as unknown as Layer.Layer<R, never>),
      Effect.exit,
    )
    if (Exit.isFailure(exit)) {
      for (const error of Cause.prettyErrors(exit.cause)) yield* Effect.logError(error)
    }
    return yield* exit
  }).pipe(Effect.runPromise)

const provide = (layer: unknown) => layer as Layer.Layer<never, never, never>

describe("workspace ChatRelay cleanup", () => {
  test("closes a removed ChatRelay page after the saved layout confirms the block is gone", async () => {
    const calls: unknown[][] = []
    const response = await run(
      Effect.gen(function* () {
        const workspace = yield* client()
        return yield* workspace["workspace.layout.save"]({
          payload: { workspaceID, tuple, blocks: [noteBlock], expectedRevision: 1, clientID: "client-a" },
        })
      }),
      provide(
        testLayer(
          fakeBackend(calls),
          fakeWorkspace({
            getLayout: () => Effect.succeed(layout(1, [relayBlock, noteBlock])),
            saveLayout: () => Effect.succeed(layout(2, [noteBlock])),
            getBlock: () => Effect.succeed(undefined),
          }),
        ),
      ),
    )

    expect(response).toEqual({ status: "saved", layout: layout(2, [noteBlock]) })
    expect(calls).toEqual([["close", "default", workspaceID, relayBlock.id]])
  })

  test("keeps the page when the removed ChatRelay block still exists in another layout", async () => {
    const calls: unknown[][] = []
    await run(
      Effect.gen(function* () {
        const workspace = yield* client()
        yield* workspace["workspace.layout.save"]({
          payload: { workspaceID, tuple, blocks: [noteBlock], expectedRevision: 1, clientID: "client-a" },
        })
      }),
      provide(
        testLayer(
          fakeBackend(calls),
          fakeWorkspace({
            getLayout: () => Effect.succeed(layout(1, [relayBlock, noteBlock])),
            saveLayout: () => Effect.succeed(layout(2, [noteBlock])),
            getBlock: () => Effect.succeed(relayBlock),
          }),
        ),
      ),
    )

    expect(calls).toEqual([])
  })

  test("closes the page when the block ID remains but no longer belongs to ChatRelay", async () => {
    const calls: unknown[][] = []
    await run(
      Effect.gen(function* () {
        const workspace = yield* client()
        yield* workspace["workspace.layout.save"]({
          payload: { workspaceID, tuple, blocks: [relayReplacement], expectedRevision: 1, clientID: "client-a" },
        })
      }),
      provide(
        testLayer(
          fakeBackend(calls),
          fakeWorkspace({
            getLayout: () => Effect.succeed(layout(1, [relayBlock])),
            saveLayout: () => Effect.succeed(layout(2, [relayReplacement])),
            getBlock: () => Effect.succeed(relayReplacement),
          }),
        ),
      ),
    )

    expect(calls).toEqual([["close", "default", workspaceID, relayBlock.id]])
  })

  test("keeps a successful layout save successful when browser cleanup is unavailable", async () => {
    const calls: unknown[][] = []
    const response = await run(
      Effect.gen(function* () {
        const workspace = yield* client()
        return yield* workspace["workspace.layout.save"]({
          payload: { workspaceID, tuple, blocks: [noteBlock], expectedRevision: 1, clientID: "client-a" },
        })
      }),
      provide(
        testLayer(
          fakeBackend(calls, { close: Number.POSITIVE_INFINITY }),
          fakeWorkspace({
            getLayout: () => Effect.succeed(layout(1, [relayBlock, noteBlock])),
            saveLayout: () => Effect.succeed(layout(2, [noteBlock])),
            getBlock: () => Effect.succeed(undefined),
          }),
        ),
      ),
    )

    expect(response).toEqual({ status: "saved", layout: layout(2, [noteBlock]) })
    expect(calls).toHaveLength(3)
  })

  test("retries a transient page cleanup failure", async () => {
    const calls: unknown[][] = []
    await run(
      Effect.gen(function* () {
        const workspace = yield* client()
        yield* workspace["workspace.layout.save"]({
          payload: { workspaceID, tuple, blocks: [noteBlock], expectedRevision: 1, clientID: "client-a" },
        })
      }),
      provide(
        testLayer(
          fakeBackend(calls, { close: 1 }),
          fakeWorkspace({
            getLayout: () => Effect.succeed(layout(1, [relayBlock, noteBlock])),
            saveLayout: () => Effect.succeed(layout(2, [noteBlock])),
            getBlock: () => Effect.succeed(undefined),
          }),
        ),
      ),
    )

    expect(calls).toEqual([
      ["close", "default", workspaceID, relayBlock.id],
      ["close", "default", workspaceID, relayBlock.id],
    ])
  })

  test("closes every ChatRelay page after its workspace is removed", async () => {
    const calls: unknown[][] = []
    await run(
      Effect.gen(function* () {
        const workspace = yield* client()
        yield* workspace["workspace.remove"]({ params: { id: workspaceID } })
      }),
      provide(testLayer(fakeBackend(calls), fakeWorkspace({ remove: () => Effect.void }))),
    )

    expect(calls).toEqual([["closeWorkspace", "default", workspaceID]])
  })

  test("keeps a successful workspace removal successful when browser cleanup is unavailable", async () => {
    const calls: unknown[][] = []
    await expect(
      run(
        Effect.gen(function* () {
          const workspace = yield* client()
          yield* workspace["workspace.remove"]({ params: { id: workspaceID } })
        }),
        provide(
          testLayer(
            fakeBackend(calls, { closeWorkspace: Number.POSITIVE_INFINITY }),
            fakeWorkspace({ remove: () => Effect.void }),
          ),
        ),
      ),
    ).resolves.toBeUndefined()
    expect(calls).toHaveLength(3)
  })

  test("retries a transient workspace cleanup failure", async () => {
    const calls: unknown[][] = []
    await run(
      Effect.gen(function* () {
        const workspace = yield* client()
        yield* workspace["workspace.remove"]({ params: { id: workspaceID } })
      }),
      provide(testLayer(fakeBackend(calls, { closeWorkspace: 1 }), fakeWorkspace({ remove: () => Effect.void }))),
    )

    expect(calls).toEqual([
      ["closeWorkspace", "default", workspaceID],
      ["closeWorkspace", "default", workspaceID],
    ])
  })
})
