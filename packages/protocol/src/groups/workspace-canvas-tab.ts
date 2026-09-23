import { CanvasTab } from "@opencode-ai/schema/canvas-tab"
import { NonNegativeInt, optional } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const identity = Schema.String.check(Schema.isMinLength(1))
const root = "/api/workspace/:workspaceID/canvas-tab/:kind"
const params = { workspaceID: Workspace.ID, kind: CanvasTab.Kind }
const ownedParams = { ...params, blockID: identity }
const errorFields = {
  workspaceID: Workspace.ID,
  blockID: optional(Schema.String),
  tabID: optional(Schema.String),
  message: Schema.String,
}

export class CanvasTabAccessDeniedError extends Schema.TaggedErrorClass<CanvasTabAccessDeniedError>()(
  "CanvasTabAccessDeniedError",
  errorFields,
  { httpApiStatus: 403 },
) {}

export class CanvasTabNotFoundError extends Schema.TaggedErrorClass<CanvasTabNotFoundError>()(
  "CanvasTabNotFoundError",
  errorFields,
  { httpApiStatus: 404 },
) {}

export class CanvasTabWrongKindError extends Schema.TaggedErrorClass<CanvasTabWrongKindError>()(
  "CanvasTabWrongKindError",
  { ...errorFields, kind: CanvasTab.Kind },
  { httpApiStatus: 409 },
) {}

export class CanvasTabStaleRevisionError extends Schema.TaggedErrorClass<CanvasTabStaleRevisionError>()(
  "CanvasTabStaleRevisionError",
  { ...errorFields, currentRevision: optional(NonNegativeInt) },
  { httpApiStatus: 409 },
) {}

export class CanvasTabBusyError extends Schema.TaggedErrorClass<CanvasTabBusyError>()(
  "CanvasTabBusyError",
  errorFields,
  { httpApiStatus: 409 },
) {}

export class CanvasTabDeletedBlockError extends Schema.TaggedErrorClass<CanvasTabDeletedBlockError>()(
  "CanvasTabDeletedBlockError",
  errorFields,
  { httpApiStatus: 409 },
) {}

export class CanvasTabConflictError extends Schema.TaggedErrorClass<CanvasTabConflictError>()(
  "CanvasTabConflictError",
  errorFields,
  { httpApiStatus: 409 },
) {}

export class CanvasTabInvalidRequestError extends Schema.TaggedErrorClass<CanvasTabInvalidRequestError>()(
  "CanvasTabInvalidRequestError",
  errorFields,
  { httpApiStatus: 400 },
) {}

const errors = [
  CanvasTabAccessDeniedError,
  CanvasTabNotFoundError,
  CanvasTabWrongKindError,
  CanvasTabStaleRevisionError,
  CanvasTabBusyError,
  CanvasTabDeletedBlockError,
  CanvasTabConflictError,
  CanvasTabInvalidRequestError,
]

export const CanvasTabOwnedQuery = Schema.Struct({
  // The cursor stays opaque on the wire; handlers validate its decoded fields.
  cursor: optional(Schema.String),
  limit: optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
  ),
}).annotate({ identifier: "CanvasTab.OwnedQuery" })

export const CanvasTabArchivedQuery = Schema.Struct({
  ...CanvasTabOwnedQuery.fields,
  search: optional(Schema.String),
}).annotate({ identifier: "CanvasTab.ArchivedQuery" })

// Relay has no V2 binding revision. Handlers require this field for V2 kinds.
const mutationFields = {
  expectedRevision: NonNegativeInt,
  expectedBindingRevision: optional(NonNegativeInt),
}

export const CanvasTabCreatePayload = Schema.Struct({
  ...mutationFields,
  requestID: identity,
}).annotate({ identifier: "CanvasTab.CreatePayload" })

export const CanvasTabSelectPayload = Schema.Struct({
  ...mutationFields,
  tabID: identity,
}).annotate({ identifier: "CanvasTab.SelectPayload" })

export const CanvasTabArchivePayload = Schema.Struct({
  expectedRevision: NonNegativeInt,
  tuple: Workspace.Layout.Tuple,
  expectedLayoutRevision: NonNegativeInt,
  clientID: identity,
}).annotate({ identifier: "CanvasTab.ArchivePayload" })

