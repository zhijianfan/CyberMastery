// MasterAgent caller-access validation port (Track S1).
//
// The MasterAgent handler layer calls requireAccess before invoking any
// lifecycle operation, so an access failure can never reach the F4 service.
// The live implementation is permissive because this fork's Authorization
// middleware already gates every route (401) and workspaces are global rows
// with no per-caller ownership model; the port exists so a per-workspace
// policy can be injected at composition time without touching the handlers
// (devplan/master-agent/master-agent-max-parallel-plan/02-contracts-and-data-model.md §4).
//
// Block-level validation (block exists and targets builtin:master-agent) is
// owned by the F4 lifecycle service and surfaces as WrongFunctionalityError;
// this module only owns the caller-access seam.

import { Context, Effect, Layer, Schema } from "effect"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"

export * as MasterAgentAccess from "./workspace-master-agent-access"

export class AccessDeniedError extends Schema.TaggedErrorClass<AccessDeniedError>()(
  "MasterAgent.AccessDeniedError",
  {
    workspaceID: WorkspaceV2.ID,
    blockID: Schema.String,
  },
) {}

export interface MasterAgentAccess {
  readonly requireAccess: (
    workspaceID: WorkspaceV2.ID,
    blockID: string,
  ) => Effect.Effect<void, AccessDeniedError>
}

export class MasterAgentAccessService extends Context.Service<
  MasterAgentAccessService,
  MasterAgentAccess
>()("@opencode/v2/MasterAgentAccess") {}

export const masterAgentAccessLive = Layer.succeed(
  MasterAgentAccessService,
  MasterAgentAccessService.of({
    requireAccess: () => Effect.void,
  }),
)
