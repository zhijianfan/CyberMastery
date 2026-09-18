import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import type { CtxPackCreateRequest } from "@opencode-ai/schema/ctxpack"
import { validateCreate } from "@opencode-ai/core/ctxpack/validation"

const source = CtxPack.Source.make({
  workspaceID: "workspace-1",
  blockID: "block-1",
  functionalityID: "builtin:notes",
  kind: "block-text",
  direction: "unknown",
  sourceTimestamp: null,
  capturedAt: 1,
  entityRef: null,
  label: null,
  metadata: {},
  sensitivity: "workspace",
})

function request(text: string): CtxPackCreateRequest {
  return {
    workspaceID: "workspace-1",
    title: "Large selection",
    keywords: [],
    sensitivity: "workspace",
    fragments: [{ clientFragmentID: "fragment-1", text, source }],
    idempotencyKey: "create-1",
  }
}

describe("CtxPack create validation", () => {
  test("slices oversized fragments at UTF-8 code-point boundaries without changing their text", async () => {
    const text = `${"a".repeat(16 * 1024 - 2)}😀${"b".repeat(4 * 1024)}`
    const result = await Effect.runPromise(validateCreate(request(text)))

    expect(result.fragments).toHaveLength(2)
    expect(result.fragments.map((fragment) => fragment.text).join("")).toBe(text)
    expect(result.fragments[1]?.text.startsWith("😀")).toBe(true)
    expect(result.fragments.every((fragment) => CtxPack.utf8ByteLength(fragment.text) <= 16 * 1024)).toBe(true)
    expect(result.fragments.every((fragment) => fragment.source === source)).toBe(true)
  })

  test("accepts exactly 64 KiB as four fragments and rejects one byte more", async () => {
    const accepted = await Effect.runPromise(validateCreate(request("x".repeat(64 * 1024))))
    expect(accepted.fragments).toHaveLength(4)
    expect(accepted.fragments.map((fragment) => CtxPack.utf8ByteLength(fragment.text))).toEqual([
      16 * 1024,
      16 * 1024,
      16 * 1024,
      16 * 1024,
    ])

    const rejected = await Effect.runPromise(
      validateCreate(request("x".repeat(64 * 1024 + 1))).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => undefined,
        }),
      ),
    )
    expect(rejected).toEqual({ _tag: "CtxPackBudgetExceeded", bytes: 64 * 1024 + 1, estimatedTokens: 16_385 })
  })
})
