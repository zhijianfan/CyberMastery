import { WorkspaceService } from "@opencode-ai/core/workspace"
import { Effect, Layer, Schedule } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Api } from "../api"
import { ChatProxyService } from "../chat-proxy"
import { WorkspaceError, WorkspaceNotFoundError } from "@opencode-ai/protocol/groups/workspace"
import { requestUser } from "../middleware/authorization"
import { WorkspaceMasterAgentHandler } from "./workspace-master-agent"

type ChatProxyCleanup = Pick<typeof ChatProxyService, "close" | "closeWorkspace">

export function makeWorkspaceHandler(chatProxy: ChatProxyCleanup) {
  return HttpApiBuilder.group(Api, "server.workspace", (handlers) =>
    Effect.succeed(
      handlers
        .handle("workspace.list", () =>
          requestUser.pipe(
            Effect.flatMap((user) => WorkspaceService.Service.use((workspace) => badRequest(workspace.list(user.id)))),
          ),
        )
        .handle("workspace.get", (ctx) =>
          requestUser.pipe(
            Effect.flatMap((user) =>
              WorkspaceService.Service.use((workspace) => mapWorkspaceError(workspace.get(ctx.params.id, user.id))),
            ),
          ),
        )
        .handle("workspace.create", (ctx) =>
          requestUser.pipe(
            Effect.flatMap((user) =>
              WorkspaceService.Service.use((workspace) =>
                badRequest(workspace.create({ name: ctx.payload.name, user: user.id })),
              ),
            ),
          ),
        )
        .handle("workspace.update", (ctx) =>
          requestUser.pipe(
            Effect.flatMap((user) =>
              WorkspaceService.Service.use((workspace) =>
                mapWorkspaceError(workspace.update(ctx.payload.id, ctx.payload.patch, user.id)),
              ),
            ),
          ),
        )
        .handle(
          "workspace.remove",
          Effect.fn(function* (ctx) {
            const user = yield* requestUser
            const workspace = yield* WorkspaceService.Service
            yield* mapWorkspaceError(workspace.remove(ctx.params.id, user.id))
            yield* browserCleanup({ userID: user.id, workspaceID: ctx.params.id }, () =>
              chatProxy.closeWorkspace(user.id, ctx.params.id),
            )
            return HttpApiSchema.NoContent.make()
          }),
        )
        .handle("workspace.duplicate", (ctx) =>
          requestUser.pipe(
            Effect.flatMap((user) =>
              WorkspaceService.Service.use((workspace) =>
                mapWorkspaceError(workspace.duplicate(ctx.params.id, user.id)),
              ),
            ),
          ),
        )
        .handle("workspace.layout.get", (ctx) =>
          requestUser.pipe(
            Effect.flatMap((user) =>
              WorkspaceService.Service.use((workspace) =>
                mapWorkspaceError(
                  workspace.layout.get(
                    ctx.payload.workspaceID,
                    { ...ctx.payload.tuple, user: user.id },
                    ctx.payload.clientID,
                  ),
                ),
              ),
            ),
          ),
        )
        .handle(
          "workspace.layout.save",
          Effect.fn(function* (ctx) {
            const user = yield* requestUser
            const workspace = yield* WorkspaceService.Service
            const tuple = { ...ctx.payload.tuple, user: user.id }
            const previous = yield* mapWorkspaceError(
              workspace.layout.get(ctx.payload.workspaceID, tuple, ctx.payload.clientID, { claimAuthority: false }),
            )
            const result = yield* mapWorkspaceError(
              workspace.layout
                .save(
                  ctx.payload.workspaceID,
                  tuple,
                  ctx.payload.blocks,
                  ctx.payload.expectedRevision,
                  ctx.payload.clientID,
                )
                .pipe(
                  Effect.map((layout) => ({ status: "saved" as const, layout })),
                  Effect.catchTag("Workspace.LayoutConflictError", (error) =>
                    Effect.succeed({ status: "conflict" as const, currentRevision: error.currentRevision }),
                  ),
                  Effect.catchTag("Workspace.LayoutHandedOverError", (error) =>
                    Effect.succeed({ status: "handed-over" as const, currentRevision: error.currentRevision }),
                  ),
                ),
            )
            if (result.status !== "saved") return result
            yield* cleanupRemovedChatRelays(
              chatProxy,
              workspace,
              user.id,
              ctx.payload.workspaceID,
              previous,
              result.layout,
            )
            return result
          }),
        )
        .handle("workspace.functionality.list", (ctx) =>
          requestUser.pipe(
            Effect.flatMap((user) =>
              WorkspaceService.Service.use((workspace) =>
                badRequest(workspace.functionality.list(ctx.params.workspaceID, user.id)),
              ),
            ),
          ),
        ),
    ),
  )
}

// Track S2 composition: the MasterAgent lifecycle group (S1) mounts under the
// same P3-composed server Api as the existing Workspace group. Both groups
// keep their service requirements (WorkspaceService, MasterAgentService,
// MasterAgentAccessService) open; the host composition (opencode app / cli
// serve) provides the live layers.
export const WorkspaceHandler = Layer.mergeAll(makeWorkspaceHandler(ChatProxyService), WorkspaceMasterAgentHandler)

function mapWorkspaceError<A, R>(effect: Effect.Effect<A, unknown, R>) {
  return effect.pipe(
    Effect.mapError((error) => {
      if (isWorkspaceNotFoundError(error)) {
        return new WorkspaceNotFoundError({
          workspaceID: error.workspaceID,
          message: `Workspace not found: ${error.workspaceID}`,
        })
      }
      return new WorkspaceError({
        name: "WorkspaceError",
        data: {
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }),
  )
}

function isWorkspaceNotFoundError(error: unknown): error is WorkspaceService.WorkspaceNotFoundError {
  return typeof error === "object" && error !== null && "_tag" in error && error._tag === "Workspace.NotFoundError"
}

function badRequest<A, R>(effect: Effect.Effect<A, unknown, R>) {
  return effect.pipe(
    Effect.mapError(
      (error) =>
        new WorkspaceError({
          name: "WorkspaceError",
          data: {
            message: error instanceof Error ? error.message : String(error),
          },
        }),
    ),
  )
}

function cleanupRemovedChatRelays(
  chatProxy: ChatProxyCleanup,
  workspace: WorkspaceService.Interface,
  user: string,
  workspaceID: Parameters<WorkspaceService.Interface["block"]["get"]>[0],
  previous: Workspace.Layout.Info,
  current: Workspace.Layout.Info,
) {
  const currentRelayIDs = new Set(
    current.blocks.filter((block) => block.functionality === "builtin:chat-relay").map((block) => block.id),
  )
  return Effect.forEach(
    previous.blocks.filter((block) => block.functionality === "builtin:chat-relay" && !currentRelayIDs.has(block.id)),
    (block) =>
      workspace.block.get(workspaceID, block.id).pipe(
        Effect.flatMap((remaining) =>
          remaining?.functionality === "builtin:chat-relay"
            ? Effect.void
            : browserCleanup({ userID: user, workspaceID, blockID: block.id }, () =>
                chatProxy.close(user, workspaceID, block.id),
              ),
        ),
        Effect.catch(() => Effect.void),
      ),
    { discard: true },
  )
}

function browserCleanup(details: Readonly<Record<string, string>>, run: () => Promise<unknown>) {
  return Effect.tryPromise(run).pipe(
    Effect.retry({ times: 2, schedule: Schedule.exponential(100) }),
    Effect.catch((error) => Effect.logError("ChatRelay browser cleanup failed", { ...details, error })),
  )
}
