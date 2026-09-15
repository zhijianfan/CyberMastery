import { NonNegativeInt } from "@opencode-ai/core/schema"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionID } from "@/session/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"
import {
  MAX_SYNC_PAGE_BYTES,
  MAX_SYNC_PUBLIC_EVENTS,
  MAX_SYNC_RECORD_CHUNKS,
} from "@/control-plane/session-context-transfer-spool"

const root = "/sync"
export const MAX_SYNC_AGGREGATES = 128
export { MAX_SYNC_PAGE_BYTES, MAX_SYNC_PUBLIC_EVENTS, MAX_SYNC_RECORD_CHUNKS }

export const LegacyReplayEvent = Schema.Struct({
  id: EventV2.ID,
  aggregateID: Schema.String,
  seq: NonNegativeInt,
  type: Schema.String,
  data: Schema.Record(Schema.String, Schema.Unknown),
})
export const LegacyReplayPayload = Schema.Struct({
  directory: Schema.String,
  events: Schema.NonEmptyArray(LegacyReplayEvent),
})
export const LegacyReplayResponse = Schema.Struct({
  sessionID: Schema.String,
})
export const SessionPayload = Schema.Struct({
  sessionID: SessionID,
})
export const LegacyHistoryPayload = Schema.Record(Schema.String, NonNegativeInt)
export const LegacyHistoryEvent = Schema.Struct({
  id: EventV2.ID,
  aggregate_id: Schema.String,
  seq: NonNegativeInt,
  type: Schema.String,
  data: Schema.Record(Schema.String, Schema.Unknown),
})

const Digest = Schema.String
const HighWater = Schema.Record(Schema.String, NonNegativeInt)
export const SyncStartPayloadV1 = Schema.Struct({
  version: Schema.Literal(1),
  action: Schema.Literals(["grant", "revoke"]),
  workspaceID: Schema.String,
  topologyRevision: Schema.String,
  expiresAt: NonNegativeInt,
  requestToken: Schema.String,
})
export const SyncStartResponseV1 = Schema.Struct({
  version: Schema.Literal(1),
  acceptedRevision: Schema.String,
  expiresAt: NonNegativeInt,
  transferRequired: Schema.Boolean,
})
export const HistoryAggregateCursorV1 = Schema.Struct({
  cursor: NonNegativeInt,
  privateDigest: Digest,
})
export const HistoryPayloadV1 = Schema.Struct({
  version: Schema.Literal(1),
  capabilityOnly: Schema.Boolean,
  discoveryCursor: Schema.optional(Schema.String),
  aggregates: Schema.Record(Schema.String, HistoryAggregateCursorV1),
  sourceSnapshotToken: Schema.optional(Schema.String),
  pageCursor: Schema.optional(Schema.String),
  repairCursor: Schema.optional(Schema.String),
})
export const SyncPrivateManifestV1 = Schema.Struct({
  aggregateID: Schema.String,
  sourceSeq: NonNegativeInt,
  privateCount: NonNegativeInt,
  privateDigest: Digest,
  deletionCount: NonNegativeInt,
  deletionDigest: Digest,
  epochDigest: Schema.optional(Digest),
})
export const CompleteSyncRecordV1 = Schema.Struct({
  kind: Schema.Literals(["event", "context", "deletion", "epoch"]),
  aggregateID: Schema.String,
  sourceSeq: NonNegativeInt,
  sequence: NonNegativeInt,
  identity: Schema.String,
  value: Schema.Unknown,
})
export const ChunkSyncRecordV1 = Schema.Struct({
  kind: Schema.Literal("chunk"),
  recordKind: Schema.Literals(["event", "context", "deletion", "epoch"]),
  aggregateID: Schema.String,
  sourceSeq: NonNegativeInt,
  sequence: NonNegativeInt,
  identity: Schema.String,
  chunkIndex: NonNegativeInt,
  chunkCount: NonNegativeInt,
  byteLength: NonNegativeInt,
  contentHash: Digest,
  data: Schema.String,
})
export const SyncPageV1 = Schema.Struct({
  records: Schema.Array(Schema.Union([CompleteSyncRecordV1, ChunkSyncRecordV1])),
})
export const HistoryResponseV1 = Schema.Struct({
  version: Schema.Literal(1),
  aggregates: Schema.Array(SyncPrivateManifestV1),
  discoveryCursor: Schema.optional(Schema.String),
  sourceSnapshotToken: Schema.String,
  manifestDigest: Digest,
  highWater: HighWater,
  page: SyncPageV1,
  nextCursor: Schema.optional(Schema.String),
})
export const ReplayBeginV1 = Schema.Struct({
  version: Schema.Literal(1),
  action: Schema.Literal("begin"),
  clientTransferID: Schema.String,
  directory: Schema.String,
  sourceSnapshotToken: Schema.String,
  highWater: HighWater,
  manifestDigest: Digest,
  expiresAt: NonNegativeInt,
})
export const ReplayAppendV1 = Schema.Struct({
  version: Schema.Literal(1),
  action: Schema.Literal("append"),
  transferHandle: Schema.String,
  pageIndex: NonNegativeInt,
  pageHash: Digest,
  page: SyncPageV1,
})
export const ReplayFinalizeV1 = Schema.Struct({
  version: Schema.Literal(1),
  action: Schema.Literal("finalize"),
  transferHandle: Schema.String,
  expectedPageCount: NonNegativeInt,
  manifestDigest: Digest,
})
export const ReplayAbortV1 = Schema.Struct({
  version: Schema.Literal(1),
  action: Schema.Literal("abort"),
  transferHandle: Schema.String,
})
export const ReplayPayloadV1 = Schema.Union([ReplayBeginV1, ReplayAppendV1, ReplayFinalizeV1, ReplayAbortV1])
export const ReplayPayload = Schema.Union([LegacyReplayPayload, ReplayPayloadV1])
export const ReplayResponseV1 = Schema.Union([
  Schema.Struct({
    version: Schema.Literal(1),
    action: Schema.Literal("begin"),
    transferHandle: Schema.String,
    expiresAt: NonNegativeInt,
  }),
  Schema.Struct({
    version: Schema.Literal(1),
    action: Schema.Literal("append"),
    transferHandle: Schema.String,
    nextPageIndex: NonNegativeInt,
  }),
  Schema.Struct({ version: Schema.Literal(1), action: Schema.Literal("finalize"), manifestReceipt: Digest }),
  Schema.Struct({ version: Schema.Literal(1), action: Schema.Literal("abort"), transferHandle: Schema.String }),
])
export const ReplayResponse = Schema.Union([LegacyReplayResponse, ReplayResponseV1])
export const HistoryPayload = Schema.Union([LegacyHistoryPayload, HistoryPayloadV1])
export const HistoryResponse = Schema.Union([Schema.Array(LegacyHistoryEvent), HistoryResponseV1])
export const ReplayEvent = LegacyReplayEvent
export const HistoryEvent = LegacyHistoryEvent

