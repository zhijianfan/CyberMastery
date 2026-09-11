import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createMasterAgentSdkPort } from "./sdk-port"
import type { MasterAgent } from "./types"

const WIRE_BINDING = {
  workspaceID: "ws-1",
  blockID: "block-1",
  functionalityInstanceID: "fi-1",
  sessionID: "session-1",
  directory: "/repo",
  generation: 1,
  revision: 1,
}

const EXPECTED_BINDING: MasterAgent.Binding = { ...WIRE_BINDING }

const WIRE_WORKSPACE_INFO = {
  id: "ws-1",
  name: "ws",
  style: "plain",
  directories: ["/repo"],
  pluginIDs: [],
  skillIDs: [],
  model: "openai:gpt-4o",
  operatingAgent: "primary",
  coderModel: "anthropic:claude-sonnet-4",
  git: [],
  time: { created: 0, updated: 0 },
}

type FakeBehavior = {
  get?: () => unknown
  ensure?: () => unknown
  reset?: () => unknown
  update?: () => unknown
}

type FakeCall = { method: string; parameters: unknown; options: unknown }

function defaultData(method: string): unknown {
  switch (method) {
    case "get":
      return { data: { status: "bound", binding: WIRE_BINDING } }
    case "ensure":
      return { data: WIRE_BINDING }
    case "reset":
      return { data: { status: "reset", binding: WIRE_BINDING } }
    case "update":
      return { data: WIRE_WORKSPACE_INFO }
    default:
      return undefined
  }
}

function abortError(): Error {
  const error = new Error("The operation was aborted")
  error.name = "AbortError"
  return error
}

function createFakeClient(behavior: FakeBehavior = {}) {
  const calls: FakeCall[] = []
  const record = (method: string) => async (parameters: unknown, options: unknown) => {
    calls.push({ method, parameters, options })
    const signal = (options as { signal?: AbortSignal } | undefined)?.signal
    if (signal?.aborted) throw abortError()
    const handler = behavior[method as keyof FakeBehavior]
    return handler ? handler() : defaultData(method)
  }
  const client = {
    v2: {
      workspace: {
        masterAgent: {
          get: record("get"),
          ensure: record("ensure"),
          reset: record("reset"),
        },
        get: record("workspaceGet"),
        update: record("update"),
      },
    },
  }
  return { client: client as unknown as OpencodeClient, calls }
}

// Mirrors the SDK's `wrapClientError` output for a non-2xx body.
function serverError(status: number, body: Record<string, unknown>): Error {
  return new Error(`opencode server ${status}`, { cause: { body, status } })
}

