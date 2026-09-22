import { OperatingChatSessionService } from "@opencode-ai/core/workspace/operating-chat-session"
import {
  OperatingChatAccessDeniedError,
  OperatingChatBlockNotFoundError,
  OperatingChatBusyError,
  OperatingChatConfigurationError,
  OperatingChatConflictError,
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
import { observeCanvasTabs } from "./workspace-canvas-tab"
import { CanvasTabService } from "@opencode-ai/core/workspace/canvas-tab"
import { EventV2 } from "@opencode-ai/core/event"

type LookupError =
  | Effect.Error<ReturnType<OperatingChatSessionService.Interface["get"]>>
  | OperatingChatSessionService.WrongTabError
  | AccessDeniedError

function toHttpLookupError(error: LookupError) {
  if (error._tag.startsWith("CanvasTab.")) return new OperatingChatConflictError({ message: error.message })
  if (error._tag === "OperatingChat.WrongTabError") return new OperatingChatConflictError({ message: error.message })
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
    blockID: error.blockID ?? "",
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
    const tabs = yield* CanvasTabService.Service
    const events = yield* EventV2.Service
    const access = yield* OperatingChatAccessService

    return handlers
      .handle(
        "workspace.operatingChat.get",
        Effect.fn(function* (ctx) {
          const user = yield* requestUser
          yield* access
            .requireAccess(ctx.params.workspaceID, ctx.params.blockID, user.id)
            .pipe(Effect.mapError(toHttpLookupError))
          const binding = yield* observeCanvasTabs(
            tabs,
            events,
            { ...ctx.params, kind: "operating-chat" },
            operatingChat.get(ctx.params.workspaceID, ctx.params.blockID),
          ).pipe(Effect.mapError(toHttpLookupError))
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
          return yield* observeCanvasTabs(
            tabs,
            events,
            { ...ctx.params, kind: "operating-chat" },
            operatingChat.ensure(ctx.params.workspaceID, ctx.params.blockID),
          ).pipe(Effect.mapError(toHttpEnsureError))
        }),
      )
      .handle(
        "workspace.operatingChat.reset",
        Effect.fn(function* (ctx) {
          const user = yield* requestUser
          yield* access
            .requireAccess(ctx.params.workspaceID, ctx.params.blockID, user.id)
            .pipe(Effect.mapError(toHttpResetError))
          return yield* observeCanvasTabs(
            tabs,
            events,
            { ...ctx.params, kind: "operating-chat" },
            Effect.gen(function* () {
              const current = yield* operatingChat.get(ctx.params.workspaceID, ctx.params.blockID)
              if (
                !current ||
                current.sessionID !== ctx.payload.expectedSessionID ||
                current.revision !== ctx.payload.expectedRevision
              )
                return yield* new OperatingChatSessionService.StaleBindingError({
                  currentRevision: current?.revision ?? 0,
                })
              const result = yield* operatingChat.createTab(
                ctx.params.workspaceID,
                ctx.params.blockID,
                ctx.payload.expectedRevision,
                crypto.randomUUID(),
              )
              return result.binding
            }),
          ).pipe(Effect.mapError(toHttpResetError))
        }),
      )
  }),
)
