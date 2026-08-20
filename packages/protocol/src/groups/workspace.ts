import { Workspace } from "@opencode-ai/schema/workspace"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceCoder } from "./workspace-coder"

const root = "/api/workspace"

export class WorkspaceError extends Schema.ErrorClass<WorkspaceError>("WorkspaceError")(
  {
    name: Schema.Literal("WorkspaceError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

export class WorkspaceNotFoundError extends Schema.TaggedErrorClass<WorkspaceNotFoundError>()("WorkspaceNotFoundError", {
  workspaceID: Workspace.ID,
  message: Schema.String,
}, { httpApiStatus: 404 }) {}

const UpdatePayload = Schema.Struct({
  id: Workspace.ID,
  patch: Schema.Struct({
    name: Schema.optional(Schema.String),
    style: Schema.optional(Schema.String),
    directories: Schema.optional(Schema.Array(Schema.String)),
    pluginIDs: Schema.optional(Schema.Array(Schema.String)),
    skillIDs: Schema.optional(Schema.Array(Schema.String)),
    operatingAgent: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    ...WorkspaceCoder.patchFields,
  }),
}).annotate({ identifier: "Workspace.UpdatePayload" })

const LayoutGetPayload = Schema.Struct({
  workspaceID: Workspace.ID,
  tuple: Workspace.Layout.Tuple,
  clientID: Schema.String,
}).annotate({ identifier: "Workspace.Layout.GetPayload" })

const LayoutSavePayload = Schema.Struct({
  workspaceID: Workspace.ID,
  tuple: Workspace.Layout.Tuple,
  blocks: Schema.Array(Workspace.Block.Record),
  expectedRevision: NonNegativeInt,
  clientID: Schema.String,
}).annotate({ identifier: "Workspace.Layout.SavePayload" })

const LayoutSaveResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("saved"),
    layout: Workspace.Layout.Info,
  }),
  Schema.Struct({
    status: Schema.Literal("conflict"),
    currentRevision: NonNegativeInt,
  }),
  Schema.Struct({
    status: Schema.Literal("handed-over"),
    currentRevision: NonNegativeInt,
  }),
]).annotate({ identifier: "Workspace.Layout.SaveResult" })

export const WorkspaceGroup = HttpApiGroup.make("server.workspace")
  .add(
    HttpApiEndpoint.get("workspace.list", root, {
      success: Schema.Array(Workspace.Info),
      error: WorkspaceError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.list",
        summary: "List workspaces",
        description: "Retrieve all workspaces for the current user.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.create", root, {
      payload: Schema.Struct({ name: Schema.String }),
      success: Workspace.Info,
      error: WorkspaceError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.create",
        summary: "Create workspace",
        description: "Create a workspace with a name.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("workspace.get", `${root}/:id`, {
      params: { id: Workspace.ID },
      success: Workspace.Info,
      error: [WorkspaceError, WorkspaceNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.get",
        summary: "Get workspace",
        description: "Retrieve a workspace by ID.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("workspace.update", root, {
      payload: UpdatePayload,
      success: Workspace.Info,
      error: [WorkspaceError, WorkspaceNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.update",
        summary: "Update workspace",
        description: "Update a workspace's name, style, directories, plugins, or skills.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("workspace.remove", `${root}/:id`, {
      params: { id: Workspace.ID },
      success: HttpApiSchema.NoContent,
      error: [WorkspaceError, WorkspaceNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.remove",
        summary: "Remove workspace",
        description: "Delete a workspace by ID.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.duplicate", `${root}/:id/duplicate`, {
      params: { id: Workspace.ID },
      success: Workspace.Info,
      error: [WorkspaceError, WorkspaceNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.duplicate",
        summary: "Duplicate workspace",
        description: "Create a copy of an existing workspace.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.layout.get", `${root}/layout`, {
      payload: LayoutGetPayload,
      success: Workspace.Layout.Info,
      error: [WorkspaceError, WorkspaceNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.layout.get",
        summary: "Get layout",
        description:
          "Resolve the layout for a (user, style, deviceClass) tuple, creating the default layout if missing.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.layout.save", `${root}/layout/save`, {
      payload: LayoutSavePayload,
      success: LayoutSaveResult,
      error: [WorkspaceError, WorkspaceNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.layout.save",
        summary: "Save layout",
        description: "Save layout blocks for a tuple, checking the expected revision for conflicts.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("workspace.functionality.list", `${root}/:workspaceID/functionality`, {
      params: { workspaceID: Workspace.ID },
      success: Schema.Array(Workspace.Functionality.Info),
      error: WorkspaceError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.functionality.list",
        summary: "List workspace functionality",
        description: "List functionality available for a workspace.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "workspace", description: "Workspace management routes." }))
