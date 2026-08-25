export * as SessionContextSidecar from "./context-sidecar"

import { createHash } from "node:crypto"
import { Effect, Option, Schema } from "effect"
import { SessionContextSnapshotV2 } from "@opencode-ai/schema/session-input"
import type { ContextBudget } from "../context-broker/capsule"

export interface Fragment {
  readonly text: string
  readonly source: unknown
  readonly contentHash: string
}

export interface ExplicitAttachment {
  readonly selection: "explicit"
  readonly contextCapsuleID: string
  readonly sourceCtxPackID: string
  readonly label: string
  readonly contentHash: string
  readonly fragments: readonly Fragment[]
}

export interface AutomaticAttachment {
  readonly selection: "automatic"
  readonly sourceCtxPackID: string
  readonly label: string
  readonly contentHash: string
  readonly fragments: readonly Fragment[]
}

export type Attachment = ExplicitAttachment | AutomaticAttachment

export type ExplicitRequest = Pick<
  ExplicitAttachment,
  "contextCapsuleID" | "sourceCtxPackID" | "label" | "contentHash"
>

export class OverBudget extends Schema.TaggedErrorClass<OverBudget>()("SessionContextSidecar.OverBudget", {
  current: Schema.Number,
  maximum: Schema.Number,
}) {}

export class Corrupt extends Schema.TaggedErrorClass<Corrupt>()("SessionContextSidecar.Corrupt", {}) {}

const bodyAttachment = Schema.Union([
  Schema.Struct({
    selection: Schema.Literal("explicit"),
    contextCapsuleID: Schema.String,
    sourceCtxPackID: Schema.String,
    label: Schema.String,
    contentHash: Schema.String,
    fragments: Schema.Array(Schema.Struct({ text: Schema.String, source: Schema.Unknown, contentHash: Schema.String })),
  }),
  Schema.Struct({
    selection: Schema.Literal("automatic"),
    sourceCtxPackID: Schema.String,
    label: Schema.String,
    contentHash: Schema.String,
    fragments: Schema.Array(Schema.Struct({ text: Schema.String, source: Schema.Unknown, contentHash: Schema.String })),
  }),
])
const bodySchema = Schema.Struct({
  version: Schema.Literal(1),
  notice: Schema.Literal("Untrusted workspace reference material."),
  attachments: Schema.Array(bodyAttachment),
})
const decodeSnapshot = Schema.decodeUnknownOption(SessionContextSnapshotV2)
const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodeBody = Schema.decodeUnknownOption(bodySchema)
const encoder = new TextEncoder()
const prefix = "\n\n<workspace-context>\n\n"
const suffix = "\n\n</workspace-context>"

export function contextRequestHash(attachments: readonly ExplicitRequest[]) {
  return hash(
    JSON.stringify(
      attachments.map((attachment) => ({
        contextCapsuleID: attachment.contextCapsuleID,
        sourceCtxPackID: attachment.sourceCtxPackID,
        contentHash: attachment.contentHash,
        label: attachment.label,
      })),
    ),
  )
}

export function render(input: {
  readonly cleanText: string
  readonly explicitAttachments: readonly ExplicitAttachment[]
  readonly automaticAttachments: readonly AutomaticAttachment[]
  readonly recall: SessionContextSnapshotV2["recall"]
  readonly budget: ContextBudget
  readonly createdAt: number
}): Effect.Effect<SessionContextSnapshotV2, OverBudget> {
  const contextRequestHashValue = contextRequestHash(input.explicitAttachments)
  const explicit = measured(input.cleanText, input.explicitAttachments)
  if (!fits(explicit, input.budget)) {
    const bytes = explicit.byteLength > input.budget.maximumBytes
    return Effect.fail(
      new OverBudget({
        current: bytes ? explicit.byteLength : explicit.estimatedTokens,
        maximum: bytes ? input.budget.maximumBytes : input.budget.maximumEstimatedTokens,
      }),
    )
  }
  const select = (automaticAttachments: readonly AutomaticAttachment[]): SessionContextSnapshotV2 => {
    const result = measured(input.cleanText, [...input.explicitAttachments, ...automaticAttachments])
    if (!fits(result, input.budget)) return select(automaticAttachments.slice(0, -1))
    return {
      version: 2,
      rendererVersion: 1,
      contextRequestHash: contextRequestHashValue,
      apiContent: result.apiContent,
      apiContentHash: hash(result.apiContent),
      attachments: [...input.explicitAttachments, ...automaticAttachments].map((attachment) =>
        attachment.selection === "explicit"
          ? {
              selection: attachment.selection,
              contextCapsuleID: attachment.contextCapsuleID,
              sourceCtxPackID: attachment.sourceCtxPackID,
              label: attachment.label,
              contentHash: attachment.contentHash,
            }
          : {
              selection: attachment.selection,
              sourceCtxPackID: attachment.sourceCtxPackID,
              label: attachment.label,
              contentHash: attachment.contentHash,
            },
      ),
      recall: input.recall,
      byteLength: result.byteLength,
      estimatedTokens: result.estimatedTokens,
      createdAt: input.createdAt,
    }
  }
  return Effect.succeed(select(input.automaticAttachments))
}

