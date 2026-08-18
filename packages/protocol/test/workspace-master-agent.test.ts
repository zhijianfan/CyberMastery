import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { MasterAgent } from "@opencode-ai/schema/master-agent"
import { Session } from "@opencode-ai/schema/session"
import { Workspace } from "@opencode-ai/schema/workspace"
import {
  MasterAgentAccessDeniedError,
  MasterAgentBlockNotFoundError,
  MasterAgentBusyError,
  MasterAgentConflictError,
  MasterAgentInstanceNotFoundError,
  MasterAgentResetPayload,
  MasterAgentStaleBindingError,
  MasterAgentWorkspaceNotFoundError,
  MasterAgentWrongFunctionalityError,
} from "../src/groups/workspace-master-agent"

const decode = <S extends Schema.Decoder<unknown>>(schema: S) => (input: unknown) => Schema.decodeUnknownSync(schema)(input)

const binding = {
  workspaceID: Workspace.ID.make("wrk_test"),
  blockID: "block-1",
  functionalityInstanceID: "inst_1",
  sessionID: Session.ID.make("ses_test"),
  directory: "/tmp",
  generation: 0,
  revision: 1,
}

describe("MasterAgentResetPayload", () => {
  test("decodes a valid reset request", () => {
    const payload = decode(MasterAgentResetPayload)({
      expectedSessionID: Session.ID.make("ses_test"),
      expectedRevision: 3,
    })

    expect(payload).toEqual({ expectedSessionID: Session.ID.make("ses_test"), expectedRevision: 3 })
  })

  test("rejects a missing expectedSessionID", () => {
    expect(() => decode(MasterAgentResetPayload)({ expectedRevision: 0 })).toThrow()
  })

  test("rejects a missing expectedRevision", () => {
    expect(() => decode(MasterAgentResetPayload)({ expectedSessionID: Session.ID.make("ses_test") })).toThrow()
  })

  test("rejects a negative expectedRevision", () => {
    expect(() =>
      decode(MasterAgentResetPayload)({ expectedSessionID: Session.ID.make("ses_test"), expectedRevision: -1 }),
    ).toThrow()
  })

  test("rejects a non-session expectedSessionID", () => {
    expect(() => decode(MasterAgentResetPayload)({ expectedSessionID: "not-a-session", expectedRevision: 0 })).toThrow()
  })

  test("rejects a string expectedRevision", () => {
    expect(() =>
      decode(MasterAgentResetPayload)({ expectedSessionID: Session.ID.make("ses_test"), expectedRevision: "3" }),
    ).toThrow()
  })
})

describe("MasterAgent.GetResponse", () => {
  test("decodes a bound response", () => {
    const response = decode(MasterAgent.GetResponse)({ status: "bound", binding })

    expect(response).toEqual({ status: "bound", binding })
  })

  test("decodes an unbound response", () => {
    const response = decode(MasterAgent.GetResponse)({ status: "unbound" })

    expect(response).toEqual({ status: "unbound" })
  })

  test("rejects an unknown status", () => {
    expect(() => decode(MasterAgent.GetResponse)({ status: "other" })).toThrow()
  })
})

describe("MasterAgent.Binding", () => {
  test("round-trips through its schema", () => {
    const encoded = Schema.encodeSync(MasterAgent.Binding)(binding)

    expect(Schema.decodeUnknownSync(MasterAgent.Binding)(encoded)).toEqual(binding)
  })
})

describe("MasterAgent.ResetResponse", () => {
  test("decodes a reset status with the new binding", () => {
    const response = decode(MasterAgent.ResetResponse)({ status: "reset", binding })

    expect(response).toEqual({ status: "reset", binding })
  })

  test("decodes a stale status with the current revision", () => {
    const response = decode(MasterAgent.ResetResponse)({ status: "stale", currentRevision: 4 })

    expect(response).toEqual({ status: "stale", currentRevision: 4 })
  })

  test("decodes a busy status with a reason", () => {
    const response = decode(MasterAgent.ResetResponse)({ status: "busy", reason: "session-active" })

    expect(response).toEqual({ status: "busy", reason: "session-active" })
  })

  test("rejects an unknown status", () => {
    expect(() => decode(MasterAgent.ResetResponse)({ status: "other" })).toThrow()
  })
})

function expectErrorDecode<S extends Schema.Decoder<unknown> & { readonly Type: { readonly _tag: string } }>(
  schema: S,
  input: Record<string, unknown>,
  tag: string,
) {
  return () => {
    const error = decode(schema)({ _tag: tag, ...input })

    expect(error._tag).toBe(tag)
  }
}

describe("MasterAgent error schemas", () => {
  test(
    "MasterAgentWorkspaceNotFoundError decodes its data schema",
    expectErrorDecode(MasterAgentWorkspaceNotFoundError, {
      workspaceID: Workspace.ID.make("wrk_test"),
      message: "missing",
    }, "MasterAgentWorkspaceNotFoundError"),
  )

  test(
    "MasterAgentBlockNotFoundError decodes its data schema",
    expectErrorDecode(MasterAgentBlockNotFoundError, {
      workspaceID: Workspace.ID.make("wrk_test"),
      blockID: "block-1",
      message: "missing",
    }, "MasterAgentBlockNotFoundError"),
  )

  test(
    "MasterAgentWrongFunctionalityError decodes its data schema",
    expectErrorDecode(MasterAgentWrongFunctionalityError, {
      blockID: "block-1",
      actual: "builtin:chat",
      message: "wrong functionality",
    }, "MasterAgentWrongFunctionalityError"),
  )

  test(
    "MasterAgentWrongFunctionalityError decodes without the optional actual",
    expectErrorDecode(MasterAgentWrongFunctionalityError, {
      blockID: "block-1",
      message: "wrong functionality",
    }, "MasterAgentWrongFunctionalityError"),
  )

  test(
    "MasterAgentInstanceNotFoundError decodes its data schema",
    expectErrorDecode(MasterAgentInstanceNotFoundError, {
      workspaceID: Workspace.ID.make("wrk_test"),
      blockID: "block-1",
      message: "missing",
    }, "MasterAgentInstanceNotFoundError"),
  )

  test(
    "MasterAgentAccessDeniedError decodes its data schema",
    expectErrorDecode(MasterAgentAccessDeniedError, {
      workspaceID: Workspace.ID.make("wrk_test"),
      blockID: "block-1",
      message: "denied",
    }, "MasterAgentAccessDeniedError"),
  )

  test(
    "MasterAgentStaleBindingError decodes its data schema",
    expectErrorDecode(MasterAgentStaleBindingError, {
      currentRevision: 4,
      message: "stale",
    }, "MasterAgentStaleBindingError"),
  )

  test(
    "MasterAgentBusyError decodes its data schema",
    expectErrorDecode(MasterAgentBusyError, {
      sessionID: Session.ID.make("ses_test"),
      message: "busy",
    }, "MasterAgentBusyError"),
  )

  test(
    "MasterAgentConflictError decodes its data schema",
    expectErrorDecode(MasterAgentConflictError, { message: "conflict" }, "MasterAgentConflictError"),
  )
})
