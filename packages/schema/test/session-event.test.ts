import { describe, expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
import { SessionEvent } from "../src/session-event"

describe("SessionEvent.PromptAdmitted", () => {
  const data = {
    timestamp: 1700000000000,
    sessionID: "ses_ctxpack_1",
    messageID: "msg_ctxpack_1",
    prompt: { text: "hello" },
    delivery: "steer" as const,
  }
  const base = {
    id: "evt_ctxpack_1",
    type: "session.next.prompt.admitted",
    data,
  }

  const decode = (payload: unknown) => Schema.decodeUnknownSync(SessionEvent.PromptAdmitted)(payload)

  test("accepts only an optional literal modelContextVersion of 2", () => {
    const decodedBase = decode(base)
    expect(String(decodedBase.id)).toBe(base.id)
    expect(decodedBase.type).toBe("session.next.prompt.admitted")
    expect(decodedBase.data.delivery).toBe("steer")
    expect(DateTime.toEpochMillis(decodedBase.data.timestamp)).toBe(base.data.timestamp)
    expect(decode({ ...base, data: { ...data, modelContextVersion: 2 } }).data.modelContextVersion).toBe(2)
    expect(() => decode({ ...base, data: { ...data, modelContextVersion: 1 } })).toThrow()
    expect(() => decode({ ...base, data: { ...data, modelContextVersion: 3 } })).toThrow()
  })

  test("is a content-free marker without rendered context fields", () => {
    const leakFields = [
      "apiContent",
      "apiContentHash",
      "contextCapsuleID",
      "ctxPackID",
      "sourceCtxPackID",
      "contentHash",
      "query",
    ] as const
    for (const key of leakFields) {
      const leaked = decode({
        ...base,
        data: {
          ...data,
          [key]: key === "query" ? "search terms" : "sha256:leak",
        },
      })
      expect(Object.prototype.hasOwnProperty.call(leaked.data, key)).toBe(false)
    }
  })
})
