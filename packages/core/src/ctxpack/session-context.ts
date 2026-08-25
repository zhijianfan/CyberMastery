export * as CtxPackSessionContext from "./session-context"

import { Cause, Effect, Option } from "effect"
import type { CtxPackError } from "@opencode-ai/schema/ctxpack"
import type { ContextBudget } from "../context-broker/capsule"
import { renderContextSidecar, type ContextSidecarAttachment } from "../session/context-sidecar"
import { SessionInput } from "../session/input"
import type { Profile } from "../session/context-profile"
import { SessionSchema } from "../session/schema"
import type { CtxPackMaterializer, MaterializeError } from "./materialize"
import {
  MAX_RECALL_CANDIDATES,
  buildRecallTerms,
  isTrivialRecallTurn,
  type RecallCandidate,
  type RecallSnapshot,
} from "./recall"

type Target = {
  readonly workspaceID: string
  readonly instanceID: string
  readonly functionalityID: string
}

export function make(input: {
  readonly materializer: CtxPackMaterializer
  readonly search: (input: {
    readonly workspaceID: string
    readonly terms: readonly string[]
  }) => Effect.Effect<readonly RecallCandidate[]>
  readonly snapshotCandidate: (input: {
    readonly actor: { readonly userID: string; readonly workspaceID: string }
    readonly targetInstanceID: string
    readonly targetFunctionalityID: string
    readonly ctxPackID: RecallCandidate["ctxPackID"]
    readonly expectedContentHash: string
  }) => Effect.Effect<RecallSnapshot, CtxPackError>
}): SessionInput.SessionContextAssemblyPort {
  return SessionInput.SessionContextAssemblyPortService.of({
    assemble: (request) =>
      Effect.gen(function* () {
        if (request.explicitAttachments.length > 8)
          return yield* new SessionInput.ContextAttachmentError({ code: "too-many-attachments" })
        if (
          new Set(request.explicitAttachments.map((attachment) => attachment.contextCapsuleID)).size !==
          request.explicitAttachments.length
        )
          return yield* new SessionInput.ContextAttachmentError({ code: "duplicate-capsule" })
        if (request.mode === "v1-clean-only") {
          if (request.explicitAttachments.length > 0)
            return yield* new SessionInput.ContextAttachmentError({ code: "transfer-unavailable" })
          return {}
        }

        const target = targetOf(request.sessionID, request.profile)
        if (
          request.profile.kind === "operating-chat" &&
          request.actor?.workspaceID !== undefined &&
          request.actor.workspaceID !== request.profile.workspaceID
        )
          return yield* new SessionInput.ContextAttachmentError({ code: "workspace-mismatch" })
        const workspaceID =
          request.profile.kind === "operating-chat" ? request.profile.workspaceID : request.actor?.workspaceID
        const actor =
          request.actor === undefined || request.actor.userID.length === 0 || workspaceID === undefined
            ? undefined
            : { userID: request.actor.userID, workspaceID }
        if (request.explicitAttachments.length > 0 && actor === undefined)
          return yield* new SessionInput.ContextAttachmentError({
            code:
              request.actor === undefined || request.actor.userID.length === 0 ? "missing-actor" : "missing-workspace",
          })

        const explicitSnapshot =
          request.explicitAttachments.length === 0
            ? undefined
            : yield* input.materializer
                .snapshotForSessionInput({
                  actor: actor!,
                  targetInstanceID: target.instanceID,
                  targetFunctionalityID: target.functionalityID,
                  attachments: request.explicitAttachments,
                  budget:
                    request.mode === "v1-local-explicit"
                      ? request.budget
                      : {
                          ...request.budget,
                          maximumBytes: Number.MAX_SAFE_INTEGER,
                          maximumEstimatedTokens: Number.MAX_SAFE_INTEGER,
                        },
                })
                .pipe(Effect.mapError(toAttachmentError))
        if (request.mode === "v1-local-explicit")
          return explicitSnapshot === undefined ? {} : { snapshot: explicitSnapshot }

        const explicit =
          explicitSnapshot?.attachments.map((attachment) => ({
            selection: "explicit" as const,
            contextCapsuleID: attachment.contextCapsuleID,
            sourceCtxPackID: attachment.sourceCtxPackID,
            label: attachment.label,
            contentHash: attachment.contentHash,
            fragments: attachment.fragments.map((fragment) => ({
              contentHash: fragment.contentHash,
              text: fragment.text,
            })),
          })) ?? []
        if (request.profile.kind === "generic") {
          if (explicit.length === 0) return {}
          return {
            snapshot: yield* renderFinal(
              request.promptText,
              explicit,
              { policy: "disabled", status: "disabled" },
              request.budget,
            ),
          }
        }
        if (actor === undefined) {
          return {
            snapshot: yield* renderFinal(
              request.promptText,
              explicit,
              { policy: "operating-chat-v1", status: "unavailable" },
              request.budget,
            ),
          }
        }
        if (isTrivialRecallTurn(request.promptText)) {
          return {
            snapshot: yield* renderFinal(
              request.promptText,
              explicit,
              { policy: "operating-chat-v1", status: "skipped-trivial" },
              request.budget,
            ),
          }
        }

        const automatic = yield* selectAutomatic({
          actor,
          target,
          promptText: request.promptText,
          explicit,
          budget: request.budget,
          search: input.search,
          snapshotCandidate: input.snapshotCandidate,
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause)
              ? Effect.failCause(cause)
              : Effect.succeed({
                  attachments: [] as readonly ContextSidecarAttachment[],
                  status: "unavailable" as const,
                }),
          ),
        )
        const attachments = [...explicit, ...automatic.attachments]
        return {
          snapshot: yield* renderFinal(
            request.promptText,
            attachments,
            { policy: "operating-chat-v1", status: automatic.status },
            request.budget,
          ),
        }
      }),
  })
}

