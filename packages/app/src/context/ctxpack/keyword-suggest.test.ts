import { describe, expect, it } from "bun:test"
import { suggestCtxPackKeywords } from "./keyword-suggest"
import type { CapturedCtxPackFragment } from "./selection"

function fragment(text: string): CapturedCtxPackFragment {
  return {
    clientFragmentID: crypto.randomUUID(),
    text,
    source: {
      workspaceID: "ws-1",
      blockID: "block-1",
      functionalityID: "builtin:chat",
      kind: "block-text",
      direction: "unknown",
      sourceTimestamp: null,
      capturedAt: 1,
      entityRef: null,
      label: null,
      metadata: {},
      sensitivity: "workspace",
    },
  }
}

describe("suggestCtxPackKeywords", () => {
  it("dedupes case-insensitively, keeping the first display form", () => {
    expect(suggestCtxPackKeywords({ title: "CtxPack ctxpack CTXPACK", fragments: [] })).toEqual(["CtxPack"])
  })

  it("excludes English stop words", () => {
    expect(suggestCtxPackKeywords({ title: "The quick brown fox and the lazy dog", fragments: [] })).toEqual([
      "quick",
      "brown",
      "fox",
      "lazy",
      "dog",
    ])
  })

  it("preserves technical tokens", () => {
    expect(suggestCtxPackKeywords({ title: "CtxPack Niagara session.input 7900XTX", fragments: [] })).toEqual([
      "CtxPack",
      "Niagara",
      "session.input",
      "7900XTX",
    ])
  })

  it("ranks title tokens before fragment tokens", () => {
    expect(suggestCtxPackKeywords({ title: "Zebra", fragments: [fragment("apple apple apple")] })).toEqual([
      "Zebra",
      "apple",
    ])
  })

  it("ranks fragment tokens by frequency then first-seen order", () => {
    expect(
      suggestCtxPackKeywords({ title: "", fragments: [fragment("alpha beta gamma gamma beta alpha")] }),
    ).toEqual(["alpha", "beta", "gamma"])
    expect(
      suggestCtxPackKeywords({ title: "", fragments: [fragment("alpha alpha beta beta gamma gamma gamma")] }),
    ).toEqual(["gamma", "alpha", "beta"])
    expect(suggestCtxPackKeywords({ title: "", fragments: [fragment("gamma gamma beta beta")] })).toEqual([
      "gamma",
      "beta",
    ])
  })

  it("counts frequency across fragments", () => {
    expect(
      suggestCtxPackKeywords({ title: "", fragments: [fragment("beta"), fragment("beta"), fragment("alpha")] }),
    ).toEqual(["beta", "alpha"])
  })

  it("drops short tokens unless they contain a digit or symbol", () => {
    expect(suggestCtxPackKeywords({ title: "ok x1 a.b c-d e_f g:h", fragments: [] })).toEqual([
      "x1",
      "a.b",
      "c-d",
      "e_f",
      "g:h",
    ])
  })

  it("returns at most 8 suggestions", () => {
    const title = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ")
    const result = suggestCtxPackKeywords({ title, fragments: [] })
    expect(result.length).toBeLessThanOrEqual(8)
    expect(result).toEqual(["word0", "word1", "word2", "word3", "word4", "word5", "word6", "word7"])
  })

  it("is deterministic for the same input", () => {
    const input = { title: "Mixed Case Title", fragments: [fragment("Alpha beta Gamma"), fragment("delta ALPHA")] }
    expect(suggestCtxPackKeywords(input)).toEqual(suggestCtxPackKeywords(input))
  })
})
