import { describe, expect, test } from "bun:test"
import {
  CTXPACK_DRAG_MIME,
  applyCtxPackDrag,
  parseCtxPackDragPayload,
  serializeCtxPackDragPayload,
  type CtxPackDragPayloadV1,
} from "./drag"

const VALID_PAYLOAD: CtxPackDragPayloadV1 = {
  version: 1,
  workspaceID: "ws-1",
  ctxPackID: "pack-1",
  contentHash: "sha256:abc123",
  label: "Project brief",
  estimatedTokens: 2048,
}

const FROZEN_KEYS = [
  "contentHash",
  "ctxPackID",
  "estimatedTokens",
  "label",
  "version",
  "workspaceID",
].sort()

function makeDataTransfer(entries: Record<string, string> = {}): DataTransfer {
  const store = new Map<string, string>(Object.entries(entries))
  const transfer = {
    getData(type: string) {
      return store.get(type) ?? ""
    },
    setData(type: string, value: string) {
      store.set(type, value)
    },
    dropEffect: "none",
    effectAllowed: "uninitialized",
  }
  return transfer as unknown as DataTransfer
}

function transferWithPayload(payload: unknown): DataTransfer {
  return makeDataTransfer({ [CTXPACK_DRAG_MIME]: JSON.stringify(payload) })
}

describe("serializeCtxPackDragPayload", () => {
  test("emits exactly the six frozen keys — no payload text field", () => {
    const raw = serializeCtxPackDragPayload(VALID_PAYLOAD)
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(FROZEN_KEYS)
    expect(parsed).toEqual({ ...VALID_PAYLOAD })
  })
})

describe("parseCtxPackDragPayload", () => {
  test("round trips a payload written by applyCtxPackDrag", () => {
    const transfer = makeDataTransfer()
    applyCtxPackDrag(transfer, VALID_PAYLOAD)
    expect(parseCtxPackDragPayload(transfer)).toEqual(VALID_PAYLOAD)
  })

  test("applyCtxPackDrag writes only the label to text/plain and declares a copy effect", () => {
    const transfer = makeDataTransfer()
    applyCtxPackDrag(transfer, VALID_PAYLOAD)
    expect(transfer.getData(CTXPACK_DRAG_MIME)).toBe(serializeCtxPackDragPayload(VALID_PAYLOAD))
    expect(transfer.getData("text/plain")).toBe(VALID_PAYLOAD.label)
    expect(transfer.effectAllowed).toBe("copy")
  })

  test("empty transfer yields null", () => {
    expect(parseCtxPackDragPayload(makeDataTransfer())).toBeNull()
  })

  test("transfer with unrelated MIME types only yields null", () => {
    const transfer = makeDataTransfer({
      "text/plain": "some arbitrary text",
      "text/uri-list": "https://example.com/thing",
    })
    expect(parseCtxPackDragPayload(transfer)).toBeNull()
  })

  test("malformed JSON yields null", () => {
    const transfer = makeDataTransfer({ [CTXPACK_DRAG_MIME]: "{oops" })
    expect(parseCtxPackDragPayload(transfer)).toBeNull()
  })

  test("non-object JSON yields null", () => {
    for (const raw of ["[]", '"hello"', "42", "null", "true"]) {
      expect(parseCtxPackDragPayload(makeDataTransfer({ [CTXPACK_DRAG_MIME]: raw }))).toBeNull()
    }
  })

  test("unknown version yields null", () => {
    expect(parseCtxPackDragPayload(transferWithPayload({ ...VALID_PAYLOAD, version: 2 }))).toBeNull()
    expect(parseCtxPackDragPayload(transferWithPayload({ ...VALID_PAYLOAD, version: "1" }))).toBeNull()
  })

  test("missing field yields null", () => {
    const { version, workspaceID, ctxPackID, contentHash, estimatedTokens } = VALID_PAYLOAD
    expect(
      parseCtxPackDragPayload(
        transferWithPayload({ version, workspaceID, ctxPackID, contentHash, estimatedTokens }),
      ),
    ).toBeNull()
  })

  test("extra key yields null", () => {
    expect(
      parseCtxPackDragPayload(
        transferWithPayload({ ...VALID_PAYLOAD, text: "must never ride the transport" }),
      ),
    ).toBeNull()
  })

  test("empty string for a required field yields null", () => {
    expect(parseCtxPackDragPayload(transferWithPayload({ ...VALID_PAYLOAD, ctxPackID: "" }))).toBeNull()
    expect(parseCtxPackDragPayload(transferWithPayload({ ...VALID_PAYLOAD, label: "" }))).toBeNull()
  })

  test("non-numeric estimatedTokens yields null", () => {
    expect(
      parseCtxPackDragPayload(transferWithPayload({ ...VALID_PAYLOAD, estimatedTokens: "2048" })),
    ).toBeNull()
  })
})
