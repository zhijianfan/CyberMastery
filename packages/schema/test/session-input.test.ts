import { describe, expect, test } from "bun:test"
import { Option, Schema } from "effect"
import { SessionInput } from "../src/session-input"

const decode = (input: unknown) => Schema.decodeUnknownOption(SessionInput.SessionContextSnapshot)(input)

const v1 = {
  version: 1,
  attachments: [
    {
      contextCapsuleID: "capsule_1",
      sourceCtxPackID: "ctxpk_1",
      label: "Existing context",
      contentHash: "sha256:pack_1",
      fragments: [
        {
          text: "Existing fragment",
          source: { workspaceID: "wrk_1", blockID: "block_1" },
          contentHash: "sha256:fragment_1",
        },
      ],
    },
  ],
  byteLength: 17,
  estimatedTokens: 5,
  createdAt: 1787600000000,
} as const

const v2 = {
  version: 2,
  rendererVersion: 1,
  contextRequestHash: "sha256:request",
  apiContent: "Question\n\n<workspace-context>...</workspace-context>",
  apiContentHash: "sha256:api-content",
  attachments: [
    {
      selection: "explicit",
      contextCapsuleID: "capsule_1",
      sourceCtxPackID: "ctxpk_1",
      label: "Explicit context",
      contentHash: "sha256:explicit",
    },
    {
      selection: "automatic",
      sourceCtxPackID: "ctxpk_2",
      label: "Automatic context",
      contentHash: "sha256:automatic",
    },
  ],
  recall: { policy: "operating-chat-v1", status: "selected" },
  byteLength: 128,
  estimatedTokens: 32,
  createdAt: 1787600000001,
} as const

describe("SessionInput.SessionContextSnapshot", () => {
  test("decodes the existing version-1 snapshot unchanged", () => {
    expect(Schema.decodeUnknownSync(SessionInput.SessionContextSnapshot)(v1)).toEqual(v1)
  })

  test("decodes version 2 with exact content, compact provenance, recall decision, and measurements", () => {
    expect(Schema.decodeUnknownSync(SessionInput.SessionContextSnapshot)(v2)).toEqual(v2)
  })

  test("allows a version-2 no-recall decision with zero attachments", () => {
    const snapshot = {
      ...v2,
      apiContent: "Question",
      attachments: [],
      recall: { policy: "operating-chat-v1", status: "no-match" } as const,
      byteLength: 0,
      estimatedTokens: 0,
    }

    expect(Schema.decodeUnknownSync(SessionInput.SessionContextSnapshot)(snapshot)).toEqual(snapshot)
  })

  test("preserves version-2 attachment order", () => {
    const decoded = Schema.decodeUnknownSync(SessionInput.SessionContextSnapshot)(v2)

    expect(decoded.version).toBe(2)
    if (decoded.version !== 2) throw new Error("expected version 2")
    expect(decoded.attachments.map((attachment) => attachment.sourceCtxPackID)).toEqual(["ctxpk_1", "ctxpk_2"])
  })

  test("requires capsule provenance only for explicit selections", () => {
    expect(
      Option.isNone(
        decode({ ...v2, attachments: [{ ...v2.attachments[0], contextCapsuleID: undefined }] }),
      ),
    ).toBe(true)
    const automatic = Schema.decodeUnknownSync(SessionInput.SessionContextSnapshot)({
      ...v2,
      attachments: [{ ...v2.attachments[1], contextCapsuleID: "capsule_forbidden" }],
    })

    expect(automatic.version).toBe(2)
    if (automatic.version !== 2) throw new Error("expected version 2")
    expect(automatic.attachments[0]).not.toHaveProperty("contextCapsuleID")
  })

  test("rejects unsupported versions, missing hashes, invalid selections, and negative measurements", () => {
    const invalid = [
      { ...v2, version: 3 },
      { ...v2, contextRequestHash: undefined },
      { ...v2, apiContentHash: undefined },
      { ...v2, attachments: [{ ...v2.attachments[0], selection: "manual" }] },
      { ...v2, byteLength: -1 },
      { ...v2, estimatedTokens: -1 },
      { ...v2, createdAt: -1 },
    ]

    expect(invalid.map((input) => Option.isNone(decode(input)))).toEqual(invalid.map(() => true))
  })
})
