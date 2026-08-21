// Capability wiring helpers for CtxPack operations. Kept here so C1/P1 reuse
// them: thin wrappers over X0's CapabilityService.require building the frozen
// subjects, mapping a deny to the S1 CtxPackError "CtxPackPermissionDenied".

import { Effect } from "effect"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import type { CtxPackError } from "@opencode-ai/schema/ctxpack"
import { Service as CapabilityService } from "../capability/service"
import type { CapabilitySubject } from "../capability/subjects"

const denied = (operation: string) =>
  ({ _tag: "CtxPackPermissionDenied", operation } satisfies CtxPackError)

// requirePackOperation: a CtxPack-scoped operation (read/create/patch/remove/
// restore/materialize) evaluated against the frozen CtxPack subject. Requires
// the CapabilityService (tag); hosts provide it at wiring time.
export function requirePackOperation(input: {
  userID: string
  workspaceID: string
  operation: string
  pack: CtxPack.Info
}): Effect.Effect<void, CtxPackError, CapabilityService> {
  const subject: CapabilitySubject = {
    type: "CtxPack",
    workspaceID: input.workspaceID,
    ctxPackID: input.pack.id,
    sensitivity: input.pack.sensitivity,
    createdByUserID: input.pack.createdByUserID,
  }
  return CapabilityService.pipe(
    Effect.flatMap((service) => service.require({ userID: input.userID, operation: input.operation, subject })),
    Effect.mapError((error) => denied(error.operation)),
  )
}

// requireWorkspaceOperation: a Workspace-scoped operation (e.g. listing).
export function requireWorkspaceOperation(input: {
  userID: string
  workspaceID: string
  operation: string
}): Effect.Effect<void, CtxPackError, CapabilityService> {
  const subject: CapabilitySubject = { type: "Workspace", workspaceID: input.workspaceID }
  return CapabilityService.pipe(
    Effect.flatMap((service) => service.require({ userID: input.userID, operation: input.operation, subject })),
    Effect.mapError((error) => denied(error.operation)),
  )
}
