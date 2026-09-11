export * as SessionInput from "./session-input"

import { Schema } from "effect"
import { Tag } from "./ctxpack-tag"
import { optional } from "./schema"
import { Prompt } from "./prompt"
import { DateTimeUtcFromMillis, NonNegativeInt } from "./schema"
import { SessionDelivery } from "./session-delivery"
import { SessionID } from "./session-id"
import { SessionMessage } from "./session-message"

export const Delivery = SessionDelivery.Delivery
export type Delivery = SessionDelivery.Delivery

export interface Admitted extends Schema.Schema.Type<typeof Admitted> {}
export const Admitted = Schema.Struct({
  admittedSeq: NonNegativeInt,
  id: SessionMessage.ID,
  sessionID: SessionID,
  prompt: Prompt,
  delivery: Delivery,
  timeCreated: DateTimeUtcFromMillis,
  promotedSeq: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "SessionInput.Admitted" })

// CtxPack session context attachments (frozen wire contract with the CtxPack
// lane). The schema layer cannot import the CtxPack source schema (kept
// decoupled); fragment sources are `Schema.Unknown` here and decoded lazily
// by core consumers.

export interface SessionContextAttachmentInput extends Schema.Schema.Type<typeof SessionContextAttachmentInput> {}
export const SessionContextAttachmentInput = Schema.Struct({
  contextCapsuleID: Schema.String,
  label: Schema.String,
  contentHash: Schema.String,
  source: Schema.Struct({ kind: Schema.Literal("ctxpack"), ctxPackID: Schema.String }),
}).annotate({ identifier: "SessionInput.ContextAttachment" })

// contextAttachments on the prompt request: at most 8 attachments, and
// duplicate contextCapsuleID values are rejected.
// Wire shape for session prompt context attachments. M1: no refinements here —
// httpapi-codegen rejects Schema.check filters as unportable, so the frozen
// limits (max 8, unique contextCapsuleID) are enforced by SessionInput
// admission instead and surface as ContextAttachmentError.
export const ContextAttachments = Schema.Array(SessionContextAttachmentInput).annotate({
  identifier: "SessionInput.ContextAttachments",
})
export interface ContextAttachments extends Schema.Schema.Type<typeof ContextAttachments> {}

// Durable snapshot payload stored on the session_input row. `source` keeps the
// runtime CtxPack.Source shape but is unknown at the schema layer; core
// validates the durable JSON against this local copy on write and read.
export interface SessionContextSnapshotV1 extends Schema.Schema.Type<typeof SessionContextSnapshotV1> {}
export const SessionContextSnapshotV1 = Schema.Struct({
  version: Schema.Literal(1),
  attachments: Schema.Array(
    Schema.Struct({
      contextCapsuleID: Schema.String,
      sourceCtxPackID: Schema.String,
      label: Schema.String,
      tags: optional(Schema.Array(Tag)),
      contentHash: Schema.String,
      fragments: Schema.Array(
        Schema.Struct({
          text: Schema.String,
          source: Schema.Unknown,
          contentHash: Schema.String,
        }),
      ),
    }),
  ),
  byteLength: NonNegativeInt,
  estimatedTokens: NonNegativeInt,
  createdAt: NonNegativeInt,
}).annotate({ identifier: "SessionInput.ContextSnapshotV1" })

export interface SessionContextSnapshotV2 extends Schema.Schema.Type<typeof SessionContextSnapshotV2> {}
export const SessionContextSnapshotV2 = Schema.Struct({
  version: Schema.Literal(2),
  rendererVersion: NonNegativeInt,
  contextRequestHash: Schema.String,
  apiContent: Schema.String,
  apiContentHash: Schema.String,
  attachments: Schema.Array(
    Schema.Union([
      Schema.Struct({
        selection: Schema.Literal("explicit"),
        contextCapsuleID: Schema.String,
        sourceCtxPackID: Schema.String,
        label: Schema.String,
        tags: optional(Schema.Array(Tag)),
        contentHash: Schema.String,
      }),
      Schema.Struct({
        selection: Schema.Literal("automatic"),
        sourceCtxPackID: Schema.String,
        label: Schema.String,
        tags: optional(Schema.Array(Tag)),
        contentHash: Schema.String,
      }),
    ]),
  ),
  recall: Schema.Struct({
    policy: Schema.Literals(["disabled", "operating-chat-v1"]),
    status: Schema.Literals(["disabled", "skipped-trivial", "no-match", "selected", "unavailable"]),
  }),
  byteLength: NonNegativeInt,
  estimatedTokens: NonNegativeInt,
  createdAt: NonNegativeInt,
}).annotate({ identifier: "SessionInput.ContextSnapshotV2" })

export type SessionContextSnapshot = SessionContextSnapshotV1 | SessionContextSnapshotV2
export const SessionContextSnapshot = Schema.Union([SessionContextSnapshotV1, SessionContextSnapshotV2]).annotate({
  identifier: "SessionInput.ContextSnapshot",
})
