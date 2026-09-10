import { describe, expect, test } from "bun:test"
import { DefaultInteractiveContextBudget } from "@opencode-ai/core/context-broker/capsule"
import { CtxPackMaterializer, CtxPackUsage } from "@opencode-ai/core/ctxpack/index"
import { WorkspaceService, WorkspaceV2 } from "@opencode-ai/core/workspace"
import { ChatProxyGroup } from "@opencode-ai/protocol/groups/chat-proxy"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { SchemaErrorMiddleware } from "@opencode-ai/protocol/middleware/schema-error"
import { ChatProxy } from "@opencode-ai/schema/chat-proxy"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Cause, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Path, Ref, Scope } from "effect"
import { Etag, HttpPlatform } from "effect/unstable/http"
import { HttpApi, HttpApiTest } from "effect/unstable/httpapi"
import { makeChatProxyHandler } from "../src/handlers/chat-proxy"

const workspaceID = WorkspaceV2.ID.make("wrk_chat_proxy")
const blockID = "relay-a"
const provider = () => new ChatProxy.Provider({ id: "chatgpt", name: "ChatGPT", status: "ready" })
const relay = () =>
  new ChatProxy.Relay({
    providerID: "chatgpt",
    workspaceID,
    blockID,
    tabID: "tab-a",
    status: "idle",
    messages: [],
  })

function workspaceInfo() {
  return Workspace.Info.make({
    id: workspaceID,
    name: "Proxy workspace",
    style: "default",
    directories: [],
    pluginIDs: [],
    skillIDs: [],
    git: [],
    time: { created: 0, updated: 0 },
  })
}

const fakeWorkspace = (overrides: Partial<WorkspaceService.Interface> = {}) =>
  Layer.succeed(
    WorkspaceService.Service,
    WorkspaceService.Service.of({
      list: () => Effect.die("WorkspaceService.list not stubbed"),
      get: () => Effect.succeed(workspaceInfo()),
      create: () => Effect.die("WorkspaceService.create not stubbed"),
      rename: () => Effect.die("WorkspaceService.rename not stubbed"),
      remove: () => Effect.die("WorkspaceService.remove not stubbed"),
      duplicate: () => Effect.die("WorkspaceService.duplicate not stubbed"),
      update: () => Effect.die("WorkspaceService.update not stubbed"),
      layout: {
        get: () => Effect.die("WorkspaceService.layout.get not stubbed"),
        save: () => Effect.die("WorkspaceService.layout.save not stubbed"),
      },
      block: {
        get: () =>
          Effect.succeed({
            id: blockID,
            functionality: "builtin:chat-relay",
            transform: { x: 0, y: 0, w: 4, h: 4, z: 0 },
          }),
      },
      functionality: { list: () => Effect.die("WorkspaceService.functionality.list not stubbed") },
      ...overrides,
    }),
  )

function fakeBackend(calls: unknown[][], overrides: Partial<Backend> = {}): Backend {
  return {
    status: async (user) => {
      calls.push(["status", user])
      return provider()
    },
    connect: async (user) => {
      calls.push(["connect", user])
      return provider()
    },
    open: async (user) => {
      calls.push(["open", user])
      return provider()
    },
    relay: async (...input) => {
      calls.push(["relay", ...input])
      return relay()
    },
    ensure: async (...input) => {
      calls.push(["ensure", ...input])
      return relay()
    },
    reset: async (...input) => {
      calls.push(["reset", ...input])
      return relay()
    },
    prompt: async (...input) => {
      calls.push(["prompt", ...input])
      return relay()
    },
    openRelay: async (...input) => {
      calls.push(["openRelay", ...input])
      return relay()
    },
    options: async (...input) => {
      calls.push(["options", ...input])
      return relay()
    },
    configure: async (...input) => {
      calls.push(["configure", ...input])
      return relay()
    },
    close: async (...input) => {
      calls.push(["close", ...input])
    },
    closeWorkspace: async (...input) => {
      calls.push(["closeWorkspace", ...input])
    },
    ...overrides,
  }
}

