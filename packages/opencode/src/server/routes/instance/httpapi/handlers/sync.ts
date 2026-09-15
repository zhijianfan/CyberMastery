import { createHmac, randomBytes } from "node:crypto"
import { Workspace } from "@/control-plane/workspace"
import { ServerAuth } from "@/server/auth"
import {
  SessionContextTransferSpool,
  SyncTransferBusy,
  SyncTransferConflict,
  SyncTransferExpired,
  SyncTransferTooLarge,
  canonical,
  digest,
  manifestDigest,
  privateManifest,
  type CompleteSyncRecord,
  type SyncPage,
} from "@/control-plane/session-context-transfer-spool"
import * as InstanceState from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionCompactionContext } from "@opencode-ai/core/session/compaction-context"
import { SessionContextTransferReadiness } from "@opencode-ai/core/session/context-transfer-readiness"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionProjectionTransfer } from "@opencode-ai/core/session/projection-transfer"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { HttpServerRequest } from "effect/unstable/http"
import {
  SessionContextEpochTable,
  SessionInputTable,
  SessionMessageTable,
  SessionTable,
} from "@opencode-ai/core/session/sql"
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import { Effect, Layer, Scope } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { isSqlError } from "effect/unstable/sql/SqlError"
import { InstanceHttpApi } from "../api"
import {
  MAX_SYNC_AGGREGATES,
  MAX_SYNC_PAGE_BYTES,
  MAX_SYNC_PUBLIC_EVENTS,
  MAX_SYNC_RECORD_CHUNKS,
  HistoryPayload,
  HistoryPayloadV1,
  ReplayPayload,
  SessionPayload,
  SyncStartPayloadV1,
  SyncBusyError,
  SyncConflictError,
  SyncExpiredError,
  SyncTooLargeError,
} from "../groups/sync"

type Bundle = SessionProjectionTransfer.BundleV1
type Manifest = ReturnType<typeof privateManifest>
type SourceSnapshot = {
  readonly token: string
  readonly binding: string
  readonly expiresAt: number
  readonly highWater: Record<string, number>
  readonly manifests: Manifest[]
  readonly manifestDigest: string
  readonly records: CompleteSyncRecord[]
  readonly frozen: Readonly<Record<string, Bundle>>
  readonly discoveryCursor?: string
}

const sourceSnapshots = new Map<string, SourceSnapshot>()
const cursorKey = randomBytes(32)
const promptAdmittedType = EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1)
const compactionType = EventV2.versionedType(SessionEvent.Compaction.Ended.type, 1)

