export * as Workspace from "./workspace"

import { Schema } from "effect"
import { NonNegativeInt, optional, PositiveInt } from "./schema"
import { WorkspaceEvent } from "./workspace-event"
import { WorkspaceID } from "./workspace-id"

export const ID = WorkspaceID
export type ID = WorkspaceID

export const Event = WorkspaceEvent

export const Info = Schema.Struct({
  id: ID,
  name: Schema.String,
  style: Schema.String,
  directories: Schema.Array(Schema.String),
  pluginIDs: Schema.Array(Schema.String),
  skillIDs: Schema.Array(Schema.String),
  git: Schema.Array(
    Schema.Struct({
      directory: Schema.String,
      branch: optional(Schema.String),
      remote: optional(Schema.String),
      dirty: Schema.Boolean,
    }),
  ),
  time: Schema.Struct({ created: NonNegativeInt, updated: NonNegativeInt }),
}).annotate({ identifier: "Workspace.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export namespace Block {
  export const Transform = Schema.Struct({
    x: NonNegativeInt,
    y: NonNegativeInt,
    w: PositiveInt,
    h: PositiveInt,
    z: Schema.Int,
  }).annotate({ identifier: "Workspace.Block.Transform" })
  export interface Transform extends Schema.Schema.Type<typeof Transform> {}

  export const Record = Schema.Struct({
    id: Schema.String,
    functionality: Schema.String,
    transform: Transform,
  }).annotate({ identifier: "Workspace.Block.Record" })
  export interface Record extends Schema.Schema.Type<typeof Record> {}
}

export namespace Layout {
  export const Tuple = Schema.Struct({
    user: Schema.String,
    style: Schema.String,
    deviceClass: Schema.Literals(["desktop", "mobile", "tablet"]),
    deviceID: optional(Schema.String),
  }).annotate({ identifier: "Workspace.Layout.Tuple" })
  export interface Tuple extends Schema.Schema.Type<typeof Tuple> {}

  export const Info = Schema.Struct({
    id: Schema.String,
    workspaceID: ID,
    revision: NonNegativeInt,
    blocks: Schema.Array(Block.Record),
  }).annotate({ identifier: "Workspace.Layout.Info" })
  export interface Info extends Schema.Schema.Type<typeof Info> {}

  export const Option = Schema.Struct({
    tuple: Tuple,
    layoutID: Schema.String,
  }).annotate({ identifier: "Workspace.Layout.Option" })
  export interface Option extends Schema.Schema.Type<typeof Option> {}
}

export namespace Functionality {
  export const Info = Schema.Struct({
    id: Schema.String,
    kind: Schema.Literals(["builtin", "plugin"]),
    label: Schema.String,
    icon: optional(Schema.String),
    minW: NonNegativeInt,
    minH: NonNegativeInt,
    maxW: Schema.Union([Schema.Literal(null), NonNegativeInt]),
    maxH: Schema.Union([Schema.Literal(null), NonNegativeInt]),
  }).annotate({ identifier: "Workspace.Functionality.Info" })
  export interface Info extends Schema.Schema.Type<typeof Info> {}
}
