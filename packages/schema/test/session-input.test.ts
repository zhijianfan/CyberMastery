import { describe, expect, test } from "bun:test"
import { Option, Schema } from "effect"
import { SessionInput } from "../src/session-input"

const decode = (payload: unknown) => Schema.decodeUnknownSync(SessionInput.SessionContextSnapshot)(payload)

const decodeOption = (payload: unknown) => Schema.decodeUnknownOption(SessionInput.SessionContextSnapshot)(payload)

const validV2 = {
  version: 2,
  rendererVersion: 1,
  contextRequestHash: "sha256:request",
  apiContent: '{"input":{"text":"valid"}}',
  apiContentHash: "sha256:api-content",
  attachments: [],
  recall: {
    policy: "disabled",
    status: "disabled",
  },
  byteLength: 1,
  estimatedTokens: 1,
  createdAt: 1700000000000,
}

describe("SessionContextSnapshot", () => {
  test("decodes the current version-1 snapshot unchanged", () => {
    const snapshot: SessionInput.SessionContextSnapshotV1 = {
      version: 1,
      attachments: [
        {
          contextCapsuleID: "capsule_one",
          sourceCtxPackID: "ctxpk_one",
          label: "Guide",
          contentHash: "sha256:pack",
          fragments: [
            {
              text: "First fragment",
              source: { workspaceID: "wrk_one", blockID: "block_1", functionalityID: "builtin:chat" },
              contentHash: "sha256:frag1",
            },
            {
              text: "Second fragment",
              source: { workspaceID: "wrk_one", blockID: "block_2", functionalityID: "builtin:chat" },
              contentHash: "sha256:frag2",
            },
          ],
        },
      ],
      byteLength: 128,
      estimatedTokens: 32,
      createdAt: 1700000000000,
    }
    expect(decode(snapshot)).toEqual(snapshot)
  })

  test("decodes version-2 snapshots with API content fields, compact provenance, recall policy/status, and size metadata", () => {
    const snapshot: SessionInput.SessionContextSnapshotV2 = {
      version: 2,
      rendererVersion: 1,
      contextRequestHash: "sha256:req_hash",
      apiContent: '{"input":{"text":"cacheable context"}}',
      apiContentHash: "sha256:api_content_hash",
      attachments: [
        {
          selection: "explicit",
          contextCapsuleID: "capsule_explicit",
          sourceCtxPackID: "ctxpk_explicit",
          label: "Explicit notes",
          contentHash: "sha256:explicit",
        },
        {
          selection: "automatic",
          sourceCtxPackID: "ctxpk_auto",
          label: "Automatic recall",
          contentHash: "sha256:auto",
        },
      ],
      recall: {
        policy: "operating-chat-v1",
        status: "selected",
      },
      byteLength: 2048,
      estimatedTokens: 512,
      createdAt: 1700000000000,
    }

    expect(decode(snapshot)).toEqual(snapshot)
  })

  test("accepts zero attachments for no-recall decisions", () => {
    const snapshot: SessionInput.SessionContextSnapshotV2 = {
      version: 2,
      rendererVersion: 1,
      contextRequestHash: "sha256:empty_recall",
      apiContent: '{"input":{"text":"no-context"}}',
      apiContentHash: "sha256:no_context",
      attachments: [],
      recall: {
        policy: "operating-chat-v1",
        status: "no-match",
      },
      byteLength: 0,
      estimatedTokens: 0,
      createdAt: 1700000000000,
    }

    expect(decode(snapshot)).toEqual(snapshot)
  })

  test("rejects unsupported versions", () => {
    expect(Option.isNone(decodeOption({ version: 99 }))).toBe(true)
  })

  test.each([
    ["a missing context request hash", { ...validV2, contextRequestHash: undefined }],
    ["a missing API content hash", { ...validV2, apiContentHash: undefined }],
    [
      "a missing attachment content hash",
      {
        ...validV2,
        attachments: [{ selection: "automatic", sourceCtxPackID: "ctxpk", label: "missing", contentHash: undefined }],
      },
    ],
    [
      "an invalid attachment selection",
      {
        ...validV2,
        attachments: [{ selection: "manual", sourceCtxPackID: "ctxpk", label: "invalid", contentHash: "sha256:1" }],
      },
    ],
    ["a negative byte length", { ...validV2, byteLength: -1 }],
    ["a negative estimated token count", { ...validV2, estimatedTokens: -1 }],
  ])("rejects %s", (_name, payload) => {
    expect(Option.isNone(decodeOption(payload))).toBe(true)
  })

  test("preserves explicit attachment order", () => {
    const snapshot = decode({
      version: 2,
      rendererVersion: 1,
      contextRequestHash: "sha256:ordered",
      apiContent: '{"input":{"text":"ordered"}}',
      apiContentHash: "sha256:ordered_content",
      attachments: [
        {
          selection: "explicit",
          contextCapsuleID: "capsule_a",
          sourceCtxPackID: "ctxpk_a",
          label: "A",
          contentHash: "sha256:a",
        },
        {
          selection: "automatic",
          sourceCtxPackID: "ctxpk_b",
          label: "B",
          contentHash: "sha256:b",
        },
      ],
      recall: {
        policy: "operating-chat-v1",
        status: "selected",
      },
      byteLength: 10,
      estimatedTokens: 4,
      createdAt: 1700000000000,
    })

    const labels = snapshot.attachments.map((attachment) => attachment.label)
    expect(labels).toEqual(["A", "B"])
  })

  test("requires explicit provenance to include a capsule ID but forbids it for automatic provenance", () => {
    expect(
      Option.isNone(
        decodeOption({
          version: 2,
          rendererVersion: 1,
          contextRequestHash: "sha256:invalid",
          apiContent: '{"input":{"text":"missing capsule"}}',
          apiContentHash: "sha256:invalid",
          attachments: [
            {
              selection: "explicit",
              sourceCtxPackID: "ctxpk_no_capsule",
              label: "missing",
              contentHash: "sha256:1",
            },
          ],
          recall: {
            policy: "disabled",
            status: "disabled",
          },
          byteLength: 1,
          estimatedTokens: 1,
          createdAt: 1700000000000,
        }),
      ),
    ).toBe(true)
    expect(
      Option.isNone(
        decodeOption({
          version: 2,
          rendererVersion: 1,
          contextRequestHash: "sha256:invalid",
          apiContent: '{"input":{"text":"extra capsule"}}',
          apiContentHash: "sha256:invalid",
          attachments: [
            {
              selection: "automatic",
              contextCapsuleID: "capsule_extra",
              sourceCtxPackID: "ctxpk_auto",
              label: "auto",
              contentHash: "sha256:2",
            },
          ],
          recall: {
            policy: "operating-chat-v1",
            status: "unavailable",
          },
          byteLength: 1,
          estimatedTokens: 1,
          createdAt: 1700000000000,
        }),
      ),
    ).toBe(true)
  })
})
