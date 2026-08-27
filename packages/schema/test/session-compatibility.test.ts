import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionV1 } from "../src/session-v1"
import { legacyPartID } from "../src/session-compatibility"

const input = {
  messageID: "msg_compatibility",
  ordinal: 0,
  family: "text" as const,
  key: "part-0",
}

describe("legacyPartID", () => {
  test("is deterministic and valid as a V1 PartID", async () => {
    const first = await legacyPartID(input)
    const second = await legacyPartID({ ...input })

    expect(first).toBe(second)
    expect(Schema.decodeUnknownSync(SessionV1.PartID)(first)).toBe(first)
    expect(first).toMatch(/^prt_\d{2}\d+_[a-z-]+_[A-Za-z0-9_-]{43}$/)
  })

  test("binds every tuple component and accepts long valid strings", async () => {
    const long = "msg_" + "x".repeat(100_000)
    const base = await legacyPartID({ ...input, messageID: long })
    const changed = await legacyPartID({ ...input, messageID: long + "x" })
    const changedOrdinal = await legacyPartID({ ...input, ordinal: 1 })
    const changedFamily = await legacyPartID({ ...input, family: "file" })
    const changedKey = await legacyPartID({ ...input, key: "part-1" })

    expect(new Set([base, changed, changedOrdinal, changedFamily, changedKey]).size).toBe(5)
  })

  test("orders the readable ordinal key through the maximum array index", async () => {
    const first = await legacyPartID({ ...input, ordinal: 9 })
    const second = await legacyPartID({ ...input, ordinal: 10 })
    const last = await legacyPartID({ ...input, ordinal: 2 ** 32 - 2 })

    expect(first < second).toBe(true)
    expect(second < last).toBe(true)
    await expect(legacyPartID({ ...input, ordinal: 2 ** 32 - 1 })).rejects.toThrow()
  })
})
