import { WorkspaceService } from "@opencode-ai/core/workspace"
import { Effect, Layer } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { WorkspaceError } from "@opencode-ai/protocol/groups/workspace"
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
        .handle("workspace.list", () => WorkspaceService.Service.use((workspace) => badRequest(workspace.list())))
        .handle("workspace.get", (ctx) =>
          WorkspaceService.Service.use((workspace) =>
            badRequest(workspace.get(ctx.params.id)).pipe(
              Effect.flatMap((info) =>
                info === undefined
                  ? Effect.fail(new WorkspaceError({ name: "WorkspaceError", data: { message: "Workspace not found" } }))
                  : Effect.succeed(info),
              ),
            ),
          ),
        )
        .handle("workspace.create", (ctx) =>
          WorkspaceService.Service.use((workspace) => badRequest(workspace.create({ name: ctx.payload.name }))),
        )
        .handle("workspace.update", (ctx) =>
          WorkspaceService.Service.use((workspace) => badRequest(workspace.update(ctx.payload.id, ctx.payload.patch))),
        )
        .handle("workspace.remove", (ctx) =>
          WorkspaceService.Service.use((workspace) =>
            badRequest(workspace.remove(ctx.params.id)).pipe(Effect.as(HttpApiSchema.NoContent.make())),
          ),
        )
        .handle("workspace.duplicate", (ctx) =>
          WorkspaceService.Service.use((workspace) => badRequest(workspace.duplicate(ctx.params.id))),
        )
        .handle("workspace.layout.get", (ctx) =>
          WorkspaceService.Service.use((workspace) =>
            badRequest(workspace.layout.get(ctx.payload.workspaceID, ctx.payload.tuple, ctx.payload.clientID)),
          ),
        )
        .handle("workspace.layout.save", (ctx) =>
          WorkspaceService.Service.use((workspace) =>
            badRequest(
              workspace.layout
                .save(
                  ctx.payload.workspaceID,
                  ctx.payload.tuple,
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
        )
        .handle("workspace.functionality.list", (ctx) =>
          WorkspaceService.Service.use((workspace) => badRequest(workspace.functionality.list(ctx.params.workspaceID))),
        ),
    ),
  ),
  WorkspaceMasterAgentHandler,
)

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
