// Group tests for the CtxPack routes (Track P1).
//
// Asserts the frozen surface: group id, endpoint names and paths, params,
// payloads, success/error schemas, list query defaults and validation, the
// five-field materialize result, and error schema round-trips.

import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { HttpApi } from "effect/unstable/httpapi"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import {
  CtxPackBudgetExceededError,
  CtxPackContentChangedError,
  CtxPackCrossWorkspaceDeniedError,
  CtxPackDeletedError,
  CtxPackGroup,
  CtxPackInvalidSelectionError,
  CtxPackListQuery,
  CtxPackMaterializeRequest,
  CtxPackMaterializeResult,
  CtxPackNotFoundError,
  CtxPackPermissionDeniedError,
  CtxPackRevisionConflictError,
  CtxPackRevisionPayload,
  CtxPackSearchCursorInvalidError,
  CtxPackSecretSourceDeniedError,
} from "../src/groups/ctxpack"

const decode = (schema: Schema.Decoder<unknown>) => (input: unknown) => Schema.decodeUnknownSync(schema)(input)

const decodeListQuery = (input: unknown) => decode(CtxPackListQuery)(input) as Schema.Schema.Type<typeof CtxPackListQuery>

const workspaceID = "wrk_test"
const ctxPackID = "ctxpk_test1"

// S1 sample create request (satisfies the CreateRequest refines: non-empty
// title, keyword budget, 1..32 fragments, fragment workspace match).
const sampleCreateRequest = {
  workspaceID,
  title: "Test pack",
  keywords: ["alpha", "beta"],
  sensitivity: "workspace",
  fragments: [
    {
      clientFragmentID: "frag-1",
      text: "some selected text",
      source: {
        workspaceID,
        blockID: "block-1",
        functionalityID: "func-1",
        kind: "message",
        direction: "sent",
        sourceTimestamp: 1000,
        capturedAt: 2000,
        entityRef: null,
        label: null,
        metadata: {},
        sensitivity: "workspace",
      },
    },
  ],
  idempotencyKey: "idem-1",
}

const sampleSource = {
  workspaceID,
  blockID: "block-1",
  functionalityID: "func-1",
  kind: "message",
  direction: "sent",
  sourceTimestamp: 1000,
  capturedAt: 2000,
  entityRef: null,
  label: null,
  metadata: {},
  sensitivity: "workspace",
}

const sampleFragment = {
  id: "ctxpkf_test1",
  ordinal: 0,
  contentHash: "sha256:abc",
  byteLength: 18,
  estimatedTokens: 5,
  clientFragmentID: "frag-1",
  text: "some selected text",
  source: sampleSource,
}

const sampleInfo = {
  id: ctxPackID,
  workspaceID,
  title: "Test pack",
  keywords: [],
  sensitivity: "workspace",
  revision: 1,
  contentHash: "sha256:abc",
  byteLength: 18,
  estimatedTokens: 5,
  fragments: [sampleFragment],
  usage: { attachedCount: 0, lastAttachedAt: null },
  createdByUserID: "user-1",
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
}

const sampleSummary = {
  id: ctxPackID,
  workspaceID,
  title: "Test pack",
  keywords: [],
  sensitivity: "workspace",
  revision: 1,
  contentHash: "sha256:abc",
  byteLength: 18,
  estimatedTokens: 5,
  fragmentCount: 1,
  sourceBlockIDs: ["block-1"],
  sourceFunctionalityIDs: ["func-1"],
  sourceKinds: ["message"],
  usage: { attachedCount: 0, lastAttachedAt: null },
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
}

const sampleListResult = {
  items: [sampleSummary],
  nextCursor: null,
  totalEstimate: 1,
}

const sampleMaterializeRequest = {
  expectedContentHash: "sha256:abc",
  targetInstanceID: "chat-instance:1",
  targetFunctionalityID: "builtin:chat",
}
const sampleMaterializeResult = {
  contextCapsuleID: "capsule_1",
  sourceCtxPackID: ctxPackID,
  label: "Capsule label",
  contentHash: "sha256:abc",
  estimatedTokens: 12,
}

// The endpoint error sets hold schema views rather than the class references,
// so match on the annotated identifier (which equals the class name) instead.
const errorIds = (endpoint: { error: ReadonlySet<Schema.Top> }) =>
  [...endpoint.error].map((schema) => schema.ast.annotations?.identifier)

const payloadSchema = (endpoint: { payload: ReadonlyMap<string, { schemas: ReadonlyArray<Schema.Top> }> }) =>
  [...endpoint.payload.values()][0]!.schemas[0] as unknown as Schema.Decoder<unknown>

const successSchema = (endpoint: { success: ReadonlySet<Schema.Top> }) =>
  [...endpoint.success][0]! as unknown as Schema.Decoder<unknown>

