import { describe, expect, test } from "bun:test"
import { sessionContextTransferProof } from "../src/handlers/session"

describe("Session handler context transfer proof", () => {
  test("constructs a Core-private proof only from both valid internal headers", () => {
    const proof = sessionContextTransferProof({
      "x-opencode-session-context-topology": "revision-a",
      "x-opencode-session-context-lease": "a".repeat(64),
    })
    expect(proof).toMatchObject({ topologyRevision: "revision-a", requestToken: "a".repeat(64) })
    expect(sessionContextTransferProof({ "x-opencode-session-context-topology": "revision-a" })).toBeUndefined()
    expect(
      sessionContextTransferProof({
        "x-opencode-session-context-topology": "revision-a",
        "x-opencode-session-context-lease": "forged",
      }),
    ).toBeUndefined()
  })
})
