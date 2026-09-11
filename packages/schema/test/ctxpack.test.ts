import { describe, expect, test } from "bun:test"
import { Option, Schema } from "effect"
import { CtxPack } from "../src/ctxpack"

const source: CtxPack.Source = {
  workspaceID: "ws-1",
  blockID: "block-1",
  functionalityID: "builtin:chat",
  kind: "message",
  direction: "received",
  sourceTimestamp: 1787300000000,
  capturedAt: 1787300010000,
  entityRef: { type: "message", id: "msg-1" },
  label: "Assistant response",
  metadata: {},
  sensitivity: "workspace",
}

const valid = () => ({
  workspaceID: "ws-1",
  title: "Niagara pump findings",
  keywords: ["Niagara", "pump"],
  sensitivity: "workspace",
  fragments: [
    {
      clientFragmentID: "frag-1",
      text: "Pressure is written after the post-pressure stage.",
      source,
    },
  ],
  idempotencyKey: "create-1",
})

const decode = (payload: unknown) => Schema.decodeUnknownOption(CtxPack.CreateRequest)(payload)

describe("CtxPack.CreateRequest", () => {
  test("preserves ParallelPlan tags separately from keywords and rejects unknown tags", () => {
    const request = Schema.decodeUnknownSync(CtxPack.CreateRequest)({ ...valid(), tags: ["ParallelPlan"] })
    expect(request.tags).toEqual(["ParallelPlan"])
    expect(request.keywords).toEqual(valid().keywords)
    expect(Option.isNone(decode({ ...valid(), tags: ["arbitrary-keyword"] }))).toBe(true)
    const legacy = Schema.decodeUnknownSync(CtxPack.CreateRequest)(valid())
    expect(Schema.encodeSync(CtxPack.CreateRequest)(legacy)).not.toHaveProperty("tags")
  })

  test("decodes a valid one-fragment create request", () => {
    const request = Schema.decodeUnknownSync(CtxPack.CreateRequest)(valid())

    expect(request.workspaceID).toBe("ws-1")
    expect(request.title).toBe("Niagara pump findings")
    expect(request.keywords).toEqual(["Niagara", "pump"])
    expect(request.sensitivity).toBe("workspace")
    expect(request.idempotencyKey).toBe("create-1")
    expect(request.fragments).toHaveLength(1)
    expect(request.fragments[0]!.clientFragmentID).toBe("frag-1")
    expect(request.fragments[0]!.text).toBe("Pressure is written after the post-pressure stage.")
    expect(request.fragments[0]!.source).toEqual(source)
  })

  // M1: the wire CreateRequest carries no refinements (httpapi-codegen
  // portability). Limit enforcement lives in the core service (validation.ts)
  // and is covered by the core ctxpack-service suite; the schema layer decodes
  // whatever structurally valid input arrives.
  test("decodes a whitespace-only title at the wire layer (service rejects it)", () => {
    expect(Option.isSome(decode({ ...valid(), title: "   " }))).toBe(true)
  })

  test("decodes more than 32 fragments at the wire layer (service rejects it)", () => {
    const fragments = Array.from({ length: 33 }, (_, index) => ({
      ...valid().fragments[0]!,
      clientFragmentID: `frag-${index}`,
    }))
    expect(Option.isSome(decode({ ...valid(), fragments }))).toBe(true)
  })

  test("decodes an empty-after-normalization fragment at the wire layer (service rejects it)", () => {
    const fragments = [{ ...valid().fragments[0]!, text: "  \r\n\t " }]
    expect(Option.isSome(decode({ ...valid(), fragments }))).toBe(true)
  })

  test("rejects a secret source sensitivity", () => {
    const fragments = [{ ...valid().fragments[0]!, source: { ...source, sensitivity: "secret" } }]
    expect(Option.isNone(decode({ ...valid(), fragments }))).toBe(true)
  })

  test("rejects an invalid pack sensitivity", () => {
    expect(Option.isNone(decode({ ...valid(), sensitivity: "top-secret" }))).toBe(true)
  })

  test("decodes a keyword longer than 48 code points at the wire layer (service rejects it)", () => {
    expect(Option.isSome(decode({ ...valid(), keywords: ["あ".repeat(49)] }))).toBe(true)
  })

  test("decodes more than 12 keywords at the wire layer (service rejects it)", () => {
    const keywords = Array.from({ length: 13 }, (_, index) => `keyword-${index}`)
    expect(Option.isSome(decode({ ...valid(), keywords }))).toBe(true)
  })

  test("decodes a cross-workspace fragment source at the wire layer (service rejects it)", () => {
    const fragments = [{ ...valid().fragments[0]!, source: { ...source, workspaceID: "ws-2" } }]
    expect(Option.isSome(decode({ ...valid(), fragments }))).toBe(true)
  })
})