export const CanvasTabOwnedResult = Schema.Struct({
  ...CanvasTab.Page.fields,
  selectedTabID: Schema.NullOr(Schema.String),
  revision: NonNegativeInt,
  bindingRevision: optional(NonNegativeInt),
}).annotate({ identifier: "CanvasTab.OwnedResult" })

export const CanvasTabMutationResult = Schema.Struct({
  selected: CanvasTab.Entry,
  revision: NonNegativeInt,
  bindingRevision: optional(NonNegativeInt),
}).annotate({ identifier: "CanvasTab.MutationResult" })

export const CanvasTabArchiveResult = Schema.Struct({
  archivedCount: NonNegativeInt,
  layoutRevision: NonNegativeInt,
  tabRevision: NonNegativeInt,
}).annotate({ identifier: "CanvasTab.ArchiveResult" })

export const CanvasTabGroup = HttpApiGroup.make("server.workspace.canvasTab")
  .add(
    HttpApiEndpoint.get("workspace.canvasTab.listOwned", `${root}/owned/:blockID`, {
      params: ownedParams,
      query: CanvasTabOwnedQuery,
      success: CanvasTabOwnedResult,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.canvasTab.listOwned",
        summary: "List block conversation tabs",
        description:
          "List owned tabs by creation time and ID, newest first, with selected identity and registry revision. Cursor is a JSON-encoded creation time and ID pair. Default page size is 6. Writable reflects current runtime availability, including read-only saved Relay tabs.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("workspace.canvasTab.listArchived", `${root}/archived`, {
      params,
      query: CanvasTabArchivedQuery,
      success: CanvasTab.Page,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.canvasTab.listArchived",
        summary: "List archived conversation tabs",
        description:
          "List same-workspace, same-kind archived tabs newest first using a stable creation time and ID cursor. Search matches titles or exact conversation/tab IDs, never transcript contents. Default page size is 6.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.canvasTab.create", `${root}/owned/:blockID/create`, {
      params: ownedParams,
      payload: CanvasTabCreatePayload,
      success: CanvasTabMutationResult,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.canvasTab.create",
        summary: "Create and select a conversation tab",
        description:
          "Create one new conversation with a stable requestID for exact retries. Preserve existing tabs. Require expectedBindingRevision for Master Agent and Operating Chat, and expectedRevision for every kind.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.canvasTab.select", `${root}/owned/:blockID/select`, {
      params: ownedParams,
      payload: CanvasTabSelectPayload,
      success: CanvasTabMutationResult,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.canvasTab.select",
        summary: "Select an owned conversation tab",
        description:
          "Select an owned tab with registry and, for V2 kinds, binding revision guards. Busy transitions preserve the prior selection. Saved Relay tabs may be selected with writable=false.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.canvasTab.restore", `${root}/owned/:blockID/restore`, {
      params: ownedParams,
      payload: CanvasTabSelectPayload,
      success: CanvasTabMutationResult,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.canvasTab.restore",
        summary: "Restore and select an archived conversation tab",
        description:
          "Atomically restore a same-workspace, same-kind archived tab into this block and select it. Require expectedBindingRevision for V2 kinds. Keep the former selection as an inactive owned tab.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.canvasTab.archive", `${root}/owned/:blockID/archive`, {
      params: ownedParams,
      payload: CanvasTabSelectPayload,
      success: CanvasTabMutationResult,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.canvasTab.archive",
        summary: "Archive an inactive conversation tab",
        description:
          "Move one inactive owned tab into the same-workspace, same-kind archive. The selected tab cannot be archived directly; select another tab first. Master Agent and Operating Chat also mark the conversation archived, and Chat Relay keeps its saved transcript.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace.canvasTab.archiveAndRemove", `${root}/owned/:blockID/archive-and-remove`, {
      params: ownedParams,
      payload: CanvasTabArchivePayload,
      success: CanvasTabArchiveResult,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.canvasTab.archiveAndRemove",
        summary: "Archive block tabs and remove the block",
        description:
          "Archive all owned tabs, fence the binding, and remove the block from matching layouts atomically. Authenticate the tuple user on the server. Idempotent retries return archived count and current revisions.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({ title: "canvas-tabs", description: "Workspace-scoped conversation tab registry." }),
  )
