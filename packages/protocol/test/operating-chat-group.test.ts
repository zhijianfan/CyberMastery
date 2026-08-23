import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { OperatingChatGroup } from "../src/groups/operating-chat"

const errorIds = (endpoint: { error: ReadonlySet<Schema.Top> }) =>
  [...endpoint.error].map((schema) => schema.ast.annotations?.identifier)

describe("OperatingChatGroup", () => {
  test("exposes the workspace-scoped lifecycle routes", () => {
    expect(Object.keys(OperatingChatGroup.endpoints).sort()).toEqual([
      "workspace.operatingChat.ensure",
      "workspace.operatingChat.get",
      "workspace.operatingChat.reset",
    ])
    expect(OperatingChatGroup.endpoints["workspace.operatingChat.get"].path).toBe(
      "/api/workspace/:workspaceID/operating-chat/:blockID",
    )
    expect(OperatingChatGroup.endpoints["workspace.operatingChat.ensure"].path).toBe(
      "/api/workspace/:workspaceID/operating-chat/:blockID/ensure",
    )
  })

  test("declares missing model configuration and guarded reset failures", () => {
    expect(errorIds(OperatingChatGroup.endpoints["workspace.operatingChat.ensure"])).toContain(
      "OperatingChatConfigurationError",
    )
    expect(errorIds(OperatingChatGroup.endpoints["workspace.operatingChat.reset"])).toEqual(
      expect.arrayContaining([
        "OperatingChatConfigurationError",
        "OperatingChatStaleBindingError",
        "OperatingChatBusyError",
      ]),
    )
  })
})
