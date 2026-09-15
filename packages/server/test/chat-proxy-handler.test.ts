import { describe, expect, test } from "bun:test"
import { DefaultInteractiveContextBudget } from "@opencode-ai/core/context-broker/capsule"
import { CtxPackMaterializer, CtxPackUsage } from "@opencode-ai/core/ctxpack/index"
import { WorkspaceService, WorkspaceV2 } from "@opencode-ai/core/workspace"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Location } from "@opencode-ai/core/location"
import { AgentV2 } from "@opencode-ai/core/agent"
import { SkillV2 } from "@opencode-ai/core/skill"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Hash } from "@opencode-ai/core/util/hash"
import type { LocationServices } from "../src/location"
import { ChatProxyGroup } from "@opencode-ai/protocol/groups/chat-proxy"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { SchemaErrorMiddleware } from "@opencode-ai/protocol/middleware/schema-error"
import { ChatProxy } from "@opencode-ai/schema/chat-proxy"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Cause, Deferred, Effect, Exit, Fiber, FileSystem, Layer, LayerMap, Path, Ref, Scope } from "effect"
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
    directories: ["D:/workspace"],
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
    reconcilePrompt: async () => null,
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
  reconcilePrompt(
    user: string,
    workspaceID: string,
    blockID: string,
    tabID: string,
    messageID: string,
    requestIdentity: string,
  ): Promise<ChatProxy.Relay | null>
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
    requestIdentity?: string,
    files?: ChatProxy.PromptPayload["files"],
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
  locations = fakeLocations(),
) =>
  makeChatProxyHandler(backend).pipe(
    Layer.provideMerge(workspace),
    Layer.provideMerge(materializer),
    Layer.provideMerge(usage),
    Layer.provideMerge(locations),
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
const skill = (name = "review", content = "Review carefully") => ({
  name,
  content,
  location: AbsolutePath.make("D:/workspace/skills/review.md"),
  description: "Review code",
})
const fakeLocations = (catalog: () => SkillV2.Info[] = () => [skill()], seen: string[] = []) =>
  Layer.effect(
    LocationServiceMap.Service,
    LayerMap.make(
      (ref: Location.Ref) => {
        seen.push(ref.directory)
        return Layer.merge(
          Layer.mock(AgentV2.Service, {
            resolve: () =>
              Effect.succeed({
                ...AgentV2.Info.empty(AgentV2.defaultID),
                permissions: [
                  { action: "skill", resource: "*", effect: "allow" },
                  { action: "skill", resource: "ask", effect: "ask" },
                  { action: "skill", resource: "denied", effect: "deny" },
                ],
              }),
          }),
          Layer.mock(SkillV2.Service, { list: () => Effect.succeed(catalog()) }),
        ) as Layer.Layer<LocationServices>
      },
      { idleTimeToLive: 0 },
    ),
  )
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
const fileAttachments = [
  { uri: "data:text/plain;base64,aGVsbG8=", mime: "text/plain", name: "notes.txt" },
  { uri: "data:application/json;base64,e30=", mime: "application/json" },
]
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
  test("discovers only allowed skills from the workspace primary directory and previews a single matching hash", async () => {
    const seen: string[] = []
    const values = await run(
      Effect.gen(function* () {
        const client = yield* groupClient()
        const candidates = yield* client["chatProxy.skills"]({ params })
        const preview = yield* client["chatProxy.skillPreview"]({ params, query: candidates[0]! })
        const stale = yield* client["chatProxy.skillPreview"]({
          params,
          query: { name: "review", contentHash: "stale" },
        }).pipe(Effect.flip)
        return { candidates, preview, stale }
      }),
      provide(
        testLayer(
          fakeBackend([]),
          fakeWorkspace(),
          fakeMaterializer(),
          fakeUsage(),
          fakeLocations(() => [skill(), skill("ask"), skill("denied")], seen),
        ),
      ),
    )
    expect(values.candidates).toEqual([
      { name: "review", description: "Review code", contentHash: Hash.sha256("Review carefully") },
    ])
    expect(values.preview).toEqual({ ...values.candidates[0], content: "Review carefully" })
    expect(values.stale).toMatchObject({ kind: "chat_proxy_skill" })
    expect(seen).toEqual(["D:/workspace", "D:/workspace", "D:/workspace"])
  })

  test("rejects unauthorized discovery and wrong block types before reading the skill catalog", async () => {
    const seen: string[] = []
    for (const workspace of [
      fakeWorkspace({ get: (id) => Effect.fail(new WorkspaceService.WorkspaceNotFoundError({ workspaceID: id })) }),
      fakeWorkspace({ block: { get: () => Effect.succeed(undefined) } }),
    ]) {
      const result = await run(
        Effect.gen(function* () {
          const client = yield* groupClient()
          return yield* client["chatProxy.skills"]({ params }).pipe(Effect.exit)
        }),
        provide(
          testLayer(
            fakeBackend([]),
            workspace,
            fakeMaterializer(),
            fakeUsage(),
            fakeLocations(() => [skill()], seen),
          ),
        ),
      )
      expect(Exit.isFailure(result)).toBe(true)
    }
    expect(seen).toEqual([])
  })

  test("combines selected skills and CtxPack content, deduplicates bodies, and sends a skill-only prompt", async () => {
    const calls: unknown[][] = []
    await run(
      Effect.gen(function* () {
        const client = yield* groupClient()
        const selected = { name: "review", contentHash: Hash.sha256("Review carefully") }
        for (const contextAttachments of [[contextAttachment], []]) {
          yield* client["chatProxy.prompt"]({
            params,
            payload: {
              tabID: "tab-a",
              messageID: `msg-${contextAttachments.length}`,
              text: "",
              skills: [selected, selected],
              contextAttachments,
            },
          })
        }
      }),
      provide(
        testLayer(
          fakeBackend(calls),
          fakeWorkspace(),
          fakeMaterializer(() => Effect.succeed(contextSnapshot())),
        ),
      ),
    )
    expect(calls).toHaveLength(2)
    expect(calls[0]?.[7]).toContain("<selected-skills>")
    expect(calls[0]?.[7]).toContain("<workspace-context>")
    expect(String(calls[0]?.[7]).match(/Review carefully/g)).toHaveLength(1)
    expect(calls[1]?.[6]).toBe('Selected skills: "review"')
    expect(calls[1]?.[7]).toContain("Review carefully")
    expect(calls[1]?.[6]).not.toContain("Review carefully")
  })

  test("forwards file-only prompts without exposing their data URIs in display text", async () => {
    const calls: unknown[][] = []
    const reconciliations: unknown[][] = []
    await run(
      Effect.gen(function* () {
        const client = yield* groupClient()
        return yield* client["chatProxy.prompt"]({
          params,
          payload: { tabID: "tab-a", messageID: "msg-files", text: "", files: fileAttachments },
        })
      }),
      provide(
        testLayer(
          fakeBackend(calls, {
            reconcilePrompt: async (...input) => {
              reconciliations.push(input)
              return null
            },
          }),
        ),
      ),
    )

    expect(reconciliations[0]?.[5]).toEqual(expect.any(String))
    expect(String(reconciliations[0]?.[5])).not.toBe("")
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[6]).toContain("notes.txt")
    expect(calls[0]?.[6]).not.toContain("data:")
    expect(calls[0]?.[7]).toBe("")
    expect(calls[0]?.[9]).toEqual(fileAttachments)
  })

  test("accepts an empty base64 file attachment", async () => {
    const calls: unknown[][] = []
    await run(
      Effect.gen(function* () {
        const client = yield* groupClient()
        return yield* client["chatProxy.prompt"]({
          params,
          payload: {
            tabID: "tab-a",
            messageID: "msg-empty-file",
            text: "",
            files: [{ uri: "data:application/octet-stream;base64,", mime: "application/octet-stream" }],
          },
        })
      }),
      provide(testLayer(fakeBackend(calls))),
    )

    expect(calls).toHaveLength(1)
  })

  test("conflicts when a reused file prompt message ID changes its request identity", async () => {
    const calls: unknown[][] = []
    const identities: string[] = []
    const admitted = new Map<string, string>()
    const backend = fakeBackend(calls, {
      reconcilePrompt: async (_user, _workspaceID, _blockID, _tabID, messageID, identity) => {
        identities.push(identity)
        if (!admitted.has(messageID)) {
          admitted.set(messageID, identity)
          return null
        }
        return Promise.reject(new Error("message ID conflict"))
      },
    })
    const variants = [
      fileAttachments,
      [{ ...fileAttachments[0], uri: "data:text/plain;base64,d29ybGQ=" }, fileAttachments[1]!],
      [
        { ...fileAttachments[0], uri: "data:application/octet-stream;base64,aGVsbG8=", mime: "application/octet-stream" },
        fileAttachments[1]!,
      ],
      [{ ...fileAttachments[0], name: "renamed.txt" }, fileAttachments[1]!],
    ]

    await run(
      Effect.gen(function* () {
        const client = yield* groupClient()
        return yield* client["chatProxy.prompt"]({
          params,
          payload: { tabID: "tab-a", messageID: "msg-reused", text: "", files: variants[0]! },
        })
      }),
      provide(testLayer(backend)),
    )
    const errors = await Promise.all(
      variants.slice(1).map((files) =>
        run(
          Effect.gen(function* () {
            const client = yield* groupClient()
            return yield* client["chatProxy.prompt"]({
              params,
              payload: { tabID: "tab-a", messageID: "msg-reused", text: "", files },
            }).pipe(Effect.flip)
          }),
          provide(testLayer(backend)),
        ),
      ),
    )
    expect(errors).toHaveLength(3)
    errors.forEach((error) => expect(error).toMatchObject({ name: "ChatProxyRequestError" }))

    expect(new Set(identities).size).toBe(4)
    expect(calls).toHaveLength(1)
  })

  test("rejects invalid file attachments before reconciliation or browser work", async () => {
    const invalidFiles = [
      [{ uri: "file:///tmp/notes.txt", mime: "text/plain", name: "notes.txt" }],
      [{ uri: "https://example.com/notes.txt", mime: "text/plain", name: "notes.txt" }],
      [{ uri: "data:text/plain,hello", mime: "text/plain", name: "notes.txt" }],
      [{ uri: "data:text/plain;base64,aGVsbG8=", mime: "application/json", name: "notes.txt" }],
    ]
    const calls: unknown[][] = []
    let reconciliations = 0
    const backend = fakeBackend(calls, {
      reconcilePrompt: async () => {
        reconciliations += 1
        return null
      },
    })

    const errors = await Promise.all(
      invalidFiles.map((files) =>
        run(
          Effect.gen(function* () {
            const client = yield* groupClient()
            return yield* client["chatProxy.prompt"]({
              params,
              payload: { tabID: "tab-a", messageID: "msg-invalid", text: "", files },
            }).pipe(Effect.flip)
          }),
          provide(testLayer(backend)),
        ),
      ),
    )

    expect(reconciliations).toBe(0)
    expect(calls).toEqual([])
    errors.forEach((error) => {
      expect(error).toMatchObject({ _tag: "InvalidRequestError", kind: "chat_proxy_file_attachment" })
      expect(error.message).not.toContain("notes.txt")
      expect(error.message).not.toContain("data:")
    })
  })

  test("returns admitted retries before resolving a replaced catalog or expired context", async () => {
    const calls: unknown[][] = []
    await run(
      Effect.gen(function* () {
        const client = yield* groupClient()
        return yield* client["chatProxy.prompt"]({
          params,
          payload: {
            tabID: "tab-a",
            messageID: "admitted",
            text: "",
            skills: [{ name: "removed", contentHash: "old" }],
            contextAttachments: [contextAttachment],
          },
        })
      }),
      provide(testLayer(fakeBackend(calls, { reconcilePrompt: async () => relay() }))),
    )
    expect(calls).toEqual([])
  })

  test("rejects changed or denied skills and combined context overflow before browser send", async () => {
    for (const selected of [skill("denied"), skill("review", "stale"), skill("review", "x".repeat(13000))]) {
      const calls: unknown[][] = []
      const result = await run(
        Effect.gen(function* () {
          const client = yield* groupClient()
          return yield* client["chatProxy.prompt"]({
            params,
            payload: {
              tabID: "tab-a",
              messageID: "rejected",
              text: "",
              skills: [{ name: selected.name, contentHash: Hash.sha256(selected.content) }],
              contextAttachments: [contextAttachment],
            },
          }).pipe(Effect.flip)
        }),
        provide(
          testLayer(
            fakeBackend(calls),
            fakeWorkspace(),
            fakeMaterializer(() => Effect.succeed(contextSnapshot("y".repeat(13000)))),
            fakeUsage(),
            fakeLocations(() => [skill("denied"), skill("review", "x".repeat(13000))]),
          ),
        ),
      )
      expect(result).toMatchObject({ _tag: "InvalidRequestError" })
      expect(calls).toEqual([])
    }
  })
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
