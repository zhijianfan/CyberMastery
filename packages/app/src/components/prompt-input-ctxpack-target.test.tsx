import { describe, expect, test } from "bun:test"
import { contextTarget } from "./prompt-input/composer-id"

describe("PromptInput CtxPack target plumbing", () => {
  test("V1 and V2 share the same generic target projection", () => {
    const expected = {
      instanceID: "chat-instance:session-123",
      functionalityID: "builtin:chat",
    }
    expect(contextTarget("session-123")).toEqual(expected)
    expect(contextTarget("session-123")).toEqual(expected)
  })

  test("an OperatingChat projection preserves its live capability subject", () => {
    const expected = {
      instanceID: "instance-operating-chat",
      functionalityID: "builtin:operating-chat-session",
    }
    expect(contextTarget("session-123", expected)).toBe(expected)
  })
})
