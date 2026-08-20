// MasterAgent lifecycle handlers (Track S1).
//
// Thin translation layer between the P2 HttpApi group and the F4 lifecycle
// service: validate caller access first, forward get/ensure/reset unchanged
// (reset passes expected session id and revision through untouched), and map
// typed domain errors onto the P2 protocol error schemas. No business logic
// lives here; the F4 service owns workspace/block verification, binding
// transitions, session creation, and event publication.
//
// Reset follows the repo CAS convention used by workspace.layout.save: stale
// and busy outcomes are returned as a 200 ResetResponse status union rather
// than HTTP errors, so a stale client sees the current revision and the
// manager can reconcile without collapsing policy failures into a 500.
//
// The group is mounted against the P3-composed server Api (see
// packages/server/src/handlers/workspace.ts, Track S2); the group service key
// ("effect/httpapi/HttpApiGroup/server.workspace.masterAgent") derives solely
// from the group identifier, so the layer mounts unchanged.

import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import {
  MasterAgentAccessDeniedError,
  MasterAgentWorkspaceNotFoundError,
  MasterAgentWrongFunctionalityError,
} from "@opencode-ai/protocol/groups/workspace-master-agent"
import { MasterAgentService } from "@opencode-ai/core/workspace/master-agent"
import { AccessDeniedError, MasterAgentAccessService } from "./workspace-master-agent-access"
import { requestUser } from "../middleware/authorization"
import { Api } from "../api"

type DomainError =
  | MasterAgentService.WorkspaceNotFoundError
  | MasterAgentService.WrongFunctionalityError
  | AccessDeniedError

function toHttpError(error: DomainError) {
  if (error._tag === "MasterAgent.WorkspaceNotFoundError") {
    return new MasterAgentWorkspaceNotFoundError({
      workspaceID: error.workspaceID,
      message: `Workspace not found: ${error.workspaceID}`,
    })
  }
  if (error._tag === "MasterAgent.WrongFunctionalityError") {
    return new MasterAgentWrongFunctionalityError({
      blockID: error.blockID,
      message: `Block ${error.blockID} is not a builtin:master-agent block`,
    })
  }
  return new MasterAgentAccessDeniedError({
    workspaceID: error.workspaceID,
    blockID: error.blockID,
    message: `Access to workspace ${error.workspaceID} block ${error.blockID} denied`,
  })
}

export const WorkspaceMasterAgentHandler = HttpApiBuilder.group(Api, "server.workspace.masterAgent", (handlers) =>
  Effect.gen(function* () {
    const masterAgent = yield* MasterAgentService.Service
    const access = yield* MasterAgentAccessService

    return handlers
      .handle(
        "workspace.masterAgent.get",
        Effect.fn(function* (ctx) {
          const user = yield* requestUser
          yield* access
            .requireAccess(ctx.params.workspaceID, ctx.params.blockID, user.id)
            .pipe(Effect.mapError(toHttpError))
          const binding = yield* masterAgent
            .get(ctx.params.workspaceID, ctx.params.blockID)
            .pipe(Effect.mapError(toHttpError))
          return binding === undefined ? { status: "unbound" } : { status: "bound", binding }
        }),
      )
      .handle(
        "workspace.masterAgent.ensure",
        Effect.fn(function* (ctx) {
          const user = yield* requestUser
          yield* access
            .requireAccess(ctx.params.workspaceID, ctx.params.blockID, user.id)
            .pipe(Effect.mapError(toHttpError))
          return yield* masterAgent
            .ensure(ctx.params.workspaceID, ctx.params.blockID)
            .pipe(Effect.mapError(toHttpError))
        }),
      )
      .handle(
        "workspace.masterAgent.reset",
        Effect.fn(function* (ctx) {
          const user = yield* requestUser
          yield* access
            .requireAccess(ctx.params.workspaceID, ctx.params.blockID, user.id)
            .pipe(Effect.mapError(toHttpError))
          return yield* masterAgent
            .reset(
              ctx.params.workspaceID,
              ctx.params.blockID,
              ctx.payload.expectedSessionID,
              ctx.payload.expectedRevision,
            )
            .pipe(
              // F4 collapses active-run and pending-input resets into BusyError.
              Effect.catchTag("MasterAgent.StaleBindingError", (error) =>
                Effect.succeed({ status: "stale", currentRevision: error.currentRevision } as const),
              ),
              Effect.catchTag("MasterAgent.BusyError", () =>
                Effect.succeed({ status: "busy", reason: "session-active-or-pending-input" } as const),
              ),
              Effect.mapError(toHttpError),
              Effect.map((result) => ("status" in result ? result : ({ status: "reset", binding: result } as const))),
            )
        }),
      )
  }),
)
