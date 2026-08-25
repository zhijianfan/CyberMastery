import { describe, expect, test } from "bun:test"
import { Option, Schema } from "effect"
import { SessionEvent } from "../src/session-event"

const admitted = {
  timestamp: 1787600000000,
  sessionID: "ses_context",
  messageID: "msg_context",
  prompt: { text: "Question" },
  delivery: "steer",
} as const

describe("SessionEvent.PromptAdmitted", () => {
  test("accepts an omitted marker or the literal model context version 2", () => {
    expect(Schema.encodeSync(SessionEvent.PromptAdmitted.data)(Schema.decodeUnknownSync(SessionEvent.PromptAdmitted.data)(admitted))).toEqual(
      admitted,
    )
    expect(
      Schema.encodeSync(SessionEvent.PromptAdmitted.data)(
        Schema.decodeUnknownSync(SessionEvent.PromptAdmitted.data)({ ...admitted, modelContextVersion: 2 }),
      ),
    ).toEqual({ ...admitted, modelContextVersion: 2 })
  })

  test("rejects every model context marker except literal 2", () => {
    expect(
      [1, 3, "2", null].map((modelContextVersion) =>
        Option.isNone(Schema.decodeUnknownOption(SessionEvent.PromptAdmitted.data)({ ...admitted, modelContextVersion })),
      ),
    ).toEqual([true, true, true, true])
  })

  test("keeps the public marker content-free", () => {
    const decoded = Schema.decodeUnknownSync(SessionEvent.PromptAdmitted.data)({
      ...admitted,
      modelContextVersion: 2,
      apiContent: "private",
      sourceCtxPackID: "ctxpk_private",
      query: "private query",
      contentHash: "sha256:private",
    })
    const encoded = Schema.encodeSync(SessionEvent.PromptAdmitted.data)(decoded)

    expect(encoded).toEqual({ ...admitted, modelContextVersion: 2 })
    expect(JSON.stringify(encoded)).not.toContain("private")
  })
})
