import { describe, expect, test } from "bun:test"
import { Option, Schema } from "effect"
import { Workspace } from "@opencode-ai/schema/workspace"
import { WorkspaceCoder } from "../src/groups/workspace-coder"

const base = {
  id: Workspace.ID.ascending("wrk_test01"),
  name: "n",
  style: "s",
  directories: [],
  pluginIDs: [],
  skillIDs: [],
  git: [],
  time: { created: 0, updated: 0 },
}

describe("WorkspaceCoder read", () => {
  test("decodes a workspace without coderModel as null", () => {
    const info = Schema.decodeUnknownSync(Workspace.Info)(base)

    expect(WorkspaceCoder.readModel(info)).toBeNull()
  })

  test("reads a concrete coderModel", () => {
    const info = Schema.decodeUnknownSync(Workspace.Info)({
      ...base,
      coderModel: "anthropic/claude-sonnet-4",
    })

    expect(WorkspaceCoder.readModel(info)).toBe("anthropic/claude-sonnet-4")
  })

  test("encodes an absent coderModel by omitting the key", () => {
    const encoded = Schema.encodeSync(Workspace.Info)({ ...base, coderModel: undefined })

    expect("coderModel" in encoded).toBe(false)
  })

  test("encodes a concrete coderModel", () => {
    const encoded = Schema.encodeSync(Workspace.Info)({ ...base, coderModel: "anthropic/claude-sonnet-4" })

    expect(encoded.coderModel).toBe("anthropic/claude-sonnet-4")
  })
})

describe("WorkspaceCoder patch encode", () => {
  test("set: encodes a concrete coderModel", () => {
    expect(WorkspaceCoder.encodePatch({ coderModel: "anthropic/claude-sonnet-4" })).toEqual({
      coderModel: "anthropic/claude-sonnet-4",
    })
  })

  test("clear: encodes an explicit null", () => {
    expect(WorkspaceCoder.encodePatch({ coderModel: null })).toEqual({ coderModel: null })
  })

  test("omit: leaves the key absent", () => {
    expect(WorkspaceCoder.encodePatch({})).toEqual({})
  })

  test("undefined encodes as omitted", () => {
    expect(WorkspaceCoder.encodePatch({ coderModel: undefined })).toEqual({})
  })
})

describe("WorkspaceCoder patch decode", () => {
  test("set: decodes a concrete coderModel", () => {
    const patch = Option.getOrUndefined(WorkspaceCoder.decodePatch({ coderModel: "anthropic/claude-sonnet-4" }))

    expect(patch).toEqual({ coderModel: "anthropic/claude-sonnet-4" })
  })

  test("clear: decodes an explicit null", () => {
    const patch = Option.getOrUndefined(WorkspaceCoder.decodePatch({ coderModel: null }))

    expect(patch).toEqual({ coderModel: null })
  })

  test("omit: decodes to an unchanged patch", () => {
    const patch = Option.getOrUndefined(WorkspaceCoder.decodePatch({}))

    expect(patch).toBeDefined()
    expect(patch?.coderModel).toBeUndefined()
  })

  test("rejects a non-string coderModel", () => {
    expect(Option.isSome(WorkspaceCoder.decodePatch({ coderModel: 42 }))).toBe(false)
  })
})

describe("WorkspaceCoder.patchFields", () => {
  test("composes into a workspace update payload struct", () => {
    const UpdatePayload = Schema.Struct({
      id: Workspace.ID,
      patch: Schema.Struct({ name: Schema.optional(Schema.String), ...WorkspaceCoder.patchFields }),
    })

    const decoded = Schema.decodeUnknownSync(UpdatePayload)({
      id: "wrk_test01",
      patch: { coderModel: null },
    })

    expect(decoded.patch).toEqual({ coderModel: null })
  })
})
