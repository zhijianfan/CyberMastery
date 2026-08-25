import { describe, expect, test } from "bun:test"
import { resolveCtxPackComposerTarget } from "./composer-id"

describe("CtxPack composer target", () => {
  test("derives the canonical generic target from an established Session", () => {
    expect(resolveCtxPackComposerTarget(" session-123 ", undefined)).toEqual({
      instanceID: "chat-instance:session-123",
      functionalityID: "builtin:chat",
    })
  })

  test("uses a valid explicit target for an established Session", () => {
    expect(
      resolveCtxPackComposerTarget("session-123", {
        instanceID: " instance-1 ",
        functionalityID: " builtin:operating-chat-session ",
      }),
    ).toEqual({
      instanceID: "instance-1",
      functionalityID: "builtin:operating-chat-session",
    })
  })

  test("fails closed without a Session or with an explicitly invalid override", () => {
    expect(resolveCtxPackComposerTarget(undefined, undefined)).toBeUndefined()
    expect(
      resolveCtxPackComposerTarget(undefined, {
        instanceID: "instance-1",
        functionalityID: "builtin:operating-chat-session",
      }),
    ).toBeUndefined()
    expect(
      resolveCtxPackComposerTarget("session-123", {
        instanceID: " ",
        functionalityID: "builtin:operating-chat-session",
      }),
    ).toBeUndefined()
    expect(resolveCtxPackComposerTarget("session-123", {} as never)).toBeUndefined()
    expect(resolveCtxPackComposerTarget("session-123", null as never)).toBeUndefined()
  })
})
