import { WorkspaceService } from "@opencode-ai/core/workspace"
import { Effect, Layer } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { WorkspaceError, WorkspaceNotFoundError } from "@opencode-ai/protocol/groups/workspace"
import { requestUser } from "../middleware/authorization"
import { WorkspaceMasterAgentHandler } from "./workspace-master-agent"

// Track S2 composition: the MasterAgent lifecycle group (S1) mounts under the
// same P3-composed server Api as the existing Workspace group. Both groups
// keep their service requirements (WorkspaceService, MasterAgentService,
// MasterAgentAccessService) open; the host composition (opencode app / cli
// serve) provides the live layers.
export const WorkspaceHandler = Layer.mergeAll(
  HttpApiBuilder.group(Api, "server.workspace", (handlers) =>
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
        .handle("workspace.remove", (ctx) =>
          requestUser.pipe(
            Effect.flatMap((user) =>
              WorkspaceService.Service.use((workspace) =>
                mapWorkspaceError(workspace.remove(ctx.params.id, user.id)).pipe(
                  Effect.as(HttpApiSchema.NoContent.make()),
                ),
              ),
            ),
          ),
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
        .handle("workspace.layout.save", (ctx) =>
          requestUser.pipe(
            Effect.flatMap((user) =>
              WorkspaceService.Service.use((workspace) =>
                mapWorkspaceError(
                  workspace.layout
                    .save(
                      ctx.payload.workspaceID,
                      { ...ctx.payload.tuple, user: user.id },
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
                ),
              ),
            ),
          ),
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
  ),
  WorkspaceMasterAgentHandler,
)

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