describe("createMasterAgentSdkPort", () => {
  test("get resolves the binding when the server reports bound", async () => {
    const { client, calls } = createFakeClient()
    const transport = createMasterAgentSdkPort(client)
    const binding = await transport.get({ workspaceID: "ws-1", blockID: "block-1" })
    expect(binding).toEqual(EXPECTED_BINDING)
    expect(calls[0]).toMatchObject({ method: "get", parameters: { workspaceID: "ws-1", blockID: "block-1" } })
    expect((calls[0].options as { throwOnError?: boolean }).throwOnError).toBe(true)
  })

  test("get resolves null when the server reports unbound", async () => {
    const { client } = createFakeClient({ get: () => ({ data: { status: "unbound" } }) })
    const transport = createMasterAgentSdkPort(client)
    await expect(transport.get({ workspaceID: "ws-1", blockID: "block-1" })).resolves.toBeNull()
  })

  test("get rejects with instance-not-found on 404 instance errors", async () => {
    const { client } = createFakeClient({
      get: () => {
        throw serverError(404, { _tag: "MasterAgentInstanceNotFoundError", message: "no instance" })
      },
    })
    const transport = createMasterAgentSdkPort(client)
    await expect(transport.get({ workspaceID: "ws-1", blockID: "block-1" })).rejects.toEqual({
      type: "instance-not-found",
    })
  })

  test("get rejects with workspace-not-found and block-not-found on 404", async () => {
    const { client } = createFakeClient({
      get: () => {
        throw serverError(404, { _tag: "MasterAgentWorkspaceNotFoundError", message: "no workspace" })
      },
    })
    await expect(createMasterAgentSdkPort(client).get({ workspaceID: "ws-1", blockID: "block-1" })).rejects.toEqual({
      type: "workspace-not-found",
    })
    const { client: client2 } = createFakeClient({
      get: () => {
        throw serverError(404, { _tag: "MasterAgentBlockNotFoundError", message: "no block" })
      },
    })
    await expect(createMasterAgentSdkPort(client2).get({ workspaceID: "ws-1", blockID: "block-1" })).rejects.toEqual({
      type: "block-not-found",
    })
  })

  test("ensure resolves the binding and forwards the request", async () => {
    const { client, calls } = createFakeClient()
    const transport = createMasterAgentSdkPort(client)
    const binding = await transport.ensure({ workspaceID: "ws-1", blockID: "block-1" })
    expect(binding).toEqual(EXPECTED_BINDING)
    expect(calls[0].parameters).toEqual({ workspaceID: "ws-1", blockID: "block-1" })
  })

  test("ensure rejects with access-denied on 403", async () => {
    const { client } = createFakeClient({
      ensure: () => {
        throw serverError(403, { _tag: "MasterAgentAccessDeniedError", message: "denied" })
      },
    })
    await expect(createMasterAgentSdkPort(client).ensure({ workspaceID: "ws-1", blockID: "block-1" })).rejects.toEqual({
      type: "access-denied",
    })
  })

  test("ensure rejects with access-denied on 401 unauthorized", async () => {
    const { client } = createFakeClient({
      ensure: () => {
        throw serverError(401, { _tag: "UnauthorizedError", message: "unauthorized" })
      },
    })
    await expect(createMasterAgentSdkPort(client).ensure({ workspaceID: "ws-1", blockID: "block-1" })).rejects.toEqual({
      type: "access-denied",
    })
  })

  test("ensure rejects with wrong-functionality carrying the actual functionality", async () => {
    const { client } = createFakeClient({
      ensure: () => {
        throw serverError(400, { _tag: "MasterAgentWrongFunctionalityError", message: "wrong", actual: "builtin:chat" })
      },
    })
    await expect(createMasterAgentSdkPort(client).ensure({ workspaceID: "ws-1", blockID: "block-1" })).rejects.toEqual({
      type: "wrong-functionality",
      actual: "builtin:chat",
    })
  })

  test("reset resolves the binding and forwards expected session id and revision", async () => {
    const { client, calls } = createFakeClient()
    const transport = createMasterAgentSdkPort(client)
    const binding = await transport.reset({
      workspaceID: "ws-1",
      blockID: "block-1",
      expectedSessionID: "session-1",
      expectedRevision: 1,
    })
    expect(binding).toEqual(EXPECTED_BINDING)
    expect(calls[0].parameters).toEqual({
      workspaceID: "ws-1",
      blockID: "block-1",
      masterAgentResetPayload: { expectedSessionID: "session-1", expectedRevision: 1 },
    })
  })

  test("reset rejects with stale-binding on 409 stale conflict", async () => {
    const { client } = createFakeClient({
      reset: () => {
        throw serverError(409, { _tag: "MasterAgentStaleBindingError", message: "stale", currentRevision: 3 })
      },
    })
    await expect(
      createMasterAgentSdkPort(client).reset({
        workspaceID: "ws-1",
        blockID: "block-1",
        expectedSessionID: "session-1",
        expectedRevision: 1,
      }),
    ).rejects.toEqual({ type: "stale-binding" })
  })

  test("reset rejects with stale-binding on a 200 stale response", async () => {
    const { client } = createFakeClient({ reset: () => ({ data: { status: "stale", currentRevision: 3 } }) })
    await expect(
      createMasterAgentSdkPort(client).reset({
        workspaceID: "ws-1",
        blockID: "block-1",
        expectedSessionID: "session-1",
        expectedRevision: 1,
      }),
    ).rejects.toEqual({ type: "stale-binding" })
  })

  test("reset rejects with reset-busy on a 200 busy response", async () => {
    const { client } = createFakeClient({ reset: () => ({ data: { status: "busy", reason: "session is active" } }) })
    await expect(
      createMasterAgentSdkPort(client).reset({
        workspaceID: "ws-1",
        blockID: "block-1",
        expectedSessionID: "session-1",
        expectedRevision: 1,
      }),
    ).rejects.toEqual({ type: "reset-busy" })
  })

  test("reset rejects with reset-has-pending-input when the busy reason mentions pending input", async () => {
    const { client } = createFakeClient({ reset: () => ({ data: { status: "busy", reason: "has-pending-input" } }) })
    await expect(
      createMasterAgentSdkPort(client).reset({
        workspaceID: "ws-1",
        blockID: "block-1",
        expectedSessionID: "session-1",
        expectedRevision: 1,
      }),
    ).rejects.toEqual({ type: "reset-has-pending-input" })
  })

  test("reset rejects with concurrent-conflict on 409 conflict", async () => {
    const { client } = createFakeClient({
      reset: () => {
        throw serverError(409, { _tag: "MasterAgentConflictError", message: "conflict" })
      },
    })
    await expect(
      createMasterAgentSdkPort(client).reset({
        workspaceID: "ws-1",
        blockID: "block-1",
        expectedSessionID: "session-1",
        expectedRevision: 1,
      }),
    ).rejects.toEqual({ type: "concurrent-conflict" })
  })

  test("network failures pass through unchanged", async () => {
    const networkError = new TypeError("fetch failed")
    const { client } = createFakeClient({
      get: () => {
        throw networkError
      },
    })
    await expect(createMasterAgentSdkPort(client).get({ workspaceID: "ws-1", blockID: "block-1" })).rejects.toBe(
      networkError,
    )
  })

  test("unrecognized server errors pass through unchanged", async () => {
    const invalid = serverError(400, { _tag: "InvalidRequestError", message: "bad" })
    const { client } = createFakeClient({
      ensure: () => {
        throw invalid
      },
    })
    await expect(createMasterAgentSdkPort(client).ensure({ workspaceID: "ws-1", blockID: "block-1" })).rejects.toBe(
      invalid,
    )
  })

  test("abort errors are preserved and win over error normalization", async () => {
    const controller = new AbortController()
    let rejectGet: (error: unknown) => void = () => {}
    const { client } = createFakeClient({
      get: () =>
        new Promise((_resolve, reject) => {
          rejectGet = reject
        }),
    })
    const transport = createMasterAgentSdkPort(client)
    const pending = transport.get({ workspaceID: "ws-1", blockID: "block-1" }, controller.signal)
    controller.abort()
    rejectGet(serverError(403, { _tag: "MasterAgentAccessDeniedError", message: "denied" }))
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })

  test("a pre-aborted signal rejects with an abort error without a server round trip", async () => {
    const controller = new AbortController()
    controller.abort()
    const { client, calls } = createFakeClient()
    await expect(
      createMasterAgentSdkPort(client).ensure({ workspaceID: "ws-1", blockID: "block-1" }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(calls.length).toBe(1)
    expect((calls[0].options as { signal?: AbortSignal }).signal).toBe(controller.signal)
  })

  test("patchWorkspace sets coderModel and decodes the returned workspace info", async () => {
    const { client, calls } = createFakeClient()
    const transport = createMasterAgentSdkPort(client)
    const info = await transport.patchWorkspace("ws-1", {
      coderModel: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    })
    expect(calls[0].parameters).toEqual({
      workspaceUpdatePayload: { id: "ws-1", patch: { coderModel: "anthropic:claude-sonnet-4" } },
    })
    expect(info).toEqual({
      model: { providerID: "openai", modelID: "gpt-4o" },
      operatingAgent: "primary",
      coderModel: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    })
  })

  test("patchWorkspace serializes variants without confusing colons in the model ID", async () => {
    const { client, calls } = createFakeClient()
    await createMasterAgentSdkPort(client).patchWorkspace("ws-1", {
      coderModel: { providerID: "ollama-cloud", modelID: "gpt-oss:120b", variant: "long" },
    })
    expect(calls[0].parameters).toEqual({
      workspaceUpdatePayload: { id: "ws-1", patch: { coderModel: "ollama-cloud:gpt-oss%3A120b:long" } },
    })
  })

  test("patchWorkspace sends an explicit null patch to clear coderModel", async () => {
    const { client, calls } = createFakeClient({
      update: () => ({ data: { ...WIRE_WORKSPACE_INFO, coderModel: null } }),
    })
    const info = await createMasterAgentSdkPort(client).patchWorkspace("ws-1", { coderModel: null })
    expect(calls[0].parameters).toEqual({ workspaceUpdatePayload: { id: "ws-1", patch: { coderModel: null } } })
    expect(info.coderModel).toBeNull()
    expect(info.model).toEqual({ providerID: "openai", modelID: "gpt-4o" })
  })

  test("patchWorkspace decodes absent coderModel as null and variant suffixes", async () => {
    const { client } = createFakeClient({
      update: () => ({ data: { ...WIRE_WORKSPACE_INFO, coderModel: "ollama-cloud:gpt-oss%3A120b:long" } }),
    })
    const info = await createMasterAgentSdkPort(client).patchWorkspace("ws-1", { coderModel: null })
    expect(info.coderModel).toEqual({ providerID: "ollama-cloud", modelID: "gpt-oss:120b", variant: "long" })

    const { client: client2 } = createFakeClient({
      update: () => ({ data: { ...WIRE_WORKSPACE_INFO, coderModel: undefined } }),
    })
    const info2 = await createMasterAgentSdkPort(client2).patchWorkspace("ws-1", { coderModel: null })
    expect(info2.coderModel).toBeNull()
  })
})