export const syncHandlers = HttpApiBuilder.group(InstanceHttpApi, "sync", (handlers) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const session = yield* Session.Service
    const scope = yield* Scope.Scope
    const events = yield* EventV2Bridge.Service
    const transfer = yield* SessionProjectionTransfer.Service
    const readiness = yield* SessionContextTransferReadiness.Manager
    const spool = yield* Effect.promise(() => SessionContextTransferSpool.make())
    const { db } = yield* Database.Service

    const requirePrivateAuth = Effect.fn("SyncHttpApi.requirePrivateAuth")(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const authorization = ServerAuth.header()
      if (!authorization || request.headers.authorization !== authorization)
        return yield* conflict("version", "private sync requires host authorization")
    })

    const start = Effect.fn("SyncHttpApi.start")(function* (ctx: {
      payload: void | typeof SyncStartPayloadV1.Type
    }) {
      const workspaceID = yield* InstanceState.workspaceID
      if (ctx.payload?.version === 1) {
        yield* requirePrivateAuth()
        if (workspaceID !== ctx.payload.workspaceID)
          return yield* conflict("conflict", "readiness lease workspace mismatch")
        const lease = {
          ...ctx.payload,
          workspaceID: WorkspaceV2.ID.make(ctx.payload.workspaceID),
        }
        const accepted = yield* (ctx.payload.action === "grant" ? readiness.grant(lease) : readiness.revoke(lease)).pipe(
          Effect.mapError((error) => conflict("version", error.reason)),
        )
        return {
          version: 1 as const,
          ...accepted,
          transferRequired: yield* transfer.required({ workspaceID }),
        }
      }
      if (yield* transfer.required({ workspaceID }))
        return yield* conflict("version", "private state requires sync v1")
      yield* workspace
        .startWorkspaceSyncing((yield* InstanceState.context).project.id)
        .pipe(Effect.ignore, Effect.forkIn(scope))
      return true
    })

    const replay = Effect.fn("SyncHttpApi.replay")(function* (ctx: { payload: typeof ReplayPayload.Type }) {
      const workspaceID = yield* InstanceState.workspaceID
      if ("events" in ctx.payload) {
        if (ctx.payload.events.some(isPrivateMarker))
          return yield* conflict("version", "private state requires sync v1")
        const aggregateIDs = [...new Set(ctx.payload.events.map((event) => SessionSchema.ID.make(event.aggregateID)))]
        const existing = yield* authorizeReplay(
          db,
          aggregateIDs,
          (yield* InstanceState.context).project.id,
          workspaceID,
        )
        if (yield* legacyPrivateRequired(db, existing))
          return yield* conflict("version", "private state requires sync v1")
        const payload: EventV2.SerializedEvent[] = ctx.payload.events.map((event) => ({
          id: event.id,
          aggregateID: event.aggregateID,
          seq: event.seq,
          type: event.type,
          data: { ...event.data },
        }))
        yield* events.replayAll(payload, { ownerID: workspaceID, strictOwner: true })
        return { sessionID: payload[0].aggregateID }
      }

      const payload = ctx.payload
      yield* requirePrivateAuth()
      if (payload.action === "begin") {
        if (Object.keys(payload.highWater).length > MAX_SYNC_AGGREGATES) return yield* new HttpApiError.BadRequest({})
        if (payload.directory !== (yield* InstanceState.context).directory)
          return yield* new HttpApiError.BadRequest({})
        yield* authorizeReplay(
          db,
          Object.keys(payload.highWater).map((id) => SessionSchema.ID.make(id)),
          (yield* InstanceState.context).project.id,
          workspaceID,
        )
        const result = yield* spoolEffect(() =>
          spool.begin({
            workspaceID,
            directory: payload.directory,
            clientTransferID: payload.clientTransferID,
            sourceSnapshotToken: payload.sourceSnapshotToken,
            highWater: payload.highWater,
            manifestDigest: payload.manifestDigest,
            expiresAt: payload.expiresAt,
          }),
        )
        return {
          version: 1 as const,
          action: "begin" as const,
          transferHandle: result.handle,
          expiresAt: result.expiresAt,
        }
      }
      if (payload.action === "append") {
        const result = yield* spoolEffect(() =>
          spool.append({
            handle: payload.transferHandle,
            pageIndex: payload.pageIndex,
            pageHash: payload.pageHash,
            page: payload.page as SyncPage,
          }),
        )
        return {
          version: 1 as const,
          action: "append" as const,
          transferHandle: payload.transferHandle,
          nextPageIndex: result.nextPageIndex,
        }
      }
      if (payload.action === "abort") {
        yield* Effect.promise(() => spool.abort(payload.transferHandle))
        return { version: 1 as const, action: "abort" as const, transferHandle: payload.transferHandle }
      }
      const result = yield* spoolEffect(() =>
        spool.finalize({
          handle: payload.transferHandle,
          expectedPageCount: payload.expectedPageCount,
          manifestDigest: payload.manifestDigest,
        }),
      ).pipe(Effect.tapError(() => Effect.promise(() => spool.abort(payload.transferHandle))))
      if (result.status === "complete")
        return { version: 1 as const, action: "finalize" as const, manifestReceipt: result.receipt }
      yield* Effect.forEach(result.bundles, (bundle) =>
        transfer.restoreBatch({
          bundle,
          expectedWorkspaceID: workspaceID,
          expectedOwnerID: workspaceID,
          publish: true,
        }),
      ).pipe(
        Effect.tapError(() => Effect.promise(() => spool.abort(payload.transferHandle))),
        Effect.mapError(() => new SyncConflictError({ code: "conflict", message: "projection restore conflict" })),
      )
      yield* Effect.promise(() => spool.complete(payload.transferHandle, result.receipt))
      return { version: 1 as const, action: "finalize" as const, manifestReceipt: result.receipt }
    })

    const steal = Effect.fn("SyncHttpApi.steal")(function* (ctx: { payload: typeof SessionPayload.Type }) {
      const workspaceID = yield* InstanceState.workspaceID
      if (!workspaceID) return yield* new HttpApiError.BadRequest({})
      yield* session.setWorkspace({ sessionID: ctx.payload.sessionID, workspaceID })
      return { sessionID: ctx.payload.sessionID }
    })

    const history = Effect.fn("SyncHttpApi.history")(function* (ctx: { payload: typeof HistoryPayload.Type }) {
      const workspaceID = yield* InstanceState.workspaceID
      const projectID = (yield* InstanceState.context).project.id
      if (!isHistoryV1(ctx.payload)) {
        const payload = ctx.payload
        const requested = Object.keys(payload).map((id) => SessionSchema.ID.make(id))
        const aggregateIDs =
          requested.length > 0
            ? requested
            : yield* discover(db, projectID, workspaceID, undefined, Number.MAX_SAFE_INTEGER)
        yield* authorizeExisting(db, aggregateIDs, projectID, workspaceID)
        if (yield* legacyPrivateRequired(db, aggregateIDs))
          return yield* conflict("version", "private state requires sync v1")
        if (aggregateIDs.length === 0) return []
        return yield* db
          .select()
          .from(EventTable)
          .where(inArray(EventTable.aggregate_id, aggregateIDs))
          .orderBy(asc(EventTable.aggregate_id), asc(EventTable.seq))
          .all()
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows.filter((row) => row.seq > (payload[row.aggregate_id] ?? -1))),
          )
      }

      const payload = ctx.payload
      yield* requirePrivateAuth()
      const requested = Object.entries(payload.aggregates)
      if (requested.length > MAX_SYNC_AGGREGATES) return yield* new HttpApiError.BadRequest({})
      for (const [token, snapshot] of sourceSnapshots)
        if (snapshot.expiresAt <= Date.now()) sourceSnapshots.delete(token)
      const binding = canonical({
        projectID,
        workspaceID,
        discoveryCursor: payload.discoveryCursor,
        aggregates: payload.aggregates,
        repairCursor: payload.repairCursor,
      })
      const existing = payload.sourceSnapshotToken ? sourceSnapshots.get(payload.sourceSnapshotToken) : undefined
      if (payload.sourceSnapshotToken && (!existing || existing.binding !== binding))
        return yield* conflict("restart", "sync snapshot expired or request changed")
      if (existing) yield* validateSnapshot(db, transfer, existing)
      const snapshot =
        existing ??
        (yield* makeSnapshot({
          db,
          transfer,
          projectID,
          workspaceID,
          binding,
          discoveryCursor: payload.discoveryCursor,
          repairCursor: payload.repairCursor,
          requested,
        }))
      sourceSnapshots.set(snapshot.token, snapshot)
      const position = payload.pageCursor ? decodeCursor(payload.pageCursor, snapshot.token) : { record: 0, chunk: 0 }
      if (!position) return yield* conflict("restart", "invalid sync page cursor")
      const base = {
        version: 1 as const,
        aggregates: snapshot.manifests,
        discoveryCursor: snapshot.discoveryCursor,
        sourceSnapshotToken: snapshot.token,
        manifestDigest: snapshot.manifestDigest,
        highWater: snapshot.highWater,
      }
      if (payload.capabilityOnly) return { ...base, page: { records: [] }, nextCursor: undefined }
      const page = makePage(snapshot, position, base)
      return { ...base, page: page.page, nextCursor: page.nextCursor }
    })

    return handlers.handle("start", start).handle("replay", replay).handle("steal", steal).handle("history", history)
  }),
).pipe(
  Layer.provide(LayerNode.compile(SessionProjectionTransfer.node)),
)

