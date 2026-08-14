export * as Functionality from "./functionality"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema"

export const Right = Schema.Literals(["read", "write", "execute"]).annotate({ identifier: "Functionality.Right" })
export type Right = typeof Right.Type

export const Availability = Schema.Union([
  Schema.Struct({ status: Schema.Literal("available") }),
  Schema.Struct({ status: Schema.Literal("degraded"), reason: Schema.String }),
  Schema.Struct({ status: Schema.Literal("unavailable"), reason: Schema.String }),
]).annotate({ identifier: "Functionality.Availability" })
export type Availability = typeof Availability.Type

export const Manifest = Schema.Struct({
  id: Schema.String,
  version: NonNegativeInt,
  label: Schema.String,
  description: Schema.String,
  icon: Schema.String,
  kind: Schema.Literals(["builtin", "plugin"]),
  renderer: Schema.Struct({ moduleId: Schema.String, exportName: Schema.String }),
  constraints: Schema.Struct({
    initialAspect: Schema.Literals(["square", "free"]),
    minW: NonNegativeInt,
    minH: NonNegativeInt,
    maxW: optional(NonNegativeInt),
    maxH: optional(NonNegativeInt),
  }),
  lifecycle: Schema.Struct({
    clientWhenHidden: Schema.Literals(["suspend", "keep-mounted"]),
    hostWhenNoViewers: Schema.Literals(["keep-running", "idle", "stop"]),
    idleTimeoutMs: optional(NonNegativeInt),
  }),
  concurrency: Schema.Struct({
    policy: Schema.Literals(["serial", "parallel", "latest-wins", "singleton"]),
    maximumActive: NonNegativeInt,
    maximumQueued: NonNegativeInt,
  }),
  rights: Schema.Struct({
    mount: Schema.Array(Right),
    operations: Schema.Record(Schema.String, Schema.Array(Right)),
  }),
  context: Schema.Struct({
    accepts: Schema.Array(Schema.String),
    produces: Schema.Array(Schema.String),
    defaultBudget: Schema.Struct({
      maximumBytes: NonNegativeInt,
      maximumEstimatedTokens: NonNegativeInt,
      maximumFacts: NonNegativeInt,
      maximumReferences: NonNegativeInt,
      maximumArtifacts: NonNegativeInt,
      maximumRecentEvents: NonNegativeInt,
    }),
  }),
}).annotate({ identifier: "Functionality.Manifest" })
export interface Manifest extends Schema.Schema.Type<typeof Manifest> {}

export const Instance = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  blockId: Schema.String,
  functionalityId: Schema.String,
  functionalityVersion: NonNegativeInt,
  configurationRevision: NonNegativeInt,
  configuration: Schema.Unknown,
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
  deletedAt: optional(NonNegativeInt),
}).annotate({ identifier: "Functionality.Instance" })
export interface Instance extends Schema.Schema.Type<typeof Instance> {}

export const OperationStatus = Schema.Literals([
  "admitted",
  "queued",
  "running",
  "cancel-requested",
  "cancelled",
  "succeeded",
  "failed",
  "interrupted",
]).annotate({ identifier: "Functionality.OperationStatus" })
export type OperationStatus = typeof OperationStatus.Type

export const Operation = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  instanceId: Schema.String,
  functionalityId: Schema.String,
  port: Schema.String,
  status: OperationStatus,
  priority: Schema.Int,
  idempotencyKey: Schema.String,
  input: Schema.Unknown,
  contextCapsuleId: optional(Schema.String),
  requestedByUserId: Schema.String,
  requestedAt: NonNegativeInt,
  startedAt: optional(NonNegativeInt),
  finishedAt: optional(NonNegativeInt),
  cancelRequestedAt: optional(NonNegativeInt),
  resultRef: optional(Schema.Unknown),
  error: optional(Schema.Unknown),
}).annotate({ identifier: "Functionality.Operation" })
export interface Operation extends Schema.Schema.Type<typeof Operation> {}

export const Event = Schema.Struct({
  cursor: Schema.String,
  eventId: Schema.String,
  workspaceId: Schema.String,
  instanceId: optional(Schema.String),
  eventType: Schema.String,
  schemaVersion: NonNegativeInt,
  correlationId: Schema.String,
  causationId: optional(Schema.String),
  payload: Schema.Unknown,
  artifactRefs: Schema.Array(Schema.Unknown),
  createdAt: NonNegativeInt,
}).annotate({ identifier: "Functionality.Event" })
export interface Event extends Schema.Schema.Type<typeof Event> {}

export const Artifact = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  kind: Schema.String,
  mimeType: Schema.String,
  contentHash: Schema.String,
  byteLength: NonNegativeInt,
  payloadRef: Schema.String,
  sensitivity: Schema.Literals(["public", "workspace", "private", "secret"]),
  metadata: Schema.Unknown,
  createdAt: NonNegativeInt,
  deletedAt: optional(NonNegativeInt),
}).annotate({ identifier: "Functionality.Artifact" })
export interface Artifact extends Schema.Schema.Type<typeof Artifact> {}

export const Capsule = Schema.Struct({
  id: Schema.String,
  version: Schema.Literal(1),
  workspaceId: Schema.String,
  purpose: Schema.String,
  audience: Schema.Array(Schema.String),
  summary: optional(Schema.String),
  facts: Schema.Array(Schema.Unknown),
  references: Schema.Array(Schema.Unknown),
  artifactRefs: Schema.Array(Schema.Unknown),
  recentEvents: Schema.Array(Schema.Unknown),
  contentHash: Schema.String,
  createdAt: NonNegativeInt,
  expiresAt: optional(NonNegativeInt),
}).annotate({ identifier: "Functionality.Capsule" })
export interface Capsule extends Schema.Schema.Type<typeof Capsule> {}