export class SyncConflictError extends Schema.TaggedErrorClass<SyncConflictError>()(
  "SyncConflictError",
  { code: Schema.Literals(["conflict", "restart", "snapshot-advanced", "version"]), message: Schema.String },
  { httpApiStatus: 409 },
) {}
export class SyncTooLargeError extends Schema.TaggedErrorClass<SyncTooLargeError>()(
  "SyncTooLargeError",
  { message: Schema.String },
  { httpApiStatus: 413 },
) {}
export class SyncBusyError extends Schema.TaggedErrorClass<SyncBusyError>()(
  "SyncBusyError",
  { message: Schema.String },
  { httpApiStatus: 503 },
) {}
export class SyncExpiredError extends Schema.TaggedErrorClass<SyncExpiredError>()(
  "SyncExpiredError",
  { message: Schema.String },
  { httpApiStatus: 410 },
) {}

export const SyncPaths = {
  start: `${root}/start`,
  replay: `${root}/replay`,
  steal: `${root}/steal`,
  history: `${root}/history`,
} as const

export const SyncApi = HttpApi.make("sync")
  .add(
    HttpApiGroup.make("sync")
      .add(
        HttpApiEndpoint.post("start", SyncPaths.start, {
          query: WorkspaceRoutingQuery,
          payload: [HttpApiSchema.NoContent, SyncStartPayloadV1],
          success: described(Schema.Union([Schema.Boolean, SyncStartResponseV1]), "Workspace sync started"),
          error: SyncConflictError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sync.start",
            summary: "Start workspace sync",
            description: "Start sync loops for workspaces in the current project that have active sessions.",
          }),
        ),
        HttpApiEndpoint.post("replay", SyncPaths.replay, {
          query: WorkspaceRoutingQuery,
          payload: ReplayPayload,
          success: described(ReplayResponse, "Replayed sync events"),
          error: [HttpApiError.BadRequest, SyncConflictError, SyncTooLargeError, SyncBusyError, SyncExpiredError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sync.replay",
            summary: "Replay sync events",
            description: "Validate and replay a complete sync event history.",
          }),
        ),
        HttpApiEndpoint.post("steal", SyncPaths.steal, {
          query: WorkspaceRoutingQuery,
          payload: SessionPayload,
          success: described(SessionPayload, "Session stolen into workspace"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sync.steal",
            summary: "Steal session into workspace",
            description: "Update a session to belong to the current workspace through the sync event system.",
          }),
        ),
        HttpApiEndpoint.post("history", SyncPaths.history, {
          query: WorkspaceRoutingQuery,
          payload: HistoryPayload,
          success: described(HistoryResponse, "Sync events"),
          error: [HttpApiError.BadRequest, SyncConflictError, SyncTooLargeError, SyncExpiredError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sync.history.list",
            summary: "List sync events",
            description:
              "List sync events for all aggregates. Keys are aggregate IDs the client already knows about, values are the last known sequence ID. Events with seq > value are returned for those aggregates. Aggregates not listed in the input get their full history.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "sync",
          description: "Experimental HttpApi sync routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