function discover(
  db: Database.Interface["db"],
  projectID: typeof SessionTable.$inferSelect.project_id,
  workspaceID: typeof SessionTable.$inferSelect.workspace_id | undefined,
  cursor: SessionSchema.ID | undefined,
  limit: number,
) {
  return db
    .select({ id: SessionTable.id })
    .from(SessionTable)
    .where(
      and(
        eq(SessionTable.project_id, projectID),
        workspaceID ? eq(SessionTable.workspace_id, workspaceID) : isNull(SessionTable.workspace_id),
        cursor ? gt(SessionTable.id, cursor) : undefined,
      ),
    )
    .orderBy(asc(SessionTable.id))
    .limit(limit)
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => rows.map((row) => row.id)),
    )
}

function authorizeExisting(
  db: Database.Interface["db"],
  aggregateIDs: ReadonlyArray<SessionSchema.ID>,
  projectID: typeof SessionTable.$inferSelect.project_id,
  workspaceID?: typeof SessionTable.$inferSelect.workspace_id,
) {
  if (aggregateIDs.length === 0) return Effect.void
  return db
    .select({ id: SessionTable.id })
    .from(SessionTable)
    .where(
      and(
        inArray(SessionTable.id, aggregateIDs),
        eq(SessionTable.project_id, projectID),
        workspaceID ? eq(SessionTable.workspace_id, workspaceID) : isNull(SessionTable.workspace_id),
      ),
    )
    .all()
    .pipe(
      Effect.orDie,
      Effect.flatMap((rows) =>
        rows.length === aggregateIDs.length ? Effect.void : Effect.fail(new HttpApiError.BadRequest({})),
      ),
    )
}

