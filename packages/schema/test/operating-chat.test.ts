import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { OperatingChat } from "../src/operating-chat"
import { Session } from "../src/session"
import { Workspace } from "../src/workspace"

const binding = {
  workspaceID: Workspace.ID.make("wrk_test"),
  blockID: "block-1",
  functionalityInstanceID: "instance-1",
  sessionID: Session.ID.make("ses_test"),
  directory: "D:/workspace",
  generation: 0,
  revision: 1,
}

describe("OperatingChat contract", () => {
  test("round-trips owned instance configuration and binding", () => {
    const configuration = {
      version: 1 as const,
      directoryBinding: { mode: "workspace-primary" as const },
      sessionBinding: { mode: "owned" as const, sessionID: Session.ID.make("ses_test"), generation: 2 },
    }

    expect(Schema.decodeUnknownSync(OperatingChat.InstanceConfiguration)(configuration)).toEqual(configuration)
    expect(Schema.decodeUnknownSync(OperatingChat.Binding)(binding)).toEqual(binding)
  })

  test("accepts bound and unbound get responses", () => {
    expect(Schema.decodeUnknownSync(OperatingChat.GetResponse)({ status: "bound", binding })).toEqual({
      status: "bound",
      binding,
    })
    expect(Schema.decodeUnknownSync(OperatingChat.GetResponse)({ status: "unbound" })).toEqual({ status: "unbound" })
  })

  test("publishes one canonical binding event", () => {
    expect(OperatingChat.Definitions).toEqual([OperatingChat.BindingUpdated])
    expect(OperatingChat.BindingUpdated.type).toBe("workspace.operatingChat.binding.updated")
  })
})
