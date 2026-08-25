import { Effect } from "effect"
import type { CtxPack } from "@opencode-ai/schema/ctxpack"
import type { SessionContextSnapshotV1 } from "@opencode-ai/schema/session-input"
import type { SessionContextProfile } from "../session/context-profile"
import { SessionContextSidecar } from "../session/context-sidecar"
import { SessionInput } from "../session/input"
import type { SessionSchema } from "../session/schema"
import type { RecallCandidate, RecallSnapshot } from "./recall"
import type { CtxPackMaterializer } from "./materialize"

interface Recall {
  readonly search: (input: {
    workspaceID: string
    terms: readonly string[]
  }) => Effect.Effect<readonly RecallCandidate[], unknown>
  readonly snapshotCandidate: (input: {
    actor: { userID: string; workspaceID: string }
    targetInstanceID: string
    targetFunctionalityID: string
    ctxPackID: CtxPack.ID
    expectedContentHash: string
  }) => Effect.Effect<RecallSnapshot, unknown>
  readonly terms: (text: string) => readonly string[]
  readonly trivial: (text: string) => boolean
}

export function make(input: { materializer: CtxPackMaterializer; recall: Recall }): SessionInput.SessionContextAssemblyPort {
  return SessionInput.SessionContextAssemblyPortService.of({
    assemble: (request) =>
      Effect.gen(function* () {
        if (request.explicitAttachments.length > 8)
          return yield* failure("too-many-attachments")
        if (
          new Set(request.explicitAttachments.map((attachment) => attachment.contextCapsuleID)).size !==
          request.explicitAttachments.length
        )
          return yield* failure("duplicate-capsule")
        if (request.mode === "v1-clean-only") {
          if (request.explicitAttachments.length > 0) return yield* failure("transfer-unavailable")
          return { usageCtxPackIDs: [] }
        }
        if (request.explicitAttachments.length > 0 && (!request.actor || request.actor.userID.length === 0))
          return yield* failure("missing-actor")

        const workspaceID = request.profile.kind === "operating-chat" ? request.profile.workspaceID : request.actor?.workspaceID
        if (
          request.profile.kind === "operating-chat" &&
          request.actor?.workspaceID !== undefined &&
          request.actor.workspaceID !== request.profile.workspaceID
        )
          return yield* failure("workspace-mismatch")
        if (request.explicitAttachments.length > 0 && workspaceID === undefined)
          return yield* failure("missing-workspace")

        const target = targetOf(request.sessionID, request.profile)
        const explicit = request.explicitAttachments.length === 0
          ? emptySnapshot()
          : request.actor && workspaceID
          ? yield* input.materializer
              .snapshotForSessionInput({
                actor: { userID: request.actor.userID, workspaceID },
                targetInstanceID: target.instanceID,
                targetFunctionalityID: target.functionalityID,
                attachments: request.explicitAttachments,
                budget: request.budget,
              })
              .pipe(Effect.mapError((error) => new SessionInput.SessionContextAssemblyError({ code: error._tag })))
          : emptySnapshot()

        if (explicit.version !== 1) return yield* failure("invalid-snapshot")
        if (request.mode === "v1-local-explicit")
          return request.explicitAttachments.length === 0
            ? { usageCtxPackIDs: [] }
            : { snapshot: explicit, usageCtxPackIDs: explicit.attachments.map((attachment) => attachment.sourceCtxPackID) }

        const explicitAttachments = explicit.attachments.map((attachment) => ({
          selection: "explicit" as const,
          contextCapsuleID: attachment.contextCapsuleID,
          sourceCtxPackID: attachment.sourceCtxPackID,
          label: attachment.label,
          contentHash: attachment.contentHash,
          fragments: attachment.fragments,
        }))
        if (request.profile.kind === "generic") {
          if (explicitAttachments.length === 0) return { usageCtxPackIDs: [] }
          const snapshot = yield* SessionContextSidecar.render({
            cleanText: request.promptText,
            explicitAttachments,
            automaticAttachments: [],
            recall: { policy: "disabled", status: "disabled" },
            budget: request.budget,
            createdAt: Date.now(),
          }).pipe(Effect.mapError(() => new SessionInput.SessionContextAssemblyError({ code: "CtxPackSnapshotOverBudget" })))
          return { snapshot, usageCtxPackIDs: snapshot.attachments.map((attachment) => attachment.sourceCtxPackID) }
        }

        if (!request.actor || request.actor.userID.length === 0) {
          const snapshot = yield* SessionContextSidecar.render({
            cleanText: request.promptText,
            explicitAttachments,
            automaticAttachments: [],
            recall: { policy: "operating-chat-v1", status: "unavailable" },
            budget: request.budget,
            createdAt: Date.now(),
          }).pipe(Effect.mapError(() => new SessionInput.SessionContextAssemblyError({ code: "CtxPackSnapshotOverBudget" })))
          return { snapshot, usageCtxPackIDs: snapshot.attachments.map((attachment) => attachment.sourceCtxPackID) }
        }

        const recalled = yield* recall(input.recall, {
          actor: { userID: request.actor.userID, workspaceID: request.profile.workspaceID },
          target,
          promptText: request.promptText,
          explicit: explicitAttachments,
        })
        const snapshot = yield* SessionContextSidecar.render({
          cleanText: request.promptText,
          explicitAttachments,
          automaticAttachments: recalled.attachments,
          recall: { policy: "operating-chat-v1", status: recalled.status },
          budget: request.budget,
          createdAt: Date.now(),
        }).pipe(Effect.mapError(() => new SessionInput.SessionContextAssemblyError({ code: "CtxPackSnapshotOverBudget" })))
        return { snapshot, usageCtxPackIDs: snapshot.attachments.map((attachment) => attachment.sourceCtxPackID) }
      }),
  })
}