function authorizeReplay(
  db: Database.Interface["db"],
  aggregateIDs: ReadonlyArray<SessionSchema.ID>,
  projectID: typeof SessionTable.$inferSelect.project_id,
  workspaceID?: typeof SessionTable.$inferSelect.workspace_id,
) {
  if (aggregateIDs.length === 0) return Effect.succeed<SessionSchema.ID[]>([])
  return Effect.gen(function* () {
    const existing = yield* db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(inArray(SessionTable.id, aggregateIDs))
      .all()
      .pipe(Effect.orDie)
    const authorized = yield* db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(
        and(
          inArray(SessionTable.id, aggregateIDs),
          eq(SessionTable.project_id, projectID),
          workspaceID ? eq(SessionTable.workspace_id, workspaceID) : isNull(SessionTable.workspace_id),
        ),
      )
      .all()
      .pipe(Effect.orDie)
    if (existing.length !== authorized.length) return yield* new HttpApiError.BadRequest({})
    return authorized.map((row) => row.id)
  })
}

function makeSnapshot(input: {
  readonly db: Database.Interface["db"]
  readonly transfer: SessionProjectionTransfer.Interface
  readonly projectID: typeof SessionTable.$inferSelect.project_id
  readonly workspaceID?: typeof SessionTable.$inferSelect.workspace_id
  readonly binding: string
  readonly discoveryCursor?: string
  readonly repairCursor?: string
  readonly requested: ReadonlyArray<[string, { readonly cursor: number; readonly privateDigest: string }]>
}) {
  return Effect.gen(function* () {
    const discovered =
      input.requested.length > 0
        ? input.requested.map(([aggregateID]) => aggregateID)
        : yield* discover(
            input.db,
            input.projectID,
            input.workspaceID,
            input.discoveryCursor ? SessionSchema.ID.make(input.discoveryCursor) : undefined,
            MAX_SYNC_AGGREGATES + 1,
          )
    const discoveredIDs = discovered.slice(0, MAX_SYNC_AGGREGATES).map((id) => SessionSchema.ID.make(id))
    yield* authorizeExisting(input.db, discoveredIDs, input.projectID, input.workspaceID)
    if (input.repairCursor && !discoveredIDs.includes(SessionSchema.ID.make(input.repairCursor)))
      return yield* new HttpApiError.BadRequest({})
    const aggregateIDs =
      input.repairCursor && input.requested.length === 0
        ? [SessionSchema.ID.make(input.repairCursor)]
        : discoveredIDs
    const requested = new Map(input.requested)
    const bundles = yield* input.db
      .transaction(() =>
        Effect.forEach(aggregateIDs, (sessionID) => exportBundle(input.transfer, SessionSchema.ID.make(sessionID))),
      )
      .pipe(Effect.catchIf(isSqlError, Effect.die))
    const manifests = bundles.map(privateManifest)
    const transferredManifests = bundles
      .filter((bundle) => needsPrivate(bundle, requested.get(bundle.aggregateID), input.repairCursor === bundle.aggregateID))
      .map(privateManifest)
      .filter(hasManifest)
    const highWater = Object.fromEntries(bundles.map((bundle) => [bundle.aggregateID, bundle.sourceSeq]))
    const token = randomBytes(24).toString("base64url")
    return {
      token,
      binding: input.binding,
      expiresAt: Date.now() + 5 * 60 * 1000,
      highWater,
      manifests,
      manifestDigest: manifestDigest(transferredManifests),
      records: bundles
        .flatMap((bundle) =>
          recordsFor(bundle, requested.get(bundle.aggregateID), input.repairCursor === bundle.aggregateID),
        )
        .sort(compareRecord),
      frozen: Object.fromEntries(
        bundles.map((bundle) => [bundle.aggregateID, normalizedBundle(bundle, bundle.sourceSeq)]),
      ),
      discoveryCursor:
        !input.repairCursor && discovered.length > MAX_SYNC_AGGREGATES ? discoveredIDs.at(-1) : undefined,
    } satisfies SourceSnapshot
  })
}

