import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import {
  BlockRuntimeSnapshotRequest,
  ChatRelayCommand,
  ChatRelayCommandEnvelope,
  RuntimeEventEnvelope,
  RuntimeResyncRequiredPayload,
  RuntimeResourceBinding,
  RuntimeResourceState,
  RuntimeSnapshot,
  RuntimeStreamErrorPayload,
} from "./block-runtime"

const decode = <S extends Schema.Decoder<unknown>>(schema: S) => (input: unknown) => Schema.decodeUnknownSync(schema)(input)

const cursor = "ses_test:1"
const timestamp = 1_000

const authBinding = {
  type: "auth" as const,
  id: "provider_google",
}

const sessionBinding = {
  type: "session" as const,
  id: "session_test",
}

const messageBinding = {
  type: "message" as const,
  id: "msg_test",
  parentID: "session_test",
}

const messagePartBinding = {
  type: "message-part" as const,
  id: "part_test",
  parentID: "msg_test",
}

const permissionBinding = {
  type: "permission" as const,
  id: "perm_test",
  parentID: "session_test",
}

describe("RuntimeEventEnvelope", () => {
  test.each([
    {
      event: "auth.updated",
      resource: authBinding,
      data: { providerID: "provider_google", status: "awaiting-login" as const, loginURL: "https://auth.dev/device", userCode: "ABCD-1234" },
    },
    {
      event: "session.status",
      resource: sessionBinding,
      data: { id: "session_test", status: "busy" as const, modelID: "gpt-5" },
    },
    {
      event: "session.created",
      resource: sessionBinding,
      data: { id: "session_test", status: "idle" as const, agentID: "agent_default" },
    },
    {
      event: "message.created",
      resource: messageBinding,
      data: { id: "msg_test", sessionID: "session_test", role: "user" as const, timeCreated: 1_000 },
    },
    {
      event: "message-part.updated",
      resource: messagePartBinding,
      data: { id: "part_test", messageID: "msg_test", kind: "text" as const, text: "hello" },
    },
    {
      event: "permission.requested",
      resource: permissionBinding,
      data: { id: "perm_test", requestID: "req_test", sessionID: "session_test", status: "pending" as const },
    },
    {
      event: "permission.resolved",
      resource: permissionBinding,
      data: { id: "perm_test", requestID: "req_test", sessionID: "session_test", status: "resolved" as const, response: "allow-once" as const },
    },
    {
      event: "connection.error",
      resource: sessionBinding,
      data: { status: "disconnected" as const, lastError: "socket closed" },
    },
    {
      event: "resync.required",
      resource: authBinding,
      data: { cursor, reason: "missed events" },
    },
    {
      event: "stream.error",
      resource: sessionBinding,
      data: { code: "server:down", message: "stream failed" },
    },
  ] as const)("round-trips %s", ({ event, resource, data }) => {
    const decoded = decode(RuntimeEventEnvelope)({
      event,
      resource,
      data,
      cursor,
      revision: 7,
      timestamp,
    })

    const encoded = Schema.encodeSync(RuntimeEventEnvelope)(decoded)
    const roundTrip = decode(RuntimeEventEnvelope)(encoded)

    expect(roundTrip).toEqual(decoded)
  })

  test("rejects unknown event name", () => {
    expect(() =>
      decode(RuntimeEventEnvelope)({
        event: "unknown",
        resource: authBinding,
        data: {},
        cursor,
        timestamp,
      }),
    ).toThrow()
  })

  test("rejects part kind outside the literal set", () => {
    expect(() =>
      decode(RuntimeEventEnvelope)({
        event: "message-part.updated",
        resource: messagePartBinding,
        data: { id: "part_test", messageID: "msg_test", kind: "table" },
        cursor,
        timestamp,
      }),
    ).toThrow()
  })

  test("accepts any opaque cursor string", () => {
    const decoded = decode(RuntimeEventEnvelope)({
      event: "session.status",
      resource: sessionBinding,
      data: { id: "session_test", status: "idle" as const },
      cursor: "runtime:1755600000000+12",
      timestamp,
    })

    expect(decoded.cursor).toBe("runtime:1755600000000+12")
  })
})