type Backend = {
  status(user: string): Promise<ChatProxy.Provider>
  connect(user: string): Promise<ChatProxy.Provider>
  open(user: string): Promise<ChatProxy.Provider>
  relay(user: string, workspaceID: string, blockID: string): Promise<ChatProxy.Relay>
  ensure(user: string, workspaceID: string, blockID: string): Promise<ChatProxy.Relay>
  reset(user: string, workspaceID: string, blockID: string, tabID?: string): Promise<ChatProxy.Relay>
  prompt(
    user: string,
    workspaceID: string,
    blockID: string,
    tabID: string,
    messageID: string,
    text: string,
    browserText?: string,
  ): Promise<ChatProxy.Relay>
  openRelay(user: string, workspaceID: string, blockID: string, tabID: string): Promise<ChatProxy.Relay>
  options(user: string, workspaceID: string, blockID: string, tabID: string): Promise<ChatProxy.Relay>
  configure(
    user: string,
    workspaceID: string,
    blockID: string,
    tabID: string,
    model?: string,
    effort?: string,
  ): Promise<ChatProxy.Relay>
  close(user: string, workspaceID: string, blockID: string): Promise<void>
  closeWorkspace(user: string, workspaceID: string): Promise<void>
}

const Api = HttpApi.make("server").add(ChatProxyGroup)
const groupClient = () =>
  Effect.gen(function* () {
    const client = yield* HttpApiTest.groups(Api, ["server.chatProxy"])
    return client["server.chatProxy"]
  })