function recordsFor(
  bundle: Bundle,
  cursor: { readonly cursor: number; readonly privateDigest: string } | undefined,
  repair: boolean,
) {
  const includePrivate = needsPrivate(bundle, cursor, repair)
  const records: CompleteSyncRecord[] = [
    ...bundle.events
      .filter((event) => event.seq > (cursor?.cursor ?? -1))
      .map((event) => record("event", bundle, event.seq, event.id, event)),
    ...(includePrivate
      ? [
          ...bundle.deletions.map((item) =>
            record("deletion", bundle, item.targetEvent.seq, `${item.targetKind}:${item.targetMessageID}`, item),
          ),
          ...bundle.contexts.map((item) => record("context", bundle, item.seq, `${item.kind}:${item.messageID}`, item)),
        ]
      : []),
  ].sort(
    (left, right) =>
      left.aggregateID.localeCompare(right.aggregateID) ||
      left.sequence - right.sequence ||
      kindRank(left.kind) - kindRank(right.kind) ||
      left.identity.localeCompare(right.identity),
  )
  if (includePrivate && bundle.epoch)
    records.push(record("epoch", bundle, bundle.epoch.sourceSeq, bundle.aggregateID, bundle.epoch))
  return records
}

function needsPrivate(
  bundle: Bundle,
  cursor: { readonly cursor: number; readonly privateDigest: string } | undefined,
  repair: boolean,
) {
  return repair && cursor?.privateDigest !== privateManifest(bundle).privateDigest
}

function validateSnapshot(
  db: Database.Interface["db"],
  transfer: SessionProjectionTransfer.Interface,
  snapshot: SourceSnapshot,
) {
  return db
    .transaction(() =>
      Effect.forEach(Object.entries(snapshot.highWater), ([aggregateID, sourceSeq]) =>
        exportBundle(transfer, SessionSchema.ID.make(aggregateID)).pipe(
          Effect.flatMap((bundle) =>
            canonical(normalizedBundle(bundle, sourceSeq, snapshot.frozen[aggregateID])) ===
            canonical(snapshot.frozen[aggregateID])
              ? Effect.void
              : Effect.fail(conflict("snapshot-advanced", "source changed below the frozen high-water")),
          ),
          Effect.mapError(() => conflict("snapshot-advanced", "source changed below the frozen high-water")),
        ),
      ),
    )
    .pipe(Effect.catchIf(isSqlError, Effect.die), Effect.asVoid)
}

function normalizedBundle(bundle: Bundle, sourceSeq: number, frozen?: Bundle): Bundle {
  const laterDeletions = bundle.deletions.filter((item) => item.deletingEvent.seq > sourceSeq)
  const restoredContexts =
    frozen?.contexts.filter((context) =>
      laterDeletions.some(
        (deletion) => deletion.targetKind === context.kind && deletion.targetMessageID === context.messageID,
      ),
    ) ?? []
  const epoch = bundle.epoch && bundle.epoch.baselineSeq <= sourceSeq ? { ...bundle.epoch, sourceSeq } : frozen?.epoch
  return {
    version: 1,
    aggregateID: bundle.aggregateID,
    sourceSeq,
    events: bundle.events.filter((event) => event.seq <= sourceSeq),
    contexts: [...bundle.contexts.filter((context) => context.seq <= sourceSeq), ...restoredContexts].sort(
      (left, right) => left.seq - right.seq || left.messageID.localeCompare(right.messageID),
    ),
    deletions: bundle.deletions
      .filter((item) => item.deletingEvent.seq <= sourceSeq)
      .sort((left, right) => left.targetEvent.seq - right.targetEvent.seq),
    epoch,
  }
}