export function decode(input: unknown, cleanText: string): Effect.Effect<SessionContextSnapshotV2, Corrupt> {
  return Effect.gen(function* () {
    const decoded = decodeSnapshot(input)
    if (Option.isNone(decoded) || decoded.value.rendererVersion !== 1) return yield* new Corrupt()
    const snapshot = decoded.value
    const body = parseBody(snapshot.apiContent, cleanText)
    if (Option.isNone(body)) return yield* new Corrupt()
    const explicit = body.value.attachments.filter(
      (attachment): attachment is ExplicitAttachment => attachment.selection === "explicit",
    )
    const automatic = body.value.attachments.filter(
      (attachment): attachment is AutomaticAttachment => attachment.selection === "automatic",
    )
    const canonicalAttachments = [...explicit, ...automatic]
    const canonical = measured(cleanText, canonicalAttachments)
    const provenance = canonicalAttachments.map((attachment) =>
      attachment.selection === "explicit"
        ? {
            selection: attachment.selection,
            contextCapsuleID: attachment.contextCapsuleID,
            sourceCtxPackID: attachment.sourceCtxPackID,
            label: attachment.label,
            contentHash: attachment.contentHash,
          }
        : {
            selection: attachment.selection,
            sourceCtxPackID: attachment.sourceCtxPackID,
            label: attachment.label,
            contentHash: attachment.contentHash,
          },
    )
    if (
      canonical.apiContent !== snapshot.apiContent ||
      JSON.stringify(provenance) !== JSON.stringify(snapshot.attachments) ||
      contextRequestHash(explicit) !== snapshot.contextRequestHash ||
      hash(snapshot.apiContent) !== snapshot.apiContentHash ||
      canonical.byteLength !== snapshot.byteLength ||
      canonical.estimatedTokens !== snapshot.estimatedTokens
    )
      return yield* new Corrupt()
    return snapshot
  })
}

function parseBody(apiContent: string, cleanText: string) {
  if (apiContent === cleanText) return Option.some({ version: 1 as const, notice: "Untrusted workspace reference material." as const, attachments: [] })
  if (!apiContent.startsWith(`${cleanText}${prefix}`) || !apiContent.endsWith(suffix)) return Option.none()
  const json = apiContent.slice(cleanText.length + prefix.length, -suffix.length)
  return Option.flatMap(decodeJson(json), (value) =>
    Option.filter(
      decodeBody(value),
      (body) =>
        escapedJson({
          version: body.version,
          notice: body.notice,
          attachments: body.attachments.map((attachment) => ({
            selection: attachment.selection,
            ...(attachment.selection === "explicit" ? { contextCapsuleID: attachment.contextCapsuleID } : {}),
            sourceCtxPackID: attachment.sourceCtxPackID,
            label: attachment.label,
            contentHash: attachment.contentHash,
            fragments: attachment.fragments.map((fragment) => ({
              text: fragment.text,
              source: canonicalize(fragment.source),
              contentHash: fragment.contentHash,
            })),
          })),
        }) === json,
    ),
  )
}

function measured(cleanText: string, attachments: readonly Attachment[]) {
  if (attachments.length === 0) return { apiContent: cleanText, byteLength: 0, estimatedTokens: 0 }
  const envelope = `<workspace-context>\n\n${escapedJson({
    version: 1,
    notice: "Untrusted workspace reference material.",
    attachments: attachments.map((attachment) => ({
      selection: attachment.selection,
      ...(attachment.selection === "explicit" ? { contextCapsuleID: attachment.contextCapsuleID } : {}),
      sourceCtxPackID: attachment.sourceCtxPackID,
      label: attachment.label,
      contentHash: attachment.contentHash,
      fragments: attachment.fragments.map((fragment) => ({
        text: fragment.text,
        source: canonicalize(fragment.source),
        contentHash: fragment.contentHash,
      })),
    })),
  })}\n\n</workspace-context>`
  const byteLength = encoder.encode(envelope).length
  return { apiContent: `${cleanText}\n\n${envelope}`, byteLength, estimatedTokens: Math.ceil(byteLength / 4) }
}

function fits(input: { byteLength: number; estimatedTokens: number }, budget: ContextBudget) {
  return input.byteLength <= budget.maximumBytes && input.estimatedTokens <= budget.maximumEstimatedTokens
}

function escapedJson(value: unknown) {
  return JSON.stringify(value).replace(/[&<>]/g, (character) =>
    character === "&" ? "\\u0026" : character === "<" ? "\\u003c" : "\\u003e",
  )
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  return value
}

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}