const allErrorIds = [
  "CtxPackNotFoundError",
  "CtxPackDeletedError",
  "CtxPackRevisionConflictError",
  "CtxPackContentChangedError",
  "CtxPackInvalidSelectionError",
  "CtxPackBudgetExceededError",
  "CtxPackSecretSourceDeniedError",
  "CtxPackCrossWorkspaceDeniedError",
  "CtxPackPermissionDeniedError",
  "CtxPackSearchCursorInvalidError",
]

describe("CtxPackGroup surface", () => {
  test("exposes exactly the seven frozen endpoints", () => {
    expect(Object.keys(CtxPackGroup.endpoints).sort()).toEqual([
      "workspace.ctxpack.create",
      "workspace.ctxpack.get",
      "workspace.ctxpack.list",
      "workspace.ctxpack.materialize",
      "workspace.ctxpack.patch",
      "workspace.ctxpack.remove",
      "workspace.ctxpack.restore",
    ])
  })

  test("mounts under the frozen group id", () => {
    const api = HttpApi.make("server").add(CtxPackGroup)
    expect(api.groups["server.workspace.ctxpack"]).toBeDefined()
  })

  test("routes under the frozen paths", () => {
    expect(CtxPackGroup.endpoints["workspace.ctxpack.create"].path).toBe("/api/workspace/:workspaceID/ctxpack")
    expect(CtxPackGroup.endpoints["workspace.ctxpack.get"].path).toBe("/api/workspace/:workspaceID/ctxpack/:ctxPackID")
    expect(CtxPackGroup.endpoints["workspace.ctxpack.list"].path).toBe("/api/workspace/:workspaceID/ctxpack")
    expect(CtxPackGroup.endpoints["workspace.ctxpack.patch"].path).toBe("/api/workspace/:workspaceID/ctxpack/:ctxPackID")
    expect(CtxPackGroup.endpoints["workspace.ctxpack.remove"].path).toBe("/api/workspace/:workspaceID/ctxpack/:ctxPackID")
    expect(CtxPackGroup.endpoints["workspace.ctxpack.restore"].path).toBe(
      "/api/workspace/:workspaceID/ctxpack/:ctxPackID/restore",
    )
    expect(CtxPackGroup.endpoints["workspace.ctxpack.materialize"].path).toBe(
      "/api/workspace/:workspaceID/ctxpack/:ctxPackID/materialize",
    )
  })

  test("wires the frozen error schemas on every endpoint", () => {
    for (const endpoint of Object.values(CtxPackGroup.endpoints)) {
      expect(errorIds(endpoint)).toEqual(expect.arrayContaining(allErrorIds))
    }
  })
})

describe("CtxPack endpoint schemas", () => {
  test("params decode valid samples", () => {
    const params = CtxPackGroup.endpoints["workspace.ctxpack.create"].params as unknown as Schema.Decoder<unknown>
    expect(decode(params)({ workspaceID })).toEqual({ workspaceID })

    const idParams = CtxPackGroup.endpoints["workspace.ctxpack.get"].params as unknown as Schema.Decoder<unknown>
    expect(decode(idParams)({ workspaceID, ctxPackID })).toEqual({ workspaceID, ctxPackID })
  })

  test("create payload decodes the wire create payload (workspaceID comes from params)", () => {
    const payload = payloadSchema(CtxPackGroup.endpoints["workspace.ctxpack.create"])
    const { workspaceID: _workspaceID, ...wirePayload } = sampleCreateRequest
    expect(decode(payload)(wirePayload)).toEqual(wirePayload)
  })

  test("patch payload decodes a valid wire patch payload", () => {
    const payload = payloadSchema(CtxPackGroup.endpoints["workspace.ctxpack.patch"])
    const request = {
      expectedRevision: 1,
      patch: { title: "Renamed pack" },
      idempotencyKey: "idem-2",
    }
    expect(decode(payload)(request)).toEqual(request)
  })

  test("remove and restore payloads decode { expectedRevision }", () => {
    expect(decode(CtxPackRevisionPayload)({ expectedRevision: 3 })).toEqual({ expectedRevision: 3 })
    expect(() => decode(CtxPackRevisionPayload)({})).toThrow()
  })

  test("materialize request decodes the frozen non-URL fields", () => {
    expect(decode(CtxPackMaterializeRequest)(sampleMaterializeRequest)).toEqual(sampleMaterializeRequest)
  })

  test("create success schema decodes a full CtxPack info", () => {
    expect(decode(successSchema(CtxPackGroup.endpoints["workspace.ctxpack.create"]))(sampleInfo)).toEqual(sampleInfo)
  })

  test("list success schema decodes a list result", () => {
    expect(decode(successSchema(CtxPackGroup.endpoints["workspace.ctxpack.list"]))(sampleListResult)).toEqual(
      sampleListResult,
    )
  })

  test("materialize success schema has exactly the five frozen result fields", () => {
    const result = decode(CtxPackMaterializeResult)({
      ...sampleMaterializeResult,
      // A hypothetical capsule payload must never survive the schema.
      capsuleContents: "SECRET",
    }) as Record<string, unknown>
    expect(Object.keys(result).sort()).toEqual([
      "contentHash",
      "contextCapsuleID",
      "estimatedTokens",
      "label",
      "sourceCtxPackID",
    ])
    // All five fields are required: dropping any one must fail to decode.
    for (const field of ["contextCapsuleID", "sourceCtxPackID", "label", "contentHash", "estimatedTokens"]) {
      const { [field]: _omitted, ...rest } = sampleMaterializeResult as Record<string, unknown>
      expect(() => decode(CtxPackMaterializeResult)(rest)).toThrow()
    }
  })
})