function recall(
  service: Recall,
  input: {
    actor: { userID: string; workspaceID: string }
    target: { instanceID: string; functionalityID: string }
    promptText: string
    explicit: readonly SessionContextSidecar.ExplicitAttachment[]
  },
) {
  if (service.trivial(input.promptText))
    return Effect.succeed({ status: "skipped-trivial" as const, attachments: [] })
  return Effect.gen(function* () {
    const candidates = yield* service.search({ workspaceID: input.actor.workspaceID, terms: service.terms(input.promptText) })
    const explicit = new Set(input.explicit.map((attachment) => `${attachment.sourceCtxPackID}\u0000${attachment.contentHash}`))
    const maximum = Math.min(4, 8 - input.explicit.length)
    const select = (
      remaining: readonly RecallCandidate[],
      attachments: readonly SessionContextSidecar.AutomaticAttachment[],
    ): Effect.Effect<readonly SessionContextSidecar.AutomaticAttachment[], unknown> => {
      if (remaining.length === 0 || attachments.length === maximum) return Effect.succeed(attachments)
      const candidate = remaining[0]!
      return service
        .snapshotCandidate({
            actor: input.actor,
            targetInstanceID: input.target.instanceID,
            targetFunctionalityID: input.target.functionalityID,
            ctxPackID: candidate.ctxPackID,
            expectedContentHash: candidate.contentHash,
          })
        .pipe(
          Effect.option,
          Effect.flatMap((snapshot) => {
            if (snapshot._tag === "None") return select(remaining.slice(1), attachments)
            const key = `${snapshot.value.sourceCtxPackID}\u0000${snapshot.value.contentHash}`
            if (explicit.has(key)) return select(remaining.slice(1), attachments)
            explicit.add(key)
            return select(remaining.slice(1), [...attachments, { selection: "automatic", ...snapshot.value }])
          }),
        )
    }
    const attachments = yield* select(candidates, [])
    return { status: attachments.length === 0 ? "no-match" as const : "selected" as const, attachments }
  }).pipe(Effect.catchCause(() => Effect.succeed({ status: "unavailable" as const, attachments: [] })))
}

function targetOf(sessionID: SessionSchema.ID, profile: SessionContextProfile.Profile) {
  return profile.kind === "operating-chat"
    ? { instanceID: profile.functionalityInstanceID, functionalityID: profile.functionalityID }
    : { instanceID: `chat-instance:${sessionID}`, functionalityID: "builtin:chat" }
}

function emptySnapshot(): SessionContextSnapshotV1 {
  return { version: 1, attachments: [], byteLength: 0, estimatedTokens: 0, createdAt: Date.now() }
}

function failure(code: string) {
  return Effect.fail(new SessionInput.SessionContextAssemblyError({ code }))
}
