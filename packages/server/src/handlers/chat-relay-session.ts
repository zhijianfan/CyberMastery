// ChatRelay block lifecycle handlers (Track S1).
//
// Thin translation layer between the P2 HttpApi group and the F4 lifecycle
// service: validate caller access first, forward get/ensure/reset unchanged, and
// map typed domain errors onto the P2 protocol error schemas. No business logic
// lives here; the F4 service owns workspace/block verification, binding
// transitions, session creation, and event publication.

import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import {
  ChatRelayAccessDeniedError,
  ChatRelayBlockNotFoundError,
  ChatRelayBusyError,
  ChatRelayInstanceNotFoundError,
  ChatRelayStaleBindingError,
  ChatRelayWrongFunctionalityError,
  ChatRelayWorkspaceNotFoundError,
} from "@opencode-ai/protocol/groups/chat-relay"
import { ChatRelaySessionService } from "@opencode-ai/core/workspace/chat-relay-session"
import { AccessDeniedError, ChatRelaySessionAccessService } from "./chat-relay-session-access"
import { Api } from "../api"

type AccessCheckedDomainError =
  | ChatRelaySessionService.WorkspaceNotFoundError
  | ChatRelaySessionService.BlockNotFoundError
  | ChatRelaySessionService.WrongFunctionalityError
  | AccessDeniedError

function toHttpGetError(error: AccessCheckedDomainError) {
  if (error._tag === "ChatRelay.WorkspaceNotFoundError") {
    return new ChatRelayWorkspaceNotFoundError({
      workspaceID: error.workspaceID,
      message: `Workspace not found: ${error.workspaceID}`,
    })
  }
  if (error._tag === "ChatRelay.BlockNotFoundError") {
    return new ChatRelayBlockNotFoundError({
      workspaceID: error.workspaceID,
      blockID: error.blockID,
      message: `Workspace ${error.workspaceID} has no block ${error.blockID}`,
    })
  }
  if (error._tag === "ChatRelay.WrongFunctionalityError") {
    return new ChatRelayWrongFunctionalityError({
      blockID: error.blockID,
      message: `Block ${error.blockID} is not a builtin:chat-relay block`,
    })
  }
  return new ChatRelayAccessDeniedError({
    workspaceID: error.workspaceID,
    blockID: error.blockID,
    message: `Access to workspace ${error.workspaceID} block ${error.blockID} denied`,
  })
}

type ResetDomainError =
  | ChatRelaySessionService.WorkspaceNotFoundError
  | ChatRelaySessionService.BlockNotFoundError
  | ChatRelaySessionService.WrongFunctionalityError
  | ChatRelaySessionService.InstanceNotFoundError
  | ChatRelaySessionService.StaleBindingError
  | ChatRelaySessionService.BusyError
  | AccessDeniedError

function toHttpResetError(error: ResetDomainError) {
  if (error._tag === "ChatRelay.WorkspaceNotFoundError") {
    return new ChatRelayWorkspaceNotFoundError({
      workspaceID: error.workspaceID,
      message: `Workspace not found: ${error.workspaceID}`,
    })
  }
  if (error._tag === "ChatRelay.BlockNotFoundError") {
    return new ChatRelayBlockNotFoundError({
      workspaceID: error.workspaceID,
      blockID: error.blockID,
      message: `Workspace ${error.workspaceID} has no block ${error.blockID}`,
    })
  }
  if (error._tag === "ChatRelay.WrongFunctionalityError") {
    return new ChatRelayWrongFunctionalityError({
      blockID: error.blockID,
      message: `Block ${error.blockID} is not a builtin:chat-relay block`,
    })
  }
  if (error._tag === "ChatRelay.InstanceNotFoundError") {
    return new ChatRelayInstanceNotFoundError({
      workspaceID: error.workspaceID,
      blockID: error.blockID,
      message: `ChatRelay binding for block ${error.blockID} is no longer present for workspace ${error.workspaceID}`,
    })
  }
  if (error._tag === "ChatRelay.StaleBindingError") {
    return new ChatRelayStaleBindingError({
      currentRevision: error.currentRevision,
      message: `Stale ChatRelay binding revision: ${error.currentRevision}`,
    })
  }
  if (error._tag === "ChatRelay.BusyError") {
    return new ChatRelayBusyError({
      sessionID: error.sessionID,
      message: `ChatRelay session ${error.sessionID} is currently active or has pending input`,
    })
  }
  return new ChatRelayAccessDeniedError({
    workspaceID: error.workspaceID,
    blockID: error.blockID,
    message: `Access to workspace ${error.workspaceID} block ${error.blockID} denied`,
  })
}

export const ChatRelaySessionHandler = HttpApiBuilder.group(Api, "server.workspace.chatRelay", (handlers) =>
  Effect.gen(function* () {
    const chatRelaySession = yield* ChatRelaySessionService.Service
    const access = yield* ChatRelaySessionAccessService

    return handlers
      .handle(
        "workspace.chatRelay.get",
        Effect.fn(function* (ctx) {
          yield* access
            .requireAccess(ctx.params.workspaceID, ctx.params.blockID)
            .pipe(Effect.mapError(toHttpGetError))
          const binding = yield* chatRelaySession
            .get(ctx.params.workspaceID, ctx.params.blockID)
            .pipe(Effect.mapError(toHttpGetError))
          return binding === undefined ? { status: "unbound" } : { status: "bound", binding }
        }),
      )
      .handle(
        "workspace.chatRelay.ensure",
        Effect.fn(function* (ctx) {
          yield* access
            .requireAccess(ctx.params.workspaceID, ctx.params.blockID)
            .pipe(Effect.mapError(toHttpGetError))
          return yield* chatRelaySession
            .ensure(ctx.params.workspaceID, ctx.params.blockID)
            .pipe(Effect.mapError(toHttpGetError))
        }),
      )
      .handle(
        "workspace.chatRelay.reset",
        Effect.fn(function* (ctx) {
          yield* access
            .requireAccess(ctx.params.workspaceID, ctx.params.blockID)
            .pipe(Effect.mapError(toHttpResetError))
          return yield* chatRelaySession
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