describe("CtxPack.normalizeSelectedText", () => {
  test("collapses CRLF and lone CR to LF, trims trailing spaces per line, preserves internal blank lines and indentation", () => {
    expect(CtxPack.normalizeSelectedText("a\r\nb\rc\n")).toBe("a\nb\nc")
    expect(CtxPack.normalizeSelectedText("  hello  \r\n\r\n    world\t \n")).toBe("hello\n\n    world")
    expect(CtxPack.normalizeSelectedText("  padded  ")).toBe("padded")
  })
})

describe("CtxPack.normalizeKeyword", () => {
  test("applies NFKC and collapses whitespace", () => {
    expect(CtxPack.normalizeKeyword("  Ｎｉａｇａｒａ\t  ｐｕｍｐ  ")).toBe("Niagara pump")
    expect(CtxPack.normalizeKeyword("A　B\nC")).toBe("A B C")
  })
})

describe("CtxPack.contentHash", () => {
  const fragments = [{ ordinal: 0, text: "Pressure is written after the post-pressure stage.", source }]

  test("is deterministic", () => {
    expect(CtxPack.contentHash(fragments)).toBe(CtxPack.contentHash(fragments))
    expect(CtxPack.contentHash(fragments)).toBe(CtxPack.contentHash([{ ...fragments[0]! }]))
  })

  test("changes when fragment text changes", () => {
    expect(
      CtxPack.contentHash([{ ...fragments[0]!, text: "Pressure is written after the post-pressure stage!" }]),
    ).not.toBe(CtxPack.contentHash(fragments))
  })

  test("hashes normalized text, so pre-normalized variants are stable", () => {
    expect(CtxPack.contentHash([{ ...fragments[0]!, text: " Pressure \r\nis written " }])).toBe(
      CtxPack.contentHash([{ ...fragments[0]!, text: "Pressure\nis written" }]),
    )
  })

  test("is a sha256 hex digest with the sha256: prefix", () => {
    expect(CtxPack.contentHash(fragments)).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

describe("CtxPack.estimateTokens", () => {
  test("is ceil(bytes / 4)", () => {
    expect(CtxPack.estimateTokens(0)).toBe(0)
    expect(CtxPack.estimateTokens(1)).toBe(1)
    expect(CtxPack.estimateTokens(4)).toBe(1)
    expect(CtxPack.estimateTokens(5)).toBe(2)
    expect(CtxPack.estimateTokens(4000)).toBe(1000)
  })

  test("utf8ByteLength counts multi-byte characters", () => {
    expect(CtxPack.utf8ByteLength("é")).toBe(2)
    expect(CtxPack.utf8ByteLength("Pressure is written after the post-pressure stage.")).toBe(50)
  })
})

describe("CtxPack.CtxPackChanged", () => {
  test("has the workspace.ctxpack.changed type", () => {
    expect(CtxPack.CtxPackChanged.type).toBe("workspace.ctxpack.changed")
  })

  test("decodes a payload", () => {
    const event = Schema.decodeUnknownSync(CtxPack.CtxPackChanged)({
      id: "evt_test123",
      type: "workspace.ctxpack.changed",
      data: {
        workspaceID: "ws-1",
        ctxPackID: "ctxpk_1",
        revision: 1,
        change: "created",
      },
    })

    expect(event.id.startsWith("evt_")).toBe(true)
    expect(event.type).toBe("workspace.ctxpack.changed")
    expect(event.data).toEqual({ workspaceID: "ws-1", ctxPackID: "ctxpk_1", revision: 1, change: "created" })
  })
})