describe("CtxPackListQuery", () => {
  test("is plain optional strings at the wire level (normalization lives in the handler)", () => {
    expect(decodeListQuery({})).toEqual({})
    expect(
      decodeListQuery({
        query: "needle",
        keyword: "k",
        sourceBlockID: "block-1",
        sourceFunctionalityID: "func-1",
        sourceKind: "message",
        sensitivity: "workspace",
        createdAfter: "1000",
        createdBefore: "2000",
        includeDeleted: "true",
        sort: "tokens-desc",
        cursor: "e30",
        limit: "25",
      }),
    ).toEqual({
      query: "needle",
      keyword: "k",
      sourceBlockID: "block-1",
      sourceFunctionalityID: "func-1",
      sourceKind: "message",
      sensitivity: "workspace",
      createdAfter: "1000",
      createdBefore: "2000",
      includeDeleted: "true",
      sort: "tokens-desc",
      cursor: "e30",
      limit: "25",
    })
  })

  test("rejects non-string query field types at decode time", () => {
    expect(() => decodeListQuery({ limit: 30 })).toThrow()
    expect(() => decodeListQuery({ includeDeleted: true })).toThrow()
    expect(() => decodeListQuery({ createdAfter: 1000 })).toThrow()
  })
})

describe("CtxPack error schemas", () => {
  const roundTrip = (schema: Schema.Decoder<unknown>, input: Record<string, unknown>, tag: string) => {
    // TaggedErrorClass encode expects an instance; decode returns an instance
    // from the tagged wire form.
    const cls = schema as unknown as new (fields: Record<string, unknown>) => { readonly _tag: string }
    const encoded = Schema.encodeSync(schema as unknown as Schema.Encoder<unknown>)(new cls(input))
    const decoded = Schema.decodeUnknownSync(schema)(encoded) as { readonly _tag: string }
    expect(decoded._tag).toBe(tag)
    expect(decoded).toMatchObject(input)
  }

  test("round-trip through their schemas", () => {
    roundTrip(CtxPackNotFoundError, { ctxPackID, message: "missing" }, "CtxPackNotFoundError")
    roundTrip(CtxPackDeletedError, { ctxPackID, message: "deleted" }, "CtxPackDeletedError")
    roundTrip(CtxPackRevisionConflictError, { currentRevision: 3, message: "conflict" }, "CtxPackRevisionConflictError")
    roundTrip(CtxPackContentChangedError, { currentContentHash: "sha256:abc", message: "changed" }, "CtxPackContentChangedError")
    roundTrip(CtxPackInvalidSelectionError, { reason: "no fragments", message: "invalid" }, "CtxPackInvalidSelectionError")
    roundTrip(
      CtxPackBudgetExceededError,
      { bytes: 1000, estimatedTokens: 250, message: "budget" },
      "CtxPackBudgetExceededError",
    )
    roundTrip(CtxPackSecretSourceDeniedError, { clientFragmentID: "frag-1", message: "secret" }, "CtxPackSecretSourceDeniedError")
    roundTrip(CtxPackCrossWorkspaceDeniedError, { sourceWorkspaceID: "wrk_other", message: "cross" }, "CtxPackCrossWorkspaceDeniedError")
    roundTrip(CtxPackPermissionDeniedError, { operation: "get", message: "denied" }, "CtxPackPermissionDeniedError")
    roundTrip(CtxPackSearchCursorInvalidError, { message: "bad cursor" }, "CtxPackSearchCursorInvalidError")
  })

  test("CtxPack.ID decodes only ctxpk_-prefixed ids", () => {
    expect(decode(CtxPack.ID)("ctxpk_test1")).toBe("ctxpk_test1")
    expect(() => decode(CtxPack.ID)("wrk_test")).toThrow()
  })
})