function targetOf(sessionID: SessionSchema.ID, profile: Profile): Target {
  if (profile.kind === "operating-chat")
    return {
      workspaceID: profile.workspaceID,
      instanceID: profile.functionalityInstanceID,
      functionalityID: profile.functionalityID,
    }
  return { workspaceID: "", instanceID: `chat-instance:${sessionID}`, functionalityID: "builtin:chat" }
}

function toAttachmentError(error: CtxPackError | MaterializeError) {
  return new SessionInput.ContextAttachmentError({ code: error._tag })
}

function renderFinal(
  promptText: string,
  attachments: readonly ContextSidecarAttachment[],
  recall: {
    readonly policy: "disabled" | "operating-chat-v1"
    readonly status: "disabled" | "skipped-trivial" | "no-match" | "selected" | "unavailable"
  },
  budget: ContextBudget,
) {
  return renderContextSidecar({ promptText, attachments, recall, budget, createdAt: Date.now() }).pipe(
    Effect.mapError(() => new SessionInput.ContextAttachmentError({ code: "CtxPackSnapshotOverBudget" })),
  )
}

const selectAutomatic = Effect.fn("CtxPackSessionContext.selectAutomatic")(function* (input: {
  readonly actor: { readonly userID: string; readonly workspaceID: string }
  readonly target: Target
  readonly promptText: string
  readonly explicit: readonly ContextSidecarAttachment[]
  readonly budget: ContextBudget
  readonly search: (input: {
    readonly workspaceID: string
    readonly terms: readonly string[]
  }) => Effect.Effect<readonly RecallCandidate[]>
  readonly snapshotCandidate: (input: {
    readonly actor: { readonly userID: string; readonly workspaceID: string }
    readonly targetInstanceID: string
    readonly targetFunctionalityID: string
    readonly ctxPackID: RecallCandidate["ctxPackID"]
    readonly expectedContentHash: string
  }) => Effect.Effect<RecallSnapshot, CtxPackError>
}) {
  const terms = buildRecallTerms(input.promptText)
  if (terms.length === 0) return { attachments: [] as readonly ContextSidecarAttachment[], status: "no-match" as const }
  const candidates = (yield* input.search({ workspaceID: input.target.workspaceID, terms })).slice(
    0,
    MAX_RECALL_CANDIDATES,
  )
  const automatic: ContextSidecarAttachment[] = []
  for (const candidate of candidates) {
    if (automatic.length >= 4 || input.explicit.length + automatic.length >= 8) break
    if (
      [...input.explicit, ...automatic].some(
        (attachment) =>
          attachment.sourceCtxPackID === candidate.ctxPackID && attachment.contentHash === candidate.contentHash,
      )
    )
      continue
    const snapshot = yield* input
      .snapshotCandidate({
        actor: input.actor,
        targetInstanceID: input.target.instanceID,
        targetFunctionalityID: input.target.functionalityID,
        ctxPackID: candidate.ctxPackID,
        expectedContentHash: candidate.contentHash,
      })
      .pipe(Effect.option)
    if (Option.isNone(snapshot)) continue
    const attachment: ContextSidecarAttachment = {
      selection: "automatic",
      sourceCtxPackID: snapshot.value.sourceCtxPackID,
      label: snapshot.value.label,
      contentHash: snapshot.value.contentHash,
      fragments: snapshot.value.fragments.map((fragment) => ({
        contentHash: fragment.contentHash,
        text: fragment.text,
      })),
    }
    const rendered = yield* renderContextSidecar({
      promptText: input.promptText,
      attachments: [...input.explicit, ...automatic, attachment],
      recall: { policy: "operating-chat-v1", status: "selected" },
      budget: input.budget,
      createdAt: 0,
    }).pipe(Effect.option)
    if (Option.isSome(rendered)) automatic.push(attachment)
  }
  return { attachments: automatic, status: automatic.length === 0 ? ("no-match" as const) : ("selected" as const) }
})
