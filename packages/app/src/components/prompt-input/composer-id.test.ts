import { describe, expect, test } from "bun:test"
import { contextTarget } from "./composer-id"

describe("CtxPack composer identity", () => {
  test("established generic sessions use the canonical chat target", () => {
    expect(contextTarget("session-123")).toEqual({
      instanceID: "chat-instance:session-123",
      functionalityID: "builtin:chat",
    })
  })

  test("explicit projections override generic targets", () => {
    const override = {
      instanceID: "instance-operating-chat",
      functionalityID: "builtin:operating-chat-session",
    }
    expect(contextTarget("session-123", override)).toBe(override)
  })

  test("composers without a session have no context target", () => {
    expect(contextTarget(undefined)).toBeUndefined()
  })
})
