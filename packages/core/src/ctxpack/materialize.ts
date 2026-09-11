// CtxPack materialization + session-input snapshots.
//
// materialize() turns a CtxPack into an immutable, durable context capsule
// ("ctxpack-attachment") via ContextCapsuleStore. snapshotForSessionInput()
// renders capsule-backed session input (fragment texts resolved from the
// CURRENT pack rows) as a deep-frozen SessionContextSnapshot — it never
// writes sessions, usage counters, or events; diagnostics carry bytes and
// counts ONLY, never text.
//
// Capability policy is host-authoritative: every check goes through
// CapabilityService (X0) with frozen subjects; denials surface as
// MaterializeError "CtxPackCapabilityDenied" with the denied operation.

import { Context, Effect, Layer, Option, Schema } from "effect"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import type { CtxPackError } from "@opencode-ai/schema/ctxpack"
import { CtxPackRepositoryService, node as CtxPackRepositoryNode } from "../ctxpack/sql"
import type { CtxPackRepository } from "../ctxpack/sql"
import { Service as CapabilityService, node as CapabilityNode } from "../capability/service"
import type { Interface as CapabilityInterface } from "../capability/service"
import type { CapabilityCheckInput } from "../capability/service"
import type { CapabilitySubject } from "../capability/subjects"
import { Service as ContextCapsuleStoreTag, node as ContextCapsuleNode } from "../context-broker/capsule"
import type { ContextBudget, ContextCapsuleStore, StoredCapsule } from "../context-broker/capsule"
import { DefaultInteractiveContextBudget } from "../context-broker/capsule"
import { create as createID } from "../id/id"
import { makeGlobalNode } from "../effect/app-node"

// --- Frozen request / result --------------------------------------------------

export interface CtxPackMaterializeRequest {
  workspaceID: string
  ctxPackID: CtxPack.ID
  expectedContentHash: string
  targetInstanceID: string
  targetFunctionalityID: string
}

export interface CtxPackMaterializeResult {
  contextCapsuleID: string
  sourceCtxPackID: CtxPack.ID
  label: string
  tags?: readonly CtxPack.Tag[]
  contentHash: string
  estimatedTokens: number
}

// --- Actor + attachment input --------------------------------------------------

// Same shape C1 froze for the actor.
export interface CtxPackActor {
  userID: string
  workspaceID: string
}

export interface SessionContextAttachmentInput {
  contextCapsuleID: string
  label: string
  contentHash: string
  source: { kind: "ctxpack"; ctxPackID: string }
}

// --- Frozen snapshot -----------------------------------------------------------

export interface SessionContextSnapshot {
  version: 1
  attachments: Array<{
    contextCapsuleID: string
    sourceCtxPackID: string
    label: string
    tags?: readonly CtxPack.Tag[]
    contentHash: string
    fragments: Array<{ text: string; source: CtxPack.Source; contentHash: string }>
  }>
  byteLength: number
  estimatedTokens: number
  createdAt: number
}

// --- Errors --------------------------------------------------------------------

export type MaterializeError =
  | { _tag: "CtxPackCapabilityDenied"; operation: string }
  | { _tag: "CtxPackCapsuleMissing" }
  | { _tag: "CtxPackCapsuleExpired"; expiresAt: number }
  | { _tag: "CtxPackCapsuleTargetMismatch"; target: "audience" | "instance" | "purpose" | "workspace" }
  | { _tag: "CtxPackSnapshotOverBudget"; current: number; maximum: number }
  | { _tag: "CtxPackSnapshotDuplicateCapsule"; contextCapsuleID: string }

// --- Diagnostics (bytes/counts only, never text) --------------------------------

export interface MaterializeDiagnosticsEntry {
  readonly operation: "materialize" | "snapshot"
  readonly workspaceID: string
  readonly attachmentCount: number
  readonly byteLength: number
  readonly estimatedTokens: number
}

export interface MaterializeDiagnostics {
  readonly record: (entry: MaterializeDiagnosticsEntry) => Effect.Effect<void>
}

export class DiagnosticsService extends Context.Service<DiagnosticsService, MaterializeDiagnostics>()(
  "@opencode/v2/CtxPackMaterializeDiagnostics",
) {}

const NoopDiagnostics: MaterializeDiagnostics = {
  record: () => Effect.void,
}

// --- Constants -------------------------------------------------------------------

export const MAX_SNAPSHOT_ATTACHMENTS = 8

// --- Helpers ----------------------------------------------------------------------

// "ctxkpsl_" + ascending id (mirrors the S1 id pattern; local helper so the
// capsule id is assigned before store() sees it).
const newContextCapsuleID = () => createID("ctxkpsl", "ascending")