describe("RuntimeSnapshot", () => {
  const emptyState = {
    connection: { status: "disconnected" },
    authByProvider: {},
    sessionsByID: {},
    messagesByID: {},
    partsByID: {},
    permissionsByID: {},
  }

  const fullState = {
    connection: { status: "connected", cursor: "ses_test:4" },
    authByProvider: {
      provider_google: { providerID: "provider_google", status: "ready" },
    },
    sessionsByID: {
      session_test: { id: "session_test", status: "busy", modelID: "gpt-5" },
    },
    messagesByID: {
      msg_test: { id: "msg_test", sessionID: "session_test", role: "assistant" },
    },
    partsByID: {
      part_test: { id: "part_test", messageID: "msg_test", kind: "text", text: "hello" },
    },
    permissionsByID: {
      perm_test: { id: "perm_test", requestID: "req_test", sessionID: "session_test", status: "pending" },
    },
  }

  test("accepts a full runtime snapshot", () => {
    const snapshot = decode(RuntimeSnapshot)({ cursor: "session_test:1", state: fullState })

    expect(snapshot.state.connection.status).toBe("connected")
    expect(snapshot.state.partsByID.part_test.kind).toBe("text")
    expect(Object.keys(snapshot.state.permissionsByID).length).toBe(1)
  })

  test("accepts an empty runtime state", () => {
    const snapshot = decode(RuntimeSnapshot)({ cursor: "session_test:1", state: emptyState })

    expect(snapshot.state.messagesByID).toEqual({})
    expect(snapshot.state.connection.status).toBe("disconnected")
  })

  test("rejects bad snapshot state", () => {
    expect(() =>
      decode(RuntimeSnapshot)({
        cursor,
        state: { ...emptyState, connection: { status: "not-valid" } },
      }),
    ).toThrow()
  })
})

describe("RuntimeResourceBinding", () => {
  test("accepts all binding kinds", () => {
    for (const type of ["auth", "session", "message", "message-part", "permission", "pty", "file", "review"] as const) {
      expect(decode(RuntimeResourceBinding)({ type, id: `${type}_1` }).type).toBe(type)
    }
  })

  test("rejects unknown binding type", () => {
    expect(() => decode(RuntimeResourceBinding)({ type: "gadget", id: "g_1" })).toThrow()
  })
})

describe("BlockRuntimePayload schemas", () => {
  test("decodes snapshot request", () => {
    const payload = decode(BlockRuntimeSnapshotRequest)({
      bindings: [authBinding, sessionBinding, messageBinding, permissionBinding],
    })

    expect(payload.bindings.length).toBe(4)
  })

  test("decodes command envelope with pinned command variants", () => {
    const envelope = decode(ChatRelayCommandEnvelope)({
      command: { type: "session.prompt", text: "hello", delivery: "steer" },
    })

    expect(envelope.command.type).toBe("session.prompt")
    if (envelope.command.type === "session.prompt") {
      expect(envelope.command.delivery).toBe("steer")
    }
  })

  test("decodes every pinned command variant", () => {
    const commands = [
      { type: "auth.start", providerID: "openai" },
      { type: "session.create", modelID: "gpt-5" },
      { type: "session.prompt", text: "hi", delivery: "queue" },
      { type: "session.abort" },
      { type: "permission.respond", requestID: "req_1", response: "deny" },
    ] as const

    for (const command of commands) {
      expect(decode(ChatRelayCommand)(command)).toEqual(command)
    }
  })

  test("rejects unknown command", () => {
    expect(() => decode(ChatRelayCommand)({ type: "invalid.command" })).toThrow()
  })
})

describe("Stream error payloads", () => {
  test("decodes resync required payload", () => {
    const payload = decode(RuntimeResyncRequiredPayload)({
      cursor: "session_test:2",
      reason: "cursor too old",
    })

    expect(payload.reason).toBe("cursor too old")
  })

  test("decodes stream error payload", () => {
    const payload = decode(RuntimeStreamErrorPayload)({ code: "server:down", message: "stream failed" })

    expect(payload.code).toBe("server:down")
  })
})

describe("RuntimeResourceState atoms round-trip", () => {
  const resourceState = decode(RuntimeResourceState)({
    connection: { status: "connected" },
    authByProvider: {},
    sessionsByID: { session_test: { id: "session_test", status: "busy" } },
    messagesByID: {},
    partsByID: {},
    permissionsByID: {},
  })

  test("round-trips runtime state atoms", () => {
    expect(resourceState.sessionsByID.session_test.id).toBe("session_test")
    expect(resourceState.sessionsByID.session_test.status).toBe("busy")
    expect(resourceState.connection.status).toBe("connected")
  })
})