function record(
  kind: CompleteSyncRecord["kind"],
  bundle: Bundle,
  sequence: number,
  identity: string,
  value: unknown,
): CompleteSyncRecord {
  return { kind, aggregateID: bundle.aggregateID, sourceSeq: bundle.sourceSeq, sequence, identity, value }
}

function makePage(
  snapshot: SourceSnapshot,
  start: { readonly record: number; readonly chunk: number },
  base: Record<string, unknown>,
) {
  const records: SyncPage["records"][number][] = []
  let recordIndex = start.record
  let chunkIndex = start.chunk
  let completePublic = 0
  while (recordIndex < snapshot.records.length) {
    const current = snapshot.records[recordIndex]
    const bytes = Buffer.from(canonical(current.value))
    const oversized = Buffer.byteLength(canonical({ ...base, page: { records: [current] } })) > MAX_SYNC_PAGE_BYTES
    if (!oversized && chunkIndex === 0) {
      const nextPublic = completePublic + (current.kind === "event" || current.kind === "deletion" ? 1 : 0)
      if (nextPublic > MAX_SYNC_PUBLIC_EVENTS) break
      if (
        Buffer.byteLength(
          canonical({ ...base, page: { records: [...records, current] }, nextCursor: "x".repeat(256) }),
        ) > MAX_SYNC_PAGE_BYTES
      )
        break
      records.push(current)
      completePublic = nextPublic
      recordIndex++
      continue
    }
    if (records.length > 0) break
    const chunks = Array.from({ length: Math.ceil(bytes.byteLength / (32 * 1024)) }, (_, index) =>
      bytes.subarray(index * 32 * 1024, (index + 1) * 32 * 1024),
    )
    while (chunkIndex < chunks.length && records.length < MAX_SYNC_RECORD_CHUNKS) {
      const chunk = {
        kind: "chunk" as const,
        recordKind: current.kind,
        aggregateID: current.aggregateID,
        sourceSeq: current.sourceSeq,
        sequence: current.sequence,
        identity: current.identity,
        chunkIndex,
        chunkCount: chunks.length,
        byteLength: bytes.byteLength,
        contentHash: digest(bytes),
        data: chunks[chunkIndex].toString("base64"),
      }
      if (
        Buffer.byteLength(canonical({ ...base, page: { records: [...records, chunk] }, nextCursor: "x".repeat(256) })) >
        MAX_SYNC_PAGE_BYTES
      )
        break
      records.push(chunk)
      chunkIndex++
    }
    if (chunkIndex === chunks.length) {
      recordIndex++
      chunkIndex = 0
    }
    break
  }
  if (snapshot.records.length > 0 && records.length === 0) throw new SyncTransferTooLarge()
  const nextCursor =
    recordIndex < snapshot.records.length
      ? encodeCursor(snapshot.token, { record: recordIndex, chunk: chunkIndex })
      : undefined
  const result = { page: { records }, nextCursor }
  if (Buffer.byteLength(canonical({ ...base, ...result })) > MAX_SYNC_PAGE_BYTES) throw new SyncTransferTooLarge()
  return result
}

function encodeCursor(token: string, position: { readonly record: number; readonly chunk: number }) {
  const payload = Buffer.from(canonical(position)).toString("base64url")
  const signature = createHmac("sha256", cursorKey).update(`${token}.${payload}`).digest("base64url")
  return `${payload}.${signature}`
}

function decodeCursor(value: string, token: string): { readonly record: number; readonly chunk: number } | undefined {
  const [payload, signature, extra] = value.split(".")
  if (!payload || !signature || extra) return undefined
  if (createHmac("sha256", cursorKey).update(`${token}.${payload}`).digest("base64url") !== signature) return undefined
  const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  if (decoded === null || typeof decoded !== "object") return undefined
  const parsed = Object.fromEntries(Object.entries(decoded).map(([key, item]): [string, unknown] => [key, item]))
  if (typeof parsed.record !== "number" || typeof parsed.chunk !== "number") return undefined
  if (!Number.isSafeInteger(parsed.record) || !Number.isSafeInteger(parsed.chunk)) return undefined
  if (parsed.record < 0 || parsed.chunk < 0) return undefined
  return { record: parsed.record, chunk: parsed.chunk }
}