const packSubject = (workspaceID: string, pack: CtxPack.Info): CapabilitySubject => ({
  type: "CtxPack",
  workspaceID,
  ctxPackID: pack.id,
  sensitivity: pack.sensitivity,
  createdByUserID: pack.createdByUserID,
})

const instanceSubject = (input: {
  workspaceID: string
  instanceID: string
  functionalityID: string
}): CapabilitySubject => ({
  type: "FunctionalityInstance",
  workspaceID: input.workspaceID,
  instanceID: input.instanceID,
  functionalityID: input.functionalityID,
})

// Capability denials are part of the local MaterializeError surface.
const requireCapability = (
  capability: CapabilityInterface,
  input: CapabilityCheckInput,
): Effect.Effect<void, MaterializeError> =>
  capability
    .require(input)
    .pipe(
      Effect.mapError(
        (error) => ({ _tag: "CtxPackCapabilityDenied", operation: error.operation }) satisfies MaterializeError,
      ),
    )

const ctxPackRef = (pack: CtxPack.Info) => ({ type: "ctxpack", id: pack.id })

const ctxPackReference = (pack: CtxPack.Info) => ({
  kind: "ctxpack",
  ref: ctxPackRef(pack),
  label: pack.title,
  contentHash: pack.contentHash,
  sensitivity: pack.sensitivity,
})

// Fragment text appears ONLY in the capsule reference summary (immutable
// durable store) — never in events, errors, logs, or result projections.
const fragmentToContextReference = (fragment: CtxPack.Fragment) => ({
  kind: "ctxpack.fragment",
  ref: { type: "ctxpack-fragment", id: fragment.id },
  label: fragment.source.label ?? `Fragment ${fragment.ordinal + 1}`,
  summary: fragment.text,
  contentHash: fragment.contentHash,
  sensitivity: fragment.source.sensitivity,
})

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

const isFragmentReference = (
  entry: unknown,
): entry is { kind: "ctxpack.fragment"; ref: { type: "ctxpack-fragment"; id: string } } => {
  if (typeof entry !== "object" || entry === null) return false
  const ref = (entry as { ref?: unknown }).ref
  if (typeof ref !== "object" || ref === null) return false
  const refRecord = ref as { type?: unknown; id?: unknown }
  return refRecord.type === "ctxpack-fragment" && typeof refRecord.id === "string"
}

// --- Interface -------------------------------------------------------------------

export interface CtxPackMaterializer {
  materialize(
    actor: CtxPackActor,
    request: CtxPackMaterializeRequest,
  ): Effect.Effect<CtxPackMaterializeResult, CtxPackError | MaterializeError>
  snapshotForSessionInput(input: {
    actor: CtxPackActor
    targetInstanceID: string
    targetFunctionalityID: string
    attachments: readonly SessionContextAttachmentInput[]
    budget: ContextBudget
  }): Effect.Effect<SessionContextSnapshot, CtxPackError | MaterializeError>
}

export class Service extends Context.Service<Service, CtxPackMaterializer>()("@opencode/v2/CtxPackMaterializer") {}

// --- Implementation ----------------------------------------------------------------