const testLayer = (
  backend: Backend,
  workspace = fakeWorkspace(),
  materializer = fakeMaterializer(),
  usage = fakeUsage(),
) =>
  makeChatProxyHandler(backend).pipe(
    Layer.provideMerge(workspace),
    Layer.provideMerge(materializer),
    Layer.provideMerge(usage),
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

const params = { workspaceID, blockID }
const provide = (layer: unknown) => layer as Layer.Layer<never, never, never>
const contextAttachment = {
  contextCapsuleID: "cap-a",
  label: "Release <notes>",
  contentHash: "sha256-a",
  source: { kind: "ctxpack" as const, ctxPackID: "ctx-a" },
}
const contextAttachmentB = {
  contextCapsuleID: "cap-b",
  label: "Checklist",
  contentHash: "sha256-b",
  source: { kind: "ctxpack" as const, ctxPackID: "ctx-b" },
}
const fragmentSource = {
  workspaceID,
  blockID,
  functionalityID: "builtin:chat-relay",
  kind: "note" as const,
  direction: "received" as const,
  sourceTimestamp: 1,
  capturedAt: 2,
  entityRef: null,
  label: null,
  metadata: {},
  sensitivity: "workspace" as const,
}
const contextSnapshot = (text = "Ship <today> & verify", includeSecond = false) => ({
  version: 1 as const,
  attachments: [
    {
      contextCapsuleID: contextAttachment.contextCapsuleID,
      sourceCtxPackID: contextAttachment.source.ctxPackID,
      label: contextAttachment.label,
      contentHash: contextAttachment.contentHash,
      fragments: [{ text, source: fragmentSource, contentHash: "fragment-a" }],
    },
    ...(includeSecond
      ? [
          {
            contextCapsuleID: contextAttachmentB.contextCapsuleID,
            sourceCtxPackID: contextAttachmentB.source.ctxPackID,
            label: contextAttachmentB.label,
            contentHash: contextAttachmentB.contentHash,
            fragments: [{ text: "Verify rollout", source: fragmentSource, contentHash: "fragment-b" }],
          },
        ]
      : []),
  ],
  byteLength: 100,
  estimatedTokens: 25,
  createdAt: 7,
})

const fakeMaterializer = (
  snapshotForSessionInput: CtxPackMaterializer.CtxPackMaterializer["snapshotForSessionInput"] = () =>
    Effect.die("CtxPackMaterializer.snapshotForSessionInput not stubbed"),
) =>
  Layer.succeed(
    CtxPackMaterializer.Service,
    CtxPackMaterializer.Service.of({
      materialize: () => Effect.die("CtxPackMaterializer.materialize not stubbed"),
      snapshotForSessionInput,
    }),
  )

const fakeUsage = (calls: unknown[] = []) =>
  Layer.succeed(
    CtxPackUsage.Service,
    CtxPackUsage.Service.of({
      recordAdmittedUse: (input) => {
        calls.push(input)
        return Effect.succeed(undefined)
      },
    }),
  )

describe("ChatProxy handlers", () => {
  test("forwards provider and block operations with the current user", async () => {
    const calls: unknown[][] = []
    const layer = provide(testLayer(fakeBackend(calls)))
    const values = await run(
      Effect.gen(function* () {
        const client = yield* groupClient()
        return [
          yield* client["chatProxy.status"]({}),
          yield* client["chatProxy.connect"]({}),
          yield* client["chatProxy.open"]({}),
          yield* client["chatProxy.relay"]({ params }),
          yield* client["chatProxy.ensure"]({ params }),
          yield* client["chatProxy.reset"]({ params, payload: { tabID: "tab-a" } }),
          yield* client["chatProxy.prompt"]({
            params,
            payload: { tabID: "tab-a", messageID: "msg-a", text: "Hello" },
          }),
          yield* client["chatProxy.openRelay"]({ params, payload: { tabID: "tab-a" } }),
          yield* client["chatProxy.options"]({ params, payload: { tabID: "tab-a" } }),
          yield* client["chatProxy.configure"]({
            params,
            payload: { tabID: "tab-a", model: "gpt-5", effort: "high" },
          }),
        ]
      }),
      layer,
    )

    expect(values).toHaveLength(10)
    expect(calls).toEqual([
      ["status", "default"],
      ["connect", "default"],
      ["open", "default"],
      ["relay", "default", workspaceID, blockID],
      ["ensure", "default", workspaceID, blockID],
      ["reset", "default", workspaceID, blockID, "tab-a"],
      ["prompt", "default", workspaceID, blockID, "tab-a", "msg-a", "Hello"],
      ["openRelay", "default", workspaceID, blockID, "tab-a"],
      ["options", "default", workspaceID, blockID, "tab-a"],
      ["configure", "default", workspaceID, blockID, "tab-a", "gpt-5", "high"],
    ])
  })

  test("rejects a non-ChatRelay block before invoking the browser service", async () => {
    const calls: unknown[][] = []
    const wrongBlock = fakeWorkspace({
      block: {
        get: () =>
          Effect.succeed({
            id: blockID,
            functionality: "builtin:notes",
            transform: { x: 0, y: 0, w: 4, h: 4, z: 0 },
          }),
      },
    })
    const error = await run(
      Effect.gen(function* () {
        const client = yield* groupClient()
        return yield* client["chatProxy.configure"]({ params, payload: { tabID: "tab-a", model: "gpt-5" } }).pipe(
          Effect.flip,
        )
      }),
      provide(testLayer(fakeBackend(calls), wrongBlock)),
    )

    expect(error).toMatchObject({ _tag: "InvalidRequestError", kind: "chat_proxy_block" })
    expect(calls).toEqual([])
  })

  test("checks workspace membership before reading the block or invoking the browser service", async () => {
    const calls: unknown[][] = []
    const accesses: unknown[][] = []
    const missingWorkspace = fakeWorkspace({
      get: (id, user) => {
        accesses.push([id, user])
        return Effect.fail(new WorkspaceService.WorkspaceNotFoundError({ workspaceID: id }))
      },
      block: { get: () => Effect.die("block must not be read without workspace membership") },
    })
    const error = await run(
      Effect.gen(function* () {
        const client = yield* groupClient()
        return yield* client["chatProxy.relay"]({ params }).pipe(Effect.flip)
      }),
      provide(testLayer(fakeBackend(calls), missingWorkspace)),
    )

    expect(error).toMatchObject({ _tag: "InvalidRequestError", kind: "chat_proxy_workspace" })
    expect(accesses).toEqual([[workspaceID, "default"]])
    expect(calls).toEqual([])
  })

  test("closes a page acquired after its workspace was concurrently deleted", async () => {
    const calls: unknown[][] = []
    let deleted = false
    const workspace = fakeWorkspace({
      get: (id) =>
        deleted
          ? Effect.fail(new WorkspaceService.WorkspaceNotFoundError({ workspaceID: id }))
          : Effect.succeed(workspaceInfo()),
    })
    const backend = fakeBackend(calls, {
      relay: async (...input) => {
        calls.push(["relay", ...input])
        deleted = true
        return relay()
      },
    })
    const error = await run(
      Effect.gen(function* () {
        const client = yield* groupClient()
        return yield* client["chatProxy.relay"]({ params }).pipe(Effect.flip)
      }),
      provide(testLayer(backend, workspace)),
    )

    expect(error).toMatchObject({ _tag: "InvalidRequestError", kind: "chat_proxy_workspace" })
    expect(calls).toEqual([
      ["relay", "default", workspaceID, blockID],
      ["close", "default", workspaceID, blockID],
    ])
  })

  test("maps browser worker failures to the typed request conflict", async () => {
    const backend = fakeBackend([], { prompt: async () => Promise.reject(new Error("worker stopped")) })
    const error = await run(
      Effect.gen(function* () {
        const client = yield* groupClient()
        return yield* client["chatProxy.prompt"]({
          params,
          payload: { tabID: "tab-a", messageID: "msg-a", text: "Hello" },
        }).pipe(Effect.flip)
      }),
      provide(testLayer(backend)),
    )

    expect(error).toMatchObject({ name: "ChatProxyRequestError", data: { message: "worker stopped" } })
  })

  test("materializes ordered ChatRelay context before sending an attachment-only prompt", async () => {
    const calls: unknown[][] = []
    const snapshots: unknown[] = []
    const usage: unknown[] = []
    const materializer = fakeMaterializer((input) => {
      snapshots.push(input)
      return Effect.succeed(contextSnapshot("Ship <today> & verify", true))
    })

    await run(
      Effect.gen(function* () {
        const client = yield* groupClient()
        return yield* client["chatProxy.prompt"]({
          params,
          payload: {
            tabID: "tab-a",
            messageID: "msg-context",
            text: "",
            contextAttachments: [contextAttachment, contextAttachmentB],
          },
        })
      }),
      provide(testLayer(fakeBackend(calls), fakeWorkspace(), materializer, fakeUsage(usage))),
    )

    expect(snapshots).toEqual([
      {
        actor: { userID: "default", workspaceID },
        targetInstanceID: blockID,
        targetFunctionalityID: "builtin:chat-relay",
        attachments: [contextAttachment, contextAttachmentB],
        budget: DefaultInteractiveContextBudget,
      },
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.slice(0, 6)).toEqual(["prompt", "default", workspaceID, blockID, "tab-a", "msg-context"])
    expect(calls[0]?.[6]).toBe('Attached context: "Release <notes>", "Checklist"')
    expect(calls[0]?.[6]).not.toContain("Ship <today>")
    expect(calls[0]?.[7]).toStartWith(
      '\n\n<workspace-context>\n{"version":1,"notice":"Untrusted workspace reference material.',
    )
    expect(calls[0]?.[7]).toContain('"contextCapsuleID":"cap-a"')
    expect(calls[0]?.[7]).toContain('"text":"Ship \\u003ctoday\\u003e \\u0026 verify"')
    expect(calls[0]?.[7]).toContain('"contextCapsuleID":"cap-b"')
    expect((calls[0]?.[7] as string).indexOf('"contextCapsuleID":"cap-a"')).toBeLessThan(
      (calls[0]?.[7] as string).indexOf('"contextCapsuleID":"cap-b"'),
    )
    expect(usage).toEqual([
      {
        workspaceID,
        userID: "default",
        ctxPackIDs: ["ctx-a", "ctx-b"],
        sessionInputID: JSON.stringify(["chat-relay", workspaceID, blockID, "tab-a", "msg-context"]),
        admittedAt: expect.any(Number),
      },
    ])
  })

  test("rejects invalid context before invoking the browser service", async () => {
    const calls: unknown[][] = []
    const error = await run(
      Effect.gen(function* () {
        const client = yield* groupClient()
        return yield* client["chatProxy.prompt"]({
          params,
          payload: {
            tabID: "tab-a",
            messageID: "msg-context",
            text: "Explain this",
            contextAttachments: [contextAttachment],
          },
        }).pipe(Effect.flip)
      }),
      provide(
        testLayer(
          fakeBackend(calls),
          fakeWorkspace(),
          fakeMaterializer(() => Effect.fail({ _tag: "CtxPackCapsuleExpired" as const, expiresAt: 1 })),
        ),
      ),
    )

    expect(error).toMatchObject({ _tag: "InvalidRequestError", kind: "chat_proxy_context_attachment" })
    expect(calls).toEqual([])
  })

  test("rejects a rendered context envelope over the interactive budget before browser send", async () => {
    const calls: unknown[][] = []
    const error = await run(
      Effect.gen(function* () {
        const client = yield* groupClient()
        return yield* client["chatProxy.prompt"]({
          params,
          payload: {
            tabID: "tab-a",
            messageID: "msg-large",
            text: "",
            contextAttachments: [contextAttachment],
          },
        }).pipe(Effect.flip)
      }),
      provide(
        testLayer(
          fakeBackend(calls),
          fakeWorkspace(),
          fakeMaterializer(() => Effect.succeed(contextSnapshot("x".repeat(33 * 1024)))),
        ),
      ),
    )

    expect(error).toMatchObject({ _tag: "InvalidRequestError", kind: "chat_proxy_context_attachment" })
    expect(calls).toEqual([])
  })

  test("returns the acknowledged browser send when usage accounting fails", async () => {
    const calls: unknown[][] = []
    const brokenUsage = Layer.succeed(
      CtxPackUsage.Service,
      CtxPackUsage.Service.of({ recordAdmittedUse: () => Effect.die("usage unavailable") }),
    )
    const response = await run(
      Effect.gen(function* () {
        const client = yield* groupClient()
        return yield* client["chatProxy.prompt"]({
          params,
          payload: {
            tabID: "tab-a",
            messageID: "msg-context",
            text: "Summarize",
            contextAttachments: [contextAttachment],
          },
        })
      }),
      provide(
        testLayer(
          fakeBackend(calls),
          fakeWorkspace(),
          fakeMaterializer(() => Effect.succeed(contextSnapshot())),
          brokenUsage,
        ),
      ),
    )

    expect(response).toMatchObject({ status: "idle", blockID })
    expect(calls).toHaveLength(1)
  })

  test("finishes post-ack usage accounting when the request fiber is interrupted", async () => {
    const completed = await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const recorded = yield* Ref.make(false)
        const usage = Layer.succeed(
          CtxPackUsage.Service,
          CtxPackUsage.Service.of({
            recordAdmittedUse: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined)
                yield* Deferred.await(release)
                yield* Ref.set(recorded, true)
              }),
          }),
        )
        const requestFiber = yield* Effect.gen(function* () {
          const client = yield* groupClient()
          return yield* client["chatProxy.prompt"]({
            params,
            payload: {
              tabID: "tab-a",
              messageID: "msg-interrupted",
              text: "Summarize",
              contextAttachments: [contextAttachment],
            },
          })
        }).pipe(
          Effect.scoped,
          Effect.provide(
            provide(
              testLayer(
                fakeBackend([]),
                fakeWorkspace(),
                fakeMaterializer(() => Effect.succeed(contextSnapshot())),
                usage,
              ),
            ),
          ),
          Effect.forkChild,
        )

        yield* Deferred.await(started)
        const interruption = yield* Fiber.interrupt(requestFiber).pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(interruption)
        return yield* Ref.get(recorded)
      }) as unknown as Effect.Effect<boolean>,
    )

    expect(completed).toBe(true)
  })
})