function kindRank(kind: CompleteSyncRecord["kind"]) {
  return kind === "event" ? 0 : kind === "deletion" ? 1 : kind === "context" ? 2 : 3
}

function compareRecord(left: CompleteSyncRecord, right: CompleteSyncRecord) {
  if (left.kind === "epoch" && right.kind !== "epoch") return 1
  if (left.kind !== "epoch" && right.kind === "epoch") return -1
  return (
    left.aggregateID.localeCompare(right.aggregateID) ||
    left.sequence - right.sequence ||
    kindRank(left.kind) - kindRank(right.kind) ||
    left.identity.localeCompare(right.identity)
  )
}

function hasManifest(manifest: Manifest) {
  return manifest.privateCount > 0 || manifest.deletionCount > 0 || manifest.epochDigest !== undefined
}

function isPrivateMarker(event: { readonly data: Readonly<Record<string, unknown>> }) {
  return event.data.modelContextVersion === 2 || event.data.text === SessionCompactionContext.sentinel
}

function legacyPrivateRequired(db: Database.Interface["db"], aggregateIDs: ReadonlyArray<SessionSchema.ID>) {
  if (aggregateIDs.length === 0) return Effect.succeed(false)
  return Effect.gen(function* () {
    const input = yield* db
      .select({ id: SessionInputTable.id })
      .from(SessionInputTable)
      .where(
        and(inArray(SessionInputTable.session_id, aggregateIDs), isNotNull(SessionInputTable.context_snapshot_json)),
      )
      .limit(1)
      .get()
      .pipe(Effect.orDie)
    if (input) return true
    const message = yield* db
      .select({ id: SessionMessageTable.id })
      .from(SessionMessageTable)
      .where(
        and(inArray(SessionMessageTable.session_id, aggregateIDs), isNotNull(SessionMessageTable.model_context_json)),
      )
      .limit(1)
      .get()
      .pipe(Effect.orDie)
    if (message) return true
    const epoch = yield* db
      .select({ id: SessionContextEpochTable.session_id })
      .from(SessionContextEpochTable)
      .where(inArray(SessionContextEpochTable.session_id, aggregateIDs))
      .limit(1)
      .get()
      .pipe(Effect.orDie)
    if (epoch) return true
    return (
      (yield* db
        .select({ id: EventTable.id })
        .from(EventTable)
        .where(
          and(
            inArray(EventTable.aggregate_id, aggregateIDs),
            or(
              and(
                eq(EventTable.type, promptAdmittedType),
                sql`json_extract(${EventTable.data}, '$.modelContextVersion') = 2`,
              ),
              and(
                eq(EventTable.type, compactionType),
                sql`json_extract(${EventTable.data}, '$.text') = ${SessionCompactionContext.sentinel}`,
              ),
            ),
          ),
        )
        .limit(1)
        .get()
        .pipe(Effect.orDie)) !== undefined
    )
  })
}

function conflict(code: "conflict" | "restart" | "snapshot-advanced" | "version", message: string) {
  return new SyncConflictError({ code, message })
}

function isHistoryV1(payload: typeof HistoryPayload.Type): payload is typeof HistoryPayloadV1.Type {
  return typeof payload.capabilityOnly === "boolean"
}

function exportBundle(transfer: SessionProjectionTransfer.Interface, sessionID: SessionSchema.ID) {
  return transfer
    .export({ sessionID })
    .pipe(
      Effect.mapError(() => new SyncConflictError({ code: "snapshot-advanced", message: "source snapshot invalid" })),
    )
}

function spoolEffect<A>(run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (error) => {
      if (error instanceof SyncTransferTooLarge) return new SyncTooLargeError({ message: error.message })
      if (error instanceof SyncTransferBusy) return new SyncBusyError({ message: error.message })
      if (error instanceof SyncTransferExpired) return new SyncExpiredError({ message: error.message })
      if (error instanceof SyncTransferConflict)
        return new SyncConflictError({ code: "conflict", message: error.message })
      return new SyncConflictError({ code: "conflict", message: "invalid encrypted transfer spool" })
    },
  })
}
