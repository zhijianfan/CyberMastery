import { Effect, Layer } from "effect"
import { describe, expect, it } from "bun:test"
import { ChatRelaySessionService } from "@opencode-ai/core/workspace/chat-relay-session"
import {
  OpencodeChat,
  OpencodeChatLive,
  NativeSessionRuntimeService,
  PermissionRuntimeService,
  ProviderAuthRuntimeService,
  executeChatRelayCommand,
  mapMessageState,
  mapPartState,
  mapPermissionState,
} from "./opencode-chat"
import type { OpencodeChatAdapter } from "./opencode-chat"

const runWithAdapter = (
  auth: Parameters<typeof ProviderAuthRuntimeService.of>[0],
  sessions: Parameters<typeof NativeSessionRuntimeService.of>[0],
  permissions: Parameters<typeof PermissionRuntimeService.of>[0],
  relay: Parameters<typeof ChatRelaySessionService.Service.of>[0],
  ) =>
  <A>(effect: (adapter: OpencodeChatAdapter) => Effect.Effect<A, unknown, never>) => {
    const layer = Layer.mergeAll(
      Layer.succeed(ProviderAuthRuntimeService, ProviderAuthRuntimeService.of(auth)),
      Layer.succeed(NativeSessionRuntimeService, NativeSessionRuntimeService.of(sessions)),
      Layer.succeed(PermissionRuntimeService, PermissionRuntimeService.of(permissions)),
      Layer.succeed(ChatRelaySessionService.Service, ChatRelaySessionService.Service.of(relay)),
    )
    const runtime = OpencodeChatLive.pipe(Layer.provide(layer))

    return Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* OpencodeChat
        return yield* effect(adapter)
      }).pipe(Effect.provide(runtime)),
    )
  }

const dummyState = { id: "session-id", status: "idle" as const }

describe("command dispatch", () => {
  it("dispatches each command to the mapped chat adapter method", async () => {
    const calls: string[] = []
    const adapter: OpencodeChatAdapter = {
      authStart: (providerID) =>
        Effect.sync(() => {
          calls.push(`auth:${providerID}`)
          return { loginURL: undefined, userCode: undefined }
        }),
      authStatus: (providerID) =>
        Effect.sync(() => {
          calls.push(`status:${providerID}`)
          return { providerID, status: "ready" as const }
        }),
      sessionCreate: (opts) =>
        Effect.sync(() => {
          calls.push(`create:${opts?.modelID}:${opts?.agentID}`)
          return dummyState
        }),
      sessionEnsure: (_workspaceID, _blockID) =>
        Effect.sync(() => {
          calls.push("ensure")
          return dummyState
        }),
      sessionGet: (sessionID) =>
        Effect.sync(() => {
          calls.push(`get:${sessionID}`)
          return dummyState
        }),
      prompt: (sessionID, input) =>
        Effect.sync(() => {
          calls.push(`prompt:${sessionID}:${input.delivery}`)
          return undefined
        }),
      abort: (sessionID) =>
        Effect.sync(() => {
          calls.push(`abort:${sessionID}`)
          return undefined
        }),
      permissionRespond: (requestID, response) =>
        Effect.sync(() => {
          calls.push(`permission:${requestID}:${response}`)
          return undefined
        }),
      messages: (sessionID) =>
        Effect.sync(() => {
          calls.push(`messages:${sessionID}`)
          return []
        }),
      parts: (input) =>
        Effect.sync(() => {
          calls.push(`parts:${input.messageID}`)
          return []
        }),
      pendingPermissions: (sessionID) =>
        Effect.sync(() => {
          calls.push(`pending:${sessionID}`)
          return []
        }),
    }

    const execute = executeChatRelayCommand(adapter, () => "resolved-session")
    await Effect.runPromise(execute({ type: "auth.start", providerID: "openai" }))
    await Effect.runPromise(execute({ type: "session.create", modelID: "m-1", agentID: "a-1" }))
    await Effect.runPromise(execute({ type: "session.prompt", text: "hello", delivery: "steer" }))
    await Effect.runPromise(execute({ type: "session.abort" }))
    await Effect.runPromise(execute({ type: "permission.respond", requestID: "perm-1", response: "allow-once" }))

    expect(calls).toEqual([
      "auth:openai",
      "create:m-1:a-1",
      "prompt:resolved-session:steer",
      "abort:resolved-session",
      "permission:perm-1:allow-once",
    ])
  })
})

describe("runtime state mapping", () => {
  it("maps message, part, and permission states without dropping nested fields", () => {
    const message = mapMessageState({
      id: "msg-1",
      sessionID: "session-id",
      role: "assistant",
      createdAt: 123,
      importance: "high",
    })

    const part = mapPartState({
      id: "part-1",
      messageID: "msg-1",
      kind: "tool",
      text: "tool output",
      state: { toolStatus: "running" },
      tool: { name: "read_file", args: { path: "/tmp/x" } },
      permission: { requested: ["filesystem"] },
      error: { code: "E_RUNTIME", message: "boom" },
    })

    const permission = mapPermissionState({
      id: "perm-1",
      requestID: "req-1",
      sessionID: "session-id",
      status: "pending",
      response: undefined,
    })

    expect(message.timeCreated).toBe(123)
    expect(message.important).toBe(true)
    expect(part.kind).toBe("tool")
    expect(part.state).toMatchObject({
      state: { toolStatus: "running" },
      tool: { name: "read_file" },
      permission: { requested: ["filesystem"] },
      error: { code: "E_RUNTIME", message: "boom" },
    })
    expect(permission.status).toBe("pending")
  })
})

describe("stale binding recovery", () => {
  it("retries session.get via sessionEnsure when binding is stale", async () => {
    let ensured = false

    const auth = {
      start: () => Effect.fail(new Error("not used")),
      status: () => Effect.fail(new Error("not used")),
    }

    const sessions = {
      create: () => Effect.succeed(dummyState),
      get: (sessionID: string) => {
        if (sessionID === "stale-session") {
          return Effect.fail({
            _tag: "MissingBindingError",
            workspaceID: "workspace-id",
            blockID: "block-id",
          })
        }
        if (sessionID === "restored-session") {
          return Effect.succeed({
            id: "restored-session",
            status: "idle" as const,
            directory: "/repo",
            modelID: "m",
            agentID: "a",
          })
        }
        return Effect.fail(new Error(`unexpected ${sessionID}`))
      },
      prompt: () => Effect.succeed(undefined),
      abort: () => Effect.succeed(undefined),
      messages: () => Effect.succeed([]),
      parts: () => Effect.succeed([]),
      pendingPermissions: () => Effect.succeed([]),
    }

    const permissions = {
      respond: () => Effect.succeed(undefined),
    }

    const relay: Parameters<typeof ChatRelaySessionService.Service.of>[0] = {
      get: () =>
        Effect.fail(new ChatRelaySessionService.BlockNotFoundError({ workspaceID: "workspace-id" as never, blockID: "block-id" })),
      ensure: () => {
        ensured = true
        return Effect.succeed({
          workspaceID: "workspace-id",
          blockID: "block-id",
          sessionID: "restored-session",
          functionalityInstanceID: "instance-id",
          directory: "/repo",
          generation: 1,
          revision: 1,
        } as never)
      },
      reset: () => Effect.succeed(undefined as never),
    }

    const adapter = runWithAdapter(auth, sessions, permissions, relay)
    const session = await adapter((service) => service.sessionGet("stale-session"))

    expect(ensured).toBe(true)
    expect(session).toMatchObject({ id: "restored-session", status: "idle", directory: "/repo" })
  })
})
