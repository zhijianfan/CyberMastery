import { describe, expect, test } from "bun:test"

import type { Payload } from "@opencode-ai/schema/event"
import { isRelevant, translateEvent } from "./block-runtime-gateway"

// Native payloads mirror EventV2.Payload: { id, type, data, durable? }.
const event = (type: string, data: Record<string, unknown>, aggregateID?: string, seq?: number): Payload =>
  ({
    id: `evt_${type.replaceAll(".", "_")}`,
    type,
    data,
    ...(aggregateID !== undefined && seq !== undefined
      ? { durable: { aggregateID, seq, version: 1 } }
      : {}),
  }) as Payload

describe("translateEvent", () => {
  test("maps prompt admission to a user message", () => {
    const envelope = translateEvent(event("session.next.prompt.admitted", { sessionID: "ses_1", messageID: "msg_1" }, "ses_1", 4))

    expect(envelope._tag).toBe("Some")
    if (envelope._tag === "Some") {
      expect(envelope.value.event).toBe("message.created")
      expect(envelope.value.resource).toEqual({ type: "message", id: "msg_1", parentID: "ses_1" })
      expect(envelope.value.data).toEqual({ id: "msg_1", sessionID: "ses_1", role: "user" })
    }
  })

  test("maps text deltas to text part updates", () => {
    const envelope = translateEvent(
      event("session.next.text.delta", { sessionID: "ses_1", assistantMessageID: "msg_2", textID: "txt_1", delta: "hel" }),
    )

    expect(envelope._tag).toBe("Some")
    if (envelope._tag === "Some") {
      expect(envelope.value.event).toBe("message-part.updated")
      expect(envelope.value.data).toEqual({ id: "txt_1", messageID: "msg_2", kind: "text", text: "hel" })
    }
  })

  test("maps reasoning deltas to reasoning part updates", () => {
    const envelope = translateEvent(
      event("session.next.reasoning.delta", { sessionID: "ses_1", assistantMessageID: "msg_2", textID: "rsn_1", delta: "think" }),
    )

    expect(envelope._tag).toBe("Some")
    if (envelope._tag === "Some") {
      expect(envelope.value.data).toEqual({ id: "rsn_1", messageID: "msg_2", kind: "reasoning", text: "think" })
    }
  })

  test("maps tool events to tool part updates", () => {
    const envelope = translateEvent(
      event("session.next.tool.called", { sessionID: "ses_1", assistantMessageID: "msg_2", callID: "call_1", state: { status: "running" } }),
    )

    expect(envelope._tag).toBe("Some")
    if (envelope._tag === "Some") {
      expect(envelope.value.data).toMatchObject({ id: "call_1", messageID: "msg_2", kind: "tool" })
    }
  })

  test("maps permission asked/replied with the reply vocabulary", () => {
    const asked = translateEvent(event("permission.v2.asked", { id: "per_1", sessionID: "ses_1", action: "bash" }))
    expect(asked._tag).toBe("Some")
    if (asked._tag === "Some") {
      expect(asked.value.event).toBe("permission.requested")
      expect(asked.value.data).toEqual({ id: "per_1", requestID: "per_1", sessionID: "ses_1", status: "pending" })
    }

    const replied = translateEvent(
      event("permission.v2.replied", { sessionID: "ses_1", requestID: "per_1", reply: "always" }),
    )
    expect(replied._tag).toBe("Some")
    if (replied._tag === "Some") {
      expect(replied.value.event).toBe("permission.resolved")
      expect(replied.value.data).toEqual({
        id: "per_1",
        requestID: "per_1",
        sessionID: "ses_1",
        status: "resolved",
        response: "allow-always",
      })
    }
  })

  test("drops unknown event types", () => {
    expect(translateEvent(event("session.next.shell.started", { sessionID: "ses_1" }))._tag).toBe("None")
  })
})

describe("isRelevant", () => {
  const sessionIDs = new Set(["ses_1"])

  test("keeps events for bound session aggregates", () => {
    expect(isRelevant(event("session.next.text.delta", { sessionID: "ses_1" }, "ses_1", 9), sessionIDs, false)).toBe(true)
  })

  test("keeps live deltas carrying the bound sessionID", () => {
    expect(isRelevant(event("session.next.text.delta", { sessionID: "ses_1" }), sessionIDs, false)).toBe(true)
  })

  test("drops unrelated sessions", () => {
    expect(isRelevant(event("session.next.text.delta", { sessionID: "ses_other" }, "ses_other", 1), sessionIDs, false)).toBe(false)
  })

  test("keeps permission events when permission-bound", () => {
    expect(isRelevant(event("permission.v2.asked", { id: "per_1", sessionID: "ses_9" }), sessionIDs, true)).toBe(true)
    expect(isRelevant(event("permission.v2.asked", { id: "per_1", sessionID: "ses_9" }), sessionIDs, false)).toBe(false)
  })
})
