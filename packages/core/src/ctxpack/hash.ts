// CtxPack hashing: canonical-source wrappers around S1's contentHash /
// estimateTokens. S1 froze the canonical form (recursive key sort of the
// whole source object, `source.metadata` included) BEFORE JSON serialization;
// this module re-exports that ordering for callers that build hash inputs
// themselves and delegates the hashing to the schema's authoritative
// implementation.
//
// The hash covers content + provenance ONLY: title, keywords, usage,
// timestamps, and revision are excluded, so a metadata patch never changes
// the contentHash.

import { CtxPack } from "@opencode-ai/schema/ctxpack"

export type HashFragment = {
  readonly ordinal: number
  readonly text: string
  readonly source: CtxPack.Source
}

// Recursive key sort of any JSON-serializable value. Mirrors the ordering S1
// froze for source objects (see packages/schema/src/ctxpack.ts): arrays keep
// their order, object keys are sorted, scalars pass through.
export function canonicalizeSource(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeSource)
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = canonicalizeSource((value as Record<string, unknown>)[key])
    }
    return result
  }
  return value
}

// Content + provenance only. S1's contentHash applies canonicalizeSource to
// each fragment source before JSON, so this wrapper is stable across metadata
// patches by construction.
export function contentHash(fragments: ReadonlyArray<HashFragment>): string {
  return CtxPack.contentHash(fragments)
}

export function estimateTokens(utf8ByteLength: number): number {
  return CtxPack.estimateTokens(utf8ByteLength)
}

export function utf8ByteLength(text: string): number {
  return CtxPack.utf8ByteLength(text)
}
