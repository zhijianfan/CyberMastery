import { OperatingChatSessionService } from "@opencode-ai/core/workspace/operating-chat-session"
import {
  OperatingChatAccessDeniedError,
  OperatingChatBlockNotFoundError,
  OperatingChatBusyError,
  OperatingChatConfigurationError,
  OperatingChatInstanceNotFoundError,
  OperatingChatStaleBindingError,
  OperatingChatWorkspaceNotFoundError,
  OperatingChatWrongFunctionalityError,
} from "@opencode-ai/protocol/groups/operating-chat"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { requestUser } from "../middleware/authorization"
import { AccessDeniedError, OperatingChatAccessService } from "./operating-chat-access"

type LookupError =
  | OperatingChatSessionService.WorkspaceNotFoundError
  | OperatingChatSessionService.BlockNotFoundError
  | OperatingChatSessionService.WrongFunctionalityError
  | AccessDeniedError

function toHttpLookupError(error: LookupError) {
  if (error._tag === "OperatingChat.WorkspaceNotFoundError") {
    return new OperatingChatWorkspaceNotFoundError({
      workspaceID: error.workspaceID,
      message: `Workspace not found: ${error.workspaceID}`,
    })
  }
  if (error._tag === "OperatingChat.BlockNotFoundError") {
    return new OperatingChatBlockNotFoundError({
      workspaceID: error.workspaceID,
      blockID: error.blockID,
      message: `Workspace ${error.workspaceID} has no block ${error.blockID}`,
    })
  }
  if (error._tag === "OperatingChat.WrongFunctionalityError") {
    return new OperatingChatWrongFunctionalityError({
      blockID: error.blockID,
      message: `Block ${error.blockID} is not a builtin:operating-chat-session block`,
    })
  }
  return new OperatingChatAccessDeniedError({
    workspaceID: error.workspaceID,
    blockID: error.blockID,
    message: `Access to workspace ${error.workspaceID} block ${error.blockID} denied`,
  })
}

type EnsureError = LookupError | OperatingChatSessionService.ConfigurationError

function toHttpEnsureError(error: EnsureError) {
  if (error._tag !== "OperatingChat.ConfigurationError") return toHttpLookupError(error)
  return new OperatingChatConfigurationError({
    workspaceID: error.workspaceID,
    message: `Workspace ${error.workspaceID} does not have a valid OperatingAgent model`,
  })
}

type ResetError =
  | EnsureError
  | OperatingChatSessionService.InstanceNotFoundError
  | OperatingChatSessionService.StaleBindingError
  | OperatingChatSessionService.BusyError

function toHttpResetError(error: ResetError) {
  if (error._tag === "OperatingChat.InstanceNotFoundError") {
    return new OperatingChatInstanceNotFoundError({
      workspaceID: error.workspaceID,
      blockID: error.blockID,
      message: `OperatingChat binding for block ${error.blockID} is no longer present`,
    })
  }
  if (error._tag === "OperatingChat.StaleBindingError") {
    return new OperatingChatStaleBindingError({
      currentRevision: error.currentRevision,
      message: `Stale OperatingChat binding revision: ${error.currentRevision}`,
    })
  }
  if (error._tag === "OperatingChat.BusyError") {
    return new OperatingChatBusyError({
      sessionID: error.sessionID,
      message: `OperatingChat session ${error.sessionID} is active or has pending input`,
    })
  }
  return toHttpEnsureError(error)
}

export const OperatingChatHandler = HttpApiBuilder.group(Api, "server.workspace.operatingChat", (handlers) =>
  Effect.gen(function* () {
    const operatingChat = yield* OperatingChatSessionService.Service
    const access = yield* OperatingChatAccessService

    return handlers
      .handle(
        "workspace.operatingChat.get",
        Effect.fn(function* (ctx) {
          const user = yield* requestUser
          yield* access
            .requireAccess(ctx.params.workspaceID, ctx.params.blockID, user.id)
            .pipe(Effect.mapError(toHttpLookupError))
          const binding = yield* operatingChat
            .get(ctx.params.workspaceID, ctx.params.blockID)
            .pipe(Effect.mapError(toHttpLookupError))
          return binding ? { status: "bound" as const, binding } : { status: "unbound" as const }
        }),
      )
      .handle(
        "workspace.operatingChat.ensure",
        Effect.fn(function* (ctx) {
          const user = yield* requestUser
          yield* access
            .requireAccess(ctx.params.workspaceID, ctx.params.blockID, user.id)
            .pipe(Effect.mapError(toHttpEnsureError))
          return yield* operatingChat
            .ensure(ctx.params.workspaceID, ctx.params.blockID)
            .pipe(Effect.mapError(toHttpEnsureError))
        }),
      )
      .handle(
        "workspace.operatingChat.reset",
        Effect.fn(function* (ctx) {
          const user = yield* requestUser
          yield* access
            .requireAccess(ctx.params.workspaceID, ctx.params.blockID, user.id)
            .pipe(Effect.mapError(toHttpResetError))
          return yield* operatingChat
            .reset(
              ctx.params.workspaceID,
              ctx.params.blockID,
              ctx.payload.expectedSessionID,
              ctx.payload.expectedRevision,
            )
            .pipe(Effect.mapError(toHttpResetError))
        }),
      )
  }),
)