export function make(input: {
  repository: CtxPackRepository
  capability: CapabilityInterface
  capsuleStore: ContextCapsuleStore
  diagnostics?: MaterializeDiagnostics
}): CtxPackMaterializer {
  const repository = input.repository
  const capability = input.capability
  const capsuleStore = input.capsuleStore
  const diagnostics = input.diagnostics ?? NoopDiagnostics

  const materialize: CtxPackMaterializer["materialize"] = (actor, request) =>
    Effect.gen(function* () {
      // The pack row is needed for the frozen subject (sensitivity/owner), so
      // fetch first. includeDeleted=true so a deleted pack surfaces as
      // CtxPackDeleted below instead of being hidden.
      const pack = yield* repository.get(actor.workspaceID, request.ctxPackID, true)
      yield* requireCapability(capability, {
        userID: actor.userID,
        operation: "ctxpack.materialize",
        subject: packSubject(actor.workspaceID, pack),
      })
      yield* requireCapability(capability, {
        userID: actor.userID,
        operation: "chat.context.attach",
        subject: instanceSubject({
          workspaceID: actor.workspaceID,
          instanceID: request.targetInstanceID,
          functionalityID: request.targetFunctionalityID,
        }),
      })
      if (pack.deletedAt !== null) {
        return yield* Effect.fail({ _tag: "CtxPackDeleted", ctxPackID: pack.id } satisfies CtxPackError)
      }
      if (pack.contentHash !== request.expectedContentHash) {
        return yield* Effect.fail({
          _tag: "CtxPackContentChanged",
          currentContentHash: pack.contentHash,
        } satisfies CtxPackError)
      }

      const ref = ctxPackRef(pack)
      const capsule: StoredCapsule = {
        id: newContextCapsuleID(),
        version: 1,
        workspaceId: pack.workspaceID,
        createdBy: { userId: actor.userID, instanceId: request.targetInstanceID },
        purpose: "ctxpack-attachment",
        audience: [request.targetFunctionalityID],
        summary: pack.title,
        facts: [
          { key: "ctxpack.id", value: pack.id, sourceRef: ref, sensitivity: pack.sensitivity },
          { key: "ctxpack.fragmentCount", value: pack.fragments.length, sourceRef: ref, sensitivity: pack.sensitivity },
          ...(pack.tags?.length
            ? [{ key: "ctxpack.tags", value: pack.tags, sourceRef: ref, sensitivity: pack.sensitivity }]
            : []),
        ],
        references: [ctxPackReference(pack), ...pack.fragments.map(fragmentToContextReference)],
        artifactRefs: [],
        recentEvents: [],
        budget: DefaultInteractiveContextBudget,
        contentHash: pack.contentHash,
        createdAt: Date.now(),
        expiresAt: undefined,
      }

      // Capsule-store failures (immutable-write conflict, corrupt JSON) are
      // storage-level and surface as defects; the frozen error union has no
      // variant for them (mirrors the S1 repository's toDomainError policy).
      const stored = yield* capsuleStore.store(capsule).pipe(Effect.orDie)
      yield* diagnostics.record({
        operation: "materialize",
        workspaceID: actor.workspaceID,
        attachmentCount: 1,
        byteLength: pack.byteLength,
        estimatedTokens: pack.estimatedTokens,
      })

      // No usage-counter change: usage is Q1/C2's post-admission concern.
      return {
        contextCapsuleID: stored.id,
        sourceCtxPackID: pack.id,
        label: pack.title,
        ...(pack.tags?.length ? { tags: pack.tags } : {}),
        contentHash: pack.contentHash,
        estimatedTokens: pack.estimatedTokens,
      }
    })

  const snapshotForSessionInput: CtxPackMaterializer["snapshotForSessionInput"] = (input) =>
    Effect.gen(function* () {
      yield* requireCapability(capability, {
        userID: input.actor.userID,
        operation: "chat.context.attach",
        subject: instanceSubject({
          workspaceID: input.actor.workspaceID,
          instanceID: input.targetInstanceID,
          functionalityID: input.targetFunctionalityID,
        }),
      })

      if (input.attachments.length === 0) {
        const empty: SessionContextSnapshot = {
          version: 1,
          attachments: [],
          byteLength: 0,
          estimatedTokens: 0,
          createdAt: Date.now(),
        }
        yield* diagnostics.record({
          operation: "snapshot",
          workspaceID: input.actor.workspaceID,
          attachmentCount: 0,
          byteLength: 0,
          estimatedTokens: 0,
        })
        return deepFreeze(empty)
      }

      // Duplicate capsule ids reject the whole snapshot.
      const seen = new Set<string>()
      for (const attachment of input.attachments) {
        if (seen.has(attachment.contextCapsuleID)) {
          return yield* Effect.fail({
            _tag: "CtxPackSnapshotDuplicateCapsule",
            contextCapsuleID: attachment.contextCapsuleID,
          } satisfies MaterializeError)
        }
        seen.add(attachment.contextCapsuleID)
      }

      if (input.attachments.length > MAX_SNAPSHOT_ATTACHMENTS) {
        return yield* Effect.fail({
          _tag: "CtxPackInvalidSelection",
          reason: "too-many-attachments",
        } satisfies CtxPackError)
      }

      // Resolve every attachment IN ORDER; any failure rejects the whole snapshot.
      const resolved: Array<{
        attachment: SessionContextAttachmentInput
        pack: CtxPack.Info
        tags: readonly CtxPack.Tag[]
        fragments: Array<{ text: string; source: CtxPack.Source; contentHash: string }>
      }> = []
      for (const attachment of input.attachments) {
        const capsule = yield* capsuleStore.get(input.actor.workspaceID, attachment.contextCapsuleID).pipe(Effect.orDie)
        if (!capsule) {
          return yield* Effect.fail({ _tag: "CtxPackCapsuleMissing" } satisfies MaterializeError)
        }
        if (capsule.workspaceId !== input.actor.workspaceID) {
          return yield* Effect.fail({
            _tag: "CtxPackCapsuleTargetMismatch",
            target: "workspace",
          } satisfies MaterializeError)
        }
        if (capsule.purpose !== "ctxpack-attachment") {
          return yield* Effect.fail({
            _tag: "CtxPackCapsuleTargetMismatch",
            target: "purpose",
          } satisfies MaterializeError)
        }
        if (capsule.createdBy.instanceId !== input.targetInstanceID) {
          return yield* Effect.fail({
            _tag: "CtxPackCapsuleTargetMismatch",
            target: "instance",
          } satisfies MaterializeError)
        }
        if (!capsule.audience.includes(input.targetFunctionalityID)) {
          return yield* Effect.fail({
            _tag: "CtxPackCapsuleTargetMismatch",
            target: "audience",
          } satisfies MaterializeError)
        }
        if (capsule.expiresAt !== undefined && capsule.expiresAt !== null && capsule.expiresAt <= Date.now()) {
          return yield* Effect.fail({
            _tag: "CtxPackCapsuleExpired",
            expiresAt: capsule.expiresAt,
          } satisfies MaterializeError)
        }
        const pack = yield* repository.get(input.actor.workspaceID, attachment.source.ctxPackID as CtxPack.ID, true)
        if (pack.deletedAt !== null) {
          return yield* Effect.fail({ _tag: "CtxPackDeleted", ctxPackID: pack.id } satisfies CtxPackError)
        }
        yield* requireCapability(capability, {
          userID: input.actor.userID,
          operation: "ctxpack.read",
          subject: packSubject(input.actor.workspaceID, pack),
        })
        if (capsule.contentHash !== attachment.contentHash) {
          return yield* Effect.fail({
            _tag: "CtxPackContentChanged",
            currentContentHash: capsule.contentHash,
          } satisfies CtxPackError)
        }

        // Fragment texts come from the CURRENT pack row (immutable by
        // contract), keyed by the capsule's fragment reference ids.
        const fragmentsById = new Map<string, CtxPack.Fragment>(
          pack.fragments.map((fragment) => [fragment.id, fragment]),
        )
        const fragments: Array<{ text: string; source: CtxPack.Source; contentHash: string }> = []
        for (const reference of capsule.references.filter(isFragmentReference)) {
          const fragment = fragmentsById.get(reference.ref.id)
          if (!fragment) {
            return yield* Effect.fail({
              _tag: "CtxPackContentChanged",
              currentContentHash: pack.contentHash,
            } satisfies CtxPackError)
          }
          fragments.push({ text: fragment.text, source: fragment.source, contentHash: fragment.contentHash })
        }
        const tagFact = capsule.facts.find(
          (fact) => typeof fact === "object" && fact !== null && "key" in fact && fact.key === "ctxpack.tags",
        )
        const tags = Schema.decodeUnknownSync(Schema.Array(CtxPack.Tag))(
          typeof tagFact === "object" && tagFact !== null && "value" in tagFact ? tagFact.value : [],
        )
        resolved.push({ attachment, pack, tags, fragments })
      }

      const snapshotAttachments = resolved.map(({ attachment, tags, fragments }) => ({
        contextCapsuleID: attachment.contextCapsuleID,
        sourceCtxPackID: attachment.source.ctxPackID,
        label: attachment.label,
        ...(tags.length ? { tags } : {}),
        contentHash: attachment.contentHash,
        fragments,
      }))

      const createdAt = Date.now()
      const payload = { version: 1 as const, attachments: snapshotAttachments, createdAt }
      const byteLength = new TextEncoder().encode(JSON.stringify(payload)).length
      const estimatedTokens = Math.ceil(byteLength / 4)
      if (byteLength > input.budget.maximumBytes) {
        return yield* Effect.fail({
          _tag: "CtxPackSnapshotOverBudget",
          current: byteLength,
          maximum: input.budget.maximumBytes,
        } satisfies MaterializeError)
      }
      if (estimatedTokens > input.budget.maximumEstimatedTokens) {
        return yield* Effect.fail({
          _tag: "CtxPackSnapshotOverBudget",
          current: estimatedTokens,
          maximum: input.budget.maximumEstimatedTokens,
        } satisfies MaterializeError)
      }

      const snapshot: SessionContextSnapshot = { ...payload, byteLength, estimatedTokens }
      yield* diagnostics.record({
        operation: "snapshot",
        workspaceID: input.actor.workspaceID,
        attachmentCount: input.attachments.length,
        byteLength,
        estimatedTokens,
      })
      // Deep immutable: later pack mutation/deletion cannot change this object.
      return deepFreeze(snapshot)
    })

  return { materialize, snapshotForSessionInput }
}

// --- Wiring -----------------------------------------------------------------------

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const repository = yield* CtxPackRepositoryService
    const capability = yield* CapabilityService
    const capsuleStore = yield* ContextCapsuleStoreTag
    const diagnostics = Context.getOption(yield* Effect.context(), DiagnosticsService).pipe(
      Option.getOrElse(() => NoopDiagnostics),
    )
    return make({ repository, capability, capsuleStore, diagnostics })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [CtxPackRepositoryNode, CapabilityNode, ContextCapsuleNode],
})
